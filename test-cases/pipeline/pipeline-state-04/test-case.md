---
name: pipeline-state-04
folder: pipeline/pipeline-state-04
title: Context Window 记忆摘要注入
objective: 验证 ne_context_memory 为超出 contextWindowRounds 的早期对话注入 LTM/STM 摘要，且最近 N 轮原文不被重复注入
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
  - contextWindowRounds 设为较小值（如 5-10），以确保部分轮次落入窗口外
  - 对话轮数 > contextWindowRounds * 1.5（即必须有窗口外的消息）
  - 对话前段有足够事件产生 STM/LTM 条目
structural:
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: pipeline_responses }
  - { op: exists, target: context_memory }
  - { op: min_length, target: context_memory, value: 40 }
  - { op: contains, target: context_memory, value: "历史记忆摘要" }
semantic:
  - "State pipeline 在执行 context window 注入后是否仍正常运行（无错误日志、无空响应）？"
  - "context_memory 注入中是否包含记忆摘要而非原文？检查 trace 中 context_memory 字段：不应有大段对话原文，应是结构化的 LTM/STM 摘要条目（如 [时间] 场景: 事件描述 格式）。"
  - "SmartPush 检索是否在 context window 存在的情况下正常工作？检索结果中不应因 context window 注入而产生无关条目。"
minRounds: 8
maxRounds: 20
expectedRounds: "10-14"
timeoutPerRound: 120000
---

# pipeline-state-04: Context Window 记忆摘要注入

## 目标

验证 commit `53b87af` 新增的 `context-window.js` + `ne_context_memory` 注入机制：

1. **记忆摘要注入**：超出 `contextWindowRounds` 的早期对话以 LTM/STM 摘要形式注入（depth=1），补充可能被 ST 裁剪掉的历史
2. **不重复原文**：ST chat stream 保持原样，ne_context_memory 只注入摘要，不重复注入对话原文
3. **不破坏顺序**：dialogue stream 的排序不受影响
4. **LTM 优先**：已整合的叙事线以完整摘要呈现；STM 碎片截断到 20 条
5. **窗口内只注入 LTM**：当对话 < N 轮时，只注入 LTM 摘要（不注入 STM 碎片）

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- State Schema 已开启
- **contextWindowRounds 设为较小值**（如 5-10），以确保部分轮次落入窗口外。在 Settings → Engine → Context Window Rounds 调整
- 对话轮数 > contextWindowRounds * 1.5（即必须有窗口外的消息）
- 对话前段有足够事件产生 STM/LTM 条目

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

轮次参考：预期 10-14 轮内自然完成。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
- 第 1-6 轮：积累对话内容，制造事件（如探索新地点、遇到 NPC、对话决策等），确保 STM/LTM 管线产生足够的记忆条目
- 第 7-12 轮：继续推进故事，上下文窗口开始生效——此时前 6 轮应该已超出窗口
- 第 13-14 轮：与前期事件产生呼应（如提到之前去过的地方、之前遇到的人），检验 LLM 是否通过记忆摘要「还记得」

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `not_contains: pipeline_changes [error]` | 无报错 |
| 3 | `exists: pipeline_responses` | pipeline 响应完整 |
| 4 | `exists: context_memory` | context_memory 被注入 |
| 5 | `min_length: context_memory >= 40` | 注入非空 |
| 6 | `contains: context_memory ["历史记忆摘要"]` | 包含记忆摘要标记 |

### 语义性断言（LLM 评估 trace）

1. State pipeline 在执行 context window 注入后是否仍正常运行（无错误日志、无空响应）？
2. context_memory 注入中是否包含记忆摘要而非原文？检查 trace 中 context_memory 字段：不应有大段对话原文，应是结构化的 LTM/STM 摘要条目（如 [时间] 场景: 事件描述 格式）。
3. SmartPush 检索是否在 context window 存在的情况下正常工作？检索结果中不应因 context window 注入而产生无关条目。

## 运行参数

- minRounds: 8
- maxRounds: 20
- expectedRounds: 10-14
- timeoutPerRound: 120000

## 期望行为说明

```
onBeforeGenerate 流程:
  1. 读取 contextWindowRounds（如 6 轮）
  2. computeWindowStartMsgId(chatMessages, 6) → 最近 6 轮的第一条消息 ID
  3. filterPreWindowEntries → 筛选 msg_id < 窗口起始ID 的 STM/LTM
  4. formatContextMemory → 格式化摘要文本
  5. injectPrompt('ne_context_memory', ..., depth=1, system)

LLM 看到的顺序:
  [depth=0: ne_state_block / ne_char_block]
  [depth=1: ne_context_memory — 历史记忆摘要（LTM + pre-window STM）]
  [ST raw chat history — 原样、原顺序]
  [depth=2: ne_memory_vault]
```

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-04')
```
