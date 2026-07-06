---
name: smartpush-04
folder: retrieval/smartpush-04-stm-zero
title: STM=0 注入降级
objective: 验证 vault 为空（无 STM、无 LTM）时 SmartPush 优雅降级为 state-only 注入
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - vault 为空（无 STM、无 LTM）— 由用户在运行前手动清空
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "在 STM=0 的情况下，SmartPush 是否优雅降级（注入长度合理、内容不包含虚构记忆信息）？"
  - "降级后的注入是否告诉对话LLM vault 为空而不是输出乱码？"
minRounds: 4
maxRounds: 8
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# SmartPush-04: STM=0 注入降级

## 目标
验证 vault 为空（无 STM、无 LTM）时 SmartPush 优雅降级为 state-only 注入。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- **vault 为空（无 STM、无 LTM）** — 运行前请手动在 NE 面板中清空当前对话的 vault 数据
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：正常自然对话。不需要特意触发检索。目标是在 vault 为空的情况下让 SmartPush 自然触发，观察降级行为。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 在 STM=0 的情况下，SmartPush 是否优雅降级（注入长度合理、内容不包含虚构记忆信息）？
2. 降级后的注入是否告诉对话 LLM vault 为空而不是输出乱码？

## 运行参数
- minRounds: 4
- maxRounds: 8
- expectedRounds: 5-7
- timeoutPerRound: 120000

> **运行前准备**：在 NE 面板中清除当前对话的 vault 数据（STM 和 LTM），确保 vault.content 为空。

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-04')
```
