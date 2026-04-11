/**
 * /init 命令实现
 *
 * 扫描当前项目目录，收集项目元信息、目录结构、配置状态、系统环境，
 * 格式化输出到终端，并生成/更新 JARVIS.md 项目描述文件。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { APP_NAME, APP_VERSION } from '../config/constants.js';
import { LLMServiceImpl, getDefaultConfig } from '../services/api/llm.js';
import { TranscriptMessage } from '../types/index.js';
import { allTools } from '../tools/index.js';
import { loadAllAgents } from '../agents/index.js';

// ===== 辅助函数 =====

/** 安全执行命令 */
function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

/** 读取 package.json */
function readPackageJson(): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 检测项目类型 */
function detectProjectType(): string[] {
  const types: string[] = [];
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) types.push('Node.js');
  if (fs.existsSync(path.join(cwd, 'pom.xml'))) types.push('Maven/Java');
  if (fs.existsSync(path.join(cwd, 'build.gradle')) || fs.existsSync(path.join(cwd, 'build.gradle.kts'))) types.push('Gradle/Java');
  if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) types.push('Python');
  if (fs.existsSync(path.join(cwd, 'go.mod'))) types.push('Go');
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) types.push('Rust');
  if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) types.push('TypeScript');
  if (fs.existsSync(path.join(cwd, 'Makefile'))) types.push('Make');
  if (fs.existsSync(path.join(cwd, 'Dockerfile')) || fs.existsSync(path.join(cwd, 'docker-compose.yml'))) types.push('Docker');
  return types.length > 0 ? types : ['Unknown'];
}

/** 获取 Git 信息 */
function getGitInfo(): { branch: string; remote: string; lastCommit: string } | null {
  const branch = safeExec('git rev-parse --abbrev-ref HEAD');
  if (!branch) return null;
  const remote = safeExec('git remote get-url origin');
  const lastCommit = safeExec('git log -1 --format="%h %s" 2>/dev/null');
  return { branch, remote, lastCommit };
}

/** 扫描目录结构（浅层，最多 2 级） */
function scanDirectoryTree(dir: string, prefix: string = '', depth: number = 0, maxDepth: number = 2): string[] {
  if (depth > maxDepth) return [];
  const lines: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '__pycache__')
      .sort((a, b) => {
        // 目录优先
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (entry.isDirectory()) {
        lines.push(`${prefix}${connector}${entry.name}/`);
        const subLines = scanDirectoryTree(
          path.join(dir, entry.name),
          prefix + childPrefix,
          depth + 1,
          maxDepth,
        );
        lines.push(...subLines);
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  } catch { /* ignore */ }
  return lines;
}

/** 统计源代码文件数量 */
function countSourceFiles(dir: string): { total: number; byExt: Record<string, number> } {
  const byExt: Record<string, number> = {};
  let total = 0;

  function walk(d: string) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.md', '.json', '.yaml', '.yml'].includes(ext)) {
            byExt[ext] = (byExt[ext] || 0) + 1;
            total++;
          }
        }
      }
    } catch { /* ignore */ }
  }

  walk(dir);
  return { total, byExt };
}

/** 读取文本文件，超长时截断 */
function readTextFile(filePath: string, maxChars: number = 6000): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.length <= maxChars) return content;
    return `${content.slice(0, maxChars)}\n\n[...已截断，共 ${content.length} 字符]`;
  } catch {
    return '';
  }
}

function shouldIgnoreEntry(name: string): boolean {
  return name.startsWith('.')
    || name === 'node_modules'
    || name === 'dist'
    || name === 'build'
    || name === 'target'
    || name === '__pycache__'
    || name === '.git';
}

function normalizePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isTextLikeFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return [
    '.md', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.conf',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.java', '.go', '.rs', '.kt', '.kts',
    '.c', '.cc', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.sql', '.xml', '.gradle', '.properties',
  ].includes(ext) || fileName === 'Dockerfile' || fileName === 'Makefile';
}

