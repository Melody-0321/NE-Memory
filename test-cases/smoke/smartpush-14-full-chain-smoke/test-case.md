---
name: smartpush-14
folder: smoke/smartpush-14-full-chain-smoke
title: 全链路冒烟测试（STM + LTM + SmartPush + State + 注入）
objective: 验证全链路（STM 提取 → LTM 合流 → SmartPush 检索 → State 管线 → ne_state_table 注入 → ne_char_block 注入 → ne_memory_vault 注入）无断裂，pipeline LLM 响应有效，无报错或 fallback
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
  - "SmartPush 注入是否包含与对话内容相关的具体记忆信息（而非空话/占位符）？"
  - "注入内容是否以自然语言叙事呈现（而非 JSON dump 或碎片化 stm_xxx 列表）？"
  - "STM 提取事件是否覆盖了该轮对话中的重要情节？"
  - "STM+LTM 合流管线是否正常工作（STM 提取同时输出了 ltm_decision，包含 action + updated_title）？"
  - "State 管线是否正常执行，state_changes 是否有实际的字段路径（characters.* 而非空对象）？检查 pipeline_changes 是否至少有一轮包含非空变更。"
  - "ne_state_table 和 ne_char_block 注入指令是否非空且包含正确格式？检查 trace 中这两项注入的文本长度和关键标记。"
  - "trace 中所有 pipeline LLM 调用的 response 是否都成功返回了有效 JSON（无截断、无 parse error）？"
  - "trace 中是否出现过 pipeline LLM 调用 fallback（secondary API → TH）？如有，是否仍正常工作？"
minRounds: 4
maxRounds: 8
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-14: 全链路冒烟测试（STM + LTM + SmartPush + State + 注入）

## 目标

验证完整管线链路无断裂。每个 push 前跑。

**覆盖管线**：
- STM 提取（三层边界检测 → Phase 2 批量摘要）
- LTM 合流（STM+LTM 同次调用，ltm_decision）
- SmartPush 检索（BM25 + 实体链 + 记忆合成 → ne_memory_vault 注入）
- State 管线（State LLM → state_changes → mergeStateChanges → vault）
- Main LLM 注入（ne_state_table + ne_char_block + ne_state_block + ne_memory_vault）

## 前置条件

- NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
- 副 API 可用
- stmBatch >= 4

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：跟随 AI 已有故事自然互动。不需要引入特殊角色、场景切换或复杂事件。就正常聊 5-7 轮，积累对话内容，让管道自然运作。当 SmartPush 触发（注入非空）且 State 管线执行后即可结束。

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: smartpush_injection` | SmartPush 触发成功 |
| 2 | `min_length: smartpush_injection >= 50` | 注入非空壳 |
| 3 | `not_contains: smartpush_injection [→stm:]` | 无内部标记泄漏 |
| 4 | `exists: smartpush_prompt` | Memory LLM 收到 system prompt |
| 5 | `min_length: smartpush_prompt >= 200` | Prompt 非空 |
| 6 | `exists: stm_events` | STM 提取成功 |
| 7 | `min_length: pipeline_responses >= 50` | 至少一条 pipeline LLM 有有效输出 |
| 8 | `not_contains: pipeline_responses ["error"]` | 无 pipeline 报错 |
| 9 | `contains: pipeline_responses ["ltm_decision"]` | STM+LTM 合流管线正常工作 |
| 10 | `exists: ltm_state` | LTM 状态快照有效 |
| 11 | `exists: pipeline_changes` | State 管线执行过 |
| 12 | `min_length: pipeline_changes >= 1` | 有 state_changes |
| 13 | `not_contains: pipeline_changes [error]` | State 管线无报错 |
| 14 | `exists: state_block_instruction` | NE-BANNER + NE-CHAR 指令已注入 |
| 15 | `min_length: state_block_instruction >= 20` | 指令非空 |

### 语义性断言（LLM 评估 trace）

1. SmartPush 注入是否包含与对话内容相关的具体记忆信息（而非空话/占位符）？
2. 注入内容是否以自然语言叙事呈现（而非 JSON dump 或碎片化 stm_xxx 列表）？
3. STM 提取事件是否覆盖了该轮对话中的重要情节？
4. STM+LTM 合流管线是否正常工作（STM 提取同时输出了 ltm_decision，包含 action + updated_title）？
5. State 管线是否正常执行，state_changes 是否有实际的字段路径（characters.* 而非空对象）？
6. ne_state_table 和 ne_char_block 注入指令是否非空且包含正确格式？
7. trace 中所有 pipeline LLM 调用的 response 是否都成功返回了有效 JSON（无截断、无 parse error）？
8. trace 中是否出现过 pipeline LLM 调用 fallback（secondary API → TH）？如有，是否仍正常工作？

## 运行参数

- minRounds: 4
- maxRounds: 8
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-14')
```
