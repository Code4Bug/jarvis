/**
 * create_skill 工具
 *
 * 根据用户需求，调用 LLM 基于 SKILL_INSTRUCTIONS.md 规范自动生成 skill，
 * 并写入 ~/.jarvis/skills/ 目录。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Tool, TranscriptMessage } from '../types/index.js';
import { getExternalSkillsDir } from '../skills/loader.js';
import { reloadSkills } from '../skills/index.js';
import { LLMServiceImpl, getDefaultConfig } from '../services/api/llm.js';

// SKILL_INSTRUCTIONS.md 查找路径：项目根目录 > 用户主目录
function loadSkillInstructions(): string {
  const candidates = [
    path.join(process.cwd(), 'SKILL_INSTRUCTIONS.md'),
    path.join(os.homedir(), '.jarvis', 'SKILL_INSTRUCTIONS.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return '';
}

/**
 * 加载已有 skill 作为 LLM 参考示例
 * 从 ~/.jarvis/skills/ 和项目 skills/ 目录中读取
 */
function loadExampleSkills(): string {
  const examples: string[] = [];

  // 扫描项目内 skills/ 目录和 ~/.jarvis/skills/ 目录
  const dirs = [
    path.join(process.cwd(), 'skills'),
    getExternalSkillsDir(),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
        const skillPyPath = path.join(dir, entry.name, 'skill.py');
        if (!fs.existsSync(skillMdPath)) continue;

        const mdContent = fs.readFileSync(skillMdPath, 'utf-8').slice(0, 800);
        let example = `--- 示例 skill: ${entry.name} ---\n[SKILL.md]\n${mdContent}`;

        if (fs.existsSync(skillPyPath)) {
          const pyContent = fs.readFileSync(skillPyPath, 'utf-8').slice(0, 1200);
          example += `\n[skill.py]\n${pyContent}`;
        }

        examples.push(example);
        if (examples.length >= 2) break; // 最多取 2 个示例
      }
    } catch { /* ignore */ }
    if (examples.length >= 2) break;
  }

  if (examples.length === 0) return '';
  return '=== 已有 skill 参考示例（请参考其格式和风格） ===\n' + examples.join('\n\n');
}

/**
 * 确保 SKILL.md 的 frontmatter 中包含 description 字段
 * 如果缺失则自动补入
 */
function ensureFrontmatterDescription(skillMd: string, description: string): string {
  const fmMatch = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    // 没有 frontmatter，整个补上
    const fm = `---\ndescription: ${description}\n---\n\n`;
    return fm + skillMd;
  }

  const fmBody = fmMatch[1];
  // 检查是否已有 description 行（允许值为空的情况也算缺失）
  const descLine = fmBody.split('\n').find((l) => /^description\s*:/.test(l));
  if (descLine) {
    const val = descLine.replace(/^description\s*:\s*/, '').trim();
    if (val && val !== '""' && val !== "''") {
      // 已有有效 description，不修改
      return skillMd;
    }
    // description 值为空，替换
    return skillMd.replace(descLine, `description: ${description}`);
  }

  // frontmatter 中没有 description 行，在 name 行后插入
  const nameLine = fmBody.split('\n').find((l) => /^name\s*:/.test(l));
  if (nameLine) {
    return skillMd.replace(nameLine, `${nameLine}\ndescription: ${description}`);
  }

  // 兜底：在 frontmatter 末尾插入
  return skillMd.replace(/\n---/, `\ndescription: ${description}\n---`);
}

/**
 * 调用 LLM 生成 skill 内容
 *
 * 返回 JSON: { name, description, argument_hint?, skill_md, skill_py? }
 */