function collectRootContextFiles(cwd: string): string[] {
  const preferredPatterns = [
    /^README(\..+)?$/i,
    /^package\.json$/i,
    /^pnpm-lock\.ya?ml$/i,
    /^package-lock\.json$/i,
    /^yarn\.lock$/i,
    /^tsconfig.*\.json$/i,
    /^vite\.config\./i,
    /^webpack\.config\./i,
    /^next\.config\./i,
    /^nuxt\.config\./i,
    /^pom\.xml$/i,
    /^build\.gradle(\.kts)?$/i,
    /^settings\.gradle(\.kts)?$/i,
    /^pyproject\.toml$/i,
    /^requirements.*\.txt$/i,
    /^go\.mod$/i,
    /^Cargo\.toml$/i,
    /^composer\.json$/i,
    /^Gemfile$/i,
    /^Dockerfile$/i,
    /^docker-compose\.ya?ml$/i,
    /^Makefile$/i,
    /^AGENT.*\.md$/i,
    /^SKILL.*\.md$/i,
  ];

  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !shouldIgnoreEntry(entry.name))
      .map((entry) => entry.name)
      .filter((name) => preferredPatterns.some((pattern) => pattern.test(name)))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function chooseRepresentativeFiles(dirPath: string, relativeDir: string, maxFiles: number = 3): string[] {
  const preferredNames = [
    'index', 'main', 'app', 'cli', 'server', 'client', 'api',
    'router', 'routes', 'controller', 'service', 'model',
    'commands', 'tools', 'query', 'engine',
  ];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !shouldIgnoreEntry(entry.name) && isTextLikeFile(entry.name))
      .sort((a, b) => {
        const aBase = path.parse(a.name).name.toLowerCase();
        const bBase = path.parse(b.name).name.toLowerCase();
        const aScore = preferredNames.findIndex((name) => name === aBase);
        const bScore = preferredNames.findIndex((name) => name === bBase);
        const normalizedAScore = aScore === -1 ? preferredNames.length : aScore;
        const normalizedBScore = bScore === -1 ? preferredNames.length : bScore;
        if (normalizedAScore !== normalizedBScore) return normalizedAScore - normalizedBScore;
        return a.name.localeCompare(b.name);
      });

    return entries
      .slice(0, maxFiles)
      .map((entry) => normalizePath(path.join(relativeDir, entry.name)));
  } catch {
    return [];
  }
}

