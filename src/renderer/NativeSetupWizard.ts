/**
 * 原生终端 Setup Wizard
 *
 * 首次启动配置向导，完全不依赖 Ink。
 * 步骤：welcome → provider → form → confirm → done
 */

import * as ansi from './ansi.js';
import {
  BootstrapStatus,
  ProviderType,
  SetupFormData,
  SetupValidationErrors,
  buildJarvisConfig,
  getBootstrapConfigPath,
  getDefaultSetupForm,
  validateSetupForm,
  writeBootstrapConfig,
} from '../config/bootstrap.js';

type SetupStep = 'welcome' | 'provider' | 'form' | 'confirm' | 'done';

const PROVIDERS: ProviderType[] = ['openai-compatible', 'ollama'];
const PROVIDER_LABELS: Record<ProviderType, { title: string; desc: string }> = {
  'openai-compatible': { title: 'OpenAI 兼容接口', desc: '适合 OpenAI、OneAPI、云厂商兼容接口等场景。' },
  'ollama': { title: 'Ollama / 本地模型', desc: '自动带入本地默认地址，适合本机 Ollama 服务。' },
};

const FORM_FIELDS: Array<keyof SetupFormData> = ['profileName', 'apiUrl', 'apiKey', 'model', 'temperature', 'maxTokens'];
const FIELD_LABELS: Record<keyof SetupFormData, string> = {
  profileName: '配置名称', apiUrl: 'API 地址', apiKey: 'API Key',
  model: '模型 ID', temperature: 'temperature', maxTokens: 'max_tokens',
};
const FIELD_DESCS: Record<keyof SetupFormData, string> = {
  profileName: '写入到 models 下的配置名，同时会被设置为默认激活模型。',
  apiUrl: '完整的 Chat Completions 接口地址。',
  apiKey: '鉴权密钥。显示时会自动脱敏。',
  model: '服务端实际使用的模型标识。',
  temperature: '可选，默认 0.1。',
  maxTokens: '响应最大 token 数，建议保持默认即可。',
};

function maskApiKey(v: string): string {
  if (!v) return '未填写';
  if (v.length <= 8) return '*'.repeat(v.length);
  return `${v.slice(0, 4)}${'*'.repeat(Math.max(v.length - 8, 4))}${v.slice(-4)}`;
}

function maskValue(field: keyof SetupFormData, v: string): string {
  if (field === 'apiKey') return maskApiKey(v);
  return v || '未填写';
}

export class NativeSetupWizard {
  private status: BootstrapStatus;
  private onCompleted: () => void;
  private step: SetupStep = 'welcome';
  private provider: ProviderType = 'openai-compatible';
  private form: SetupFormData;
  private errors: SetupValidationErrors = {};
  private fieldIndex = 0;
  private editingField: keyof SetupFormData | null = null;
  private editBuffer = '';
  private result: { success: boolean; message: string; configPath?: string } | null = null;
  private dataListener: ((data: Buffer) => void) | null = null;

  // 双击退出
  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(status: BootstrapStatus, onCompleted: () => void) {
    this.status = status;
    this.onCompleted = onCompleted;
    this.form = getDefaultSetupForm('openai-compatible');
  }

  start(): void {
    process.stdout.write(ansi.hideCursor());
    if (process.stdin.isTTY && !process.stdin.isRaw) process.stdin.setRawMode(true);
    process.stdin.resume();

    this.dataListener = (data: Buffer) => this.handleInput(data.toString('utf-8'));
    process.stdin.on('data', this.dataListener);

    this.render();
  }

  stop(): void {
    if (this.dataListener) { process.stdin.off('data', this.dataListener); this.dataListener = null; }
    if (this.ctrlCTimer) { clearTimeout(this.ctrlCTimer); this.ctrlCTimer = null; }
    process.stdout.write(ansi.showCursor());
  }

