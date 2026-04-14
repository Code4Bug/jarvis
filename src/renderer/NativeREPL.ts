/**
 * 原生终端 REPL
 *
 * 完全替代 Ink 的 React 组件树，使用原生 ANSI 转义序列渲染。
 * 核心设计：
 *   1. 消息区 append-only，输出后不再重绘
 *   2. 流式区域（thinking + streaming）可反复重绘，但不影响上方消息
 *   3. 底部区域（输入框 + 状态栏）可反复重绘
 *   4. 流式结束后，内容固化为消息，无清屏闪烁
 */

import { TerminalRenderer, BottomState } from './TerminalRenderer.js';
import { NativeInputHandler, InputCallbacks } from './NativeInputHandler.js';
import { formatMessage } from './MessagePrinter.js';
import { renderMarkdownToAnsi } from './markdownRenderer.js';
import { buildStatusBar } from './StatusBarBuilder.js';
import { printWelcome } from './WelcomePrinter.js';
import { InputHistory } from './InputHistory.js';
import { SlashMenuManager } from './SlashMenuManager.js';
import * as ansi from './ansi.js';
import { Message, Session } from '../types/index.js';
import { QueryEngine, EngineCallbacks } from '../core/QueryEngine.js';
import { DangerConfirmResult } from '../core/query.js';
import { HIDE_WELCOME_AFTER_INPUT, getStartupWelcomeMessage } from '../config/constants.js';
import { generateAgentHint } from '../core/hint.js';
import { subscribeAgentCount } from '../core/spawnRegistry.js';
import { logError, logInfo, logWarn } from '../core/logger.js';
import { getAgentSubCommands } from '../commands/index.js';
import { setActiveAgent } from '../config/agentState.js';
import { buildShortcutHelpText } from '../config/shortcuts.js';
import { executeSlashCommand } from '../screens/slashCommands.js';

const STREAM_FLUSH_INTERVAL = 150;
const THINKING_FLUSH_INTERVAL = 100;

export class NativeREPL {
  private renderer: TerminalRenderer;
  private inputHandler: NativeInputHandler;
  private engine: QueryEngine;
  private session: Session;
  private history: InputHistory;
  private slashMenu: SlashMenuManager;

  private messages: Message[] = [];
  private renderedMessageCount = 0;
  private isProcessing = false;
  private showWelcome = true;
  private showDetails = false;
  private placeholder = '';
  private activeAgents = 0;
  private totalTokens = 0;
  private sessionStartedAt = 0;

  // 双击退出
  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;
  private countdown: number | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  // 流式节流
  private streamBuffer = '';
  private streamTimer: ReturnType<typeof setInterval> | null = null;
  private thinkingBuffer = '';
  private thinkingId: string | null = null;
  private thinkingTimer: ReturnType<typeof setInterval> | null = null;
  private lastThinkingFlush = '';
  private currentStreamText = '';
  private currentThinkingText = '';

  // 中断
  private abortRequested = false;
  private lastAbortNotice = 0;

  // 危险确认
  private dangerConfirmActive = false;
  private dangerConfirmIndex = 3;
  private dangerConfirmResolve: ((choice: DangerConfirmResult) => void) | null = null;
  private dangerCommand = '';
  private dangerReason = '';
  private dangerRuleName = '';

  private bottomRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private loopIteration = 0;
  private loopMaxIterations = 0;

