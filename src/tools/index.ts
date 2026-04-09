import { Tool } from '../types/index.js';
import { readFile } from './readFile.js';
import { writeFile } from './writeFile.js';
import { runCommand } from './runCommand.js';
import { listDirectory } from './listDirectory.js';
import { searchFiles } from './searchFiles.js';
import { semanticSearch } from './semanticSearch.js';
import { createSkill } from './createSkill.js';

export { readFile, writeFile, runCommand, listDirectory, searchFiles, semanticSearch, createSkill };

/** 所有内置工具 */
export const allTools: Tool[] = [readFile, writeFile, runCommand, listDirectory, searchFiles, semanticSearch, createSkill];

/** 按名称查找内置工具 */
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}

// ===== 合并工具（内置 + 外部 Skills）=====

import { getMergedTools, findMergedTool } from '../skills/index.js';

/** 获取所有工具（内置 + 外部 skills），供 QueryEngine 使用 */
export function getAllTools(): Tool[] {
  return getMergedTools();
}

/** 按名称查找工具（内置 + 外部 skills） */
export function findToolMerged(name: string): Tool | undefined {
  return findMergedTool(name);
}
