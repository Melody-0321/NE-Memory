---
name: smartpush-10
folder: retrieval/smartpush-10-prefetch-completeness
title: 预取原文完整度
objective: 验证 prefetchOriginalTexts 取全部 msg_id 原文，每行带 [msg_xx] 前缀，总字符 ≤ 2000
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic: []
minRounds: 4
maxRounds: 10
expectedRounds: "5-8"
timeoutPerRound: 120000
---

# SmartPush 预取原文完整度

## 目标
验证 prefetchOriginalTexts 取全部 msg_id 原文，每行带 [msg_xx] 前缀，总字符 ≤ 2000。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-8 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：正常自然互动。积累 5+ 轮 STM 后触发 SmartPush。不需要特殊引导。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言
无（通过 trace 手工验证：prefetch 包含所有 msg_id 原文、每行带 [msg_xx] 前缀、总字符 ≤ 2000）

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-8
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-10')
```