  constructor(initialResumeSessionId?: string) {
    this.renderer = new TerminalRenderer();
    this.history = new InputHistory();
    this.engine = new QueryEngine();
    this.session = this.engine.getSession();
    this.sessionStartedAt = this.session.createdAt;
    this.slashMenu = new SlashMenuManager(this.engine);

    this.engine.registerUIBus(
      (msg) => { this.messages.push(msg); this.flushNewMessages(); },
      (id, updates) => { this.updateMessage(id, updates); },
    );

    const cb: InputCallbacks = {
      onSubmit: (v) => { this.handleSubmit(v).catch((e) => logError('ui.submit.error', e)); },
      onInputChange: (v) => { this.slashMenu.update(v); this.inputHandler.setSlashMenuActive(this.slashMenu.visible); this.refreshBottom(); },
      onUpArrow: () => this.handleUpArrow(),
      onDownArrow: () => this.handleDownArrow(),
      onCtrlC: () => this.handleCtrlC(),
      onEscape: () => this.handleEscape(),
      onCtrlO: () => { this.showDetails = !this.showDetails; this.refreshBottom(); },
      onCtrlL: () => this.handleClearScreen(),
      onTab: () => this.handleTab(),
      onSlashMenuUp: () => { this.slashMenu.moveUp(); this.refreshBottom(); },
      onSlashMenuDown: () => { this.slashMenu.moveDown(); this.refreshBottom(); },
      onSlashMenuSelect: () => this.handleSlashMenuAutocomplete(),
      onSlashMenuClose: () => this.handleSlashMenuClose(),
      onDangerConfirmUp: () => this.moveDangerConfirm(-1),
      onDangerConfirmDown: () => this.moveDangerConfirm(1),
      onDangerConfirmSelect: () => this.selectDangerConfirm(),
      onDangerConfirmCancel: () => this.resolveDangerConfirm('cancel'),
    };

    this.inputHandler = new NativeInputHandler(cb);
    if (initialResumeSessionId) this.handleInitialResume(initialResumeSessionId);
  }

  start(): void {
    process.stdout.write(ansi.hideCursor());
    ansi.enableBracketedPaste();

    if (this.showWelcome) printWelcome(this.renderer.getWidth());

    if (this.messages.length === 0) {
      this.messages.push({ id: `startup-welcome-${Date.now()}`, type: 'system', status: 'success', content: getStartupWelcomeMessage(), timestamp: Date.now() });
    }

    this.flushNewMessages();
    this.inputHandler.start();
    this.refreshBottom();
    this.bottomRefreshTimer = setInterval(() => this.refreshBottom(), 1000);
    subscribeAgentCount((count) => { this.activeAgents = count; this.refreshBottom(); });
    generateAgentHint().then((h) => { this.placeholder = h; this.refreshBottom(); }).catch((e) => logError('ui.hint.init_failed', e));
    logInfo('ui.repl.mounted');
  }

  stop(): void {
    this.inputHandler.stop();
    this.stopAllTimers();
    if (this.bottomRefreshTimer) { clearInterval(this.bottomRefreshTimer); this.bottomRefreshTimer = null; }
    ansi.disableBracketedPaste();
    process.stdout.write(ansi.showCursor());
  }

  // ===== 消息渲染 =====

  private flushNewMessages(): void {
    this.renderer.clearStreamAndBottom();
    while (this.renderedMessageCount < this.messages.length) {
      const msg = this.messages[this.renderedMessageCount];
      const lines = formatMessage(msg, this.showDetails);
      for (const line of lines) this.renderer.writeLine(' ' + line);
      this.renderedMessageCount++;
    }
    if (this.currentStreamText || this.currentThinkingText) {
      this.renderer.renderStream(this.currentThinkingText, this.renderStreamMd(this.currentStreamText));
    }
    this.refreshBottom();
  }

