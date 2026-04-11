import { v4 as uuid } from 'uuid';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  Message,
  LoopState,
  Tool,
  LLMService,
  TranscriptMessage,
  ContentBlock,
  ToolCallInfo,
} from '../types/index.js';
import { findToolMerged as findTool } from '../tools/index.js';
import { MAX_ITERATIONS, CONTEXT_TOKEN_LIMIT } from '../config/constants.js';
import { sanitizeOutput, validateCommand, authorizeCommand, authorizeRule } from './safeguard.js';
import { logError, logInfo, logWarn } from './logger.js';

// 兼容 ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 危险命令确认结果 */
export type DangerConfirmResult = 'once' | 'always' | 'cancel';

// ===== Transcript 上下文压缩 =====

/**
 * 粗略估算字符串的 token 数（按 4 字符/token 估算，中文按 2 字符/token）
 * 仅用于判断是否需要压缩，不要求精确
 */
function estimateTokens(text: string): number {
  // 中文字符占比高时每字约 1.5 token，英文约 0.25 token/char
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest * 0.25);
}

/**
 * 对 transcript 中的 tool_result 做滑动压缩：
 * - 保留最近 N 条 tool_result 完整内容
 * - 更早的 tool_result 截断到 maxOldChars 字符
 * - 确保总估算 token 不超过 CONTEXT_TOKEN_LIMIT
 */
