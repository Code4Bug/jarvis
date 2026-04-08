可以，我帮你整理成一份 **Claude Code Skills 定义规范速查版**。

## 1. Skills 是什么

Claude Code 的 Skill 本质上是一个目录里的 `SKILL.md`。
你写好这个文件后，Claude 就会把它当成一个可调用能力：既可以在相关场景下自动触发，也可以手动用 `/skill-name` 调用。Claude Code 的 skills 基于 Agent Skills 开放标准，并扩展了调用控制、子代理执行、动态上下文注入等能力。([Claude][1])

## 2. 最小定义结构

每个 skill 至少需要：

* 一个目录
* 一个 `SKILL.md`

`SKILL.md` 由两部分组成：

1. **YAML frontmatter**：放在最上方 `---` 之间，用来声明元数据
2. **Markdown 正文**：真正给 Claude 的执行说明

官方示例里，`name` 会变成 `/slash-command`，`description` 用于帮助 Claude 判断什么时候自动加载这个 skill。([Claude][1])

最小模板可以写成：

```md
---
name: explain-code
description: Explain code with diagrams and analogies.
---

When explaining code:
1. Start with an analogy
2. Draw an ASCII diagram
3. Walk through the code step by step
4. Highlight a gotcha
```

## 3. Skill 放哪里

Skill 的存放位置决定作用范围：

* **个人级**：`~/.claude/skills/<skill-name>/SKILL.md`
* **项目级**：`.claude/skills/<skill-name>/SKILL.md`
* **插件级**：`<plugin>/skills/<skill-name>/SKILL.md`
* **企业级**：由 managed settings 提供

优先级是：**enterprise > personal > project**。
另外，plugin skill 采用 `plugin-name:skill-name` 命名空间，不会和其他层级直接冲突。([Claude][1])

## 4. 推荐的目录结构

一个 skill 目录不只可以放 `SKILL.md`，还可以放参考文档、模板、脚本等辅助文件。官方推荐类似这样：

```text
my-skill/
├── SKILL.md
├── reference.md
├── examples.md
└── scripts/
    └── helper.py
```

其中：

* `SKILL.md` 是必需入口
* 其他文件按需加载或执行
* 最好在 `SKILL.md` 里明确说明这些文件的用途
* 官方建议把 `SKILL.md` 控制在 **500 行以内**，详细资料拆到外部文件中。([Claude][1])

## 5. Frontmatter 字段规范

官方 frontmatter 支持这些主要字段：([Claude][1])

### 必看字段

* `name`：skill 名称；省略时默认用目录名；只允许小写字母、数字、连字符，最长 64 字符
* `description`：推荐填写；说明 skill 做什么、什么时候用；Claude 会据此决定是否自动触发

### 调用控制

* `disable-model-invocation: true`
  禁止 Claude 自动触发，只能用户手动 `/name`
* `user-invocable: false`
  从 `/` 菜单隐藏，用户不能直接调，但 Claude 仍可自动用

### 参数与提示

* `argument-hint`：补全提示里显示期望参数形式，例如 `[issue-number]`

### 工具与模型

* `allowed-tools`：skill 激活时允许直接使用的工具
* `model`：skill 激活时使用的模型
* `effort`：推理强度，支持 `low | medium | high | max`（`max` 仅部分模型支持）

### 执行上下文

* `context: fork`：在独立 subagent 里执行
* `agent`：配合 `context: fork` 指定使用哪个 agent 类型
* `paths`：限制只在某些路径匹配时自动激活
* `hooks`：给 skill 生命周期绑定 hooks
* `shell`：指定 `!command` 用 `bash` 或 `powershell` 执行([Claude][1])

## 6. 调用行为规范

默认情况下：

* **用户可以手动调用**
* **Claude 也可以自动调用**
* skill 的 **description 会常驻上下文**
* skill 的 **完整正文只在真正调用时加载**

行为差异如下：([Claude][1])

* 默认：用户能调，Claude 也能调
* `disable-model-invocation: true`：只有用户能调
* `user-invocable: false`：只有 Claude 能调

这也是设计 skill 时最重要的选择之一：

* **有副作用的动作**（部署、提交、发消息）建议 `disable-model-invocation: true`
* **背景知识型 skill** 适合 `user-invocable: false`

## 7. 参数传递规范

Skill 支持以下变量替换：([Claude][1])

