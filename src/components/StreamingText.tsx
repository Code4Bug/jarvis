import React from 'react';
import { Box, Text } from 'ink';
import MarkdownText from './MarkdownText.js';

function StreamingText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Box marginBottom={1} flexDirection="column">
      <Box>
        <Text color="yellow">●</Text>
        <Box marginLeft={1}>
          <MarkdownText text={text} />
        </Box>
      </Box>
    </Box>
  );
}

export default React.memo(StreamingText);
