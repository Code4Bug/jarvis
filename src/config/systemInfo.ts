/**
 * 系统信息收集器
 *
 * 启动时执行一次，收集当前操作系统和硬件信息，
 * 格式化后追加到智能体上下文中，帮助 LLM 更好地理解用户环境。
 */

import os from 'os';
import { execSync } from 'child_process';

interface SystemInfo {
  /** 操作系统类型 */
  osType: string;
  /** 操作系统版本 */
  osVersion: string;
  /** 系统架构 */
  arch: string;
  /** 主机名 */
  hostname: string;
  /** CPU 型号 */
  cpuModel: string;
  /** CPU 核心数 */
  cpuCores: number;
  /** 总内存 (GB) */
  totalMemoryGB: string;
  /** 可用内存 (GB) */
  freeMemoryGB: string;
  /** 当前用户 */
  username: string;
  /** Shell 类型 */
  shell: string;
  /** 当前工作目录 */
  cwd: string;
  /** Node.js 版本 */
  nodeVersion: string;
  /** 额外信息（平台特定） */
  extras: Record<string, string>;
}

/** 安全执行命令，失败返回空字符串 */
function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

/** 收集系统信息 */
function collectSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const platform = os.platform();
  const extras: Record<string, string> = {};

  // 平台特定信息
  if (platform === 'darwin') {
    const macModel = safeExec('sysctl -n hw.model');
    if (macModel) extras['Mac 型号'] = macModel;
    const macOSName = safeExec('sw_vers -productName');
    const macOSVer = safeExec('sw_vers -productVersion');
    if (macOSName && macOSVer) extras['macOS'] = `${macOSName} ${macOSVer}`;
  } else if (platform === 'linux') {
    const distro = safeExec('cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'');
    if (distro) extras['发行版'] = distro;
    const kernel = safeExec('uname -r');
    if (kernel) extras['内核版本'] = kernel;
  }

  // 通用工具版本检测
  const gitVersion = safeExec('git --version');
  if (gitVersion) extras['Git'] = gitVersion.replace('git version ', '');

  const pythonVersion = safeExec('python3 --version 2>/dev/null || python --version 2>/dev/null');
  if (pythonVersion) extras['Python'] = pythonVersion.replace('Python ', '');

  return {
    osType: `${platform} (${os.type()})`,
    osVersion: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCores: cpus.length,
    totalMemoryGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    freeMemoryGB: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
    username: os.userInfo().username,
    shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
    cwd: process.cwd(),
    nodeVersion: process.version,
    extras,
  };
}

/** 缓存，只收集一次 */
let _cached: string | null = null;

/**
 * 获取格式化的系统信息文本，用于追加到 system prompt
 *
 * 返回 markdown 格式的系统环境描述
 */
export function getSystemInfoPrompt(): string {
  if (_cached) return _cached;

  const info = collectSystemInfo();

  const lines: string[] = [
    '\n\n---',
    '[系统环境] 以下是用户当前的操作系统和硬件信息，可用于辅助判断和生成适配当前环境的命令或代码：',
    '',
    `- 操作系统: ${info.osType}`,
    `- 系统版本: ${info.osVersion}`,
    `- 架构: ${info.arch}`,
    `- 主机名: ${info.hostname}`,
    `- CPU: ${info.cpuModel} (${info.cpuCores} 核)`,
    `- 内存: ${info.totalMemoryGB} GB (可用 ${info.freeMemoryGB} GB)`,
    `- 用户: ${info.username}`,
    `- Shell: ${info.shell}`,
    `- 工作目录: ${info.cwd}`,
    `- Node.js: ${info.nodeVersion}`,
  ];

  for (const [key, val] of Object.entries(info.extras)) {
    lines.push(`- ${key}: ${val}`);
  }

  _cached = lines.join('\n');
  return _cached;
}
