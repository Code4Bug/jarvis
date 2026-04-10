/**
 * run_agent 工具
 *
 * 允许主 Agent 在独立 Worker 线程中创建并运行一个 SubAgent，
 * SubAgent 拥有完整的 react_loop 能力，可自主调用工具完成子任务。
 *
 * 主 Agent 调用此工具后会阻塞等待 SubAgent 完成，并返回其最终输出。
 * 若需并行执行多个子任务，主 Agent 可在同一轮中多次调用此工具（并行工具调用）。
 */

import { v4 as uuid } from 'uuid';
import { Tool, Message } from '../types/index.js';
import { SubAgentBridge } from '../core/SubAgentBridge.js';

/** 将 task_id / role 转换为可读的 Agent 标签，例如 "ResearchAgent" */
function resolveAgentLabel(taskId: string, role?: string): string {
  if (role) {
    // 从角色描述中提取关键词，例如 "你是一个代码审查助手" → "代码审查Agent"
    const match = role.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g);
    if (match && match.length > 0) {
      // 取前两个词拼接，最长 8 个字符
      const label = match.slice(0, 2).join('').slice(0, 8);
      return `${label}Agent`;
    }
  }
  // 回退：用 taskId 前 8 位
  return `SubAgent-${taskId.slice(0, 8)}`;
}

export const runAgent: Tool = {
  name: 'run_agent',
  description: [
    '在独立线程中同步运行一个 SubAgent，阻塞等待其完成后返回最终结果。',
    '适用场景：',
    '  - 将复杂任务拆解为多个独立子任务并行执行',
    '  - 需要隔离执行上下文的子任务（如沙箱式文件操作）',
    '  - 多角色协同：为不同子任务指定不同的角色和工具权限',
    '注意：SubAgent 与主 Agent 共享文件系统，但拥有独立的对话上下文。',
  ].join('\n'),
  parameters: {
    instruction: {
      type: 'string',
      description: '发给 SubAgent 的任务指令，应清晰描述目标、输入和期望输出格式',
      required: true,
    },
    role: {
      type: 'string',
      description: '可选。SubAgent 的角色描述，用于约束其行为，例如"你是一个专注于代码审查的助手"',
      required: false,
    },
    allowed_tools: {
      type: 'string',
      description: '可选。逗号分隔的工具名列表，限制 SubAgent 可用的工具范围，例如 "read_file,search_files"。为空则继承全部工具',
      required: false,
    },
    task_id: {
      type: 'string',
      description: '可选。任务唯一标识，用于在并行场景中区分多个 SubAgent。不填则自动生成',
      required: false,
    },
  },

  execute: async (args, _abortSignal, toolCallbacks) => {
    const instruction = (args.instruction as string || '').trim();
    if (!instruction) {
      throw new Error('缺少必填参数: instruction（SubAgent 任务指令）');
    }

    const role = (args.role as string || '').trim() || undefined;
    const taskId = (args.task_id as string || '').trim() || uuid();

    // 解析 allowed_tools
    const allowedToolsRaw = (args.allowed_tools as string || '').trim();
    const allowedTools = allowedToolsRaw
      ? allowedToolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    // 构造任务指令：若指定了 role，将其注入到 instruction 前缀
    const fullInstruction = role
      ? `[角色设定] ${role}\n\n[任务]\n${instruction}`
      : instruction;

    // 生成 UI 展示用的 Agent 标签，例如 "代码审查Agent"
    const agentLabel = resolveAgentLabel(taskId, role);

    const bridge = new SubAgentBridge();

    const result = await bridge.run(
      {
        taskId,
        instruction: fullInstruction,
        allowedTools,
      },
      {
        // 将 SubAgent 消息注入 subAgentId 后推送到主线程 UI
        onMessage: (_tid, msg) => {
          const tagged: Message = { ...msg, subAgentId: agentLabel };
          toolCallbacks?.onSubAgentMessage?.(tagged);
        },
        onUpdateMessage: (_tid, id, updates) => {
          toolCallbacks?.onSubAgentUpdateMessage?.(id, updates);
        },
        onStreamText: () => {},
        onLoopStateChange: () => {},
        // 危险命令确认：SubAgent 默认取消，避免无人值守时阻塞
        onConfirmDangerousCommand: async () => 'cancel',
      },
    );

    if (result.status === 'error') {
      throw new Error(`SubAgent [${taskId}] 执行失败: ${result.error}`);
    }

    if (result.status === 'aborted') {
      return `SubAgent [${taskId}] 已中断，部分结果：\n${result.output || '（无输出）'}`;
    }

    // 构造返回给主 Agent 的摘要
    const lines: string[] = [
      `SubAgent [${taskId}] 执行完成`,
      `执行步骤数: ${result.messages.length}`,
      '',
      '=== 最终输出 ===',
      result.output || '（SubAgent 未产生文本输出）',
    ];

    return lines.join('\n');
  },
};
