import { Tool } from '../types/index';
import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { runCommand } from './runCommand';
import { listDirectory } from './listDirectory';
import { searchFiles } from './searchFiles';
import { semanticSearch } from './semanticSearch';
import { createSkill } from './createSkill';

export { readFile, writeFile, runCommand, listDirectory, searchFiles, semanticSearch, createSkill };

/** 所有内置工具 */
export const allTools: Tool[] = [readFile, writeFile, runCommand, listDirectory, searchFiles, semanticSearch, createSkill];

/** 按名称查找内置工具 */
export function findTool(name: string): Tool | undefined {
  return allTools.find((t) => t.name === name);
}

// ===== 合并工具（内置 + 外部 Skills）=====

import { getMergedTools, findMergedTool } from '../skills/index';

/** 获取所有工具（内置 + 外部 skills），供 QueryEngine 使用 */
export function getAllTools(): Tool[] {
  return getMergedTools();
}

/** 按名称查找工具（内置 + 外部 skills） */
export function findToolMerged(name: string): Tool | undefined {
  return findMergedTool(name);
}
