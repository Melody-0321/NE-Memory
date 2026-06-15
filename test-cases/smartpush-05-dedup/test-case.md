---
name: smartpush-05
folder: smartpush-05
title: 注入内容去重
objective: 验证同一事件在对话中被二次引述时，SmartPush 的注入内容稳定、无多余重复膨胀
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？"
minRounds: 6
maxRounds: 12
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# SmartPush-05: 注入内容去重

## 目标
验证同一事件在对话中被二次引述时，SmartPush 的注入内容稳定、无多余重复膨胀。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 8-10 轮。低于 6 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
1. 前 5-6 轮——自然推进对话，引入一个具体事件或细节
2. 第 6-7 轮——提出一个与之前事件相关的问题，触发第一次 SmartPush
3. 继续推进 2-3 轮对话
4. 第 9-10 轮——再次提出与同一事件相关的问题，触发第二次 SmartPush
5. 目标：两次触发，验证注入内容一致稳定

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-05')
```
