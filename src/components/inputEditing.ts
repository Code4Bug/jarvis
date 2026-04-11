export const PASTE_PLACEHOLDER_RE = /\[Pasted text #(\d+) \+(\d+) lines\]/g;

export interface CursorPosition {
  row: number;
  col: number;
}

export function getCursorRowCol(text: string, pos: number): CursorPosition {
  const before = text.slice(0, pos);
  const row = (before.match(/\n/g) || []).length;
  const lastNewline = before.lastIndexOf('\n');
  const col = lastNewline === -1 ? pos : pos - lastNewline - 1;
  return { row, col };
}

export function rowColToOffset(text: string, row: number, col: number): number {
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < row && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }

  const targetLine = lines[Math.min(row, lines.length - 1)] ?? '';
  return offset + Math.min(col, targetLine.length);
}

export function findPlaceholderBeforeCursor(text: string, pos: number): { start: number; end: number } | null {
  if (pos === 0 || text[pos - 1] !== ']') return null;

  const before = text.slice(0, pos);
  const idx = before.lastIndexOf('[Pasted text #');
  if (idx === -1) return null;

  const sub = before.slice(idx);
  const matched = sub.match(/^\[Pasted text #\d+ \+\d+ lines\]$/);
  if (!matched) return null;

  return { start: idx, end: pos };
}

export function expandPlaceholders(
  text: string,
  lookup: (id: number) => string | undefined,
): string {
  return text.replace(PASTE_PLACEHOLDER_RE, (match, idStr) => {
    const id = parseInt(idStr, 10);
    return lookup(id) ?? match;
  });
}

export function insertTextAtCursor(text: string, cursor: number, inserted: string): { value: string; cursor: number } {
  return {
    value: text.slice(0, cursor) + inserted + text.slice(cursor),
    cursor: cursor + inserted.length,
  };
}

export function removeTextRange(text: string, start: number, end: number): { value: string; cursor: number } {
  return {
    value: text.slice(0, start) + text.slice(end),
    cursor: start,
  };
}
