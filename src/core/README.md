# src/core — 核心引擎（平台无关）

> 深度架构见 `CODE_WIKI.md` §3（模块职责详解）。本文件是定位地图：有什么、入口在哪、怎么加新模块。

NE 的**平台无关核心**：不依赖 SillyTavern / DOM / IndexedDB 之外的浏览器 API 的具体实现，通过 `runtime.js` 抽象运行时，由 `src/adapter/` 注入平台能力。

## 目录结构

| 目录 | 职责 | 关键文件 |
|------|------|---------|
| [`engine/`](./engine/README.md) | 记忆流水线引擎（STM/LTM/State 分层管线、检索、注入、遥测） | `pipeline-guard.js`（触发编排）、`update.js`（写入入口） |
| [`vault/`](./vault/README.md) | 记忆存储层（IndexedDB CRUD、版本链、Schema） | `store.js`、`state-versions.js`、`schema.js` |
| [`api/`](./api/README.md) | LLM API 抽象层（通道/重试/流式/鉴权） | `llm.js` |
| [`test-runner/`](./test-runner/README.md) | 自动化测试框架（集成用例跑批） | `test-data.generated.js` |
| — 根模块 | 设置/参数/工具/i18n 等轻量模块 | `runtime.js`、`settings.js`、`params.js`、`i18n.js`、`tools.js` |

## 依赖方向

```
src/adapter（ST 适配）
    └── src/core（平台无关核心）
           api ──调用──▶ engine ──读写──▶ vault
              ▲                          │
              └──────── test-runner 驱动 ┘
```

- `engine` 是编排者：通过 `api` 调 LLM，通过 `vault` 持久化
- `vault` 是数据层：不依赖 `api` / `engine`
- `test-runner` 只用于集成测试/排障，不参与生产路径

## 新增模块指引

1. 先判断归属：管线/检索/注入 → `engine/`；存储/Schema → `vault/`；LLM 通道 → `api/`
2. 新文件创建后按 `AGENTS.md` Meta-Rule 更新风险表
3. `engine` / `vault` 有 `.rules.md`（AI 编码约束），动工前先读
