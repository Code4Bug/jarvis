import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

interface StreamingDraftProps {
  text: string;
}

/**
 * 流式阶段先走轻量纯文本渲染，避免每个 chunk 都触发完整 markdown 重排。
 * 正式消息落盘后仍由 MessageItem -> MarkdownText 渲染。
 */
function StreamingDraft({ text }: StreamingDraftProps) {
  const lines = useMemo(() => text.split('\n'), [text]);

  if (!text) return null;

  return (
    <Box marginBottom={1} flexDirection="column">
      <Box alignItems="flex-start">
        <Text color="yellow">●</Text>
        <Box marginLeft={1} flexDirection="column">
          {lines.map((line, index) => (
            <Text key={index} wrap="wrap">
              {line || ' '}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default React.memo(StreamingDraft);
