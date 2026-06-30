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
  - { op: contains, target: smartpush_injection, value: "## 实体记忆链" }
  - { op: contains, target: smartpush_injection, value: "###" }
  - { op: contains, target: smartpush_injection, value: "KB:" }
  - { op: contains, target: smartpush_injection, value: "## 记忆使用指南" }
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
  - { op: equals, target: truncation_count, value: 0 }
  - { op: equals, target: fallback_count, value: 0 }
semantic:
  - "STM 提取事件是否覆盖了该轮对话中的重要情节？对比 pipeline LLM 调用记录中 stm_extract 的输出与对话文本。如果 stm_extract 的事件描述明显遗漏了对话中的关键动作或情节转折，则为不通过。"
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

### 结构性断言（21 条）
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | SmartPush 触发成功 |
| `min_length: smartpush_injection >= 50` | 注入非空 |
| `not_contains: smartpush_injection →stm:` | 无内部标记 |
| `contains: smartpush_injection "## 实体记忆链"` | 实体链分块头部 |
| `contains: smartpush_injection "###"` | 实体子标题 |
| `contains: smartpush_injection "KB:"` | KB 知晓度标注 |
| `contains: smartpush_injection "## 记忆使用指南"` | 使用指南段 |
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
| `equals: truncation_count = 0` | 无 completion 截断（completion_tokens < 2048） |
| `equals: fallback_count = 0` | 无 fallback 到 TavernHelper |

### 语义性断言（1 条）
1. STM 提取事件是否覆盖了该轮对话中的重要情节？对比 pipeline LLM 调用记录中 stm_extract 的输出与对话文本。如果 stm_extract 的事件描述明显遗漏了对话中的关键动作或情节转折，则为不通过。

## 运行参数
- minRounds: 4
- maxRounds: 8
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明
v2 重构后注入格式从"LLM 叙事散文"切换为"代码拼装实体链块"。buildEntityBlock + buildMemoryUsageGuide 自动生成注入文档。
