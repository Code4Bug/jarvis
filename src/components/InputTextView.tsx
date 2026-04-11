import React from 'react';
import { Box, Text } from 'ink';
import { getCursorRowCol, PASTE_PLACEHOLDER_RE } from './inputEditing.js';

interface InputTextViewProps {
  value: string;
  cursor: number;
  placeholder: string;
  showCursor: boolean;
  onResetPastedChunks?: () => void;
}

function renderWithPlaceholders(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(PASTE_PLACEHOLDER_RE.source, 'g');
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(<Text key={`${keyPrefix}-t-${lastIndex}`}>{text.slice(lastIndex, m.index)}</Text>);
    }
    parts.push(
      <Text key={`${keyPrefix}-p-${m.index}`} color="cyan" dimColor>{m[0]}</Text>,
    );
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Text key={`${keyPrefix}-t-${lastIndex}`}>{text.slice(lastIndex)}</Text>);
  }

  return parts;
}

function InputTextView({
  value,
  cursor,
  placeholder,
  showCursor,
  onResetPastedChunks,
}: InputTextViewProps) {
  const isEmpty = value.length === 0;

  if (isEmpty) {
    onResetPastedChunks?.();

    if (showCursor && placeholder.length > 0) {
      return (
        <Box>
          <Text inverse color="white">{placeholder[0]}</Text>
          <Text color="gray">{placeholder.slice(1)}</Text>
          <Text color="gray" dimColor>  [Tab]</Text>
        </Box>
      );
    }

    return (
      <Box>
        {showCursor && <Text inverse> </Text>}
        <Text color="gray">{placeholder}</Text>
      </Box>
    );
  }

  const lines = value.split('\n');
  const { row: cursorRow, col: cursorCol } = getCursorRowCol(value, cursor);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        if (!showCursor || i !== cursorRow) {
          const parts = renderWithPlaceholders(line, `l${i}`);
          return <Box key={i}>{parts.length > 0 ? parts : <Text> </Text>}</Box>;
        }

        const before = line.slice(0, cursorCol);
        const cursorChar = line[cursorCol] ?? ' ';
        const after = line.slice(cursorCol + 1);

        return (
          <Box key={i}>
            {renderWithPlaceholders(before, `b${i}`)}
            <Text inverse>{cursorChar}</Text>
            {renderWithPlaceholders(after, `a${i}`)}
          </Box>
        );
      })}
    </Box>
  );
}

export default React.memo(InputTextView);
