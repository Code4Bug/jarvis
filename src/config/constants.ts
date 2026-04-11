import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
import os from 'os';
export const JARVIS_HOME_DIR = path.join(os.homedir(), '.jarvis');
export const SESSIONS_DIR = path.join(JARVIS_HOME_DIR, 'sessions');
export const LOGS_DIR = path.join(JARVIS_HOME_DIR, 'logs');

/** 输入后是否隐藏 WelcomeHeader，默认 false（不隐藏） */
export const HIDE_WELCOME_AFTER_INPUT = false;

/** 从配置文件获取当前模型名称 */
import { loadConfig, getActiveModel } from './loader.js';

const _cfg = loadConfig();

function resolveModelName(): string {
  try {
    const active = getActiveModel(_cfg);
    return active?.model ?? _cfg.system.model ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const MODEL_NAME = resolveModelName();

/** 是否支持思考/非思考模式切换，默认 false（隐藏该功能） */
export const ENABLE_THINKING_MODE_TOGGLE = _cfg.system.enable_thinking_mode_toggle ?? false;

/** 上下文 token 上限 */
export const CONTEXT_TOKEN_LIMIT = _cfg.system.context_token_limit ?? 18000;

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

import { getAgent } from '../agents/index.js';
import { getActiveAgent } from './agentState.js';

/** 当前激活的智能体名称 — 启动时从 ~/.jarvis/agent.json 读取，运行时可切换 */
export const DEFAULT_AGENT = getActiveAgent(DEFAULT_AGENT_FALLBACK);

function resolveAppName(): string {
  try {
    const agent = getAgent(DEFAULT_AGENT);
    return agent?.meta.name ?? 'Jarvis';
  } catch {
    return 'Jarvis';
  }
}

/** 应用名称 — 取自当前激活智能体的 name */
export const APP_NAME = resolveAppName();
