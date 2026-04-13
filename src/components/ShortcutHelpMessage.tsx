import React from 'react';
import { Box, Text } from 'ink';
import { getShortcutPlatformNote, getShortcutSections } from '../config/shortcuts.js';

function ShortcutHelpMessage() {
  const sections = getShortcutSections();
  const note = getShortcutPlatformNote();

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>快捷键帮助</Text>
      <Text color="gray">{note}</Text>
      {sections.map((section) => (
        <Box key={section.title} flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>{section.title}</Text>
          {section.items.map((item, index) => (
            <Box key={`${section.title}-${item.key}-${index}`}>
              <Box width={24} flexShrink={0}>
                <Text color="green" bold>{item.key}</Text>
              </Box>
              <Text color="white">{item.description}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

export default React.memo(ShortcutHelpMessage);
