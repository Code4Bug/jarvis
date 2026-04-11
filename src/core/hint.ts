/**
 * 智能提示生成器
 *
 * 根据当前激活的智能体角色 + 项目上下文，调用 LLM 生成一条
 * 符合角色设定且贴合当前项目的输入提示信息。
 */

import fs from 'fs';
import path from 'path';
import { getAgent } from '../agents/index.js';
import { getDefaultAgent } from '../config/constants.js';
import { loadConfig, getActiveModel } from '../config/loader.js';
import { getDefaultConfig } from '../services/api/llm.js';

// ===== 项目上下文采集 =====

interface ProjectContext {
  /** 项目名称 */
  projectName: string;
  /** 项目描述 */
  description: string;
  /** 检测到的技术栈标签，如 ["TypeScript", "React", "Node.js"] */
  techStack: string[];
  /** 顶层目录结构摘要 */
  topLevelStructure: string;
  /** 是否有数据库相关文件 */
  hasDatabase: boolean;
  /** 是否有财务/金融相关文件 */
  hasFinance: boolean;
}

/** 安全读取 JSON 文件 */
function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 采集顶层目录结构（只取第一层，排除 node_modules / .git 等） */
function getTopLevelStructure(cwd: string): string {
  const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.sessions', '__pycache__', '.venv', 'venv']);
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    const items = entries
      .filter((e) => !IGNORE.has(e.name))
      .slice(0, 20) // 最多 20 条
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return items.join(', ');
  } catch {
    return '';
  }
}

/** 检测技术栈 */
function detectTechStack(cwd: string): string[] {
  const tags: string[] = [];
  const exists = (f: string) => fs.existsSync(path.join(cwd, f));

  // JavaScript / TypeScript 生态
  if (exists('package.json')) {
    tags.push('Node.js');
    const pkg = readJsonSafe(path.join(cwd, 'package.json'));
    const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    if (allDeps?.react) tags.push('React');
    if (allDeps?.vue) tags.push('Vue');
    if (allDeps?.next) tags.push('Next.js');
    if (allDeps?.express) tags.push('Express');
    if (allDeps?.nestjs || allDeps?.['@nestjs/core']) tags.push('NestJS');
  }
  if (exists('tsconfig.json')) tags.push('TypeScript');

  // Python 生态
  if (exists('requirements.txt') || exists('pyproject.toml') || exists('setup.py')) {
    tags.push('Python');
    if (exists('manage.py')) tags.push('Django');
    if (exists('app.py') || exists('wsgi.py')) tags.push('Flask');
  }

  // Java 生态
  if (exists('pom.xml')) tags.push('Java', 'Maven');
  if (exists('build.gradle') || exists('build.gradle.kts')) tags.push('Java', 'Gradle');

  // Go
  if (exists('go.mod')) tags.push('Go');

  // Rust
  if (exists('Cargo.toml')) tags.push('Rust');

  // Docker / DevOps
  if (exists('Dockerfile') || exists('docker-compose.yml') || exists('docker-compose.yaml')) tags.push('Docker');
  if (exists('.github/workflows')) tags.push('GitHub Actions');

  return [...new Set(tags)];
}

/** 检测是否包含数据库相关内容 */
function detectDatabase(cwd: string): boolean {
  const markers = [
    'prisma', 'migrations', 'schema.prisma',
    'knexfile.js', 'knexfile.ts', 'ormconfig.ts', 'ormconfig.json',
    'sequelize.config.js', 'database.yml', 'db',
    'sql', 'flyway', 'liquibase',
  ];
  try {
    const entries = fs.readdirSync(cwd).map((e) => e.toLowerCase());
    return markers.some((m) => entries.includes(m));
  } catch {
    return false;
  }
}

/** 检测是否包含财务/金融相关内容 */
function detectFinance(cwd: string): boolean {
  const markers = ['finance', 'accounting', 'ledger', 'invoice', 'billing', 'payment'];
  try {
    const entries = fs.readdirSync(cwd).map((e) => e.toLowerCase());
    return markers.some((m) => entries.some((e) => e.includes(m)));
  } catch {
    return false;
  }
}

/** 采集当前项目上下文 */
function collectProjectContext(): ProjectContext {
  const cwd = process.cwd();
  const pkg = readJsonSafe(path.join(cwd, 'package.json'));

  return {
    projectName: pkg?.name ?? path.basename(cwd),
    description: pkg?.description ?? '',
    techStack: detectTechStack(cwd),
    topLevelStructure: getTopLevelStructure(cwd),
    hasDatabase: detectDatabase(cwd),
    hasFinance: detectFinance(cwd),
  };
}

/** 将 ProjectContext 格式化为 prompt 片段 */
function formatContextForPrompt(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push(`项目名称: ${ctx.projectName}`);
  if (ctx.description) lines.push(`项目描述: ${ctx.description}`);
  if (ctx.techStack.length > 0) lines.push(`技术栈: ${ctx.techStack.join(', ')}`);
  if (ctx.topLevelStructure) lines.push(`目录概览: ${ctx.topLevelStructure}`);
  if (ctx.hasDatabase) lines.push('特征: 项目包含数据库相关文件');
  if (ctx.hasFinance) lines.push('特征: 项目包含财务/金融相关文件');
  return lines.join('\n');
}

