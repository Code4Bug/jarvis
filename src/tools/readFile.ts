import fs from 'fs';
import path from 'path';
import { Tool } from '../types/index.js';

// 单次读取文件大小上限：1MB
const MAX_FILE_SIZE = 1 * 1024 * 1024;

export const readFile: Tool = {
  name: 'read_file',
  description: '读取指定路径的文件内容',
  parameters: {
    path: { type: 'string', description: '文件路径（支持绝对路径或相对于当前工作目录的相对路径）', required: true },
  },
  execute: async (args) => {
    const rawPath = args.path as string;
    if (!rawPath || !rawPath.trim()) {
      throw new Error('path 参数不能为空');
    }

    // 统一解析为绝对路径，相对路径基于 process.cwd()
    const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

    try {
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        throw new Error(`路径是目录而非文件: ${filePath}`);
      }

      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
          `文件过大（${(stat.size / 1024).toFixed(1)} KB），超过读取上限 ${MAX_FILE_SIZE / 1024} KB，请使用 search_files 或分段读取`
        );
      }

      return fs.readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      // 区分"文件不存在"和其他 IO 错误，给出更明确的提示
      if (e.code === 'ENOENT') {
        throw new Error(`文件不存在: ${filePath}`);
      }
      if (e.code === 'EACCES') {
        throw new Error(`无权限读取文件: ${filePath}`);
      }
      // 重新抛出已包装的错误（如上面的 size/dir 检查）
      throw e.message?.startsWith('文件') || e.message?.startsWith('路径')
        ? e
        : new Error(`读取文件失败: ${e.message}`);
    }
  },
};
