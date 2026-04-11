import React from 'react';
import { Box } from 'ink';
import MessageItem from './MessageItem.js';
import { Message } from '../types/index.js';

interface MessageListProps {
  messages: Message[];
  showDetails: boolean;
}

function MessageList({ messages, showDetails }: MessageListProps) {
  return (
    <Box flexDirection="column">
      {messages.map((msg) => (
        <MessageItem key={msg.id} msg={msg} showDetails={showDetails} />
      ))}
    </Box>
  );
}

export default React.memo(MessageList);
