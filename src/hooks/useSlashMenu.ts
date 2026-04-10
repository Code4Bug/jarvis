import { useState, useCallback } from 'react';
import { Message } from '../types/index';
import { QueryEngine } from '../core/QueryEngine';
import { filterCommands, filterAgentCommands, SlashCommand } from '../commands/index';
import { setActiveAgent } from '../config/agentState';
import { executeSlashCommand } from '../screens/slashCommands';

interface UseSlashMenuOptions {
  engineRef: React.RefObject<QueryEngine | null>;
  sessionRef: React.MutableRefObject<import('../types/index').Session>;
  tokenCountRef: React.MutableRefObject<number>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setDisplayTokens: (n: number) => void;
  setStreamText: (s: string) => void;
  streamBufferRef: React.MutableRefObject<string>;
  setLoopState: React.Dispatch<React.SetStateAction<import('../types/index').LoopState | null>>;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcome: React.Dispatch<React.SetStateAction<boolean>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * 斜杠命令菜单状态管理 hook
 *
 * 管理菜单可见性、选中项、二级菜单（agent / resume）等。
 */
export function useSlashMenu(opts: UseSlashMenuOptions) {
  const {
    engineRef, sessionRef, tokenCountRef,
    setMessages, setDisplayTokens, setStreamText, streamBufferRef,
    setLoopState, setIsProcessing, setShowWelcome, setInput,
  } = opts;

  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const [slashMenuItems, setSlashMenuItems] = useState<SlashCommand[]>([]);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [agentMenuMode, setAgentMenuMode] = useState(false);
  const [resumeMenuMode, setResumeMenuMode] = useState(false);

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
    if (agentMenuMode || resumeMenuMode) {
      setAgentMenuMode(false);
      setResumeMenuMode(false);
      setInput('/');
      const matched = filterCommands('');
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setSlashMenuVisible(matched.length > 0);
    } else {
      setSlashMenuVisible(false);
    }
  }, [agentMenuMode, resumeMenuMode, setInput]);

  // 恢复会话的通用逻辑
  const resumeSession = useCallback((sessionId: string) => {
    if (!engineRef.current) return;
    const result = engineRef.current.loadSession(sessionId);
    if (result) {
      setMessages(result.messages);
      sessionRef.current = result.session;
      tokenCountRef.current = result.session.totalTokens;
      setDisplayTokens(result.session.totalTokens);
      setStreamText('');
      streamBufferRef.current = '';
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(false);
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
  }, [engineRef, sessionRef, tokenCountRef, setMessages, setDisplayTokens, setStreamText, streamBufferRef, setLoopState, setIsProcessing, setShowWelcome]);

  // 选中
  const handleSlashMenuSelect = useCallback(() => {
    if (slashMenuItems.length === 0) return;
    const cmd = slashMenuItems[slashMenuIndex];
    if (!cmd) return;

    // 二级 agent 菜单
    if (agentMenuMode) {
      setActiveAgent(cmd.name);
      setInput('');
      setSlashMenuVisible(false);
      setAgentMenuMode(false);
      const switchMsg: Message = {
        id: `switch-${Date.now()}`,
        type: 'system',
        status: 'success',
        content: `已切换智能体为 ${cmd.name}，请重启以生效（Ctrl+C 两次退出后重新启动）`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, switchMsg]);
      return;
    }

    // 二级 resume 菜单
    if (resumeMenuMode) {
      setInput('');
      setSlashMenuVisible(false);
      setResumeMenuMode(false);
      resumeSession(cmd.name);
      return;
    }

    // 一级菜单选中 /agent -> 进入二级菜单
    if (cmd.name === 'agent') {
      setInput('/agent ');
      const matched = filterAgentCommands('');
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setAgentMenuMode(true);
      setResumeMenuMode(false);
      return;
    }

    // 一级菜单选中 /resume -> 进入二级菜单
    if (cmd.name === 'resume') {
      setInput('/resume ');
      const sessions = QueryEngine.listSessions().slice(0, 20);
      const items: SlashCommand[] = sessions.map((s) => {
        const date = new Date(s.updatedAt);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        return {
          name: s.id,
          description: `[${dateStr}] ${s.summary}`,
          category: 'builtin' as const,
        };
      });
      setSlashMenuItems(items);
      setSlashMenuIndex(0);
      setSlashMenuVisible(items.length > 0);
      setResumeMenuMode(true);
      setAgentMenuMode(false);
      return;
    }

    // 内置命令：直接执行
    if (cmd.category === 'builtin') {
      setInput('');
      setSlashMenuVisible(false);
      const msg = executeSlashCommand(cmd.name);
      if (msg) setMessages((prev) => [...prev, msg]);
      return;
    }

    // 工具命令：填入输入框
    setInput(`/${cmd.name} `);
    setSlashMenuVisible(false);
  }, [slashMenuItems, slashMenuIndex, agentMenuMode, resumeMenuMode, setInput, setMessages, resumeSession]);

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
        return;
      }

      // 一级菜单
      const matched = filterCommands(query);
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setSlashMenuVisible(matched.length > 0);
      setAgentMenuMode(false);
      setResumeMenuMode(false);
    } else {
      setSlashMenuVisible(false);
      setAgentMenuMode(false);
      setResumeMenuMode(false);
    }
  }, []);

  return {
    slashMenuVisible,
    slashMenuItems,
    slashMenuIndex,
    agentMenuMode,
    resumeMenuMode,
    handleSlashMenuUp,
    handleSlashMenuDown,
    handleSlashMenuSelect,
    handleSlashMenuClose,
    updateSlashMenu,
    setSlashMenuVisible,
    resumeSession,
  };
}
