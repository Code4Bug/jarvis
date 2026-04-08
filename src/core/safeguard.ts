/**
 * 统一安全围栏 — 危险命令拦截 + 敏感信息保护 + 双模式授权
 *
 * 授权模式：
 *   1. 临时授权（once）  — 仅当前会话有效，会话重置后失效
 *   2. 持久授权（always）— 写入 ~/.jarvis/.permissions.json，跨会话永久生效
 *
 * critical 级别命令不可授权，high 级别支持两种授权模式。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ===== 持久化路径 =====

const JARVIS_DIR = path.join(os.homedir(), '.jarvis');
const PERMISSIONS_FILE = path.join(JARVIS_DIR, '.permissions.json');

// ===== 危险命令规则 =====

export interface DangerRule {
  /** 规则名称（唯一标识） */
  name: string;
  /** 匹配正则 */
  pattern: RegExp;
  /** 风险等级: high 需要用户确认, critical 直接禁止 */
  level: 'high' | 'critical';
  /** 风险说明 */
  reason: string;
}

/** 危险命令规则表 */
export const DANGER_RULES: DangerRule[] = [
  // === critical: 直接禁止，不可授权 ===
  { name: 'fork-bomb',       pattern: /:\(\)\{.*\|.*\};:/,                  level: 'critical', reason: 'Fork bomb，会导致系统崩溃' },
  { name: 'dev-null-disk',   pattern: />\s*\/dev\/sda/,                     level: 'critical', reason: '直接写入磁盘设备，会破坏文件系统' },
  { name: 'mkfs',            pattern: /\bmkfs\b/,                           level: 'critical', reason: '格式化磁盘，数据不可恢复' },
  { name: 'dd-disk',         pattern: /\bdd\b.*\bof=\/dev\//,              level: 'critical', reason: '直接写入磁盘设备，数据不可恢复' },

  // === high: 需要用户确认 ===
  { name: 'rm-rf-root',      pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?|(-[a-zA-Z]*r[a-zA-Z]*\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?))\s*\/(\s|$)/, level: 'high', reason: '递归强制删除根目录，会摧毁整个系统' },
  { name: 'rm-rf-wildcard',  pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+.*\*/, level: 'high', reason: '递归删除通配符匹配的文件，范围不可控' },
  { name: 'rm-recursive',    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*)\b/,   level: 'high', reason: '递归删除目录，操作不可逆，请确认目标路径' },
  { name: 'chmod-777',       pattern: /\bchmod\s+(-R\s+)?777\b/,           level: 'high', reason: '开放所有权限，存在严重安全隐患' },
  { name: 'curl-pipe-sh',    pattern: /\bcurl\b.*\|\s*(ba)?sh/,            level: 'high', reason: '从网络下载并直接执行脚本，存在供应链攻击风险' },
  { name: 'wget-pipe-sh',    pattern: /\bwget\b.*\|\s*(ba)?sh/,            level: 'high', reason: '从网络下载并直接执行脚本，存在供应链攻击风险' },
  { name: 'shutdown',        pattern: /\b(shutdown|reboot|halt|poweroff)\b/, level: 'high', reason: '关机/重启命令，会中断所有服务' },
  { name: 'kill-all',        pattern: /\bkill\s+-9\s+-1\b/,                level: 'high', reason: '杀死所有用户进程' },
  { name: 'iptables-flush',  pattern: /\biptables\s+-F\b/,                 level: 'high', reason: '清空防火墙规则，可能暴露系统' },
  { name: 'passwd-change',   pattern: /\b(passwd|chpasswd|usermod)\b/,     level: 'high', reason: '修改用户密码/账户，影响系统安全' },
  { name: 'sudoers-edit',    pattern: /\/etc\/sudoers/,                     level: 'high', reason: '修改 sudoers 文件，影响权限体系' },
  { name: 'ssh-key-ops',     pattern: /\.ssh\/(authorized_keys|id_rsa|id_ed25519)/, level: 'high', reason: '操作 SSH 密钥，影响远程访问安全' },
  { name: 'env-export',      pattern: /\benv\b|\bprintenv\b|\bexport\b.*=/, level: 'high', reason: '操作环境变量，可能泄露敏感信息' },
  { name: 'history-access',  pattern: /\bhistory\b|\.bash_history|\.zsh_history/, level: 'high', reason: '访问命令历史，可能包含敏感信息' },
  { name: 'network-sniff',   pattern: /\b(tcpdump|wireshark|nmap|netcat|nc)\b/, level: 'high', reason: '网络嗅探/扫描工具，可能用于攻击' },
  { name: 'crontab-edit',    pattern: /\bcrontab\s+-[er]\b/,               level: 'high', reason: '修改定时任务，可能植入持久化后门' },
  { name: 'systemctl',       pattern: /\bsystemctl\s+(stop|disable|mask|restart)\b/, level: 'high', reason: '操作系统服务，可能中断关键服务' },
];

