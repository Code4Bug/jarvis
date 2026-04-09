/**
 * 真实 LLM 服务 - 支持 OpenAI 兼容 API（流式）
 *
 * 配置来源（优先级从低到高）：
 *   1. 环境变量 API_KEY / LLM_MODEL / API_BASE_URL
 *   2. ~/.jarvis/config.json
 *   3. ./.jarvis/config.json
 */

import { LLMService, StreamCallbacks, TranscriptMessage, Tool, ContentBlock, AbortSignal as AppAbortSignal } from '../../types/index';
import { ModelConfig, loadConfig, getActiveModel } from '../../config/loader';
import { getAgent } from '../../agents/index';
import { DEFAULT_AGENT } from '../../config/constants';
import { getActiveAgent } from '../../config/agentState';
import { getSystemInfoPrompt } from '../../config/systemInfo';

export interface LLMConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl?: string;
  temperature?: number;
}

/** 从配置文件构建 LLMConfig，找不到则回退环境变量 */
export function getDefaultConfig(): LLMConfig {
  const jarvisCfg = loadConfig();
  const active = getActiveModel(jarvisCfg);

  if (active) {
    return fromModelConfig(active);
  }

  // 回退：环境变量
  return {
    apiKey: process.env.API_KEY || '',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    baseUrl: process.env.API_BASE_URL,
  };
}

/** 将 ModelConfig 转为 LLMConfig */
export function fromModelConfig(mc: ModelConfig): LLMConfig {
  return {
    apiKey: mc.api_key,
    model: mc.model,
    maxTokens: mc.max_tokens ?? 4096,
    baseUrl: mc.api_url,
    temperature: mc.temperature,
  };
}

// ===== OpenAI 兼容格式转换 =====

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

/** 将内部 TranscriptMessage[] 转为 OpenAI messages 格式 */
function toOpenAIMessages(transcript: TranscriptMessage[], systemPrompt: string): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // 系统提示 — 来自当前激活的智能体定义
  messages.push({
    role: 'system',
    content: systemPrompt,
  });

  for (const msg of transcript) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content as string });
    } else if (msg.role === 'assistant') {
      // 兼容 content 为 string（旧会话恢复）或 ContentBlock[] 两种情况
      if (typeof msg.content === 'string') {
        messages.push({ role: 'assistant', content: msg.content || '(empty)' });
      } else {
        const blocks = msg.content as ContentBlock[];
        let text = '';
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of blocks) {
          if (block.type === 'text') {
            text += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg: OpenAIMessage = { role: 'assistant' };
        // 确保 content 不为空，避免 API MissingParameter 错误
        assistantMsg.content = text || null;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        messages.push(assistantMsg);
      }
    } else if (msg.role === 'tool_result') {
      messages.push({
        role: 'tool',
        tool_call_id: msg.toolUseId || '',
        content: msg.content as string,
      });
    }
  }

  return messages;
}

/** 将内部 Tool[] 转为 OpenAI tools 格式 */
function toOpenAITools(tools: Tool[]): OpenAITool[] {
  if (tools.length === 0) return [];
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
        ),
        required: Object.entries(t.parameters)
          .filter(([, v]) => v.required !== false)
          .map(([k]) => k),
      },
    },
  }));
}

// ===== SSE 流式解析 =====

interface SSEDelta {
  content?: string | null;
  /** 思考过程（DeepSeek reasoning_content / OpenAI-compatible） */
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

/** 解析单行 SSE data，返回 delta 或 null（[DONE] / 空行） */
function parseSSELine(line: string): SSEDelta | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return null;
  try {
    const parsed = JSON.parse(data);
    return parsed.choices?.[0]?.delta ?? null;
  } catch {
    return null;
  }
}

// ===== LLMServiceImpl =====

export class LLMServiceImpl implements LLMService {
  private config: LLMConfig;
  private systemPrompt: string;

