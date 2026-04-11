import fs from 'fs';
import os from 'os';
import path from 'path';
import { JarvisConfig, loadConfig, resetConfigCache } from './loader.js';

export type ProviderType = 'openai-compatible' | 'ollama';

export interface SetupFormData {
  profileName: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
}

export interface SetupValidationErrors {
  profileName?: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: string;
  maxTokens?: string;
  form?: string;
}

export type BootstrapStatus =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid_json' | 'incomplete'; message: string };

const JARVIS_HOME_DIR = path.join(os.homedir(), '.jarvis');
const CONFIG_PATH = path.join(JARVIS_HOME_DIR, 'config.json');

export function getBootstrapConfigPath(): string {
  return CONFIG_PATH;
}

export function getDefaultSetupForm(provider: ProviderType): SetupFormData {
  if (provider === 'ollama') {
    return {
      profileName: 'ollama',
      apiUrl: 'http://127.0.0.1:11434/v1/chat/completions',
      apiKey: 'ollama',
      model: '',
      temperature: '0.1',
      maxTokens: '10000',
    };
  }

  return {
    profileName: 'default',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: '',
    temperature: '0.1',
    maxTokens: '10000',
  };
}

export function checkBootstrapStatus(): BootstrapStatus {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ok: false, reason: 'missing', message: '未检测到全局配置文件，需要先完成首次配置。' };
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as JarvisConfig;
    const modelName = parsed.system?.model;
    if (!modelName) {
      return { ok: false, reason: 'incomplete', message: '配置文件缺少 system.model，无法确定默认模型。' };
    }

    const activeModel = parsed.models?.[modelName];
    if (!activeModel) {
      return { ok: false, reason: 'incomplete', message: `配置文件缺少 models.${modelName}，无法完成启动。` };
    }

    if (!activeModel.api_url || !activeModel.api_key || !activeModel.model) {
      return { ok: false, reason: 'incomplete', message: '当前默认模型缺少 api_url、api_key 或 model 字段。' };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_json',
      message: `配置文件解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function validateSetupForm(form: SetupFormData): SetupValidationErrors {
  const errors: SetupValidationErrors = {};

  if (!form.profileName.trim()) {
    errors.profileName = '配置名称不能为空';
  } else if (/\s/.test(form.profileName)) {
    errors.profileName = '配置名称不能包含空格';
  }

  if (!form.apiUrl.trim()) {
    errors.apiUrl = 'API 地址不能为空';
  } else {
    try {
      new URL(form.apiUrl);
    } catch {
      errors.apiUrl = 'API 地址格式不合法';
    }
  }

  if (!form.apiKey.trim()) {
    errors.apiKey = 'API Key 不能为空';
  }

  if (!form.model.trim()) {
    errors.model = '模型 ID 不能为空';
  }

  if (form.temperature.trim()) {
    const temperature = Number(form.temperature);
    if (Number.isNaN(temperature)) {
      errors.temperature = 'temperature 必须是数字';
    }
  }

  if (!form.maxTokens.trim()) {
    errors.maxTokens = 'max_tokens 不能为空';
  } else {
    const maxTokens = Number(form.maxTokens);
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
      errors.maxTokens = 'max_tokens 必须是正整数';
    }
  }

  return errors;
}

export function buildJarvisConfig(form: SetupFormData): JarvisConfig {
  const baseConfig = loadExistingConfig();
  const temperature = form.temperature.trim() ? Number(form.temperature) : undefined;
  const maxTokens = Number(form.maxTokens);

  const config: JarvisConfig = {
    system: {
      ...baseConfig.system,
      model: form.profileName.trim(),
    },
    models: {
      ...baseConfig.models,
      [form.profileName.trim()]: {
        ...(baseConfig.models?.[form.profileName.trim()] ?? {}),
        api_url: form.apiUrl.trim(),
        api_key: form.apiKey.trim(),
        model: form.model.trim(),
        ...(temperature !== undefined ? { temperature } : {}),
        max_tokens: maxTokens,
      },
    },
  };

  return config;
}

function loadExistingConfig(): JarvisConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { system: {}, models: {} };
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as JarvisConfig;
    return {
      system: parsed.system ?? {},
      models: parsed.models ?? {},
    };
  } catch {
    return { system: {}, models: {} };
  }
}

export function writeBootstrapConfig(config: JarvisConfig): { success: true; path: string } | { success: false; message: string } {
  try {
    if (!fs.existsSync(JARVIS_HOME_DIR)) {
      fs.mkdirSync(JARVIS_HOME_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    resetConfigCache();
    loadConfig();
    return { success: true, path: CONFIG_PATH };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
