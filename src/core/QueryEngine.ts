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
import { getAllTools } from '../tools/index';
import { executeQuery, QueryCallbacks, DangerConfirmResult } from './query';
import { MockService } from '../services/api/mock';
import { LLMServiceImpl, getDefaultConfig } from '../services/api/llm';
import { loadConfig, getActiveModel } from '../config/loader';
import { SESSIONS_DIR } from '../config/constants';
import { setActiveAgent } from '../config/agentState';
import { clearAuthorizations } from './safeguard';

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
}

export class QueryEngine {
  private service: LLMService;
  private session: Session;
  private transcript: TranscriptMessage[] = [];
  private abortSignal = { aborted: false };

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

  /** 处理用户输入 */
  async handleQuery(userInput: string, callbacks: EngineCallbacks): Promise<void> {
    this.abortSignal = { aborted: false };

    const userMsg: Message = {
      id: uuid(),
      type: 'user',
      status: 'success',
      content: userInput,
      timestamp: Date.now(),
    };
    callbacks.onMessage(userMsg);
    this.session.messages.push(userMsg);

    const queryCallbacks: QueryCallbacks = {
      onMessage: (msg) => {
        callbacks.onMessage(msg);
        this.session.messages.push(msg);
      },
      onUpdateMessage: callbacks.onUpdateMessage,
      onStreamText: (text) => {
        // 每收到一个 chunk 视为一个 token，实时递增并通知 UI
        this.session.totalTokens++;
        callbacks.onStreamText(text);
        callbacks.onSessionUpdate(this.session);
      },
      onClearStreamText: callbacks.onClearStreamText,
      onLoopStateChange: callbacks.onLoopStateChange,
      onConfirmDangerousCommand: callbacks.onConfirmDangerousCommand,
    };

    try {
      this.transcript = await executeQuery(
        userInput,
        this.transcript,
        getAllTools(),
        this.service,
        queryCallbacks,
        this.abortSignal,
      );
    } catch (err: any) {
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

  /** 终止当前任务 */
  abort() {
    this.abortSignal.aborted = true;
  }

  /** 重置会话 */
  reset() {
    this.saveSession();
    this.session = this.createSession();
    this.transcript = [];
    clearAuthorizations();
  }

  /**
   * 切换智能体：持久化选择 + 重建 LLM service + 重置会话
   */
  switchAgent(agentName: string) {
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
    } catch { /* 静默失败 */ }
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

      return { session: this.session, messages: loaded.messages };
    } catch {
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
      return count;
    } catch {
      return 0;
    }
  }
}
