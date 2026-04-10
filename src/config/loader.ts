/**
 * 配置加载器
 *
 * 优先级（后者覆盖前者）：
 *   1. ~/.jarvis/config.json   （全局配置）
 *   2. ./.jarvis/config.json   （项目配置）
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ===== 配置类型 =====

export interface ModelConfig {
  api_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
  /** 额外请求体参数，会直接合并到 API 请求 body 中（如 enable_thinking、chat_template_kwargs 等） */
  extra_body?: Record<string, unknown>;
}

export interface SystemConfig {
  context_token_limit?: number;
  context_compress_threshold?: number;
  /** 当前使用的模型名称，对应 models 中的 key */
  model?: string;
  /** 是否支持思考/非思考模式切换，默认 false */
  enable_thinking_mode_toggle?: boolean;
}

export interface JarvisConfig {
  system: SystemConfig;
  models: Record<string, ModelConfig>;
}

const CONFIG_FILENAME = 'config.json';
const JARVIS_DIR = '.jarvis';

/** 读取并解析单个配置文件，失败返回 null */
function loadJsonFile(filePath: string): JarvisConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as JarvisConfig;
  } catch (err) {
    console.error(`[config] Failed to parse ${filePath}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** 深度合并两个配置，local 覆盖 global */
function mergeConfigs(global: JarvisConfig | null, local: JarvisConfig | null): JarvisConfig {
  const base: JarvisConfig = {
    system: {},
    models: {},
  };

  if (global) {
    Object.assign(base.system, global.system);
    Object.assign(base.models, global.models);
  }
  if (local) {
    Object.assign(base.system, local.system);
    // 项目级 models 逐个覆盖，而非整体替换
    for (const [key, val] of Object.entries(local.models ?? {})) {
      base.models[key] = { ...base.models[key], ...val };
    }
  }

  return base;
}

/** 缓存已加载的配置 */
let _cachedConfig: JarvisConfig | null = null;

/** 加载合并后的最终配置（结果会被缓存，多次调用只解析一次） */
export function loadConfig(): JarvisConfig {
  if (_cachedConfig) return _cachedConfig;

  const globalPath = path.join(os.homedir(), JARVIS_DIR, CONFIG_FILENAME);
  const localPath = path.join(process.cwd(), JARVIS_DIR, CONFIG_FILENAME);

  const globalCfg = loadJsonFile(globalPath);
  const localCfg = loadJsonFile(localPath);

  _cachedConfig = mergeConfigs(globalCfg, localCfg);
  return _cachedConfig;
}

/** 根据当前配置获取活跃模型配置 */
export function getActiveModel(config: JarvisConfig): ModelConfig | null {
  const modelName = config.system.model;
  if (!modelName) return null;
  return config.models[modelName] ?? null;
}
