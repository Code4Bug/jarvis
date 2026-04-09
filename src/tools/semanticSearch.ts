/**
 * 语义搜索工具
 *
 * 当配置了大模型时，先通过 LLM 对中文关键词进行语义扩展（同义词、近义词、相关表达），
 * 再用扩展后的词集合在文件中进行匹配搜索，实现"相似搜索"能力。
 * 未配置大模型时降级为普通关键词搜索。
 */

import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index.js';
import { loadConfig, getActiveModel } from '../config/loader.js';

/** 通过 LLM 扩展关键词，返回扩展后的词列表（含原始关键词） */
async function expandKeywords(keyword: string): Promise<string[]> {
  const config = loadConfig();
  const activeModel = getActiveModel(config);

  if (!activeModel) {
    return [keyword];
  }

  const prompt = `你是一个关键词扩展助手。请对以下搜索关键词进行语义扩展，生成同义词、近义词、相关表达和常见别名。

关键词: "${keyword}"

要求:
1. 返回 JSON 数组格式，例如: ["词1", "词2", "词3"]
2. 包含原始关键词
3. 包含中文同义词、近义词
4. 如果关键词是中文，也包含对应的英文表达
5. 如果关键词是英文，也包含对应的中文表达
6. 包含常见缩写或别名
7. 最多返回 15 个词
8. 只返回 JSON 数组，不要其他内容`;

  try {
    const url = activeModel.api_url;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${activeModel.api_key}`,
      },
      body: JSON.stringify({
        model: activeModel.model,
        messages: [
          { role: 'system', content: '你是一个关键词扩展助手，只返回 JSON 数组，不要任何其他内容。' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!response.ok) {
      return [keyword];
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';

    // 从返回内容中提取 JSON 数组
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      return [keyword];
    }

    const expanded: string[] = JSON.parse(jsonMatch[0]);
    // 确保原始关键词在列表中
    if (!expanded.includes(keyword)) {
      expanded.unshift(keyword);
    }
    return expanded.filter((w) => typeof w === 'string' && w.trim().length > 0);
  } catch {
    // LLM 调用失败，降级为原始关键词
    return [keyword];
  }
}

/** 在文件内容中检查是否匹配任意一个关键词（不区分大小写） */
function matchesAny(line: string, keywords: string[]): string | null {
  const lower = line.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
  matchedKeyword: string;
}

/** 递归遍历目录搜索 */
function walkAndSearch(dir: string, keywords: string[], results: SearchResult[], maxResults: number) {
  if (results.length >= maxResults) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.isDirectory()) {
        walkAndSearch(full, keywords, results, maxResults);
      } else {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) return;
            const matched = matchesAny(lines[i], keywords);
            if (matched) {
              results.push({
                file: full,
                line: i + 1,
                content: lines[i].trim(),
                matchedKeyword: matched,
              });
            }
          }
        } catch { /* 跳过二进制文件 */ }
      }
    }
  } catch { /* 跳过无权限目录 */ }
}

export const semanticSearch: Tool = {
  name: 'semantic_search',
  description: '语义搜索：通过大模型扩展中文关键词的同义词和相关表达，在指定目录中进行相似搜索。未配置大模型时降级为普通搜索。',
  parameters: {
    path: { type: 'string', description: '搜索目录', required: true },
    pattern: { type: 'string', description: '搜索关键词', required: true },
    expand: { type: 'string', description: '是否启用语义扩展（true/false），默认 true', required: false },
  },
  execute: async (args) => {
    const dirPath = (args.path as string) || '.';
    const pattern = args.pattern as string;
    const enableExpand = args.expand !== 'false';

    // 第一步：关键词扩展
    let keywords: string[];
    let expandInfo = '';

    if (enableExpand) {
      keywords = await expandKeywords(pattern);
      if (keywords.length > 1) {
        expandInfo = `语义扩展: "${pattern}" → [${keywords.map((k) => `"${k}"`).join(', ')}]\n\n`;
      } else {
        expandInfo = `未配置大模型或扩展失败，使用原始关键词: "${pattern}"\n\n`;
      }
    } else {
      keywords = [pattern];
      expandInfo = `普通搜索模式，关键词: "${pattern}"\n\n`;
    }

    // 第二步：搜索文件
    const results: SearchResult[] = [];
    walkAndSearch(dirPath, keywords, results, 50);

    if (results.length === 0) {
      return expandInfo + `未找到匹配的内容`;
    }

    // 格式化输出，标注匹配的关键词
    const formatted = results.map((r) =>
      `${r.file}:${r.line}: [匹配:"${r.matchedKeyword}"] ${r.content}`
    ).join('\n');

    return expandInfo + `找到 ${results.length} 条结果:\n${formatted}`;
  },
};
