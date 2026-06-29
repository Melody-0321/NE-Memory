---
name: smartpush-14
folder: smoke/smartpush-14-full-chain-smoke
title: 全链路冒烟测试（STM + LTM + SmartPush + State + 注入）
objective: 验证全链路无断裂，pipeline LLM 响应有效，无报错或 fallback，注入内容为实体链分块格式
preconditions:
  - NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
  - 副 API 可用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: exists, target: smartpush_prompt }
  - { op: min_length, target: smartpush_prompt, value: 200 }
  - { op: exists, target: stm_events }
  - { op: min_length, target: pipeline_responses, value: 50 }
  - { op: not_contains, target: pipeline_responses, value: "\"error\"" }
  - { op: contains, target: pipeline_responses, value: "\"ltm_decision\"" }
  - { op: exists, target: ltm_state }
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: state_block_instruction }
  - { op: min_length, target: state_block_instruction, value: 20 }
semantic:
  - "SmartPush 注入是否以实体链分块格式呈现（## 实体记忆链 → ### 实体名 (N events) → 条目列表 + KB 标注）？"
  - "注入是否包含 ## 记忆使用指南 段？"
  - "STM 提取事件是否覆盖了该轮对话中的重要情节？"
  - "STM+LTM 合流管线是否正常工作（含 ltm_decision：action + updated_title）？"
  - "State 管线是否正常执行，state_changes 是否有实际的字段路径（characters.* 而非空对象）？"
  - "ne_state_table 和 ne_char_block 注入指令是否非空且包含正确格式？"
  - "trace 中所有 pipeline LLM 调用的 response 是否都成功返回了有效 JSON（无截断、无 parse error）？"
  - "trace 中是否出现过 pipeline LLM 调用 fallback？如有，是否仍正常工作？"
  - "context_memory（滑动窗口上下文摘要）是否已移除？在 Plan B 重构中 formatContextMemory / ne_context_memory 注入已被删除，SmartPush 实体链分块已覆盖其功能。"
minRounds: 4
maxRounds: 8
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-14: 全链路冒烟测试

## 目标
全面验证 v2 重构后的 NE-Memory 全链路无断裂：
1. SmartPush 注入为实体链分块格式（buildEntityBlock 拼装）
2. Pipeline LLM 响应有效（JSON 完整无 parse error）
3. STM+LTM+State 三条管线均正常运行
4. fallback 路径不破坏现有行为

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- State Schema 已开启
- 副 API 可用
- stmBatch >= 4

## 对话设计
Driver 跟随 AI 自然互动 4-7 轮。无需特殊构造。

## 断言

### 结构性断言（15 条）
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | SmartPush 触发成功 |
| `min_length: smartpush_injection >= 50` | 注入非空 |
| `not_contains: smartpush_injection →stm:` | 无内部标记 |
| `exists: smartpush_prompt` | Memory LLM prompt 存在 |
| `min_length: smartpush_prompt >= 200` | Prompt 非空 |
| `exists: stm_events` | STM 提取成功 |
| `min_length: pipeline_responses >= 50` | pipeline LLM 有输出 |
| `not_contains: pipeline_responses "error"` | 无 pipeline 报错 |
| `contains: pipeline_responses "ltm_decision"` | STM+LTM 合流正常 |
| `exists: ltm_state` | LTM 快照有效 |
| `exists: pipeline_changes` | State 管线执行过 |
| `min_length: pipeline_changes >= 1` | 有 state_changes |
| `not_contains: pipeline_changes error` | State 无报错 |
| `exists: state_block_instruction` | 注入指令存在 |
| `min_length: state_block_instruction >= 20` | 指令非空 |

### 语义性断言
1. SmartPush 注入是否以实体链分块格式呈现（实体链块 + KB 标注 + 使用指南）？
2. STM 提取是否覆盖重要情节？
3. STM+LTM 合流是否正常（ltm_decision）？
4. State 管线是否正常（state_changes 含 characters.*）？
5. 注入指令是否非空且格式正确？
6. pipeline LLM response 是否有效 JSON、无 parse error？
7. fallback 路径是否正常？
8. 对话轮数截断是否按预期生效（可通过 `__ne_debug.dumpVault()` 检查 vault 中的消息覆盖范围）？

## 运行参数
- minRounds: 4
- maxRounds: 8
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明
v2 重构后注入格式从"LLM 叙事散文"切换为"代码拼装实体链块"。buildEntityBlock + buildMemoryUsageGuide 自动生成注入文档。
