---
name: pipeline-state-06
folder: pipeline/pipeline-state-06-factions
title: 势力状态管理 — 一次性预载 + 关键词激活
objective: 验证势力从世界书一次性提取到 state（全隐藏）、对话中提及后关键词激活、已激活势力出现在 state injection table 中
preconditions:
  - NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
  - 副 API 可用
  - 角色卡附带世界书，世界书中包含势力信息（至少 1 个势力条目）
  - stmBatch >= 4
structural:
  - { op: exists, target: faction_state }
  - { op: min_length, target: faction_state, value: 20 }
  - { op: contains, target: faction_state, value: "\"hidden\"" }
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "state.factions 中是否提取到了世界书中确实存在的势力名称？"
  - "是否有势力在对话中被提及后从 hidden 变为 visible？检查 faction_state 中 visible 列表是否非空。"
  - "状态注入表中是否出现了已激活势力的名称和态度字段？"
  - "State LLM 的 state_changes 是否输出了 factions 相关路径？"
minRounds: 4
maxRounds: 10
expectedRounds: "6-8"
timeoutPerRound: 120000
---

# pipeline-state-06: 势力状态管理

## 目标

验证 commit `456c70d` 引入的势力一次性预载 + 关键词激活机制：

1. **预载**：首轮 `resolveNpcSchemes` 从世界书全量提取势力 → `state.factions`（全部 `_hidden: true`）
2. **关键词激活**：对话中提到势力名/别名 → `_hidden: false`
3. **State LLM 更新**：激活后 State LLM 可管理 attitude/notes
4. **注入过滤**：仅已激活势力进入 State Injection Table

## 前置条件

- 角色卡包含世界书，世界书中有势力相关条目
- Driver 应在对话中自然提及至少一个世界书中的势力名称
- State Schema 已开启（factions 相关 schema 已启用）
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动。

**关键**：Driver 在对话中应自然提及世界书中存在的势力名称。可以讨论该势力的背景、成员、或与玩家的关系。不需要编造特定故事 — 跟随 AI 的故事线进行即可。

轮次参考：预期 6-8 轮。当 faction_state 出现 visible 列表非空、且 pipeline_changes 有内容时即可结束。

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: faction_state` | 势力状态已采集 |
| 2 | `min_length: faction_state >= 20` | 非空 |
| 3 | `contains: faction_state ["hidden"]` | 至少有一个隐藏势力 |
| 4 | `exists: pipeline_changes` | State 管线执行过 |
| 5 | `min_length: pipeline_changes >= 1` | 有变化写入 |
| 6 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性断言（LLM 评估 trace）

1. state.factions 中是否提取到了世界书中确实存在的势力名称？
2. 是否有势力在对话中被提及后从 hidden 变为 visible？检查 faction_state 中 visible 列表是否非空。
3. 状态注入表中是否出现了已激活势力的名称和态度字段？
4. State LLM 的 state_changes 是否输出了 factions 相关路径？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 6-8
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-06')
```