// ===== 敏感信息模式 =====

export interface SensitivePattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** 敏感信息匹配规则 — 用于输出脱敏 */
export const SENSITIVE_PATTERNS: SensitivePattern[] = [
  { name: 'AWS Access Key',    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,                          replacement: '[AWS_ACCESS_KEY]' },
  { name: 'AWS Secret Key',    pattern: /\b([A-Za-z0-9/+=]{40})\b/g,                        replacement: '[AWS_SECRET_KEY]' },
  { name: 'Generic API Key',   pattern: /\b(api[_-]?key|apikey)\s*[:=]\s*['"]?([^\s'"]+)/gi, replacement: '$1=[REDACTED]' },
  { name: 'Generic Secret',    pattern: /\b(secret|token|password|passwd|pwd)\s*[:=]\s*['"]?([^\s'"]+)/gi, replacement: '$1=[REDACTED]' },
  { name: 'Bearer Token',      pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,                  replacement: 'Bearer [REDACTED]' },
  { name: 'Private Key Block', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, replacement: '[PRIVATE_KEY_REDACTED]' },
  { name: 'Connection String', pattern: /\b(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi,     replacement: '[CONNECTION_STRING_REDACTED]' },
  { name: 'Env Var Inline',    pattern: /\$\{?[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z_]*\}?/gi, replacement: '[ENV_VAR_REDACTED]' },
];

// ===== 授权类型 =====

/** 授权模式 */
export type AuthMode = 'once' | 'always';

/** 持久化授权记录 */
export interface PermissionEntry {
  /** 授权的规则名称（对应 DangerRule.name） */
  ruleName: string;
  /** 授权的具体命令（可选，为空表示授权整个规则） */
  command?: string;
  /** 授权时间 */
  grantedAt: string;
  /** 备注 */
  note?: string;
}

/** .permissions.json 文件结构 */
export interface PermissionsFile {
  /** 文件说明 */
  _comment: string;
  /** 按规则名称授权（授权整类命令） */
  rules: string[];
  /** 按具体命令授权 */
  commands: PermissionEntry[];
}

// ===== 持久化授权：文件读写 =====

/** 读取持久化授权文件 */
function loadPermissions(): PermissionsFile {
  const defaults: PermissionsFile = {
    _comment: '安全围栏持久化授权配置 — 由 /authorize always 写入，可手动编辑',
    rules: [],
    commands: [],
  };
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) return defaults;
    const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PermissionsFile>;
    return {
      _comment: parsed._comment ?? defaults._comment,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
    };
  } catch {
    return defaults;
  }
}

/** 写入持久化授权文件 */
function savePermissions(perms: PermissionsFile): void {
  try {
    if (!fs.existsSync(JARVIS_DIR)) {
      fs.mkdirSync(JARVIS_DIR, { recursive: true });
    }
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(perms, null, 2), 'utf-8');
  } catch { /* 静默失败，不影响主流程 */ }
}

/** 检查命令是否已持久化授权 */
function isPermanentlyAuthorized(command: string, ruleName?: string): boolean {
  const perms = loadPermissions();
  // 1. 按规则名称授权（整类放行）
  if (ruleName && perms.rules.includes(ruleName)) return true;
  // 2. 按具体命令授权
  const trimmed = command.trim();
  return perms.commands.some((e) => e.command === trimmed);
}

// ===== 临时授权：会话级内存 =====

/** 会话级临时授权集合 */
const sessionAuthorizedCommands = new Set<string>();
const sessionAuthorizedRules = new Set<string>();

// ===== 对外授权 API =====

/**
 * 授权命令
 * @param command 具体命令字符串
 * @param mode 'once' 仅本次会话 | 'always' 持久化到文件
 * @param ruleName 可选，关联的规则名称
 */
export function authorizeCommand(command: string, mode: AuthMode = 'once', ruleName?: string): void {
  const trimmed = command.trim();
  if (mode === 'once') {
    sessionAuthorizedCommands.add(trimmed);
  } else {
    // 持久化写入
    const perms = loadPermissions();
    if (!perms.commands.some((e) => e.command === trimmed)) {
      perms.commands.push({
        ruleName: ruleName ?? 'unknown',
        command: trimmed,
        grantedAt: new Date().toISOString(),
      });
      savePermissions(perms);
    }
  }
}

/**
 * 按规则名称授权（整类命令放行）
 * @param ruleName 规则名称（对应 DangerRule.name）
 * @param mode 'once' 仅本次会话 | 'always' 持久化到文件
 */
export function authorizeRule(ruleName: string, mode: AuthMode = 'once'): void {
  if (mode === 'once') {
    sessionAuthorizedRules.add(ruleName);
  } else {
    const perms = loadPermissions();
    if (!perms.rules.includes(ruleName)) {
      perms.rules.push(ruleName);
      savePermissions(perms);
    }
  }
}

/**
 * 撤销持久化授权
 * @param target 规则名称或具体命令
 */
export function revokeAuthorization(target: string): boolean {
  const perms = loadPermissions();
  let changed = false;

  // 尝试从 rules 中移除
  const ruleIdx = perms.rules.indexOf(target);
  if (ruleIdx !== -1) {
    perms.rules.splice(ruleIdx, 1);
    changed = true;
  }

  // 尝试从 commands 中移除
  const cmdIdx = perms.commands.findIndex((e) => e.command === target || e.ruleName === target);
  if (cmdIdx !== -1) {
    perms.commands.splice(cmdIdx, 1);
    changed = true;
  }

  if (changed) savePermissions(perms);
  return changed;
}

/** 列出所有持久化授权 */
export function listPermanentAuthorizations(): PermissionsFile {
  return loadPermissions();
}

/** 检查命令是否已授权（临时 + 持久化） */
export function isAuthorized(command: string, ruleName?: string): boolean {
  const trimmed = command.trim();
  // 1. 会话级临时授权
  if (sessionAuthorizedCommands.has(trimmed)) return true;
  if (ruleName && sessionAuthorizedRules.has(ruleName)) return true;
  // 2. 持久化授权
  return isPermanentlyAuthorized(trimmed, ruleName);
}

/** 清空会话级临时授权（会话重置时调用，不影响持久化授权） */
export function clearAuthorizations(): void {
  sessionAuthorizedCommands.clear();
  sessionAuthorizedRules.clear();
}

// ===== 核心校验函数 =====

export interface SafeguardResult {
  /** 是否允许执行 */
  allowed: boolean;
  /** 拒绝原因 */
  reason?: string;
  /** 匹配到的规则 */
  rule?: DangerRule;
  /** 是否可通过用户确认放行 */
  canOverride?: boolean;
}

/**
 * 校验命令是否安全
 */
export function validateCommand(command: string): SafeguardResult {
  for (const rule of DANGER_RULES) {
    if (rule.pattern.test(command)) {
      if (rule.level === 'critical') {
        return {
          allowed: false,
          reason: `🚫 [禁止执行] ${rule.reason}`,
          rule,
          canOverride: false,
        };
      }
      // high 级别：先检查是否已授权
      if (isAuthorized(command, rule.name)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `[危险命令] ${rule.reason}`,
        rule,
        canOverride: true,
      };
    }
  }
  return { allowed: true };
}

/**
 * 对输出文本进行敏感信息脱敏
 */
export function sanitizeOutput(text: string): string {
  let result = text;
  for (const sp of SENSITIVE_PATTERNS) {
    result = result.replace(sp.pattern, sp.replacement);
  }
  return result;
}

/**
 * 检查文件写入内容是否包含硬编码敏感信息
 */
export function detectSensitiveContent(content: string): string[] {
  const findings: string[] = [];
  for (const sp of SENSITIVE_PATTERNS) {
    sp.pattern.lastIndex = 0;
    if (sp.pattern.test(content)) {
      findings.push(sp.name);
    }
    sp.pattern.lastIndex = 0;
  }
  return findings;
}
