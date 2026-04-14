import React from 'react';
import { Box, Text } from 'ink';
import StatusBar from './StatusBar.js';
import { useTokenDisplay } from '../hooks/useTokenDisplay.js';
import { useSessionStartDisplay } from '../hooks/useSessionStartDisplay.js';

interface FooterPaneProps {
  width: number;
  activeAgents: number;
}
function FooterPane({ width, activeAgents }: FooterPaneProps) {
  const displayTokens = useTokenDisplay();
  const sessionStartedAt = useSessionStartDisplay();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="gray">{'─'.repeat(Math.max(width - 2, 1))}</Text>
      <StatusBar
        width={width - 2}
        totalTokens={displayTokens}
        activeAgents={activeAgents}
      />
    </Box>
  );
}

export default React.memo(FooterPane);
