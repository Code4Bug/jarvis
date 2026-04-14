import { useSyncExternalStore } from 'react';

/**
 * sessionStartedAt 外部 store。
 *
 * 与 useTokenDisplay 同构：REPL 侧通过 setSessionStartDisplay 写入，
 * FooterPane/StatusBar 通过订阅独立刷新，不把 REPL 整棵渲染树带着重绘。
 */
let sessionStartValue = 0;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function setSessionStartDisplay(startedAt: number) {
  if (sessionStartValue === startedAt) return;
  sessionStartValue = startedAt;
  emitChange();
}

export function resetSessionStartDisplay() {
  setSessionStartDisplay(0);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return sessionStartValue;
}

export function useSessionStartDisplay() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
