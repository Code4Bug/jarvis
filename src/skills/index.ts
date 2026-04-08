/**
 * Skill 注册中心
 *
 * 负责：
 *   1. 启动时扫描 ~/.jarvis/skills/ 加载外部 skill
 *   2. 将 skill 转换为 Tool 格式，与系统内置 tools 合并
 *   3. 提供统一的工具查找接口
 *
 * 如果 skill 目录下存在 skill.py，execute 时直接调用 Python 脚本获取真实结果；
 * 否则回退为返回 skill 指令文本（由 LLM 解释执行）。
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index.js';
import { SkillDefinition, scanExternalSkills, getExternalSkillsDir } from './loader.js';
import { allTools as builtinTools } from '../tools/index.js';

// ===== 缓存 =====

let _skillCache: SkillDefinition[] | null = null;
let _mergedTools: Tool[] | null = null;

// ===== Skill → Tool 转换 =====

/**
 * 从 skill.py 的 TOOL_METADATA 中提取参数定义
 */
function buildParamsFromScript(scriptPath: string, skill: SkillDefinition): Tool['parameters'] {
  try {
    const content = fs.readFileSync(scriptPath, 'utf-8');
    const metaStart = content.indexOf('TOOL_METADATA');
    if (metaStart === -1) throw new Error('no metadata');
    const metaSection = content.slice(metaStart);
    const paramsStart = metaSection.indexOf('"parameters"');
    if (paramsStart === -1) throw new Error('no parameters');

    // 跳过 "parameters": { 本身，从其内部开始匹配参数
    const afterParamsKey = metaSection.slice(paramsStart + '"parameters"'.length);
    const braceIdx = afterParamsKey.indexOf('{');
    if (braceIdx === -1) throw new Error('no parameters brace');
    const paramsBody = afterParamsKey.slice(braceIdx + 1);

    // 如果是嵌套的 JSON Schema 格式（含 "properties"），跳到 properties 内部
    let paramsSection = paramsBody;
    const propsIdx = paramsBody.indexOf('"properties"');
    if (propsIdx !== -1) {
      const afterProps = paramsBody.slice(propsIdx + '"properties"'.length);
      const propsBrace = afterProps.indexOf('{');
      if (propsBrace !== -1) {
        paramsSection = afterProps.slice(propsBrace + 1);
      }
    }

    const paramRegex = /"(\w+)"\s*:\s*\{[^}]*"type"/g;
    const paramNames: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = paramRegex.exec(paramsSection)) !== null) {
      paramNames.push(match[1]);
    }
    if (paramNames.length === 0) throw new Error('no params found');

    const params: Tool['parameters'] = {};
    for (const name of paramNames) {
      const descMatch = paramsSection.match(new RegExp(`"${name}"[^}]*"description"\\s*:\\s*"([^"]*)"`));
      const reqMatch = paramsSection.match(new RegExp(`"${name}"[^}]*"required"\\s*:\\s*(true|false)`));
      params[name] = {
        type: 'string',
        description: descMatch ? descMatch[1] : name,
        required: reqMatch ? reqMatch[1] === 'true' : false,
      };
    }
    return params;
  } catch {
    return {
      arguments: {
        type: 'string',
        description: skill.meta.argumentHint
          ? `参数: ${skill.meta.argumentHint}`
          : '传递给 skill 的 JSON 参数（可选）',
        required: false,
      },
    };
  }
}

/**
 * 执行 Python skill 脚本，返回真实结果
 *
 * 通过写入临时 .py 文件再执行，避免 shell 转义问题。
 */
