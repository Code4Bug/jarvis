import React from 'react';
import { Box, Text } from 'ink';
import { APP_NAME, APP_VERSION, MODEL_NAME } from '../config/constants.js';

function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}

/** ASCII art logo */
const LOGO_LINES = [
  '     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗',
  '     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝',
  '     ██║███████║██████╔╝██║   ██║██║███████╗',
  '██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║',
  '╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║',
  ' ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝',
];
const LOGO_COLORS: Array<string> = ['cyan', 'cyan', 'blueBright', 'blueBright', 'magenta', 'magenta'];

function WelcomeHeader({ width }: { width: number }) {
  const maxPath = Math.max(width - 10, 20);
  const showLogo = width >= 52;

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      {/* ASCII Logo */}
      {showLogo && (
        <Box flexDirection="column">
          {LOGO_LINES.map((line, i) => (
            <Text key={i} color={LOGO_COLORS[i]}>{line}</Text>
          ))}
        </Box>
      )}

      {/* 标语 */}
      <Box marginTop={0}>
        <Text color="gray"></Text>
        <Text color="white" bold>Your AI-Powered Dev Companion</Text>
        <Text color="gray"></Text>
      </Box>

      {/* 分隔线 */}
      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(Math.min(width - 4, 48))}</Text>
      </Box>

      {/* 信息行 */}
      <Box marginTop={0}>
        <Text color="gray">model </Text>
        <Text color="cyan">{MODEL_NAME}</Text>
        <Text color="gray">  {APP_NAME} </Text>
        <Text color="magenta">{APP_VERSION}</Text>
      </Box>
      <Box>
        <Text color="gray">{truncatePath(process.cwd(), maxPath)}</Text>
      </Box>

      {/* 分隔线 */}
      <Box marginTop={1}>
        <Text color="gray">{'─'.repeat(Math.min(width - 4, 48))}</Text>
      </Box>

      {/* 快捷命令 */}
      <Box>
        <Text color="gray">/</Text><Text color="cyan">init</Text>
        <Text color="gray"> 初始化  </Text>
        <Text color="gray">/</Text><Text color="cyan">help</Text>
        <Text color="gray"> 帮助  </Text>
        <Text color="gray">/</Text><Text color="cyan">new</Text>
        <Text color="gray"> 新会话  </Text>
        <Text color="gray">/</Text><Text color="cyan">agent</Text>
        <Text color="gray"> 切换</Text>
      </Box>

      <Text>{' '}</Text>
    </Box>
  );
}

export default React.memo(WelcomeHeader);
