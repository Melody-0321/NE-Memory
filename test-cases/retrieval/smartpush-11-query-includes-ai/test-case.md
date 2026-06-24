---
name: smartpush-11
folder: retrieval/smartpush-11-query-includes-ai
title: query 含 AI reply
objective: 验证 BM25 query 包含最近的 2 轮 AI 回复和 user 输入，而非仅 5 条 user messages
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic: []
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# SmartPush query 含 AI reply

## 目标
验证 BM25 query 包含最近的 2 轮 AI 回复和 user 输入，而非仅 5 条 user messages。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：正常自然互动。积累 5+ 轮后触发 SmartPush。Driver 在后期轮次回复应包含 AI 和 user 对话。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言
无（通过 trace 手工验证 system prompt 中的 query 包含最近 AI 回复和 user 输入）

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-11')
```
