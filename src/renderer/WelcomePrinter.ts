/**
 * 欢迎界面打印器
 *
 * 输出 ASCII logo 和基本信息，不依赖 Ink 组件。
 */

import * as ansi from './ansi.js';
import { APP_VERSION, getAppName, getModelName } from '../config/constants.js';

const LOGO_LINES = [
  '     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗',
  '     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝',
  '     ██║███████║██████╔╝██║   ██║██║███████╗',
  '██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║',
  '╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║',
  ' ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝',
];
const LOGO_COLORS = ['cyan', 'cyan', 'brightBlue', 'brightBlue', 'magenta', 'magenta'];

function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}

export function printWelcome(width: number): void {
  const maxPath = Math.max(width - 10, 20);
  const showLogo = width >= 52;
  const appName = getAppName();
  const modelName = getModelName();
  const w = (text: string) => process.stdout.write(text + '\n');

  if (showLogo) {
    for (let i = 0; i < LOGO_LINES.length; i++) {
      w(` ${ansi.fg(LOGO_COLORS[i])}${LOGO_LINES[i]}${ansi.RESET}`);
    }
  }

  w(` ${ansi.fg('white')}${ansi.BOLD}Your AI-Powered Dev Companion${ansi.RESET}`);
  w('');
  w(` ${ansi.fg('gray')}${'─'.repeat(Math.min(width - 4, 48))}${ansi.RESET}`);
  w(` ${ansi.fg('gray')}model ${ansi.RESET}${ansi.fg('cyan')}${modelName}${ansi.RESET}${ansi.fg('gray')}  ${appName} ${ansi.RESET}${ansi.fg('magenta')}${APP_VERSION}${ansi.RESET}`);
  w(` ${ansi.fg('gray')}${truncatePath(process.cwd(), maxPath)}${ansi.RESET}`);
  w(` ${ansi.fg('gray')}${'─'.repeat(Math.min(width - 4, 48))}${ansi.RESET}`);
  w(` ${ansi.fg('gray')}/${ansi.RESET}${ansi.fg('cyan')}init${ansi.RESET}${ansi.fg('gray')} 初始化  /${ansi.RESET}${ansi.fg('cyan')}help${ansi.RESET}${ansi.fg('gray')} 帮助  /${ansi.RESET}${ansi.fg('cyan')}new${ansi.RESET}${ansi.fg('gray')} 新会话  /${ansi.RESET}${ansi.fg('cyan')}agent${ansi.RESET}${ansi.fg('gray')} 切换  ${ansi.RESET}${ansi.fg('yellow')}${ansi.BOLD}?${ansi.RESET}${ansi.fg('gray')} 快捷键提示${ansi.RESET}`);
  w('');
}