function collectSourceContextFiles(cwd: string): string[] {
  const candidateDirs = ['src', 'app', 'lib', 'cmd', 'internal', 'pkg', 'server', 'client', 'backend', 'frontend'];
  const result: string[] = [];

  for (const dirName of candidateDirs) {
    const dirPath = path.join(cwd, dirName);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;

    result.push(...chooseRepresentativeFiles(dirPath, dirName, 3));

    try {
      const subDirs = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !shouldIgnoreEntry(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 4);

      for (const subDir of subDirs) {
        result.push(...chooseRepresentativeFiles(path.join(dirPath, subDir.name), path.join(dirName, subDir.name), 2));
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(result)).slice(0, 18);
}

/** 采样项目关键文件，提供给大模型做总结 */
function collectProjectContext(cwd: string): string {
  const candidates = [
    ...collectRootContextFiles(cwd),
    ...collectSourceContextFiles(cwd),
  ];

  const parts: string[] = [];
  for (const relativePath of candidates) {
    const fullPath = path.join(cwd, relativePath);
    if (!fs.existsSync(fullPath)) continue;
    const content = readTextFile(fullPath);
    if (!content) continue;
    parts.push(`## 文件: ${normalizePath(relativePath)}\n\n\`\`\`\n${content}\n\`\`\``);
  }
  return parts.join('\n\n');
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:md|markdown)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function listTopLevelDirectories(cwd: string): string[] {
  try {
    return fs.readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function buildRealCommandSuggestions(cwd: string, pkg: Record<string, any> | null): string[] {
  const commands: string[] = [];
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    commands.push('pnpm install');
  } else if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    commands.push('npm install');
  }
  if (pkg?.scripts?.dev) commands.push('npm run dev');
  if (pkg?.scripts?.start) commands.push('npm run start');
  if (pkg?.scripts?.build) commands.push('npm run build');
  if (pkg?.scripts?.test) commands.push('npm test');
  return commands;
}

interface InitSummary {
  overview: string;
  architecture: string[];
  capabilities: string[];
  collaborationNotes: string[];
}

function renderJarvisMd(input: {
  projectName: string;
  packageJson: Record<string, any> | null;
  projectTypes: string[];
  gitInfo: { branch: string; remote: string; lastCommit: string } | null;
  dirTree: string[];
  devCommands: string[];
  summary: InitSummary;
}): string {
  const { projectName, packageJson: pkg, projectTypes, gitInfo, dirTree, devCommands, summary } = input;
  const md: string[] = [];
  md.push(`# ${pkg?.name || projectName}`);
  md.push('');
  md.push('## 项目概览');
  md.push('');
  md.push(summary.overview || '待补充');
  md.push('');
  md.push('## 技术栈');
  md.push('');
  md.push(`- 项目类型：${projectTypes.join(', ')}`);
  md.push(`- 运行时：${pkg?.type || '未发现'}`);
  md.push(`- 版本：${pkg?.version || '未发现'}`);
  md.push(`- Git 分支：${gitInfo?.branch || '未发现'}`);
  md.push('');
  md.push('## 目录与模块');
  md.push('');
  for (const line of summary.architecture) {
    md.push(`- ${line}`);
  }
  md.push('');
  md.push('```');
  md.push(`${projectName}/`);
  md.push(...dirTree);
  md.push('```');
  md.push('');
  md.push('## 当前能力');
  md.push('');
  for (const line of summary.capabilities) {
    md.push(`- ${line}`);
  }
  md.push('');
  md.push('## 开发与构建');
  md.push('');
  if (devCommands.length > 0) {
    md.push('```bash');
    md.push(...devCommands);
    md.push('```');
  } else {
    md.push('待补充');
  }
  md.push('');
  md.push('## 协作约定');
  md.push('');
  for (const line of summary.collaborationNotes) {
    md.push(`- ${line}`);
  }
  md.push('');
  md.push(`> 由 ${APP_NAME} /init 自动生成`);
  md.push('');
  return md.join('\n');
}

async function generateJarvisMdWithLLM(input: {
  cwd: string;
  projectName: string;
  packageJson: Record<string, any> | null;
  projectTypes: string[];
  gitInfo: { branch: string; remote: string; lastCommit: string } | null;
  fileStats: { total: number; byExt: Record<string, number> };
  dirTree: string[];
}): Promise<string> {
  const service = new LLMServiceImpl({
    ...getDefaultConfig(),
  });

  const projectContext = collectProjectContext(input.cwd);
  const topLevelDirectories = listTopLevelDirectories(input.cwd);
  const devCommands = buildRealCommandSuggestions(input.cwd, input.packageJson);
  const toolNames = allTools.map((tool) => tool.name);
  const agentNames = Array.from(loadAllAgents().values()).map((agent) => agent.meta.name);
  const extStats = Object.entries(input.fileStats.byExt)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(', ');

  const prompt = [
    '你是项目初始化助手。请基于提供的真实项目信息，为 JARVIS.md 先生成结构化摘要。',
    '',
    '要求：',
    '1. 只能依据给定信息总结，不要编造不存在的模块、流程、命令、目录或能力',
    '2. 全文使用中文',
    '3. 必须只输出合法 JSON，不要附加解释，不要输出 Markdown',
    '4. 内容要有总结性，但必须可被事实支撑',
    '5. 如果信息不足，明确写“待补充”或“未发现”，不要猜测',
    '6. 禁止使用 emoji、营销文案、夸张措辞',
    '',
    'JSON 结构如下：',
    '{',
    '  "overview": "1 段中文概述，80-160 字",',
    '  "architecture": ["3 到 6 条，每条一句，描述目录或模块职责"],',
    '  "capabilities": ["4 到 8 条，每条一句，描述当前已实现能力"],',
    '  "collaborationNotes": ["3 到 6 条，每条一句，描述开发协作约定或注意事项"]',
    '}',
    '',
    '以下是项目事实：',
    `- 项目名称: ${input.packageJson?.name || input.projectName}`,
    `- 项目目录名: ${input.projectName}`,
    `- 项目版本: ${input.packageJson?.version || '未发现'}`,
    `- 项目描述: ${input.packageJson?.description || '未发现'}`,
    `- 项目类型: ${input.projectTypes.join(', ')}`,
    `- Git 分支: ${input.gitInfo?.branch || '未发现'}`,
    `- Git 远程: ${input.gitInfo?.remote || '未发现'}`,
    `- 最近提交: ${input.gitInfo?.lastCommit || '未发现'}`,
    `- 源文件总数: ${input.fileStats.total}`,
    `- 扩展名统计: ${extStats || '未发现'}`,
    `- 顶层目录: ${topLevelDirectories.join(', ') || '未发现'}`,
    `- 内置工具: ${toolNames.join(', ') || '未发现'}`,
    `- 内置智能体: ${agentNames.join(', ') || '未发现'}`,
    `- 可确认开发命令: ${devCommands.join(' | ') || '未发现'}`,
    '',
    '目录树（浅层）:',
    `${input.projectName}/`,
    ...input.dirTree,
    '',
    '关键文件内容:',
    projectContext || '(未读取到关键文件)',
  ].join('\n');

  let result = '';
  const transcript: TranscriptMessage[] = [
    { role: 'user', content: prompt },
  ];

  await new Promise<void>((resolve, reject) => {
    service.streamMessage(
      transcript,
      [],
      {
        onText: (text: string) => { result += text; },
        onToolUse: () => { /* /init 不允许工具调用 */ },
        onComplete: () => resolve(),
        onError: (error: Error) => reject(error),
      },
      undefined,
      { includeUserProfile: false },
    ).catch(reject);
  });

  const cleaned = stripJsonCodeFence(stripMarkdownCodeFence(result));
  if (!cleaned) {
    throw new Error('大模型未返回有效内容');
  }

  let summary: InitSummary;
  try {
    const parsed = JSON.parse(cleaned);
    summary = {
      overview: String(parsed.overview || '').trim() || '待补充',
      architecture: Array.isArray(parsed.architecture) ? parsed.architecture.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
      collaborationNotes: Array.isArray(parsed.collaborationNotes) ? parsed.collaborationNotes.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
    };
  } catch (error: any) {
    throw new Error(`解析大模型总结失败: ${error.message}`);
  }

  if (summary.architecture.length === 0) summary.architecture = ['待补充'];
  if (summary.capabilities.length === 0) summary.capabilities = ['待补充'];
  if (summary.collaborationNotes.length === 0) summary.collaborationNotes = ['待补充'];

  return renderJarvisMd({
    projectName: input.projectName,
    packageJson: input.packageJson,
    projectTypes: input.projectTypes,
    gitInfo: input.gitInfo,
    dirTree: input.dirTree,
    devCommands,
    summary,
  });
}

function generateBasicJarvisMd(input: {
  cwd: string;
  projectName: string;
  packageJson: Record<string, any> | null;
  projectTypes: string[];
  gitInfo: { branch: string; remote: string; lastCommit: string } | null;
  dirTree: string[];
}): string {
  const { cwd, projectName, packageJson: pkg, projectTypes, gitInfo, dirTree } = input;
  const md: string[] = [];
  md.push(`# ${pkg?.name || projectName}`);
  md.push('');
  if (pkg?.description) {
    md.push(pkg.description);
    md.push('');
  }
  md.push('## 项目概览');
  md.push('');
  md.push(`- 项目类型：${projectTypes.join(', ')}`);
  md.push(`- 当前目录：\`${cwd}\``);
  md.push(`- 版本：${pkg?.version || '未发现'}`);
  md.push(`- Git 分支：${gitInfo?.branch || '未发现'}`);
  md.push('');
  md.push('## 目录结构');
  md.push('');
  md.push('```');
  md.push(`${projectName}/`);
  md.push(...dirTree);
  md.push('```');
  md.push('');
  if (pkg?.scripts) {
    md.push('## 开发命令');
    md.push('');
    md.push('```bash');
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
      md.push('pnpm install');
    } else if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
      md.push('npm install');
    }
    if (pkg.scripts.dev) md.push('npm run dev');
    if (pkg.scripts.build) md.push('npm run build');
    if (pkg.scripts.test) md.push('npm test');
    md.push('```');
    md.push('');
  }
  md.push('## 协作约定');
  md.push('');
  md.push('- 本文件为自动生成结果；若需更准确的业务背景，请补充 README 或项目文档。');
  md.push('');
  md.push(`> 由 ${APP_NAME} /init 自动生成`);
  md.push('');
  return md.join('\n');
}

