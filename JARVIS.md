# Jarvis Agent

基于 React + TypeScript + Ink 构建的命令行智能体交互界面（TUI Agent）。

---

## ✨ 项目亮点

- 🧠 Agentic Loop 架构：支持多轮推理与工具调用闭环
- ⚡ 流式响应：实时输出模型生成内容
- 🛠 工具系统：内置文件/命令/搜索能力，可扩展
- 💾 会话持久化：自动保存历史与成本统计
- 🎨 终端 UI 优化：清晰的状态指示与结构化消息展示

---

## 🏗 架构设计

采用分层架构，职责清晰：

| 层次 | 职责 | 核心文件 | 关键词 |
|------|------|----------|--------|
| 交互层 | 终端 UI、用户输入、消息展示 | `screens/repl.tsx` | React、Ink |
| 组件层 | 可复用 UI 组件 | `components/*` | WelcomeHeader、MessageItem、StatusBar |
| 编排层 | 多轮对话、会话持久化、成本追踪 | `core/QueryEngine.ts` | QueryEngine、Session |
| 核心循环层 | 单轮执行：推理 → 工具调用 → 循环 | `core/query.ts` | Agentic Loop、LoopState |
| 工具层 | 提供执行能力（文件/命令等） | `tools/*` | Tool、Executor |
| 通信层 | 与 AI 服务交互（支持流式） | `services/api/*` | streamMessage |
| 配置层 | 全局常量与配置 | `config/constants.ts` | APP_NAME、MAX_ITERATIONS |
| 类型层 | 类型定义与约束 | `types/index.ts` | ContentBlock、LoopState |

---

## 📁 项目结构

```
react-tui-ink/
├── src/
│   ├── index.tsx                  # 应用入口
│   ├── config/
│   │   └── constants.ts           # 全局常量（应用名、版本、模型等）
│   ├── core/
│   │   ├── QueryEngine.ts         # 会话编排引擎
│   │   └── query.ts               # Agentic Loop 核心循环
│   ├── components/
│   │   ├── MessageItem.tsx         # 消息渲染组件
│   │   ├── MultilineInput.tsx      # 多行输入组件
│   │   ├── StatusBar.tsx           # 底部状态栏
│   │   ├── StreamingText.tsx       # 流式文本展示
│   │   └── WelcomeHeader.tsx       # 欢迎头部
│   ├── hooks/
│   │   └── useFocus.ts            # 窗口焦点检测
│   ├── screens/
│   │   └── repl.tsx               # 主 REPL 界面
│   ├── services/
│   │   └── api/
│   │       ├── llm.ts             # 真实 LLM 服务（占位）
│   │       └── mock.ts            # Mock 服务（开发调试）
│   ├── tools/
│   │   ├── index.ts               # 工具注册与查找
│   │   ├── readFile.ts            # 读取文件
│   │   ├── writeFile.ts           # 写入文件
│   │   ├── runCommand.ts          # 执行命令
│   │   ├── listDirectory.ts       # 列出目录
│   │   └── searchFiles.ts         # 搜索文件
│   └── types/
│       └── index.ts               # 全局类型定义
├── package.json
└── tsconfig.json
```

---

## 🧩 核心概念

### 1. 消息系统（Message System）

每条消息带有 状态 + 类型，用于可视化执行流程。

显示规范：
- 智能体正式输出使用正常文本颜色展示
- 非智能体内容输出的过程数据统一使用灰色字展示
- 过程数据包括：思考中状态、工具参数、工具执行日志、文件操作提示、系统提示等辅助信息

状态：
- pending 🟡 执行中
- success 🟢 成功
- error 🔴 失败

消息类型：
- user / reasoning / tool_exec / file_op / thinking / system / network / error

### 2. Agentic Loop（智能体循环）

```
用户输入 → 思考 → 生成响应 / 工具调用 → 执行工具 → （继续循环或结束）
```

终止条件：无工具调用 或 达到最大迭代次数（`MAX_ITERATIONS`）

### 3. 工具系统（Tools）

每个工具独立文件，统一通过 `tools/index.ts` 注册：

| 工具 | 文件 | 说明 |
|------|------|------|
| `read_file` | `tools/readFile.ts` | 读取指定路径的文件内容 |
| `write_file` | `tools/writeFile.ts` | 写入内容到指定文件 |
| `run_command` | `tools/runCommand.ts` | 执行系统命令并返回输出 |
| `list_directory` | `tools/listDirectory.ts` | 列出指定目录的文件和文件夹 |
| `search_files` | `tools/searchFiles.ts` | 在指定目录中搜索包含关键词的文件 |

扩展新工具只需：创建工具文件 → 在 `tools/index.ts` 中注册。

### 4. 流式输出

支持逐字符输出，辅助信息（thinking、工具参数、执行状态）使用灰色字，避免与正式输出混淆。

### 5. 会话管理

- 自动保存到 `.sessions/`
- 支持导入导出
- Token 和成本统计

---

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动
npm run start
```

---

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + L` | 清屏 / 新会话 |
| `Ctrl + C` | 退出 |
| `Esc` | 有任务时终止当前任务，无任务时清空输入框 |
| `Alt/Option + Enter` | 输入换行 |

---

## 🔌 接入真实 LLM

修改 `src/core/QueryEngine.ts`：

```typescript
import { LLMServiceImpl, getDefaultConfig } from '../services/api/llm';

// constructor 中替换
this.service = new LLMServiceImpl(getDefaultConfig());
```

设置环境变量：

```bash
export API_KEY=your-api-key
```

---

## 🧱 扩展开发

添加工具：

```typescript
// src/tools/myTool.ts
import { Tool } from '../types/index';

export const myTool: Tool = {
  name: 'my_tool',
  description: '描述',
  parameters: { /* ... */ },
  execute: async (args) => 'result',
};
```

然后在 `src/tools/index.ts` 中导入并注册到 `allTools` 数组。

---

## 🛠 技术栈

- React 18 + Ink 5（终端 UI 框架）
- TypeScript 5
- ink-spinner（加载动画）
- uuid（会话 ID 生成）

---

## 📌 可优化方向

1. 工具权限控制
2. 多模型支持
3. 上下文压缩
4. 插件系统
5. 任务模式
6. Debug 面板

---

## 📄 License

MIT
