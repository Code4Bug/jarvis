/**
 * / 斜杠命令注册表
 *
 * 一级菜单：内置 + 工具 + /agent 入口
 * 二级菜单：/agent 下的具体智能体列表
 */

export interface SlashCommand {
  /** 命令名称（不含 /） */
  name: string;
  /** 简短描述 */
  description: string;
  /** 命令类别 */
  category: 'agent' | 'tool' | 'builtin';
  /** 回车行为：直接执行 / 弹出列表 / 作为上下文提交 */
  submitMode: 'action' | 'list' | 'context';
}

/** 内置命令 */
const builtinCommands: SlashCommand[] = [
  { name: 'init', description: '初始化项目信息，生成 JARVIS.md', category: 'builtin', submitMode: 'action' },
  { name: 'new', description: '开启新会话，重新初始化上下文', category: 'builtin', submitMode: 'action' },
  { name: 'resume', description: '恢复历史会话上下文', category: 'builtin', submitMode: 'list' },
  { name: 'help', description: '显示帮助信息', category: 'builtin', submitMode: 'action' },
  { name: 'agent', description: '切换智能体', category: 'builtin', submitMode: 'list' },
  { name: 'permissions', description: '查看所有持久化授权列表', category: 'builtin', submitMode: 'action' },
  { name: 'skills', description: '查看当前所有 tools 和 skills', category: 'builtin', submitMode: 'action' },
  { name: 'session_clear', description: '清理所有非当前会话的历史记录', category: 'builtin', submitMode: 'action' },
  { name: 'version', description: '显示当前版本号', category: 'builtin', submitMode: 'action' },
];

/** 工具命令 */
const toolCommands: SlashCommand[] = [
  { name: 'read', description: '读取指定文件内容', category: 'tool', submitMode: 'context' },
  { name: 'write', description: '写入内容到文件', category: 'tool', submitMode: 'context' },
  { name: 'bash', description: '执行 Bash 命令', category: 'tool', submitMode: 'context' },
  { name: 'ls', description: '列出目录文件', category: 'tool', submitMode: 'context' },
  { name: 'search', description: '搜索文件内容', category: 'tool', submitMode: 'context' },
  { name: 'create_skill', description: '创建新的 Skill 到 ~/.jarvis/skills/', category: 'builtin', submitMode: 'context' },
];

/** 智能体子命令：从 agents 目录动态加载（二级菜单） */
import { loadAllAgents } from '../agents/index.js';
import { listSkills } from '../skills/index.js';

let _agentSubCommands: SlashCommand[] | null = null;

export function getAgentSubCommands(): SlashCommand[] {
  if (_agentSubCommands) return _agentSubCommands;
  const agents = loadAllAgents();
  const cmds: SlashCommand[] = [];
  for (const [, agent] of agents) {
    cmds.push({
      name: agent.meta.name.toLowerCase(),
      description: agent.meta.description,
      category: 'agent',
      submitMode: 'action',
    });
  }
  _agentSubCommands = cmds;
  return cmds;
}

/** 一级命令列表 */
let _topCommands: SlashCommand[] | null = null;

function getTopCommands(): SlashCommand[] {
  if (_topCommands) return _topCommands;

  // 动态生成 skill 命令
  const skills = listSkills();
  const skillCommands: SlashCommand[] = skills
    .filter((s) => s.meta.userInvocable !== false)
    .map((s) => ({
      name: s.meta.name,
      description: `[Skill] ${s.meta.description || s.meta.name}`,
      category: 'tool' as const,
      submitMode: 'context' as const,
    }));

  _topCommands = [...builtinCommands, ...toolCommands, ...skillCommands];
  return _topCommands;
}

/** 根据前缀过滤一级命令 */
export function filterCommands(query: string): SlashCommand[] {
  const all = getTopCommands();
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter(
    (cmd) => cmd.name.includes(q) || cmd.description.includes(q),
  );
}

/** 根据前缀过滤智能体子命令 */
export function filterAgentCommands(query: string): SlashCommand[] {
  const all = getAgentSubCommands();
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter(
    (cmd) => cmd.name.includes(q) || cmd.description.includes(q),
  );
}
