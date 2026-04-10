/**
 * subscribe_message 工具
 *
 * 允许 SubAgent 订阅指定频道，阻塞等待下一条消息到达。
 * 若频道已有历史消息且 read_latest=true，则立即返回最新一条，不阻塞。
 */
import { Tool } from '../types/index.js';
import { getBus } from '../core/busAccess.js';

export const subscribeMessage: Tool = {
  name: 'subscribe_message',
  description: [
    '订阅指定频道，等待其他 Agent 发布消息后返回内容。',
    '适用场景：',
    '  - SubAgent B 等待 SubAgent A 完成并发布结果后再继续执行',
    '  - 实现 Agent 间的同步协调（生产者-消费者模式）',
    '  - 读取频道最新历史消息（设置 read_latest=true 时不阻塞）',
    '注意：默认超时 30 秒，超时后返回 null，Agent 应处理超时情况。',
  ].join('\n'),
  parameters: {
    channel: {
      type: 'string',
      description: '要订阅的频道名称',
      required: true,
    },
    read_latest: {
      type: 'string',
      description: '可选。设为 "true" 时，若频道已有历史消息则立即返回最新一条，不阻塞等待。默认 false',
      required: false,
    },
    from_offset: {
      type: 'string',
      description: '可选。从指定位置（0-based）开始消费。若该位置已有消息则立即返回，否则阻塞等待。用于避免错过在订阅前已发布的消息',
      required: false,
    },
    timeout_seconds: {
      type: 'string',
      description: '可选。等待超时秒数，默认 30 秒。超时返回空结果',
      required: false,
    },
  },

  execute: async (args) => {
    const channel = (args.channel as string || '').trim();
    if (!channel) throw new Error('缺少必填参数: channel');

    const readLatest = (args.read_latest as string || '').toLowerCase() === 'true';
    const timeoutSec = parseInt(args.timeout_seconds as string || '30', 10);
    const timeoutMs = Math.max(1000, Math.min(timeoutSec * 1000, 300_000));
    const fromOffsetRaw = (args.from_offset as string || '').trim();
    const fromOffset = fromOffsetRaw !== '' ? parseInt(fromOffsetRaw, 10) : undefined;

    const bus = await getBus();

    if (readLatest) {
      const history = await bus.getHistory(channel, 1) as any[];
      if (history.length === 0) return `频道 "${channel}" 暂无历史消息`;
      return formatMessage(history[0]);
    }

    const msg = await bus.subscribe(channel, timeoutMs, fromOffset);
    if (!msg) return `订阅频道 "${channel}" 超时（${timeoutSec}s），未收到消息`;

    return formatMessage(msg);
  },
};

function formatMessage(msg: { from: string; channel: string; payload: string; timestamp: number }): string {
  const time = new Date(msg.timestamp).toISOString();
  return `[频道: ${msg.channel}] [来自: ${msg.from}] [时间: ${time}]\n${msg.payload}`;
}
