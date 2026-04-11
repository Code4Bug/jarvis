import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  Message,
  Session,
  LLMService,
  TranscriptMessage,
  LoopState,
} from '../types/index.js';
import { DangerConfirmResult } from './query.js';
import { WorkerBridge } from './WorkerBridge.js';
import { MockService } from '../services/api/mock.js';
import { LLMServiceImpl } from '../services/api/llm.js';
import { loadConfig, getActiveModel } from '../config/loader.js';
import { SESSIONS_DIR } from '../config/constants.js';
import { setActiveAgent } from '../config/agentState.js';
import { clearAuthorizations } from './safeguard.js';
import { agentUIBus } from './AgentRegistry.js';
import { logError, logInfo, logWarn } from './logger.js';

export interface EngineCallbacks {
  onMessage: (msg: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStreamText: (text: string) => void;
  /** 清空流式文本（每轮迭代结束时调用） */
  onClearStreamText?: () => void;
  onLoopStateChange: (state: LoopState) => void;
  onSessionUpdate: (session: Session) => void;
  /** 危险命令交互式确认 */
  onConfirmDangerousCommand?: (command: string, reason: string, ruleName: string) => Promise<DangerConfirmResult>;
  /** SubAgent 产生消息时推送到 UI（带 subAgentId 前缀） */
  onSubAgentMessage?: (msg: Message) => void;
  /** SubAgent 更新已有消息 */
  onSubAgentUpdateMessage?: (id: string, updates: Partial<Message>) => void;
}

export class QueryEngine {
  private service: LLMService;
  private session: Session;
  private transcript: TranscriptMessage[] = [];
  private workerBridge = new WorkerBridge();

  constructor() {
    // 尝试从配置文件加载 LLM，失败则回退 MockService
    const config = loadConfig();
    const activeModel = getActiveModel(config);

    if (activeModel) {
      try {
        this.service = new LLMServiceImpl();
      } catch {
        this.service = new MockService();
      }
    } else {
      this.service = new MockService();
    }

    this.session = this.createSession();
    this.ensureSessionDir();
    logInfo('engine.created', {
      sessionId: this.session.id,
      service: this.service.constructor.name,
    });
  }

  /** 注册持久 UI 回调，供后台 spawn_agent 子 Agent 推送消息 */
  registerUIBus(
    onMessage: (msg: Message) => void,
    onUpdateMessage: (id: string, updates: Partial<Message>) => void,
  ): void {
    agentUIBus.register(onMessage, onUpdateMessage);
    logInfo('engine.ui_bus_registered', { sessionId: this.session.id });
  }

  private createSession(): Session {
    return {
      id: uuid(),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalTokens: 0,
      totalCost: 0,
    };
  }

  private ensureSessionDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /** 处理用户输入（在独立 Worker 线程中执行） */
  async handleQuery(userInput: string, callbacks: EngineCallbacks): Promise<void> {
    logInfo('query.received', {
      sessionId: this.session.id,
      inputLength: userInput.length,
      preview: userInput.slice(0, 200),
    });
    const userMsg: Message = {
      id: uuid(),
      type: 'user',
      status: 'success',
      content: userInput,
      timestamp: Date.now(),
    };
    callbacks.onMessage(userMsg);
    this.session.messages.push(userMsg);

    // 将回调包装后传给 WorkerBridge，Worker 事件会映射回这里
    const bridgeCallbacks: EngineCallbacks = {
      onMessage: (msg) => {
        callbacks.onMessage(msg);
        this.session.messages.push(msg);
      },
      onUpdateMessage: callbacks.onUpdateMessage,
      onStreamText: (text) => {
        this.session.totalTokens++;
        callbacks.onStreamText(text);
        callbacks.onSessionUpdate(this.session);
      },
      onClearStreamText: callbacks.onClearStreamText,
      onLoopStateChange: callbacks.onLoopStateChange,
      onSessionUpdate: callbacks.onSessionUpdate,
      onConfirmDangerousCommand: callbacks.onConfirmDangerousCommand,
      onSubAgentMessage: (msg) => {
        // SubAgent 消息也存入会话，方便持久化
        this.session.messages.push(msg);
        callbacks.onSubAgentMessage?.(msg);
      },
      onSubAgentUpdateMessage: callbacks.onSubAgentUpdateMessage,
    };

    try {
      this.transcript = await this.workerBridge.run(
        userInput,
        this.transcript,
        bridgeCallbacks,
      );
      logInfo('query.completed', {
        sessionId: this.session.id,
        transcriptLength: this.transcript.length,
        totalTokens: this.session.totalTokens,
      });
    } catch (err: any) {
      logError('query.failed', err, { sessionId: this.session.id });
      const errMsg: Message = {
        id: uuid(),
        type: 'error',
        status: 'error',
        content: `错误: ${err.message}`,
        timestamp: Date.now(),
      };
      callbacks.onMessage(errMsg);
    }

    this.session.updatedAt = Date.now();
    callbacks.onSessionUpdate(this.session);
    this.saveSession();
  }

