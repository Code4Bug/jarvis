import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
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
import { shouldIncludeUserProfile, updateUserProfileFromInput } from '../services/userProfile.js';
import { updatePersistentMemoryFromConversation } from '../services/persistentMemory.js';
import { updateDreamFromSession } from '../services/dream.js';

const DREAM_IDLE_MIN_MS = 5 * 60 * 1000;
const DREAM_IDLE_JITTER_MS = 5 * 60 * 1000;

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
  private memoryUpdateQueue: Promise<void> = Promise.resolve();
  private userProfileUpdateQueue: Promise<void> = Promise.resolve();
  private dreamUpdateQueue: Promise<void> = Promise.resolve();
  private dreamTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityAt = Date.now();
  private isQueryRunning = false;

  constructor() {
    this.service = this.createService();

    this.session = this.createSession();
    this.ensureSessionDir();
    this.scheduleDreamTimer();
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

  private rebuildTranscriptFromMessages(messages: Message[]): TranscriptMessage[] {
    const transcript: TranscriptMessage[] = [];
    for (const msg of messages) {
      if (msg.type === 'user') {
        transcript.push({ role: 'user', content: msg.content });
      } else if (msg.type === 'reasoning' && msg.status === 'success' && msg.content) {
        transcript.push({
          role: 'assistant',
          content: [{ type: 'text', text: msg.content }],
        });
      } else if (msg.type === 'tool_exec' && msg.toolName && msg.toolResult !== undefined) {
        transcript.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolArgs ?? {} }],
        });
        transcript.push({
          role: 'tool_result',
          content: msg.toolResult,
          toolUseId: msg.id,
        });
      }
    }
    return transcript;
  }

  private recomputeSessionSummary(messages: Message[]): string | undefined {
    const firstUser = messages.find((m) => m.type === 'user');
    return firstUser ? firstUser.content.slice(0, 80).replace(/\n/g, ' ') : undefined;
  }

  private recomputeSessionTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + (msg.tokenCount ?? 0), 0);
  }

  private ensureSessionDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  private createService(): LLMService {
    const config = loadConfig();
    const activeModel = getActiveModel(config);

    if (activeModel) {
      try {
        return new LLMServiceImpl();
      } catch {
        return new MockService();
      }
    }

    return new MockService();
  }

  /** 处理用户输入（在独立 Worker 线程中执行） */
  async handleQuery(userInput: string, callbacks: EngineCallbacks): Promise<void> {
    this.touchActivity();
    this.isQueryRunning = true;
    const previousTranscriptLength = this.transcript.length;
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
    const includeUserProfile = shouldIncludeUserProfile(userInput);
    this.scheduleUserProfileUpdate(userInput);

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
        { includeUserProfile },
      );
      const recentTranscript = this.transcript.slice(previousTranscriptLength);
      this.schedulePersistentMemoryUpdate(userInput, recentTranscript);
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
    } finally {
      this.isQueryRunning = false;
      this.scheduleDreamTimer();
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
    this.memoryUpdateQueue = Promise.resolve();
    this.userProfileUpdateQueue = Promise.resolve();
    this.dreamUpdateQueue = Promise.resolve();
    this.touchActivity();
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
    this.service = this.createService();
    // 重置会话上下文
    this.saveSession();
    this.session = this.createSession();
    this.transcript = [];
    this.memoryUpdateQueue = Promise.resolve();
    this.userProfileUpdateQueue = Promise.resolve();
    this.dreamUpdateQueue = Promise.resolve();
    this.touchActivity();
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

  private schedulePersistentMemoryUpdate(userInput: string, recentTranscript: TranscriptMessage[]) {
    if (!userInput.trim() || recentTranscript.length === 0) return;

    const sessionId = this.session.id;
    this.memoryUpdateQueue = this.memoryUpdateQueue
      .catch(() => {})
      .then(async () => {
        await updatePersistentMemoryFromConversation({
          sessionId,
          userInput,
          recentTranscript,
        });
      });
  }

  private scheduleUserProfileUpdate(userInput: string) {
    if (!userInput.trim()) return;

    this.userProfileUpdateQueue = this.userProfileUpdateQueue
      .catch(() => {})
      .then(async () => {
        await updateUserProfileFromInput(userInput);
      });
  }

  private touchActivity() {
    this.lastActivityAt = Date.now();
    this.scheduleDreamTimer();
  }

  private scheduleDreamTimer() {
    if (this.dreamTimer) {
      clearTimeout(this.dreamTimer);
      this.dreamTimer = null;
    }

    const delay = DREAM_IDLE_MIN_MS + Math.floor(Math.random() * DREAM_IDLE_JITTER_MS);
    this.dreamTimer = setTimeout(() => {
      void this.runDreamCycle();
    }, delay);
  }

  private async runDreamCycle() {
    const idleMs = Date.now() - this.lastActivityAt;
    if (this.isQueryRunning || idleMs < DREAM_IDLE_MIN_MS) {
      this.scheduleDreamTimer();
      return;
    }

    const sessionSnapshot = {
      ...this.session,
      messages: [...this.session.messages],
    };
    const transcriptSnapshot = [...this.transcript];
    if (transcriptSnapshot.length === 0) {
      this.scheduleDreamTimer();
      return;
    }

    this.dreamUpdateQueue = this.dreamUpdateQueue
      .catch(() => {})
      .then(async () => {
        logInfo('dream.idle_triggered', {
          sessionId: sessionSnapshot.id,
          idleMs,
          transcriptLength: transcriptSnapshot.length,
        });
        await updateDreamFromSession({
          session: sessionSnapshot,
          transcript: transcriptSnapshot,
        });
      })
      .finally(() => {
        if (!this.isQueryRunning && Date.now() - this.lastActivityAt >= DREAM_IDLE_MIN_MS) {
          this.scheduleDreamTimer();
        }
      });
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
      this.transcript = this.rebuildTranscriptFromMessages(cleanedMessages);

      logInfo('session.loaded', {
        sessionId,
        messageCount: cleanedMessages.length,
        transcriptLength: this.transcript.length,
      });
      this.touchActivity();
      return { session: this.session, messages: cleanedMessages };
    } catch (error) {
      logError('session.load_failed', error, { sessionId });
      return null;
    }
  }

  getSession(): Session {
    return this.session;
  }

  getCurrentSessionUserTurns(): Array<{
    messageId: string;
    turnIndex: number;
    input: string;
    answerPreview: string;
    timestamp: number;
  }> {
    const cleanedMessages = this.session.messages.filter(
      (m) => !(m.type === 'thinking' && m.status === 'pending'),
    );
    const userMessages = cleanedMessages.filter((m) => m.type === 'user');

    return userMessages.map((msg, index) => {
      const currentIndex = cleanedMessages.findIndex((item) => item.id === msg.id);
      const nextUserIndex = cleanedMessages.findIndex(
        (item, i) => i > currentIndex && item.type === 'user',
      );
      const endIndex = nextUserIndex >= 0 ? nextUserIndex : cleanedMessages.length;
      const answerPreview = cleanedMessages
        .slice(currentIndex + 1, endIndex)
        .filter((item) => item.type === 'reasoning' && item.content)
        .map((item) => item.content.trim())
        .find(Boolean) ?? '';

      return {
        messageId: msg.id,
        turnIndex: index + 1,
        input: msg.content,
        answerPreview,
        timestamp: msg.timestamp,
      };
    });
  }

  rewindToUserMessage(messageId: string): {
    session: Session;
    messages: Message[];
    input: string;
    turnIndex: number;
  } | null {
    const cleanedMessages = this.session.messages.filter(
      (m) => !(m.type === 'thinking' && m.status === 'pending'),
    );
    const targetIndex = cleanedMessages.findIndex((m) => m.id === messageId && m.type === 'user');
    if (targetIndex < 0) return null;

    const userTurns = cleanedMessages.filter((m) => m.type === 'user');
    const turnIndex = userTurns.findIndex((m) => m.id === messageId) + 1;
    const targetMessage = cleanedMessages[targetIndex];
    const keptMessages = cleanedMessages.slice(0, targetIndex);

    this.session.messages = keptMessages;
    this.session.summary = this.recomputeSessionSummary(keptMessages);
    this.session.totalTokens = this.recomputeSessionTokens(keptMessages);
    this.session.updatedAt = Date.now();
    this.transcript = this.rebuildTranscriptFromMessages(keptMessages);
    this.touchActivity();
    this.saveSession();

    logInfo('session.rewind', {
      sessionId: this.session.id,
      targetMessageId: messageId,
      turnIndex,
      keptMessageCount: keptMessages.length,
      transcriptLength: this.transcript.length,
    });

    return {
      session: this.session,
      messages: keptMessages,
      input: targetMessage.content,
      turnIndex,
    };
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
