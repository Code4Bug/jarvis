/**
 * read_channel 工具
 *
 * 读取频道历史消息（非阻塞），支持查看所有活跃频道列表。
 * 主 Agent 可用此工具汇总所有 SubAgent 的通讯记录。
 */
import { Tool } from '../types/index.js';
import { getBus } from '../core/busAccess.js';

export const readChannel: Tool = {
  name: 'read_channel',
  description: [
    '读取指定频道的历史消息，或列出所有活跃频道。非阻塞，立即返回。',
    '适用场景：',
    '  - 主 Agent 汇总所有 SubAgent 的通讯结果',
    '  - 查看某个频道的完整消息历史',
    '  - 调试多 Agent 协作流程',
  ].join('\n'),
  parameters: {
    channel: {
      type: 'string',
      description: '频道名称。若填 "*" 则列出所有活跃频道名称',
      required: true,
    },
    limit: {
      type: 'string',
      description: '可选。最多返回最近 N 条消息，默认返回全部',
      required: false,
    },
  },

  execute: async (args) => {
    const channel = (args.channel as string || '').trim();
    if (!channel) throw new Error('缺少必填参数: channel');

    const bus = await getBus();

    if (channel === '*') {
      const channels = await bus.listChannels() as string[];
      if (channels.length === 0) return '当前没有活跃频道';
      return `活跃频道列表（${channels.length} 个）:\n${channels.map((c) => `  - ${c}`).join('\n')}`;
    }

    const limit = args.limit ? parseInt(args.limit as string, 10) : undefined;
    const msgs = await bus.getHistory(channel, limit) as any[];

    if (msgs.length === 0) return `频道 "${channel}" 暂无消息`;

    const lines = msgs.map((msg, i) => {
      const time = new Date(msg.timestamp).toISOString();
      return `[${i + 1}] [来自: ${msg.from}] [${time}]\n${msg.payload}`;
    });

    return `频道 "${channel}" 共 ${msgs.length} 条消息:\n\n${lines.join('\n\n---\n\n')}`;
  },
};
