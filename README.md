# Jarvis

[![npm version](https://img.shields.io/npm/v/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![npm downloads](https://img.shields.io/npm/dm/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![license](https://img.shields.io/npm/l/@code4bug/jarvis-agent)](./LICENSE)
[![node](https://img.shields.io/node/v/@code4bug/jarvis-agent)](https://nodejs.org)

> *"Good evening, sir. What can I do for you?"*

轻量化单机智能体，基于 React + TypeScript + Ink 构建的终端交互式 AI Agent。

在终端中与 AI 对话，支持多轮推理、工具调用、流式输出，开箱即用。

---

## 为什么叫 Jarvis

在漫威宇宙中，J.A.R.V.I.S.（Just A Rather Very Intelligent System）是 Tony Stark 的 AI 管家。他不只是一个语音助手，而是贯穿钢铁侠整个英雄旅程的核心伙伴 -- 管理 Stark 大厦、协助战甲研发、在战斗中提供实时分析，甚至在关键时刻做出独立判断。

这个项目取名 Jarvis，正是致敬这种理念：一个真正理解开发者意图、能够独立思考和行动的 AI 搭档。

就像 Tony 在车库里对着 Jarvis 说一句话就能启动整套工程流程一样，我们希望开发者在终端里也能拥有这样的体验 -- 你只需要描述你想做什么，Jarvis 会帮你思考、规划、执行。

不是冰冷的命令行工具，而是你的 AI 搭档。

---

## 特性

- Agentic Loop 架构，支持多轮推理与工具调用闭环
- 流式响应，实时输出模型生成内容
- 内置工具系统：文件读写、命令执行、目录浏览、内容搜索
- 外部 Skill 扩展机制，支持 Python 脚本作为工具
- 多智能体切换，通过 Markdown 定义智能体人格与能力
- 会话持久化，自动保存历史与 Token 消耗统计
- 安全围栏，危险命令自动拦截并交互式确认
- 终端 UI 优化，清晰的状态指示与结构化消息展示

## 快速开始

```bash
# 安装
npm i -g @code4bug/jarvis-agent

# 启动
npm run start

# 或开发模式
npm run dev
```

启动前需要配置 LLM 服务，在 `~/.jarvis/config.json` 中添加模型配置：

```json
{
  "system": {
    "model": "your-model-name"
  },
  "models": {
    "your-model-name": {
      "api_url": "https://your-api-endpoint",
      "api_key": "your-api-key",
      "model": "model-id"
    }
  }
}
```

## 架构

```
用户输入 → 思考 → 生成响应 / 工具调用 → 执行工具 → (继续循环或结束)
```

采用分层架构：

| 层次 | 职责 | 核心文件 |
|------|------|----------|
| 交互层 | 终端 UI、用户输入、消息展示 | `screens/repl.tsx` |
| 组件层 | 可复用 UI 组件 | `components/*` |
| 编排层 | 多轮对话、会话持久化、成本追踪 | `core/QueryEngine.ts` |
| 核心循环层 | 单轮 Agentic Loop 执行 | `core/query.ts` |
| 工具层 | 文件/命令/搜索等执行能力 | `tools/*` |
| 通信层 | 与 LLM 服务交互（支持流式） | `services/api/*` |
| 配置层 | 全局常量与多级配置合并 | `config/*` |

## 项目结构

```
src/
├── index.tsx                 # 应用入口
├── cli.ts                    # CLI 入口
├── agents/                   # 智能体定义（Markdown）
│   ├── jarvis.md             # 默认全能助手
│   ├── code-reviewer.md      # 代码审查
│   ├── dba.md                # 数据库助手
│   └── ...
├── components/               # UI 组件
├── config/                   # 配置加载与常量
├── core/                     # 核心引擎（QueryEngine + Agentic Loop）
├── commands/                 # 斜杠命令（/init, /agent 等）
├── hooks/                    # React Hooks
├── screens/                  # 主界面
├── services/api/             # LLM 通信层
├── skills/                   # 外部 Skill 加载与注册
├── tools/                    # 内置工具
└── types/                    # 类型定义
```

## 内置工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取指定路径的文件内容 |
| `write_file` | 写入内容到指定文件 |
| `run_command` | 执行系统命令并返回输出 |
| `list_directory` | 列出指定目录的文件和文件夹 |
| `search_files` | 在指定目录中搜索包含关键词的文件 |
| `create_skill` | 创建新的外部 Skill |

## 斜杠命令

| 命令 | 说明 |
|------|------|
| `/init` | 扫描项目信息，生成 JARVIS.md |
| `/new` | 开启新会话 |
| `/resume` | 恢复历史会话 |
| `/agent` | 切换智能体 |
| `/skills` | 查看当前所有 tools 和 skills |
| `/help` | 显示帮助信息 |

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + L` | 清屏 / 新会话 |
| `Ctrl + C` | 退出 |
| `Esc` | 终止当前任务 / 清空输入框 |
| `Alt/Option + Enter` | 输入换行 |

## 智能体系统

智能体通过 Markdown 文件定义，存放在 `src/agents/` 目录下。每个文件包含 YAML front-matter（元数据）和 Markdown 正文（system prompt）。

运行时通过 `/agent <name>` 切换，选择会持久化到 `~/.jarvis/agent.json`。

详见 [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md)。

## Skill 扩展

外部 Skill 存放在 `~/.jarvis/skills/<skill-name>/SKILL.md`，支持：

- 纯 Markdown 指令型 Skill（由 LLM 解释执行）
- Python 脚本型 Skill（`skill.py`，直接执行返回结果）

详见 [SKILL_INSTRUCTIONS.md](./SKILL_INSTRUCTIONS.md)。

## 配置

配置文件支持两级合并，项目级覆盖全局级：

1. `~/.jarvis/config.json` — 全局配置
2. `./.jarvis/config.json` — 项目配置

### config.json 模板

```json
{
  "system": {
    "model": "ollama",
    "context_token_limit": 20000,
    "context_compress_threshold": 18000,
    "enable_thinking_mode_toggle": false
  },
  "models": {
    "ollama": {
      "api_url": "http://127.0.0.1:11434/v1/chat/completions",
      "api_key": "EMPTY",
      "model": "gemma4:latest",
      "temperature": 0.1,
      "max_tokens": 10000
    },
    "openai": {
      "api_url": "https://api.openai.com/v1/chat/completions",
      "api_key": "your-openai-api-key",
      "model": "gpt-4",
      "temperature": 0.1,
      "max_tokens": 10000
    },
    "custom": {
      "api_url": "https://your-api-endpoint/v1/chat/completions",
      "api_key": "your-api-key",
      "model": "model-id",
      "temperature": 0.1,
      "max_tokens": 10000
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `system.model` | string | 当前使用的模型名称，对应 `models` 中的 key |
| `system.context_token_limit` | number | 上下文 Token 上限，默认 20000 |
| `system.context_compress_threshold` | number | 上下文压缩触发阈值 |
| `system.enable_thinking_mode_toggle` | boolean | 是否启用思考/非思考模式切换，默认 false |
| `models.<name>.api_url` | string | 模型 API 地址，需兼容 OpenAI Chat Completions 格式 |
| `models.<name>.api_key` | string | API 密钥 |
| `models.<name>.model` | string | 模型 ID |
| `models.<name>.temperature` | number | 采样温度，可选 |
| `models.<name>.max_tokens` | number | 最大生成 Token 数，可选 |

支持任意兼容 OpenAI Chat Completions API 的服务，包括 Ollama、vLLM、LM Studio、各云厂商 API 等。切换模型只需修改 `system.model` 指向不同的 key。

## 技术栈

- React 18 + Ink 5（终端 UI）
- TypeScript 5
- ink-spinner（加载动画）
- marked + marked-terminal（Markdown 渲染）
- uuid（会话 ID）

## License

MIT
