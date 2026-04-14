import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Static, useInput, useApp } from 'ink';
import WelcomeHeader from '../components/WelcomeHeader.js';
import MessageViewport from '../components/MessageViewport.js';
import ComposerPane from '../components/ComposerPane.js';
import FooterPane from '../components/FooterPane.js';
import { ConfirmChoice } from '../components/DangerConfirm.js';
import { useWindowFocus } from '../hooks/useFocus.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { useDoubleCtrlCExit } from '../hooks/useDoubleCtrlCExit.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import { useStreamThrottle } from '../hooks/useStreamThrottle.js';
import { useSlashMenu } from '../hooks/useSlashMenu.js';
import { executeSlashCommand } from './slashCommands.js';
import { Message, LoopState, Session } from '../types/index.js';
import { QueryEngine, EngineCallbacks } from '../core/QueryEngine.js';
import { DangerConfirmResult } from '../core/query.js';
import { HIDE_WELCOME_AFTER_INPUT, getStartupWelcomeMessage } from '../config/constants.js';
import { generateAgentHint } from '../core/hint.js';
import { subscribeAgentCount, getActiveAgentCount } from '../core/spawnRegistry.js';
import { logError, logInfo, logWarn } from '../core/logger.js';
import { getAgentSubCommands } from '../commands/index.js';
import { setActiveAgent } from '../config/agentState.js';
import { buildShortcutHelpText } from '../config/shortcuts.js';
import { hideTerminalCursor, showTerminalCursor } from '../terminal/cursor.js';
import { resetTokenDisplay, setTokenDisplay } from '../hooks/useTokenDisplay.js';
import { resetSessionStartDisplay, setSessionStartDisplay } from '../hooks/useSessionStartDisplay.js';

interface REPLProps {
  initialResumeSessionId?: string;
}

