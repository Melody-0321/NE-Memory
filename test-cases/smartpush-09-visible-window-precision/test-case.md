---
name: smartpush-09
folder: smartpush-09
title: 可见窗口计算精度
objective: 验证向后行走 token 计数器在长对话中正确累加，maxContext 边界处截断正确
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - maxContext 设为 4096（默认值）
structural: []
semantic: []
minRounds: 8
maxRounds: 30
expectedRounds: "15-20"
timeoutPerRound: 120000
---

# SmartPush 可见窗口计算精度

## 目标
验证向后行走 token 计数器在长对话中正确累加，maxContext 边界处截断正确。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- maxContext 设为 4096（默认值）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 15-20 轮内自然完成。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：长对话测试。持续推进对话到 20+ 轮，让早期轮次超出 maxContext 边界。不需要特定引导策略，自然推进足够轮次即可。

## 断言

### 结构性断言
无（通过 trace 中的 visibleWindow 数据手工验证）

### 语义性断言
无

## 运行参数
- minRounds: 8
- maxRounds: 30
- expectedRounds: 15-20
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-09')
```
