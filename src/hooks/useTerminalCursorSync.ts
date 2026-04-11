import { useEffect, useRef } from 'react';
import { moveCursorToColumn, relocateCursorToInputLine } from '../terminal/cursor.js';

interface UseTerminalCursorSyncOptions {
  showCursor: boolean;
  isActive: boolean;
  rowsBelow: number;
  cursorRow?: number;
  rowsInInput?: number;
  cursorColumn?: number;
  delayMs?: number;
}

export function useTerminalCursorSync({
  showCursor,
  isActive,
  rowsBelow,
  cursorRow = 0,
  rowsInInput = 1,
  cursorColumn = 3,
  delayMs = 80,
}: UseTerminalCursorSyncOptions) {
  const cursorRelocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorCommandRef = useRef('');

  useEffect(() => {
    return () => {
      if (cursorRelocTimerRef.current !== null) {
        clearTimeout(cursorRelocTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (cursorRelocTimerRef.current !== null) {
      clearTimeout(cursorRelocTimerRef.current);
    }

    if (!showCursor || !isActive) {
      cursorRelocTimerRef.current = setTimeout(() => {
        cursorRelocTimerRef.current = null;
        const commandKey = 'col:1';
        if (lastCursorCommandRef.current === commandKey) return;
        lastCursorCommandRef.current = commandKey;
        moveCursorToColumn(1);
      }, delayMs);
    } else {
      cursorRelocTimerRef.current = setTimeout(() => {
        cursorRelocTimerRef.current = null;
        const extraRowsUp = Math.max(rowsInInput - 1 - cursorRow, 0);
        const safeColumn = Math.max(cursorColumn, 1);
        const commandKey = `input:${rowsBelow}:${extraRowsUp}:${safeColumn}`;
        if (lastCursorCommandRef.current === commandKey) return;
        lastCursorCommandRef.current = commandKey;
        relocateCursorToInputLine(rowsBelow, safeColumn, extraRowsUp);
      }, delayMs);
    }

    return () => {
      if (cursorRelocTimerRef.current !== null) {
        clearTimeout(cursorRelocTimerRef.current);
        cursorRelocTimerRef.current = null;
      }
    };
  }, [showCursor, isActive, rowsBelow, cursorRow, rowsInInput, cursorColumn, delayMs]);
}
