import { useState, useCallback, useRef, useEffect } from 'react';
import { Message } from '../types/index';

const STREAM_FLUSH_INTERVAL = 80; // ms
const THINKING_FLUSH_INTERVAL = 100; // ms

/**
 * 流式文本 + thinking 文本节流 hook
 *
 * 用 ref 积累 chunk，定时刷新到 state，减少 re-render 频率。
 */
export function useStreamThrottle(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
) {
  const [streamText, setStreamText] = useState('');

  // 流式文本节流
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // thinking 文本节流
  const thinkingBufferRef = useRef('');
  const thinkingIdRef = useRef<string | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 启动流式文本节流定时器
  const startStreamTimer = useCallback(() => {
    if (streamTimerRef.current) return;
    streamTimerRef.current = setInterval(() => {
      if (streamBufferRef.current) {
        const buf = streamBufferRef.current;
        streamBufferRef.current = '';
        setStreamText((prev) => prev + buf);
      }
    }, STREAM_FLUSH_INTERVAL);
  }, []);

  const stopStreamTimer = useCallback(() => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    if (streamBufferRef.current) {
      const buf = streamBufferRef.current;
      streamBufferRef.current = '';
      setStreamText((prev) => prev + buf);
    }
  }, []);

  // 启动 thinking 文本节流定时器
  const startThinkingTimer = useCallback(() => {
    if (thinkingTimerRef.current) return;
    thinkingTimerRef.current = setInterval(() => {
      const id = thinkingIdRef.current;
      const buf = thinkingBufferRef.current;
      if (id && buf) {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === id ? { ...msg, content: buf } : msg)),
        );
      }
    }, THINKING_FLUSH_INTERVAL);
  }, [setMessages]);

  const stopThinkingTimer = useCallback(() => {
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    const id = thinkingIdRef.current;
    const buf = thinkingBufferRef.current;
    if (id && buf) {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, content: buf } : msg)),
      );
    }
  }, [setMessages]);

  /** 追加流式文本到 buffer（不直接 setState） */
  const appendStreamChunk = useCallback((text: string) => {
    streamBufferRef.current += text;
  }, []);

  /** 清空流式文本（每轮迭代结束时调用） */
  const clearStream = useCallback(() => {
    streamBufferRef.current = '';
    setStreamText('');
  }, []);

  /** 处理 thinking 消息的 content 更新 */
  const handleThinkingUpdate = useCallback((id: string, content: string) => {
    if (thinkingIdRef.current === null) {
      thinkingIdRef.current = id;
      thinkingBufferRef.current = content;
      startThinkingTimer();
    } else {
      thinkingBufferRef.current = content;
    }
  }, [startThinkingTimer]);

  /** thinking 完成时调用 */
  const finishThinking = useCallback(() => {
    stopThinkingTimer();
    thinkingIdRef.current = null;
    thinkingBufferRef.current = '';
  }, [stopThinkingTimer]);

  /** 全部停止（loop 结束时调用） */
  const stopAll = useCallback(() => {
    stopStreamTimer();
    stopThinkingTimer();
    thinkingIdRef.current = null;
    thinkingBufferRef.current = '';
    streamBufferRef.current = '';
    setStreamText('');
  }, [stopStreamTimer, stopThinkingTimer]);

  // 组件卸载时清理
  useEffect(() => () => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
  }, []);

  return {
    streamText,
    streamBufferRef,
    startStreamTimer,
    stopStreamTimer,
    startThinkingTimer,
    stopThinkingTimer,
    appendStreamChunk,
    clearStream,
    handleThinkingUpdate,
    finishThinking,
    thinkingIdRef,
    stopAll,
  };
}
