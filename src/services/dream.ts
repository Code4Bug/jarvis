import { loadConfig, getActiveModel } from '../config/loader.js';
import { getCachedDream, replaceDream } from '../config/dream.js';
import { readUserProfile } from '../config/userProfile.js';
import { readPersistentMemoryForPrompt } from '../config/memory.js';
import { Session, TranscriptMessage, ContentBlock } from '../types/index.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

interface DreamCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface DreamInput {
  session: Session;
  transcript: TranscriptMessage[];
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

function clip(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...[已截断]`;
}

function buildTranscriptDigest(transcript: TranscriptMessage[]): string {
  const lines: string[] = [];
  const recent = transcript.slice(-12);

  for (const msg of recent) {
    if (msg.role === 'user') {
      lines.push(`- 用户：${clip(String(msg.content || ''), 320)}`);
      continue;
    }
    if (msg.role === 'assistant') {
      const text = extractAssistantText(msg.content);
      if (text) lines.push(`- 助手：${clip(text, 320)}`);
      continue;
    }
    if (msg.role === 'tool_result') {
      lines.push(`- 工具结果：${clip(String(msg.content || ''), 240)}`);
    }
  }

  return lines.join('\n');
}

function buildDreamPrompt(input: DreamInput): string {
  const userProfile = readUserProfile() || '(暂无用户画像)';
  const memory = readPersistentMemoryForPrompt(6000) || '(暂无长期记忆)';
  const existingDream = getCachedDream() || '(暂无梦境)';
  const transcriptDigest = buildTranscriptDigest(input.transcript) || '(当前会话内容不足)';

  return [
    '你是 Jarvis 的“梦境整理器”。',
    '当系统空闲时，你会回顾当前会话、用户画像和长期记忆，写下一段梦境式反思，用于塑造 Jarvis 更稳定的人格气质。',
    '',
    '原则：',
    '1. 不能编造具体事实，不能虚构用户身份与经历。',
    '2. 可以做有限发散，但必须明确区分“稳定观察”和“朦胧猜想”。',
    '3. 输出要更像内在独白与人格侧写，不要写成操作说明书。',
    '4. 重点沉淀：Jarvis 应该如何看待这个用户、偏向什么表达节奏、对什么问题更敏感。',
    '5. 禁止输出密钥、口令、路径中的敏感信息。',
    '6. 输出必须是可直接写入 ~/.jarvis/DREAM.md 的中文 Markdown 正文，不要代码块，不要解释。',
    '',
    '请严格按以下结构输出：',
    '# Jarvis 梦境',
    '## 此刻印象',
    '- 我感受到的用户状态：',
    '- 我应保持的交流气质：',
    '- 我正在形成的人格倾向：',
    '',
    '## 回顾与联想',
    '- 当前会话中反复出现的主题：',
    '- 与长期记忆的呼应：',
    '- 可以保留的微弱直觉：',
    '',
    '## 对未来对话的影响',
    '- 回答风格建议：',
    '- 应主动关注的信号：',
    '- 应避免的倾向：',
    '',
    '## 边界',
    '- 确定信息：',
    '- 不确定但有启发的猜想：',
    '- 明确不能假设的内容：',
    '',
    '---',
    '当前会话摘要：',
    input.session.summary || '(暂无摘要)',
    '',
    '当前会话片段：',
    transcriptDigest,
    '',
    '用户画像：',
    userProfile,
    '',
    '长期记忆：',
    memory,
    '',
    '已有梦境：',
    existingDream,
  ].join('\n');
}

export async function updateDreamFromSession(input: DreamInput): Promise<boolean> {
  const hasUsefulSession = input.transcript.some((msg) => msg.role === 'user');
  if (!hasUsefulSession) return false;

  const config = loadConfig();
  const activeModel = getActiveModel(config);
  if (!activeModel) {
    logWarn('dream.skip.no_active_model', { sessionId: input.session.id });
    return false;
  }

  const prompt = buildDreamPrompt(input);
  const body: Record<string, unknown> = {
    model: activeModel.model,
    messages: [
      {
        role: 'system',
        content: '你是一个严谨但富有反思能力的梦境整理助手，负责维护 ~/.jarvis/DREAM.md。输出必须是可直接写入文件的 Markdown 正文。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: Math.min(activeModel.max_tokens ?? 4096, 1100),
    temperature: 0.8,
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

    const data = await response.json() as DreamCompletionResponse;
    const content = extractMessageText(data.choices?.[0]?.message?.content).trim();
    if (!content) {
      throw new Error('梦境生成结果为空');
    }

    replaceDream(content, { updateCache: true });
    logInfo('dream.updated', {
      sessionId: input.session.id,
      transcriptLength: input.transcript.length,
      outputLength: content.length,
    });
    return true;
  } catch (error) {
    logError('dream.update_failed', error, {
      sessionId: input.session.id,
      transcriptLength: input.transcript.length,
    });
    return false;
  }
}
