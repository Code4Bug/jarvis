import { execSync } from 'child_process';
import { Tool } from '../types/index.js';
import { sanitizeOutput } from '../core/safeguard.js';

export const runCommand: Tool = {
  name: 'Bash',
  description: '执行 Bash 命令并返回输出。调用格式: Bash(command)，例如 Bash(git status)、Bash(ls -la)',
  parameters: {
    command: { type: 'string', description: '要执行的 Bash 命令', required: true },
  },
  execute: async (args) => {
    const command = args.command as string;
    // 安全围栏拦截已在 query 层（executeTool）统一处理，此处仅负责执行 + 脱敏
    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: sanitizeEnv(process.env),
      });
      return sanitizeOutput(output.trim()) || '(命令执行完成，无输出)';
    } catch (e: any) {
      const parts: string[] = [];
      if (e.stderr) parts.push(`[stderr] ${sanitizeOutput(String(e.stderr).trim())}`);
      if (e.stdout) parts.push(`[stdout] ${sanitizeOutput(String(e.stdout).trim())}`);
      if (e.status != null) parts.push(`[exit code] ${e.status}`);
      if (parts.length === 0) parts.push(e.message);
      throw new Error(`命令执行失败:\n${parts.join('\n')}`);
    }
  },
};

/**
 * 构造安全的子进程环境变量：
 * 继承当前 env 但移除高危敏感变量，避免泄露到命令输出
 */
function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const SENSITIVE_KEYS = [
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'NPM_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DATABASE_URL',
    'DB_PASSWORD',
    'PRIVATE_KEY',
    'SECRET_KEY',
    'ENCRYPTION_KEY',
  ];
  const cleaned = { ...env };
  for (const key of SENSITIVE_KEYS) {
    if (cleaned[key]) {
      cleaned[key] = '[REDACTED]';
    }
  }
  return cleaned;
}
