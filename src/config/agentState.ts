/**
 * 智能体选择状态管理
 *
 * 持久化当前激活的智能体到 ~/.jarvis/agent.json
 * 启动时自动读取，运行时可动态切换。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const JARVIS_HOME = path.join(os.homedir(), '.jarvis');
const AGENT_STATE_FILE = path.join(JARVIS_HOME, 'agent.json');

interface AgentState {
  /** 当前激活的智能体名称（与 agents/*.md 中的 name 对应，不区分大小写） */
  activeAgent: string;
}

/** 运行时当前激活的智能体名称 */
let _currentAgent: string | null = null;

/** 确保 ~/.jarvis 目录存在 */
function ensureDir() {
  if (!fs.existsSync(JARVIS_HOME)) {
    fs.mkdirSync(JARVIS_HOME, { recursive: true });
  }
}

/** 从 ~/.jarvis/agent.json 读取持久化的智能体选择 */
function loadPersistedAgent(): string | null {
  try {
    if (!fs.existsSync(AGENT_STATE_FILE)) return null;
    const raw = fs.readFileSync(AGENT_STATE_FILE, 'utf-8');
    const state = JSON.parse(raw) as AgentState;
    return state.activeAgent || null;
  } catch {
    return null;
  }
}

/** 持久化智能体选择到 ~/.jarvis/agent.json */
function persistAgent(name: string) {
  try {
    ensureDir();
    const state: AgentState = { activeAgent: name };
    fs.writeFileSync(AGENT_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[agentState] 持久化失败:', err instanceof Error ? err.message : err);
  }
}

/**
 * 获取当前激活的智能体名称
 *
 * 优先级：运行时设置 > 持久化文件 > fallback
 */
export function getActiveAgent(fallback: string): string {
  if (_currentAgent) return _currentAgent;

  const persisted = loadPersistedAgent();
  if (persisted) {
    _currentAgent = persisted;
    return persisted;
  }

  return fallback;
}

/**
 * 切换当前激活的智能体（运行时 + 持久化）
 */
export function setActiveAgent(name: string) {
  _currentAgent = name;
  persistAgent(name);
}
