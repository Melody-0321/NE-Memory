# src/core/engine — 记忆流水线引擎

> 深度架构见 `CODE_WIKI.md` §3.4。**AI 编码约束见 [`.rules.md`](./.rules.md)，动工前必读**。

分层记忆管线（STM/LTM/State）+ 检索 + 注入 + 遥测的集合。核心原则：**pipeline-guard 触发、update 写入、vault 存储、api 调 LLM**。

## 文件职责分类

| 类别 | 文件 |
|------|------|
| **管线编排** | `pipeline-guard.js`（per-pipeline 队列/锁/触发）、`update.js`（写入唯一入口）、`pipeline-shared.js`（共享工具） |
| **STM / State / LTM** | `stm-pipeline.js`、`state-pipeline.js`、`ltm-pipeline.js`、`meta-ltm-pipeline.js`、`suspense-pipeline.js`、`consolidate.js`（LTM 合并） |
| **检索** | `retrieval.js`、`retrieval-text.js`、`retrieval-fusion.js`（RRF）、`bm25-grouper.js`、`turn-segmenter.js`、`entity-chain` 相关 |
| **注入** | `injection.js`（记忆注入组装）、`adaptive-context.js`（注入预算控制）、`context-window.js` |
| **LLM 交互** | `template-llm.js`（FC 检测）、`template-assistant.js`（模板 AI 助手）、`msg-id.js`（消息身份）、`validate.js`（输出校验）、`json-fallback.js`（JSON 解析降级） |
| **矛盾/歧义** | `contradiction.js`、`ambiguity.js` |
| **遥测/统计** | `telemetry.js`、`chat-telemetry.js`、`token-stats.js`、`json-parse-telemetry.js` |
| **工具** | `text-utils.js`、`time-utils.js`、`content-clean.js`、`embedding.js`、`bm25-grouper.js` |

## 关键入口

- **触发**：`pipeline-guard.js` 的 guard + enqueue（STM/State 可并行，独立锁）
- **写入**：`update.js` 是唯一写 IndexedDB 的入口（管线内禁止直接调 `store.save()`）
- **注入**：`injection.js` 的 `formatEntry` / `buildEntityBlock`（纯本地组装，无 LLM 合成）

## 新增模块指引

1. 归属：管线逻辑 → 对应 pipeline 文件；检索 → `retrieval-*`；纯函数工具 → `text-utils`/`time-utils`
2. 必须遵守 `.rules.md` 的硬约束（写入入口、prompt 格式与注入匹配、检索改动跑集成测试）
3. 新增纯函数后补 `test/*.test.js` 并注册进 `test/run.mjs` 的 `testMap`
