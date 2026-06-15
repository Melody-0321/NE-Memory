---
name: smartpush-group-b
folder: smartpush-group-b
title: "[组合] SmartPush 检索优化（去重+可见窗口+预取+query+prompt+短链）"
objective: 单次对话覆盖 TC-05/08/10/11/55/58 的 trace 和语义验证
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 角色卡包含至少 3 个不同角色
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？"
  - "注入内容是否聚焦于窗口外的事件而非窗口内重复内容？"
  - "注入中是否可见 [msg_xx] 标注（指示原文来自哪轮对话）？"
  - "可见窗口节段是否包含 msg_id 标注和\"主 LLM 已知/未知\"的说明？"
minRounds: 8
maxRounds: 14
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# SmartPush Group B — 检索优化（去重 + 可见窗口 + 预取 + query + system prompt + 短链 inline）

## 目标
单次对话覆盖六个检索优化特性验证：
1. **注入内容去重（TC-05）** — 同一事件二次触发时内容稳定无膨胀
2. **可见窗口跳过预取（TC-08）** — visibleWindow 内事件跳过 prefetch
3. **预取原文完整度（TC-10）** — 全量 msg_id 原文 + [msg_xx] 前缀 + ≤2000 字符
4. **query 含 AI reply（TC-11）** — BM25 query 包含最近 2 轮 AI 回复和 user 输入
5. **检索 System Prompt 结构（TC-55）** — 包含可见窗口/对话上下文节段
6. **短链自动 inline（TC-58）** — count ≤ 5 的实体链自动注入

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 10-12 轮。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

### 角色要求
确保对话中自然出现**至少 3 个不同角色**。让其中一个角色频繁出场（5+ 次互动），其他角色仅 2-3 次出场。这将建立长链/短链区分（TC-58）。

### 分阶段引导策略

**阶段一（前 5-6 轮）** — 自然推进对话，引入多个角色和一个具体事件 A。让早期轮次自然展开，积累 STM。

**阶段二（第 6-8 轮）** — 提出一个与事件 A 相关的具体问题，触发第一次 SmartPush。在此之后继续推进 1-2 轮对话，引入新的事件 B。

**阶段三（第 9-11 轮）** — 再次提出与**同一事件 A** 相关的问题，触发第二次 SmartPush。验证两次注入的一致性（TC-05）。

**阶段四（后续轮次）** — 如果对话仍在继续，正常互动即可。不早于第 8 轮声明 [DONE]。

### 关键时序要求
- 两次关于事件 A 的提问之间间隔至少 1-2 轮自然对话
- 早期轮次（前 4-5 轮）的内容应能在后续滑出 maxContext 可见窗口，以验证窗口跳过（TC-08）

## 断言

### 结构性断言
- exists: smartpush_injection

### 语义性断言（LLM 评估）
1. 在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？
2. 注入内容是否聚焦于窗口外的事件而非窗口内重复内容？
3. 注入中是否可见 [msg_xx] 标注（指示原文来自哪轮对话）？
4. 可见窗口节段是否包含 msg_id 标注和"主 LLM 已知/未知"的说明？

## 运行参数
- minRounds: 8（确保两次 SmartPush 触发）
- maxRounds: 14
- expectedRounds: 10-12
- timeoutPerRound: 120000

> 此组合测试为单次对话统一运行，所有 6 个检查点共享同一段对话数据。
> 个体测试（smartpush-05/08/10/11、retrieval-55/58）保留各自的 test-case.md 供单独调试。

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-group-b')
```
