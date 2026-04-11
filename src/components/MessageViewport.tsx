import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import DangerConfirm, { ConfirmChoice } from './DangerConfirm.js';
import MessageList from './MessageList.js';
import StreamingDraft from './StreamingDraft.js';
import { LoopState, Message } from '../types/index.js';
import { DangerConfirmResult } from '../core/query.js';

interface DangerConfirmState {
  command: string;
  reason: string;
  ruleName: string;
  resolve: (choice: DangerConfirmResult) => void;
}

interface MessageViewportProps {
  messages: Message[];
  streamText: string;
  showDetails: boolean;
  dangerConfirm: DangerConfirmState | null;
  loopState: LoopState | null;
  onResolveDangerConfirm: (choice: ConfirmChoice) => void;
}

function MessageViewport({
  messages,
  streamText,
  showDetails,
  dangerConfirm,
  loopState,
  onResolveDangerConfirm,
}: MessageViewportProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <MessageList messages={messages} showDetails={showDetails} />
      {streamText && <StreamingDraft text={streamText} />}
      {dangerConfirm && (
        <DangerConfirm
          command={dangerConfirm.command}
          reason={dangerConfirm.reason}
          ruleName={dangerConfirm.ruleName}
          onSelect={onResolveDangerConfirm}
        />
      )}
      {loopState?.isRunning && (
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text color="gray"> iteration {loopState.iteration}/{loopState.maxIterations}</Text>
        </Box>
      )}
    </Box>
  );
}

export default React.memo(MessageViewport);
