import { loadConfig, getActiveModel } from '../config/loader.js';
import { readUserProfile, writeUserProfile } from '../config/userProfile.js';
import { logError, logInfo, logWarn } from '../core/logger.js';

interface ProfileCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

function extractMessageText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (item?.type === 'text' ? item.text ?? '' : ''))
    .join('');
}

function buildProfilePrompt(userInput: string, existingProfile: string): string {
  return [
    '请基于“已有用户画像”和“最新用户输入”，整理一份新的 USER.md。',
    '',
    '目标：让后续智能体在系统提示词中读取后，能够更了解用户。',
    '',
    '必须遵守：',
    '1. 只保留对后续交互有帮助的信息。',
    '2. 有明确依据的内容写成确定描述；只有弱信号时写成“可能/倾向于”。',
    '3. 没有依据时明确写“未知”，不要编造职业、年龄、经历。',
    '4. 输出必须是中文 Markdown，不要输出代码块围栏，不要解释你的推理过程。',
    '5. 画像应简洁稳定，避免复述用户原话。',
    '',
    '请严格按下面结构输出：',
    '# 用户画像',
    '## 基本信息',
    '- 职业：',
    '- 年龄阶段：',
    '- 所在地区：',
    '- 语言偏好：',
    '',
    '## 思维与沟通',
    '- 思维习惯：',
    '- 沟通风格：',
    '- 决策偏好：',
    '',
    '## 能力与背景',
    '- 技术背景：',
    '- 专业领域：',
    '- 熟悉工具：',
    '',
    '## 当前关注点',
    '- 长期目标：',
    '- 近期任务倾向：',
    '- 约束与偏好：',
    '',
    '## 交互建议',
    '- 回答策略：',
    '- 需要避免：',
    '',
    '## 置信说明',
    '- 高置信信息：',
    '- 低置信推断：',
    '- 明显未知：',
    '',
    '---',
    '已有用户画像：',
    existingProfile || '(暂无)',
    '',
    '最新用户输入：',
    userInput,
  ].join('\n');
}

export function shouldIncludeUserProfile(userInput: string): boolean {
  const normalizedInput = userInput.trim();
  if (!normalizedInput || normalizedInput.startsWith('/')) return false;

  const lowerInput = normalizedInput.toLowerCase();
  const personalPattern = /(我|我的|我们|咱们|自己|个人|习惯|偏好|目标|背景|职业|沟通|表达|风格|适合|建议|规划|选择|怎么学|如何学|怎么做|如何做|路线|方向|简历|面试)/;
  const operationalPattern = /(报错|bug|报错信息|堆栈|traceback|exception|sql|接口|代码|文件|目录|命令|脚本|npm|pnpm|mvn|gradle|git|docker|k8s|kubectl|日志|配置|tsconfig|package\.json|pom\.xml|\.ts|\.tsx|\.js|\.vue|\.java|\.xml|\/)/;

  if (personalPattern.test(normalizedInput)) return true;
  if (operationalPattern.test(lowerInput)) return false;
  if (normalizedInput.length <= 12) return false;

  return /(建议|方案|优先级|取舍|节奏|学习|成长|决策)/.test(normalizedInput);
}

export async function updateUserProfileFromInput(userInput: string): Promise<boolean> {
  const normalizedInput = userInput.trim();
  if (!normalizedInput) return false;

  const config = loadConfig();
  const activeModel = getActiveModel(config);
  if (!activeModel) {
    logWarn('user_profile.skip.no_active_model');
    return false;
  }

  const prompt = buildProfilePrompt(normalizedInput, readUserProfile());
  const body: Record<string, unknown> = {
    model: activeModel.model,
    messages: [
      {
        role: 'system',
        content: '你是一个严谨的用户画像整理助手，负责维护 ~/.jarvis/USER.md。输出必须是可直接写入文件的 Markdown 正文。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: Math.min(activeModel.max_tokens ?? 4096, 1200),
    temperature: 0.2,
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

    const data = await response.json() as ProfileCompletionResponse;
    const content = extractMessageText(data.choices?.[0]?.message?.content).trim();
    if (!content) {
      throw new Error('用户画像生成结果为空');
    }

    writeUserProfile(content);
    logInfo('user_profile.updated', {
      inputLength: normalizedInput.length,
      outputLength: content.length,
    });
    return true;
  } catch (error) {
    logError('user_profile.update_failed', error, {
      inputLength: normalizedInput.length,
    });
    return false;
  }
}
