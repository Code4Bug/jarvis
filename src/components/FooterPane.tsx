import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import StatusBar from './StatusBar.js';

interface FooterPaneProps {
  width: number;
  tokenCountRef: React.MutableRefObject<number>;
  activeAgents: number;
  sessionStartedAt?: number;
}

const TOKEN_REFRESH_INTERVAL = 100;

function FooterPane({ width, tokenCountRef, activeAgents, sessionStartedAt }: FooterPaneProps) {
  const [displayTokens, setDisplayTokens] = useState(() => tokenCountRef.current);

  useEffect(() => {
    setDisplayTokens(tokenCountRef.current);

    const timer = setInterval(() => {
      setDisplayTokens((prev) => {
        const next = tokenCountRef.current;
        return prev === next ? prev : next;
      });
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      clearInterval(timer);
    };
  }, [tokenCountRef]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="gray">{'─'.repeat(Math.max(width - 2, 1))}</Text>
      <StatusBar
        width={width - 2}
        totalTokens={displayTokens}
        activeAgents={activeAgents}
        sessionStartedAt={sessionStartedAt}
      />
    </Box>
  );
}

export default React.memo(FooterPane);
