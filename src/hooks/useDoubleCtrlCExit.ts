import { useState, useCallback, useRef, useEffect } from 'react';

/** 双击 Ctrl+C 退出：第一次按下后显示倒计时，3 秒内再按一次退出，否则取消 */
export function useDoubleCtrlCExit(exit: () => void) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armedRef.current = false;
    deadlineRef.current = null;
    setCountdown(null);
  }, []);

  const handleCtrlC = useCallback(() => {
    if (armedRef.current) {
      clearTimer();
      exit();
      return;
    }

    armedRef.current = true;
    deadlineRef.current = Date.now() + 3000;
    setCountdown(3);

    timerRef.current = setTimeout(() => {
      clearTimer();
    }, 3000);
  }, [clearTimer, exit]);

  useEffect(() => {
    if (!armedRef.current || deadlineRef.current === null) return;

    const interval = setInterval(() => {
      if (deadlineRef.current === null) return;
      const remainMs = deadlineRef.current - Date.now();
      if (remainMs <= 0) {
        clearTimer();
        return;
      }
      setCountdown(Math.ceil(remainMs / 1000));
    }, 100);

    return () => clearInterval(interval);
  }, [countdown, clearTimer]);

  // 组件卸载时清理
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { countdown, handleCtrlC };
}