  private handleInput(raw: string): void {
    // Ctrl+C
    if (raw === '\x03') {
      if (this.ctrlCArmed) { this.stop(); process.stdout.write(ansi.showCursor()); process.exit(0); }
      this.ctrlCArmed = true;
      this.ctrlCTimer = setTimeout(() => { this.ctrlCArmed = false; this.render(); }, 3000);
      this.render();
      return;
    }

    // 编辑模式
    if (this.editingField) {
      if (raw === '\x1B') { this.editingField = null; this.editBuffer = ''; this.render(); return; }
      if (raw === '\r' || raw === '\n') {
        this.form[this.editingField] = this.editBuffer;
        this.editingField = null; this.editBuffer = '';
        this.render(); return;
      }
      if (raw === '\x7F' || raw === '\x08') { this.editBuffer = this.editBuffer.slice(0, -1); this.render(); return; }
      // 忽略控制字符和转义序列
      if (raw.length === 1 && raw.charCodeAt(0) < 32) return;
      if (raw.startsWith('\x1B[') || raw.startsWith('\x1B]') || raw.startsWith('\x1BO')) return;
      this.editBuffer += raw;
      this.render();
      return;
    }

    // 步骤导航
    if (this.step === 'welcome') {
      if (raw === '\r' || raw === '\n') { this.step = 'provider'; this.render(); }
      return;
    }

    if (this.step === 'provider') {
      if (raw === '\x1B[A') { this.moveProvider(-1); this.render(); return; }
      if (raw === '\x1B[B') { this.moveProvider(1); this.render(); return; }
      if (raw === '\x1B') { this.step = 'welcome'; this.render(); return; }
      if (raw === '\r' || raw === '\n') { this.errors = {}; this.fieldIndex = 0; this.step = 'form'; this.render(); }
      return;
    }

    if (this.step === 'form') {
      if (raw === '\x1B[A') { this.fieldIndex = this.fieldIndex > 0 ? this.fieldIndex - 1 : FORM_FIELDS.length - 1; this.render(); return; }
      if (raw === '\x1B[B' || raw === '\t') { this.fieldIndex = this.fieldIndex < FORM_FIELDS.length - 1 ? this.fieldIndex + 1 : 0; this.render(); return; }
      if (raw === '\x1B') { this.errors = {}; this.step = 'provider'; this.render(); return; }
      if (raw === 'e') { this.startEditing(); this.render(); return; }
      if (raw === '\r' || raw === '\n') {
        const errs = validateSetupForm(this.form);
        this.errors = errs;
        if (Object.keys(errs).length === 0) { this.step = 'confirm'; }
        else { this.fieldIndex = this.findFirstInvalidField(errs); this.startEditing(); }
        this.render();
      }
      return;
    }

    if (this.step === 'confirm') {
      if (raw === '\x1B') { this.step = 'form'; this.render(); return; }
      if (raw === '\r' || raw === '\n') { this.submitConfig(); }
      return;
    }

    if (this.step === 'done' && this.result) {
      if (raw === '\r' || raw === '\n') {
        if (this.result.success) { this.stop(); this.onCompleted(); }
        else { this.step = 'form'; this.render(); }
      }
    }
  }

  private moveProvider(offset: number): void {
    const idx = PROVIDERS.indexOf(this.provider);
    this.provider = PROVIDERS[(idx + offset + PROVIDERS.length) % PROVIDERS.length];
    this.form = getDefaultSetupForm(this.provider);
    this.errors = {};
  }

  private startEditing(): void {
    const field = FORM_FIELDS[this.fieldIndex];
    this.editingField = field;
    this.editBuffer = this.form[field];
  }

  private findFirstInvalidField(errs: SetupValidationErrors): number {
    const idx = FORM_FIELDS.findIndex((f) => Boolean(errs[f]));
    return idx >= 0 ? idx : 0;
  }

  private submitConfig(): void {
    const errs = validateSetupForm(this.form);
    this.errors = errs;
    if (Object.keys(errs).length > 0) { this.fieldIndex = this.findFirstInvalidField(errs); this.step = 'form'; this.render(); return; }
    const config = buildJarvisConfig(this.form);
    const writeResult = writeBootstrapConfig(config);
    if (writeResult.success) {
      this.result = { success: true, message: '基础模型配置已完成，后续可直接启动进入聊天界面。', configPath: writeResult.path };
    } else {
      this.result = { success: false, message: writeResult.message };
    }
    this.step = 'done';
    this.render();
  }

  // ===== 渲染 =====

  private render(): void {
    process.stdout.write(ansi.clearScreen() + ansi.cursorPosition(1, 1));
    const w = process.stdout.columns || 80;
    this.renderHeader(w);

    if (this.step === 'welcome') this.renderWelcome();
    else if (this.step === 'provider') this.renderProvider();
    else if (this.step === 'form') this.renderForm();
    else if (this.step === 'confirm') this.renderConfirm();
    else if (this.step === 'done') this.renderDone();

    // 底部提示
    this.w('');
    this.w(` ${ansi.fg('gray')}快捷键：Enter 下一步或确认，Esc 返回，e 编辑当前字段，Ctrl+C 退出${ansi.RESET}`);
    if (this.ctrlCArmed) this.w(` ${ansi.fg('yellow')}再次按 Ctrl+C 退出${ansi.RESET}`);
  }

  private w(text: string): void { process.stdout.write(text + '\n'); }

