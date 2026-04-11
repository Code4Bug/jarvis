import React from 'react';
import { Box, Text } from 'ink';
import { SetupFormData } from '../../config/bootstrap.js';

interface SetupConfirmStepProps {
  form: SetupFormData;
  preview: string;
  isSubmitting: boolean;
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return '未填写';
  if (apiKey.length <= 8) return '*'.repeat(apiKey.length);
  return `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(apiKey.length - 8, 4))}${apiKey.slice(-4)}`;
}

export default function SetupConfirmStep({ form, preview, isSubmitting }: SetupConfirmStepProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="white" bold>确认写入配置</Text>
      <Text color="gray">确认无误后按 Enter 写入。Esc 可返回修改。</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>配置名称：{form.profileName}</Text>
        <Text>API 地址：{form.apiUrl}</Text>
        <Text>模型 ID：{form.model}</Text>
        <Text>API Key：{maskApiKey(form.apiKey)}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">JSON 预览</Text>
        {preview.split('\n').map((line, index) => (
          <Text key={`${index}-${line}`} color="gray">{line}</Text>
        ))}
      </Box>
      {isSubmitting ? (
        <Box marginTop={1}>
          <Text color="cyan">正在写入配置...</Text>
        </Box>
      ) : null}
    </Box>
  );
}
