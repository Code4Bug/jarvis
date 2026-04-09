import { v4 as uuid } from 'uuid';
import {
  Message,
  LoopState,
  Tool,
  LLMService,
  TranscriptMessage,
  ContentBlock,
} from '../types/index.js';
import { findToolMerged as findTool } from '../tools/index.js';
import { MAX_ITERATIONS } from '../config/constants.js';
import { sanitizeOutput, validateCommand, authorizeCommand, authorizeRule, AuthMode } from './safeguard.js';

interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 危险命令确认结果 */
export type DangerConfirmResult = 'once' | 'always' | 'cancel';

export interface QueryCallbacks {
  onMessage: (msg: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStreamText: (text: string) => void;
  /** 清空流式文本（每轮迭代结束时调用，避免 streamText 被工具消息挤到底部） */
  onClearStreamText?: () => void;
  onLoopStateChange: (state: LoopState) => void;
  /**
   * 危险命令确认回调 — 返回用户选择
   * @param command 被拦截的命令
   * @param reason 风险说明
   * @param ruleName 匹配的规则名
   */
  onConfirmDangerousCommand?: (command: string, reason: string, ruleName: string) => Promise<DangerConfirmResult>;
}

/**
 * 单轮 Agentic Loop：推理 → 工具调用 → 循环
 */
export async function executeQuery(
  userInput: string,
  transcript: TranscriptMessage[],
  _tools: Tool[],
  service: LLMService,
  callbacks: QueryCallbacks,
  abortSignal: { aborted: boolean },
): Promise<TranscriptMessage[]> {
  const localTranscript = [...transcript];
  localTranscript.push({ role: 'user', content: userInput });

  const loopState: LoopState = {
    iteration: 0,
    maxIterations: MAX_ITERATIONS,
    isRunning: true,
    aborted: false,
  };
  callbacks.onLoopStateChange({ ...loopState });

  while (loopState.iteration < MAX_ITERATIONS && !abortSignal.aborted) {
    loopState.iteration++;
    callbacks.onLoopStateChange({ ...loopState });

    const result = await runOneIteration(localTranscript, _tools, service, callbacks, abortSignal);

    // 添加推理消息
    if (result.text) {
      const blocks: ContentBlock[] = [{ type: 'text', text: result.text }];
      if (result.toolCall) {
        blocks.push({
          type: 'tool_use',
          id: result.toolCall.id,
          name: result.toolCall.name,
          input: result.toolCall.input,
        });
      }
      localTranscript.push({ role: 'assistant', content: blocks });
    } else if (result.toolCall) {
      localTranscript.push({
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: result.toolCall.id,
          name: result.toolCall.name,
          input: result.toolCall.input,
        }],
      });
    }

    // 无工具调用 → 结束
    if (!result.toolCall) break;
    if (abortSignal.aborted) break;

    // 执行工具
    const tc = result.toolCall;
    const toolResult = await executeTool(tc, callbacks);
    localTranscript.push({
      role: 'tool_result',
      toolUseId: tc.id,
      content: toolResult.content,
    });

    if (toolResult.isError) break;
  }

  loopState.isRunning = false;
  loopState.aborted = abortSignal.aborted;
  callbacks.onLoopStateChange({ ...loopState });

  // 如果被用户中断，在 transcript 中追加中断标记，让 LLM 知道上轮回复未完成
  if (abortSignal.aborted) {
    localTranscript.push({
      role: 'user',
      content: '[系统提示] 用户中断了上一轮回复（按下 ESC）。上一条助手消息可能不完整，请在后续回复中注意这一点。',
    });
  }

  return localTranscript;
}

/** 执行一次 LLM 调用 */
async function runOneIteration(
  transcript: TranscriptMessage[],
  tools: Tool[],
  service: LLMService,
  callbacks: QueryCallbacks,
  abortSignal: { aborted: boolean },
): Promise<{ text: string; toolCall: ToolCallInfo | null; duration: number; tokenCount: number; firstTokenLatency: number; tokensPerSecond: number }> {
  const startTime = Date.now();
  let accumulatedText = '';
  let accumulatedThinking = '';
  let toolCall: ToolCallInfo | null = null;
  let tokenCount = 0;
  let firstTokenTime: number | null = null;

  const thinkingId = uuid();
  callbacks.onMessage({
    id: thinkingId,
    type: 'thinking',
    status: 'pending',
    content: '思考中...',
    timestamp: Date.now(),
  });

  await new Promise<void>((resolve, reject) => {
    let resolved = false;
    const safeResolve = () => { if (!resolved) { resolved = true; resolve(); } };
    service
      .streamMessage(transcript, tools, {
        onThinking: (text) => {
          if (abortSignal.aborted) { safeResolve(); return; }
          accumulatedThinking += text;
          // 实时更新 thinking 消息内容，让用户看到思考过程
          callbacks.onUpdateMessage(thinkingId, { content: accumulatedThinking });
        },
        onText: (text) => {
          if (abortSignal.aborted) { safeResolve(); return; }
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
            // 收到首 token，将 thinking 消息标记为完成（保留 think 内容）
            callbacks.onUpdateMessage(thinkingId, {
              status: 'success',
              content: accumulatedThinking ? '思考完成' : '',
              think: accumulatedThinking || undefined,
            });
          }
          tokenCount++;
          accumulatedText += text;
          callbacks.onStreamText(text);
        },
        onToolUse: (id, name, input) => {
          if (abortSignal.aborted) { safeResolve(); return; }
          toolCall = { id, name, input };
          safeResolve();
        },
        onComplete: () => safeResolve(),
        onError: (err) => reject(err),
      }, abortSignal)
      .catch(reject);
  });

  const duration = Date.now() - startTime;
  const firstTokenLatency = firstTokenTime !== null ? firstTokenTime - startTime : 0;
  const durationSec = duration / 1000;
  const tokensPerSecond = durationSec > 0 ? tokenCount / durationSec : 0;

  // 最终更新 thinking 消息状态
  callbacks.onUpdateMessage(thinkingId, {
    status: 'success',
    content: accumulatedThinking ? '思考完成' : '',
    think: accumulatedThinking || undefined,
    duration,
  });

  if (accumulatedText) {
    const isAborted = abortSignal.aborted;
    // 先清空流式文本，再 push reasoning 消息，避免 streamText 被后续工具消息挤到底部
    callbacks.onClearStreamText?.();
    callbacks.onMessage({
      id: uuid(),
      type: 'reasoning',
      status: isAborted ? 'aborted' : 'success',
      content: accumulatedText,
      timestamp: Date.now(),
      duration,
      tokenCount,
      firstTokenLatency,
      tokensPerSecond,
      ...(isAborted ? { abortHint: '推理已中断（ESC）' } : {}),
    });
  }

  return { text: accumulatedText, toolCall, duration, tokenCount, firstTokenLatency, tokensPerSecond };
}

