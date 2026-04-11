import React from 'react';
import { Box, Text } from 'ink';
import { ProviderType, SetupFormData, SetupValidationErrors } from '../../config/bootstrap.js';

interface SetupFormStepProps {
  provider: ProviderType;
  form: SetupFormData;
  errors: SetupValidationErrors;
  selectedField: keyof SetupFormData;
  editingField: keyof SetupFormData | null;
  editBuffer: string;
}

const FIELD_ORDER: Array<keyof SetupFormData> = [
  'profileName',
  'apiUrl',
  'apiKey',
  'model',
  'temperature',
  'maxTokens',
];

const FIELD_LABELS: Record<keyof SetupFormData, string> = {
  profileName: '配置名称',
  apiUrl: 'API 地址',
  apiKey: 'API Key',
  model: '模型 ID',
  temperature: 'temperature',
  maxTokens: 'max_tokens',
};

const FIELD_DESCRIPTIONS: Record<keyof SetupFormData, string> = {
  profileName: '写入到 models 下的配置名，同时会被设置为默认激活模型。',
  apiUrl: '完整的 Chat Completions 接口地址。',
  apiKey: '鉴权密钥。显示时会自动脱敏。',
  model: '服务端实际使用的模型标识。',
  temperature: '可选，默认 0.1。',
  maxTokens: '响应最大 token 数，建议保持默认即可。',
};

function maskValue(field: keyof SetupFormData, value: string): string {
  if (field !== 'apiKey') return value || '未填写';
  if (!value) return '未填写';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 8, 4))}${value.slice(-4)}`;
}

export default function SetupFormStep({
  provider,
  form,
  errors,
  selectedField,
  editingField,
  editBuffer,
}: SetupFormStepProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="white" bold>填写配置参数</Text>
      <Text color="gray">
        当前接入方式：{provider === 'ollama' ? 'Ollama / 本地模型' : 'OpenAI 兼容接口'}
      </Text>
      <Text color="gray">上下键切字段，按 e 编辑当前字段，Enter 校验并进入确认。</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELD_ORDER.map((field) => {
          const selected = field === selectedField;
          const editing = field === editingField;
          const displayValue = editing ? editBuffer : maskValue(field, form[field]);
          const error = errors[field];
          return (
            <Box key={field} flexDirection="column" marginBottom={1}>
              <Text color={selected ? 'cyan' : 'white'}>
                {selected ? '›' : ' '} {FIELD_LABELS[field]}：{displayValue}
              </Text>
              <Text color="gray">{FIELD_DESCRIPTIONS[field]}</Text>
              {error ? <Text color="red">{error}</Text> : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