async function executeSkillScript(
  scriptPath: string,
  skill: SkillDefinition,
  args: Record<string, unknown>,
): Promise<string> {
  const funcName = skill.meta.name.replace(/-/g, '_');
  const kwargs: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    if (key === 'arguments') {
      // 兼容旧的 arguments 字符串模式
      try {
        const parsed = JSON.parse(value as string);
        for (const [k, v] of Object.entries(parsed)) {
          kwargs.push(`${k}=${JSON.stringify(v)}`);
        }
      } catch {
        if (value) kwargs.push(`query=${JSON.stringify(value)}`);
      }
    } else {
      // 跳过不属于函数签名的参数名（如 LLM 传了 "parameters"），映射为 query
      const paramKey = key === 'parameters' ? 'query' : key;
      kwargs.push(`${paramKey}=${JSON.stringify(value)}`);
    }
  }

  // 写入临时 Python 文件，避免 shell -c 的转义问题
  const tmpFile = path.join(skill.dirPath, `_tmp_run_${Date.now()}.py`);
  const pyCode = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(path.dirname(scriptPath))})`,
    `from skill import ${funcName}`,
    `result = ${funcName}(${kwargs.join(', ')})`,
    'print(json.dumps(result, ensure_ascii=False, indent=2))',
  ].join('\n');

  try {
    fs.writeFileSync(tmpFile, pyCode, 'utf-8');
    const output = execSync(`python3 ${JSON.stringify(tmpFile)}`, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
      cwd: skill.dirPath,
    });
    return output.trim() || '(skill 执行完成，无输出)';
  } catch (e: any) {
    const parts: string[] = [];
    if (e.stderr) parts.push(String(e.stderr).trim());
    if (e.stdout) parts.push(String(e.stdout).trim());
    if (parts.length === 0) parts.push(e.message);
    return `[Skill ${skill.meta.name} 执行失败]\n${parts.join('\n')}`;
  } finally {
    // 清理临时文件
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

/**
 * 回退模式：返回 skill 指令文本（无 Python 脚本时）
 */
async function executeSkillPrompt(
  skill: SkillDefinition,
  args: Record<string, unknown>,
): Promise<string> {
  let instruction = skill.instruction;
  const rawArgs = (args.arguments as string) || '';
  const argParts = rawArgs.split(/\s+/).filter(Boolean);

  instruction = instruction.replace(/\$ARGUMENTS/g, rawArgs);
  for (let i = 0; i < argParts.length; i++) {
    instruction = instruction.replace(new RegExp(`\\$ARGUMENTS\\[${i}\\]`, 'g'), argParts[i]);
    instruction = instruction.replace(new RegExp(`\\${i}\\b`, 'g'), argParts[i]);
  }

  if (rawArgs && !skill.instruction.includes('$ARGUMENTS') && !skill.instruction.match(/\$\d/)) {
    instruction += `\n\n参数: ${rawArgs}`;
  }

  return `[Skill: ${skill.meta.name}]\n\n${instruction}`;
}

/**
 * 将 SkillDefinition 转换为 Tool
 */
function skillToTool(skill: SkillDefinition): Tool {
  const toolName = `skill_${skill.meta.name}`;
  const scriptPath = path.join(skill.dirPath, 'skill.py');
  const hasScript = fs.existsSync(scriptPath);

  const parameters: Tool['parameters'] = hasScript
    ? buildParamsFromScript(scriptPath, skill)
    : {
        arguments: {
          type: 'string',
          description: skill.meta.argumentHint
            ? `参数: ${skill.meta.argumentHint}`
            : '传递给 skill 的参数（可选）',
          required: false,
        },
      };

  return {
    name: toolName,
    description: `[Skill] ${skill.meta.description || skill.meta.name}`,
    parameters,
    execute: hasScript
      ? async (args) => executeSkillScript(scriptPath, skill, args)
      : async (args) => executeSkillPrompt(skill, args),
  };
}

// ===== 公开接口 =====

/** 加载所有外部 skills（带缓存） */
export function loadExternalSkills(): SkillDefinition[] {
  if (_skillCache) return _skillCache;
  _skillCache = scanExternalSkills();
  console.log(`[skills] 已加载 ${_skillCache.length} 个外部 skill (${getExternalSkillsDir()})`);
  return _skillCache;
}

/** 获取合并后的所有工具：内置 tools + 外部 skills */
export function getMergedTools(): Tool[] {
  if (_mergedTools) return _mergedTools;

  const skills = loadExternalSkills();
  const skillTools = skills
    .filter((s) => s.meta.userInvocable !== false)
    .map(skillToTool);

  _mergedTools = [...builtinTools, ...skillTools];
  return _mergedTools;
}

/** 从合并工具列表中按名称查找 */
export function findMergedTool(name: string): Tool | undefined {
  return getMergedTools().find((t) => t.name === name);
}

/** 获取已加载的 skill 列表（用于斜杠命令等） */
export function listSkills(): SkillDefinition[] {
  return loadExternalSkills();
}

/** 清除缓存，强制下次重新扫描 */
export function reloadSkills(): void {
  _skillCache = null;
  _mergedTools = null;
}