  private updateMessage(id: string, updates: Partial<Message>): void {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx !== -1) this.messages[idx] = { ...this.messages[idx], ...updates };
  }

  private renderStreamMd(text: string): string {
    return text ? renderMarkdownToAnsi(text) : '';
  }

  private fullRedraw(): void {
    process.stdout.write(ansi.clearScreen() + ansi.cursorPosition(1, 1));
    if (this.showWelcome) printWelcome(this.renderer.getWidth());
    this.renderedMessageCount = 0;
    this.flushNewMessages();
  }

  // ===== 流式节流 =====

  private startStreamTimer(): void {
    if (this.streamTimer) return;
    this.streamTimer = setInterval(() => {
      if (!this.streamBuffer) return;
      this.currentStreamText += this.streamBuffer;
      this.streamBuffer = '';
      this.renderer.clearStreamAndBottom();
      this.renderer.renderStream(this.currentThinkingText, this.renderStreamMd(this.currentStreamText));
      this.refreshBottom();
    }, STREAM_FLUSH_INTERVAL);
  }

  private startThinkingTimer(): void {
    if (this.thinkingTimer) return;
    this.thinkingTimer = setInterval(() => {
      if (!this.thinkingBuffer || this.thinkingBuffer === this.lastThinkingFlush) return;
      this.lastThinkingFlush = this.thinkingBuffer;
      this.currentThinkingText = this.thinkingBuffer;
      this.renderer.clearStreamAndBottom();
      this.renderer.renderStream(this.currentThinkingText, this.renderStreamMd(this.currentStreamText));
      this.refreshBottom();
    }, THINKING_FLUSH_INTERVAL);
  }

  private stopAllTimers(): void {
    if (this.streamTimer) { clearInterval(this.streamTimer); this.streamTimer = null; }
    if (this.streamBuffer) { this.currentStreamText += this.streamBuffer; this.streamBuffer = ''; }
    if (this.thinkingTimer) { clearInterval(this.thinkingTimer); this.thinkingTimer = null; }
    this.stopSpinner();
    this.thinkingId = null;
    this.thinkingBuffer = '';
    this.lastThinkingFlush = '';
    this.streamBuffer = '';
    this.currentStreamText = '';
    this.currentThinkingText = '';
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerFrame = 0;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame++;
      this.refreshBottom();
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
    this.spinnerFrame = 0;
  }

  private clearStream(): void {
    this.streamBuffer = '';
    this.currentStreamText = '';
    this.renderer.clearStreamAndBottom();
    this.refreshBottom();
  }

  private handleThinkingUpdate(id: string, content: string): void {
    if (this.thinkingId === null) { this.thinkingId = id; this.thinkingBuffer = content; this.startThinkingTimer(); }
    else { this.thinkingBuffer = content; }
  }

  private finishThinking(): void {
    if (this.thinkingTimer) { clearInterval(this.thinkingTimer); this.thinkingTimer = null; }
    this.thinkingId = null;
    this.thinkingBuffer = '';
    this.lastThinkingFlush = '';
    this.currentThinkingText = '';
  }

  // ===== 底部渲染 =====

  private refreshBottom(): void {
    const state: BottomState = {
      input: this.inputHandler.getValue(),
      cursor: this.inputHandler.getCursor(),
      placeholder: this.placeholder,
      isProcessing: this.isProcessing,
      countdown: this.countdown,
      showCursor: !this.isProcessing,
      slashMenu: this.slashMenu.visible ? {
        items: this.slashMenu.items.map((c) => ({ name: c.name, displayName: c.displayName, description: c.description, category: c.category })),
        selectedIndex: this.slashMenu.index,
        maxVisible: 6,
      } : null,
      statusBarText: buildStatusBar(this.renderer.getWidth() - 2, this.totalTokens, this.activeAgents, this.sessionStartedAt),
      loopIteration: this.loopIteration,
      loopMaxIterations: this.loopMaxIterations,
      spinnerFrame: this.spinnerFrame,
    };
    this.renderer.renderBottom(state);
  }

  // ===== Engine Callbacks =====

  private getCallbacks(): EngineCallbacks {
    return {
      onMessage: (msg) => { this.messages.push(msg); this.flushNewMessages(); },
      onUpdateMessage: (id, updates) => {
        if (updates.content !== undefined && !updates.status && (this.thinkingId === null || this.thinkingId === id)) {
          this.handleThinkingUpdate(id, updates.content);
          return;
        }
        if (this.thinkingId === id && updates.status) this.finishThinking();
        this.updateMessage(id, updates);
      },
      onStreamText: (text) => { this.streamBuffer += text; },
      onClearStreamText: () => { this.clearStream(); },
      onLoopStateChange: (state) => {
        this.isProcessing = state.isRunning;
        this.loopIteration = state.iteration;
        this.loopMaxIterations = state.maxIterations;
        this.inputHandler.setProcessing(state.isRunning);
        if (state.isRunning) {
          this.startStreamTimer();
          this.startSpinner();
          this.refreshBottom();
        } else {
          this.abortRequested = false;
          this.stopAllTimers();
          this.loopIteration = 0;
          this.loopMaxIterations = 0;
          this.renderer.finalizeStream();
          this.refreshBottom();
        }
      },
      onSessionUpdate: (s) => { this.session = s; this.totalTokens = s.totalTokens; this.sessionStartedAt = s.createdAt; this.refreshBottom(); },
      onConfirmDangerousCommand: (command, reason, ruleName) => new Promise<DangerConfirmResult>((resolve) => {
        this.dangerConfirmActive = true;
        this.inputHandler.setDangerConfirmActive(true);
        this.dangerConfirmIndex = 3;
        this.dangerConfirmResolve = resolve;
        this.dangerCommand = command;
        this.dangerReason = reason;
        this.dangerRuleName = ruleName;
        this.renderer.clearStreamAndBottom();
        this.renderer.renderDangerConfirm(command, reason, ruleName, this.dangerConfirmIndex);
        this.refreshBottom();
      }),
      onSubAgentMessage: (msg) => { this.messages.push(msg); this.flushNewMessages(); },
      onSubAgentUpdateMessage: (id, updates) => { this.updateMessage(id, updates); },
    };
  }

  // ===== 输入处理 =====

  private async handleSubmit(value: string): Promise<void> {
    // 斜杠菜单激活时，Enter = 先补全选中项再提交
    if (this.slashMenu.visible) {
      const selected = this.slashMenu.getSelected();
      if (!selected) return;
      const { nextInput, needsList } = this.slashMenu.autocomplete(this.inputHandler.getValue());
      if (needsList) {
        // list 类型命令（如 /agent、/resume 无参数时）只打开列表，不提交
        this.inputHandler.setValue(this.slashMenu.openList(needsList as 'agent' | 'resume' | 'rewind'));
        this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
        this.refreshBottom();
        return;
      }
      // context 类型命令需要有参数才能提交
      if (selected.submitMode === 'context') {
        const parts = nextInput.trim().slice(1).split(/\s+/);
        const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;
        if (!hasArgs) return;
      }
      this.inputHandler.setValue(nextInput);
      this.slashMenu.visible = false;
      this.inputHandler.setSlashMenuActive(false);
      value = nextInput;
    }

    const trimmed = value.trim();
    if (!trimmed || this.isProcessing || this.dangerConfirmActive) return;

    if (trimmed === '?') {
      this.inputHandler.setValue('');
      this.slashMenu.visible = false;
      if (HIDE_WELCOME_AFTER_INPUT) this.showWelcome = false;
      this.messages.push({ id: `shortcut-help-${Date.now()}`, type: 'system', status: 'success', systemKind: 'shortcut_help', content: buildShortcutHelpText(), timestamp: Date.now() });
      this.flushNewMessages();
      return;
    }

    logInfo('ui.submit', { inputLength: trimmed.length, isSlashCommand: trimmed.startsWith('/') });

    if (trimmed.startsWith('/')) {
      const handled = await this.handleSlashCommand(trimmed);
      if (handled) return;
    }

    if (HIDE_WELCOME_AFTER_INPUT) this.showWelcome = false;
    this.history.push(trimmed);
    this.inputHandler.setValue('');
    this.clearStream();
    this.abortRequested = false;
    await this.engine.handleQuery(trimmed, this.getCallbacks());
  }

  private async handleSlashCommand(trimmed: string): Promise<boolean> {
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const hasArgs = parts.length > 1 && parts.slice(1).join('').length > 0;

    if (['exit', 'quit', 'bye'].includes(cmd)) { this.inputHandler.setValue(''); this.slashMenu.visible = false; this.handleExit(); return true; }

    if (['new', 'help', 'init', 'session_clear', 'permissions', 'skills', 'version'].includes(cmd)) {
      this.inputHandler.setValue('');
      this.slashMenu.visible = false;
      if (cmd === 'new') { this.handleNewSession(); }
      else if (cmd === 'session_clear') {
        const count = this.engine.clearOtherSessions();
        this.messages.push({ id: `session-clear-${Date.now()}`, type: 'system', status: 'success', content: count > 0 ? `已清理 ${count} 个历史会话，当前会话保留。` : '当前没有需要清理的历史会话。', timestamp: Date.now() });
        this.flushNewMessages();
      } else {
        const msg = await executeSlashCommand(cmd);
        if (msg) { this.messages.push(msg); this.flushNewMessages(); }
      }
      return true;
    }

    if (cmd === 'rewind') {
      if (hasArgs) {
        this.inputHandler.setValue(''); this.slashMenu.visible = false;
        const messageId = parts.slice(1).join(' ').trim();
        const result = this.engine.rewindToUserMessage(messageId);
        if (!result) { this.messages.push({ id: `rewind-err-${Date.now()}`, type: 'error', status: 'error', content: '未找到要回退的会话位置', timestamp: Date.now() }); this.flushNewMessages(); return true; }
        this.stopAllTimers();
        this.messages = [...result.messages, { id: `rewind-${Date.now()}`, type: 'system', status: 'success', content: `已回退到当前会话的第 ${result.turnIndex} 条提问，请确认后重新发送。`, timestamp: Date.now() }];
        this.renderedMessageCount = 0;
        this.session = result.session; this.sessionStartedAt = result.session.createdAt; this.totalTokens = result.session.totalTokens;
        this.isProcessing = false; this.inputHandler.setProcessing(false); this.showWelcome = false;
        this.history.resetIndex(); this.inputHandler.setValue(result.input);
        this.fullRedraw();
        return true;
      }
      this.inputHandler.setValue(this.slashMenu.openList('rewind'));
      this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
      this.refreshBottom();
      return true;
    }

    if (cmd === 'create_skill') {
      this.inputHandler.setValue(''); this.slashMenu.visible = false;
      const skillArgs = parts.slice(1).join(' ').trim();
      if (!skillArgs) { this.messages.push({ id: `create-skill-hint-${Date.now()}`, type: 'system', status: 'success', content: '用法: /create_skill <描述你想创建的 skill>', timestamp: Date.now() }); this.flushNewMessages(); return true; }
      const prompt = `请使用 create_skill 工具帮我创建一个新的 skill。需求如下：${skillArgs}`;
      if (HIDE_WELCOME_AFTER_INPUT) this.showWelcome = false;
      this.history.push(trimmed); this.clearStream(); this.abortRequested = false;
      await this.engine.handleQuery(prompt, this.getCallbacks());
      return true;
    }

    if (cmd === 'agent') {
      if (hasArgs) {
        const agentName = parts.slice(1).join(' ').trim().toLowerCase();
        const target = getAgentSubCommands().find((c) => c.name === agentName);
        this.inputHandler.setValue(''); this.slashMenu.visible = false;
        if (!target) { this.messages.push({ id: `agent-not-found-${Date.now()}`, type: 'error', status: 'error', content: `未找到智能体: ${agentName}`, timestamp: Date.now() }); this.flushNewMessages(); return true; }
        setActiveAgent(target.name);
        this.messages.push({ id: `switch-${Date.now()}`, type: 'system', status: 'success', content: `已切换智能体为 ${target.name}，请重启以生效`, timestamp: Date.now() });
        this.flushNewMessages();
        return true;
      }
      this.inputHandler.setValue(this.slashMenu.openList('agent'));
      this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
      this.refreshBottom();
      return true;
    }

    if (cmd === 'resume') {
      if (hasArgs) { this.inputHandler.setValue(''); this.slashMenu.visible = false; this.resumeSession(parts.slice(1).join(' ').trim()); return true; }
      this.inputHandler.setValue(this.slashMenu.openList('resume'));
      this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
      this.refreshBottom();
      return true;
    }

    if (!hasArgs) return true;
    return false;
  }

  // ===== 会话管理 =====

  private handleNewSession(): void {
    logInfo('ui.new_session');
    this.engine.reset();
    this.session = this.engine.getSession();
    this.sessionStartedAt = this.session.createdAt;
    this.messages = []; this.renderedMessageCount = 0;
    this.clearStream(); this.isProcessing = false; this.inputHandler.setProcessing(false);
    this.abortRequested = false; this.showWelcome = true; this.totalTokens = 0;
    process.stdout.write(ansi.clearScreen() + ansi.cursorPosition(1, 1));
    printWelcome(this.renderer.getWidth());
    generateAgentHint().then((h) => { this.placeholder = h; this.refreshBottom(); }).catch(() => {});
    this.refreshBottom();
  }

  private resumeSession(sessionId: string): void {
    const result = this.engine.loadSession(sessionId);
    if (result) {
      this.stopAllTimers();
      this.messages = [...result.messages, { id: `resume-${Date.now()}`, type: 'system', status: 'success', content: `已恢复会话 ${sessionId.slice(0, 8)}...（${result.messages.length} 条消息）`, timestamp: Date.now() }];
      this.renderedMessageCount = 0; this.session = result.session; this.sessionStartedAt = result.session.createdAt;
      this.totalTokens = result.session.totalTokens; this.isProcessing = false; this.inputHandler.setProcessing(false); this.showWelcome = false;
      this.fullRedraw();
    } else {
      this.messages.push({ id: `resume-err-${Date.now()}`, type: 'error', status: 'error', content: `会话 ${sessionId} 不存在或已损坏`, timestamp: Date.now() });
      this.flushNewMessages();
    }
  }

  private handleInitialResume(sessionId: string): void {
    const result = this.engine.loadSession(sessionId);
    if (result) {
      this.stopAllTimers();
      this.messages = [...result.messages, { id: `resume-cli-${Date.now()}`, type: 'system', status: 'success', content: `已通过启动参数恢复会话 ${sessionId.slice(0, 8)}...（${result.messages.length} 条消息）`, timestamp: Date.now() }];
      this.session = result.session; this.sessionStartedAt = result.session.createdAt; this.totalTokens = result.session.totalTokens;
      this.isProcessing = false; this.showWelcome = false;
      logInfo('ui.resume_from_cli.success', { sessionId, messageCount: result.messages.length });
    } else {
      this.messages.push({ id: `resume-cli-error-${Date.now()}`, type: 'error', status: 'error', content: `启动时恢复会话失败：${sessionId} 不存在或已损坏`, timestamp: Date.now() });
      logWarn('ui.resume_from_cli.failed', { sessionId });
    }
  }

  // ===== 快捷键 =====

  private handleCtrlC(): void {
    if (this.dangerConfirmActive) { this.resolveDangerConfirm('cancel'); return; }
    if (this.ctrlCArmed) { this.clearCtrlCTimer(); this.handleExit(); return; }
    this.ctrlCArmed = true; this.countdown = 3; this.refreshBottom();
    const deadline = Date.now() + 3000;
    this.countdownInterval = setInterval(() => {
      const remain = deadline - Date.now();
      if (remain <= 0) { this.clearCtrlCTimer(); this.refreshBottom(); return; }
      this.countdown = Math.ceil(remain / 1000); this.refreshBottom();
    }, 100);
    this.ctrlCTimer = setTimeout(() => { this.clearCtrlCTimer(); this.refreshBottom(); }, 3000);
  }

  private clearCtrlCTimer(): void {
    if (this.ctrlCTimer) { clearTimeout(this.ctrlCTimer); this.ctrlCTimer = null; }
    if (this.countdownInterval) { clearInterval(this.countdownInterval); this.countdownInterval = null; }
    this.ctrlCArmed = false; this.countdown = null;
  }

  private handleEscape(): void {
    if (this.dangerConfirmActive) { this.resolveDangerConfirm('cancel'); return; }
    if (this.isProcessing) { this.requestAbort(); return; }
    if (this.slashMenu.visible) { this.handleSlashMenuClose(); return; }
    if (this.inputHandler.getValue().length > 0) { this.inputHandler.setValue(''); this.refreshBottom(); }
  }

  private handleClearScreen(): void {
    logInfo('ui.clear_screen_reset');
    this.engine.reset(); this.session = this.engine.getSession(); this.sessionStartedAt = this.session.createdAt;
    this.messages = []; this.renderedMessageCount = 0; this.clearStream();
    this.isProcessing = false; this.inputHandler.setProcessing(false); this.showWelcome = true; this.totalTokens = 0;
    process.stdout.write(ansi.clearScreen() + ansi.cursorPosition(1, 1));
    printWelcome(this.renderer.getWidth());
    generateAgentHint().then((h) => { this.placeholder = h; this.refreshBottom(); }).catch((e) => logError('ui.hint.reset_failed', e));
    this.refreshBottom();
  }

  private handleTab(): void {
    if (!this.placeholder) return;
    const match = this.placeholder.match(/^Try\s+"(.+)"$/);
    this.inputHandler.setValue(match ? match[1] : this.placeholder);
    this.refreshBottom();
  }

  private requestAbort(): void {
    if (!this.isProcessing || this.abortRequested) return;
    this.abortRequested = true; logWarn('ui.abort_by_escape');
    this.messages = this.messages
      .filter((m) => !(m.type === 'thinking' && m.status === 'pending'))
      .map((m) => m.status !== 'pending' ? m : m.type === 'tool_exec' ? { ...m, status: 'aborted' as const, content: `${m.toolName || '工具'} 已中断`, abortHint: m.abortHint ?? '命令已中断（ESC）' } : m);
    this.finishThinking(); this.clearStream();
    const now = Date.now();
    if (now - this.lastAbortNotice >= 800) {
      this.lastAbortNotice = now;
      this.messages.push({ id: `abort-notice-${now}`, type: 'system', status: 'aborted', content: '已中断当前推理', timestamp: now, abortHint: '推理已中断（ESC）' });
      this.flushNewMessages();
    }
    this.engine.abort();
  }

  private handleExit(): void {
    const sessionId = this.session.id?.trim();
    this.stop();
    let hint = '';
    if (sessionId) { const w = Math.max(process.stdout.columns ?? 0, 80); hint = `\n${'─'.repeat(w)}\n\nResume this session with:\njarvis --resume ${sessionId}\n\n`; }
    process.stdout.write(ansi.showCursor());
    if (hint) process.stdout.write(hint);
    process.exit(0);
  }

  // ===== 输入历史 =====

  private handleUpArrow(): void {
    const result = this.history.navigateUp(this.inputHandler.getValue());
    if (result !== null) { this.inputHandler.setValue(result); this.slashMenu.update(result); this.inputHandler.setSlashMenuActive(this.slashMenu.visible); this.refreshBottom(); }
  }

  private handleDownArrow(): void {
    const result = this.history.navigateDown();
    if (result !== null) { this.inputHandler.setValue(result); this.slashMenu.update(result); this.inputHandler.setSlashMenuActive(this.slashMenu.visible); this.refreshBottom(); }
  }

  // ===== 危险确认 =====

  private moveDangerConfirm(dir: number): void {
    this.dangerConfirmIndex = dir < 0 ? (this.dangerConfirmIndex > 0 ? this.dangerConfirmIndex - 1 : 3) : (this.dangerConfirmIndex < 3 ? this.dangerConfirmIndex + 1 : 0);
    this.renderer.clearDangerConfirm();
    this.renderer.renderDangerConfirm(this.dangerCommand, this.dangerReason, this.dangerRuleName, this.dangerConfirmIndex);
  }

  private selectDangerConfirm(): void {
    const choices: DangerConfirmResult[] = ['once', 'session', 'always', 'cancel'];
    this.resolveDangerConfirm(choices[this.dangerConfirmIndex] ?? 'cancel');
  }

  private resolveDangerConfirm(choice: DangerConfirmResult): void {
    if (!this.dangerConfirmActive || !this.dangerConfirmResolve) return;
    const resolve = this.dangerConfirmResolve;
    this.dangerConfirmActive = false; this.inputHandler.setDangerConfirmActive(false);
    this.dangerConfirmResolve = null;
    this.renderer.clearDangerConfirm(); this.refreshBottom();
    resolve(choice);
  }

  // ===== 斜杠菜单 =====

  private handleSlashMenuAutocomplete(): void {
    const { nextInput, needsList } = this.slashMenu.autocomplete(this.inputHandler.getValue());
    this.inputHandler.setValue(nextInput);
    if (needsList) {
      this.inputHandler.setValue(this.slashMenu.openList(needsList as 'agent' | 'resume' | 'rewind'));
    } else {
      this.slashMenu.update(nextInput);
    }
    this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
    this.refreshBottom();
  }

  private handleSlashMenuClose(): void {
    const backToRoot = this.slashMenu.close();
    if (backToRoot) this.inputHandler.setValue('/');
    this.inputHandler.setSlashMenuActive(this.slashMenu.visible);
    this.refreshBottom();
  }
}
