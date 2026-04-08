/**
 * 智能体定义加载器
 *
 * 从 src/agents/*.md 加载 markdown 格式的智能体定义，
 * 解析 front-matter 元数据和正文作为 system prompt。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ===== 智能体类型 =====

export interface AgentMeta {
  name: string;
  description: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  [key: string]: unknown;
}

export interface AgentDefinition {
  /** front-matter 元数据 */
  meta: AgentMeta;
  /** markdown 正文，作为 system prompt */
  systemPrompt: string;
  /** 源文件路径 */
  filePath: string;
}

// ===== front-matter 解析 =====

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    meta[key] = val;
  }

  return { meta, body: match[2].trim() };
}

// ===== 加载单个智能体 =====

function loadAgentFile(filePath: string): AgentDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontMatter(raw);

    if (!meta.name) {
      console.warn(`[agents] 跳过缺少 name 的智能体文件: ${filePath}`);
      return null;
    }

    return {
      meta: meta as unknown as AgentMeta,
      systemPrompt: body,
      filePath,
    };
  } catch (err) {
    console.error(`[agents] 加载失败: ${filePath}`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ===== 加载所有智能体 =====

let _cache: Map<string, AgentDefinition> | null = null;

/** 获取 agents 目录路径 */
function getAgentsDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return __dirname; // 编译后 agents/*.md 需要复制到 dist/agents/
}

/** 扫描并加载所有 .md 智能体定义，结果缓存 */
export function loadAllAgents(): Map<string, AgentDefinition> {
  if (_cache) return _cache;

  _cache = new Map();
  const dir = getAgentsDir();

  if (!fs.existsSync(dir)) return _cache;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const agent = loadAgentFile(path.join(dir, file));
    if (agent) {
      _cache.set(agent.meta.name.toLowerCase(), agent);
    }
  }

  return _cache;
}

/** 按名称获取智能体定义（不区分大小写） */
export function getAgent(name: string): AgentDefinition | null {
  const agents = loadAllAgents();
  return agents.get(name.toLowerCase()) ?? null;
}

/** 获取所有已加载智能体名称列表 */
export function listAgents(): string[] {
  const agents = loadAllAgents();
  return Array.from(agents.values()).map((a) => a.meta.name);
}

/** 清除缓存，强制下次重新加载 */
export function reloadAgents(): void {
  _cache = null;
}

// ===== 默认导出 =====

export const DEFAULT_AGENT_NAME = 'jarvis';
