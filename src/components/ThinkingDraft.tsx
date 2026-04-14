import React from 'react';
import { Box, Text } from 'ink';
import { useThinkingDisplay } from '../hooks/useThinkingDisplay.js';

function ThinkingDraft() {
  const thinkingText = useThinkingDisplay();

  if (!thinkingText) return null;

  return (
    <Box marginBottom={1} marginLeft={2} flexDirection="column">
      <Text color="gray" dimColor wrap="wrap">
        {thinkingText.length > 200 ? `${thinkingText.slice(0, 200)}...` : thinkingText}
      </Text>
    </Box>
  );
}

export default React.memo(ThinkingDraft);
