import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import MultilineInput from '../components/MultilineInput';
import WelcomeHeader from '../components/WelcomeHeader';
import MessageItem from '../components/MessageItem';
import StreamingText from '../components/StreamingText';
import StatusBar from '../components/StatusBar';
import SlashCommandMenu from '../components/SlashCommandMenu';
import DangerConfirm, { ConfirmChoice } from '../components/DangerConfirm';
import { useWindowFocus } from '../hooks/useFocus';
import { useInputHistory } from '../hooks/useInputHistory';
import { useDoubleCtrlCExit } from '../hooks/useDoubleCtrlCExit';
import { useTerminalWidth } from '../hooks/useTerminalWidth';
import { useStreamThrottle } from '../hooks/useStreamThrottle';
import { useTokenDisplay } from '../hooks/useTokenDisplay';
import { useSlashMenu } from '../hooks/useSlashMenu';
import { executeSlashCommand } from './slashCommands';
import { Message, LoopState, Session } from '../types/index';
import { QueryEngine, EngineCallbacks } from '../core/QueryEngine';
import { DangerConfirmResult } from '../core/query';
import { HIDE_WELCOME_AFTER_INPUT } from '../config/constants';
import { generateAgentHint } from '../core/hint';

export default function REPL() {
  const { exit } = useApp();
  const width = useTerminalWidth();
  const windowFocused = useWindowFocus();
  const { countdown, handleCtrlC } = useDoubleCtrlCExit(exit);
  const { pushHistory, navigateUp, navigateDown, resetNavigation } = useInputHistory();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loopState, setLoopState] = useState<LoopState | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [placeholder, setPlaceholder] = useState('');
  const lastEscRef = useRef<number>(0);

  const sessionRef = useRef<Session>({
    id: '', messages: [], createdAt: 0, updatedAt: 0, totalTokens: 0, totalCost: 0,
  });
  const engineRef = useRef<QueryEngine | null>(null);

  // 节流 hooks
  const {
    streamText, streamBufferRef,
    startStreamTimer, stopStreamTimer,
    appendStreamChunk, clearStream,
    handleThinkingUpdate, finishThinking, thinkingIdRef, stopAll,
  } = useStreamThrottle(setMessages);

  const {
    displayTokens, tokenCountRef,
    startTokenTimer, stopTokenTimer,
    updateTokenCount, resetTokens,
  } = useTokenDisplay();

  // 斜杠菜单
  const slashMenu = useSlashMenu({
    engineRef, sessionRef, tokenCountRef,
    setMessages,
    setDisplayTokens: (n: number) => updateTokenCount(n),
    setStreamText: clearStream,
    streamBufferRef,
    setLoopState, setIsProcessing, setShowWelcome, setInput,
  });

  // 危险命令确认
  const [dangerConfirm, setDangerConfirm] = useState<{
    command: string;
    reason: string;
    ruleName: string;
    resolve: (choice: DangerConfirmResult) => void;
  } | null>(null);

  useEffect(() => {
    engineRef.current = new QueryEngine();
    sessionRef.current = engineRef.current.getSession();
    generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
      console.error('[hint] 初始化提示失败:', err);
    });
  }, []);

  // ===== Engine Callbacks =====
  const callbacks: EngineCallbacks = {
    onMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onUpdateMessage: (id, updates) => {
      if (updates.content !== undefined && !updates.status && thinkingIdRef.current === null) {
        handleThinkingUpdate(id, updates.content);
        return;
      }
      if (thinkingIdRef.current === id && updates.content !== undefined && !updates.status) {
        handleThinkingUpdate(id, updates.content);
        return;
      }
      if (thinkingIdRef.current === id && updates.status) {
        finishThinking();
      }
      setMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg)),
      );
    },
    onStreamText: (text) => {
      appendStreamChunk(text);
    },
    onClearStreamText: () => {
      clearStream();
    },
    onLoopStateChange: (state) => {
      setLoopState(state);
      setIsProcessing(state.isRunning);
      if (state.isRunning) {
        startTokenTimer();
        startStreamTimer();
      } else {
        stopTokenTimer();
        stopAll();
      }
    },
    onSessionUpdate: (s) => {
      sessionRef.current = s;
      updateTokenCount(s.totalTokens);
    },
    onConfirmDangerousCommand: (command, reason, ruleName) => {
      return new Promise<DangerConfirmResult>((resolve) => {
        setDangerConfirm({ command, reason, ruleName, resolve });
      });
    },
  };

  // ===== 提交处理 =====
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isProcessing || !engineRef.current) return;

      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;

        // 内置命令
        if (['new', 'help', 'init', 'session_clear', 'permissions', 'skills', 'version'].includes(cmdName)) {
          setInput('');
          slashMenu.setSlashMenuVisible(false);

          if (cmdName === 'new') {
            // 新会话：重置引擎 + 清空所有状态
            if (engineRef.current) {
              engineRef.current.reset();
              sessionRef.current = engineRef.current.getSession();
            }
            setMessages([]);
            clearStream();
            setLoopState(null);
            setIsProcessing(false);
            setShowWelcome(true);
            resetTokens();
            generateAgentHint().then((hint) => setPlaceholder(hint)).catch(() => {});
          } else if (cmdName === 'session_clear') {
            if (engineRef.current) {
              const count = engineRef.current.clearOtherSessions();
              const resultMsg: Message = {
                id: `session-clear-${Date.now()}`,
                type: 'system',
                status: 'success',
                content: count > 0
                  ? `已清理 ${count} 个历史会话，当前会话保留。`
                  : '当前没有需要清理的历史会话。',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, resultMsg]);
            }
          } else {
            const msg = executeSlashCommand(cmdName);
            if (msg) setMessages((prev) => [...prev, msg]);
          }
          return;
        }

        // /create_skill
        if (cmdName === 'create_skill') {
          setInput('');
          slashMenu.setSlashMenuVisible(false);
          const skillArgs = parts.slice(1).join(' ').trim();
          if (!skillArgs) {
            const hintMsg: Message = {
              id: `create-skill-hint-${Date.now()}`,
              type: 'system',
              status: 'success',
              content: '用法: /create_skill <描述你想创建的 skill>\n\n例如:\n  /create_skill 一个可以查询天气的工具\n  /create_skill 代码格式化工具，支持 Python 和 JS',
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, hintMsg]);
            return;
          }
          const prompt = `请使用 create_skill 工具帮我创建一个新的 skill。需求如下：${skillArgs}\n\n请根据需求自动生成合适的 name、description、instruction，如果需要 Python 实现也请生成 skill.py 代码。`;
          if (HIDE_WELCOME_AFTER_INPUT) setShowWelcome(false);
          pushHistory(trimmed);
          clearStream();
          await engineRef.current.handleQuery(prompt, callbacks);
          return;
        }

        // /resume
        if (cmdName === 'resume') {
          setInput('');
          slashMenu.setSlashMenuVisible(false);
          if (hasArgs && engineRef.current) {
            const sessionId = parts.slice(1).join(' ').trim();
            slashMenu.resumeSession(sessionId);
          } else {
            const sessions = QueryEngine.listSessions().slice(0, 20);
            if (sessions.length === 0) {
              const noMsg: Message = {
                id: `resume-empty-${Date.now()}`,
                type: 'system',
                status: 'success',
                content: '暂无历史会话',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, noMsg]);
            } else {
              const lines = sessions.map((s, i) => {
                const date = new Date(s.updatedAt);
                const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                return `  ${i + 1}. [${dateStr}] ${s.summary}\n     ID: ${s.id}`;
              });
              const listMsg: Message = {
                id: `resume-list-${Date.now()}`,
                type: 'system',
                status: 'success',
                content: `历史会话（最近 ${sessions.length} 条）:\n\n${lines.join('\n\n')}\n\n使用 /resume <ID> 恢复指定会话`,
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, listMsg]);
            }
          }
          return;
        }

        // 工具命令带参数：继续走正常提交流程；无参数则忽略
        if (!hasArgs) return;
      }

      if (HIDE_WELCOME_AFTER_INPUT) setShowWelcome(false);
      pushHistory(trimmed);
      setInput('');
      clearStream();
      await engineRef.current.handleQuery(trimmed, callbacks);
    },
    [isProcessing, pushHistory, clearStream, resetTokens, slashMenu],
  );

  // ===== 输入处理 =====
  const handleUpArrow = useCallback(() => {
    const result = navigateUp(input);
    if (result !== null) setInput(result);
  }, [navigateUp, input]);

  const handleDownArrow = useCallback(() => {
    const result = navigateDown();
    if (result !== null) setInput(result);
  }, [navigateDown]);

  const handleInputChange = useCallback((val: string) => {
    resetNavigation();
    setInput(val);
    slashMenu.updateSlashMenu(val);
  }, [resetNavigation, slashMenu]);

  // Tab 填入 placeholder
  const handleTabFillPlaceholder = useCallback(() => {
    if (placeholder) {
      const match = placeholder.match(/^Try\s+"(.+)"$/);
      const text = match ? match[1] : placeholder;
      setInput(text);
    }
  }, [placeholder]);

  // ===== 隐藏系统默认终端光标，使用 ink 渲染的反色光标代替 =====
  useEffect(() => {
    process.stdout.write('\x1B[?25l');
    return () => {
      process.stdout.write('\x1B[?25h');
    };
  }, []);

  // ===== processing/streaming 期间，每次 re-render 后将物理光标移到行首 =====
  // ink 每次渲染后光标停在 StatusBar 行末，macOS IME 会在该位置显示 composing 候选框，
  // 导致候选框与进度条重叠。将光标移到列 1（行首）让候选框出现在屏幕左侧空白区域。
  useEffect(() => {
    if (!isProcessing) return;
    process.stdout.write('\x1B[1G');
  });

  // ===== processing 期间隐藏终端光标，阻止 IME composing 显示 =====
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;

  useEffect(() => {
    if (!isProcessing) return;

    // 隐藏终端光标 — 终端 IME 的 inline composing 仅在光标可见时渲染
    process.stdout.write('\x1B[?25l');

    // 高优先级 stdin 拦截：吞掉 processing 期间的所有输入（Ctrl+C / ESC 除外）
    // 防止字符积累在缓冲区，processing 结束后污染输入框
    const drain = (data: Buffer | string) => {
      if (!isProcessingRef.current) return;
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      // 放行 Ctrl+C 和 ESC，其余全部吞掉
      if (raw === '\x03' || raw === '\x1B') return;
      // 清空 Buffer 内容（仅当确实是 Buffer 时），减少后续处理的干扰
      if (Buffer.isBuffer(data)) data.fill(0);
    };
    process.stdin.prependListener('data', drain);

    return () => {
      process.stdin.removeListener('data', drain);
      // 注意：不在此处恢复终端光标，由 repl.tsx 顶层 useEffect 统一管理
      // drain stdin 缓冲区，丢弃 processing 期间积累的数据
      if (typeof (process.stdin as any).read === 'function') {
        while ((process.stdin as any).read() !== null) { /* drain */ }
      }
    };
  }, [isProcessing]);

  // ===== 快捷键 =====
  useInput((ch, key) => {
    // processing 状态下，仅允许 Ctrl+C（退出）和 ESC（中断）
    if (isProcessing) {
      if (key.ctrl && ch === 'c') { handleCtrlC(); return; }
      if (key.escape && engineRef.current) { engineRef.current.abort(); return; }
      return; // 丢弃其他所有按键
    }
    if (key.tab && slashMenu.slashMenuVisible) { slashMenu.handleSlashMenuSelect(); return; }
    if (key.ctrl && ch === 'c') { handleCtrlC(); return; }
    if (key.ctrl && ch === 'o') { setShowDetails((prev) => !prev); return; }
    if (key.ctrl && ch === 'l') {
      if (engineRef.current) {
        engineRef.current.reset();
        sessionRef.current = engineRef.current.getSession();
      }
      setMessages([]);
      clearStream();
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(true);
      resetTokens();
      generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
        console.error('[hint] 重新生成提示失败:', err);
      });
      return;
    }
    if (key.escape) {
      if (isProcessing && engineRef.current) {
        engineRef.current.abort();
      } else if (input.length > 0) {
        const now = Date.now();
        if (now - lastEscRef.current < 500) {
          setInput('');
          lastEscRef.current = 0;
        } else {
          lastEscRef.current = now;
        }
      }
      return;
    }
  });

  // ===== 渲染 =====
  return (
    <Box flexDirection="column" width={width}>
      {showWelcome && <WelcomeHeader width={width} />}

      <Box flexDirection="column" paddingX={1} marginTop={showWelcome ? 0 : 1}>
        {messages.map((msg) => (
          <MessageItem key={msg.id} msg={msg} showDetails={showDetails} />
        ))}
        {streamText && <StreamingText text={streamText} />}
        {dangerConfirm && (
          <DangerConfirm
            command={dangerConfirm.command}
            reason={dangerConfirm.reason}
            ruleName={dangerConfirm.ruleName}
            onSelect={(choice: ConfirmChoice) => {
              dangerConfirm.resolve(choice as DangerConfirmResult);
              setDangerConfirm(null);
            }}
          />
        )}
        {loopState?.isRunning && (
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="gray"> iteration {loopState.iteration}/{loopState.maxIterations}</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Text color="gray">{'─'.repeat(Math.max(width - 2, 1))}</Text>
        {slashMenu.slashMenuVisible && !isProcessing && (
          <SlashCommandMenu
            commands={slashMenu.slashMenuItems}
            selectedIndex={slashMenu.slashMenuIndex}
          />
        )}
        <Box>
          {countdown !== null ? (
            <Box>
              <Text color="gray" dimColor>❯ </Text>
              <Text color="yellow">Press </Text>
              <Text color="yellow" bold>Ctrl+C</Text>
              <Text color="yellow"> again to exit </Text>
              <Text color="gray" dimColor>({countdown}s)</Text>
            </Box>
          ) : isProcessing ? (
            <Box>
              <Text color="cyan" bold>❯ </Text>
              <Text color="yellow"><Spinner type="dots" /></Text>
              <Text color="gray" italic> processing...</Text>
            </Box>
          ) : (
            <Box>
              <Text color="cyan" bold>❯ </Text>
              <MultilineInput
                value={input}
                onChange={handleInputChange}
                onSubmit={handleSubmit}
                onUpArrow={handleUpArrow}
                onDownArrow={handleDownArrow}
                placeholder={placeholder}
                isActive={!isProcessing}
                showCursor={windowFocused && !isProcessing}
                slashMenuActive={slashMenu.slashMenuVisible}
                onSlashMenuUp={slashMenu.handleSlashMenuUp}
                onSlashMenuDown={slashMenu.handleSlashMenuDown}
                onSlashMenuSelect={slashMenu.handleSlashMenuSelect}
                onSlashMenuClose={slashMenu.handleSlashMenuClose}
                onTabFillPlaceholder={handleTabFillPlaceholder}
              />
            </Box>
          )}
        </Box>
        <Text color="gray">{'─'.repeat(Math.max(width - 2, 1))}</Text>
        <StatusBar width={width - 2} totalTokens={displayTokens} />
      </Box>
    </Box>
  );
}
