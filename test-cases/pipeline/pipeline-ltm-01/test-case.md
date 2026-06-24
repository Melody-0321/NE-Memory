---
name: pipeline-ltm-01
folder: pipeline/pipeline-ltm-01
title: LTM 流式整合测试（STM+LTM 合流）
objective: 验证 STM+LTM 合流管线 — LLM 在同一次调用中输出 ltm_decision，open/closed 生命周期正常，硬上限自动闭合
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - stmBatch <= 4（确保早期触发 STM 提取）
  - stmMaxUnconsolidated = 5
structural:
  - { op: exists, target: stm_events }
  - { op: min_length, target: stm_events, value: 1 }
  - { op: exists, target: ltm_decision }
  - { op: contains, target: pipeline_responses, value: "\"ltm_decision\"" }
  - { op: contains, target: pipeline_responses, value: "\"updated_title\"" }
  - { op: min_length, target: ltm_state, value: 10 }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "LTM 管线是否在 STM 提取的同一次 LLM 调用中正确输出了 ltm_decision（包含 action + updated_title + updated_event）？"
  - "LLM 的闭合决策（append/close_and_new/skip）是否合理，基于对话中的时间/场景/实体变化？"
  - "updated_title 和 updated_event 是否准确反映了当前 LTM 包含的所有 STM 的事件内容（非空壳、非旧标题复制）？"
  - "trace 中是否出现了 1-ref LTM（单条 STM 组成的 LTM）？如出现，是新弧开启还是孤立的未闭合残留？"
  - "硬上限（15条 STM）自动闭合逻辑是否在代码侧正常工作（从 trace 的 vault stats 观察 open LTM 是否超限）？"
minRounds: 6
maxRounds: 12
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# pipeline-ltm-01: LTM 流式整合测试

## 目标
验证 STM+LTM 合流管线的完整生命周期：
1. STM-only 阶段（unc < 阈值，不注入 LTM 上下文）
2. STM+LTM 合流阶段（unc ≥ 阈值，注入 LTM 上下文，LLM 输出 ltm_decision）
3. 首次触发 → 创建 open LTM
4. 后续追加 → append 到 open LTM，title/event 更新
5. 弧终结 → close_and_new 闭合当前弧并开启新弧
6. 硬上限触发 → 代码侧自动闭合（LLM 无感知）

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- stmBatch <= 4（确保早期触发 STM 提取）
- stmMaxUnconsolidated = 5

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 8-10 轮。低于 6 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
- 前 4-5 轮：自然互动积累对话，不刻意构造跨越场景或时间。等待 STM 积累到阈值后自然触发上一次 STM 提取 + LTM 整合。
- 第 5-7 轮之后：如果 trace 显示 LTM 整合已触发且产生了 at least one open LTM，继续聊 2-3 轮让 LLM 有机会输出 append（追加到当前弧）。
- 如果对话时间跨度超过 1 天或场景明显变化，LLM 可能输出 close_and_new。
- 当至少一次 LTM 整合发生（ltm_decision 非空、ltm_state 显示 at least 1 open 或 closed LTM）后即可 [DONE]。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取成功 |
| 2 | `min_length: stm_events >= 1` | 至少 1 条新事件 |
| 3 | `exists: ltm_decision` | LTM 决策产生 |
| 4 | `contains: pipeline_responses ["ltm_decision"]` | LLM 输出了 ltm_decision JSON |
| 5 | `contains: pipeline_responses ["updated_title"]` | LLM 输出了更新后的 LTM 标题 |
| 6 | `min_length: ltm_state >= 10` | LTM 状态快照有效 |
| 7 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性断言（LLM 评估 trace）
1. LTM 管线是否在 STM 提取的同一次 LLM 调用中正确输出了 ltm_decision（包含 action + updated_title + updated_event）？
2. LLM 的闭合决策（append/close_and_new/skip）是否合理，基于对话中的时间/场景/实体变化？
3. updated_title 和 updated_event 是否准确反映了当前 LTM 包含的所有 STM 的事件内容（非空壳、非旧标题复制）？
4. trace 中是否出现了 1-ref LTM（单条 STM 组成的 LTM）？如出现，是新弧开启还是孤立的未闭合残留？
5. 硬上限（15条 STM）自动闭合逻辑是否在代码侧正常工作（从 trace 的 vault stats 观察 open LTM 是否超限）？

## 预期流程

### Phase 1: STM-only（轮次 1-4）
- 每次 STM 提取产生 events，不加 LTM 上下文
- unconsolidated_stm 从 0 逐步增长到 8+

### Phase 2: 首次 STM+LTM 合流（轮次 5 左右）
- unc >= 阈值 → 注入 LTM 上下文段
- LLM 输出 events + ltm_decision
- 首次触发时无 open LTM → LLM 应为 skip 或 append（由代码侧创建 open LTM）
- trace 中 ltm_state 出现 open=1

### Phase 3: 持续合流（轮次 6-10）
- 后续 STM 提取继续携带 LTM 上下文
- LLM 在 append/close_and_new/skip 中切换
- trace 可见 LTM 的 open/closed 数量变化

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-ltm-01')
```
