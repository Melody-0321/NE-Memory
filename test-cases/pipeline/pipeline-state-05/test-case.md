---
name: pipeline-state-05
folder: pipeline/pipeline-state-05
title: autoDecayStaleCharacters 两轮缓冲
objective: 验证角色不在 present 列表时不会立即标记为非活跃，需要连续两轮不在才衰减；名字仅在 dialogue 内精确匹配触发保留
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
  - 对话中至少 1 个活跃 NPC 角色已存在于 state.characters
  - 该 NPC 在某一轮中不再被提及（不在对话文本中）
structural:
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "当角色对话中被提及（名字在消息中出现），state_changes 是否保持了该角色的 status: 活跃？"
  - "当角色在连续两轮对话中都没有被提及，State LLM 是否将角色的 status 从 活跃 改为 非活跃？如果只过了一轮，是否还保持 活跃？"
  - "如果角色以别名/简称被提及（如角色名 '李四·矿工' 在对话中写 '小李'），状态更新是否不受名字变体影响？"
minRounds: 6
maxRounds: 15
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# pipeline-state-05: autoDecayStaleCharacters 两轮缓冲

## 目标

验证 commit `53b87af` 对 `autoDecayStaleCharacters` 的加固：

1. **两轮缓冲**：角色首次不在 present 列表时，进入 `_decay_pending[name]=true`，不立即标记非活跃
2. **连续两轮**：连续两轮不在 present → 才标记 `status = '非活跃'`
3. **重新出现**：待决角色再次出现 → 清除待决标记，保持活跃
4. **精确匹配**：`msgText.indexOf(name)` 匹配（暂不包含模糊/别名匹配——这是已知限制，不是 bug）

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- State Schema 已开启
- 对话中至少 1 个活跃 NPC 角色已存在于 state.characters
- 该 NPC 在某一轮中不再被提及（不在对话文本中）

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

轮次参考：预期 8-10 轮内自然完成。低于 6 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
- 第 1-3 轮：与已有活跃 NPC 互动（该 NPC 名字在对话中明确出现），验证该轮后 NPC 保持活跃状态
- 第 4 轮：**故意不再提及该 NPC**，与其他 NPC 或主角对话——这就是待决的第一轮（_decay_pending 应被激活），此时 NPC **应仍为活跃**
- 第 5 轮：**再次不提及该 NPC**——连续两轮不在 → NPC **应被标记为非活跃**
- 第 6-8 轮（可选）：如果再次提及该 NPC，验证 NPC 重新变为活跃

注意：Driver 需要知道 state.characters 中已有 NPC 的确切名字，用那个名字在对话中提及。

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `not_contains: pipeline_changes [error]` | 无报错 |
| 3 | `exists: pipeline_responses` | pipeline 响应完整 |
| 4 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性断言（LLM 评估 trace）

1. 当角色对话中被提及（名字在消息中出现），state_changes 是否保持了该角色的 status: 活跃？
2. 当角色在连续两轮对话中都没有被提及，State LLM 是否将角色的 status 从 活跃 改为 非活跃？如果只过了一轮，是否还保持 活跃？
3. 如果角色以别名/简称被提及（如角色名 '李四·矿工' 在对话中写 '小李'），状态更新是否不受名字变体影响？

## 运行参数

- minRounds: 6
- maxRounds: 15
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 期望行为说明

v2.0 (commit `53b87af`) 的衰减流程：

```
Round N:   NPC「王五」被提及 msgText.indexOf('王五') !== -1 → 保持活跃
Round N+1: NPC「王五」未被提及 → _decay_pending['王五'] = true（待决，仍是活跃）
Round N+2: NPC「王五」未被提及 → _decay_pending['王五'] 已 true → status = '非活跃'
          或
Round N+2: NPC「王五」被提及 → delete _decay_pending['王五']（清除待决，保持活跃）
```

### 已知限制（非 bug）

- 名字变体不匹配（如 state 中存储为「李四·矿工」但对话中出现的是「小李」）：这种情况下 `msgText.indexOf('李四·矿工')` 返回 -1，角色会被误判为不在场。这是 `indexOf` 精确匹配的设计决定，不是衰减逻辑自身的 bug。

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-05')
```
