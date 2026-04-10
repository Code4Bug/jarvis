/**
 * busAccess — 统一的 MessageBus 访问入口
 *
 * 解决跨线程访问问题：
 *   - 主线程：直接使用 agentMessageBus 单例
 *   - SubAgent Worker 线程：使用 workerBusProxy（通过 IPC 代理到主线程）
 *
 * 工具层统一通过此模块访问，无需关心当前运行环境。
 */
import { isMainThread } from 'worker_threads';
import type { BusMessage } from './AgentMessageBus.js';

export interface BusAccessor {
  publish(from: string, channel: string, payload: string): Promise<void> | void;
  subscribe(channel: string, timeoutMs?: number, fromOffset?: number): Promise<BusMessage | null>;
  getHistory(channel: string, limit?: number): Promise<BusMessage[]> | BusMessage[];
  getOffset(channel: string): Promise<number> | number;
  listChannels(): Promise<string[]> | string[];
}

let _bus: BusAccessor | null = null;

export async function getBus(): Promise<BusAccessor> {
  if (_bus) return _bus;

  if (isMainThread) {
    // 主线程：直接使用单例
    const { agentMessageBus } = await import('./AgentMessageBus.js');
    _bus = {
      publish: (from, channel, payload) => { agentMessageBus.publish(from, channel, payload); },
      subscribe: (channel, timeoutMs, fromOffset) => agentMessageBus.subscribe(channel, timeoutMs, fromOffset),
      getHistory: (channel, limit) => agentMessageBus.getHistory(channel, limit),
      getOffset: (channel) => agentMessageBus.getOffset(channel),
      listChannels: () => agentMessageBus.listChannels(),
    };
  } else {
    // Worker 线程：使用独立的 IPC 代理模块（避免循环依赖）
    const { workerBusProxy } = await import('./workerBusProxy.js');
    _bus = workerBusProxy;
  }

  return _bus!;
}