* `$ARGUMENTS`：全部参数
* `$ARGUMENTS[N]`：第 N 个参数，从 0 开始
* `$N`：`$ARGUMENTS[N]` 的简写
* `${CLAUDE_SESSION_ID}`：当前会话 ID
* `${CLAUDE_SKILL_DIR}`：当前 skill 目录路径

例如：

```md
---
name: migrate-component
description: Migrate a component from one framework to another
---

Migrate the $0 component from $1 to $2.
```

调用：

```text
/migrate-component SearchBar React Vue
```

会替换成：

```text
Migrate the SearchBar component from React to Vue.
```

如果你传了参数，但正文里没写 `$ARGUMENTS`，Claude Code 会自动把参数追加到末尾。([Claude][1])

## 8. 两类 Skill 设计思路

官方把 skill 内容大致分成两类：([Claude][1])

### A. Reference content

偏“知识注入”：

* 编码规范
* API 约定
* 领域知识
* 风格指南

这类更像“给 Claude 一套参考规则”。

### B. Task content

偏“动作执行”：

* deploy
* commit
* code generation
* issue 修复

这类更像“给 Claude 一份操作 SOP”。

实践上：

* **知识类 skill**：强调描述和适用场景
* **任务类 skill**：强调步骤、工具、参数、是否允许自动触发

## 9. 高级能力规范

### 9.1 动态上下文注入

在 skill 正文里可以写：

* 行内：`!\`command``
* 多行：以 ````!` 代码块形式执行

这些 shell 命令会在 Claude 看到 prompt 之前先执行，**输出结果会直接注入 skill 内容**。这属于预处理，而不是 Claude 运行时临时决定去执行。([Claude][1])

### 9.2 在 subagent 中运行

设置：

```yaml
context: fork
agent: Explore
```

表示该 skill 在隔离的 subagent 中运行，skill 正文就是子代理的任务提示词。
适合做研究、代码探索、大块任务拆分。([Claude][1])

### 9.3 工具权限控制

通过 `allowed-tools` 可以限制或放开 skill 里允许直接使用的工具，例如只给 `Read Grep Glob`，做成只读分析 skill。([Claude][1])

## 10. 触发与发现机制

Claude 会根据 `description` 判断何时加载 skill。
所以 description 的写法非常关键：

* 要把**核心 use case 放前面**
* 超过 **250 字符** 会被截断
* skill 太多时，description 还可能因为上下文预算进一步压缩

官方建议：**前置关键词，写得具体，不要空泛。**([Claude][1])

此外，Claude Code 还支持：

* 从嵌套目录自动发现 `.claude/skills/`
* 在 `--add-dir` 的额外目录中自动加载 `.claude/skills/`
* 对 skill 变更进行 live detection，无需重启会话([Claude][1])

## 11. 官方推荐的定义原则

结合文档内容，比较稳妥的定义规范可以总结成这几条：([Claude][1])

1. **一个 skill 只做一件事**
   不要把“规范 + 部署 + 测试 + 汇报”全塞进一个 skill

2. **description 写成“什么时候该用它”**
   不是写抽象能力，而是写触发语义

3. **正文写成可执行指令，而不是口号**
   用步骤、约束、输出格式来写

4. **有副作用的操作禁止自动触发**
   用 `disable-model-invocation: true`

5. **复杂 skill 拆 supporting files**
   `SKILL.md` 只保留导航和核心说明

6. **参数显式化**
   尽量用 `$ARGUMENTS` / `$0 $1 $2` 明确参数位置

7. **需要隔离上下文时用 `context: fork`**
   研究型、重任务型 skill 更适合放到 subagent

## 12. 一个比较规范的示例

```md
---
name: fix-issue
description: Fix a GitHub issue by number. Use when the user wants implementation plus tests for a specific issue.
argument-hint: [issue-number]
disable-model-invocation: true
allowed-tools: Read Grep Glob Edit Bash(git *) 
context: fork
agent: Explore
effort: high
---

Fix GitHub issue $0.

Requirements:
1. Read the issue and summarize the acceptance criteria
2. Locate the relevant files
3. Implement the fix
4. Add or update tests
5. Summarize changed files and risks
```

这个写法的优点是：

* 描述明确
* 参数明确
* 有副作用，所以禁止自动触发
* 限定了工具
* 适合独立 agent 处理

---

如果你要，我下一步可以直接帮你整理成一份 **“中文版本的 Claude Skill 编写模板 + 字段注释版”**，你复制就能开始写。

[1]: https://code.claude.com/docs/en/skills "Extend Claude with skills - Claude Code Docs"
