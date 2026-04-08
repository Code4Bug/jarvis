import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index.js';
import { detectSensitiveContent } from '../core/safeguard.js';

export const writeFile: Tool = {
  name: 'write_file',
  description: '写入内容到指定文件',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
    content: { type: 'string', description: '文件内容', required: true },
  },
  execute: async (args) => {
    const filePath = args.path as string;
    const content = args.content as string;

    // ===== 安全围栏：检测硬编码敏感信息 =====
    const findings = detectSensitiveContent(content);
    if (findings.length > 0) {
      const warning = `检测到文件中包含疑似敏感信息: ${findings.join(', ')}\n` +
        '建议使用环境变量替代硬编码。文件仍将写入，但请注意安全风险。';
      // 仍然写入，但在结果中附带警告
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return `文件已写入: ${filePath}\n${warning}`;
      } catch (e: any) {
        throw new Error(`写入文件失败: ${e.message}`);
      }
    }

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return `文件已写入: ${filePath}`;
    } catch (e: any) {
      throw new Error(`写入文件失败: ${e.message}`);
    }
  },
};
