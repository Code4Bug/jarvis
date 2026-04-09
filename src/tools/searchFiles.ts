import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index';

export const searchFiles: Tool = {
  name: 'search_files',
  description: '在指定目录中搜索包含关键词的文件',
  parameters: {
    path: { type: 'string', description: '搜索目录', required: true },
    pattern: { type: 'string', description: '搜索关键词', required: true },
  },
  execute: async (args) => {
    const dirPath = (args.path as string) || '.';
    const pattern = args.pattern as string;
    const results: string[] = [];

    function walk(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.isDirectory()) {
            walk(full);
          } else {
            try {
              const content = fs.readFileSync(full, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(pattern)) {
                  results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
                }
              }
            } catch { /* skip binary */ }
          }
        }
      } catch { /* skip inaccessible */ }
    }

    walk(dirPath);
    return results.length > 0
      ? results.slice(0, 50).join('\n')
      : `未找到包含 "${pattern}" 的文件`;
  },
};
