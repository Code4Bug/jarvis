/**
 * WorkerBridge — 主线程侧封装
 * 负责创建/复用 Worker、转发回调事件、处理危险命令确认的双向通信
 */
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { TranscriptMessage } from '../types/index.js';
import { EngineCallbacks } from './QueryEngine.js';
import { DangerConfirmResult } from './query.js';
import { WorkerOutbound, WorkerInbound } from './queryWorker.js';
import { agentMessageBus } from './AgentMessageBus.js';
import { spawnSubAgentInMainThread } from '../tools/spawnAgent.js';
import { logError, logInfo, logWarn } from './logger.js';

// 兼容 ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 构造 Worker 实例：
 * - tsx 开发模式（__filename 以 .ts 结尾）：用内联脚本通过 tsImport 加载 .ts
 * - tsc 编译后（__filename 以 .js 结尾）：直接加载 .js
 */
function createWorker(workerTsPath: string): Worker {
  const isTsx = __filename.endsWith('.ts');
  if (isTsx) {
    // tsImport 第二个参数是 parent URL，用 file:// 绝对路径代替 import.meta.url
    const inlineScript = `
import { tsImport } from 'tsx/esm/api';
import { workerData } from 'worker_threads';
import { pathToFileURL } from 'url';
await tsImport(workerData.__workerFile, pathToFileURL(workerData.__workerFile).href);
`;
    return new Worker(inlineScript, {
      eval: true,
      workerData: { __workerFile: workerTsPath },
    });
  }
  const jsPath = workerTsPath.replace(/\.ts$/, '.js');
  return new Worker(jsPath);
}

export class WorkerBridge {
  private worker: Worker | null = null;
  private currentRun: {
    worker: Worker;
    resolve: (transcript: TranscriptMessage[]) => void;
    reject: (error: Error) => void;
    transcript: TranscriptMessage[];
    userInput: string;
    callbacks: EngineCallbacks;
    settled: boolean;
    abortTimer: ReturnType<typeof setTimeout> | null;
    lastLoopState: { iteration: number; maxIterations: number; isRunning: boolean; aborted: boolean };
  } | null = null;

  private finalizeRun(
    worker: Worker,
    action: 'resolve' | 'reject',
    payload: TranscriptMessage[] | Error,
  ) {
    const run = this.currentRun;
    if (!run || run.worker !== worker || run.settled) return;
    run.settled = true;
    if (run.abortTimer) {
      clearTimeout(run.abortTimer);
      run.abortTimer = null;
    }
    this.currentRun = null;
    this.worker = null;
    worker.terminate().catch(() => {});
    if (action === 'resolve') {
      run.resolve(payload as TranscriptMessage[]);
    } else {
      run.reject(payload as Error);
    }
  }

  private buildAbortedTranscript(transcript: TranscriptMessage[], userInput: string): TranscriptMessage[] {
    const abortNotice = '[系统提示] 用户中断了上一轮回复（按下 ESC）。上一条助手消息可能不完整，请在后续回复中注意这一点。';
    const nextTranscript = [...transcript];
    const lastMessage = nextTranscript[nextTranscript.length - 1];

    if (userInput.trim()) {
      const hasSameTrailingUserInput =
        lastMessage?.role === 'user' && lastMessage.content === userInput;
      if (!hasSameTrailingUserInput) {
        nextTranscript.push({ role: 'user', content: userInput });
      }
    }

    nextTranscript.push({ role: 'user', content: abortNotice });
    return nextTranscript;
  }

