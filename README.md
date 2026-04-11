# Jarvis

[![npm version](https://img.shields.io/npm/v/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![npm downloads](https://img.shields.io/npm/dm/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![license](https://img.shields.io/npm/l/@code4bug/jarvis-agent)](./LICENSE)

Jarvis 是一个运行在终端里的轻量级 AI Agent，基于 React + TypeScript + Ink 构建，提供多轮对话、工具调用、流式输出、外部 Skill 扩展，以及多智能体协作能力。

它的目标不是做一个“会聊天的命令行”，而是让你在终端里直接完成读取代码、搜索文件、执行命令、拆分子任务、汇总结果这一整套工作流。

## 核心能力

- Agentic Loop：模型可连续推理、调用工具、读取结果并继续决策
- 流式终端交互：回复与状态实时刷新
- 内置工具：读写文件、执行命令、目录遍历、文本搜索、语义搜索
- 外部 Skill：支持从 `~/.jarvis/skills/` 动态加载 Markdown 或 Python Skill
- 多智能体协作：支持同步子 Agent、后台子 Agent 与消息总线通信
- 会话持久化：自动保存历史会话、摘要与 Token 统计
- 长期记忆：支持写入 `~/.jarvis/MEMORY.md`
- 安全围栏：危险命令识别、确认与持久授权
- 并行执行：多个只读工具可并行运行，提升响应效率

## 项目结构

```text
src/
├── index.tsx                # 应用入口
├── cli.ts                   # CLI 入口
├── agents/                  # 智能体定义
├── commands/                # 斜杠命令
├── components/              # Ink UI 组件
├── config/                  # 配置、常量、记忆与状态
├── core/                    # QueryEngine、Worker、消息总线、安全围栏
├── hooks/                   # 交互相关 Hooks
├── screens/                 # 主界面
├── services/                # LLM 接口、用户画像、长期记忆服务
├── skills/                  # 外部 Skill 加载器
├── tools/                   # 内置工具实现
└── types/                   # 类型定义
```

## 快速开始

### 方式一：直接使用已发布包

```bash
npm i -g @code4bug/jarvis-agent
jarvis
```

### 方式二：从源码运行

```bash
pnpm install
pnpm dev
```

也可以使用项目内脚本：

```bash
pnpm build
pnpm start
```

## 模型配置

Jarvis 会按下面顺序加载配置，后者覆盖前者：

1. `~/.jarvis/config.json`
2. `./.jarvis/config.json`

示例：

```json
{
  "system": {
    "model": "default",
    "context_token_limit": 18000,
    "context_compress_threshold": 18000,
    "enable_thinking_mode_toggle": false
  },
  "models": {
    "default": {
      "api_url": "https://your-api-endpoint",
      "api_key": "your-api-key",
      "model": "your-model-id",
      "temperature": 0.7,
      "max_tokens": 4096,
      "extra_body": {
        "enable_thinking": true
      }
    }
  }
}
```

说明：

- `system.model` 对应 `models` 里的 key
- `extra_body` 会直接合并进请求体，方便兼容不同服务商
- 如果没有可用模型配置，程序会回退到 Mock Service，适合本地界面联调

## 常用命令

### CLI

```bash
jarvis
jarvis --version
```

### 斜杠命令

| 命令 | 说明 |
| --- | --- |
| `/init` | 扫描当前项目并生成 `JARVIS.md` |
| `/new` | 开启新会话 |
| `/resume` | 恢复历史会话 |
| `/agent` | 切换智能体 |
| `/permissions` | 查看持久化授权 |
| `/skills` | 查看当前工具与外部 Skill |
| `/session_clear` | 清理非当前会话历史 |
| `/version` | 显示版本 |
| `/help` | 显示帮助 |

### 快捷键

| 快捷键 | 说明 |
| --- | --- |
| `Ctrl + L` | 清屏并开始新会话 |
| `Ctrl + C` | 退出 |
| `Esc` | 中断当前任务或清空输入 |
| `Alt/Option + Enter` | 输入换行 |

## 内置工具

当前内置工具包括：

| 工具名 | 说明 |
| --- | --- |
| `read_file` | 读取文件 |
| `write_file` | 写入文件 |
| `run_command` | 执行命令 |
| `list_directory` | 列出目录内容 |
| `search_files` | 搜索文件内容 |
| `semantic_search` | 语义搜索 |
| `create_skill` | 创建外部 Skill |
| `run_agent` | 同步运行子 Agent |
| `spawn_agent` | 异步启动后台子 Agent |
| `send_to_agent` | 向后台子 Agent 发送消息 |
| `publish_message` | 发布频道消息 |
| `subscribe_message` | 订阅频道消息 |
| `read_channel` | 查看频道历史 |
| `manage_memory` | 读取或维护长期记忆 |

## 多智能体能力

Jarvis 同时支持两种子 Agent 模式：

- `run_agent`：同步执行，主 Agent 等待结果后继续
- `spawn_agent`：后台执行，主 Agent 通过消息总线持续协作

后台子 Agent 的默认通信频道约定如下：

- 收件箱：`agent-inbox:{task_id}`
- 回复：`agent-reply:{task_id}`

这套机制适合把复杂任务拆成多个独立子任务，例如代码审查、资料整理、命令执行验证、结果汇总等。

更多设计说明见 [AGENT_INSTRUCTIONS.md](/Users/edward/Documents/workspace/projects/jarvis/AGENT_INSTRUCTIONS.md)。

## Agent 与 Skill

### 内置 Agent

内置 Agent 定义位于 `src/agents/`，当前仓库已包含：

- `jarvis`
- `code-reviewer`
- `dba`
- `finance-advisor`
- `stock-trader`

Agent 通过 Markdown 文件定义元信息与系统提示词，切换结果会持久化到 `~/.jarvis/agent.json`。

### 外部 Skill

外部 Skill 目录：

```text
~/.jarvis/skills/<skill-name>/
├── SKILL.md
└── skill.py   # 可选
```

支持两种模式：

- 仅 `SKILL.md`：作为指令型 Skill 由模型解释执行
- `SKILL.md + skill.py`：作为可执行 Skill 直接运行 Python 脚本

相关说明见 [SKILL_INSTRUCTIONS.md](/Users/edward/Documents/workspace/projects/jarvis/SKILL_INSTRUCTIONS.md)。

## 会话、记忆与安全

### 会话与日志

- 会话目录：`~/.jarvis/sessions/`
- 日志目录：`~/.jarvis/logs/`

每次会话会保存消息、摘要、更新时间和累计 Token。

### 长期记忆

- 记忆文件：`~/.jarvis/MEMORY.md`
- 通过 `manage_memory` 工具进行读取、追加、覆盖和定位

### 安全围栏

`run_command` 会经过统一安全校验，内置规则会拦截高风险命令，例如：

- 递归删除
- 直接格式化磁盘
- 修改关键权限
- 网络下载后直接执行

高风险命令支持会话级或持久化授权，持久化记录保存在 `~/.jarvis/.permissions.json`。

## 开发

```bash
pnpm install
pnpm build
pnpm test
```

当前 `test` 脚本实际执行的是一次构建校验：

```bash
npm run build
```

## 相关文档

- [JARVIS.md](/Users/edward/Documents/workspace/projects/jarvis/JARVIS.md)
- [AGENT-DEMO.md](/Users/edward/Documents/workspace/projects/jarvis/AGENT-DEMO.md)
- [USAGE_INSTRCUTIONS.md](/Users/edward/Documents/workspace/projects/jarvis/USAGE_INSTRCUTIONS.md)

## License

MIT
