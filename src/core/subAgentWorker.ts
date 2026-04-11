/**
 * SubAgent Worker 线程入口
 *
 * 每个 SubAgent 运行在独立线程中，拥有完整的 react_loop 能力。
 * 通过 parentPort 与主线程（SubAgentBridge）双向通信。
 *
 * 消息协议：
 *   主线程 → Worker：SubAgentInbound
 *   Worker → 主线程：SubAgentOutbound
 */
import { parentPort } from 'worker_threads';
import { executeQuery, QueryCallbacks, DangerConfirmResult } from './query.js';
import { getAllTools } from '../tools/index.js';
import { LLMServiceImpl, fromModelConfig } from '../services/api/llm.js';
import { MockService } from '../services/api/mock.js';
import { loadConfig, getActiveModel } from '../config/loader.js';
import { TranscriptMessage, Message, LoopState, SubAgentTask } from '../types/index.js';
import { BusMessage } from './AgentMessageBus.js';
import { pendingBusRequests } from './workerBusProxy.js';
import { logError, logInfo, logWarn } from './logger.js';

if (!parentPort) throw new Error('subAgentWorker must run inside worker_threads');
logInfo('subagent_worker.ready');

// ===== 消息类型定义 =====

export type SubAgentInbound =
  | { type: 'run'; task: SubAgentTask }
  | { type: 'abort' }
  | { type: 'danger_confirm_result'; requestId: string; choice: DangerConfirmResult }
  // MessageBus IPC 回复
  | { type: 'bus_publish_ack'; requestId: string }
  | { type: 'bus_subscribe_result'; requestId: string; message: BusMessage | null }
  | { type: 'bus_read_history_result'; requestId: string; messages: BusMessage[] }
  | { type: 'bus_get_offset_result'; requestId: string; offset: number }
  | { type: 'bus_list_channels_result'; requestId: string; channels: string[] };

export type SubAgentOutbound =
  | { type: 'message'; taskId: string; msg: Message }
  | { type: 'update_message'; taskId: string; id: string; updates: Partial<Message> }
  | { type: 'stream_text'; taskId: string; text: string }
  | { type: 'loop_state'; taskId: string; state: LoopState }
  | { type: 'danger_confirm_request'; taskId: string; requestId: string; command: string; reason: string; ruleName: string }
  // MessageBus IPC 请求（Worker → 主线程代理）
  | { type: 'bus_publish'; requestId: string; from: string; channel: string; payload: string }
  | { type: 'bus_subscribe'; requestId: string; channel: string; timeoutMs: number; fromOffset?: number }
  | { type: 'bus_read_history'; requestId: string; channel: string; limit?: number }
  | { type: 'bus_get_offset'; requestId: string; channel: string }
  | { type: 'bus_list_channels'; requestId: string }
  | { type: 'done'; taskId: string; transcript: TranscriptMessage[] }
  | { type: 'error'; taskId: string; message: string };

// ===== 初始化 LLM 服务 =====
const config = loadConfig();
const activeModel = getActiveModel(config);

function buildSubAgentService(role?: string, customSystemPrompt?: string) {
  const systemPrompt = customSystemPrompt
    ?? (role
      ? `${role}\n\n你是一个专注的子任务执行助手。请严格按照任务指令完成工作，输出结构化结果。`
      : '你是一个专注的子任务执行助手。请严格按照任务指令完成工作，输出结构化结果。');

  if (activeModel) {
    try {
      return new LLMServiceImpl({ ...fromModelConfig(activeModel), systemPrompt });
    } catch {
      return new MockService();
    }
  }
  return new MockService();
}

// ===== 中断信号 =====
const abortSignal = { aborted: false };

// ===== 危险命令确认：挂起 Promise，等待主线程回复 =====
const pendingConfirms = new Map<string, (choice: DangerConfirmResult) => void>();

// ===== 监听主线程消息 =====
parentPort.on('message', async (msg: SubAgentInbound) => {
  if (msg.type === 'abort') {
    abortSignal.aborted = true;
    logWarn('subagent_worker.abort_received');
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

  if (msg.type === 'run') {
    abortSignal.aborted = false;
    const { task } = msg;
    const { taskId, instruction, allowedTools, contextTranscript, role, systemPrompt } = task;
    logInfo('subagent_worker.run.start', {
      taskId,
      inputLength: instruction.length,
      allowedTools,
      transcriptLength: contextTranscript?.length ?? 0,
    });

    const send = (out: SubAgentOutbound) => parentPort!.postMessage(out);

    const service = buildSubAgentService(role, systemPrompt);

    const tools = getAllTools().filter((t) =>
      !allowedTools || allowedTools.length === 0 || allowedTools.includes(t.name),
    );

    const callbacks: QueryCallbacks = {
      onMessage: (m) => send({ type: 'message', taskId, msg: m }),
      onUpdateMessage: (id, updates) => send({ type: 'update_message', taskId, id, updates }),
      onStreamText: (text) => send({ type: 'stream_text', taskId, text }),
      onClearStreamText: () => {},
      onLoopStateChange: (state) => send({ type: 'loop_state', taskId, state }),
      onConfirmDangerousCommand: (command, reason, ruleName) => {
        return new Promise<DangerConfirmResult>((resolve) => {
          const requestId = `${Date.now()}-${Math.random()}`;
          pendingConfirms.set(requestId, resolve);
          send({ type: 'danger_confirm_request', taskId, requestId, command, reason, ruleName });
        });
      },
    };

    try {
      const newTranscript = await executeQuery(
        instruction,
        contextTranscript ?? [],
        tools,
        service,
        callbacks,
        abortSignal,
      );
      logInfo('subagent_worker.run.done', {
        taskId,
        transcriptLength: newTranscript.length,
      });
      send({ type: 'done', taskId, transcript: newTranscript });
    } catch (err: any) {
      logError('subagent_worker.run.failed', err, { taskId });
      send({ type: 'error', taskId, message: err.message ?? '未知错误' });
    }
  }
});
