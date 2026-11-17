# Agent-Code

Agent / LLM 相关动手示例代码，按章节组织。当前包含第一章演示。

## 环境要求

- Node.js 18+（需支持原生 `fetch`）
- 部分示例需配置 DeepSeek API Key

## 第一章

| 目录 | 说明 |
| --- | --- |
| `05-deepseek-message-demo` | 多轮对话 messages 组装与 DeepSeek Chat Completions 调用 |
| `06-context-window-demo` | 观察上下文窗口增长与预算控制 |
| `08-model-router-demo` | 按任务画像做模型路由与执行计划 |
| `09-transformer-attention-demo` | 简化版 Attention 机制演示（纯本地，无需 API） |

### 运行示例

```bash
# 多轮消息
node 第一章/05-deepseek-message-demo/multi-turn.mjs

# 上下文观察
node 第一章/06-context-window-demo/observe-context.js

# 模型路由
node 第一章/08-model-router-demo/demo.js

# Attention 演示
node 第一章/09-transformer-attention-demo/attention-demo.js
```

## 说明

- `.env` 仅放在各子项目本地，请勿提交密钥
- 未配置 `DEEPSEEK_API_KEY` 时，部分 demo 会走本地演示回复或直接退出
