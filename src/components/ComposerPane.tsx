import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import MultilineInput from './MultilineInput.js';
import SlashCommandMenu from './SlashCommandMenu.js';
import { SlashCommand } from '../commands/index.js';

interface ComposerPaneProps {
  width: number;
  countdown: number | null;
  isProcessing: boolean;
  input: string;
  placeholder: string;
  windowFocused: boolean;
  slashMenuVisible: boolean;
  slashMenuItems: SlashCommand[];
  slashMenuIndex: number;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => Promise<void>;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onSlashMenuUp: () => void;
  onSlashMenuDown: () => void;
  onSlashMenuSelect: () => void;
  onSlashMenuClose: () => void;
  onTabFillPlaceholder: () => void;
}

function ComposerPane({
  width,
  countdown,
  isProcessing,
  input,
  placeholder,
  windowFocused,
  slashMenuVisible,
  slashMenuItems,
  slashMenuIndex,
  onInputChange,
  onSubmit,
  onUpArrow,
  onDownArrow,
  onSlashMenuUp,
  onSlashMenuDown,
  onSlashMenuSelect,
  onSlashMenuClose,
  onTabFillPlaceholder,
}: ComposerPaneProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="gray">{'─'.repeat(Math.max(width - 2, 1))}</Text>
      {slashMenuVisible && !isProcessing && (
        <SlashCommandMenu
          commands={slashMenuItems}
          selectedIndex={slashMenuIndex}
        />
      )}
      <Box>
        {countdown !== null ? (
          <Box>
            <Text color="gray" dimColor>❯ </Text>
            <Text color="yellow">Press </Text>
            <Text color="yellow" bold>Ctrl+C</Text>
            <Text color="yellow"> again to exit </Text>
            <Text color="gray" dimColor>({countdown}s)</Text>
          </Box>
        ) : isProcessing ? (
          <Box>
            <Text color="cyan" bold>❯ </Text>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text color="gray" italic> processing...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan" bold>❯ </Text>
            <MultilineInput
              value={input}
              onChange={onInputChange}
              onSubmit={onSubmit}
              onUpArrow={onUpArrow}
              onDownArrow={onDownArrow}
              placeholder={placeholder}
              isActive={!isProcessing}
              showCursor={windowFocused && !isProcessing}
              slashMenuActive={slashMenuVisible}
              onSlashMenuUp={onSlashMenuUp}
              onSlashMenuDown={onSlashMenuDown}
              onSlashMenuSelect={onSlashMenuSelect}
              onSlashMenuClose={onSlashMenuClose}
              onTabFillPlaceholder={onTabFillPlaceholder}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default React.memo(ComposerPane);
