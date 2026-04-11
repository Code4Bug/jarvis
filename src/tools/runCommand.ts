import { exec, ChildProcess } from 'child_process';
import { Tool, AbortSignal } from '../types/index.js';
import { sanitizeOutput } from '../core/safeguard.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

/**
 * 异步执行命令，支持通过 abortSignal 中断子进程
 */
function execAsync(
  command: string,
  options: { encoding: BufferEncoding; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
  abortSignal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    logInfo('bash.exec.start', { command });
    const child: ChildProcess = exec(command, options, (error, stdout, stderr) => {
      // 清理轮询
      if (pollTimer !== null) clearInterval(pollTimer);

      // 被中断时直接返回已有输出，不视为错误
      if (abortSignal?.aborted) {
        const partial = sanitizeOutput(String(stdout ?? '').trim());
        logWarn('bash.exec.aborted', {
          command,
          stdoutLength: String(stdout ?? '').length,
        });
        resolve(partial ? `(命令被中断)\n${partial}` : '(命令被中断)');
        return;
      }

      if (error) {
        const parts: string[] = [];
        if (stderr) parts.push(`[stderr] ${sanitizeOutput(String(stderr).trim())}`);
        if (stdout) parts.push(`[stdout] ${sanitizeOutput(String(stdout).trim())}`);
        if (error.code != null) parts.push(`[exit code] ${error.code}`);
        if (parts.length === 0) parts.push(error.message);
        logError('bash.exec.failed', error, {
          command,
          stdoutLength: String(stdout ?? '').length,
          stderrLength: String(stderr ?? '').length,
        });
        reject(new Error(`命令执行失败:\n${parts.join('\n')}`));
        return;
      }
      logInfo('bash.exec.done', {
        command,
        stdoutLength: String(stdout ?? '').length,
      });
      resolve(sanitizeOutput(String(stdout).trim()) || '(命令执行完成，无输出)');
    });

    // 轮询 abortSignal，检测到中断时 kill 子进程
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (abortSignal) {
      pollTimer = setInterval(() => {
        if (abortSignal.aborted && child.pid) {
          if (pollTimer !== null) clearInterval(pollTimer);
          pollTimer = null;
          logWarn('bash.exec.kill_requested', { command, pid: child.pid });
          // 先尝试 SIGTERM，给进程优雅退出的机会
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          // 500ms 后强制 SIGKILL
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
          }, 500);
        }
      }, 100);
    }
  });
}

export const runCommand: Tool = {
  name: 'Bash',
  description: '执行 Bash 命令并返回输出。调用格式: Bash(command)，例如 Bash(git status)、Bash(ls -la)',
  parameters: {
    command: { type: 'string', description: '要执行的 Bash 命令', required: true },
  },
  execute: async (args, abortSignal?) => {
    const command = args.command as string;
    return execAsync(command, {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: sanitizeEnv(process.env),
    }, abortSignal);
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
