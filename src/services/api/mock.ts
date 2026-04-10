import { LLMService, StreamCallbacks, TranscriptMessage, Tool, AbortSignal as AppAbortSignal } from '../../types/index.js';

/**
 * Mock LLM 服务 - 模拟智能体行为，支持工具调用
 */
export class MockService implements LLMService {
  async streamMessage(
    transcript: TranscriptMessage[],
    _tools: Tool[],
    callbacks: StreamCallbacks,
    abortSignal?: AppAbortSignal,
  ): Promise<void> {
    const lastMsg = transcript[transcript.length - 1];
    const userText =
      typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : '';

    // 检查是否是工具结果的后续回复
    const hasToolResult = transcript.some((m) => m.role === 'tool_result');

    if (hasToolResult && !userText) {
      // 对工具结果做总结
      const toolResultMsg = [...transcript].reverse().find((m) => m.role === 'tool_result');
      const resultText = typeof toolResultMsg?.content === 'string' ? toolResultMsg.content : '';
      const summary = `以上是工具执行的结果。\n\n${resultText.slice(0, 200)}${resultText.length > 200 ? '...' : ''}`;
      if (await this.streamText(summary, callbacks, abortSignal)) return;
      callbacks.onComplete();
      return;
    }

    const input = userText.toLowerCase().trim();

    // 路由：根据用户输入决定是否调用工具
    if (input.includes('ls') || input.includes('列出') || input.includes('目录')) {
      if (await this.streamText('好的，让我查看一下当前目录的内容。\n', callbacks, abortSignal)) return;
      callbacks.onToolUse('tool_1', 'list_directory', { path: '.' });
      return;
    }

    if (input.includes('读取') || input.includes('read') || input.includes('查看文件')) {
      const fileMatch = userText.match(/(?:读取|read|查看文件)\s+(\S+)/i);
      const filePath = fileMatch?.[1] || 'package.json';
      if (await this.streamText(`好的，我来读取文件 ${filePath}。\n`, callbacks, abortSignal)) return;
      callbacks.onToolUse('tool_2', 'read_file', { path: filePath });
      return;
    }

    if (input.includes('搜索') || input.includes('search') || input.includes('查找')) {
      const keyword = userText.replace(/^.*(搜索|search|查找)\s*/i, '').trim() || 'TODO';
      if (await this.streamText(`好的，我来搜索包含 "${keyword}" 的文件。\n`, callbacks, abortSignal)) return;
      callbacks.onToolUse('tool_3', 'search_files', { path: '.', pattern: keyword });
      return;
    }

    if (input.includes('执行') || input.includes('运行') || input.includes('run')) {
      const cmd = userText.replace(/^.*(执行|运行|run)\s*/i, '').trim() || 'echo hello';
      if (await this.streamText(`好的，我来执行命令: \`${cmd}\`\n`, callbacks, abortSignal)) return;
      callbacks.onToolUse('tool_4', 'run_command', { command: cmd });
      return;
    }

    if (input.includes('时间') || input.includes('time') || input.includes('几点')) {
      if (await this.streamText(`当前时间是: ${new Date().toLocaleString('zh-CN')}`, callbacks, abortSignal)) return;
      callbacks.onComplete();
      return;
    }

    if (input.includes('帮助') || input.includes('help')) {
      const helpText = [
        '我是 Jarvis，你的终端智能助手。我可以帮你：',
        '',
        '文件操作：「列出目录」「读取 <文件>」「搜索 <关键词>」',
        '执行命令：「执行 <命令>」「运行 ls -la」',
        '实用工具：「时间」「帮助」',
        '',
        '快捷键：Ctrl+L 清屏 | Ctrl+C 退出 | Esc 终止任务/清空输入',
      ].join('\n');
      if (await this.streamText(helpText, callbacks, abortSignal)) return;
      callbacks.onComplete();
      return;
    }

    // 默认回复
    const reply = `你好！我是 Jarvis 智能助手。你说了「${userText}」。\n\n输入「帮助」查看我能做什么。`;
    // 模拟思考过程
    if (callbacks.onThinking) {
      const thinkText = `分析用户输入: "${userText}"\n考虑最佳回复方式...`;
      for (const char of thinkText) {
        if (abortSignal?.aborted) return;
        callbacks.onThinking(char);
        await sleep(10);
      }
    }
    if (await this.streamText(reply, callbacks, abortSignal)) return;
    callbacks.onComplete();
  }

  /** 模拟流式逐字输出 */
  private async streamText(text: string, callbacks: StreamCallbacks, abortSignal?: AppAbortSignal): Promise<boolean> {
    for (const char of text) {
      if (abortSignal?.aborted) return true;
      callbacks.onText(char);
      await sleep(15 + Math.random() * 20);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
