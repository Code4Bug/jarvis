/**
 * spawnRegistry — spawn_subagent IPC 挂起请求注册表
 *
 * 独立模块，避免 spawnAgent.ts ↔ queryWorker.ts 循环依赖。
 * queryWorker.ts 和 spawnAgent.ts 都可以安全 import 此模块。
 */

/** 等待主线程完成 SubAgent 启动的挂起 Promise，key = requestId */
export const pendingSpawnRequests = new Map<string, (result: string) => void>();

// ===== 运行中 SubAgent 计数器 =====

/** 当前运行中的 SubAgent 数量 */
let _activeAgentCount = 0;

/** 计数变更订阅者列表 */
const _countListeners = new Set<(count: number) => void>();

/** 增加运行中 SubAgent 计数 */
export function incrementActiveAgents(): void {
  _activeAgentCount++;
  _countListeners.forEach((fn) => fn(_activeAgentCount));
}

/** 减少运行中 SubAgent 计数 */
export function decrementActiveAgents(): void {
  _activeAgentCount = Math.max(0, _activeAgentCount - 1);
  _countListeners.forEach((fn) => fn(_activeAgentCount));
}

/** 获取当前运行中 SubAgent 数量 */
export function getActiveAgentCount(): number {
  return _activeAgentCount;
}

/** 订阅计数变更，返回取消订阅函数 */
export function subscribeAgentCount(listener: (count: number) => void): () => void {
  _countListeners.add(listener);
  return () => _countListeners.delete(listener);
}
