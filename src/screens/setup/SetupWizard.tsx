import React, { useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import SetupHeader from '../../components/setup/SetupHeader.js';
import SetupWelcomeStep from '../../components/setup/SetupWelcomeStep.js';
import SetupProviderStep from '../../components/setup/SetupProviderStep.js';
import SetupFormStep from '../../components/setup/SetupFormStep.js';
import SetupConfirmStep from '../../components/setup/SetupConfirmStep.js';
import SetupDoneStep from '../../components/setup/SetupDoneStep.js';
import {
  BootstrapStatus,
  ProviderType,
  SetupFormData,
  SetupValidationErrors,
  buildJarvisConfig,
  getDefaultSetupForm,
  validateSetupForm,
  writeBootstrapConfig,
} from '../../config/bootstrap.js';
import { useDoubleCtrlCExit } from '../../hooks/useDoubleCtrlCExit.js';
import { useTerminalWidth } from '../../hooks/useTerminalWidth.js';

type SetupStep = 'welcome' | 'provider' | 'form' | 'confirm' | 'done';

interface SetupWizardProps {
  initialStatus: BootstrapStatus;
  onCompleted: () => void;
}

const PROVIDERS: ProviderType[] = ['openai-compatible', 'ollama'];
const FORM_FIELDS: Array<keyof SetupFormData> = [
  'profileName',
  'apiUrl',
  'apiKey',
  'model',
  'temperature',
  'maxTokens',
];

function findFirstInvalidFieldIndex(errors: SetupValidationErrors): number {
  const firstField = FORM_FIELDS.findIndex((field) => Boolean(errors[field]));
  return firstField >= 0 ? firstField : 0;
}

export default function SetupWizard({ initialStatus, onCompleted }: SetupWizardProps) {
  const width = useTerminalWidth();
  const { exit } = useApp();
  const { countdown, handleCtrlC } = useDoubleCtrlCExit(() => {
    exit();
    setTimeout(() => process.exit(0), 50);
  });

  const [step, setStep] = useState<SetupStep>('welcome');
  const [provider, setProvider] = useState<ProviderType>('openai-compatible');
  const [form, setForm] = useState<SetupFormData>(() => getDefaultSetupForm('openai-compatible'));
  const [errors, setErrors] = useState<SetupValidationErrors>({});
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<keyof SetupFormData | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; configPath?: string } | null>(null);

  const selectedField = FORM_FIELDS[selectedFieldIndex];
  const preview = useMemo(() => JSON.stringify(buildJarvisConfig(form), null, 2), [form]);

  function moveProvider(offset: number): void {
    const currentIndex = PROVIDERS.indexOf(provider);
    const nextIndex = (currentIndex + offset + PROVIDERS.length) % PROVIDERS.length;
    const nextProvider = PROVIDERS[nextIndex];
    setProvider(nextProvider);
    setForm(getDefaultSetupForm(nextProvider));
    setErrors({});
  }

  function moveField(offset: number): void {
    setSelectedFieldIndex((current) => {
      const next = current + offset;
      if (next < 0) return FORM_FIELDS.length - 1;
      if (next >= FORM_FIELDS.length) return 0;
      return next;
    });
  }

  function startEditing(): void {
    setEditingField(selectedField);
    setEditBuffer(form[selectedField]);
  }

  function startEditingField(field: keyof SetupFormData): void {
    setEditingField(field);
    setEditBuffer(form[field]);
  }

  function stopEditing(save: boolean): void {
    if (!editingField) return;
    if (save) {
      setForm((current) => ({ ...current, [editingField]: editBuffer }));
    }
    setEditingField(null);
    setEditBuffer('');
  }

  async function submitConfig(): Promise<void> {
    const nextErrors = validateSetupForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSelectedFieldIndex(findFirstInvalidFieldIndex(nextErrors));
      setStep('form');
      return;
    }

    setIsSubmitting(true);
    const config = buildJarvisConfig(form);
    const writeResult = writeBootstrapConfig(config);
    setIsSubmitting(false);

    if (writeResult.success) {
      setResult({
        success: true,
        message: '基础模型配置已完成，后续可直接启动进入聊天界面。',
        configPath: writeResult.path,
      });
    } else {
      setResult({
        success: false,
        message: writeResult.message,
      });
    }
    setStep('done');
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      handleCtrlC();
      return;
    }

    if (editingField) {
      if (key.escape) {
        stopEditing(false);
        return;
      }
      if (key.return) {
        stopEditing(true);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((current) => current.slice(0, -1));
        return;
      }
      if (input) {
        setEditBuffer((current) => current + input);
      }
      return;
    }

    if (step === 'welcome') {
      if (key.return) {
        setStep('provider');
      }
      return;
    }

    if (step === 'provider') {
      if (key.upArrow) moveProvider(-1);
      if (key.downArrow) moveProvider(1);
      if (key.escape) setStep('welcome');
      if (key.return) {
        setErrors({});
        setSelectedFieldIndex(0);
        setStep('form');
      }
      return;
    }

    if (step === 'form') {
      if (key.upArrow) moveField(-1);
      if (key.downArrow || key.tab) moveField(1);
      if (key.escape) {
        setErrors({});
        setStep('provider');
      }
      if (key.return) {
        const nextErrors = validateSetupForm(form);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) {
          setStep('confirm');
        } else {
          const invalidIndex = findFirstInvalidFieldIndex(nextErrors);
          const invalidField = FORM_FIELDS[invalidIndex];
          setSelectedFieldIndex(invalidIndex);
          startEditingField(invalidField);
        }
      }
      if (input === 'e') {
        startEditing();
      }
      return;
    }

    if (step === 'confirm') {
      if (key.escape) {
        setStep('form');
        return;
      }
      if (key.return && !isSubmitting) {
        void submitConfig();
      }
      return;
    }

    if (step === 'done' && result) {
      if (key.return) {
        if (result.success) {
          onCompleted();
        } else {
          setStep('form');
        }
      }
    }
  });

  return (
    <Box flexDirection="column">
      <SetupHeader width={width} currentStep={step} status={initialStatus} />

      {step === 'welcome' ? <SetupWelcomeStep reasonText={initialStatus.ok ? '配置状态正常' : initialStatus.message} /> : null}
      {step === 'provider' ? <SetupProviderStep provider={provider} /> : null}
      {step === 'form' ? (
        <SetupFormStep
          provider={provider}
          form={form}
          errors={errors}
          selectedField={selectedField}
          editingField={editingField}
          editBuffer={editBuffer}
        />
      ) : null}
      {step === 'confirm' ? (
        <SetupConfirmStep
          form={form}
          preview={preview}
          isSubmitting={isSubmitting}
        />
      ) : null}
      {step === 'done' && result ? (
        <SetupDoneStep
          success={result.success}
          message={result.message}
          configPath={result.configPath}
        />
      ) : null}

      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text color="gray">快捷键：Enter 下一步或确认，Esc 返回，e 编辑当前字段，Ctrl+C 退出</Text>
        {countdown !== null ? <Text color="yellow">再次按 Ctrl+C 退出（{countdown}s）</Text> : null}
      </Box>
    </Box>
  );
}
