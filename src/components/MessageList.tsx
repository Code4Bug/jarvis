import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import MessageItem from './MessageItem.js';
import { Message } from '../types/index.js';

interface MessageListProps {
  messages: Message[];
  showDetails: boolean;
}

const MAX_RENDERED_MESSAGES = 120;

function MessageList({ messages, showDetails }: MessageListProps) {
  const hiddenCount = Math.max(0, messages.length - MAX_RENDERED_MESSAGES);
  const visibleMessages = useMemo(
    () => (hiddenCount > 0 ? messages.slice(-MAX_RENDERED_MESSAGES) : messages),
    [hiddenCount, messages],
  );

  return (
    <Box flexDirection="column">
      {hiddenCount > 0 && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            已折叠前 {hiddenCount} 条历史消息，仅渲染最近 {visibleMessages.length} 条以降低 CPU 占用。
          </Text>
        </Box>
      )}
      {visibleMessages.map((msg) => (
        <MessageItem key={msg.id} msg={msg} showDetails={showDetails} />
      ))}
    </Box>
  );
}

export default React.memo(MessageList);
