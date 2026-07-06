---
name: stm-scene-switch
folder: pipeline/stm-scene-switch
title: STM 场景切换提取 — L1 边界检测跨场景边界
objective: 验证 computeTurnBoundarySignals / classifyBoundary 在场景切换时正确切出事件边界（sameChar=false → L1_CUT），STM 事件不跨场景合并
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - stmBatch 较小（3-5）以确保场景切换后尽快触发 STM 提取
structural:
  - { op: exists, target: stm_events }
  - { op: min_length, target: stm_events, value: 1 }
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "对话是否经历了一次明确的场景切换（如从室内到室外、从一个地点到另一个地点）？检查 STM events 的内容：切换前后的 event.context 字段是否包含了不同的场景信息。"
  - "场景切换后产生的 STM 事件是否与切换前的事件分属不同的段？检查 pipeline_responses——场景切换点是否被识别为事件边界（产生了新的 STM 条目，而不是追加到旧条目）？"
  - "如果对话中同一场景持续了多轮（3-4 轮未切换），同一场景内的 STM 是否被正确合并到同一个 segment 中（而不是每轮都切出新事件）？"
minRounds: 6
maxRounds: 14
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# stm-scene-switch: STM 场景切换提取

## 目标

验证 STM 三层边界检测在场景切换场景下的正确性：

1. **L1 边界检测**：`classifyBoundary` 中 `sameChar=false` 触发 `L1_CUT`，场景切换时不漏切
2. **事件不跨场景**：切换前和切换后的对话内容不会被合并为同一条 STM
3. **同场景内不误切**：同一场景内连续多轮内容被正确归入同一 segment

## 相关函数

- `computeTurnBoundarySignals` ([update.js L592-L628](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L592-L628)) — 计算相邻 turn 的边界信号（overlap、sameChar、absGap）
- `classifyBoundary` ([update.js L635-L642](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L635-L642)) — 四层分类：L1_CUT / L2_CUT / L2_KEEP / L3_ASK
- `segmentTurns` ([update.js L682-L709](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L682-L709)) — 编排切割流程

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- stmBatch 设置较小（3-5），确保场景切换后尽快触发 STM 提取

## 对话设计

Driver 引导 AI 经历至少一次明显的场景切换：

1. 第 1-4 轮：在场景 A（如室内/某个房间）自然互动
2. 第 5 轮左右：引导场景切换（如"我们出去走走吧"/"到阳台上"）
3. 第 6-8 轮：在新场景 B 继续互动

关键：场景切换时需要 Main LLM 在 NE-BANNER 中更新场景名称（如"702公寓·阳台"→"楼下花园"），这样 STM 的 `context` 字段会包含正确的场景信息。

当 `stm_events` 至少有 2 条且 `pipeline_changes` 记录了场景变化后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取执行过 |
| 2 | `min_length: stm_events >= 1` | 至少有事件产生 |
| 3 | `exists: pipeline_changes` | State 管线执行过 |
| 4 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. 对话是否经历了至少一次场景切换？检查 STM events 的 context/scene 字段包含了不同场景。
2. 场景切换后是否产生了新的 STM segment（而非追加到旧 segment）？
3. 同一场景内的多轮对话是否未误切（合并到同一 segment）？

## 运行参数

- minRounds: 6
- maxRounds: 14
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('stm-scene-switch')
```
