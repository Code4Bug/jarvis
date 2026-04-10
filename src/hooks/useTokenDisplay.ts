import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Token 计数显示 hook
 *
 * 用 ref 缓存实时 token 数，定时器驱动 UI 刷新，避免每个 chunk 都触发 re-render。
 */
export function useTokenDisplay() {
  const tokenCountRef = useRef<number>(0);
  const tokenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [displayTokens, setDisplayTokens] = useState(0);

  const startTokenTimer = useCallback(() => {
    if (tokenTimerRef.current) return;
    tokenTimerRef.current = setInterval(() => {
      setDisplayTokens(tokenCountRef.current);
    }, 100);
  }, []);

  const stopTokenTimer = useCallback(() => {
    if (tokenTimerRef.current) {
      clearInterval(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }
    setDisplayTokens(tokenCountRef.current);
  }, []);

  const updateTokenCount = useCallback((count: number) => {
    tokenCountRef.current = count;
  }, []);

  const syncTokenDisplay = useCallback((count: number) => {
    tokenCountRef.current = count;
    setDisplayTokens(count);
  }, []);

  const resetTokens = useCallback(() => {
    tokenCountRef.current = 0;
    setDisplayTokens(0);
  }, []);

  // 组件卸载时清理
  useEffect(() => () => {
    if (tokenTimerRef.current) clearInterval(tokenTimerRef.current);
  }, []);

  return {
    displayTokens,
    tokenCountRef,
    startTokenTimer,
    stopTokenTimer,
    updateTokenCount,
    syncTokenDisplay,
    resetTokens,
  };
}
