---
name: pipeline-state-04
folder: pipeline/pipeline-state-04
title: 滑动窗口上下文注入 — formatContextMemory → ne_context_memory
objective: 验证滑动窗口上下文（pre-window LTM/STM summary）正确注入 Main LLM 的 system prompt，且 context_memory 非空、格式正确、不含内部标记
preconditions:
  - NE-Memory 已初始化
  - SmartPush 启用
  - 滑动窗口轮次设置 > 0（默认 10）
  - 副 API 可用
  - 有 LTM/STM 积累（至少 4 轮后触发 pipeline）
structural:
  - { op: exists, target: context_memory }
  - { op: min_length, target: context_memory, value: 30 }
  - { op: not_contains, target: context_memory, value: "→stm:" }
  - { op: not_contains, target: context_memory, value: "stm_0x" }
semantic:
  - "context_memory 是否以自然语言摘要形式呈现（而非 raw JSON dump 或 stm_xxx 碎片列表）？"
  - "context_memory 是否包含对话历史的关键信息摘要？"
  - "context_memory 长度是否合理（不应超过 2000 字符）？"
minRounds: 4
maxRounds: 10
expectedRounds: "6-8"
timeoutPerRound: 120000
---

# pipeline-state-04: 滑动窗口上下文注入

## 目标

本测试验证 test5.0 后重新实现的 `formatContextMemory` 功能。

旧版本（commit f5eb1ab 前）将 raw STM/LTM 条目 dump 到 Main LLM，与 SmartPush 重复。
新版本生成自然语言摘要，由 `computeContextPressure` 三重标准判定触发。

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- 滑动窗口轮次设置 > 0（默认 10）
- 有 LTM/STM 积累（至少 4 轮后触发 pipeline）

## 对话设计（给 LLM Driver 的指导）

Driver 跟随 AI 已有故事自然互动，不编造特定故事背景。
正常聊天 6-8 轮，积累 STM/LTM 内容，让 pipeline 自然触发。
当 SmartPush 触发且 context_memory 出现非空注入时即可结束。

## 断言

### 结构性断言（代码自动检查）

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: context_memory` | 滑动窗口上下文已注入 |
| 2 | `min_length: context_memory >= 30` | 非空壳 |
| 3 | `not_contains: context_memory [→stm:]` | 无内部标记泄漏 |
| 4 | `not_contains: context_memory [stm_0x]` | 非 raw dump |

### 语义性断言（LLM 评估 trace）

1. context_memory 是否以自然语言摘要形式呈现（而非 raw JSON dump 或 stm_xxx 碎片列表）？
2. context_memory 是否包含对话历史的关键信息摘要？
3. context_memory 长度是否合理（不应超过 2000 字符）？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 6-8
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-04')
```
