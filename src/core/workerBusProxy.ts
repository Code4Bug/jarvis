/**
 * workerBusProxy — Worker 线程侧 MessageBus IPC 代理
 *
 * 在 SubAgent Worker 线程中，通过 parentPort 消息将 bus 操作
 * 转发给主线程（SubAgentBridge）代理执行，绕过线程内存隔离。
 *
 * 此文件独立于 subAgentWorker.ts，避免循环依赖。
 * subAgentWorker.ts 负责注册 pendingBusRequests 的回复分发。
 */
import { parentPort } from 'worker_threads';
import type { BusMessage } from './AgentMessageBus.js';

/** 等待中的 bus 请求，key = requestId */
export const pendingBusRequests = new Map<string, (result: any) => void>();

function requestId(): string {
  return `bus-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function send(msg: object): void {
  if (!parentPort) throw new Error('workerBusProxy: 不在 Worker 线程中');
  parentPort.postMessage(msg);
}

export const workerBusProxy = {
  publish(from: string, channel: string, payload: string): Promise<void> {
    return new Promise((resolve) => {
      const reqId = requestId();
      pendingBusRequests.set(reqId, () => resolve());
      send({ type: 'bus_publish', requestId: reqId, from, channel, payload });
    });
  },

  subscribe(channel: string, timeoutMs = 30_000, fromOffset?: number): Promise<BusMessage | null> {
    return new Promise((resolve) => {
      const reqId = requestId();
      pendingBusRequests.set(reqId, (msg) => resolve(msg));
      send({ type: 'bus_subscribe', requestId: reqId, channel, timeoutMs, fromOffset });
    });
  },

  getHistory(channel: string, limit?: number): Promise<BusMessage[]> {
    return new Promise((resolve) => {
      const reqId = requestId();
      pendingBusRequests.set(reqId, (msgs) => resolve(msgs));
      send({ type: 'bus_read_history', requestId: reqId, channel, limit });
    });
  },

  getOffset(channel: string): Promise<number> {
    return new Promise((resolve) => {
      const reqId = requestId();
      pendingBusRequests.set(reqId, (offset: number) => resolve(offset));
      send({ type: 'bus_get_offset', requestId: reqId, channel });
    });
  },

  listChannels(): Promise<string[]> {
    return new Promise((resolve) => {
      const reqId = requestId();
      pendingBusRequests.set(reqId, (channels) => resolve(channels));
      send({ type: 'bus_list_channels', requestId: reqId });
    });
  },
};
