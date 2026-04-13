import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { loadConfig, getActiveModel } from './loader.js';
import { getAgent } from '../agents/index.js';
import { getActiveAgent } from './agentState.js';

/** 从 package.json 动态读取版本号 */
function resolveAppVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return `v${pkg.version}`;
  } catch {
    return 'v0.0.0';
  }
}

/** 应用全局常量 */
export const APP_VERSION = resolveAppVersion();
export const PROJECT_NAME = path.basename(process.cwd());

/** Agentic Loop 最大迭代次数 */
export const MAX_ITERATIONS = 50;

/** 会话存储目录（~/.jarvis/sessions/） */
export const JARVIS_HOME_DIR = path.join(os.homedir(), '.jarvis');
export const SESSIONS_DIR = path.join(JARVIS_HOME_DIR, 'sessions');
export const LOGS_DIR = path.join(JARVIS_HOME_DIR, 'logs');

/** 输入后是否隐藏 WelcomeHeader，默认 false（不隐藏） */
export const HIDE_WELCOME_AFTER_INPUT = false;

/** 从配置文件获取当前模型名称 */
export function getModelName(): string {
  try {
    const config = loadConfig();
    const active = getActiveModel(config);
    return active?.model ?? config.system.model ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 是否支持思考/非思考模式切换，默认 false（隐藏该功能） */
export function isThinkingModeToggleEnabled(): boolean {
  try {
    return loadConfig().system.enable_thinking_mode_toggle ?? false;
  } catch {
    return false;
  }
}

/** 上下文 token 上限 */
export function getContextTokenLimit(): number {
  try {
    return loadConfig().system.context_token_limit ?? 18000;
  } catch {
    return 18000;
  }
}

// ===== 智能体默认配置 =====

/** 默认智能体名称（硬编码兜底值） */
export const DEFAULT_AGENT_FALLBACK = 'Jarvis';

/** 智能体定义文件目录（相对项目根目录） */
export const AGENTS_DIR = 'src/agents';

/** 智能体默认配色 */
export const DEFAULT_AGENT_COLOR = 'green';

/** 智能体默认标识符 */
export const DEFAULT_AGENT_EMOJI = '>';

// ===== 动态应用名称（跟随激活智能体） =====

/** 当前激活的智能体名称 — 启动时从 ~/.jarvis/agent.json 读取，运行时可切换 */
export function getDefaultAgent(): string {
  return getActiveAgent(DEFAULT_AGENT_FALLBACK);
}

export function getAppName(): string {
  try {
    const agent = getAgent(getDefaultAgent());
    return agent?.meta.name ?? 'Jarvis';
  } catch {
    return 'Jarvis';
  }
}

/** 启动欢迎词，跟随当前激活智能体与本机用户名 */
export function getStartupWelcomeMessage(): string {
  const agentName = getAppName();
  const userName = os.userInfo().username || '朋友';
  const templates = [
    `${agentName}：欢迎你，${userName}。我已经准备好了，输入 /help 查看命令，输入 ? 查看快捷键。`,
    `${agentName}：你好，${userName}。今天想先处理什么？输入 /help 看命令，输入 ? 看快捷键。`,
    `${agentName}：${userName}，欢迎回来。需要我继续当前工作，还是开启一个新任务？`,
    `${agentName}：已就绪，${userName}。你可以直接描述需求，也可以先用 /help 或 ? 看可用操作。`,
    `${agentName}：见到你了，${userName}。命令在 /help，快捷键在 ?，我们可以直接开始。`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}