function compressTranscript(transcript: TranscriptMessage[]): TranscriptMessage[] {
  // 单条工具结果最大字符数
  const MAX_TOOL_RESULT_CHARS = 3000;
  // 旧条目压缩到的字符数
  const MAX_OLD_TOOL_RESULT_CHARS = 800;
  // 保留最近几条完整
  const KEEP_RECENT = 2;

  // 先对所有 tool_result 做单条截断
  let result = transcript.map((msg) => {
    if (msg.role !== 'tool_result') return msg;
    const content = msg.content as string;
    if (content.length <= MAX_TOOL_RESULT_CHARS) return msg;
    return {
      ...msg,
      content: content.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[已截断，原始长度 ${content.length} 字符]`,
    };
  });

  // 估算总 token，超限则压缩旧 tool_result
  const totalTokens = estimateTokens(result.map((m) => {
    if (typeof m.content === 'string') return m.content;
    return JSON.stringify(m.content);
  }).join(''));

  if (totalTokens <= CONTEXT_TOKEN_LIMIT) return result;

  // 找出所有 tool_result 的索引，保留最近 KEEP_RECENT 条，其余压缩
  const toolResultIndices = result
    .map((m, i) => (m.role === 'tool_result' ? i : -1))
    .filter((i) => i >= 0);

  const toCompress = toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - KEEP_RECENT));

  result = result.map((msg, i) => {
    if (!toCompress.includes(i)) return msg;
    const content = msg.content as string;
    if (content.length <= MAX_OLD_TOOL_RESULT_CHARS) return msg;
    return {
      ...msg,
      content: content.slice(0, MAX_OLD_TOOL_RESULT_CHARS) + `\n...[已压缩]`,
    };
  });

  return result;
}

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
  /** SubAgent 产生消息时透传到主线程 UI（由 dispatch_subagent 工具触发） */
  onSubAgentMessage?: (msg: Message) => void;
  /** SubAgent 更新已有消息时透传 */
  onSubAgentUpdateMessage?: (id: string, updates: Partial<Message>) => void;
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
  logInfo('agent_loop.start', {
    inputLength: userInput.length,
    initialTranscriptLength: transcript.length,
  });
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
    logInfo('agent_loop.iteration.start', {
      iteration: loopState.iteration,
      transcriptLength: localTranscript.length,
    });
    callbacks.onLoopStateChange({ ...loopState });

    const result = await runOneIteration(compressTranscript(localTranscript), _tools, service, callbacks, abortSignal);
    logInfo('agent_loop.iteration.result', {
      iteration: loopState.iteration,
      textLength: result.text.length,
      toolCallCount: result.toolCalls.length,
      duration: result.duration,
      tokenCount: result.tokenCount,
    });

    // 构建 assistant transcript 块
    const assistantBlocks: ContentBlock[] = [];
    if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
    for (const tc of result.toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    if (assistantBlocks.length > 0) {
      localTranscript.push({ role: 'assistant', content: assistantBlocks });
    }

    // 无工具调用 → 结束
    if (result.toolCalls.length === 0) break;

    // 中断发生在推理阶段
    if (abortSignal.aborted) {
      logWarn('agent_loop.aborted_before_tool_execution', {
        iteration: loopState.iteration,
        toolCallCount: result.toolCalls.length,
      });
      for (const tc of result.toolCalls) {
        const skippedResult = `[用户中断] 工具 ${tc.name} 未执行（用户按下 ESC 中断）`;
        localTranscript.push({ role: 'tool_result', toolUseId: tc.id, content: skippedResult });
        const skipMsgId = uuid();
        callbacks.onMessage({
          id: skipMsgId, type: 'tool_exec', status: 'aborted',
          content: `${tc.name} 已跳过（用户中断）`, timestamp: Date.now(),
          toolName: tc.name, toolArgs: tc.input, toolResult: skippedResult,
          abortHint: '命令已跳过（ESC）',
        });
      }
      break;
    }

    // 判断是否可并行执行
    let toolResults: Array<{ tc: ToolCallInfo; content: string; isError: boolean }>;
    if (result.toolCalls.length > 1 && canRunInParallel(result.toolCalls)) {
      toolResults = await executeToolsInParallel(result.toolCalls, callbacks, abortSignal);
    } else if (result.toolCalls.length > 1 && canRunInParallelDirect(result.toolCalls)) {
      // dispatch_subagent 等需要 toolCallbacks 的工具：用 executeTool 并行执行
      toolResults = await Promise.all(
        result.toolCalls.map((tc) => executeTool(tc, callbacks, abortSignal).then((r) => ({ tc, ...r }))),
      );
    } else {
      toolResults = [];
      for (const tc of result.toolCalls) {
        const r = await executeTool(tc, callbacks, abortSignal);
        toolResults.push({ tc, ...r });
        if (r.isError) break;
      }
    }

    // 将所有工具结果写入 transcript
    for (const { tc, content } of toolResults) {
      localTranscript.push({ role: 'tool_result', toolUseId: tc.id, content });
    }

    // 任意工具出错则终止循环
    if (toolResults.some((r) => r.isError)) break;
  }

  loopState.isRunning = false;
  loopState.aborted = abortSignal.aborted;
  callbacks.onLoopStateChange({ ...loopState });

  if (abortSignal.aborted) {
    logWarn('agent_loop.aborted', {
      finalIteration: loopState.iteration,
      transcriptLength: localTranscript.length,
    });
    localTranscript.push({
      role: 'user',
      content: '[系统提示] 用户中断了上一轮回复（按下 ESC）。上一条助手消息可能不完整，请在后续回复中注意这一点。',
    });
  }

  logInfo('agent_loop.done', {
    finalIteration: loopState.iteration,
    aborted: abortSignal.aborted,
    transcriptLength: localTranscript.length,
  });
  return localTranscript;
}

/** 执行一次 LLM 调用 */
async function runOneIteration(
  transcript: TranscriptMessage[],
  tools: Tool[],
  service: LLMService,
  callbacks: QueryCallbacks,
  abortSignal: { aborted: boolean },
): Promise<{ text: string; toolCalls: ToolCallInfo[]; duration: number; tokenCount: number; firstTokenLatency: number; tokensPerSecond: number }> {
  const startTime = Date.now();
  let accumulatedText = '';
  let accumulatedThinking = '';
  let toolCalls: ToolCallInfo[] = [];
  let tokenCount = 0;
  let firstTokenTime: number | null = null;

  const thinkingId = uuid();
  logInfo('llm.iteration.requested', {
    transcriptLength: transcript.length,
    toolCount: tools.length,
  });
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
          tokenCount++;
          callbacks.onUpdateMessage(thinkingId, { content: accumulatedThinking });
        },
        onText: (text) => {
          if (abortSignal.aborted) { safeResolve(); return; }
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
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
          toolCalls = [{ id, name, input }];
          safeResolve();
        },
        onMultiToolUse: (calls) => {
          if (abortSignal.aborted) { safeResolve(); return; }
          toolCalls = calls;
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

  callbacks.onUpdateMessage(thinkingId, {
    status: 'success',
    content: accumulatedThinking ? '思考完成' : '',
    think: accumulatedThinking || undefined,
    duration,
  });

  if (accumulatedText) {
    const isAborted = abortSignal.aborted;
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
  } else if (accumulatedThinking && toolCalls.length === 0) {
    const isAborted = abortSignal.aborted;
    callbacks.onClearStreamText?.();
    callbacks.onStreamText(accumulatedThinking);
    callbacks.onClearStreamText?.();
    callbacks.onMessage({
      id: uuid(),
      type: 'reasoning',
      status: isAborted ? 'aborted' : 'success',
      content: accumulatedThinking,
      timestamp: Date.now(),
      duration,
      tokenCount,
      firstTokenLatency,
      tokensPerSecond,
      ...(isAborted ? { abortHint: '推理已中断（ESC）' } : {}),
    });
  }

  const effectiveText = accumulatedText || (accumulatedThinking && toolCalls.length === 0 ? accumulatedThinking : '');
  logInfo('llm.iteration.completed', {
    duration,
    tokenCount,
    firstTokenLatency,
    tokensPerSecond,
    textLength: effectiveText.length,
    thinkingLength: accumulatedThinking.length,
    toolCallCount: toolCalls.length,
  });
  return { text: effectiveText, toolCalls, duration, tokenCount, firstTokenLatency, tokensPerSecond };
}

// ===== 并行执行判断 =====

/** 判断一组工具调用是否可以并行执行（无写-写冲突、无读-写冲突） */
function canRunInParallel(calls: ToolCallInfo[]): boolean {
  // run_agent / spawn_agent 需要 toolCallbacks 传递消息，不能走 runToolInWorker 路径
  if (calls.some((c) => c.name === 'run_agent' || c.name === 'spawn_agent')) return false;

  // 写操作工具集合
  const WRITE_TOOLS = new Set(['WriteFile', 'Bash']);
  // 读操作工具集合
  const READ_TOOLS = new Set(['ReadFile', 'ListDirectory', 'SearchFiles', 'SemanticSearch']);

  const hasWrite = calls.some((c) => WRITE_TOOLS.has(c.name));
  const hasRead = calls.some((c) => READ_TOOLS.has(c.name));

  // 有写操作时：写-写 或 读-写 混合均不可并行（避免竞态）
  if (hasWrite) return false;

  // 全部是读操作 → 可并行
  if (hasRead && !hasWrite) return true;

  // Bash 命令：检查是否有文件路径重叠（简单启发式）
  const bashCalls = calls.filter((c) => c.name === 'Bash');
  if (bashCalls.length > 1) {
    // 多个 Bash 命令默认不并行（无法静态分析副作用）
    return false;
  }

  // 其余情况（如多个只读 skill）允许并行
  return true;
}

/**
 * 判断是否可以用 executeTool 直接并行（适用于 dispatch_subagent 等需要 toolCallbacks 的工具）
 * 这些工具在主线程 Worker 里执行，可以正确传递 callbacks，但不能用 runToolInWorker
 */
function canRunInParallelDirect(calls: ToolCallInfo[]): boolean {
  // 全部是 run_agent / spawn_agent 时，可以用 executeTool 并行（各自启动独立 SubAgent Worker）
  return calls.every((c) => c.name === 'run_agent' || c.name === 'spawn_agent');
}

// ===== 并行工具执行（多 Worker 线程） =====

/** 在独立 Worker 线程中执行单个工具，返回结果字符串 */
function runToolInWorker(
  tc: ToolCallInfo,
  abortSignal: { aborted: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const isTsx = __filename.endsWith('.ts');
    const workerScript = isTsx
      ? `
import { tsImport } from 'tsx/esm/api';
import { workerData, parentPort } from 'worker_threads';
import { pathToFileURL } from 'url';
const mod = await tsImport(workerData.__file, pathToFileURL(workerData.__file).href);
const result = await mod.runToolDirect(workerData.tc, workerData.abortSignal);
parentPort.postMessage({ result });
`
      : `
import { runToolDirect } from '${__filename.replace(/\.ts$/, '.js')}';
import { workerData, parentPort } from 'worker_threads';
const result = await runToolDirect(workerData.tc, workerData.abortSignal);
parentPort.postMessage({ result });
`;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        __file: __filename,
        tc,
        abortSignal: { aborted: abortSignal.aborted },
      },
    });

    worker.on('message', (msg: { result: string }) => {
      worker.terminate();
      resolve(msg.result);
    });
    worker.on('error', (err) => {
      worker.terminate();
      reject(err);
    });
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`工具 Worker 异常退出 code=${code}`));
    });
  });
}

/**
 * 直接执行工具（供 Worker 线程调用）
 * 注意：此函数在 Worker 线程中运行，不能使用 callbacks
 */
export async function runToolDirect(
  tc: ToolCallInfo,
  abortSignal: { aborted: boolean },
): Promise<string> {
  // 动态导入避免循环依赖
  const { findToolMerged } = await import('../tools/index.js');
  const tool = findToolMerged(tc.name);
  if (!tool) return `错误: 未知工具 ${tc.name}`;
  try {
    logInfo('tool.direct.start', { toolName: tc.name, toolArgs: tc.input });
    const result = await tool.execute(tc.input, abortSignal);
    const { sanitizeOutput } = await import('./safeguard.js');
    logInfo('tool.direct.done', {
      toolName: tc.name,
      resultLength: String(result).length,
    });
    return sanitizeOutput(result);
  } catch (err: any) {
    logError('tool.direct.failed', err, { toolName: tc.name, toolArgs: tc.input });
    return `错误: ${err.message || '工具执行失败'}`;
  }
}

/** 并行执行多个工具，每个工具在独立 Worker 线程中运行，实时更新 UI */
async function executeToolsInParallel(
  calls: ToolCallInfo[],
  callbacks: QueryCallbacks,
  abortSignal: { aborted: boolean },
): Promise<Array<{ tc: ToolCallInfo; content: string; isError: boolean }>> {
  const groupId = uuid();
  logInfo('tool.parallel_group.start', {
    groupId,
    toolNames: calls.map((call) => call.name),
  });

  // 为每个工具预先创建 pending 消息节点（TUI 立即渲染占位）
  const msgIds = calls.map((tc) => {
    const msgId = uuid();
    const isSkill = tc.name.startsWith('skill_');
    const displayContent = tc.name === 'Bash' && tc.input.command
      ? `Bash(${tc.input.command})`
      : isSkill
        ? `${tc.name.replace(/^skill_/, '')}(${Object.values(tc.input).join(', ')})`
        : `调用工具: ${tc.name}`;

    callbacks.onMessage({
      id: msgId,
      type: 'tool_exec',
      status: 'pending',
      content: displayContent,
      timestamp: Date.now(),
      toolName: tc.name,
      toolArgs: tc.input,
      parallelGroupId: groupId,
    });
    return msgId;
  });

  // 并行启动所有工具（各自在独立 Worker 线程）
  const tasks = calls.map(async (tc, i) => {
    const msgId = msgIds[i];
    const start = Date.now();

    // 安全围栏检查（Bash 命令）
    if (tc.name === 'Bash' && tc.input.command) {
      const { validateCommand } = await import('./safeguard.js');
      const check = validateCommand(tc.input.command as string);
      if (!check.allowed) {
        if (!check.canOverride) {
          const errMsg = `${check.reason}\n🚫 该命令已被永久禁止。\n命令: ${tc.input.command}`;
          callbacks.onUpdateMessage(msgId, { status: 'error', content: errMsg, toolResult: errMsg });
          return { tc, content: `错误: ${errMsg}`, isError: true };
        }
        // 危险命令在并行模式下直接跳过（无法弹出交互式确认）
        const skipMsg = `⚠️ 并行模式下跳过危险命令: ${tc.input.command}\n原因: ${check.reason}`;
        callbacks.onUpdateMessage(msgId, { status: 'error', content: skipMsg, toolResult: skipMsg });
        return { tc, content: skipMsg, isError: true };
      }
    }

    try {
      const content = await runToolInWorker(tc, abortSignal);
      const wasAborted = abortSignal.aborted;
      const isSkill = tc.name.startsWith('skill_');
      const doneContent = wasAborted
        ? `${tc.name} 已中断`
        : tc.name === 'Bash' && tc.input.command
          ? `Bash(${tc.input.command}) 执行完成`
          : isSkill
            ? `${tc.name.replace(/^skill_/, '')}(${Object.values(tc.input).join(', ')}) 执行完成`
            : `工具 ${tc.name} 执行完成`;

      callbacks.onUpdateMessage(msgId, {
        status: wasAborted ? 'aborted' : 'success',
        content: doneContent,
        toolResult: content,
        duration: Date.now() - start,
        parallelGroupId: groupId,
        ...(wasAborted ? { abortHint: '命令已中断（ESC）' } : {}),
      });
      return { tc, content, isError: false };
    } catch (err: any) {
      const errMsg = err.message || '工具执行失败';
      logError('tool.parallel.failed', err, { groupId, toolName: tc.name, toolArgs: tc.input });
      callbacks.onUpdateMessage(msgId, { status: 'error', content: errMsg, toolResult: errMsg });
      return { tc, content: `错误: ${errMsg}`, isError: false };
    }
  });

  const results = await Promise.all(tasks);
  logInfo('tool.parallel_group.done', {
    groupId,
    toolNames: calls.map((call) => call.name),
    errorCount: results.filter((item) => item.isError).length,
  });
  return results;
}

/** 执行工具并返回结果 */
async function executeTool(
  tc: ToolCallInfo,
  callbacks: QueryCallbacks,
  abortSignal?: { aborted: boolean },
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
  logInfo('tool.execute.start', {
    toolName: tc.name,
    toolArgs: tc.input,
    toolExecId,
  });

  // ===== 安全围栏：Bash 命令拦截 + 交互式确认 =====
  if (tc.name === 'Bash' && tc.input.command) {
    const command = tc.input.command as string;
    const check = validateCommand(command);
    if (!check.allowed) {
      if (!check.canOverride) {
        // critical 级别：直接禁止
        const errMsg = `${check.reason}\n🚫 该命令已被永久禁止，无法通过授权绕过。\n命令: ${command}`;
        logWarn('tool.execute.blocked', { toolName: tc.name, command, reason: check.reason });
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
          logWarn('tool.execute.cancelled_by_user', { toolName: tc.name, command, reason });
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
    logWarn('tool.execute.unknown', { toolName: tc.name });
    callbacks.onUpdateMessage(toolExecId, { status: 'error', content: errMsg });
    return { content: errMsg, isError: true };
  }

  try {
    const start = Date.now();
    const result = await tool.execute(tc.input, abortSignal, {
      onSubAgentMessage: (msg) => {
        // SubAgent 消息只走 onSubAgentMessage，避免与主 Agent 消息流混淆
        callbacks.onSubAgentMessage?.(msg);
      },
      onSubAgentUpdateMessage: (id, updates) => {
        // SubAgent 更新只走 onSubAgentUpdateMessage，跳过主 Agent 的节流逻辑
        callbacks.onSubAgentUpdateMessage?.(id, updates);
      },
    });
    // 对工具输出统一脱敏
    const safeResult = sanitizeOutput(result);

    // 工具执行期间被中断
    const wasAborted = abortSignal?.aborted;
    const doneContent = wasAborted
      ? (tc.name === 'Bash' && tc.input.command
        ? `Bash(${tc.input.command}) 已中断`
        : isSkill
          ? `${skillName}(${skillArgsSummary}) 已中断`
          : `工具 ${tc.name} 已中断`)
      : (tc.name === 'Bash' && tc.input.command
        ? `Bash(${tc.input.command}) 执行完成`
        : isSkill
          ? `${skillName}(${skillArgsSummary}) 执行完成`
          : `工具 ${tc.name} 执行完成`);

    callbacks.onUpdateMessage(toolExecId, {
      status: wasAborted ? 'aborted' : 'success',
      content: doneContent,
      toolResult: safeResult,
      duration: Date.now() - start,
      ...(wasAborted ? { abortHint: '命令已中断（ESC）' } : {}),
    });
    logInfo('tool.execute.done', {
      toolName: tc.name,
      toolExecId,
      duration: Date.now() - start,
      aborted: Boolean(wasAborted),
      resultLength: safeResult.length,
    });
    return { content: safeResult, isError: false };
  } catch (err: any) {
    const errMsg = err.message || '工具执行失败';
    logError('tool.execute.failed', err, {
      toolName: tc.name,
      toolArgs: tc.input,
      toolExecId,
    });
    callbacks.onUpdateMessage(toolExecId, {
      status: 'error',
      content: errMsg,
      toolResult: errMsg,
    });
    return { content: `错误: ${errMsg}`, isError: false };
  }
}
