import React from 'react';
import { Box, Text } from 'ink';
import { ProviderType } from '../../config/bootstrap.js';

interface SetupProviderStepProps {
  provider: ProviderType;
}

const OPTIONS: Array<{ value: ProviderType; title: string; desc: string }> = [
  {
    value: 'openai-compatible',
    title: 'OpenAI 兼容接口',
    desc: '适合 OpenAI、OneAPI、云厂商兼容接口等场景。',
  },
  {
    value: 'ollama',
    title: 'Ollama / 本地模型',
    desc: '自动带入本地默认地址，适合本机 Ollama 服务。',
  },
];

export default function SetupProviderStep({ provider }: SetupProviderStepProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="white" bold>选择接入方式</Text>
      <Text color="gray">上下键切换，Enter 确认后进入参数填写。</Text>
      <Box marginTop={1} flexDirection="column">
        {OPTIONS.map((option) => {
          const selected = option.value === provider;
          return (
            <Box key={option.value} flexDirection="column" marginBottom={1}>
              <Text color={selected ? 'cyan' : 'white'}>
                {selected ? '›' : ' '} {option.title}
              </Text>
              <Text color="gray">{option.desc}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
