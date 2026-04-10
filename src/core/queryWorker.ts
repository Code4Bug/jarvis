/**
 * Worker 线程入口 — 在独立线程中执行 executeQuery
 * 通过 parentPort.postMessage 将回调事件传回主线程
 */
import { parentPort, workerData } from 'worker_threads';
import { executeQuery, QueryCallbacks, DangerConfirmResult } from './query.js';
import { getAllTools } from '../tools/index.js';
import { LLMServiceImpl } from '../services/api/llm.js';
import { MockService } from '../services/api/mock.js';
import { loadConfig, getActiveModel } from '../config/loader.js';
import { TranscriptMessage, Message, LoopState, Session } from '../types/index.js';

if (!parentPort) throw new Error('queryWorker must run inside worker_threads');

// ===== 消息类型定义 =====

export type WorkerInbound =
  | { type: 'run'; userInput: string; transcript: TranscriptMessage[] }
  | { type: 'abort' }
  | { type: 'danger_confirm_result'; requestId: string; choice: DangerConfirmResult };

export type WorkerOutbound =
  | { type: 'message'; msg: Message }
  | { type: 'update_message'; id: string; updates: Partial<Message> }
  | { type: 'stream_text'; text: string }
  | { type: 'clear_stream_text' }
  | { type: 'loop_state'; state: LoopState }
  | { type: 'session_update'; session: Session }
  | { type: 'danger_confirm_request'; requestId: string; command: string; reason: string; ruleName: string }
  | { type: 'done'; transcript: TranscriptMessage[] }
  | { type: 'error'; message: string };

// ===== 初始化 LLM 服务 =====
const config = loadConfig();
const activeModel = getActiveModel(config);
let service: InstanceType<typeof LLMServiceImpl> | InstanceType<typeof MockService>;
try {
  service = activeModel ? new LLMServiceImpl() : new MockService();
} catch {
  service = new MockService();
}

// ===== 中断信号 =====
const abortSignal = { aborted: false };

// ===== 危险命令确认：挂起 Promise，等待主线程回复 =====
const pendingConfirms = new Map<string, (choice: DangerConfirmResult) => void>();

// ===== 监听主线程消息 =====
parentPort.on('message', async (msg: WorkerInbound) => {
  if (msg.type === 'abort') {
    abortSignal.aborted = true;
    return;
  }

  if (msg.type === 'danger_confirm_result') {
    const resolve = pendingConfirms.get(msg.requestId);
    if (resolve) {
      pendingConfirms.delete(msg.requestId);
      resolve(msg.choice);
    }
    return;
  }

  if (msg.type === 'run') {
    abortSignal.aborted = false;

    const send = (out: WorkerOutbound) => parentPort!.postMessage(out);

    const callbacks: QueryCallbacks = {
      onMessage: (m) => send({ type: 'message', msg: m }),
      onUpdateMessage: (id, updates) => send({ type: 'update_message', id, updates }),
      onStreamText: (text) => send({ type: 'stream_text', text }),
      onClearStreamText: () => send({ type: 'clear_stream_text' }),
      onLoopStateChange: (state) => send({ type: 'loop_state', state }),
      onConfirmDangerousCommand: (command, reason, ruleName) => {
        return new Promise<DangerConfirmResult>((resolve) => {
          const requestId = `${Date.now()}-${Math.random()}`;
          pendingConfirms.set(requestId, resolve);
          send({ type: 'danger_confirm_request', requestId, command, reason, ruleName });
        });
      },
    };

    try {
      const newTranscript = await executeQuery(
        msg.userInput,
        msg.transcript,
        getAllTools(),
        service,
        callbacks,
        abortSignal,
      );
      send({ type: 'done', transcript: newTranscript });
    } catch (err: any) {
      send({ type: 'error', message: err.message ?? '未知错误' });
    }
  }
});
