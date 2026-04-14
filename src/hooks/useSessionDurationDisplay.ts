import { useEffect, useSyncExternalStore } from 'react';

let sessionStartedAt = 0;
let currentDurationLabel = '00s';
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function formatSessionDuration(startedAt: number, now: number = Date.now()): string {
  if (!startedAt || startedAt <= 0) return '00s';
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (elapsedSeconds < 60) {
    return `${String(elapsedSeconds).padStart(2, '0')}s`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(minutes).padStart(2, '0')}m`;
}

function tick() {
  const nextLabel = formatSessionDuration(sessionStartedAt);
  if (nextLabel === currentDurationLabel) return;
  currentDurationLabel = nextLabel;
  emitChange();
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(tick, 1000);
}

function stopTimerIfIdle() {
  if (listeners.size > 0) return;
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureTimer();
  return () => {
    listeners.delete(listener);
    stopTimerIfIdle();
  };
}

function getSnapshot() {
  return currentDurationLabel;
}

export function setSessionDurationStart(startedAt?: number) {
  const nextStartedAt = startedAt ?? 0;
  if (sessionStartedAt === nextStartedAt) return;
  sessionStartedAt = nextStartedAt;
  currentDurationLabel = formatSessionDuration(sessionStartedAt);
  emitChange();
}

export function useSessionDurationDisplay(startedAt?: number) {
  useEffect(() => {
    setSessionDurationStart(startedAt);
  }, [startedAt]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
