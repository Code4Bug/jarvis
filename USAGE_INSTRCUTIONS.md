# Jarvis 安装与使用说明

## 安装方式

### 方式一：通过 npm 全局安装（推荐）

```bash
# 全局安装
npm install -g jarvis-agent

# 验证安装
jarvis --version
```

### 方式二：通过本地 .tgz 包安装

如果你拿到的是打包好的 `.tgz` 文件：

```bash
# 全局安装本地包
npm install -g jarvis-agent-1.0.0
.tgz

# 验证安装
jarvis --version
```

### 方式三：从源码运行

```bash
# 克隆项目后安装依赖
npm install

# 直接运行
npm run start

# 或开发模式
npm run dev
```

---

## 配置

安装完成后，首次运行前需要配置 LLM 服务。

创建配置文件 `~/.jarvis/config.json`：

```json
{
  "system": {
    "model": "your-model-name"
  },
  "models": {
    "your-model-name": {
      "api_url": "https://your-api-endpoint/v1/chat/completions",
      "api_key": "your-api-key",
      "model": "model-id",
      "temperature": 0.1,
      "max_tokens": 10000
    }
  }
}
```

支持任意兼容 OpenAI Chat Completions API 的服务（Ollama、vLLM、LM Studio、各云厂商 API 等）。

更多配置项说明请参考 [README.md](./README.md#配置)。

---

## 使用

```bash
# 全局安装后，直接在终端启动
jarvis
```

启动后即可在终端中与 AI 进行多轮对话，支持工具调用、流式输出等功能。

### 常用斜杠命令

| 命令 | 说明 |
|------|------|
| `/init` | 扫描当前项目，生成 JARVIS.md |
| `/about` | 查看 Jarvis 的详细特性、功能与信息 |
| `/new` | 开启新会话 |
| `/resume` | 恢复历史会话 |
| `/agent` | 切换智能体 |
| `/skills` | 查看当前所有 tools 和 skills |
| `/help` | 显示帮助信息 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + L` | 清屏 / 新会话 |
| `Ctrl + C` | 退出 |
| `Esc` | 终止当前任务 / 清空输入框 |
| `Alt/Option + Enter` | 输入换行 |

---

## 卸载

```bash
npm uninstall -g jarvis-agent
```
