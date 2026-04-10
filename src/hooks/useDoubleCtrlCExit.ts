import { useState, useCallback, useRef, useEffect } from 'react';

/** 双击 Ctrl+C 退出：第一次按下后显示倒计时，3 秒内再按一次退出，否则取消 */
export function useDoubleCtrlCExit(exit: () => void) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
  }, []);

  const handleCtrlC = useCallback(() => {
    if (countdown !== null) {
      clearTimer();
      exit();
      return;
    }
    setCountdown(1);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearTimer();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [countdown, clearTimer, exit]);

  // 组件卸载时清理
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return { countdown, handleCtrlC };
}