// ===== 主函数 =====

export interface InitResult {
  /** 终端显示的格式化文本 */
  displayText: string;
  /** 生成的 JARVIS.md 内容 */
  jarvisMd: string;
  /** JARVIS.md 是否为新建（false 表示覆盖） */
  isNew: boolean;
}

export async function executeInit(): Promise<InitResult> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const pkg = readPackageJson();
  const projectTypes = detectProjectType();
  const gitInfo = getGitInfo();
  const fileStats = countSourceFiles(cwd);
  const dirTree = scanDirectoryTree(cwd);

  // ===== 构建终端显示文本 =====
  const display: string[] = [];

  display.push(`${APP_NAME} ${APP_VERSION} - 项目初始化`);
  display.push('');

  // 项目基本信息
  display.push('[ 项目信息 ]');
  display.push(`  名称: ${pkg?.name || projectName}`);
  if (pkg?.version) display.push(`  版本: ${pkg.version}`);
  if (pkg?.description) display.push(`  描述: ${pkg.description}`);
  display.push(`  类型: ${projectTypes.join(', ')}`);
  display.push(`  路径: ${cwd}`);
  display.push('');

  // Git 信息
  if (gitInfo) {
    display.push('[ Git ]');
    display.push(`  分支: ${gitInfo.branch}`);
    if (gitInfo.remote) display.push(`  远程: ${gitInfo.remote}`);
    if (gitInfo.lastCommit) display.push(`  最近提交: ${gitInfo.lastCommit}`);
    display.push('');
  }

  // 文件统计
  display.push('[ 文件统计 ]');
  display.push(`  源文件总数: ${fileStats.total}`);
  const extEntries = Object.entries(fileStats.byExt).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of extEntries) {
    display.push(`    ${ext}: ${count}`);
  }
  display.push('');

  // 运行环境
  display.push('[ 运行环境 ]');
  const nodeVer = safeExec('node -v');
  if (nodeVer) display.push(`  Node.js: ${nodeVer}`);
  const npmVer = safeExec('npm -v');
  if (npmVer) display.push(`  npm: ${npmVer}`);
  const pythonVer = safeExec('python3 --version 2>/dev/null || python --version 2>/dev/null');
  if (pythonVer) display.push(`  Python: ${pythonVer.replace('Python ', '')}`);
  const gitVer = safeExec('git --version');
  if (gitVer) display.push(`  Git: ${gitVer.replace('git version ', '')}`);
  display.push('');

  // 目录结构
  display.push('[ 目录结构 ]');
  display.push(`  ${projectName}/`);
  for (const line of dirTree) {
    display.push(`  ${line}`);
  }
  display.push('');

  // Node.js 依赖
  if (pkg) {
    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});
    if (deps.length > 0 || devDeps.length > 0) {
      display.push('[ 依赖 ]');
      if (deps.length > 0) display.push(`  dependencies (${deps.length}): ${deps.join(', ')}`);
      if (devDeps.length > 0) display.push(`  devDependencies (${devDeps.length}): ${devDeps.join(', ')}`);
      display.push('');
    }

    // scripts
    const scripts = Object.keys(pkg.scripts || {});
    if (scripts.length > 0) {
      display.push('[ Scripts ]');
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        display.push(`  ${name}: ${cmd}`);
      }
      display.push('');
    }
  }

  let jarvisMdContent = '';
  let generationMode = '基础扫描';
  try {
    jarvisMdContent = await generateJarvisMdWithLLM({
      projectName,
      cwd,
      packageJson: pkg,
      projectTypes,
      gitInfo,
      fileStats,
      dirTree,
    });
    generationMode = '大模型总结';
  } catch {
    jarvisMdContent = generateBasicJarvisMd({
      cwd,
      projectName,
      packageJson: pkg,
      projectTypes,
      gitInfo,
      dirTree,
    });
  }

  const jarvisMdPath = path.join(cwd, 'JARVIS.md');
  const isNew = !fs.existsSync(jarvisMdPath);

  // 写入文件
  fs.writeFileSync(jarvisMdPath, jarvisMdContent, 'utf-8');

  display.push(`[ 输出 ]`);
  display.push(`  生成方式: ${generationMode}`);
  display.push(isNew ? '已生成 JARVIS.md' : '已更新 JARVIS.md');

  return {
    displayText: display.join('\n'),
    jarvisMd: jarvisMdContent,
    isNew,
  };
}
