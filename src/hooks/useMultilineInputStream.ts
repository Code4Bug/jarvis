import { useEffect, useRef } from 'react';

interface UseMultilineInputStreamOptions {
  stdin?: NodeJS.ReadStream;
  isActive: boolean;
  pasteDetectWindowMs: number;
  imeComposeWindowMs: number;
  isAsciiLowerAlpha: (text: string) => boolean;
  hasNonAscii: (text: string) => boolean;
  insertPaste: (text: string) => void;
  handleNormalInput: (raw: string) => void;
  commitImeBuffer: () => void;
  flushImeBuffer: () => void;
  appendImeBuffer: (text: string) => void;
  getImeBuffer: () => string;
  clearImeBufferWithInsertedLenRollback: () => void;
}

export function useMultilineInputStream({
  stdin,
  isActive,
  pasteDetectWindowMs,
  imeComposeWindowMs,
  isAsciiLowerAlpha,
  hasNonAscii,
  insertPaste,
  handleNormalInput,
  commitImeBuffer,
  flushImeBuffer,
  appendImeBuffer,
  getImeBuffer,
  clearImeBufferWithInsertedLenRollback,
}: UseMultilineInputStreamOptions) {
  const pasteBufferRef = useRef<string | null>(null);
  const batchBufferRef = useRef('');
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ESC_WAIT_MS = 50;

  useEffect(() => {
    if (!stdin || !isActive) return;

    const flushBatchBuffer = () => {
      const buf = batchBufferRef.current;
      batchBufferRef.current = '';
      batchTimerRef.current = null;
      if (!buf) return;

      const cleaned = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (cleaned.includes('\n') && cleaned.length > 1) {
        insertPaste(cleaned);
        return;
      }

      if (isAsciiLowerAlpha(buf)) {
        appendImeBuffer(buf);
        if (imeTimerRef.current !== null) {
          clearTimeout(imeTimerRef.current);
        }
        imeTimerRef.current = setTimeout(flushImeBuffer, imeComposeWindowMs);
        return;
      }

      if (hasNonAscii(buf) && getImeBuffer().length > 0) {
        if (imeTimerRef.current !== null) {
          clearTimeout(imeTimerRef.current);
          imeTimerRef.current = null;
        }
        clearImeBufferWithInsertedLenRollback();
        handleNormalInput(buf);
        return;
      }

      if (getImeBuffer().length > 0) {
        commitImeBuffer();
      }

      handleNormalInput(buf);
    };

    const onData = (data: Buffer) => {
      const raw = data.toString('utf-8');

      if (raw.includes('\x1B[200~')) {
        const startIdx = raw.indexOf('\x1B[200~') + 6;
        const endIdx = raw.indexOf('\x1B[201~');
        if (endIdx !== -1) {
          insertPaste(raw.slice(startIdx, endIdx));
        } else {
          pasteBufferRef.current = raw.slice(startIdx);
        }
        return;
      }
      if (pasteBufferRef.current !== null) {
        const endIdx = raw.indexOf('\x1B[201~');
        if (endIdx !== -1) {
          pasteBufferRef.current += raw.slice(0, endIdx);
          insertPaste(pasteBufferRef.current);
          pasteBufferRef.current = null;
        } else {
          pasteBufferRef.current += raw;
        }
        return;
      }

      if (escTimerRef.current !== null) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
        if (raw === '\r' || raw === '\n') {
          handleNormalInput('\x1B\r');
          return;
        }
        handleNormalInput('\x1B');
      }

      const isSingleControl =
        raw === '\r' || raw === '\n' ||
        raw === '\x7F' || raw === '\x08' ||
        raw === '\t' || raw === '\x1B' ||
        raw === '\x1B\r' || raw === '\x1B\n' ||
        raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO');

      if (raw === '\x03' || raw === '\x0F' || raw === '\x0C') return;

      if (raw === '\x1B') {
        escTimerRef.current = setTimeout(() => {
          escTimerRef.current = null;
          handleNormalInput('\x1B');
        }, ESC_WAIT_MS);
        return;
      }

      if (isSingleControl && batchBufferRef.current === '') {
        if (getImeBuffer().length > 0) {
          commitImeBuffer();
        }
        handleNormalInput(raw);
        return;
      }

      if (isSingleControl && batchBufferRef.current !== '') {
        batchBufferRef.current += raw;
        return;
      }

      batchBufferRef.current += raw;
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
      }
      batchTimerRef.current = setTimeout(flushBatchBuffer, pasteDetectWindowMs);
    };

    stdin.prependListener('data', onData);
    return () => {
      stdin.off('data', onData);
      if (batchTimerRef.current !== null) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (escTimerRef.current !== null) {
        clearTimeout(escTimerRef.current);
        escTimerRef.current = null;
      }
      if (imeTimerRef.current !== null) {
        clearTimeout(imeTimerRef.current);
        imeTimerRef.current = null;
      }
    };
  }, [
    stdin,
    isActive,
    pasteDetectWindowMs,
    imeComposeWindowMs,
    isAsciiLowerAlpha,
    hasNonAscii,
    insertPaste,
    handleNormalInput,
    commitImeBuffer,
    flushImeBuffer,
    appendImeBuffer,
    getImeBuffer,
    clearImeBufferWithInsertedLenRollback,
  ]);
}