  private renderHeader(width: number): void {
    const steps = [
      { key: 'welcome', label: '欢迎' }, { key: 'provider', label: '接入方式' },
      { key: 'form', label: '参数填写' }, { key: 'confirm', label: '确认写入' }, { key: 'done', label: '完成' },
    ];
    const currentIdx = steps.findIndex((s) => s.key === this.step);

    this.w(` ${ansi.fg('magenta')}${ansi.BOLD}Jarvis 首次启动配置${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}${this.status.ok ? '配置校验通过' : (this.status as any).message}${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}配置文件路径：${getBootstrapConfigPath()}${ansi.RESET}`);

    let progress = ' ';
    steps.forEach((s, i) => {
      const color = i < currentIdx ? 'green' : i === currentIdx ? 'cyan' : 'gray';
      progress += `${ansi.fg(color)}${i + 1}. ${s.label} ${ansi.RESET}`;
    });
    this.w(progress);
    this.w(` ${ansi.fg('gray')}${'─'.repeat(Math.min(Math.max(width - 2, 20), 72))}${ansi.RESET}`);
  }

  private renderWelcome(): void {
    this.w(` ${ansi.fg('white')}${ansi.BOLD}欢迎使用 Jarvis${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}检测到当前尚未完成可用模型配置，首次启动需要先完成基础引导。${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}完成后会直接进入主界面，无需再次执行额外命令。${ansi.RESET}`);
    this.w('');
    this.w(` ${ansi.fg('yellow')}当前状态${ansi.RESET}`);
    this.w(` ${this.status.ok ? '配置状态正常' : (this.status as any).message}`);
    this.w('');
    this.w(` ${ansi.fg('yellow')}本次会完成的配置${ansi.RESET}`);
    this.w(' 1. 设置默认模型配置名');
    this.w(' 2. 写入 API 地址与 API Key');
    this.w(' 3. 写入模型 ID 与基础参数');
    this.w('');
    this.w(` ${ansi.fg('cyan')}按 Enter 开始配置${ansi.RESET}`);
  }

  private renderProvider(): void {
    this.w(` ${ansi.fg('white')}${ansi.BOLD}选择接入方式${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}上下键切换，Enter 确认后进入参数填写。${ansi.RESET}`);
    this.w('');
    for (const p of PROVIDERS) {
      const sel = p === this.provider;
      const info = PROVIDER_LABELS[p];
      this.w(` ${sel ? ansi.fg('cyan') : ansi.fg('white')}${sel ? '›' : ' '} ${info.title}${ansi.RESET}`);
      this.w(` ${ansi.fg('gray')}${info.desc}${ansi.RESET}`);
    }
  }

  private renderForm(): void {
    this.w(` ${ansi.fg('white')}${ansi.BOLD}填写配置参数${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}当前接入方式：${this.provider === 'ollama' ? 'Ollama / 本地模型' : 'OpenAI 兼容接口'}${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}上下键切字段，按 e 编辑当前字段，Enter 校验并进入确认。${ansi.RESET}`);
    this.w('');
    for (let i = 0; i < FORM_FIELDS.length; i++) {
      const field = FORM_FIELDS[i];
      const sel = i === this.fieldIndex;
      const editing = field === this.editingField;
      const display = editing ? this.editBuffer + (sel ? `${ansi.INVERSE} ${ansi.RESET}` : '') : maskValue(field, this.form[field]);
      const err = this.errors[field];
      this.w(` ${sel ? ansi.fg('cyan') : ansi.fg('white')}${sel ? '›' : ' '} ${FIELD_LABELS[field]}：${display}${ansi.RESET}`);
      this.w(`   ${ansi.fg('gray')}${FIELD_DESCS[field]}${ansi.RESET}`);
      if (err) this.w(`   ${ansi.fg('red')}${err}${ansi.RESET}`);
    }
  }

  private renderConfirm(): void {
    this.w(` ${ansi.fg('white')}${ansi.BOLD}确认写入配置${ansi.RESET}`);
    this.w(` ${ansi.fg('gray')}确认无误后按 Enter 写入。Esc 可返回修改。${ansi.RESET}`);
    this.w('');
    this.w(` 配置名称：${this.form.profileName}`);
    this.w(` API 地址：${this.form.apiUrl}`);
    this.w(` 模型 ID：${this.form.model}`);
    this.w(` API Key：${maskApiKey(this.form.apiKey)}`);
    this.w('');
    this.w(` ${ansi.fg('yellow')}JSON 预览${ansi.RESET}`);
    const preview = JSON.stringify(buildJarvisConfig(this.form), null, 2);
    for (const line of preview.split('\n')) this.w(` ${ansi.fg('gray')}${line}${ansi.RESET}`);
  }

  private renderDone(): void {
    if (!this.result) return;
    this.w(` ${ansi.fg(this.result.success ? 'green' : 'red')}${ansi.BOLD}${this.result.success ? '配置写入成功' : '配置写入失败'}${ansi.RESET}`);
    this.w(` ${this.result.message}`);
    if (this.result.configPath) this.w(` ${ansi.fg('gray')}配置文件：${this.result.configPath}${ansi.RESET}`);
    this.w('');
    this.w(` ${ansi.fg('cyan')}${this.result.success ? '按 Enter 进入 Jarvis' : '按 Enter 返回修改'}${ansi.RESET}`);
  }
}
