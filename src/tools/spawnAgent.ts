/**
 * spawn_agent 工具
 *
 * 异步启动一个 SubAgent（不阻塞主 Agent），子 Agent 在后台独立运行。
 * 主 Agent 可通过 send_to_agent 工具向其发送消息，子 Agent 通过
 * subscribe_message 订阅自己的 inbox 频道（agent-inbox:{task_id}）接收。
 *
 * 重要：SubAgentBridge 必须在主线程创建，才能访问共享的 agentMessageBus 单例。
 * 因此本工具通过 IPC（parentPort）将 spawn 请求委托给主线程（WorkerBridge）执行。
 */
import { v4 as uuid } from 'uuid';
import { isMainThread, parentPort } from 'worker_threads';
import { Tool } from '../types/index.js';
import { SubAgentBridge } from '../core/SubAgentBridge.js';
import { agentUIBus } from '../core/AgentRegistry.js';
import { agentMessageBus } from '../core/AgentMessageBus.js';
import { getBus } from '../core/busAccess.js';
import { pendingSpawnRequests, incrementActiveAgents, decrementActiveAgents } from '../core/spawnRegistry.js';
import { logError, logInfo } from '../core/logger.js';

/** 运行中的 task_id 集合（主线程侧，防止重复启动） */
const runningAgents = new Set<string>();

function resolveAgentLabel(taskId: string, role?: string): string {
  if (role) {
    const match = role.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g);
    if (match && match.length > 0) {
      return `${match.slice(0, 2).join('').slice(0, 8)}Agent`;
    }
  }
  return `SubAgent-${taskId.slice(0, 8)}`;
}

/**
 * 在主线程侧直接启动 SubAgent（供 WorkerBridge 调用）
 */
export function spawnSubAgentInMainThread(
  taskId: string,
  instruction: string,
  agentLabel: string,
  allowedTools?: string[],
): string {
  if (runningAgents.has(taskId)) {
    logInfo('spawn_agent.duplicate', { taskId, agentLabel });
    return `子 Agent [${taskId}] 已在运行中，请使用 send_to_agent 向其发送消息，或使用不同的 task_id 启动新实例。`;
  }

  const replyChannel = `agent-reply:${taskId}`;
  const bridge = new SubAgentBridge();
  runningAgents.add(taskId);
  incrementActiveAgents();
  logInfo('spawn_agent.started', {
    taskId,
    agentLabel,
    allowedTools,
  });

  bridge.run(
    { taskId, instruction, allowedTools },
    {
      onMessage: (_tid, msg) => {
        const tagged = { ...msg, subAgentId: agentLabel };
        agentUIBus.push(tagged);
      },
      onUpdateMessage: (_tid, id, updates) => {
        agentUIBus.update(id, updates);
      },
      onStreamText: () => {},
      onLoopStateChange: () => {},
      onConfirmDangerousCommand: async () => 'cancel',
    },
  ).then((result) => {
    runningAgents.delete(taskId);
    decrementActiveAgents();
    logInfo('spawn_agent.done', {
      taskId,
      agentLabel,
      status: result.status,
      outputLength: result.output.length,
    });
    agentMessageBus.publish(taskId, replyChannel, `[AGENT_DONE] ${result.output || '子 Agent 已完成'}`);
  }).catch((err) => {
    runningAgents.delete(taskId);
    decrementActiveAgents();
    logError('spawn_agent.failed', err, {
      taskId,
      agentLabel,
    });
    agentMessageBus.publish(taskId, replyChannel, `[AGENT_ERROR] ${err.message}`);
  });

  const inboxChannel = `agent-inbox:${taskId}`;
  return [
    `子 Agent 已在后台启动`,
    `task_id: ${taskId}`,
    `角色标签: ${agentLabel}`,
    `收件箱频道: ${inboxChannel}`,
    `回复频道: ${replyChannel}`,
    ``,
    `使用 send_to_agent 向其发送消息，使用 subscribe_message 订阅 "${replyChannel}" 等待回复。`,
  ].join('\n');
}