  /** 在独立 Worker 线程中执行查询，返回更新后的 transcript */
  run(
    userInput: string,
    transcript: TranscriptMessage[],
    callbacks: EngineCallbacks,
    options?: { includeUserProfile?: boolean },
  ): Promise<TranscriptMessage[]> {
    return new Promise((resolve, reject) => {
      const workerTsPath = path.join(__dirname, 'queryWorker.ts');
      const worker = createWorker(workerTsPath);
      this.worker = worker;
      this.currentRun = {
        worker,
        resolve,
        reject,
        transcript,
        userInput,
        callbacks,
        settled: false,
        abortTimer: null,
        lastLoopState: {
          iteration: 0,
          maxIterations: 0,
          isRunning: true,
          aborted: false,
        },
      };
      logInfo('worker_bridge.run.start', {
        inputLength: userInput.length,
        transcriptLength: transcript.length,
      });

      worker.on('message', async (msg: WorkerOutbound) => {
        switch (msg.type) {
          case 'message':
            callbacks.onMessage(msg.msg);
            break;
          case 'update_message':
            callbacks.onUpdateMessage(msg.id, msg.updates);
            break;
          case 'stream_text':
            callbacks.onStreamText(msg.text);
            break;
          case 'clear_stream_text':
            callbacks.onClearStreamText?.();
            break;
          case 'loop_state':
            if (this.currentRun?.worker === worker) {
              this.currentRun.lastLoopState = msg.state;
            }
            callbacks.onLoopStateChange(msg.state);
            break;
          case 'session_update':
            callbacks.onSessionUpdate(msg.session);
            break;
          case 'danger_confirm_request': {
            // 主线程弹出交互式确认，结果回传 Worker
            const choice: DangerConfirmResult = callbacks.onConfirmDangerousCommand
              ? await callbacks.onConfirmDangerousCommand(msg.command, msg.reason, msg.ruleName)
              : 'cancel';
            const reply: WorkerInbound = {
              type: 'danger_confirm_result',
              requestId: msg.requestId,
              choice,
            };
            worker.postMessage(reply);
            break;
          }
          case 'subagent_message':
            // SubAgent 消息：推送到 UI（已携带 subAgentId）
            callbacks.onSubAgentMessage?.(msg.msg);
            break;
          case 'subagent_update_message':
            callbacks.onSubAgentUpdateMessage?.(msg.id, msg.updates);
            break;

          // ===== MessageBus IPC 代理（queryWorker → 主线程） =====
          case 'bus_publish': {
            agentMessageBus.publish(msg.from, msg.channel, msg.payload);
            const ack: WorkerInbound = { type: 'bus_publish_ack', requestId: msg.requestId };
            worker.postMessage(ack);
            break;
          }
          case 'bus_subscribe': {
            agentMessageBus.subscribe(msg.channel, msg.timeoutMs, msg.fromOffset).then((busMsg) => {
              const reply: WorkerInbound = {
                type: 'bus_subscribe_result',
                requestId: msg.requestId,
                message: busMsg,
              };
              worker.postMessage(reply);
            });
            break;
          }
          case 'bus_read_history': {
            const history = agentMessageBus.getHistory(msg.channel, msg.limit);
            const reply: WorkerInbound = {
              type: 'bus_read_history_result',
              requestId: msg.requestId,
              messages: history,
            };
            worker.postMessage(reply);
            break;
          }
          case 'bus_get_offset': {
            const offset = agentMessageBus.getOffset(msg.channel);
            const reply: WorkerInbound = {
              type: 'bus_get_offset_result',
              requestId: msg.requestId,
              offset,
            };
            worker.postMessage(reply);
            break;
          }
          case 'bus_list_channels': {
            const channels = agentMessageBus.listChannels();
            const reply: WorkerInbound = {
              type: 'bus_list_channels_result',
              requestId: msg.requestId,
              channels,
            };
            worker.postMessage(reply);
            break;
          }

          // ===== spawn_subagent IPC（在主线程创建 SubAgentBridge）=====
          case 'spawn_subagent': {
            const result = spawnSubAgentInMainThread(
              msg.taskId,
              msg.instruction,
              msg.agentLabel,
              msg.allowedTools,
            );
            const reply: WorkerInbound = {
              type: 'spawn_subagent_result',
              requestId: msg.requestId,
              result,
            };
            worker.postMessage(reply);
            break;
          }

          case 'done':
            logInfo('worker_bridge.run.done', {
              transcriptLength: msg.transcript.length,
            });
            this.finalizeRun(worker, 'resolve', msg.transcript);
            break;
          case 'error':
            logError('worker_bridge.run.error', msg.message);
            this.finalizeRun(worker, 'reject', new Error(msg.message));
            break;
        }
      });

      worker.on('error', (err) => {
        logError('worker_bridge.worker_error', err);
        this.finalizeRun(worker, 'reject', err);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && this.currentRun?.worker === worker && !this.currentRun.settled) {
          logError('worker_bridge.worker_exit_abnormal', undefined, { code });
          this.finalizeRun(worker, 'reject', new Error(`Worker 异常退出，code=${code}`));
        }
      });

      // 启动执行
      const runMsg: WorkerInbound = { type: 'run', userInput, transcript, options };
      worker.postMessage(runMsg);
    });
  }

  /** 向 Worker 发送中断信号 */
  abort() {
    const run = this.currentRun;
    if (!run || run.settled) return;
    logWarn('worker_bridge.abort_forwarded');
    const msg: WorkerInbound = { type: 'abort' };
    run.worker.postMessage(msg);
    run.callbacks.onClearStreamText?.();
    run.callbacks.onLoopStateChange({
      ...run.lastLoopState,
      isRunning: false,
      aborted: true,
    });
    run.abortTimer = setTimeout(() => {
      if (!this.currentRun || this.currentRun.worker !== run.worker || this.currentRun.settled) return;
      logWarn('worker_bridge.abort_force_resolve');
      this.finalizeRun(run.worker, 'resolve', this.buildAbortedTranscript(run.transcript, run.userInput));
    }, 120);
  }
}
