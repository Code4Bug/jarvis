// ===== 消息系统 =====

export type MessageStatus = 'pending' | 'success' | 'error' | 'aborted';

export type MessageType =
  | 'user'
  | 'reasoning'
  | 'tool_exec'
  | 'file_op'
  | 'thinking'
  | 'system'
  | 'network'
  | 'error';

export interface Message {
  id: string;
  type: MessageType;
  status: MessageStatus;
  content: string;
  timestamp: number;
  /** 耗时 ms */
  duration?: number;
  /** token 统计 */
  tokenCount?: number;
  /** 首 token 延时 ms */
  firstTokenLatency?: number;
  /** 平均每秒 token 数 */
  tokensPerSecond?: number;
  /** 工具调用相关 */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  /** 大模型思考过程，仅本地展示，不带入上下文 */
  think?: string;
  /** 中断提示文案，仅 aborted 状态时使用 */
  abortHint?: string;
}

// ===== 内容块（流式） =====

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

// ===== Agentic Loop 状态 =====

export interface LoopState {
  iteration: number;
  maxIterations: number;
  isRunning: boolean;
  aborted: boolean;
}

// ===== 工具定义 =====

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// ===== 会话 =====

export interface Session {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  totalTokens: number;
  totalCost: number;
  /** 会话摘要（首条用户消息截取），用于 /resume 列表展示 */
  summary?: string;
}

// ===== LLM 服务接口 =====

export interface LLMServiceConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  /** 大模型思考过程（reasoning_content），仅本地展示 */
  onThinking?: (text: string) => void;
  onToolUse: (id: string, name: string, input: Record<string, unknown>) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

/** 可中断信号，用于取消正在进行的 LLM 流式请求 */
export interface AbortSignal {
  aborted: boolean;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool_result';
  content: string | ContentBlock[];
  toolUseId?: string;
}

export interface LLMService {
  streamMessage: (
    transcript: TranscriptMessage[],
    tools: Tool[],
    callbacks: StreamCallbacks,
    abortSignal?: AbortSignal,
  ) => Promise<void>;
}
