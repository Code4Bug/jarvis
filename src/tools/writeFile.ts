import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index.js';
import { detectSensitiveContent } from '../core/safeguard.js';

/**
 * 将 unified diff 补丁应用到原始文本上。
 * 支持标准 unified diff 格式（@@ -a,b +c,d @@ 开头的 hunk）。
 */
function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = original.split('\n');
  const diffLines = diff.split('\n');

  // 解析所有 hunk
  interface Hunk {
    oldStart: number;
    oldCount: number;
    lines: string[];
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const line of diffLines) {
    // 跳过 --- / +++ 头部行
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;

    const hunkHeader = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+\d+(?:,\d+)?\s+@@/);
    if (hunkHeader) {
      currentHunk = {
        oldStart: parseInt(hunkHeader[1], 10),
        oldCount: hunkHeader[2] !== undefined ? parseInt(hunkHeader[2], 10) : 1,
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')) {
      // 空行在 diff 中视为上下文行（无前缀空格的情况）
      if (line === '' && currentHunk.lines.length > 0) {
        currentHunk.lines.push(' ');
      } else {
        currentHunk.lines.push(line);
      }
    }
  }

  if (hunks.length === 0) {
    throw new Error('未找到有效的 diff hunk（需要 @@ -a,b +c,d @@ 格式）');
  }

  // 从后往前应用 hunk，避免行号偏移
  hunks.sort((a, b) => b.oldStart - a.oldStart);

  const result = [...originalLines];

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1; // 转为 0-based
    const removedLines: string[] = [];
    const addedLines: string[] = [];

    // 先收集本 hunk 中所有操作，按顺序重建目标区域
    const newSection: string[] = [];
    let oldLineIdx = startIdx;

    for (const hLine of hunk.lines) {
      if (hLine.startsWith('-')) {
        // 删除行：跳过原文中对应行
        oldLineIdx++;
      } else if (hLine.startsWith('+')) {
        // 新增行
        newSection.push(hLine.substring(1));
      } else {
        // 上下文行（以空格开头或空行）
        newSection.push(hLine.substring(1));
        oldLineIdx++;
      }
    }

    // 计算实际消耗的原文行数
    let oldLinesConsumed = 0;
    for (const hLine of hunk.lines) {
      if (hLine.startsWith('-') || hLine.startsWith(' ')) {
        oldLinesConsumed++;
      }
    }

    result.splice(startIdx, oldLinesConsumed, ...newSection);
  }

  return result.join('\n');
}

/**
 * 写入文件内容（支持安全检测）。
 * 返回写入结果消息。
 */
function doWrite(filePath: string, content: string): string {
  const findings = detectSensitiveContent(content);
  const warning =
    findings.length > 0
      ? `\n检测到文件中包含疑似敏感信息: ${findings.join(', ')}\n建议使用环境变量替代硬编码。文件仍将写入，但请注意安全风险。`
      : '';

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return `文件已写入: ${filePath}${warning}`;
  } catch (e: any) {
    throw new Error(`写入文件失败: ${e.message}`);
  }
}

export const writeFile: Tool = {
  name: 'write_file',
  description:
    '写入内容到指定文件。支持两种模式：overwrite（默认）完整替换文件内容；diff 模式接收 unified diff 格式补丁，对文件进行增量更新。',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
    content: { type: 'string', description: '文件内容（overwrite 模式必填）', required: false },
    mode: {
      type: 'string',
      description: '写入模式：overwrite（完整替换，默认）| diff（增量更新）',
      required: false,
    },
    diff: {
      type: 'string',
      description: 'unified diff 格式的补丁内容（diff 模式必填），需包含 @@ hunk header',
      required: false,
    },
  },
  execute: async (args) => {
    const filePath = args.path as string;
    const mode = (args.mode as string) || 'overwrite';

    if (mode === 'diff') {
      const diffContent = args.diff as string;
      if (!diffContent) {
        throw new Error('diff 模式下必须提供 diff 参数');
      }

      // 读取原文件
      if (!fs.existsSync(filePath)) {
        throw new Error(`diff 模式要求目标文件已存在: ${filePath}`);
      }

      const original = fs.readFileSync(filePath, 'utf-8');

      let patched: string;
      try {
        patched = applyUnifiedDiff(original, diffContent);
      } catch (e: any) {
        throw new Error(`应用 diff 失败: ${e.message}`);
      }

      return doWrite(filePath, patched);
    }

    // overwrite 模式
    const content = args.content as string;
    if (content === undefined || content === null) {
      throw new Error('overwrite 模式下必须提供 content 参数');
    }

    return doWrite(filePath, content);
  },
};
