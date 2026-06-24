---
name: pipeline-state-03
folder: pipeline/pipeline-state-03
title: State 新角色字段展开 + 模板分层规则
objective: 验证 State LLM 看到 12 字段展开模板（▲/△/○/◆ 标记），未填字段显示 (未填) 标记，LLM 优先填充未填的 ▲/△ 字段；banner present 路径调 ensureCharacterTemplate；protagonist_name 从 ctx.name2 推断
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启（预设模式）
  - contextWindowRounds >= 30（或对话 < 30 轮）
  - 对话中自然引入至少 1 个新 NPC
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: contains, target: pipeline_changes, value: "characters." }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "State LLM 是否对新角色输出了至少 3 个字段（不只是 status）？理想情况应包括 gender_age / occupation / personality 等可从对话推断的字段。"
  - "新角色的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection, relationship, current_mood 等），没有 LLM 自创的字段名？"
  - "State LLM 是否对无法从对话中推断的字段留空（输出 ''），而不是编造虚假信息？"
minRounds: 5
maxRounds: 12
expectedRounds: "7-9"
timeoutPerRound: 120000
---

# pipeline-state-03: State 新角色字段展开 + 分层规则

## 目标

验证 commit `53b87af` 后的新行为：

1. **12 字段模板展开**：State LLM 在 Current State 表中看到完整字段列表（▲/△/○/◆ 标记），不只是 4 个字段
2. **(未填) 标记**：未填充的 ▲/△ 字段显示 (未填) 注释，LLM 被指令优先填充这些字段
3. **per-field 独立判断**：每个字段独立决定是否输出——未填且可推断就填，已填仅变化时输出。不再有 [NEW] binary 标记
4. **分层规则**：
   - ▲ 必填 → 优先从未填推断填写
   - △ 建议 → 有线索就填，无则留空
   - ○ 选填 → 仅明确提及时填写
   - ◆ 增量追加 → 仅追加新内容
5. **禁止编造**：LLM 对无法推断的字段留空，不编造
6. **banner present 路径**：banner 引入的新角色通过 `ensureCharacterTemplate` 创建完整字段壳
7. **protagonist_name**：`ctx.name2` 自动写入 `state.protagonist_name`

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- **State Schema 已开启**（预设模式）
- contextWindowRounds >= 30（或对话 < 30 轮）
- 对话中自然引入至少 1 个新 NPC

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

轮次参考：预期 7-9 轮内自然完成。低于 5 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
- 第 1-3 轮：跟随 AI 故事自然互动，积累对话
- 第 4-6 轮：**自然引入 1-2 个不在角色卡中的新 NPC**（如酒馆老板、路人、信使等）。尽量让该 NPC 的性别/年龄、职业、性格等信息在对话中可被自然推断（比如通过称呼、衣着描述、说话方式等）。
- 第 7-9 轮：让新 NPC 与已有角色发生 2-3 轮互动，使 State LLM 有机会从对话中提取多个字段。

注意：不需要让新 NPC 有长篇戏份——短暂出现即可。但需要给 State LLM 足够的对话线索来推断 gender_age / occupation / personality。

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化输出 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `contains: pipeline_changes [characters.]` | state_changes 中包含角色字段 |
| 5 | `exists: pipeline_responses` | pipeline 响应完整 |
| 6 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性断言（LLM 评估 trace）

1. State LLM 是否对新角色输出了至少 3 个字段（不只是 status）？理想情况应包括 gender_age / occupation / personality 等可从对话推断的字段。
2. 新角色的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection, relationship, current_mood 等），没有 LLM 自创的字段名？
3. State LLM 是否对无法从对话中推断的字段留空（输出 ''），而不是编造虚假信息？

## 运行参数

- minRounds: 5
- maxRounds: 12
- expectedRounds: 7-9
- timeoutPerRound: 120000

## 期望行为说明

v2.0 (commit `53b87af`) 的新角色流程：

1. 对话中出现新 NPC「王五」
2. 如果 Main LLM 输出了 NE-BANNER「…|王五」→ banner present 路径调用 `ensureCharacterTemplate` 创建完整字段壳
3. State LLM 在 Current State 表中看到 12 行字段（▲ status / ▲ gender_age / ▲ occupation / ▲ personality / △ affection / △ relationship / ...）
4. 空角色显示 `[NEW]` 标记
5. State LLM 输出所有可从对话推断的 ▲/△ 字段（不只是 status）
6. 无法推断的字段留空 ''，等待后续轮次补全

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-03')
```
