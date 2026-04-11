import React from 'react';
import { Box, Text } from 'ink';

interface SetupWelcomeStepProps {
  reasonText: string;
}

export default function SetupWelcomeStep({ reasonText }: SetupWelcomeStepProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="white" bold>欢迎使用 Jarvis</Text>
      <Text color="gray">检测到当前尚未完成可用模型配置，首次启动需要先完成基础引导。</Text>
      <Text color="gray">完成后会直接进入主界面，无需再次执行额外命令。</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">当前状态</Text>
        <Text>{reasonText}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">本次会完成的配置</Text>
        <Text>1. 设置默认模型配置名</Text>
        <Text>2. 写入 API 地址与 API Key</Text>
        <Text>3. 写入模型 ID 与基础参数</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">按 Enter 开始配置</Text>
      </Box>
    </Box>
  );
}
