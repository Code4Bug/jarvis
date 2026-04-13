import { Message } from '../types/index.js';
import { executeInit } from '../commands/init.js';
import { APP_VERSION } from '../config/constants.js';
import { allTools } from '../tools/index.js';
import { listSkills } from '../skills/index.js';
import { getExternalSkillsDir } from '../skills/loader.js';
import { loadAllAgents } from '../agents/index.js';
import {
  listPermanentAuthorizations,
  DANGER_RULES,
} from '../core/safeguard.js';

/**
 * 斜杠命令执行器
 *
 * 纯函数，返回要追加的系统消息。不涉及 React 状态。
 */
export async function executeSlashCommand(cmdName: string): Promise<Message | null> {
  switch (cmdName) {
    case 'init': {
      const result = await executeInit();
      return {
        id: `init-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: result.displayText,
        timestamp: Date.now(),
      };
    }

    case 'help': {
      const helpText = [
        '可用命令:',
        '  /init        初始化项目信息，生成 JARVIS.md',
        '  /about       查看 Jarvis 的详细特性、功能与信息',
        '  /new         开启新会话，重新初始化上下文',
        '  /exit        退出应用程序',
        '  /quit        退出应用程序',
        '  /bye         退出应用程序',
        '  /resume      恢复历史会话（支持二级菜单选择）',
        '  /resume <ID> 直接恢复指定会话',
        '  /rewind      回退当前会话到指定提问位置',
        '  /help        显示此帮助信息',
        '  /session_clear 清理所有非当前会话的历史记录',
        '  /skills      查看当前所有 tools 和 skills',
        '  /permissions 查看所有持久化授权列表',
        '  /create_skill <描述> 根据需求创建新 skill',
        '  /agent <名称> 切换智能体（需重启生效）',
        '  /read <路径>  读取文件内容',
        '  /write <路径> 写入文件',
        '  /bash <命令>  执行 Bash 命令',
        '  /ls <路径>    列出目录',
        '  /search <词>  搜索文件内容',
        '  /version     显示当前版本号',
        '',
        '快捷键:',
        '  Ctrl+L       清屏重置',
        '  Ctrl+O       切换详情显示',
        '  ESC          中断推理 / 双击清空输入',
        '  Ctrl+C ×2    退出',
      ].join('\n');
      return {
        id: `help-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: helpText,
        timestamp: Date.now(),
      };
    }

    case 'about': {
      const skills = listSkills();
      const agents = Array.from(loadAllAgents().values());
      const parts: string[] = [
        'Jarvis 详细信息',
        '',
        `- 版本：${APP_VERSION}`,
        '- 定位：运行在终端里的轻量级 AI Agent，面向代码、命令行与多步骤任务协作',
        '- 技术栈：React + TypeScript + Ink',
        '',
        '核心能力:',
        '- Agentic Loop：可连续推理、调用工具、读取结果并继续决策',
        '- 流式终端交互：在终端里实时展示回复、状态与工具执行过程',
        '- 文件与目录操作：支持读写文件、列目录、搜索内容、语义检索',
        '- 命令执行：通过 Bash 工具执行命令，并统一经过安全围栏',
        '- 多智能体协作：支持同步子 Agent、后台子 Agent 与消息总线通信',
        '- 外部扩展：支持从 ~/.jarvis/skills/ 动态加载外部 Skill',
        '- 会话与记忆：支持会话持久化、摘要、Token 统计与长期记忆',
        '',
        '当前实例概况:',
        `- 内置工具：${allTools.length} 个`,
        `- 外部 Skills：${skills.length} 个`,
        `- 可切换 Agents：${agents.length} 个`,
        '',
        '内置工具:',
        ...allTools.map((tool, index) => `  ${index + 1}. ${tool.name} - ${tool.description.split('\n')[0]}`),
        '',
        '可切换 Agents:',
        ...agents.map((agent, index) => `  ${index + 1}. ${agent.meta.name} - ${agent.meta.description}`),
        '',
        '安全与交互:',
        '- 危险命令会被安全围栏识别，并支持交互式确认与持久化授权',
        '- 支持斜杠菜单、历史会话恢复、会话回退与快捷键操作',
        '- 支持多个只读工具并行执行，提高响应效率',
        '',
        '常用入口:',
        '- /help：查看所有斜杠命令',
        '- /skills：查看当前 tools 和 skills',
        '- /permissions：查看持久化授权列表',
        '- /version：查看当前版本号',
      ];

      if (skills.length > 0) {
        parts.push('');
        parts.push('已加载 Skills:');
        skills.forEach((skill, index) => {
          parts.push(`  ${index + 1}. ${skill.meta.name} - ${skill.meta.description}`);
        });
      }

      return {
        id: `about-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: parts.join('\n'),
        timestamp: Date.now(),
      };
    }

    case 'permissions': {
      const perms = listPermanentAuthorizations();
      const lines: string[] = ['持久化授权列表 (~/.jarvis/.permissions.json)', ''];
      if (perms.rules.length > 0) {
        lines.push('按规则授权:');
        for (const r of perms.rules) {
          const rule = DANGER_RULES.find((d) => d.name === r);
          lines.push(`  [v] ${r}${rule ? ` — ${rule.reason}` : ''}`);
        }
        lines.push('');
      }
      if (perms.commands.length > 0) {
        lines.push('按命令授权:');
        for (const c of perms.commands) {
          lines.push(`  [v] [${c.ruleName}] ${c.command} (${c.grantedAt})`);
        }
        lines.push('');
      }
      if (perms.rules.length === 0 && perms.commands.length === 0) {
        lines.push('(空) 暂无持久化授权记录');
      }
      return {
        id: `perms-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
    }

    case 'skills': {
      const skills = listSkills();
      const parts: string[] = [];

      parts.push('### Built-in Tools\n');
      allTools.forEach((t, i) => {
        const summary = t.description.split('\n')[0].slice(0, 80);
        parts.push(`${i + 1}. \`${t.name}\` - ${summary}`);
      });

      parts.push('');
      parts.push(`### External Skills\n`);
      parts.push(`> ${getExternalSkillsDir()}\n`);

      if (skills.length === 0) {
        parts.push('_(empty)_');
      } else {
        skills.forEach((s, i) => {
          const hint = s.meta.argumentHint ? ` \`${s.meta.argumentHint}\`` : '';
          const flags: string[] = [];
          if (s.meta.disableModelInvocation) flags.push('manual-only');
          if (s.meta.userInvocable === false) flags.push('hidden');
          const flagStr = flags.length > 0 ? ` _(${flags.join(', ')})_` : '';
          parts.push(`${i + 1}. \`${s.meta.name}\`${hint} - ${s.meta.description}${flagStr}`);
        });
      }

      parts.push('');
      parts.push(`**Total:** ${allTools.length} tools + ${skills.length} skills = ${allTools.length + skills.length}`);

      return {
        id: `skills-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: parts.join('\n'),
        timestamp: Date.now(),
      };
    }

    case 'version': {
      return {
        id: `version-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: `当前版本: ${APP_VERSION}`,
        timestamp: Date.now(),
      };
    }

    default:
      return null;
  }
}
