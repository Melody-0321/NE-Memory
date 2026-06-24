---
name: ltm-consolidate
folder: pipeline/ltm-consolidate
title: LTM 基础合并 — append/close_and_new 决策 + 硬上限自动闭合
objective: 验证 applyLtmDecision 的 append（追加到 open LTM）、close_and_new（闭合当前弧并建新弧）和 MAX_OPEN_STM_REFS=15 硬上限自动闭合三项核心逻辑
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - stmBatch 较小（3-4）以加速 STM 积累
  - stmMaxUnconsolidated 较小（3-4）以加速 LTM 触发
structural:
  - { op: exists, target: ltm_decision }
  - { op: exists, target: ltm_state }
  - { op: min_length, target: ltm_state, value: 10 }
  - { op: exists, target: stm_events }
  - { op: contains, target: pipeline_responses, value: '"ltm_decision"' }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "LLM 是否输出了至少一次 append 决策（对话在同一个故事弧内继续，追加到当前 open LTM）？检查 ltm_decision 的 action 字段。"
  - "LLM 是否在场景或事件明显变化时输出了 close_and_new（闭合当前弧并开启新弧）？检查 ltm_decision 中的 action 和 updated_title 是否反映了弧的变化。"
  - "如果 open LTM 的 stm_refs 达到 15 条硬上限，代码侧是否自动闭合了该 LTM（不依赖 LLM 决策）？检查 ltm_state 中的 closed 计数和 vault stats 的 open LTM 上限。"
minRounds: 8
maxRounds: 20
expectedRounds: "12-16"
timeoutPerRound: 120000
---

# ltm-consolidate: LTM 基础合并

## 目标

验证 LTM 合并的三项核心逻辑：

1. **append**：LLM 判断对话在同一故事弧内继续 → 追加到当前 open LTM
2. **close_and_new**：场景/事件显著变化 → 闭合当前弧并开启新弧
3. **硬上限自动闭合**：open LTM 的 stm_refs ≥ 15 → 代码侧强制闭合（不依赖 LLM）

## 相关函数

- `applyLtmDecision` ([consolidate.js L151-L238](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/consolidate.js#L151-L238)) — 执行 append/close_and_new/skip
- `MAX_OPEN_STM_REFS = 15` ([consolidate.js L9](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/consolidate.js#L9)) — 硬上限常量
- `getMaxUnconsolidated` ([consolidate.js L23-L32](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/consolidate.js#L23-L32)) — unconsolidated STM 阈值（默认 5）
- `computeClosureSignals` ([consolidate.js L53-L115](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/consolidate.js#L53-L115)) — 闭合信号计算

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- stmBatch 设较小（3-4），stmMaxUnconsolidated 设较小（3-4），加速 STM 积累和 LTM 触发

## 对话设计

Driver 与 AI 进行较长时间线对话（12-16 轮），让 STM 自然积累到触发 LTM 合并：

1. 第 1-6 轮：在同一场景/主题内自然互动 — 预期产生 append
2. 第 7-12 轮：如果对话出现了场景或主题切换，LLM 可能输出 close_and_new
3. 保持对话推进直到硬上限（如果需要验证）— 但 12-16 轮通常不足以触发 15 ref 硬上限

当 `ltm_decision` 非空且 `ltm_state` 显示至少 1 个 open 或 closed LTM 后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: ltm_decision` | LTM 决策产生 |
| 2 | `exists: ltm_state` | LTM 状态可读 |
| 3 | `min_length: ltm_state >= 10` | LTM 快照有效 |
| 4 | `exists: stm_events` | STM 提取正常 |
| 5 | `contains: pipeline_responses ["ltm_decision"]` | LLM 输出含 ltm_decision |
| 6 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性
1. LLM 是否输出了 append 决策（同弧内继续）？
2. LLM 是否在场景/事件变化时输出了 close_and_new？
3. 硬上限自动闭合是否在代码侧正常工作（不依赖 LLM）？

## 运行参数

- minRounds: 8
- maxRounds: 20
- expectedRounds: 12-16
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('ltm-consolidate')
```
