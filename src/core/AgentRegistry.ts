/**
 * AgentUIBus — 后台子 Agent 向 UI 推送消息的持久通道
 *
 * 解决问题：spawn_agent 启动的后台子 Agent 生命周期跨越多个 queryWorker，
 * 而 toolCallbacks 只在单次 LLM 调用期间有效。
 *
 * 方案：后台子 Agent 的消息通过此模块的全局回调推送，
 * QueryEngine 在初始化时注册回调，生命周期与应用一致。
 */
import { Message } from '../types/index.js';

type UIMessageCallback = (msg: Message) => void;
type UIUpdateCallback = (id: string, updates: Partial<Message>) => void;

class AgentUIBus {
  private onMessage: UIMessageCallback | null = null;
  private onUpdateMessage: UIUpdateCallback | null = null;

  /** QueryEngine 初始化时注册，生命周期与应用一致 */
  register(onMessage: UIMessageCallback, onUpdateMessage: UIUpdateCallback): void {
    this.onMessage = onMessage;
    this.onUpdateMessage = onUpdateMessage;
  }

  push(msg: Message): void {
    this.onMessage?.(msg);
  }

  update(id: string, updates: Partial<Message>): void {
    this.onUpdateMessage?.(id, updates);
  }
}

export const agentUIBus = new AgentUIBus();
