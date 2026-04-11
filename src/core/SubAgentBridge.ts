/**
 * SubAgentBridge — 单个 SubAgent 的 Worker 线程桥接
 *
 * 职责：
 *   - 创建并管理 SubAgent Worker 线程
 *   - 转发 Worker 事件到上层回调
 *   - 处理危险命令确认的双向通信
 *   - 代理 MessageBus publish/subscribe 请求（跨线程通讯）
 *   - 支持中断
 */
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import { TranscriptMessage, Message, LoopState, SubAgentTask, SubAgentResult } from '../types/index.js';
import { DangerConfirmResult } from './query.js';
import { SubAgentInbound, SubAgentOutbound } from './subAgentWorker.js';
import { agentMessageBus } from './AgentMessageBus.js';
import { logError, logInfo, logWarn } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SubAgentBridgeCallbacks {
  onMessage: (taskId: string, msg: Message) => void;
  onUpdateMessage: (taskId: string, id: string, updates: Partial<Message>) => void;
  onStreamText: (taskId: string, text: string) => void;
  onLoopStateChange: (taskId: string, state: LoopState) => void;
  /** 危险命令确认，委托给主线程 UI */
  onConfirmDangerousCommand?: (
    taskId: string,
    command: string,
    reason: string,
    ruleName: string,
  ) => Promise<DangerConfirmResult>;
}

/** 创建 SubAgent Worker（兼容 tsx 开发模式与编译后 .js） */
function createSubAgentWorker(): Worker {
  const workerTsPath = path.join(__dirname, 'subAgentWorker.ts');
  const isTsx = __filename.endsWith('.ts');
  if (isTsx) {
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
  return new Worker(workerTsPath.replace(/\.ts$/, '.js'));
}

export class SubAgentBridge {
  private worker: Worker | null = null;

  /**
   * 在独立 Worker 线程中执行 SubAgent 任务
   * @returns SubAgentResult（包含最终输出、消息列表、transcript）
   */
  run(task: SubAgentTask, callbacks: SubAgentBridgeCallbacks): Promise<SubAgentResult> {
    return new Promise((resolve, reject) => {
      const worker = createSubAgentWorker();
      this.worker = worker;
      logInfo('subagent_bridge.run.start', {
        taskId: task.taskId,
        allowedTools: task.allowedTools,
      });

      // 收集 SubAgent 产生的所有消息，用于汇总结果
      const collectedMessages: Message[] = [];
      let finalTranscript: TranscriptMessage[] = [];

      worker.on('message', async (msg: SubAgentOutbound) => {
        switch (msg.type) {
          case 'message':
            collectedMessages.push(msg.msg);
            callbacks.onMessage(msg.taskId, msg.msg);
            break;


          case 'update_message':
            callbacks.onUpdateMessage(msg.taskId, msg.id, msg.updates);
            break;

          case 'stream_text':
            callbacks.onStreamText(msg.taskId, msg.text);
            break;

          case 'loop_state':
            callbacks.onLoopStateChange(msg.taskId, msg.state);
            break;

          case 'danger_confirm_request': {
            const choice: DangerConfirmResult = callbacks.onConfirmDangerousCommand
              ? await callbacks.onConfirmDangerousCommand(msg.taskId, msg.command, msg.reason, msg.ruleName)
              : 'cancel';
            const reply: SubAgentInbound = {
              type: 'danger_confirm_result',
              requestId: msg.requestId,
              choice,
            };
            worker.postMessage(reply);
            break;
          }

          // ===== MessageBus IPC 代理 =====
          case 'bus_publish': {
            agentMessageBus.publish(msg.from, msg.channel, msg.payload);
            const ack: SubAgentInbound = { type: 'bus_publish_ack', requestId: msg.requestId };
            worker.postMessage(ack);
            break;
          }

          case 'bus_subscribe': {
            // 在主线程侧等待消息，结果回传 Worker
            agentMessageBus.subscribe(msg.channel, msg.timeoutMs, msg.fromOffset).then((busMsg) => {
              const reply: SubAgentInbound = {
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
            const reply: SubAgentInbound = {
              type: 'bus_read_history_result',
              requestId: msg.requestId,
              messages: history,
            };
            worker.postMessage(reply);
            break;
          }

          case 'bus_get_offset': {
            const offset = agentMessageBus.getOffset(msg.channel);
            const reply: SubAgentInbound = {
              type: 'bus_get_offset_result',
              requestId: msg.requestId,
              offset,
            };
            worker.postMessage(reply);
            break;
          }

          case 'bus_list_channels': {
            const channels = agentMessageBus.listChannels();
            const reply: SubAgentInbound = {
              type: 'bus_list_channels_result',
              requestId: msg.requestId,
              channels,
            };
            worker.postMessage(reply);
            break;
          }

          case 'done':
            finalTranscript = msg.transcript;
            this.worker = null;
            worker.terminate();
            logInfo('subagent_bridge.run.done', {
              taskId: msg.taskId,
              transcriptLength: msg.transcript.length,
              messageCount: collectedMessages.length,
            });
            // 从 transcript 中提取最终输出文本
            resolve({
              taskId: msg.taskId,
              status: 'done',
              output: extractFinalOutput(msg.transcript),
              messages: collectedMessages,
              transcript: finalTranscript,
            });
            break;

          case 'error':
            this.worker = null;
            worker.terminate();
            logError('subagent_bridge.run.failed', msg.message, {
              taskId: msg.taskId,
              messageCount: collectedMessages.length,
            });
            resolve({
              taskId: msg.taskId,
              status: 'error',
              output: '',
              messages: collectedMessages,
              transcript: finalTranscript,
              error: msg.message,
            });
            break;
        }
      });

      worker.on('error', (err) => {
        this.worker = null;
        logError('subagent_bridge.worker_error', err, { taskId: task.taskId });
        reject(err);
      });

      worker.on('exit', (code) => {
        if (this.worker) {
          // Worker 退出但未发送 done/error，说明异常终止
          this.worker = null;
          logError('subagent_bridge.worker_exit_abnormal', undefined, { taskId: task.taskId, code });
          reject(new Error(`SubAgent Worker 意外退出，code=${code}`));
        }
      });

      const runMsg: SubAgentInbound = { type: 'run', task };
      worker.postMessage(runMsg);
    });
  }

  /** 中断 SubAgent 执行 */
  abort() {
    if (this.worker) {
      logWarn('subagent_bridge.abort_forwarded');
      const msg: SubAgentInbound = { type: 'abort' };
      this.worker.postMessage(msg);
    }
  }
}

/** 从 transcript 中提取最后一条 assistant 文本作为最终输出 */
function extractFinalOutput(transcript: TranscriptMessage[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') return msg.content;
      // ContentBlock[] — 取最后一个 text block
      const blocks = msg.content as Array<{ type: string; text?: string }>;
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].type === 'text' && blocks[j].text) {
          return blocks[j].text!;
        }
      }
    }
  }
  return '';
}