export const spawnAgent: Tool = {
  name: 'spawn_agent',
  description: [
    '异步启动一个 SubAgent，立即返回 task_id，子 Agent 在后台独立运行。',
    '与 run_agent 的区别：',
    '  - run_agent：阻塞等待子 Agent 完成后返回结果（适合一次性子任务）',
    '  - spawn_agent：立即返回，主 Agent 可继续执行，通过消息总线与子 Agent 双向通信（适合多轮对话）',
    '',
    '子 Agent 通信约定：',
    '  - 主 Agent → 子 Agent：使用 send_to_agent 工具，或向 "agent-inbox:{task_id}" 频道 publish',
    '  - 子 Agent → 主 Agent：子 Agent 向 "agent-reply:{task_id}" 频道 publish，主 Agent 用 subscribe_message 接收',
    '  - 子 Agent 的 instruction 中应包含订阅自己 inbox 的指令，例如：',
    '    "每次回复前先调用 subscribe_message 订阅频道 agent-inbox:{task_id} 获取新问题"',
    '',
    '查看后台 Agent 状态：使用 read_channel 工具查看 "agent-reply:{task_id}" 频道历史。',
  ].join('\n'),
  parameters: {
    instruction: {
      type: 'string',
      description: [
        '发给子 Agent 的初始指令。',
        '若需要多轮交互，指令中应告知子 Agent：',
        '  1. 订阅频道 "agent-inbox:{task_id}" 等待主 Agent 的消息',
        '  2. 处理后将回复发布到 "agent-reply:{task_id}" 频道',
        '  3. 循环执行直到收到结束信号',
      ].join('\n'),
      required: true,
    },
    role: {
      type: 'string',
      description: '可选。子 Agent 的角色描述，例如"你是一个好奇的物理学学生"',
      required: false,
    },
    task_id: {
      type: 'string',
      description: '可选。任务唯一标识，建议使用语义化名称如 "student-agent"。不填则自动生成',
      required: false,
    },
    allowed_tools: {
      type: 'string',
      description: '可选。逗号分隔的工具名列表，限制子 Agent 可用工具。为空则继承全部工具',
      required: false,
    },
  },

  execute: async (args) => {
    const instruction = (args.instruction as string || '').trim();
    if (!instruction) throw new Error('缺少必填参数: instruction');

    const role = (args.role as string || '').trim() || undefined;
    const taskId = (args.task_id as string || '').trim() || uuid();
    const allowedToolsRaw = (args.allowed_tools as string || '').trim();
    const allowedTools = allowedToolsRaw
      ? allowedToolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const agentLabel = resolveAgentLabel(taskId, role);
    const inboxChannel = `agent-inbox:${taskId}`;
    const replyChannel = `agent-reply:${taskId}`;

    // 获取当前 inbox offset（通过 bus 代理，确保跨线程正确）
    const bus = await getBus();
    const currentOffset = await bus.getOffset(inboxChannel);

    const fullInstruction = [
      role ? `[角色设定] ${role}` : '',
      '',
      '[通信约定]',
      `- 你的收件箱频道：${inboxChannel}`,
      `- 订阅时必须传入 from_offset: "${currentOffset}"，确保不错过已发布的消息`,
      `- 你的回复频道：${replyChannel}（用 publish_message 发送回复，agent_id 填 "${taskId}"）`,
      '',
      '[任务]',
      instruction,
    ].filter((l, i) => i !== 0 || l).join('\n').trim();

    // 若在主线程（直接调用场景），直接启动
    if (isMainThread) {
      return spawnSubAgentInMainThread(taskId, fullInstruction, agentLabel, allowedTools);
    }

    // 在 Worker 线程中：通过 IPC 委托主线程创建 SubAgentBridge
    // SubAgentBridge 必须在主线程运行，才能访问共享的 agentMessageBus 单例
    if (!parentPort) throw new Error('spawn_agent: 无法访问 parentPort');

    const requestId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise<string>((resolve) => {
      pendingSpawnRequests.set(requestId, resolve);
      parentPort!.postMessage({
        type: 'spawn_subagent',
        requestId,
        taskId,
        instruction: fullInstruction,
        agentLabel,
        allowedTools,
      });
    });
  },
};
