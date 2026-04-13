export interface ShortcutItem {
  key: string;
  description: string;
}

export interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

export function getShortcutPlatformLabel(): string {
  if (isMac) return 'macOS';
  if (isWindows) return 'Windows';
  return 'Linux';
}

export function getShortcutAltKeyLabel(): string {
  return isMac ? 'Option' : 'Alt';
}

export function getShortcutPlatformNote(): string {
  if (isMac) return '当前平台：macOS（终端内快捷键使用 Ctrl / Option，通常不是 Cmd）';
  if (isWindows) return '当前平台：Windows（快捷键使用 Ctrl / Alt）';
  return '当前平台：Linux（快捷键使用 Ctrl / Alt）';
}

export function getShortcutSections(): ShortcutSection[] {
  const altKey = getShortcutAltKeyLabel();
  const platform = getShortcutPlatformLabel();

  return [
    {
      title: '通用快捷键',
      items: [
        { key: '? + Enter', description: '查看全部快捷键说明' },
        { key: 'Ctrl + C', description: '退出 Jarvis（需连续按两次）' },
        { key: 'Ctrl + L', description: '清屏并开始新会话' },
        { key: 'Ctrl + O', description: '切换详情视图' },
        { key: 'Esc', description: '中断当前任务；空闲时双击清空输入' },
        { key: `${altKey} + Enter`, description: '插入换行' },
        { key: 'Tab', description: '输入为空时填入提示词；斜杠菜单中补全选中项' },
        { key: 'Enter', description: '发送消息；斜杠菜单中提交当前选中命令' },
      ],
    },
    {
      title: `输入编辑（${platform}）`,
      items: [
        { key: '← / →', description: '左右移动光标' },
        { key: '↑ / ↓', description: '多行输入时上下移动光标' },
        { key: '↑ / ↓', description: '单行输入时切换历史记录' },
      ],
    },
    {
      title: '斜杠菜单',
      items: [
        { key: '/', description: '打开命令菜单' },
        { key: '↑ / ↓', description: '切换命令' },
        { key: 'Tab / Enter', description: '补全或提交当前命令' },
        { key: 'Esc', description: '关闭命令菜单' },
      ],
    },
  ];
}

export function buildShortcutHelpText(): string {
  return [
    '快捷键帮助',
    getShortcutPlatformNote(),
    '',
    ...getShortcutSections().flatMap((section) => [
      `${section.title}：`,
      ...section.items.map((item) => `  ${item.key}  ${item.description}`),
      '',
    ]),
  ].join('\n').trim();
}
