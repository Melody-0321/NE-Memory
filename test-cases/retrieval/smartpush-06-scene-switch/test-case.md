---
name: smartpush-06
folder: retrieval/smartpush-06-scene-switch
title: 跨场景注入切换
objective: 验证对话场景切换后 SmartPush 注入重心从老场景转向新场景
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "场景切换后，注入内容是否以新场景的信息为主而非老场景的旧信息？"
  - "注入是否同时包含新老场景信息，且新场景信息占主导？"
minRounds: 8
maxRounds: 14
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# SmartPush-06: 跨场景注入切换

## 目标
验证对话场景切换后（地点转移/时间跳转），SmartPush 注入重心从老场景转向新场景。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 10-12 轮。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
1. 前 5-6 轮——引导一个具体场景（城市/城堡/森林），引入多个角色和事件细节
2. 第 7 轮——明确触发场景切换（如"第二天他们踏上了新的旅途……"或"你来到了另一个城市……"），描述新地点和新起始事件
3. 后 4-5 轮——在新场景中推进，引入新事件
4. 在最后 2 轮提出一个与新场景相关的问题触发 SmartPush

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 场景切换后，注入内容是否以新场景的信息为主而非老场景的旧信息？
2. 注入是否同时包含新老场景信息，且新场景信息占主导？

## 运行参数
- minRounds: 8
- maxRounds: 14
- expectedRounds: 10-12
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-06')
```
