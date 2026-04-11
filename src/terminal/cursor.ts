const ESC = '\x1B[';

export function hideTerminalCursor(): void {
  process.stdout.write(`${ESC}?25l`);
}

export function showTerminalCursor(): void {
  process.stdout.write(`${ESC}?25h`);
}

export function enableBracketedPaste(): void {
  process.stdout.write(`${ESC}?2004h`);
}

export function disableBracketedPaste(): void {
  process.stdout.write(`${ESC}?2004l`);
}

export function moveCursorToColumn(column: number): void {
  process.stdout.write(`${ESC}${column}G`);
}

export function relocateCursorToInputLine(rowsBelow: number, column: number, extraRowsUp = 0): void {
  const totalRowsUp = Math.max(rowsBelow + extraRowsUp, 0);
  const up = totalRowsUp > 0 ? `${ESC}${totalRowsUp}A` : '';
  const down = totalRowsUp > 0 ? `${ESC}${totalRowsUp}B` : '';
  process.stdout.write(`${up}${ESC}${column}G${down}`);
}
