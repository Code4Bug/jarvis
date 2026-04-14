/**
 * 原生终端渲染器
 *
 * 核心设计：append-only 消息区 + 可重绘底部区域（输入框 + 状态栏）。
 * 消息一旦输出到终端就不再重绘，只有底部的动态区域会被清除和重绘。
 * 流式内容结束后，流式区域的文本直接"固化"为消息，无需清屏。
 */

import * as ansi from './ansi.js';

/** 底部动态区域占用的行数（会被清除重绘） */
const BOTTOM_FIXED_LINES = 3; // 分隔线 + 输入行 + 状态栏

export interface BottomState {
  /** 输入框当前文本 */
  input: string;
  /** 光标在 input 中的位置 */
  cursor: number;
  /** 占位提示 */
  placeholder: string;
  /** 是否正在处理 */
  isProcessing: boolean;
  /** 双击退出倒计时 */
  countdown: number | null;
  /** 是否显示光标 */
  showCursor: boolean;
  /** 斜杠菜单 */
  slashMenu: SlashMenuState | null;
  /** 状态栏文本（已格式化的 ANSI 字符串） */
  statusBarText: string;
  /** 迭代计数 */
  loopIteration: number;
  loopMaxIterations: number;
  /** spinner 动画帧索引 */
  spinnerFrame: number;
}

export interface SlashMenuState {
  items: Array<{ name: string; displayName?: string; description: string; category: string }>;
  selectedIndex: number;
  maxVisible: number;
}

export class TerminalRenderer {
  private width: number;
  /** 底部动态区域当前占用的行数 */
  private bottomLines = 0;
  /** 流式输出区域当前占用的行数 */
  private streamLines = 0;
  /** 当前流式文本（用于检测变化） */
  private currentStreamText = '';
  /** 当前 thinking 文本 */
  private currentThinkingText = '';
  /** 危险确认框占用的行数 */
  private dangerConfirmLines = 0;
  /** 循环状态行 */
  private loopStateLine = '';

  constructor() {
    this.width = process.stdout.columns || 80;
    process.stdout.on('resize', () => {
      this.width = process.stdout.columns || 80;
    });
  }

  getWidth(): number {
    return this.width;
  }

  /** 写入原始文本到 stdout */
  private write(text: string): void {
    process.stdout.write(text);
  }

  /** 输出一行并换行（append-only，不可撤回） */
  writeLine(text: string): void {
    this.write(text + '\n');
  }

  /** 输出多行文本 */
  writeLines(lines: string[]): void {
    for (const line of lines) {
      this.writeLine(line);
    }
  }

  /** 清除底部动态区域 */
  clearBottom(): void {
    if (this.bottomLines <= 0) return;
    this.write(ansi.cursorUp(this.bottomLines) + '\r' + ansi.clearDown());
    this.bottomLines = 0;
  }

  /** 清除流式输出区域 + 底部区域 */
  clearStreamAndBottom(): void {
    const total = this.streamLines + this.dangerConfirmLines + (this.loopStateLine ? 1 : 0) + this.bottomLines;
    if (total <= 0) return;
    this.write(ansi.cursorUp(total) + '\r' + ansi.clearDown());
    this.streamLines = 0;
    this.dangerConfirmLines = 0;
    this.loopStateLine = '';
    this.bottomLines = 0;
    this.currentStreamText = '';
    this.currentThinkingText = '';
  }

  /**
   * 渲染流式文本（thinking + streaming）
   * 这个区域会被反复清除重绘，但不影响上方已固化的消息
   */
  renderStream(thinkingText: string, streamText: string): void {
    let lines = 0;

    // thinking 文本（缩进 3 格，对齐 "● " 后的内容）
    if (thinkingText) {
      const display = thinkingText.length > 200 ? thinkingText.slice(0, 200) + '...' : thinkingText;
      const thinkingLines = this.wrapText(display, this.width - 5);
      for (const line of thinkingLines) {
        this.write(`   ${ansi.fg('gray')}${ansi.DIM}${line}${ansi.RESET}\n`);
        lines++;
      }
    }

    // streaming 文本
    if (streamText) {
      const streamLines = streamText.split('\n');
      // 第一行带黄色圆点前缀（● 占 2 列 + 1 空格 = 3 列）
      if (streamLines.length > 0) {
        this.write(` ${ansi.fg('yellow')}● ${ansi.RESET}${streamLines[0]}\n`);
        lines++;
      }
      // 后续行缩进 3+1 格（1 是外层 flushNewMessages 的空格，这里补 3 格对齐）
      for (let i = 1; i < streamLines.length; i++) {
        this.write(`    ${streamLines[i]}\n`);
        lines++;
      }
    }

    this.streamLines = lines;
    this.currentStreamText = streamText;
    this.currentThinkingText = thinkingText;
  }

