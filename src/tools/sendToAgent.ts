/**
 * send_to_agent 工具
 *
 * 主 Agent 向指定后台子 Agent 发送消息。
 * 本质是向 "agent-inbox:{task_id}" 频道 publish，
 * 子 Agent 通过 subscribe_message 订阅该频道接收。
 *
 * 配合 spawn_agent 使用，实现主 Agent ↔ 子 Agent 的多轮对话。
 */
import { Tool } from '../types/index.js';
import { getBus } from '../core/busAccess.js';

export const sendToAgent: Tool = {
  name: 'send_to_agent',
  description: [
    '向指定后台子 Agent 发送一条消息，子 Agent 会从其收件箱频道接收。',
    '前提：子 Agent 必须已通过 spawn_agent 启动，且在其 instruction 中包含订阅收件箱的逻辑。',
    '',
    '消息流向：主 Agent → agent-inbox:{task_id} → 子 Agent',
    '等待回复：使用 subscribe_message 订阅 "agent-reply:{task_id}" 频道。',
  ].join('\n'),
  parameters: {
    task_id: {
      type: 'string',
      description: '目标子 Agent 的 task_id（由 spawn_agent 返回）',
      required: true,
    },
    message: {
      type: 'string',
      description: '要发送给子 Agent 的消息内容',
      required: true,
    },
  },

  execute: async (args) => {
    const taskId = (args.task_id as string || '').trim();
    const message = (args.message as string || '').trim();

    if (!taskId) throw new Error('缺少必填参数: task_id');
    if (!message) throw new Error('缺少必填参数: message');

    const inboxChannel = `agent-inbox:${taskId}`;
    const bus = await getBus();
    await bus.publish('main-agent', inboxChannel, message);

    return `消息已发送至子 Agent [${taskId}]\n频道: ${inboxChannel}\n内容: ${message}`;
  },
};
