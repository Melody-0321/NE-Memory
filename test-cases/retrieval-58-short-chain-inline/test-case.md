---
name: retrieval-58
folder: retrieval-58
title: 短链自动 inline
objective: 验证 mergePipelines Step 5 将 count ≤ 5 的实体链自动注入 notebook map，count > 5 的长链保留在 availableChains
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 角色卡包含至少 3 个不同角色
structural:
  - { op: exists, target: smartpush_injection }
semantic: []
minRounds: 6
maxRounds: 12
expectedRounds: "7-10"
timeoutPerRound: 120000
---

# 短链自动 inline

## 目标
验证 mergePipelines Step 5 将 count ≤ 5 的实体链自动注入 notebook map，count > 5 的长链保留在 availableChains。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- 角色卡包含至少 3 个不同角色

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 7-10 轮内自然完成。低于 6 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：引入 3+ 角色，让某些角色仅有 2-3 次出场，建立短链；让另一个角色频繁出场建立长链。最后 2 轮提出一个触发 SmartPush 的问题。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言
无（通过 trace 手工验证 availableChains 中 count ≤ 5 的链已被 inline；chain > 5 的仍保留在 availableChains）

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 7-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('retrieval-58')
```
