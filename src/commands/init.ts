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
import { APP_NAME, APP_VERSION } from '../config/constants';

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

// ===== 主函数 =====

export interface InitResult {
  /** 终端显示的格式化文本 */
  displayText: string;
  /** 生成的 JARVIS.md 内容 */
  jarvisMd: string;
  /** JARVIS.md 是否为新建（false 表示覆盖） */
  isNew: boolean;
}

export function executeInit(): InitResult {
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

  // ===== 生成 JARVIS.md =====
  const md: string[] = [];
  md.push(`# ${pkg?.name || projectName}`);
  md.push('');
  if (pkg?.description) {
    md.push(pkg.description);
    md.push('');
  }
  md.push('---');
  md.push('');

  md.push('## 项目信息');
  md.push('');
  md.push(`| 项目 | 值 |`);
  md.push(`|------|-----|`);
  md.push(`| 名称 | ${pkg?.name || projectName} |`);
  if (pkg?.version) md.push(`| 版本 | ${pkg.version} |`);
  md.push(`| 类型 | ${projectTypes.join(', ')} |`);
  if (gitInfo?.branch) md.push(`| Git 分支 | ${gitInfo.branch} |`);
  if (gitInfo?.remote) md.push(`| Git 远程 | ${gitInfo.remote} |`);
  md.push('');

  md.push('## 目录结构');
  md.push('');
  md.push('```');
  md.push(`${projectName}/`);
  for (const line of dirTree) {
    md.push(line);
  }
  md.push('```');
  md.push('');

  // 快速开始
  if (pkg?.scripts) {
    md.push('## 快速开始');
    md.push('');
    md.push('```bash');
    if (pkg.scripts.install || fs.existsSync(path.join(cwd, 'package-lock.json'))) {
      md.push('# 安装依赖');
      md.push('npm install');
      md.push('');
    }
    if (pkg.scripts.dev) {
      md.push('# 开发模式');
      md.push(`npm run dev`);
    } else if (pkg.scripts.start) {
      md.push('# 启动');
      md.push(`npm run start`);
    }
    if (pkg.scripts.build) {
      md.push('');
      md.push('# 构建');
      md.push('npm run build');
    }
    md.push('```');
    md.push('');
  }

  md.push('---');
  md.push('');
  md.push(`> 由 ${APP_NAME} /init 自动生成`);
  md.push('');

  const jarvisMdContent = md.join('\n');
  const jarvisMdPath = path.join(cwd, 'JARVIS.md');
  const isNew = !fs.existsSync(jarvisMdPath);

  // 写入文件
  fs.writeFileSync(jarvisMdPath, jarvisMdContent, 'utf-8');

  display.push(isNew ? '已生成 JARVIS.md' : '已更新 JARVIS.md');

  return {
    displayText: display.join('\n'),
    jarvisMd: jarvisMdContent,
    isNew,
  };
}
