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
import { BusMessage } from './AgentMessageBus.js';
import { pendingBusRequests } from './workerBusProxy.js';
import { pendingSpawnRequests } from './spawnRegistry.js';
import { logError, logInfo, logWarn } from './logger.js';

if (!parentPort) throw new Error('queryWorker must run inside worker_threads');
logInfo('query_worker.ready');

// ===== 消息类型定义 =====

export type WorkerInbound =
  | { type: 'run'; userInput: string; transcript: TranscriptMessage[]; options?: { includeUserProfile?: boolean } }
  | { type: 'abort' }
  | { type: 'danger_confirm_result'; requestId: string; choice: DangerConfirmResult }
  // MessageBus IPC 回复（主线程 → queryWorker）
  | { type: 'bus_publish_ack'; requestId: string }
  | { type: 'bus_subscribe_result'; requestId: string; message: BusMessage | null }
  | { type: 'bus_read_history_result'; requestId: string; messages: BusMessage[] }
  | { type: 'bus_get_offset_result'; requestId: string; offset: number }
  | { type: 'bus_list_channels_result'; requestId: string; channels: string[] }
  // spawn_subagent IPC 回复（主线程 → queryWorker）
  | { type: 'spawn_subagent_result'; requestId: string; result: string };

export type WorkerOutbound =
  | { type: 'message'; msg: Message }
  | { type: 'update_message'; id: string; updates: Partial<Message> }
  | { type: 'stream_text'; text: string }
  | { type: 'clear_stream_text' }
  | { type: 'loop_state'; state: LoopState }
  | { type: 'session_update'; session: Session }
  | { type: 'danger_confirm_request'; requestId: string; command: string; reason: string; ruleName: string }
  | { type: 'subagent_message'; msg: Message }
  | { type: 'subagent_update_message'; id: string; updates: Partial<Message> }
  // MessageBus IPC 请求（queryWorker → 主线程代理）
  | { type: 'bus_publish'; requestId: string; from: string; channel: string; payload: string }
  | { type: 'bus_subscribe'; requestId: string; channel: string; timeoutMs: number; fromOffset?: number }
  | { type: 'bus_read_history'; requestId: string; channel: string; limit?: number }
  | { type: 'bus_get_offset'; requestId: string; channel: string }
  | { type: 'bus_list_channels'; requestId: string }
  // spawn_subagent IPC 请求（queryWorker → 主线程，在主线程创建 SubAgentBridge）
  | { type: 'spawn_subagent'; requestId: string; taskId: string; instruction: string; agentLabel: string; allowedTools?: string[] }
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
    logWarn('query_worker.abort_received');
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

  // MessageBus IPC 回复分发 → 转发给 workerBusProxy 的 pending map
  if (
    msg.type === 'bus_publish_ack' ||
    msg.type === 'bus_subscribe_result' ||
    msg.type === 'bus_read_history_result' ||
    msg.type === 'bus_get_offset_result' ||
    msg.type === 'bus_list_channels_result'
  ) {
    const resolve = pendingBusRequests.get(msg.requestId);
    if (resolve) {
      pendingBusRequests.delete(msg.requestId);
      if (msg.type === 'bus_publish_ack') resolve(undefined);
      else if (msg.type === 'bus_subscribe_result') resolve(msg.message);
      else if (msg.type === 'bus_read_history_result') resolve(msg.messages);
      else if (msg.type === 'bus_get_offset_result') resolve(msg.offset);
      else if (msg.type === 'bus_list_channels_result') resolve(msg.channels);
    }
    return;
  }

  // spawn_subagent IPC 回复 → 转发给 pendingSpawnRequests
  if (msg.type === 'spawn_subagent_result') {
    const resolve = pendingSpawnRequests.get(msg.requestId);
    if (resolve) {
      pendingSpawnRequests.delete(msg.requestId);
      resolve(msg.result);
    }
    return;
  }

  if (msg.type === 'run') {
    abortSignal.aborted = false;
    logInfo('query_worker.run.start', {
      inputLength: msg.userInput.length,
      transcriptLength: msg.transcript.length,
    });

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
      onSubAgentMessage: (msg) => send({ type: 'subagent_message', msg }),
      onSubAgentUpdateMessage: (id, updates) => send({ type: 'subagent_update_message', id, updates }),
    };

    try {
      const newTranscript = await executeQuery(
        msg.userInput,
        msg.transcript,
        getAllTools(),
        service,
        callbacks,
        abortSignal,
        msg.options,
      );
      logInfo('query_worker.run.done', {
        transcriptLength: newTranscript.length,
      });
      send({ type: 'done', transcript: newTranscript });
    } catch (err: any) {
      logError('query_worker.run.failed', err);
      send({ type: 'error', message: err.message ?? '未知错误' });
    }
  }
});