  constructor(config?: LLMConfig) {
    this.config = config ?? getDefaultConfig();
    if (!this.config.apiKey) {
      throw new Error('API_KEY 未配置。请在 .jarvis/config.json 或环境变量中设置。');
    }

    // 从当前激活的智能体加载 system prompt（运行时动态读取）
    const currentAgent = getActiveAgent(DEFAULT_AGENT);
    const agent = getAgent(currentAgent);
    const agentPrompt = agent?.systemPrompt
      ?? '你是一个强大的终端智能助手。回答时使用中文，简洁明了。当需要操作文件系统或执行命令时，请调用对应的工具。';

    // 追加通用角色边界约束（兜底）+ 安全围栏说明
    const roleBoundary =
      '\n\n---\n[系统约束] 你必须严格遵守智能体定义中的角色边界。' +
      '只回答与你角色职责相关的问题。' +
      '对于超出角色范围的请求，礼貌拒绝并引导用户回到你的专业领域。' +
      '不要为了讨好用户而突破角色边界。' +
      '\n\n[安全围栏] 系统已内置安全围栏（Safeguard），会自动拦截危险命令并弹出交互式确认菜单。' +
      '当你需要执行任何命令时，直接调用 Bash 工具即可，不要自行判断命令是否危险，不要用文字询问用户"是否确认执行"。' +
      '安全围栏会自动处理拦截和用户确认流程。';

    // 追加系统环境信息，帮助 LLM 感知用户运行环境
    const systemInfo = getSystemInfoPrompt();

    this.systemPrompt = agentPrompt + roleBoundary + systemInfo;
  }

  async streamMessage(
    transcript: TranscriptMessage[],
    tools: Tool[],
    callbacks: StreamCallbacks,
    abortSignal?: AppAbortSignal,
  ): Promise<void> {
    const messages = toOpenAIMessages(transcript, this.systemPrompt);
    const openaiTools = toOpenAITools(tools);

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      stream: true,
    };
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }
    if (openaiTools.length > 0) {
      body.tools = openaiTools;
      body.tool_choice = 'auto';
    }

    const url = this.config.baseUrl || 'https://api.openai.com/v1/chat/completions';

    // 创建 AbortController 用于取消 HTTP 请求
    const controller = new AbortController();
    // 如果外部已经 abort，直接返回
    if (abortSignal?.aborted) {
      callbacks.onComplete();
      return;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') { callbacks.onComplete(); return; }
      callbacks.onError(new Error(`网络请求失败: ${err.message}`));
      return;
    }

    if (!response.ok) {
      let errBody = '';
      try { errBody = await response.text(); } catch { /* ignore */ }
      callbacks.onError(new Error(`API 错误 ${response.status}: ${errBody.slice(0, 500)}`));
      return;
    }

    // 流式读取 SSE
    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('无法获取响应流'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // 用于累积 tool_calls（可能跨多个 chunk）
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    // 轮询 abortSignal，一旦外部中断立即 abort HTTP 请求，打断 reader.read() 阻塞
    const abortPollTimer = abortSignal
      ? setInterval(() => {
          if (abortSignal.aborted) {
            controller.abort();
            clearInterval(abortPollTimer!);
          }
        }, 50)
      : null;

    try {
      while (true) {
        // 检查是否需要中断
        if (abortSignal?.aborted) {
          controller.abort();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        // 读取后再次检查
        if (abortSignal?.aborted) {
          controller.abort();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最后一行可能不完整，保留
        buffer = lines.pop() || '';

        for (const line of lines) {
          const delta = parseSSELine(line);
          if (!delta) continue;

          // 思考过程（reasoning_content）
          if (delta.reasoning_content && callbacks.onThinking) {
            callbacks.onThinking(delta.reasoning_content);
          }

          // 文本内容
          if (delta.content) {
            callbacks.onText(delta.content);
          }

          // 工具调用（增量拼接）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: '', name: '', args: '' });
              }
              const entry = pendingToolCalls.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name += tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
        }
      }

      // 处理 buffer 中剩余的数据
      if (buffer.trim()) {
        const delta = parseSSELine(buffer);
        if (delta?.reasoning_content && callbacks.onThinking) callbacks.onThinking(delta.reasoning_content);
        if (delta?.content) callbacks.onText(delta.content);
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!pendingToolCalls.has(idx)) {
              pendingToolCalls.set(idx, { id: '', name: '', args: '' });
            }
            const entry = pendingToolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      }

      // 流结束后，触发工具调用回调（只取第一个，与 agentic loop 单步设计一致）
      if (pendingToolCalls.size > 0) {
        const first = pendingToolCalls.get(0);
        if (first && first.name) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(first.args); } catch { /* 参数解析失败则传空 */ }
          callbacks.onToolUse(first.id, first.name, input);
          return; // tool_use 时不触发 onComplete
        }
      }

      callbacks.onComplete();
    } catch (err: any) {
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        callbacks.onComplete();
        return;
      }
      callbacks.onError(new Error(`流式读取失败: ${err.message}`));
    } finally {
      if (abortPollTimer) clearInterval(abortPollTimer);
      reader.releaseLock();
    }
  }
}
