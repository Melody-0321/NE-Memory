# Layered Memory Architecture

- 状态：已接受（v0.2.0 起持续演进）
- 日期：2026-05-30（v0.2.0 纯前端移植确立三层记忆）

## 背景（Context）

长对话中上下文窗口有限，LLM 无法持续追踪全部叙事。早期方案把所有历史平铺进上下文或做粗粒度截断，导致：

- **上下文溢出**：对话越长，记忆占用的上下文越多，早期内容被挤出。
- **无结构**：角色状态、短期事件、长期叙事弧线混在一起，检索与注入无法区分优先级。
- **无法增量**：每次都需要重新处理全部历史，成本随对话长度线性增长。

## 决策（Decision）

建立**三层分层记忆架构**，`src/core/engine/` 下三个独立管线各自负责一层：

- **STM（短期记忆）**：`stm-pipeline.js` 从对话轮次逐轮提取叙事事件（结构化 `events`），消费不随对话长度增长。
- **LTM（长期记忆）**：`ltm-pipeline.js` + `consolidate.js` 将 STM 合并整合为长期叙事弧线（append / close_and_new 决策，参数 `k1=1.5, b=0.75`），硬上限自动闭合。
- **State（角色状态）**：`state-pipeline.js` 维护角色/势力/任务等 Schema 驱动状态，LLM 只改变化字段不重写全量。
- **增量更新**：msg_id 去重 + cursor 游标追踪，保证同一消息不重复处理；`validateMsgRanges` 窗口语义校验。
- **三层穿透检索**：LTM 摘要 → STM 详情 → 原始对话原文，层层下钻（`access` Tool / RetrievalNotebook）。

## 后果（Consequences）

**正面**

- 记忆消费不随对话长度线性增长（增量更新 + 分层聚合）。
- 检索按层命中：长期弧线、近期事件、当前状态各有归属，注入更有针对性。
- 与纯本地 SmartPush（0005）协同：检索层负责召回与组织，分层语义由 STM/LTM 承担。

**负面**

- 提取/合并调度复杂度高：STM 触发节奏、LTM 合并阈值、State 校验需大量参数调优（stmBatch / topK / chainDepth）。
- 分层边界需持续维护（STM→LTM 晋升条件、跨场景边界检测），易出语义不一致。

**关联**

- 后续决策：[0007-layered-pipeline-and-independent-locks.md](./0007-layered-pipeline-and-independent-locks.md)、[0005-local-smartpush-retrieval.md](./0005-local-smartpush-retrieval.md)
