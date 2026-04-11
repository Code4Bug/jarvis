import React from 'react';
import { Box, Text } from 'ink';
import { BootstrapStatus, getBootstrapConfigPath } from '../../config/bootstrap.js';

type SetupStep = 'welcome' | 'provider' | 'form' | 'confirm' | 'done';

interface SetupHeaderProps {
  width: number;
  currentStep: SetupStep;
  status: BootstrapStatus;
}

const STEPS: Array<{ key: SetupStep; label: string }> = [
  { key: 'welcome', label: '欢迎' },
  { key: 'provider', label: '接入方式' },
  { key: 'form', label: '参数填写' },
  { key: 'confirm', label: '确认写入' },
  { key: 'done', label: '完成' },
];

function stepColor(currentStep: SetupStep, step: SetupStep): string {
  const currentIndex = STEPS.findIndex((item) => item.key === currentStep);
  const stepIndex = STEPS.findIndex((item) => item.key === step);
  if (stepIndex < currentIndex) return 'green';
  if (stepIndex === currentIndex) return 'cyan';
  return 'gray';
}

export default function SetupHeader({ width, currentStep, status }: SetupHeaderProps) {
  const progress = STEPS
    .map((step, index) => ({ ...step, index: index + 1 }))
    .map((step) => (
      <Text key={step.key} color={stepColor(currentStep, step.key)}>
        {step.index}. {step.label}{' '}
      </Text>
    ));

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      <Text color="magenta" bold>Jarvis 首次启动配置</Text>
      <Text color="gray">
        {status.ok ? '配置校验通过' : status.message}
      </Text>
      <Text color="gray">配置文件路径：{getBootstrapConfigPath()}</Text>
      <Box marginTop={1}>{progress}</Box>
      <Text color="gray">{'─'.repeat(Math.min(Math.max(width - 2, 20), 72))}</Text>
    </Box>
  );
}
