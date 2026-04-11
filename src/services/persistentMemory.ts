import { loadConfig, getActiveModel } from '../config/loader.js';
import { appendPersistentMemory, readPersistentMemoryForPrompt } from '../config/memory.js';
import { TranscriptMessage, ContentBlock } from '../types/index.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

interface MemoryCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface PersistentMemoryUpdateInput {
  sessionId: string;
  userInput: string;
  recentTranscript: TranscriptMessage[];
}

function extractMessageText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (item?.type === 'text' ? item.text ?? '' : ''))
    .join('');
}

function extractAssistantText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractToolUses(content: string | ContentBlock[]): Array<{ name: string; input: string }> {
  if (typeof content === 'string') return [];
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')
    .map((block) => ({
      name: block.name,
      input: JSON.stringify(block.input, null, 2).slice(0, 600),
    }));
}

function clip(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...[已截断]`;
}

function buildRecentConversationDigest(userInput: string, recentTranscript: TranscriptMessage[]): string {
  const lines: string[] = [];
  lines.push(`- 最新用户问题：${clip(userInput, 600)}`);

  const assistantTexts: string[] = [];
  const toolUses: Array<{ name: string; input: string }> = [];
  const toolResults: string[] = [];

  for (const msg of recentTranscript) {
    if (msg.role === 'assistant') {
      const text = extractAssistantText(msg.content);
      if (text) assistantTexts.push(text);
      toolUses.push(...extractToolUses(msg.content));
      continue;
    }
    if (msg.role === 'tool_result') {
      toolResults.push(clip(String(msg.content || ''), 500));
    }
  }

  if (assistantTexts.length > 0) {
    lines.push('- 助手最终输出：');
    lines.push(clip(assistantTexts[assistantTexts.length - 1], 1200));
  }

  if (toolUses.length > 0) {
    lines.push('- 本轮使用的工具：');
    for (const tool of toolUses.slice(0, 8)) {
      lines.push(`  - ${tool.name}: ${clip(tool.input, 240)}`);
    }
  }

  if (toolResults.length > 0) {
    lines.push('- 关键工具结果：');
    for (const result of toolResults.slice(-4)) {
      lines.push(`  - ${result}`);
    }
  }

  return lines.join('\n');
}

function buildMemoryPrompt(input: PersistentMemoryUpdateInput, existingMemory: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const digest = buildRecentConversationDigest(input.userInput, input.recentTranscript);

  return [
    '你是 Jarvis 的“长期记忆管理器”。',
    '你的职责是在每轮对话结束后，判断本轮是否产生了值得长期保留的经验、技能、偏好、约束、排障结论或稳定环境事实，并写成简洁的 MEMORY.md 追加片段。',
    '',
    '写入原则：',
    '1. 只保留对未来有复用价值、较稳定的信息。',
    '2. 一次性任务、临时结果、泛泛寒暄、纯上下文复述，一律不要写。',
    '3. 禁止写入密钥、令牌、密码、Cookie、身份证号、手机号等敏感信息。',
    '4. 如果已有记忆已经覆盖本轮结论，返回 SKIP。',
    '5. 如果本轮没有形成可迁移经验，返回 SKIP。',
    '6. 输出必须是中文 Markdown 正文，不要代码块，不要解释。',
    '',
    '输出要求：',
    '1. 只有两种输出：',
    '   - SKIP',
    '   - 一段可直接追加到 MEMORY.md 的 Markdown',
    '2. 若选择写入，必须严格使用下面格式：',
    '## <经验标题>',
    `- 时间：${today}`,
    '- 场景：<什么情况下适用>',
    '- 结论：<可复用经验或稳定事实>',
    '- 用法：<后续如何用>',
    '- 边界：<适用边界或注意事项>',
    '- 依据：<来自本轮哪些观察>',
    '',
    '已有 MEMORY.md（可能已截断）：',
    existingMemory || '(暂无)',
    '',
    '本轮对话摘要：',
    digest,
  ].join('\n');
}

export async function updatePersistentMemoryFromConversation(input: PersistentMemoryUpdateInput): Promise<boolean> {
  if (!input.userInput.trim()) return false;
  if (input.recentTranscript.length === 0) return false;

  const config = loadConfig();
  const activeModel = getActiveModel(config);
  if (!activeModel) {
    logWarn('persistent_memory.skip.no_active_model', { sessionId: input.sessionId });
    return false;
  }

  const existingMemory = readPersistentMemoryForPrompt(8000);
  const prompt = buildMemoryPrompt(input, existingMemory);
  const body: Record<string, unknown> = {
    model: activeModel.model,
    messages: [
      {
        role: 'system',
        content: '你是一个严谨的长期记忆整理助手，负责维护 ~/.jarvis/MEMORY.md。请只输出 SKIP 或可直接落盘的 Markdown 片段。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: Math.min(activeModel.max_tokens ?? 4096, 900),
    temperature: 0.1,
    stream: false,
  };

  if (activeModel.extra_body) {
    Object.assign(body, activeModel.extra_body);
  }

  try {
    const response = await fetch(activeModel.api_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeModel.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 错误 ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await response.json() as MemoryCompletionResponse;
    const content = extractMessageText(data.choices?.[0]?.message?.content).trim();
    if (!content || content === 'SKIP') {
      logInfo('persistent_memory.skip', {
        sessionId: input.sessionId,
        reason: !content ? 'empty' : 'model_skip',
      });
      return false;
    }

    appendPersistentMemory(content);
    logInfo('persistent_memory.updated', {
      sessionId: input.sessionId,
      contentLength: content.length,
    });
    return true;
  } catch (error) {
    logError('persistent_memory.update_failed', error, {
      sessionId: input.sessionId,
    });
    return false;
  }
}
