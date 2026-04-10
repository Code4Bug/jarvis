import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Message, MessageStatus, MessageType } from '../types/index';
import MarkdownText from './MarkdownText';

// 状态圆点 icon，根据消息类型 + 状态决定颜色
// reasoning 完成 → 白色 / tool_exec 成功 → 绿色 / error → 红色 / aborted → 黄色 / pending → 黄色
function statusDot(status: MessageStatus, type?: MessageType): { dot: string; color: string } {
  if (status === 'pending')  return { dot: '●', color: 'yellow' };
  if (status === 'aborted')  return { dot: '●', color: 'yellow' };
  if (status === 'error')    return { dot: '●', color: 'red' };
  // success 按消息类型区分
  if (type === 'reasoning')  return { dot: '●', color: 'white' };
  if (type === 'tool_exec')  return { dot: '●', color: 'green' };
  return { dot: '●', color: 'green' };
}

/** 消息统计信息行：耗时 / token 数 / 首 token 延时 / 平均 token/s */
function MessageStats({ msg, show }: { msg: Message; show: boolean }) {
  if (msg.type === 'user' || msg.status === 'pending') return null;
  // aborted 提示始终显示，不受 showDetails 控制
  const showAbortHint = msg.status === 'aborted' && msg.abortHint;
  if (!show && !showAbortHint) return null;
  const parts: string[] = [];
  if (show) {
    if (msg.duration != null) parts.push(`耗时 ${(msg.duration / 1000).toFixed(1)}s`);
    if (msg.tokenCount != null) parts.push(`${msg.tokenCount} tokens`);
    if (msg.firstTokenLatency != null) parts.push(`首token ${msg.firstTokenLatency}ms`);
    if (msg.tokensPerSecond != null) parts.push(`${msg.tokensPerSecond.toFixed(1)} tok/s`);
  }
  return (
    <Box flexDirection="column" marginLeft={2}>
      {parts.length > 0 && (
        <Text color="gray" dimColor>{parts.join(' · ')}</Text>
      )}
      {showAbortHint && (
        <Text color="red">⏹ {msg.abortHint}</Text>
      )}
    </Box>
  );
}

function MessageItem({ msg, showDetails = false }: { msg: Message; showDetails?: boolean }) {
  const { dot, color: dotColor } = statusDot(msg.status, msg.type);

  if (msg.type === 'user') {
    return (
      <Box marginBottom={1}>
        <Text color="gray">❯ </Text>
        <Text bold>{msg.content}</Text>
      </Box>
    );
  }

  if (msg.type === 'thinking' && msg.status === 'pending') {
    // pending 阶段 thinking 内容存储在 content 字段（由 onThinking 回调实时更新）
    const thinkContent = msg.content && msg.content !== '思考中...' ? msg.content : '';
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text color="gray"> <Text color={dotColor}>{dot}</Text> Thinking...</Text>
        </Box>
        {thinkContent ? (
          <Box marginLeft={2} flexDirection="column">
            <Text color="gray" dimColor wrap="wrap">
              {thinkContent.length > 200 ? thinkContent.slice(0, 200) + '...' : thinkContent}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  // thinking 完成后持久化渲染，Ctrl+O 展开/折叠
  if (msg.type === 'thinking' && msg.status === 'success' && msg.think) {
    return (
      <Box flexDirection="column" marginBottom={0}>
        <Box>
          <Text color="cyan">{'○'} </Text>
          <Text color="gray">Thinking</Text>
          <Text color="gray" dimColor> ({msg.think.length} chars)</Text>
          {!showDetails && <Text color="gray" dimColor>  [Ctrl+O 展开]</Text>}
        </Box>
        {showDetails && (
          <Box marginLeft={2} flexDirection="column">
            <Text color="gray" dimColor wrap="wrap">{msg.think}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (msg.type === 'tool_exec') {
    // Bash 工具直接显示命令内容
    const isBash = msg.toolName === 'Bash';
    const bashCmd = isBash && msg.toolArgs?.command ? String(msg.toolArgs.command) : '';
    // Skill 工具：skill_xxx → 名称(参数摘要) 格式
    const isSkill = msg.toolName?.startsWith('skill_');
    const skillName = isSkill ? msg.toolName!.replace(/^skill_/, '') : '';
    const skillArgsSummary = isSkill && msg.toolArgs
      ? Object.values(msg.toolArgs).map((v) => String(v)).filter(Boolean).join(', ')
      : '';
    const toolLabel = isBash && bashCmd ? `Bash(${bashCmd})` : (msg.toolName || 'tool');
    // 并行组标识
    const isParallel = !!msg.parallelGroupId;

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          {isParallel && <Text color="cyan" dimColor>⇉ </Text>}
          <Text color={dotColor}>{dot} </Text>
          {isBash && bashCmd ? (
            <Text><Text color="white" bold>Bash</Text><Text color="gray">({bashCmd})</Text></Text>
          ) : isSkill ? (
            <Text><Text color="cyan" bold>{skillName}</Text><Text color="gray">({skillArgsSummary})</Text></Text>
          ) : (
            <Text color="magenta" bold>{toolLabel}</Text>
          )}
        </Box>
        {showDetails && msg.toolArgs && !isBash && (
          <Box marginLeft={2}>
            <Text color="gray" dimColor wrap="wrap">{JSON.stringify(msg.toolArgs)}</Text>
          </Box>
        )}
        {showDetails && msg.toolResult && (
          <Box marginLeft={2}>
            <Text color="gray" wrap="wrap">
              {msg.toolResult.length > 300 ? msg.toolResult.slice(0, 300) + '…' : msg.toolResult}
            </Text>
          </Box>
        )}
        <MessageStats msg={msg} show={showDetails} />
      </Box>
    );
  }

  if (msg.type === 'error') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red"><Text color={dotColor}>{dot}</Text> {msg.content}</Text>
        <MessageStats msg={msg} show={showDetails} />
      </Box>
    );
  }

  if (msg.type === 'reasoning') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={dotColor}>{dot}</Text>
          <Box marginLeft={1}>
            <MarkdownText text={msg.content} />
          </Box>
        </Box>
        <MessageStats msg={msg} show={showDetails} />
      </Box>
    );
  }

  if (msg.status !== 'pending' && msg.content) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={dotColor}>{dot}</Text>
          <Box marginLeft={1}>
            <MarkdownText text={msg.content} color="gray" />
          </Box>
        </Box>
        <MessageStats msg={msg} show={showDetails} />
      </Box>
    );
  }

  return null;
}

export default React.memo(MessageItem, (prev, next) => {
  // 仅当消息内容或显示详情变化时才重新渲染
  return prev.msg === next.msg && prev.showDetails === next.showDetails;
});
