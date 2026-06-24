---
name: state-merge-retain
folder: pipeline/state-merge-retain
title: State 合并保留非重叠字段 — 两轮 state_changes 不互相覆盖
objective: 验证 mergeStateChanges 对 state 做深拷贝后仅修改 validatedChanges 中的路径，不在本次 changes 中的字段原样保留；验证 _scheme 保护（已有 _scheme 不被覆盖）和 affection.__inc 增量机制
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 2 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "如果对话中某个角色经历了多轮 state_changes（如第一轮填了 gender_age，第二轮填了 occupation，第三轮更新了 status），后续轮的合并是否保留了前面轮次填入的非重叠字段？检查 __ne_debug_last_pipeline.mergedState——同一角色的多个字段是否都存在，没有被后续轮覆盖为空。"
  - "如果对话中出现了 NPC 角色的 _scheme 字段被首次填入，后续轮次中是否有任何 state_changes 覆盖了该 _scheme 值？_scheme 应该被代码侧保护（拒绝修改），不应被 LLM 覆盖。"
  - "affection 的 __inc 增量是否被正确处理？如果 NE-CHAR delta 包含了 affection_delta 值，消费端的叠加逻辑是否正确执行？"
minRounds: 6
maxRounds: 12
expectedRounds: "7-9"
timeoutPerRound: 120000
---

# state-merge-retain: State 合并保留非重叠字段

## 目标

验证 `mergeStateChanges` 的字段保留和保护机制：

1. **非重叠字段保留**：后轮 state_changes 不覆盖前轮已填入的非重叠字段
2. **_scheme 保护**：已有 `_scheme` 值的 NPC 不被 LLM 覆盖
3. **affection.__inc 增量**：NE-CHAR 的 `affection_delta` 正确叠加到当前值（不覆盖）

## 相关函数

- `mergeStateChanges` ([schema.js L471-L526](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L471-L526)) — 深拷贝后仅修改 validated changes 中的路径
- `_scheme 保护` ([schema.js L478-L484](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L478-L484)) — 已有 _scheme 拒绝修改
- `affection 增量` ([schema.js L510-L516](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L510-L516)) — `__inc` 标记触发增量叠加

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- State Schema 已开启

## 对话设计

Driver 与 AI 自然互动 7-9 轮，引入 1-2 个 NPC 角色：

- 第 1-3 轮：互动自然展开，State LLM 首次填入角色静态字段（gender_age、occupation、personality）
- 第 4-6 轮：继续互动，State LLM 可能更新 status 或填入更多字段（clothing_build、relationship）
- 第 7-9 轮：Main LLM 的 NE-CHAR delta 更新 affection_delta

当 pipeline_changes 有 ≥2 轮变化、角色有多个字段被填入后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 2` | 至少 2 轮有变化 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `exists: pipeline_responses` | pipeline 响应完整 |
| 5 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性
1. 后续轮 state_changes 是否保留了前轮的非重叠字段？
2. NPC 的 _scheme 是否被代码侧保护（不被 LLM 覆盖）？
3. affection_delta 增量是否正确叠加（不覆盖为绝对值）？

## 运行参数

- minRounds: 6
- maxRounds: 12
- expectedRounds: 7-9
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('state-merge-retain')
```