/** 执行工具并返回结果 */
async function executeTool(
  tc: ToolCallInfo,
  callbacks: QueryCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const toolExecId = uuid();
  // 对 Bash / Skill 工具使用更直观的显示格式
  const isSkill = tc.name.startsWith('skill_');
  const skillName = isSkill ? tc.name.replace(/^skill_/, '') : '';
  const skillArgsSummary = isSkill
    ? Object.values(tc.input).map((v) => String(v)).filter(Boolean).join(', ')
    : '';
  const displayContent = tc.name === 'Bash' && tc.input.command
    ? `Bash(${tc.input.command})`
    : isSkill
      ? `${skillName}(${skillArgsSummary})`
      : `调用工具: ${tc.name}`;

  callbacks.onMessage({
    id: toolExecId,
    type: 'tool_exec',
    status: 'pending',
    content: displayContent,
    timestamp: Date.now(),
    toolName: tc.name,
    toolArgs: tc.input,
  });

  // ===== 安全围栏：Bash 命令拦截 + 交互式确认 =====
  if (tc.name === 'Bash' && tc.input.command) {
    const command = tc.input.command as string;
    const check = validateCommand(command);
    if (!check.allowed) {
      if (!check.canOverride) {
        // critical 级别：直接禁止
        const errMsg = `${check.reason}\n🚫 该命令已被永久禁止，无法通过授权绕过。\n命令: ${command}`;
        callbacks.onUpdateMessage(toolExecId, { status: 'error', content: errMsg, toolResult: errMsg });
        return { content: `错误: ${errMsg}`, isError: true };
      }
      // high 级别：弹出交互式确认
      if (callbacks.onConfirmDangerousCommand) {
        const ruleName = check.rule?.name ?? 'unknown';
        const reason = check.reason ?? '未知风险';
        const userChoice = await callbacks.onConfirmDangerousCommand(command, reason, ruleName);
        if (userChoice === 'cancel') {
          const cancelMsg = `⛔ 用户取消执行危险命令: ${command}`;
          callbacks.onUpdateMessage(toolExecId, { status: 'error', content: cancelMsg, toolResult: cancelMsg });
          return { content: cancelMsg, isError: true };
        }
        // 根据用户选择授权
        if (userChoice === 'once') {
          authorizeCommand(command, 'once', ruleName);
        } else if (userChoice === 'always') {
          authorizeRule(ruleName, 'always');
        }
      } else {
        // 没有确认回调，直接拒绝
        const errMsg = `${check.reason}\n命令: ${command}`;
        callbacks.onUpdateMessage(toolExecId, { status: 'error', content: errMsg, toolResult: errMsg });
        return { content: `错误: ${errMsg}`, isError: true };
      }
    }
  }

  const tool = findTool(tc.name);
  if (!tool) {
    const errMsg = `未知工具: ${tc.name}`;
    callbacks.onUpdateMessage(toolExecId, { status: 'error', content: errMsg });
    return { content: errMsg, isError: true };
  }

  try {
    const start = Date.now();
    const result = await tool.execute(tc.input);
    // 对工具输出统一脱敏
    const safeResult = sanitizeOutput(result);
    const doneContent = tc.name === 'Bash' && tc.input.command
      ? `Bash(${tc.input.command}) 执行完成`
      : isSkill
        ? `${skillName}(${skillArgsSummary}) 执行完成`
        : `工具 ${tc.name} 执行完成`;
    callbacks.onUpdateMessage(toolExecId, {
      status: 'success',
      content: doneContent,
      toolResult: safeResult,
      duration: Date.now() - start,
    });
    return { content: safeResult, isError: false };
  } catch (err: any) {
    const errMsg = err.message || '工具执行失败';
    callbacks.onUpdateMessage(toolExecId, {
      status: 'error',
      content: errMsg,
      toolResult: errMsg,
    });
    return { content: `错误: ${errMsg}`, isError: false };
  }
}