// ===== 兜底提示 =====

/** 默认提示（LLM 不可用时的兜底） */
const FALLBACK_HINTS: Record<string, string> = {
  jarvis: 'Try "create a util logging.py that..."',
  codereviewer: 'Try "review this function for potential issues..."',
  dba: 'Try "optimize this slow SQL query..."',
  financeadvisor: 'Try "分析这份利润表的关键指标..."',
  stocktrader: 'Try "分析一下这只股票的趋势走势..."',
};

const DEFAULT_HINT = 'Try "create a util logging.py that..."';

/** 获取角色对应的静态兜底提示（同步，可用于初始 placeholder） */
export function getFallbackHint(agentName?: string): string {
  if (agentName) {
    return FALLBACK_HINTS[agentName.toLowerCase()] ?? DEFAULT_HINT;
  }
  const agent = getAgent(getDefaultAgent());
  const name = agent?.meta.name ?? 'Jarvis';
  return FALLBACK_HINTS[name.toLowerCase()] ?? DEFAULT_HINT;
}

// ===== 格式清理 =====

/** 将 LLM 返回的文本统一为 Try "..." 格式 */
function normalizeHint(raw: string): string {
  let hint = raw.trim();

  // 已经是标准格式
  if (/^Try\s+".*"$/.test(hint)) return hint;

  // Try "... 但没闭合
  if (/^Try\s+"/.test(hint)) return hint.endsWith('"') ? hint : hint + '"';

  // 去掉可能的引号包裹
  hint = hint.replace(/^["'「]|["'」]$/g, '').trim();
  return `Try "${hint}"`;
}

// ===== 主函数 =====

/**
 * 调用 LLM 生成一条符合当前角色 + 项目上下文的输入提示
 *
 * @returns 生成的提示文本，失败时返回静态兜底
 */
export async function generateAgentHint(): Promise<string> {
  const agent = getAgent(getDefaultAgent());
  const agentName = agent?.meta.name ?? 'Jarvis';
  const fallback = getFallbackHint(agentName);

  // 检查 LLM 是否可用
  const config = loadConfig();
  const activeModel = getActiveModel(config);
  if (!activeModel || !activeModel.api_key) {
    return fallback;
  }

  // 采集项目上下文
  const ctx = collectProjectContext();
  const contextBlock = formatContextForPrompt(ctx);

  const llmConfig = getDefaultConfig();

  const systemMsg = `你是一个提示词生成器。根据以下智能体角色信息和项目上下文，生成一条简短的示例输入提示，让用户知道可以问什么。

## 角色信息
角色名称: ${agentName}
角色描述: ${agent?.meta.description ?? '通用助手'}
角色氛围: ${agent?.meta.vibe ?? ''}

## 当前项目上下文
${contextBlock}

## 要求
1. 只输出一条提示文本，不要任何解释或前缀
2. 格式为: Try "具体的示例问题..."
3. 示例问题要具体、实用，体现角色的核心能力
4. 必须结合当前项目上下文（技术栈、项目类型等），让提示与用户正在做的事情相关
5. 长度控制在 50 个字符以内（Try "" 内的部分）
6. 语言与角色描述保持一致`;

  // 非流式请求，关闭思考模式以加速响应
  async function doRequest(timeoutMs: number): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = llmConfig.baseUrl || 'https://api.openai.com/v1/chat/completions';

      const requestBody: Record<string, unknown> = {
        model: llmConfig.model,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: '请生成一条输入提示。' },
        ],
        max_tokens: 100,
        temperature: 0.8,
        stream: false,
        // GLM-4.7 / GLM-5 关闭深度思考（Z.AI 官方参数）
        thinking: { type: 'disabled' },
        // Ollama 原生关闭 thinking 模式
        think: false,
        // OpenAI 兼容格式关闭 thinking（Qwen 等）
        chat_template_kwargs: { enable_thinking: false },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[hint] API 错误 ${response.status}: ${errBody.slice(0, 200)}`);
        return null;
      }

      const data = await response.json() as any;

      // 兼容不同 API 的响应格式
      const message = data.choices?.[0]?.message;
      const text =
        message?.content?.trim() ||
        // 部分模型（如 Ollama Gemma4 thinking 模式）内容在 reasoning 字段
        message?.reasoning_content?.trim() ||
        message?.reasoning?.trim() ||
        data.result?.trim() ||
        data.output?.text?.trim() ||
        '';

      if (!text) {
        console.error('[hint] LLM 返回为空，原始响应:', JSON.stringify(data).slice(0, 300));
        return null;
      }

      return text;
    } catch (err: any) {
      clearTimeout(timer);
      console.error(`[hint] 请求失败 (timeout=${timeoutMs}ms):`, err?.message ?? err);
      return null;
    }
  }

  // 本地模型推理慢，给更长超时；云端 API 保持短超时
  const isLocal = /localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\./.test(llmConfig.baseUrl ?? '');
  const timeoutMs = isLocal ? 30000 : 5000;

  const text = await doRequest(timeoutMs);
  if (!text) return fallback;

  return normalizeHint(text);
}
