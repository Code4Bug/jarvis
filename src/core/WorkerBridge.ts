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

  /** 在独立 Worker 线程中执行查询，返回更新后的 transcript */
  run(
    userInput: string,
    transcript: TranscriptMessage[],
    callbacks: EngineCallbacks,
  ): Promise<TranscriptMessage[]> {
    return new Promise((resolve, reject) => {
      const workerTsPath = path.join(__dirname, 'queryWorker.ts');
      const worker = createWorker(workerTsPath);
      this.worker = worker;

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
          case 'done':
            this.worker = null;
            worker.terminate();
            resolve(msg.transcript);
            break;
          case 'error':
            this.worker = null;
            worker.terminate();
            reject(new Error(msg.message));
            break;
        }
      });

      worker.on('error', (err) => {
        this.worker = null;
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && this.worker) {
          this.worker = null;
          reject(new Error(`Worker 异常退出，code=${code}`));
        }
      });

      // 启动执行
      const runMsg: WorkerInbound = { type: 'run', userInput, transcript };
      worker.postMessage(runMsg);
    });
  }

  /** 向 Worker 发送中断信号 */
  abort() {
    if (this.worker) {
      const msg: WorkerInbound = { type: 'abort' };
      this.worker.postMessage(msg);
    }
  }
}
