---
name: smartpush-03
folder: smartpush-03
title: 大轮次注入稳定性
objective: 验证连续 15-20 轮对话中 SmartPush 持续稳定注入，无退化（变空、乱码、重复碎片）
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: not_contains, target: smartpush_injection, value: "→[stm:" }
semantic:
  - "注入质量在后半段是否无明显退化（变空、乱码、重复碎片）？"
  - "注入内容是否始终保持与当前对话语境相关？"
minRounds: 8
maxRounds: 20
expectedRounds: "15-20"
timeoutPerRound: 120000
---

# SmartPush-03: 大轮次注入稳定性

## 目标
验证连续 15-20 轮对话中 SmartPush 持续稳定注入，无退化（变空、乱码、重复碎片）。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 15-20 轮。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：持续推进同一场景的对话，在每轮中自然引入新的细节或事件。不需要特意早早提问触发检索——保持对话自然推进，让 SmartPush 在各轮中自然触发。目标是在长时间对话的前中后段都有注入发生。

## 断言

### 结构性断言
- `min_length`: smartpush_injection >= 50
- `not_contains`: smartpush_injection 不含 `→stm:`
- `not_contains`: smartpush_injection 不含 `→[stm:`

### 语义性断言（LLM 评估）
1. 注入质量在后半段是否无明显退化（变空、乱码、重复碎片）？
2. 注入内容是否始终保持与当前对话语境相关？

## 运行参数
- minRounds: 8
- maxRounds: 20
- expectedRounds: 15-20
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-03')
```
