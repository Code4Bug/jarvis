/**
 * 斜杠菜单状态管理
 *
 * 管理斜杠命令菜单的可见性、选中项、二级菜单等。
 */

import { filterCommands, filterAgentCommands, SlashCommand } from '../commands/index.js';
import { QueryEngine } from '../core/QueryEngine.js';

export class SlashMenuManager {
  visible = false;
  items: SlashCommand[] = [];
  index = 0;
  agentMode = false;
  resumeMode = false;
  rewindMode = false;

  private engine: QueryEngine;

  constructor(engine: QueryEngine) {
    this.engine = engine;
  }

  moveUp(): void {
    this.index = this.index > 0 ? this.index - 1 : this.items.length - 1;
  }

  moveDown(): void {
    this.index = this.index < this.items.length - 1 ? this.index + 1 : 0;
  }

  getSelected(): SlashCommand | null {
    return this.items[this.index] ?? null;
  }

  close(): boolean {
    if (this.agentMode || this.resumeMode || this.rewindMode) {
      this.agentMode = false;
      this.resumeMode = false;
      this.rewindMode = false;
      const matched = filterCommands('');
      this.items = matched;
      this.index = 0;
      this.visible = matched.length > 0;
      return true; // 返回 true 表示回退到一级菜单，需要设置 input 为 '/'
    }
    this.visible = false;
    return false;
  }

  /** 根据输入更新菜单状态，返回是否可见 */
  update(val: string): boolean {
    if (!val.startsWith('/') || val.includes('\n')) {
      this.visible = false;
      this.agentMode = false;
      this.resumeMode = false;
      this.rewindMode = false;
      return false;
    }

    const query = val.slice(1);

    if (/^agent\s/i.test(query)) {
      const subQuery = query.replace(/^agent\s*/i, '');
      this.items = filterAgentCommands(subQuery);
      this.index = 0;
      this.visible = this.items.length > 0;
      this.agentMode = true;
      this.resumeMode = false;
      this.rewindMode = false;
      return this.visible;
    }

    if (/^resume\s/i.test(query)) {
      const subQuery = query.replace(/^resume\s*/i, '').toLowerCase();
      const sessions = QueryEngine.listSessions().slice(0, 20);
      const allItems: SlashCommand[] = sessions.map((s) => {
        const date = new Date(s.updatedAt);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        return { name: s.id, description: `[${dateStr}] ${s.summary}`, category: 'builtin' as const, submitMode: 'action' as const };
      });
      this.items = subQuery ? allItems.filter((i) => i.name.includes(subQuery) || i.description.toLowerCase().includes(subQuery)) : allItems;
      this.index = 0;
      this.visible = this.items.length > 0;
      this.resumeMode = true;
      this.agentMode = false;
      this.rewindMode = false;
      return this.visible;
    }

    if (/^rewind\s/i.test(query)) {
      const subQuery = query.replace(/^rewind\s*/i, '').toLowerCase();
      const allItems = this.buildRewindItems();
      this.items = subQuery
        ? allItems.filter((i) => i.name.includes(subQuery) || (i.displayName ?? '').toLowerCase().includes(subQuery) || i.description.toLowerCase().includes(subQuery))
        : allItems;
      this.index = 0;
      this.visible = this.items.length > 0;
      this.rewindMode = true;
      this.resumeMode = false;
      this.agentMode = false;
      return this.visible;
    }

    this.items = filterCommands(query);
    this.index = 0;
    this.visible = this.items.length > 0;
    this.agentMode = false;
    this.resumeMode = false;
    this.rewindMode = false;
    return this.visible;
  }

  /** 自动补全当前选中项，返回新的输入文本 */
  autocomplete(currentInput: string): { nextInput: string; needsList: string | null } {
    const cmd = this.getSelected();
    if (!cmd) return { nextInput: currentInput, needsList: null };

    if (this.agentMode) {
      this.visible = false;
      return { nextInput: `/agent ${cmd.name}`, needsList: null };
    }
    if (this.resumeMode) {
      this.visible = false;
      return { nextInput: `/resume ${cmd.name}`, needsList: null };
    }
    if (this.rewindMode) {
      this.visible = false;
      return { nextInput: `/rewind ${cmd.name}`, needsList: null };
    }

    const match = currentInput.match(/^\/\S*/);
    const suffix = match ? currentInput.slice(match[0].length) : '';
    const needsTrailingSpace = !suffix && (cmd.submitMode === 'context' || cmd.submitMode === 'list');
    const nextInput = `/${cmd.name}${suffix}${needsTrailingSpace ? ' ' : ''}`;

    if (cmd.submitMode === 'list' && (cmd.name === 'agent' || cmd.name === 'resume' || cmd.name === 'rewind') && !suffix.trim()) {
      return { nextInput, needsList: cmd.name };
    }

    return { nextInput, needsList: null };
  }

  /** 打开二级列表菜单 */
  openList(commandName: 'agent' | 'resume' | 'rewind'): string {
    if (commandName === 'agent') {
      this.items = filterAgentCommands('');
      this.index = 0;
      this.agentMode = true;
      this.resumeMode = false;
      this.rewindMode = false;
      this.visible = this.items.length > 0;
      return '/agent ';
    }

    if (commandName === 'rewind') {
      this.items = this.buildRewindItems();
      this.index = 0;
      this.visible = this.items.length > 0;
      this.rewindMode = true;
      this.resumeMode = false;
      this.agentMode = false;
      return '/rewind ';
    }

    const sessions = QueryEngine.listSessions().slice(0, 20);
    this.items = sessions.map((s) => {
      const date = new Date(s.updatedAt);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      return { name: s.id, description: `[${dateStr}] ${s.summary}`, category: 'builtin' as const, submitMode: 'action' as const };
    });
    this.index = 0;
    this.visible = this.items.length > 0;
    this.resumeMode = true;
    this.agentMode = false;
    this.rewindMode = false;
    return '/resume ';
  }

  private buildRewindItems(): SlashCommand[] {
    return this.engine.getCurrentSessionUserTurns()
      .slice()
      .map((turn) => {
        const date = new Date(turn.timestamp);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        const question = turn.input.replace(/\s+/g, ' ').slice(0, 32);
        const answer = turn.answerPreview.replace(/\s+/g, ' ').slice(0, 24);
        return {
          name: turn.messageId,
          displayName: `rewind-${turn.turnIndex}`,
          description: `[Q${turn.turnIndex} ${dateStr}] ${question}${answer ? ` | A: ${answer}` : ''}`,
          category: 'builtin' as const,
          submitMode: 'action' as const,
        };
      });
  }
}
