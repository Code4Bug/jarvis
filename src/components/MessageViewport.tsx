import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import DangerConfirm, { ConfirmChoice } from './DangerConfirm.js';
import MessageList from './MessageList.js';
import StreamingDraft from './StreamingDraft.js';
import ThinkingDraft from './ThinkingDraft.js';
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
  showDetails: boolean;
  dangerConfirm: DangerConfirmState | null;
  loopState: LoopState | null;
  onResolveDangerConfirm: (choice: ConfirmChoice) => void;
}

function MessageViewport({
  messages,
  showDetails,
  dangerConfirm,
  loopState,
  onResolveDangerConfirm,
}: MessageViewportProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <MessageList messages={messages} showDetails={showDetails} />
      {/* ThinkingDraft / StreamingDraft 各自订阅外部 store，不依赖父级 props */}
      <ThinkingDraft />
      <StreamingDraft />
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
