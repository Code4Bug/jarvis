/**
 * AgentMessageBus — SubAgent 间通讯总线（进程内单例）
 *
 * 提供发布/订阅机制，允许：
 *   - SubAgent 向命名频道发布消息
 *   - SubAgent 订阅频道，等待其他 Agent 发布的消息
 *   - 主 Agent 观察所有频道历史
 *
 * 线程安全说明：
 *   Node.js Worker 线程之间不共享内存，因此 MessageBus 运行在
 *   主线程（queryWorker）中，SubAgent Worker 通过 IPC 消息与其交互。
 *   SubAgentBridge 负责在主线程侧代理 publish/subscribe 请求。
 */
import { logInfo } from './logger.js';

export interface BusMessage {
  /** 发布者 Agent 标识 */
  from: string;
  /** 频道名 */
  channel: string;
  /** 消息内容 */
  payload: string;
  /** 发布时间戳 */
  timestamp: number;
}

type SubscribeCallback = (msg: BusMessage) => void;

class AgentMessageBus {
  /** 频道历史消息，key = channel */
  private history = new Map<string, BusMessage[]>();
  /** 订阅者，key = channel，value = 等待中的 resolve 列表 */
  private waiters = new Map<string, Array<{ resolve: SubscribeCallback; once: boolean }>>();

  /**
   * 向频道发布消息
   * @param from 发布者标识（agentId / taskId）
   * @param channel 频道名
   * @param payload 消息内容
   */
  publish(from: string, channel: string, payload: string): void {
    const msg: BusMessage = { from, channel, payload, timestamp: Date.now() };
    logInfo('bus.publish', {
      from,
      channel,
      payloadLength: payload.length,
    });

    // 存入历史
    if (!this.history.has(channel)) this.history.set(channel, []);
    this.history.get(channel)!.push(msg);

    // 通知等待中的订阅者
    const waiters = this.waiters.get(channel);
    if (waiters && waiters.length > 0) {
      const toNotify = [...waiters];
      // 移除 once 订阅者
      this.waiters.set(channel, waiters.filter((w) => !w.once));
      for (const w of toNotify) {
        w.resolve(msg);
      }
    }
  }

  /**
   * 订阅频道，返回下一条消息（Promise）
   * - 若 fromOffset 指定，且历史中该 offset 之后已有消息，立即返回（不阻塞）
   * - 否则阻塞等待新消息到达
   * @param channel 频道名
   * @param timeoutMs 超时毫秒，默认 30s，超时返回 null
   * @param fromOffset 从第几条开始消费（0-based），不传则只等新消息
   */
  subscribe(channel: string, timeoutMs = 30_000, fromOffset?: number): Promise<BusMessage | null> {
    logInfo('bus.subscribe', {
      channel,
      timeoutMs,
      fromOffset,
    });
    // 如果指定了 offset 且历史中已有该位置之后的消息，立即返回
    if (fromOffset !== undefined) {
      const history = this.history.get(channel) ?? [];
      if (fromOffset < history.length) {
        logInfo('bus.subscribe.hit_history', {
          channel,
          fromOffset,
        });
        return Promise.resolve(history[fromOffset]);
      }
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // 超时：从等待列表移除
        const list = this.waiters.get(channel);
        if (list) {
          this.waiters.set(channel, list.filter((w) => w.resolve !== (resolve as any)));
        }
        logInfo('bus.subscribe.timeout', { channel, timeoutMs, fromOffset });
        resolve(null);
      }, timeoutMs);

      const wrappedResolve: SubscribeCallback = (msg) => {
        clearTimeout(timer);
        logInfo('bus.subscribe.received', {
          channel,
          fromOffset,
          from: msg.from,
        });
        resolve(msg);
      };

      if (!this.waiters.has(channel)) this.waiters.set(channel, []);
      this.waiters.get(channel)!.push({ resolve: wrappedResolve, once: true });
    });
  }

  /**
   * 获取频道当前消息总数（用于记录 offset）
   */
  getOffset(channel: string): number {
    return (this.history.get(channel) ?? []).length;
  }

  /**
   * 读取频道历史消息（不阻塞）
   * @param channel 频道名
   * @param limit 最多返回条数，默认全部
   */
  getHistory(channel: string, limit?: number): BusMessage[] {
    const msgs = this.history.get(channel) ?? [];
    return limit ? msgs.slice(-limit) : [...msgs];
  }

  /** 列出所有活跃频道 */
  listChannels(): string[] {
    return [...this.history.keys()];
  }

  /** 清空指定频道（测试用） */
  clearChannel(channel: string): void {
    this.history.delete(channel);
    this.waiters.delete(channel);
  }

  /** 清空所有频道 */
  clearAll(): void {
    this.history.clear();
    this.waiters.clear();
  }
}

// 进程内单例
export const agentMessageBus = new AgentMessageBus();