async function callLLMForSkill(requirement: string): Promise<{
  name: string;
  description: string;
  argument_hint?: string;
  skill_md: string;
  skill_py?: string;
}> {
  const instructions = loadSkillInstructions();

  // 加载已有 skill 作为参考示例
  const exampleSkills = loadExampleSkills();

  const systemPrompt = [
    '你是一个 Skill 生成专家。请严格按照以下规范为用户生成 Skill。',
    '',
    '=== Skill 编写规范 ===',
    instructions || '(规范文件未找到，请按通用 SKILL.md 格式生成)',
    '',
    '=== 语言要求 ===',
    '- 所有 description、注释、文档说明必须使用中文',
    '- name 字段使用英文小写+连字符',
    '- 代码中的变量名、函数名使用英文',
    '',
    '=== 输出要求 ===',
    '你必须返回一个合法的 JSON 对象，不要包含任何其他文字、解释或 markdown 代码块标记。',
    'JSON 结构如下:',
    '{',
    '  "name": "skill 名称，仅小写字母、数字、连字符",',
    '  "description": "中文简短描述，说明功能和触发场景",',
    '  "argument_hint": "参数提示，可选",',
    '  "skill_md": "完整的 SKILL.md 文件内容（包含 frontmatter 和正文）",',
    '  "skill_py": "如果 skill 需要可执行逻辑则必须提供完整 Python 代码"',
    '}',
    '',
    '=== 关键规则 ===',
    '1. skill_md 的 frontmatter 必须包含 name 和 description，description 必须是中文，不能为空',
    '2. skill_md 的 frontmatter 中如果 skill 接受参数，必须包含 argument-hint 字段（如 [message] [target]）',
    '3. 如果用户需求涉及任何可执行逻辑（API 调用、网络请求、数据处理、文件操作等），必须生成 skill_py',
    '4. skill_py 中的 TOOL_METADATA["parameters"] 必须是扁平字典结构，每个参数直接作为 key，格式如下:',
    '   "parameters": {',
    '       "query": {',
    '           "type": "string",',
    '           "description": "中文参数说明",',
    '           "required": True',
    '       },',
    '       "max_results": {',
    '           "type": "integer",',
    '           "description": "最大返回结果数",',
    '           "required": False',
    '       }',
    '   }',
    '   注意: required 使用 Python 的 True/False，不要用 JavaScript 的 true/false',
    '   注意: 不要嵌套 "properties" 或 "type": "object"，直接把参数名作为 key',
    '5. skill_py 中的函数名必须与 name 一致（连字符替换为下划线）',
    '6. skill_py 中的 TOOL_METADATA["description"] 也必须是中文',
    '7. JSON 输出中的字符串值如果包含换行，使用 \\n 转义',
    '8. 有副作用的操作（发消息、部署、写入外部系统）必须设置 disable-model-invocation: true',
    '9. JSON 输出中 argument_hint 字段必须与 skill_md frontmatter 中的 argument-hint 一致',
    '',
    exampleSkills,
  ].join('\n');

  // 收集 LLM 流式输出
  let result = '';

  const service = new LLMServiceImpl({
    ...getDefaultConfig(),
  });

  await new Promise<void>((resolve, reject) => {
    const callbacks = {
      onText: (text: string) => { result += text; },
      onToolUse: () => { /* 不期望工具调用 */ },
      onComplete: () => resolve(),
      onError: (err: Error) => reject(err),
    };

    const messagesWithContext: TranscriptMessage[] = [
      { role: 'user', content: `${systemPrompt}\n\n---\n\n用户需求: ${requirement}` },
    ];

    service.streamMessage(messagesWithContext, [], callbacks).catch(reject);
  });

  // 解析 JSON 结果
  // LLM 可能返回 ```json ... ``` 包裹的内容，需要提取
  let jsonStr = result.trim();
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.name || !parsed.skill_md) {
      throw new Error('LLM 返回的 JSON 缺少必要字段 (name, skill_md)');
    }
    if (!parsed.description) {
      throw new Error('LLM 返回的 JSON 缺少 description 字段');
    }

    // 确保 skill_md 的 frontmatter 中包含 description
    parsed.skill_md = ensureFrontmatterDescription(parsed.skill_md, parsed.description);

    return parsed;
  } catch (e: any) {
    if (e.message.startsWith('LLM 返回')) throw e;
    throw new Error(`解析 LLM 生成结果失败: ${e.message}\n\n原始输出:\n${result.slice(0, 500)}`);
  }
}

export const createSkill: Tool = {
  name: 'create_skill',
  description: '根据用户需求，调用大模型基于 SKILL_INSTRUCTIONS.md 规范自动生成 Skill 并写入 ~/.jarvis/skills/',
  parameters: {
    requirement: {
      type: 'string',
      description: '用户对 skill 的需求描述，例如"一个可以查询天气的工具"',
      required: true,
    },
  },
  execute: async (args) => {
    const requirement = (args.requirement as string || '').trim();
    if (!requirement) {
      throw new Error('缺少必填参数: requirement（skill 需求描述）');
    }

    // 1. 调用 LLM 生成 skill 内容
    const generated = await callLLMForSkill(requirement);

    // 2. 校验 name
    const name = generated.name;
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error(`LLM 生成的 skill 名称 "${name}" 不合法，仅允许小写字母、数字、连字符`);
    }
    if (name.length > 64) {
      throw new Error('LLM 生成的 skill 名称过长，最多 64 个字符');
    }

    const skillsDir = getExternalSkillsDir();
    const skillDir = path.join(skillsDir, name);

    // 3. 检查是否已存在
    if (fs.existsSync(skillDir)) {
      throw new Error(`Skill "${name}" 已存在: ${skillDir}`);
    }

    // 4. 创建目录并写入文件
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), generated.skill_md, 'utf-8');

    if (generated.skill_py) {
      fs.writeFileSync(path.join(skillDir, 'skill.py'), generated.skill_py, 'utf-8');
    }

    // 5. 刷新缓存
    reloadSkills();

    // 6. 返回结果
    const parts = [
      `Skill "${name}" 创建成功`,
      `  描述: ${generated.description}`,
      `  目录: ${skillDir}`,
      `  SKILL.md: 已生成`,
    ];
    if (generated.skill_py) {
      parts.push('  skill.py: 已生成');
    }
    if (generated.argument_hint) {
      parts.push(`  参数提示: ${generated.argument_hint}`);
    }
    parts.push('', '已刷新 skill 缓存，新 skill 立即可用。');
    parts.push('可通过 /skills 查看，或直接使用 /' + name + ' 调用。');

    return parts.join('\n');
  },
};
