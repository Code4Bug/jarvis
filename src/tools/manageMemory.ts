import { Tool } from '../types/index.js';
import {
  MEMORY_FILE_PATH,
  appendPersistentMemory,
  readPersistentMemory,
  replacePersistentMemory,
  ensureMemoryFile,
} from '../config/memory.js';

export const manageMemory: Tool = {
  name: 'manage_memory',
  description: [
    '管理智能体长期记忆文件 ~/.jarvis/MEMORY.md。',
    '可读取、追加、覆盖记忆，也可返回记忆文件路径。',
    '适合沉淀可复用的经验、技能、偏好、约束和稳定环境事实。',
  ].join('\n'),
  parameters: {
    action: {
      type: 'string',
      description: '操作类型：read | append | replace | path',
      required: true,
    },
    content: {
      type: 'string',
      description: 'append 或 replace 时要写入的 Markdown 内容',
      required: false,
    },
  },
  execute: async (args) => {
    const action = String(args.action || '').trim();
    ensureMemoryFile();

    if (action === 'path') {
      return MEMORY_FILE_PATH;
    }

    if (action === 'read') {
      return readPersistentMemory() || '(MEMORY.md 为空)';
    }

    if (action === 'append') {
      const content = String(args.content || '').trim();
      if (!content) throw new Error('append 操作需要提供 content');
      appendPersistentMemory(content);
      return `长期记忆已追加到 ${MEMORY_FILE_PATH}`;
    }

    if (action === 'replace') {
      const content = String(args.content || '').trim();
      if (!content) throw new Error('replace 操作需要提供 content');
      replacePersistentMemory(content);
      return `长期记忆已覆盖写入 ${MEMORY_FILE_PATH}`;
    }

    throw new Error(`不支持的 action: ${action}`);
  },
};
