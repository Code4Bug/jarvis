import fs from 'fs';
import { Tool } from '../types/index.js';

export const readFile: Tool = {
  name: 'read_file',
  description: '读取指定路径的文件内容',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
  },
  execute: async (args) => {
    const filePath = args.path as string;
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      throw new Error(`读取文件失败: ${e.message}`);
    }
  },
};
