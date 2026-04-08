import { useState, useEffect } from 'react';

/**
 * 检测终端窗口是否处于激活（聚焦）状态。
 *
 * 利用终端 focus reporting 功能：
 * - 发送 \x1B[?1004h 开启 focus 事件上报
 * - 终端聚焦时发送 \x1B[I
 * - 终端失焦时发送 \x1B[O
 * - 退出时发送 \x1B[?1004l 关闭上报
 *
 * 支持的终端：iTerm2, kitty, WezTerm, Windows Terminal, xterm 等
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    // 开启 focus reporting
    process.stdout.write('\x1B[?1004h');

    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');
      if (str.includes('\x1B[I')) {
        setFocused(true);
      } else if (str.includes('\x1B[O')) {
        setFocused(false);
      }
    };

    process.stdin.on('data', onData);

    return () => {
      process.stdin.off('data', onData);
      // 关闭 focus reporting
      process.stdout.write('\x1B[?1004l');
    };
  }, []);

  return focused;
}
