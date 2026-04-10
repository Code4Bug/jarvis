# Jarvis

[![npm version](https://img.shields.io/npm/v/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![npm downloads](https://img.shields.io/npm/dm/@code4bug/jarvis-agent)](https://www.npmjs.com/package/@code4bug/jarvis-agent)
[![license](https://img.shields.io/npm/l/@code4bug/jarvis-agent)](./LICENSE)
[![node](https://img.shields.io/node/v/@code4bug/jarvis-agent)](https://nodejs.org)

> *"Good evening, sir. What can I do for you?"*

轻量化单机智能体，基于 React + TypeScript + Ink 构建的终端交互式 AI Agent。

在终端中与 AI 对话，支持多轮推理、工具调用、流式输出，开箱即用。

> 多智能体，不只是多几个助手，而是让需求分析、方案设计、编码实现、测试验证、代码评审等角色真正协同起来。  
> 它可以用于多人协作流程构建、跨角色任务接力、复杂项目拆解与推进，也可以用于产品研发、缺陷修复、自动化交付等高频场景。  
> 当多个智能体围绕同一目标持续沟通、分工与汇总时，AI 才真正从“单点应答”走向“团队作战”。

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
- 多智能体通信，支持智能体之间分工、协同与结果汇总
- 会话持久化，自动保存历史与 Token 消耗统计
- 安全围栏，危险命令自动拦截并交互式确认
- 终端 UI 优化，清晰的状态指示与结构化消息展示
- **并行任务执行**，多工具调用自动并行，显著提升执行效率

## 并行任务

当 LLM 在单轮推理中返回多个工具调用时，Jarvis 会自动判断是否可以并行执行，而不是逐个串行等待。

### 工作原理

```
LLM 返回多个工具调用
        ↓
  canRunInParallel() 判断
        ↓
  ┌─────────────────────────────┐
  │ 可并行（全部为只读操作）      │  → 每个工具在独立 Worker 线程中同时执行
  │ 不可并行（含写操作/Bash）     │  → 串行执行，保证顺序与安全
  └─────────────────────────────┘
        ↓
  所有结果汇总后统一写入 transcript
```

每个并行工具运行在独立的 Node.js Worker 线程中（`worker_threads`），主线程不阻塞，TUI 实时更新每个工具的执行状态。

### 并行条件

| 场景 | 是否并行 |
|------|----------|
| 多个只读工具（ReadFile / ListDirectory / SearchFiles / SemanticSearch） | 是 |
| 含任意写操作（WriteFile） | 否 |
| 含 Bash 命令 | 否（副作用无法静态分析） |
| 多个只读 Skill | 是 |

### 安全保障

- 写-写冲突、读-写竞态：通过工具类型静态分析提前规避
- 并行模式下的危险 Bash 命令：直接跳过并提示（无法弹出交互式确认）
- 任意工具出错：终止当前轮次，不影响已完成的并行结果
- 用户按 ESC 中断：所有正在运行的 Worker 均收到中断信号

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

## 多智能体通信

Jarvis 在多智能体能力基础上进一步支持智能体之间的通信与协作，不再局限于单个智能体独立完成任务。

这不只是能力的叠加，而是一种协作方式的跃迁。一个智能体擅长理解需求，另一个智能体擅长架构设计，还有智能体专注编码、测试、评审与复盘。当它们开始彼此沟通、相互补位，整个系统就不再只是“一个 AI 在工作”，而像是一支真正持续运转的数字化团队。

你可以让不同角色的智能体围绕同一目标协同工作，例如：

- 产品经理智能体负责拆解需求、输出任务边界
- 架构师智能体负责设计技术方案与模块划分
- 开发智能体负责编码实现与联调
- 测试智能体负责验证、回归与问题反馈

通过多智能体通信机制，多个智能体可以围绕同一上下文进行信息传递、任务接力和结果汇总，从而搭配实现各种多人协作场景构建。

从单点问答，到多角色联动；从工具调用，到团队协作流程编排。多智能体带来的不是简单的“多开几个助手”，而是面向复杂任务的组织能力升级，也为产品构建、研发协同、流程自动化打开了近乎无限的可能。

适用场景包括：

- 需求分析 + 方案设计 + 开发落地的一体化协作流程
- 前端、后端、测试等不同角色的分工配合
- 代码评审、缺陷修复、回归验证的闭环协同
- 模拟真实团队的多人协作交付流程

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
