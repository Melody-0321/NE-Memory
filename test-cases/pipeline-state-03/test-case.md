---
name: pipeline-state-03
folder: pipeline-state-03
title: State 新角色自动模板创建
objective: 验证当 LLM 输出 characters.新名字.status 时，系统自动创建完整角色模板（无需 LLM 手动定义字段）
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启（预设模式）
  - 角色卡加载完毕（state.characters 结构已预分配主角）
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: contains, target: pipeline_changes, value: "characters." }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "对话中是否出现了对话以外的角色？如果有，State 管线是否正确将其纳入 state（characters.新名字）？"
  - "新角色的 state entry 是否只使用了系统预分配的字段路径（如 status, gender_age, occupation, personality 等），没有 LLM 自创的字段名？"
  - "LLM 是否只输出了新角色的值，而没有尝试在 state_changes 中定义角色结构（如 name, gender_age 等模板字段）？——如果是，说明模板自动创建机制起作用了。"
minRounds: 5
maxRounds: 10
expectedRounds: "6-8"
timeoutPerRound: 120000
---

# pipeline-state-03: State 新角色自动模板创建

## 目标
验证新角色自动模板创建机制：
1. 当 LLM 在 `state_changes` 中写上 `characters.新名字.status: "活跃"` 时，系统自动为该角色创建完整的 npc 模板
2. LLM 不需要知道模板结构（name/gender_age/occupation/personality 等），只需输出 `status` 即可
3. 新角色的 state entry 不应包含 LLM 自创的字段名

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- **State Schema 已开启**（预设模式）
- 角色卡加载完毕（主角已在 state.characters 中预分配）
- 对话需要引入至少 1 个新 NPC（不在初始角色卡中）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

轮次参考：预期 6-8 轮内自然完成。低于 5 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：跟随 AI 故事，在对话中**自然引入 1-2 个不在角色卡中的新 NPC**（如酒馆老板、路人、信使等）。让新 NPC 与已有角色发生互动，使 State 管线有机会标记 `characters.新名字.status: "活跃"`。不需要让新 NPC 有很多戏份——短暂出现即可。同时确保故事中也有正常的时间/场景变化。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化输出 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `contains: pipeline_changes [characters.]` | state_changes 中包含角色相关字段 |
| 5 | `exists: pipeline_responses` | pipeline 响应完整 |
| 6 | `not_contains: pipeline_responses [undefined]` | 响应无破碎 |

### 语义性断言（LLM 评估 trace）
1. 对话中是否出现了对话以外的角色？如果有，State 管线是否正确将其纳入 state（`characters.新名字`）？
2. 新角色的 state entry 是否只使用了系统预分配的字段路径（如 `status`, `gender_age`, `occupation`, `personality` 等），没有 LLM 自创的字段名？
3. LLM 是否只输出了新角色的值，而没有尝试在 state_changes 中定义角色结构（如同时输出 `name`, `gender_age` 等模板字段）？——如果是，说明模板自动创建机制起作用了。

## 运行参数
- minRounds: 5
- maxRounds: 10
- expectedRounds: 6-8
- timeoutPerRound: 120000

## 期望行为说明

在预分配架构下，新角色的预期流程：
1. 对话中出现了新 NPC「王五」
2. State LLM 在 `state_changes` 中输出 `"characters.王五.status": "活跃"`
3. `mergeStateChanges` 检测到 `characters.王五` 不存在 → 调用 `ensureCharacterTemplate` 自动创建完整模板
4. 模板自动创建后，`characters.王五` 拥有所有 npc 字段（`name`, `status`, `gender_age`, `occupation`, `personality`, `current_mood` 等），但大部分字段值为空（`''`）
5. 后续轮次中，LLM 可以继续填写王五的其他字段值

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-03')
```
