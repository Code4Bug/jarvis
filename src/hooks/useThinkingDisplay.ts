import { useSyncExternalStore } from 'react';

let thinkingDisplayValue = '';
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function setThinkingDisplay(text: string) {
  if (thinkingDisplayValue === text) return;
  thinkingDisplayValue = text;
  emitChange();
}

export function resetThinkingDisplay() {
  setThinkingDisplay('');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return thinkingDisplayValue;
}

export function useThinkingDisplay() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
