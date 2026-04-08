import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import MultilineInput from '../components/MultilineInput.js';
import WelcomeHeader from '../components/WelcomeHeader.js';
import MessageItem from '../components/MessageItem.js';
import StreamingText from '../components/StreamingText.js';
import StatusBar from '../components/StatusBar.js';
import SlashCommandMenu from '../components/SlashCommandMenu.js';
import DangerConfirm, { ConfirmChoice } from '../components/DangerConfirm.js';
import { useWindowFocus } from '../hooks/useFocus.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { Message, LoopState, Session } from '../types/index.js';
import { QueryEngine, EngineCallbacks } from '../core/QueryEngine.js';
import { DangerConfirmResult } from '../core/query.js';
import { HIDE_WELCOME_AFTER_INPUT, APP_VERSION } from '../config/constants.js';
import { generateAgentHint } from '../core/hint.js';
import { filterCommands, filterAgentCommands, SlashCommand } from '../commands/index.js';
import { setActiveAgent } from '../config/agentState.js';
import { allTools } from '../tools/index.js';
import { listSkills } from '../skills/index.js';
import { getExternalSkillsDir } from '../skills/loader.js';
import {
  listPermanentAuthorizations,
  DANGER_RULES,
} from '../core/safeguard.js';
import { executeInit } from '../commands/init.js';

/** 双击 Ctrl+C 退出：第一次按下后显示倒计时，3 秒内再按一次退出，否则取消 */
function useDoubleCtrlCExit(exit: () => void) {
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
      // 第二次按下，立即退出
      clearTimer();
      exit();
      return;
    }
    // 第一次按下，启动 1 秒倒计时
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