  /**
   * 固化流式内容为正式消息
   * 流式区域清除，消息已经通过 appendMessage 输出到上方
   */
  finalizeStream(): void {
    this.clearStreamAndBottom();
    this.currentStreamText = '';
    this.currentThinkingText = '';
  }

  /** 渲染危险确认框 */
  renderDangerConfirm(command: string, reason: string, ruleName: string, selectedIndex: number): void {
    const lines: string[] = [];
    lines.push('');
    lines.push(` ${ansi.bg('yellow')}${ansi.fg('black')}${ansi.BOLD} 安全围栏 ${ansi.RESET}`);
    lines.push(` ${ansi.BOLD}${ansi.fg('white')}检测到高风险命令${ansi.RESET}`);
    lines.push(` ${ansi.fg('gray')}请确认是否继续执行${ansi.RESET}`);
    lines.push('');
    lines.push(` ${ansi.fg('gray')}命令${ansi.RESET}`);
    lines.push(` ${ansi.BOLD}${ansi.fg('white')}${ansi.truncate(command, this.width - 4)}${ansi.RESET}`);
    lines.push(` ${ansi.fg('gray')}规则${ansi.RESET}`);
    lines.push(` ${ansi.fg('cyan')}${ruleName}${ansi.RESET}`);
    lines.push(` ${ansi.fg('gray')}原因${ansi.RESET}`);
    lines.push(` ${ansi.fg('red')}${reason}${ansi.RESET}`);
    lines.push('');
    lines.push(` ${ansi.fg('gray')}${ansi.DIM}使用 ↑↓ 选择，Enter 确认，ESC 取消${ansi.RESET}`);

    const options = [
      { label: '当次允许（仅执行这一次）', color: 'yellow' },
      { label: '本轮会话允许（仅当前 session）', color: 'cyan' },
      { label: '持久授权（写入 ~/.jarvis/.permissions.json）', color: 'green' },
      { label: '取消执行', color: 'red' },
    ];

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === selectedIndex;
      if (isSelected) {
        lines.push(` ${ansi.bg(opt.color)}${ansi.fg('black')}${ansi.BOLD} › ${opt.label} ${ansi.RESET}`);
      } else {
        lines.push(`   ${ansi.fg(opt.color)}${opt.label}${ansi.RESET}`);
      }
    }
    lines.push('');

