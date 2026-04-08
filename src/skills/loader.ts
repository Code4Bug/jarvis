/**
 * 外部 Skill 加载器
 *
 * 扫描 ~/.jarvis/skills/ 目录，解析每个子目录中的 SKILL.md，
 * 提取 frontmatter 元数据和正文指令。
 *
 * Skill 目录结构：
 *   ~/.jarvis/skills/<skill-name>/SKILL.md
 *   ~/.jarvis/skills/<skill-name>/reference.md  (可选)
 *   ~/.jarvis/skills/<skill-name>/scripts/       (可选)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ===== Skill 类型定义 =====

export interface SkillMeta {
  /** skill 名称，省略时用目录名；只允许小写字母、数字、连字符 */
  name: string;
  /** 描述：说明 skill 做什么、什么时候用 */
  description: string;
  /** 参数提示，例如 [issue-number] */
  argumentHint?: string;
  /** 禁止模型自动触发，仅用户手动 /name 调用 */
  disableModelInvocation?: boolean;
  /** 从 / 菜单隐藏，用户不能直接调 */
  userInvocable?: boolean;
  /** 允许使用的工具列表 */
  allowedTools?: string;
  /** 推理强度 */
  effort?: 'low' | 'medium' | 'high' | 'max';
  /** 其他自定义字段 */
  [key: string]: unknown;
}

export interface SkillDefinition {
  /** frontmatter 元数据 */
  meta: SkillMeta;
  /** markdown 正文，作为 skill 指令 */
  instruction: string;
  /** skill 目录路径 */
  dirPath: string;
  /** SKILL.md 文件路径 */
  filePath: string;
}

// ===== 常量 =====

const JARVIS_DIR = '.jarvis';
const SKILLS_DIR = 'skills';
const SKILL_FILENAME = 'SKILL.md';

/** 外部 skills 根目录：~/.jarvis/skills/ */
export function getExternalSkillsDir(): string {
  return path.join(os.homedir(), JARVIS_DIR, SKILLS_DIR);
}

// ===== frontmatter 解析 =====

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

// ===== 加载单个 Skill =====

function loadSkillDir(dirPath: string, dirName: string): SkillDefinition | null {
  const filePath = path.join(dirPath, SKILL_FILENAME);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontMatter(raw);

    // name 默认用目录名
    const name = meta.name || dirName;

    // 校验 name 格式：只允许小写字母、数字、连字符
    if (!/^[a-z0-9-]+$/.test(name)) {
      console.warn(`[skills] 跳过非法 name "${name}"（仅允许小写字母、数字、连字符）: ${filePath}`);
      return null;
    }

    if (name.length > 64) {
      console.warn(`[skills] 跳过过长 name "${name}"（最长 64 字符）: ${filePath}`);
      return null;
    }

    const skillMeta: SkillMeta = {
      name,
      description: meta.description || '',
      argumentHint: meta['argument-hint'] || undefined,
      disableModelInvocation: meta['disable-model-invocation'] === 'true',
      userInvocable: meta['user-invocable'] !== 'false', // 默认 true
      allowedTools: meta['allowed-tools'] || undefined,
      effort: (['low', 'medium', 'high', 'max'].includes(meta.effort) ? meta.effort : undefined) as SkillMeta['effort'],
    };

    return {
      meta: skillMeta,
      instruction: body,
      dirPath,
      filePath,
    };
  } catch (err) {
    console.error(`[skills] 加载失败: ${filePath}`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ===== 扫描所有外部 Skills =====

/** 扫描 ~/.jarvis/skills/ 下所有子目录，加载 SKILL.md */
export function scanExternalSkills(): SkillDefinition[] {
  const skillsDir = getExternalSkillsDir();

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const results: SkillDefinition[] = [];

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkillDir(path.join(skillsDir, entry.name), entry.name);
      if (skill) {
        results.push(skill);
      }
    }
  } catch (err) {
    console.error('[skills] 扫描外部 skills 目录失败:', err instanceof Error ? err.message : err);
  }

  return results;
}

/** 按名称获取单个 skill */
export function getSkill(name: string, skills: SkillDefinition[]): SkillDefinition | undefined {
  return skills.find((s) => s.meta.name === name);
}