export default function REPL({ initialResumeSessionId }: REPLProps) {
  const { exit } = useApp();
  const width = useTerminalWidth();
  const windowFocused = useWindowFocus();
  const buildExitHint = useCallback(() => {
    const sessionId = sessionRef.current.id?.trim();
    if (!sessionId) return '';
    const separatorWidth = Math.max(process.stdout.columns ?? 0, 80);
    const separator = '─'.repeat(separatorWidth);
    return `\n${separator}\n\nResume this session with:\njarvis --resume ${sessionId}\n\n`;
  }, []);
  const handleExit = useCallback(() => {
    const exitHint = buildExitHint();
    exit();
    setTimeout(() => {
      showTerminalCursor();
      if (exitHint) process.stdout.write(exitHint);
      process.exit(0);
    }, 50);
  }, [buildExitHint, exit]);
  const { countdown, handleCtrlC } = useDoubleCtrlCExit(handleExit);
  const { pushHistory, navigateUp, navigateDown, resetNavigation } = useInputHistory();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loopState, setLoopState] = useState<LoopState | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [placeholder, setPlaceholder] = useState('');
  const [activeAgents, setActiveAgents] = useState(getActiveAgentCount());
  const lastEscRef = useRef<number>(0);
  const abortRequestedRef = useRef(false);
  const lastAbortNoticeRef = useRef(0);

  const sessionRef = useRef<Session>({
    id: '', messages: [], createdAt: 0, updatedAt: 0, totalTokens: 0, totalCost: 0,
  });
  const engineRef = useRef<QueryEngine | null>(null);

  // 节流 hooks
  const {
    startStreamTimer,
    appendStreamChunk, clearStream,
    handleThinkingUpdate, finishThinking, thinkingIdRef, stopAll,
  } = useStreamThrottle(setMessages);

  const resetTokens = useCallback(() => {
    resetTokenDisplay();
  }, []);

  const appendAbortNotice = useCallback(() => {
    const now = Date.now();
    if (now - lastAbortNoticeRef.current < 800) return;
    lastAbortNoticeRef.current = now;
    setMessages((prev) => [...prev, {
      id: `abort-notice-${now}`,
      type: 'system',
      status: 'aborted',
      content: '已中断当前推理',
      timestamp: now,
      abortHint: '推理已中断（ESC）',
    }]);
  }, []);

  const markPendingMessagesAborted = useCallback(() => {
    setMessages((prev) => prev
      .filter((msg) => !(msg.type === 'thinking' && msg.status === 'pending'))
      .map((msg) => {
        if (msg.status !== 'pending') return msg;
        if (msg.type === 'tool_exec') {
          return {
            ...msg,
            status: 'aborted',
            content: `${msg.toolName || '工具'} 已中断`,
            abortHint: msg.abortHint ?? '命令已中断（ESC）',
          };
        }
        return msg;
      }));
    finishThinking();
    clearStream();
  }, [clearStream, finishThinking]);

  const requestAbort = useCallback(() => {
    if (!isProcessing || !engineRef.current || abortRequestedRef.current) return;
    abortRequestedRef.current = true;
    logWarn('ui.abort_by_escape');
    markPendingMessagesAborted();
    appendAbortNotice();
    engineRef.current.abort();
  }, [appendAbortNotice, isProcessing, markPendingMessagesAborted]);

  // ===== 新会话逻辑 =====
  const handleNewSession = useCallback(() => {
    logInfo('ui.new_session');
    if (engineRef.current) {
      engineRef.current.reset();
      sessionRef.current = engineRef.current.getSession();
      setSessionStartDisplay(sessionRef.current.createdAt);
    }
    setMessages([]);
    clearStream();
    setLoopState(null);
    setIsProcessing(false);
    abortRequestedRef.current = false;
    setShowWelcome(true);
    resetTokens();
    generateAgentHint().then((hint) => setPlaceholder(hint)).catch(() => {});
  }, [clearStream, resetTokens]);

  // 斜杠菜单
  const slashMenu = useSlashMenu({
    engineRef, sessionRef,
    setMessages,
    setTokenDisplay,
    setLoopState, setIsProcessing, setShowWelcome, setInput,
    stopAll,
    onNewSession: handleNewSession,
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
    setSessionStartDisplay(sessionRef.current.createdAt);
    // 注册持久 UI 回调，供 spawn_agent 后台子 Agent 跨轮次推送消息
    engineRef.current.registerUIBus(
      (msg) => setMessages((prev) => [...prev, msg]),
      (id, updates) => setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
      ),
    );
    generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
      logError('ui.hint.init_failed', err);
      console.error('[hint] 初始化提示失败:', err);
    });
    setMessages((prev) => (prev.length > 0 ? prev : [{
      id: `startup-welcome-${Date.now()}`,
      type: 'system',
      status: 'success',
      content: getStartupWelcomeMessage(),
      timestamp: Date.now(),
    }]));
    logInfo('ui.repl.mounted');
    return () => {
      logInfo('ui.repl.unmounted');
    };
  }, []);

  useEffect(() => {
    if (!initialResumeSessionId || !engineRef.current) return;

    const result = engineRef.current.loadSession(initialResumeSessionId);
    if (result) {
      stopAll();
      setMessages([
        ...result.messages,
        {
          id: `resume-cli-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: `已通过启动参数恢复会话 ${initialResumeSessionId.slice(0, 8)}...（${result.messages.length} 条消息）`,
          timestamp: Date.now(),
        },
      ]);
      sessionRef.current = result.session;
      setSessionStartDisplay(result.session.createdAt);
      setTokenDisplay(result.session.totalTokens);
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(false);
      logInfo('ui.resume_from_cli.success', {
        sessionId: initialResumeSessionId,
        messageCount: result.messages.length,
      });
      return;
    }

    setMessages((prev) => [...prev, {
      id: `resume-cli-error-${Date.now()}`,
      type: 'error',
      status: 'error',
      content: `启动时恢复会话失败：${initialResumeSessionId} 不存在或已损坏`,
      timestamp: Date.now(),
    }]);
    logWarn('ui.resume_from_cli.failed', { sessionId: initialResumeSessionId });
  }, [initialResumeSessionId, stopAll]);

  // 订阅后台 SubAgent 计数变化
  useEffect(() => {
    return subscribeAgentCount((count) => setActiveAgents(count));
  }, []);

  // ===== Engine Callbacks =====
  const callbacks: EngineCallbacks = {
    onMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onUpdateMessage: (id, updates) => {
      // thinking 消息流式内容更新（无 status 字段）
      if (updates.content !== undefined && !updates.status && thinkingIdRef.current === null) {
        handleThinkingUpdate(id, updates.content);
        return;
      }
      if (thinkingIdRef.current === id && updates.content !== undefined && !updates.status) {
        handleThinkingUpdate(id, updates.content);
        return;
      }
      // thinking 消息完成（带 status）
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
        startStreamTimer();
      } else {
        abortRequestedRef.current = false;
        stopAll();
      }
    },
    onSessionUpdate: (s) => {
      sessionRef.current = s;
      setTokenDisplay(s.totalTokens);
      setSessionStartDisplay(s.createdAt);
    },
    onConfirmDangerousCommand: (command, reason, ruleName) => {
      return new Promise<DangerConfirmResult>((resolve) => {
        setDangerConfirm({ command, reason, ruleName, resolve });
      });
    },
    onSubAgentMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onSubAgentUpdateMessage: (id, updates) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg)),
      );
    },
  };

  // ===== 提交处理 =====
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isProcessing || !engineRef.current) return;

      if (trimmed === '?') {
        setInput('');
        slashMenu.setSlashMenuVisible(false);
        if (HIDE_WELCOME_AFTER_INPUT) setShowWelcome(false);
        setMessages((prev) => [...prev, {
          id: `shortcut-help-${Date.now()}`,
          type: 'system',
          status: 'success',
          systemKind: 'shortcut_help',
          content: buildShortcutHelpText(),
          timestamp: Date.now(),
        }]);
        logInfo('ui.shortcut_help.open');
        return;
      }

      logInfo('ui.submit', {
        inputLength: trimmed.length,
        isSlashCommand: trimmed.startsWith('/'),
      });

      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;

        if (['exit', 'quit', 'bye'].includes(cmdName)) {
          setInput('');
          slashMenu.setSlashMenuVisible(false);
          handleExit();
          return;
        }

        // 内置命令
        if (['new', 'help', 'init', 'session_clear', 'permissions', 'skills', 'version'].includes(cmdName)) {
          setInput('');
          slashMenu.setSlashMenuVisible(false);

          if (cmdName === 'new') {
            handleNewSession();
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
            const msg = await executeSlashCommand(cmdName);
            if (msg) setMessages((prev) => [...prev, msg]);
          }
          return;
        }

        // /rewind
        if (cmdName === 'rewind') {
          if (hasArgs && engineRef.current) {
            setInput('');
            slashMenu.setSlashMenuVisible(false);
            const messageId = parts.slice(1).join(' ').trim();
            const result = engineRef.current.rewindToUserMessage(messageId);
            if (!result) {
              const errMsg: Message = {
                id: `rewind-err-${Date.now()}`,
                type: 'error',
                status: 'error',
                content: '未找到要回退的会话位置',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, errMsg]);
              return;
            }

            stopAll();
            setMessages([
              ...result.messages,
              {
                id: `rewind-${Date.now()}`,
                type: 'system',
                status: 'success',
                content: `已回退到当前会话的第 ${result.turnIndex} 条提问，请确认后重新发送。`,
                timestamp: Date.now(),
              },
            ]);
            sessionRef.current = result.session;
            setSessionStartDisplay(result.session.createdAt);
            setTokenDisplay(result.session.totalTokens);
            setLoopState(null);
            setIsProcessing(false);
            setShowWelcome(false);
            resetNavigation();
            setInput(result.input);
          } else {
            slashMenu.openListCommand('rewind');
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
          abortRequestedRef.current = false;
          await engineRef.current.handleQuery(prompt, callbacks);
          return;
        }

        // /agent
        if (cmdName === 'agent') {
          if (hasArgs) {
            const agentName = parts.slice(1).join(' ').trim().toLowerCase();
            const targetAgent = getAgentSubCommands().find((cmd) => cmd.name === agentName);
            setInput('');
            slashMenu.setSlashMenuVisible(false);

            if (!targetAgent) {
              const errMsg: Message = {
                id: `agent-not-found-${Date.now()}`,
                type: 'error',
                status: 'error',
                content: `未找到智能体: ${agentName}`,
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, errMsg]);
              return;
            }

            setActiveAgent(targetAgent.name);
            const switchMsg: Message = {
              id: `switch-${Date.now()}`,
              type: 'system',
              status: 'success',
              content: `已切换智能体为 ${targetAgent.name}，请重启以生效（Ctrl+C 两次退出后重新启动）`,
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, switchMsg]);
          } else {
            slashMenu.openListCommand('agent');
          }
          return;
        }

        // /resume
        if (cmdName === 'resume') {
          if (hasArgs && engineRef.current) {
            setInput('');
            slashMenu.setSlashMenuVisible(false);
            const sessionId = parts.slice(1).join(' ').trim();
            slashMenu.resumeSession(sessionId);
          } else {
            slashMenu.openListCommand('resume');
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
      abortRequestedRef.current = false;
      await engineRef.current.handleQuery(trimmed, callbacks);
    },
    [isProcessing, pushHistory, clearStream, slashMenu, handleNewSession, handleExit],
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

  const handleSlashMenuAutocomplete = useCallback(() => {
    slashMenu.autocompleteSlashMenuSelection(input);
  }, [slashMenu, input]);

  const handleSlashMenuSubmit = useCallback(async () => {
    const selected = slashMenu.getSelectedCommand();
    if (!selected) return;

    const completed = slashMenu.autocompleteSlashMenuSelection(input);
    if (selected.submitMode === 'context') {
      const parts = completed.trim().slice(1).split(/\s+/);
      const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;
      if (!hasArgs) return;
    }

    await handleSubmit(completed);
  }, [slashMenu, input, handleSubmit]);

  const handleEditorSubmit = useCallback(async (value: string) => {
    if (slashMenu.slashMenuVisible) {
      await handleSlashMenuSubmit();
      return;
    }
    await handleSubmit(value);
  }, [slashMenu.slashMenuVisible, handleSlashMenuSubmit, handleSubmit]);

  // Tab 填入 placeholder
  const handleTabFillPlaceholder = useCallback(() => {
    if (placeholder) {
      const match = placeholder.match(/^Try\s+"(.+)"$/);
      const text = match ? match[1] : placeholder;
      setInput(text);
    }
  }, [placeholder]);

  const handleResolveDangerConfirm = useCallback((choice: ConfirmChoice) => {
    if (!dangerConfirm) return;
    dangerConfirm.resolve(choice as DangerConfirmResult);
    setDangerConfirm(null);
  }, [dangerConfirm]);

  // ===== 隐藏系统默认终端光标，使用 ink 渲染的反色光标代替 =====
  useEffect(() => {
    hideTerminalCursor();
    return () => {
      showTerminalCursor();
    };
  }, []);

  // ===== processing 期间隐藏终端光标，阻止 IME composing 显示 =====
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;

  useEffect(() => {
    if (!isProcessing) return;

    // 隐藏终端光标 — 终端 IME 的 inline composing 仅在光标可见时渲染
    hideTerminalCursor();

    // 高优先级 stdin 拦截：吞掉 processing 期间的所有输入（Ctrl+C / ESC 除外）
    // 防止字符积累在缓冲区，processing 结束后污染输入框
    const drain = (data: Buffer | string) => {
      if (!isProcessingRef.current) return;
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      // 放行 Ctrl+C、ESC 和 Ctrl+O，其余全部吞掉
      if (raw === '\x03' || raw === '\x1B' || raw === '\x0F') return;
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
      if (key.escape) { requestAbort(); return; }
      if (key.ctrl && ch === 'o') { setShowDetails((prev) => !prev); return; }
      return; // 丢弃其他所有按键
    }
    if (key.ctrl && ch === 'c') { handleCtrlC(); return; }
    if (key.ctrl && ch === 'o') { setShowDetails((prev) => !prev); return; }
    if (key.ctrl && ch === 'l') {
      if (engineRef.current) {
        engineRef.current.reset();
        sessionRef.current = engineRef.current.getSession();
        setSessionStartDisplay(sessionRef.current.createdAt);
      }
      setMessages([]);
      clearStream();
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(true);
      resetTokens();
      generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
        logError('ui.hint.reset_failed', err);
        console.error('[hint] 重新生成提示失败:', err);
      });
      logInfo('ui.clear_screen_reset');
      return;
    }
    if (key.escape) {
      if (isProcessing) {
        requestAbort();
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
  // welcomeStaticItems: 用稳定 key 控制 Static 只打印一次；新会话时 key 变化触发重新打印
  const welcomeStaticItems = showWelcome ? [{ key: sessionRef.current.id || 'init', width }] : [];

  return (
    <Box flexDirection="column" width={width}>
      <Static items={welcomeStaticItems}>
        {(item) => <WelcomeHeader key={item.key} width={item.width} />}
      </Static>

      <Box marginTop={showWelcome ? 0 : 1}>
        <MessageViewport
          messages={messages}
          showDetails={showDetails}
          dangerConfirm={dangerConfirm}
          loopState={loopState}
          onResolveDangerConfirm={handleResolveDangerConfirm}
        />
      </Box>

      <ComposerPane
        width={width}
        countdown={countdown}
        isProcessing={isProcessing}
        input={input}
        placeholder={placeholder}
        windowFocused={windowFocused}
        slashMenuVisible={slashMenu.slashMenuVisible}
        slashMenuItems={slashMenu.slashMenuItems}
        slashMenuIndex={slashMenu.slashMenuIndex}
        onInputChange={handleInputChange}
        onSubmit={handleEditorSubmit}
        onUpArrow={handleUpArrow}
        onDownArrow={handleDownArrow}
        onSlashMenuUp={slashMenu.handleSlashMenuUp}
        onSlashMenuDown={slashMenu.handleSlashMenuDown}
        onSlashMenuSelect={handleSlashMenuAutocomplete}
        onSlashMenuClose={slashMenu.handleSlashMenuClose}
        onTabFillPlaceholder={handleTabFillPlaceholder}
      />

      <FooterPane
        width={width}
        activeAgents={activeAgents}
      />
    </Box>
  );
}
