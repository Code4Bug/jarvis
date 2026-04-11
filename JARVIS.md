# @code4bug/jarvis-agent

基于 React + TypeScript + Ink 构建的命令行智能体交互界面

## 项目概览

- 项目类型：Node.js, TypeScript
- 当前目录：`/Users/edward/Documents/workspace/projects/jarvis`
- 版本：1.1.7
- Git 分支：develop

## 目录结构

```
jarvis/
├── skills/
│   └── tavily_search/
│       ├── SKILL.md
│       └── skill.py
├── src/
│   ├── agents/
│   │   ├── code-reviewer.md
│   │   ├── dba.md
│   │   ├── finance-advisor.md
│   │   ├── index.ts
│   │   ├── jarvis.md
│   │   └── stock-trader.md
│   ├── commands/
│   │   ├── index.ts
│   │   └── init.ts
│   ├── components/
│   │   ├── DangerConfirm.tsx
│   │   ├── MarkdownText.tsx
│   │   ├── MessageItem.tsx
│   │   ├── MultilineInput.tsx
│   │   ├── SlashCommandMenu.tsx
│   │   ├── StatusBar.tsx
│   │   ├── StreamingText.tsx
│   │   └── WelcomeHeader.tsx
│   ├── config/
│   │   ├── agentState.ts
│   │   ├── constants.ts
│   │   ├── dream.ts
│   │   ├── loader.ts
│   │   ├── memory.ts
│   │   ├── systemInfo.ts
│   │   └── userProfile.ts
│   ├── core/
│   │   ├── AgentMessageBus.ts
│   │   ├── AgentRegistry.ts
│   │   ├── busAccess.ts
│   │   ├── hint.ts
│   │   ├── logger.ts
│   │   ├── query.ts
│   │   ├── QueryEngine.ts
│   │   ├── queryWorker.ts
│   │   ├── safeguard.ts
│   │   ├── spawnRegistry.ts
│   │   ├── SubAgentBridge.ts
│   │   ├── subAgentWorker.ts
│   │   ├── WorkerBridge.ts
│   │   └── workerBusProxy.ts
│   ├── hooks/
│   │   ├── useDoubleCtrlCExit.ts
│   │   ├── useFocus.ts
│   │   ├── useInputHistory.ts
│   │   ├── useSlashMenu.ts
│   │   ├── useStreamThrottle.ts
│   │   ├── useTerminalWidth.ts
│   │   └── useTokenDisplay.ts
│   ├── screens/
│   │   ├── repl.tsx
│   │   └── slashCommands.ts
│   ├── services/
│   │   ├── api/
│   │   ├── dream.ts
│   │   ├── persistentMemory.ts
│   │   └── userProfile.ts
│   ├── skills/
│   │   ├── index.ts
│   │   └── loader.ts
│   ├── tools/
│   │   ├── createSkill.ts
│   │   ├── index.ts
│   │   ├── listDirectory.ts
│   │   ├── manageMemory.ts
│   │   ├── publishMessage.ts
│   │   ├── readChannel.ts
│   │   ├── readFile.ts
│   │   ├── runAgent.ts
│   │   ├── runCommand.ts
│   │   ├── searchFiles.ts
│   │   ├── semanticSearch.ts
│   │   ├── sendToAgent.ts
│   │   ├── spawnAgent.ts
│   │   ├── subscribeMessage.ts
│   │   └── writeFile.ts
│   ├── types/
│   │   └── index.ts
│   ├── cli.ts
│   └── index.tsx
├── tmp/
│   ├── modern-player/
│   │   ├── assets/
│   │   ├── src/
│   │   ├── tests/
│   │   ├── index.html
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   ├── README.md
│   │   └── vite.config.js
│   ├── player-app/
│   │   ├── public/
│   │   ├── src/
│   │   ├── index.html
│   │   ├── package-lock.json
│   │   ├── package.json
│   │   ├── README.md
│   │   ├── tsconfig.app.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.node.json
│   │   └── vite.config.ts
│   ├── raddle_game_01/
│   │   ├── game.js
│   │   ├── game.py
│   │   ├── index.html
│   │   ├── README.md
│   │   ├── riddles.json
│   │   └── styles.css
│   ├── riddle_game/
│   │   ├── README.md
│   │   ├── riddle_game.py
│   │   └── run.sh
│   ├── rubiks-cube/
│   │   ├── cube.js
│   │   ├── index.html
│   │   ├── README.md
│   │   └── style.css
│   ├── sci-fi-novel/
│   │   ├── chapters/
│   │   ├── drafts/
│   │   ├── outline/
│   │   ├── research/
│   │   └── PROJECT.md
│   └── test/
│       ├── foo.txt
│       └── foo1.txt
├── AGENT_INSTRUCTIONS.md
├── AGENT-DEMO.md
├── JARVIS.md
├── LICENSE
├── package-lock.json
├── package.json
├── publish.sh
├── README.md
├── SKILL_INSTRUCTIONS.md
├── TODOS.md
├── tsconfig.json
└── USAGE_INSTRCUTIONS.md
```

## 开发命令

```bash
npm install
npm run dev
npm run build
npm test
```

## 协作约定

- 本文件为自动生成结果；若需更准确的业务背景，请补充 README 或项目文档。

> 由 CodeReviewer /init 自动生成
