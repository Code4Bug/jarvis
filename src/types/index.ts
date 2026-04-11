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
  /** 并行执行组 ID，同组工具同时运行 */
  parallelGroupId?: string;
  /** 来源 SubAgent 标识，格式如 "ResearchAgent"，用于 UI 前缀展示 */
  subAgentId?: string;
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

/** 工具执行时可选的额外回调，用于特殊工具（如 dispatch_subagent）向主线程推送实时事件 */
export interface ToolCallbacks {
  /** SubAgent 产生新消息时推送到主线程 UI */
  onSubAgentMessage?: (msg: Message) => void;
  /** SubAgent 更新已有消息 */
  onSubAgentUpdateMessage?: (id: string, updates: Partial<Message>) => void;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>, abortSignal?: AbortSignal, toolCallbacks?: ToolCallbacks) => Promise<string>;
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

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  /** 大模型思考过程（reasoning_content），仅本地展示 */
  onThinking?: (text: string) => void;
  onToolUse: (id: string, name: string, input: Record<string, unknown>) => void;
  /** LLM 返回多个并行工具调用时触发（替代多次 onToolUse） */
  onMultiToolUse?: (calls: ToolCallInfo[]) => void;
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
    options?: {
      includeUserProfile?: boolean;
    },
  ) => Promise<void>;
}

// ===== 多智能体系统 =====

/** SubAgent 状态 */
export type SubAgentStatus = 'idle' | 'running' | 'done' | 'error' | 'aborted';

/** SubAgent 任务描述 */
export interface SubAgentTask {
  /** 任务唯一 ID */
  taskId: string;
  /** 任务描述（发给 SubAgent 的指令） */
  instruction: string;
  /** 可选：限制 SubAgent 可用的工具名列表（为空则继承全部工具） */
  allowedTools?: string[];
  /** 可选：SubAgent 角色描述，注入 system prompt */
  role?: string;
  /** 可选：初始上下文 transcript */
  contextTranscript?: TranscriptMessage[];
  /** 可选：直接指定 SubAgent 的 system prompt，跳过主 Agent 的 agent 文件加载 */
  systemPrompt?: string;
}

/** SubAgent 执行结果 */
export interface SubAgentResult {
  taskId: string;
  status: 'done' | 'error' | 'aborted';
  /** 最终输出文本 */
  output: string;
  /** 执行过程中产生的消息列表（用于主 Agent 展示） */
  messages: Message[];
  /** 更新后的 transcript */
  transcript: TranscriptMessage[];
  /** 错误信息（status=error 时） */
  error?: string;
}

/** AgentManager 向外暴露的任务派发回调 */
export interface AgentManagerCallbacks {
  /** SubAgent 产生新消息时（用于 UI 展示） */
  onSubAgentMessage: (taskId: string, msg: Message) => void;
  /** SubAgent 状态变更 */
  onSubAgentStatusChange: (taskId: string, status: SubAgentStatus) => void;
  /** 所有 SubAgent 完成后汇总回调 */
  onAllDone: (results: SubAgentResult[]) => void;
}
