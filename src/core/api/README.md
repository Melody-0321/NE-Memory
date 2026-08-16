# src/core/api — LLM API 抽象层

> 深度架构见 `CODE_WIKI.md` §3.3。本层把"调哪个 LLM、怎么鉴权、怎么重试"从管线逻辑中解耦出来。

## 文件职责

| 文件 | 职责 |
|------|------|
| `llm.js` | 统一 LLM 调用：通道选择（主/副 API）、鉴权、重试、流式适配、超时 |
| `public-read.js` | 公开只读访问接口（`window.neMemory` 等三通道的底层读取） |

## 关键能力

- **多通道**：主 API / 记忆副 API（`callMemoryPipeline`）/ 模板 API（`ne_template_api`）/ Embedding API 可独立配置，节省主 API Token
- **鉴权**：API key 按通道独立读取（历史坑：曾误读不存在的 key 名导致鉴权失效）
- **路由**：`resolvePipelineApi` 按调用上下文路由到对应通道（template_assistant 等专用通道）
- **健壮性**：超时/重试/JSON 解析分级降级（`json-fallback.js` 配合）

## 如何新增 API 通道

1. 在 `llm.js` 增加通道选择分支 + 配置项（key 名/URL/模型名）
2. 在 `settings.js` / 设置面板注册该通道配置（注意真实 key 名一致，避免鉴权失效坑）
3. 补 API 调用路径的测试（mock fetch / 注入模式）

> 注意：`llm.js` 改动影响所有 LLM 交互（提示词/参数/通道），按 AGENTS.md 属第二层提醒范围。
