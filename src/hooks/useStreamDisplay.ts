import { useSyncExternalStore } from 'react';

/**
 * 流式文本外部 store。
 *
 * 与 useThinkingDisplay 同构：写入方只调用 setStreamDisplay / resetStreamDisplay，
 * 订阅方（StreamingDraft）通过 useSyncExternalStore 独立刷新，
 * 不会把 REPL 整棵渲染树带着重绘。
 */
let streamDisplayValue = '';
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function setStreamDisplay(text: string) {
  if (streamDisplayValue === text) return;
  streamDisplayValue = text;
  emitChange();
}

export function appendStreamDisplay(chunk: string) {
  streamDisplayValue += chunk;
  emitChange();
}

export function resetStreamDisplay() {
  if (streamDisplayValue === '') return;
  streamDisplayValue = '';
  emitChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return streamDisplayValue;
}

export function useStreamDisplay() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
