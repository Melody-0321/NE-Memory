---
name: smartpush-08
folder: smartpush-08
title: 可见窗口跳过预取
objective: 验证事件全部 msg_id 在 visibleWindow 内时，prefetch 跳过该条目，不向 memory LLM 重复注入主 LLM 已知信息
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4（完整管线可触发）
  - 对话积累至少 6 轮以上（让 STM 和近期 DAG 形成）
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "注入内容是否聚焦于窗口外的事件而非窗口内重复内容？"
  - "注入中是否可见 [msg_xx] 标注（指示原文来自哪轮对话）？"
minRounds: 6
maxRounds: 12
expectedRounds: "7-10"
timeoutPerRound: 120000
---

# SmartPush 可见窗口跳过预取

## 目标
验证事件全部 msg_id 在 visibleWindow 内时，prefetch 跳过该条目，不向 memory LLM 重复注入主 LLM 已知信息。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4（完整管线可触发）
- 对话积累至少 6 轮以上（让 STM 和近期 DAG 形成）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 7-10 轮内自然完成。低于 6 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：同一场景持续推进 10+ 轮，积累充足的 STM，产生"窗口内事件"和"窗口外事件"的区分。引入至少 2 个独立事件线，让部分事件在窗口内、部分在窗口外。最后 2-3 轮提出一个触发 SmartPush 的问题。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 注入内容是否聚焦于窗口外的事件而非窗口内重复内容？
2. 注入中是否可见 [msg_xx] 标注（指示原文来自哪轮对话）？

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 7-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-08')
```
