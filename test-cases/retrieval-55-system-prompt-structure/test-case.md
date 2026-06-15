---
name: retrieval-55
folder: retrieval-55
title: SmartPush 注入内容格式（事件日志 + msg_id 标注）
objective: 验证 SmartPush 注入内容以事件日志格式组织，条目带时间戳和 msg_id 标注
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "注入内容是否以事件日志格式组织（包含时间戳、场景信息）？"
  - "注入中每条条目是否带 [→msg_asst_xx] 标注（指示原始消息来源）？"
  - "注入内容是否避免了乱码、截断或重复碎片？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# retrieval-55: SmartPush 注入内容格式

## 目标
验证 SmartPush 注入内容以事件日志格式组织，条目带时间戳和 msg_id 标注。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：正常自然互动。积累 5+ 轮 STM 后触发 SmartPush，观察注入内容格式。

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 注入内容是否以事件日志格式组织（包含时间戳、场景信息）？
2. 注入中每条条目是否带 [→msg_asst_xx] 标注（指示原始消息来源）？
3. 注入内容是否避免了乱码、截断或重复碎片？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('retrieval-55')
```
