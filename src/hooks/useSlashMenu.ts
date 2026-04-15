import { useState, useCallback } from 'react';
import { Message } from '../types/index.js';
import { QueryEngine } from '../core/QueryEngine.js';
import { filterCommands, filterAgentCommands, SlashCommand } from '../commands/index.js';

interface UseSlashMenuOptions {
  engineRef: React.RefObject<QueryEngine | null>;
  sessionRef: React.MutableRefObject<import('../types/index.js').Session>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setTokenDisplay: (n: number) => void;
  setLoopState: React.Dispatch<React.SetStateAction<import('../types/index.js').LoopState | null>>;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** resume 时重置所有流式状态（含 thinkingIdRef） */
  stopAll: () => void;
  /** /new 命令：开启新会话 */
  onNewSession: () => void;
}

/**
 * 斜杠命令菜单状态管理 hook
 *
 * 管理菜单可见性、选中项、二级菜单（agent / resume）等。
 */
export function useSlashMenu(opts: UseSlashMenuOptions) {
  const {
    engineRef, sessionRef,
    setMessages, setTokenDisplay,
    setLoopState, setIsProcessing, setShowWelcome, setInput, stopAll,
  } = opts;

  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const [slashMenuItems, setSlashMenuItems] = useState<SlashCommand[]>([]);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [agentMenuMode, setAgentMenuMode] = useState(false);
  const [resumeMenuMode, setResumeMenuMode] = useState(false);
  const [rewindMenuMode, setRewindMenuMode] = useState(false);

  // 上移
  const handleSlashMenuUp = useCallback(() => {
    setSlashMenuIndex((prev) => (prev > 0 ? prev - 1 : slashMenuItems.length - 1));
  }, [slashMenuItems.length]);

  // 下移
  const handleSlashMenuDown = useCallback(() => {
    setSlashMenuIndex((prev) => (prev < slashMenuItems.length - 1 ? prev + 1 : 0));
  }, [slashMenuItems.length]);

  // 关闭
  const handleSlashMenuClose = useCallback(() => {
    if (agentMenuMode || resumeMenuMode || rewindMenuMode) {
      setAgentMenuMode(false);
      setResumeMenuMode(false);
      setRewindMenuMode(false);
      setInput('/');
      const matched = filterCommands('');
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setSlashMenuVisible(matched.length > 0);
    } else {
      setSlashMenuVisible(false);
    }
  }, [agentMenuMode, resumeMenuMode, rewindMenuMode, setInput]);

  // 恢复会话的通用逻辑
  const resumeSession = useCallback((sessionId: string) => {
    if (!engineRef.current) return;
    const result = engineRef.current.loadSession(sessionId);
    if (result) {
      // 先重置所有流式状态（含 thinkingIdRef），避免旧 id 残留导致新会话 thinking 永不结束
      stopAll();
      setMessages(result.messages);
      sessionRef.current = result.session;
      setTokenDisplay(result.session.totalTokens);
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(true);
      const resumeMsg: Message = {
        id: `resume-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: `已恢复会话 ${sessionId.slice(0, 8)}...（${result.messages.length} 条消息）`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, resumeMsg]);
    } else {
      const errMsg: Message = {
        id: `resume-err-${Date.now()}`,
        type: 'error',
        status: 'error',
        content: `会话 ${sessionId} 不存在或已损坏`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    }
  }, [engineRef, sessionRef, setMessages, setTokenDisplay, stopAll, setLoopState, setIsProcessing, setShowWelcome]);

  const getSelectedCommand = useCallback((): SlashCommand | null => {
    if (slashMenuItems.length === 0) return null;
    return slashMenuItems[slashMenuIndex] ?? null;
  }, [slashMenuItems, slashMenuIndex]);

  const buildRewindItems = useCallback((): SlashCommand[] => {
    if (!engineRef.current) return [];
    return engineRef.current.getCurrentSessionUserTurns()
      .slice()
      .map((turn) => {
        const date = new Date(turn.timestamp);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const question = turn.input.replace(/\s+/g, ' ').slice(0, 32);
        const answer = turn.answerPreview.replace(/\s+/g, ' ').slice(0, 24);
        return {
          name: turn.messageId,
          displayName: `rewind-${turn.turnIndex}`,
          description: `[Q${turn.turnIndex} ${dateStr}] ${question}${answer ? ` ｜ A: ${answer}` : ''}`,
          category: 'builtin' as const,
          submitMode: 'action' as const,
        };
      });
  }, [engineRef]);

  const openListCommand = useCallback((commandName: 'agent' | 'resume' | 'rewind') => {
    if (commandName === 'agent') {
      setInput('/agent ');
      const matched = filterAgentCommands('');
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setAgentMenuMode(true);
      setResumeMenuMode(false);
      setRewindMenuMode(false);
      setSlashMenuVisible(matched.length > 0);
      return '/agent ';
    }

    if (commandName === 'rewind') {
      const items = buildRewindItems();
      setInput('/rewind ');
      setSlashMenuItems(items);
      setSlashMenuIndex(0);
      setSlashMenuVisible(items.length > 0);
      setRewindMenuMode(true);
      setResumeMenuMode(false);
      setAgentMenuMode(false);
      return '/rewind ';
    }

    const sessions = QueryEngine.listSessions().slice(0, 20);
    const items: SlashCommand[] = sessions.map((s) => {
      const date = new Date(s.updatedAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      return {
        name: s.id,
        description: `[${dateStr}] ${s.summary}`,
        category: 'builtin' as const,
        submitMode: 'action' as const,
      };
    });
    setInput('/resume ');
    setSlashMenuItems(items);
    setSlashMenuIndex(0);
    setSlashMenuVisible(items.length > 0);
    setResumeMenuMode(true);
    setAgentMenuMode(false);
    setRewindMenuMode(false);
    return '/resume ';
  }, [setInput, buildRewindItems]);

  const autocompleteSlashMenuSelection = useCallback((currentInput: string) => {
    const cmd = getSelectedCommand();
    if (!cmd) return currentInput;

    // 二级 agent 菜单
    if (agentMenuMode) {
      const nextInput = `/agent ${cmd.name}`;
      setInput(nextInput);
      setSlashMenuVisible(false);
      return nextInput;
    }

    // 二级 resume 菜单
    if (resumeMenuMode) {
      const nextInput = `/resume ${cmd.name}`;
      setInput(nextInput);
      setSlashMenuVisible(false);
      return nextInput;
    }

    if (rewindMenuMode) {
      const nextInput = `/rewind ${cmd.name}`;
      setInput(nextInput);
      setSlashMenuVisible(false);
      return nextInput;
    }

    const match = currentInput.match(/^\/\S*/);
    const suffix = match ? currentInput.slice(match[0].length) : '';
    const needsTrailingSpace = !suffix && (cmd.submitMode === 'context' || cmd.submitMode === 'list');
    const nextInput = `/${cmd.name}${suffix}${needsTrailingSpace ? ' ' : ''}`;

    setInput(nextInput);

    if (cmd.submitMode === 'list' && (cmd.name === 'agent' || cmd.name === 'resume' || cmd.name === 'rewind') && !suffix.trim()) {
      return openListCommand(cmd.name);
    }

    updateSlashMenu(nextInput);
    return nextInput;
  }, [agentMenuMode, resumeMenuMode, rewindMenuMode, getSelectedCommand, setInput, openListCommand]);

  // 输入变化时更新菜单
  const updateSlashMenu = useCallback((val: string) => {
    if (val.startsWith('/') && !val.includes('\n')) {
      const query = val.slice(1);

      // /agent 二级菜单
      if (/^agent\s/i.test(query)) {
        const subQuery = query.replace(/^agent\s*/i, '');
        const matched = filterAgentCommands(subQuery);
        setSlashMenuItems(matched);
        setSlashMenuIndex(0);
        setSlashMenuVisible(matched.length > 0);
        setAgentMenuMode(true);
        setResumeMenuMode(false);
        return;
      }

      // /resume 二级菜单
      if (/^resume\s/i.test(query)) {
        const subQuery = query.replace(/^resume\s*/i, '').toLowerCase();
        const sessions = QueryEngine.listSessions().slice(0, 20);
        const items: SlashCommand[] = sessions.map((s) => {
          const date = new Date(s.updatedAt);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        return {
          name: s.id,
          description: `[${dateStr}] ${s.summary}`,
          category: 'builtin' as const,
          submitMode: 'action' as const,
        };
      });
        const matched = subQuery
          ? items.filter((i) => i.name.includes(subQuery) || i.description.toLowerCase().includes(subQuery))
          : items;
        setSlashMenuItems(matched);
        setSlashMenuIndex(0);
        setSlashMenuVisible(matched.length > 0);
        setResumeMenuMode(true);
        setAgentMenuMode(false);
        setRewindMenuMode(false);
        return;
      }

      // /rewind 二级菜单
      if (/^rewind\s/i.test(query)) {
        const subQuery = query.replace(/^rewind\s*/i, '').toLowerCase();
        const items = buildRewindItems();
        const matched = subQuery
          ? items.filter((i) => i.name.includes(subQuery) || (i.displayName ?? '').toLowerCase().includes(subQuery) || i.description.toLowerCase().includes(subQuery))
          : items;
        setSlashMenuItems(matched);
        setSlashMenuIndex(0);
        setSlashMenuVisible(matched.length > 0);
        setRewindMenuMode(true);
        setResumeMenuMode(false);
        setAgentMenuMode(false);
        return;
      }

      // 一级菜单
      const matched = filterCommands(query);
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setSlashMenuVisible(matched.length > 0);
      setAgentMenuMode(false);
      setResumeMenuMode(false);
      setRewindMenuMode(false);
    } else {
      setSlashMenuVisible(false);
      setAgentMenuMode(false);
      setResumeMenuMode(false);
      setRewindMenuMode(false);
    }
  }, [buildRewindItems]);

  return {
    slashMenuVisible,
    slashMenuItems,
    slashMenuIndex,
    agentMenuMode,
    resumeMenuMode,
    rewindMenuMode,
    handleSlashMenuUp,
    handleSlashMenuDown,
    handleSlashMenuClose,
    getSelectedCommand,
    autocompleteSlashMenuSelection,
    openListCommand,
    updateSlashMenu,
    setSlashMenuVisible,
    resumeSession,
  };
}
