/**
 * publish_message 工具
 *
 * 允许 SubAgent（或主 Agent）向命名频道发布消息，
 * 其他正在订阅该频道的 Agent 会立即收到通知。
 */
import { Tool } from '../types/index.js';
import { getBus } from '../core/busAccess.js';

export const publishMessage: Tool = {
  name: 'publish_message',
  description: [
    '向指定频道发布一条消息，供其他 SubAgent 或主 Agent 订阅接收。',
    '适用场景：',
    '  - SubAgent 完成阶段性任务后，将中间结果广播给协作的其他 SubAgent',
    '  - 多 Agent 流水线中，上游 Agent 通知下游 Agent 开始处理',
    '  - Agent 间共享数据，无需等待主 Agent 中转',
    '注意：消息会保留在频道历史中，可通过 read_channel 工具查看。',
  ].join('\n'),
  parameters: {
    channel: {
      type: 'string',
      description: '频道名称，建议使用语义化命名，如 "research-result" / "code-review-done"',
      required: true,
    },
    payload: {
      type: 'string',
      description: '消息内容，可以是纯文本、JSON 字符串或任意结构化数据',
      required: true,
    },
    agent_id: {
      type: 'string',
      description: '可选。发布者标识，默认为 "unknown"。建议填入当前 Agent 的 taskId 或角色名',
      required: false,
    },
  },

  execute: async (args) => {
    const channel = (args.channel as string || '').trim();
    const payload = (args.payload as string || '').trim();
    const agentId = (args.agent_id as string || 'unknown').trim();

    if (!channel) throw new Error('缺少必填参数: channel');
    if (!payload) throw new Error('缺少必填参数: payload');

    const bus = await getBus();
    await bus.publish(agentId, channel, payload);

    return `已向频道 "${channel}" 发布消息（来自: ${agentId}）`;
  },
};