/** 响应式终端宽度，resize 时清屏防止残留 */
function useTerminalWidth(): number {
  const [width, setWidth] = useState(() => process.stdout.columns || 80);

  useEffect(() => {
    const onResize = () => {
      process.stdout.write('\x1Bc');
      setWidth(process.stdout.columns || 80);
    };
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  return width;
}

export default function REPL() {
  const { exit } = useApp();
  const width = useTerminalWidth();
  const windowFocused = useWindowFocus();
  const { countdown, handleCtrlC } = useDoubleCtrlCExit(exit);
  const { pushHistory, navigateUp, navigateDown, resetNavigation } = useInputHistory();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamText, setStreamText] = useState('');
  // 流式文本节流：用 ref 积累 chunk，定时刷新到 state，减少 re-render 频率
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const STREAM_FLUSH_INTERVAL = 80; // ms
  const [loopState, setLoopState] = useState<LoopState | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [session, setSession] = useState<Session>({
    id: '', messages: [], createdAt: 0, updatedAt: 0, totalTokens: 0, totalCost: 0,
  });
  const [showDetails, setShowDetails] = useState(false);
  // 双击 ESC 清空输入：记录首次 ESC 时间戳
  const lastEscRef = useRef<number>(0);
  // 动态 placeholder：启动时通过 LLM 生成符合角色的提示
  const [placeholder, setPlaceholder] = useState('');

  // ===== 斜杠命令菜单状态 =====
  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const [slashMenuItems, setSlashMenuItems] = useState<SlashCommand[]>([]);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  // 是否处于 /agent 二级菜单
  const [agentMenuMode, setAgentMenuMode] = useState(false);
  // 是否处于 /resume 二级菜单
  const [resumeMenuMode, setResumeMenuMode] = useState(false);

  // ===== 危险命令确认状态 =====
  const [dangerConfirm, setDangerConfirm] = useState<{
    command: string;
    reason: string;
    ruleName: string;
    resolve: (choice: DangerConfirmResult) => void;
  } | null>(null);

  const engineRef = useRef<QueryEngine | null>(null);

  // 用 ref 缓存 token 计数，定时器驱动 UI 刷新，避免每个 chunk 都触发 re-render
  const tokenCountRef = useRef<number>(0);
  const tokenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [displayTokens, setDisplayTokens] = useState(0);

  useEffect(() => {
    engineRef.current = new QueryEngine();
    setSession(engineRef.current.getSession());
    // 异步生成符合当前角色的输入提示
    generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
      console.error('[hint] 初始化提示失败:', err);
    });
  }, []);

  // 启动 token 进度条定时刷新（每 100ms 同步一次 ref → state）
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
    // 最终同步一次，确保最终值准确
    setDisplayTokens(tokenCountRef.current);
  }, []);

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
    // 最终刷新残余
    if (streamBufferRef.current) {
      const buf = streamBufferRef.current;
      streamBufferRef.current = '';
      setStreamText((prev) => prev + buf);
    }
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => () => {
    if (tokenTimerRef.current) clearInterval(tokenTimerRef.current);
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
  }, []);

  const callbacks: EngineCallbacks = {
    onMessage: (msg) => {
      setMessages((prev) => [...prev, msg]);
    },
    onUpdateMessage: (id, updates) =>
      setMessages((prev) =>
        prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg)),
      ),
    onStreamText: (text) => {
      // 不直接 setState，而是积累到 buffer，由定时器批量刷新
      streamBufferRef.current += text;
    },
    onClearStreamText: () => {
      // 每轮迭代结束时清空流式文本，避免 streamText 被后续工具消息挤到底部
      streamBufferRef.current = '';
      setStreamText('');
    },
    onLoopStateChange: (state) => {
      setLoopState(state);
      setIsProcessing(state.isRunning);
      if (state.isRunning) {
        startTokenTimer();
        startStreamTimer();
      } else {
        stopTokenTimer();
        stopStreamTimer();
        setStreamText('');
        streamBufferRef.current = '';
      }
    },
    onSessionUpdate: (s) => {
      // 仅更新 ref 中的 token 计数，不触发 re-render（由定时器驱动）
      tokenCountRef.current = s.totalTokens;
      setSession({ ...s });
    },
    onConfirmDangerousCommand: (command, reason, ruleName) => {
      return new Promise<DangerConfirmResult>((resolve) => {
        setDangerConfirm({ command, reason, ruleName, resolve });
      });
    },
  };

  // ===== 斜杠命令执行器 =====
  const executeSlashCommand = useCallback((cmdName: string) => {
    switch (cmdName) {
      case 'init': {
        const result = executeInit();
        const initMsg: Message = {
          id: `init-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: result.displayText,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, initMsg]);
        break;
      }

      case 'new':
        // 新会话：重置引擎 + 清空所有状态
        if (engineRef.current) {
          engineRef.current.reset();
          setSession(engineRef.current.getSession());
        }
        setMessages([]);
        setStreamText('');
        streamBufferRef.current = '';
        setLoopState(null);
        setIsProcessing(false);
        setShowWelcome(true);
        tokenCountRef.current = 0;
        setDisplayTokens(0);
        generateAgentHint().then((hint) => setPlaceholder(hint)).catch(() => {});
        break;

      case 'help': {
        const helpText = [
          '可用命令:',
          '  /init        初始化项目信息，生成 JARVIS.md',
          '  /new         开启新会话，重新初始化上下文',
          '  /resume      恢复历史会话（支持二级菜单选择）',
          '  /resume <ID> 直接恢复指定会话',
          '  /help        显示此帮助信息',
          '  /session_clear 清理所有非当前会话的历史记录',
          '  /skills      查看当前所有 tools 和 skills',
          '  /permissions 查看所有持久化授权列表',
          '  /create_skill <描述> 根据需求创建新 skill',
          '  /agent <名称> 切换智能体（需重启生效）',
          '  /read <路径>  读取文件内容',
          '  /write <路径> 写入文件',
          '  /bash <命令>  执行 Bash 命令',
          '  /ls <路径>    列出目录',
          '  /search <词>  搜索文件内容',
          '  /version     显示当前版本号',
          '',
          '快捷键:',
          '  Ctrl+L       清屏重置',
          '  Ctrl+O       切换详情显示',
          '  ESC          中断推理 / 双击清空输入',
          '  Ctrl+C ×2    退出',
        ].join('\n');
        const helpMsg: Message = {
          id: `help-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: helpText,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, helpMsg]);
        break;
      }

      case 'session_clear': {
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
        break;
      }

      case 'permissions': {
        const perms = listPermanentAuthorizations();
        const lines: string[] = ['持久化授权列表 (~/.jarvis/.permissions.json)', ''];
        if (perms.rules.length > 0) {
          lines.push('按规则授权:');
          for (const r of perms.rules) {
            const rule = DANGER_RULES.find((d) => d.name === r);
            lines.push(`  [v] ${r}${rule ? ` — ${rule.reason}` : ''}`);
          }
          lines.push('');
        }
        if (perms.commands.length > 0) {
          lines.push('按命令授权:');
          for (const c of perms.commands) {
            lines.push(`  [v] [${c.ruleName}] ${c.command} (${c.grantedAt})`);
          }
          lines.push('');
        }
        if (perms.rules.length === 0 && perms.commands.length === 0) {
          lines.push('(空) 暂无持久化授权记录');
        }
        const permMsg: Message = {
          id: `perms-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: lines.join('\n'),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, permMsg]);
        break;
      }

      case 'skills': {
        const skills = listSkills();
        const parts: string[] = [];

        parts.push('### Built-in Tools\n');
        allTools.forEach((t, i) => {
          parts.push(`${i + 1}. \`${t.name}\` - ${t.description.slice(0, 60)}`);
        });

        parts.push('');
        parts.push(`### External Skills\n`);
        parts.push(`> ${getExternalSkillsDir()}\n`);

        if (skills.length === 0) {
          parts.push('_(empty)_');
        } else {
          skills.forEach((s, i) => {
            const hint = s.meta.argumentHint ? ` \`${s.meta.argumentHint}\`` : '';
            const flags: string[] = [];
            if (s.meta.disableModelInvocation) flags.push('manual-only');
            if (s.meta.userInvocable === false) flags.push('hidden');
            const flagStr = flags.length > 0 ? ` _(${flags.join(', ')})_` : '';
            parts.push(`${i + 1}. \`${s.meta.name}\`${hint} - ${s.meta.description}${flagStr}`);
          });
        }

        parts.push('');
        parts.push(`**Total:** ${allTools.length} tools + ${skills.length} skills = ${allTools.length + skills.length}`);

        const skillsMsg: Message = {
          id: `skills-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: parts.join('\n'),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, skillsMsg]);
        break;
      }

      case 'version': {
        const versionMsg: Message = {
          id: `version-${Date.now()}`,
          type: 'system',
          status: 'success',
          content: `当前版本: ${APP_VERSION}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, versionMsg]);
        break;
      }

      default:
        break;
    }
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isProcessing || !engineRef.current) return;

      // 斜杠命令拦截
      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmdName = parts[0].toLowerCase();
        const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;

        // 内置命令：直接执行
        if (['new', 'help', 'init', 'session_clear', 'permissions', 'skills', 'version'].includes(cmdName)) {
          setInput('');
          setSlashMenuVisible(false);
          executeSlashCommand(cmdName);
          return;
        }

        // /create_skill 命令：将需求转发给 LLM，由 LLM 调用 create_skill 工具完成
        if (cmdName === 'create_skill') {
          setInput('');
          setSlashMenuVisible(false);
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
          // 构造提示，让 LLM 使用 create_skill 工具
          const prompt = `请使用 create_skill 工具帮我创建一个新的 skill。需求如下：${skillArgs}\n\n请根据需求自动生成合适的 name、description、instruction，如果需要 Python 实现也请生成 skill.py 代码。`;
          if (HIDE_WELCOME_AFTER_INPUT) setShowWelcome(false);
          pushHistory(trimmed);
          setStreamText('');
          await engineRef.current.handleQuery(prompt, callbacks);
          return;
        }

        // /resume 命令处理
        if (cmdName === 'resume') {
          setInput('');
          setSlashMenuVisible(false);
          setResumeMenuMode(false);
          if (hasArgs && engineRef.current) {
            // /resume <id> 直接恢复
            const sessionId = parts.slice(1).join(' ').trim();
            const result = engineRef.current.loadSession(sessionId);
            if (result) {
              setMessages(result.messages);
              setSession(result.session);
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
          } else {
            // /resume 无参数：显示会话列表
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

        // /permissions 命令：查看持久化授权列表
        if (cmdName === 'permissions') {
          setInput('');
          setSlashMenuVisible(false);
          const perms = listPermanentAuthorizations();
          const lines: string[] = ['持久化授权列表 (~/.jarvis/.permissions.json)', ''];
          if (perms.rules.length > 0) {
            lines.push('按规则授权:');
            for (const r of perms.rules) {
              const rule = DANGER_RULES.find((d) => d.name === r);
              lines.push(`  [v] ${r}${rule ? ` — ${rule.reason}` : ''}`);
            }
            lines.push('');
          }
          if (perms.commands.length > 0) {
            lines.push('按命令授权:');
            for (const c of perms.commands) {
              lines.push(`  [v] [${c.ruleName}] ${c.command} (${c.grantedAt})`);
            }
            lines.push('');
          }
          if (perms.rules.length === 0 && perms.commands.length === 0) {
            lines.push('(空) 暂无持久化授权记录');
          }
          const listMsg: Message = {
            id: `perms-${Date.now()}`,
            type: 'system',
            status: 'success',
            content: lines.join('\n'),
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, listMsg]);
          return;
        }

        // 工具命令带参数：去掉 / 前缀，作为消息发给 LLM
        if (hasArgs) {
          // 继续走正常提交流程
        } else {
          // 无参数的 / 命令，忽略
          return;
        }
      }

      if (HIDE_WELCOME_AFTER_INPUT) setShowWelcome(false);
      pushHistory(trimmed);
      setInput('');
      setStreamText('');
      await engineRef.current.handleQuery(trimmed, callbacks);
    },
    [isProcessing, pushHistory, executeSlashCommand],
  );

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

    // 检测斜杠命令：输入以 / 开头且为单行
    if (val.startsWith('/') && !val.includes('\n')) {
      const query = val.slice(1); // 去掉 /

      // /agent 二级菜单：输入 "/agent " 或 "/agent xxx" 时显示智能体列表
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

      // /resume 二级菜单：输入 "/resume " 或 "/resume xxx" 时显示历史会话列表
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
  }, [resetNavigation]);

  // 斜杠菜单：上移
  const handleSlashMenuUp = useCallback(() => {
    setSlashMenuIndex((prev) => (prev > 0 ? prev - 1 : slashMenuItems.length - 1));
  }, [slashMenuItems.length]);

  // 斜杠菜单：下移
  const handleSlashMenuDown = useCallback(() => {
    setSlashMenuIndex((prev) => (prev < slashMenuItems.length - 1 ? prev + 1 : 0));
  }, [slashMenuItems.length]);

  // 斜杠菜单：选中
  const handleSlashMenuSelect = useCallback(() => {
    if (slashMenuItems.length === 0) return;
    const cmd = slashMenuItems[slashMenuIndex];
    if (!cmd) return;

    // 二级 agent 菜单：执行切换
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

    // 二级 resume 菜单：恢复会话
    if (resumeMenuMode) {
      setInput('');
      setSlashMenuVisible(false);
      setResumeMenuMode(false);
      if (engineRef.current) {
        const result = engineRef.current.loadSession(cmd.name);
        if (result) {
          setMessages(result.messages);
          setSession(result.session);
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
            content: `已恢复会话 ${cmd.name.slice(0, 8)}...（${result.messages.length} 条消息）`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, resumeMsg]);
        } else {
          const errMsg: Message = {
            id: `resume-err-${Date.now()}`,
            type: 'error',
            status: 'error',
            content: `会话 ${cmd.name} 不存在或已损坏`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, errMsg]);
        }
      }
      return;
    }

    // 一级菜单选中 /agent → 进入二级菜单
    if (cmd.name === 'agent') {
      setInput('/agent ');
      const matched = filterAgentCommands('');
      setSlashMenuItems(matched);
      setSlashMenuIndex(0);
      setAgentMenuMode(true);
      setResumeMenuMode(false);
      return;
    }

    // 一级菜单选中 /resume → 进入二级菜单
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
      executeSlashCommand(cmd.name);
      return;
    }

    // 工具命令：填入输入框，等用户补充参数
    setInput(`/${cmd.name} `);
    setSlashMenuVisible(false);
  }, [slashMenuItems, slashMenuIndex, agentMenuMode, resumeMenuMode, executeSlashCommand]);

  // 斜杠菜单：关闭
  const handleSlashMenuClose = useCallback(() => {
    if (agentMenuMode || resumeMenuMode) {
      // 二级菜单 ESC → 回到一级菜单
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
  }, [agentMenuMode, resumeMenuMode]);

  // 快捷键
  useInput((ch, key) => {
    if (key.tab && slashMenuVisible) { handleSlashMenuSelect(); return; }
    if (key.ctrl && ch === 'c') { handleCtrlC(); return; }
    if (key.ctrl && ch === 'o') { setShowDetails((prev) => !prev); return; }
    if (key.ctrl && ch === 'l') {
      if (engineRef.current) {
        engineRef.current.reset();
        setSession(engineRef.current.getSession());
      }
      setMessages([]);
      setStreamText('');
      streamBufferRef.current = '';
      setLoopState(null);
      setIsProcessing(false);
      setShowWelcome(true);
      tokenCountRef.current = 0;
      setDisplayTokens(0);
      // 重新生成角色提示
      generateAgentHint().then((hint) => setPlaceholder(hint)).catch((err) => {
        console.error('[hint] 重新生成提示失败:', err);
      });
      return;
    }
    if (key.escape) {
      if (isProcessing && engineRef.current) {
        // 推理中按 ESC：中断推理，流式文本停止后由 query 层标记最后一条消息为 aborted
        engineRef.current.abort();
      } else if (input.length > 0) {
        // 输入框有内容：双击 ESC（500ms 内）清空
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
        {slashMenuVisible && !isProcessing && (
          <SlashCommandMenu
            commands={slashMenuItems}
            selectedIndex={slashMenuIndex}
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
                slashMenuActive={slashMenuVisible}
                onSlashMenuUp={handleSlashMenuUp}
                onSlashMenuDown={handleSlashMenuDown}
                onSlashMenuSelect={handleSlashMenuSelect}
                onSlashMenuClose={handleSlashMenuClose}
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