  /** 终止当前任务（通知 Worker 中断） */
  abort() {
    logWarn('query.abort_requested', { sessionId: this.session.id });
    this.workerBridge.abort();
  }

  /** 重置会话 */
  reset() {
    logInfo('session.reset', { sessionId: this.session.id });
    this.saveSession();
    this.session = this.createSession();
    this.transcript = [];
    clearAuthorizations();
  }

  /**
   * 切换智能体：持久化选择 + 重建 LLM service + 重置会话
   */
  switchAgent(agentName: string) {
    logInfo('agent.switch.start', {
      fromSessionId: this.session.id,
      agentName,
    });
    setActiveAgent(agentName);
    // 重建 LLM service 以加载新 agent 的 system prompt
    const config = loadConfig();
    const activeModel = getActiveModel(config);
    if (activeModel) {
      try {
        this.service = new LLMServiceImpl();
      } catch {
        this.service = new MockService();
      }
    } else {
      this.service = new MockService();
    }
    // 重置会话上下文
    this.saveSession();
    this.session = this.createSession();
    this.transcript = [];
    logInfo('agent.switch.completed', {
      sessionId: this.session.id,
      agentName,
      service: this.service.constructor.name,
    });
  }

  /** 保存会话到文件 */
  private saveSession() {
    try {
      // 自动提取摘要：取首条用户消息前 80 个字符
      if (!this.session.summary) {
        const firstUser = this.session.messages.find((m) => m.type === 'user');
        if (firstUser) {
          this.session.summary = firstUser.content.slice(0, 80).replace(/\n/g, ' ');
        }
      }
      const filePath = path.join(SESSIONS_DIR, `${this.session.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(this.session, null, 2), 'utf-8');
      logInfo('session.saved', {
        sessionId: this.session.id,
        filePath,
        messageCount: this.session.messages.length,
      });
    } catch (error) {
      logError('session.save_failed', error, { sessionId: this.session.id });
    }
  }

  /** 列出所有历史会话（按更新时间倒序），返回摘要信息 */
  static listSessions(): { id: string; summary: string; updatedAt: number; totalTokens: number }[] {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) return [];
      const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
      const sessions: { id: string; summary: string; updatedAt: number; totalTokens: number }[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
          const s = JSON.parse(raw) as Session;
          sessions.push({
            id: s.id,
            summary: s.summary || '(无摘要)',
            updatedAt: s.updatedAt,
            totalTokens: s.totalTokens,
          });
        } catch { /* 跳过损坏文件 */ }
      }
      // 按更新时间倒序
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      return sessions;
    } catch {
      return [];
    }
  }

  /** 恢复指定会话：加载历史消息和 transcript */
  loadSession(sessionId: string): { session: Session; messages: Message[] } | null {
    try {
      const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(raw) as Session;

      // 保存当前会话
      this.saveSession();

      // 恢复会话状态
      this.session = loaded;
      // 过滤掉 pending 状态的 thinking 消息（上次会话 abort 时可能残留）
      const cleanedMessages = loaded.messages.filter(
        (m) => !(m.type === 'thinking' && m.status === 'pending'),
      );
      this.session.messages = cleanedMessages;
      // 从历史消息重建 transcript
      this.transcript = [];
      for (const msg of loaded.messages) {
        if (msg.type === 'user') {
          this.transcript.push({ role: 'user', content: msg.content });
        } else if (msg.type === 'reasoning' && msg.status === 'success' && msg.content) {
          // assistant 消息的 content 必须是 ContentBlock[]，与 query.ts 中的构建方式一致
          this.transcript.push({
            role: 'assistant',
            content: [{ type: 'text', text: msg.content }],
          });
        } else if (msg.type === 'tool_exec' && msg.toolName && msg.toolResult !== undefined) {
          // 工具调用：assistant tool_use + tool_result
          this.transcript.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolArgs ?? {} }],
          });
          this.transcript.push({
            role: 'tool_result',
            content: msg.toolResult,
            toolUseId: msg.id,
          });
        }
      }

      logInfo('session.loaded', {
        sessionId,
        messageCount: cleanedMessages.length,
        transcriptLength: this.transcript.length,
      });
      return { session: this.session, messages: cleanedMessages };
    } catch (error) {
      logError('session.load_failed', error, { sessionId });
      return null;
    }
  }

  getSession(): Session {
    return this.session;
  }

  /**
   * 清理非当前会话的所有历史会话文件
   * @returns 删除的会话数量
   */
  clearOtherSessions(): number {
    try {
      if (!fs.existsSync(SESSIONS_DIR)) return 0;
      const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
      const currentFile = `${this.session.id}.json`;
      let count = 0;
      for (const file of files) {
        if (file === currentFile) continue;
        try {
          fs.unlinkSync(path.join(SESSIONS_DIR, file));
          count++;
        } catch { /* 跳过删除失败的文件 */ }
      }
      logInfo('session.clear_others', {
        sessionId: this.session.id,
        removedCount: count,
      });
      return count;
    } catch (error) {
      logError('session.clear_others_failed', error, { sessionId: this.session.id });
      return 0;
    }
  }
}
