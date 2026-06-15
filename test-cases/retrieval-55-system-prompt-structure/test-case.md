---
name: retrieval-55
folder: retrieval-55
title: 检索 System Prompt 结构
objective: 验证 system prompt 包含 ##当前对话可见窗口、##最近一轮对话上下文 节段及精简后的工具 guidance
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "可见窗口节段是否包含 msg_id 标注和\"主 LLM 已知/未知\"的说明？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# 检索 System Prompt 构建

## 目标
验证 system prompt 包含 `##当前对话可见窗口`、`##最近一轮对话上下文` 节段及精简后的工具 guidance。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：正常自然互动。积累 5+ 轮 STM 后触发 SmartPush，在 trace 中检查 system prompt 结构。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 可见窗口节段是否包含 msg_id 标注和"主 LLM 已知/未知"的说明？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('retrieval-55')
```
