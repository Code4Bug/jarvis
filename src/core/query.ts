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
import { findToolMerged as findTool } from '../tools/index';
import { MAX_ITERATIONS } from '../config/constants';
import { sanitizeOutput, validateCommand, authorizeCommand, authorizeRule } from './safeguard';

// 兼容 ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
): Promise<{ text: string; toolCalls: ToolCallInfo[]; duration: number; tokenCount: number; firstTokenLatency: number; tokensPerSecond: number }> {
  const startTime = Date.now();
  let accumulatedText = '';
  let accumulatedThinking = '';
  let toolCalls: ToolCallInfo[] = [];
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
  return { text: effectiveText, toolCalls, duration, tokenCount, firstTokenLatency, tokensPerSecond };
}

// ===== 并行执行判断 =====

/** 判断一组工具调用是否可以并行执行（无写-写冲突、无读-写冲突） */
function canRunInParallel(calls: ToolCallInfo[]): boolean {
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
    const result = await tool.execute(tc.input, abortSignal);
    const { sanitizeOutput } = await import('./safeguard.js');
    return sanitizeOutput(result);
  } catch (err: any) {
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
      callbacks.onUpdateMessage(msgId, { status: 'error', content: errMsg, toolResult: errMsg });
      return { tc, content: `错误: ${errMsg}`, isError: false };
    }
  });

  return Promise.all(tasks);
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
    const result = await tool.execute(tc.input, abortSignal);
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
