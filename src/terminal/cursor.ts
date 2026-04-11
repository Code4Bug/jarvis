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

export function relocateCursorToInputLine(rowsBelow: number, column: number): void {
  const up = rowsBelow > 0 ? `${ESC}${rowsBelow}A` : '';
  const down = rowsBelow > 0 ? `${ESC}${rowsBelow}B` : '';
  process.stdout.write(`${up}${ESC}${column}G${down}`);
}