    for (const line of lines) {
      this.write(line + '\n');
    }
    this.dangerConfirmLines = lines.length;
  }

  /** 清除危险确认框 */
  clearDangerConfirm(): void {
    if (this.dangerConfirmLines <= 0) return;
    this.write(ansi.cursorUp(this.dangerConfirmLines) + '\r' + ansi.clearDown());
    this.dangerConfirmLines = 0;
  }

  /** 渲染循环状态行 */
  renderLoopState(iteration: number, maxIterations: number): void {
    this.loopStateLine = ` ${ansi.fg('yellow')}⠋${ansi.RESET} ${ansi.fg('gray')}iteration ${iteration}/${maxIterations}${ansi.RESET}`;
    this.write(this.loopStateLine + '\n');
  }

  /**
   * 渲染底部动态区域（输入框 + 状态栏）
   */
  renderBottom(state: BottomState): void {
    this.clearBottom();

    const lines: string[] = [];
    const separator = ansi.fg('gray') + '─'.repeat(Math.max(this.width - 2, 1)) + ansi.RESET;

    // 斜杠菜单
    if (state.slashMenu && !state.isProcessing) {
      const menu = state.slashMenu;
      const menuLines = this.renderSlashMenuLines(menu);
      lines.push(...menuLines);
    }

    // 分隔线
    lines.push(' ' + separator);

    // 输入行
    if (state.countdown !== null) {
      lines.push(` ${ansi.fg('gray')}${ansi.DIM}❯ ${ansi.RESET}${ansi.fg('yellow')}Press ${ansi.BOLD}Ctrl+C${ansi.RESET}${ansi.fg('yellow')} again to exit ${ansi.fg('gray')}${ansi.DIM}(${state.countdown}s)${ansi.RESET}`);
    } else if (state.isProcessing) {
      const spinnerChars = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
      const frame = spinnerChars[state.spinnerFrame % spinnerChars.length];
      const iterLabel = state.loopMaxIterations > 0
        ? `${ansi.fg('gray')} iteration ${state.loopIteration}/${state.loopMaxIterations}${ansi.RESET}`
        : '';
      lines.push(` ${ansi.fg('cyan')}${ansi.BOLD}❯ ${ansi.RESET}${ansi.fg('yellow')}${frame}${ansi.RESET}${ansi.fg('gray')}${ansi.ITALIC} processing...${ansi.RESET}${iterLabel}`);
    } else {
      lines.push(' ' + this.renderInputLine(state));
    }

    // 状态栏分隔线 + 状态栏
    lines.push(' ' + separator);
    lines.push(' ' + state.statusBarText);

    for (const line of lines) {
      this.write(line + '\n');
    }
    this.bottomLines = lines.length;
  }

  /** 渲染输入行 */
  private renderInputLine(state: BottomState): string {
    const { input, cursor, placeholder, showCursor } = state;

    if (input.length === 0) {
      if (showCursor && placeholder.length > 0) {
        return `${ansi.fg('cyan')}${ansi.BOLD}❯ ${ansi.RESET}${ansi.INVERSE}${placeholder[0]}${ansi.RESET}${ansi.fg('gray')}${placeholder.slice(1)}${ansi.RESET}${ansi.fg('gray')}${ansi.DIM}  [Tab]${ansi.RESET}`;
      }
      const cursorChar = showCursor ? `${ansi.INVERSE} ${ansi.RESET}` : '';
      return `${ansi.fg('cyan')}${ansi.BOLD}❯ ${ansi.RESET}${cursorChar}${ansi.fg('gray')}${placeholder}${ansi.RESET}`;
    }

    const before = input.slice(0, cursor);
    const cursorChar = input[cursor] ?? ' ';
    const after = input.slice(cursor + 1);

    if (showCursor) {
      return `${ansi.fg('cyan')}${ansi.BOLD}❯ ${ansi.RESET}${before}${ansi.INVERSE}${cursorChar}${ansi.RESET}${after}`;
    }
    return `${ansi.fg('cyan')}${ansi.BOLD}❯ ${ansi.RESET}${input}`;
  }

  /** 渲染斜杠菜单行 */
  private renderSlashMenuLines(menu: SlashMenuState): string[] {
    const lines: string[] = [];
    const { items, selectedIndex, maxVisible } = menu;

    if (items.length === 0) {
      lines.push(`   ${ansi.fg('gray')}${ansi.ITALIC}无匹配命令${ansi.RESET}`);
      return lines;
    }

    const total = items.length;
    const visible = Math.min(total, maxVisible);
    let start = 0;
    if (selectedIndex >= visible) {
      start = selectedIndex - visible + 1;
    }
    if (start + visible > total) {
      start = Math.max(0, total - visible);
    }

    if (start > 0) {
      lines.push(`   ${ansi.fg('gray')}${ansi.DIM}↑ 还有 ${start} 项${ansi.RESET}`);
    }

    const categoryColorMap: Record<string, string> = {
      agent: 'magenta', tool: 'cyan', builtin: 'gray',
    };
    const categoryLabelMap: Record<string, string> = {
      agent: '智能体', tool: '工具', builtin: '内置',
    };

    for (let i = 0; i < visible; i++) {
      const realIndex = start + i;
      const cmd = items[realIndex];
      const isSelected = realIndex === selectedIndex;
      const displayName = cmd.displayName ?? cmd.name;
      const catColor = categoryColorMap[cmd.category] ?? 'gray';
      const catText = categoryLabelMap[cmd.category] ?? cmd.category;

      const nameColor = isSelected ? ansi.fg('cyan') : ansi.fg('white');
      const descColor = isSelected ? ansi.fg('cyan') : ansi.fg('gray');

      lines.push(`  ${nameColor} /${displayName} ${ansi.RESET}${descColor}- ${cmd.description} ${ansi.RESET}${ansi.fg(catColor)}${ansi.DIM}[${catText}]${ansi.RESET}`);
    }

    if (start + visible < total) {
      lines.push(`   ${ansi.fg('gray')}${ansi.DIM}↓ 还有 ${total - start - visible} 项${ansi.RESET}`);
    }

    return lines;
  }

  /** 文本自动换行 */
  private wrapText(text: string, maxWidth: number): string[] {
    if (maxWidth <= 0) return [text];
    const result: string[] = [];
    const rawLines = text.split('\n');
    for (const rawLine of rawLines) {
      if (ansi.textWidth(rawLine) <= maxWidth) {
        result.push(rawLine);
      } else {
        // 简单按字符截断
        let current = '';
        let currentWidth = 0;
        for (const ch of rawLine) {
          const cw = ansi.charWidth(ch);
          if (currentWidth + cw > maxWidth) {
            result.push(current);
            current = ch;
            currentWidth = cw;
          } else {
            current += ch;
            currentWidth += cw;
          }
        }
        if (current) result.push(current);
      }
    }
    return result;
  }
}
