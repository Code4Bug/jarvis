import fs from 'fs';
import { Tool } from '../types/index';

export const listDirectory: Tool = {
  name: 'list_directory',
  description: '列出指定目录的文件和文件夹',
  parameters: {
    path: { type: 'string', description: '目录路径', required: true },
  },
  execute: async (args) => {
    const dirPath = (args.path as string) || '.';
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `[DIR] ${e.name}` : `      ${e.name}`))
        .join('\n');
    } catch (e: any) {
      throw new Error(`列出目录失败: ${e.message}`);
    }
  },
};
