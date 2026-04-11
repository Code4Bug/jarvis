import fs from 'fs';
import os from 'os';
import path from 'path';
import { isMainThread, threadId } from 'worker_threads';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogPayload {
  [key: string]: unknown;
}

function resolveLogsDir(): string {
  return path.join(os.homedir(), '.jarvis', 'logs');
}

function ensureLogsDir(): string {
  const logsDir = resolveLogsDir();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

function getLogFilePath(date = new Date()): string {
  const logsDir = ensureLogsDir();
  const day = date.toISOString().slice(0, 10);
  return path.join(logsDir, `${day}.log`);
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function writeLog(level: LogLevel, event: string, payload: LogPayload = {}): void {
  try {
    const now = new Date();
    const line = JSON.stringify({
      timestamp: now.toISOString(),
      level,
      event,
      pid: process.pid,
      threadId,
      workerType: isMainThread ? 'main' : 'worker',
      cwd: process.cwd(),
      ...payload,
    });
    fs.appendFileSync(getLogFilePath(now), `${line}\n`, 'utf-8');
  } catch {
    // 日志系统自身不能影响主流程
  }
}

export function ensureLoggerReady(): string {
  return ensureLogsDir();
}

export function logInfo(event: string, payload?: LogPayload): void {
  writeLog('INFO', event, payload);
}

export function logWarn(event: string, payload?: LogPayload): void {
  writeLog('WARN', event, payload);
}

export function logError(event: string, error?: unknown, payload: LogPayload = {}): void {
  writeLog('ERROR', event, {
    ...payload,
    ...(error !== undefined ? { error: normalizeError(error) } : {}),
  });
}
