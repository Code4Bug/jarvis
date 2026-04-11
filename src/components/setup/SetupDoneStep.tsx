import React from 'react';
import { Box, Text } from 'ink';

interface SetupDoneStepProps {
  success: boolean;
  message: string;
  configPath?: string;
}

export default function SetupDoneStep({ success, message, configPath }: SetupDoneStepProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={success ? 'green' : 'red'} bold>
        {success ? '配置写入成功' : '配置写入失败'}
      </Text>
      <Text>{message}</Text>
      {configPath ? <Text color="gray">配置文件：{configPath}</Text> : null}
      <Box marginTop={1}>
        <Text color="cyan">
          {success ? '按 Enter 进入 Jarvis' : '按 Enter 返回修改'}
        </Text>
      </Box>
    </Box>
  );
}
