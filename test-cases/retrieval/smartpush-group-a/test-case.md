---
name: smartpush-group-a
folder: retrieval/smartpush-group-a
title: "[组合] SmartPush 基础质量（注入非空 + 无来源标记 + 去重 + 实体链格式）"
objective: 单次对话覆盖 TC-01/02/05 的 trace 和语义验证，验证 v2 实体链分块格式
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: not_contains, target: smartpush_injection, value: "→[stm:" }
  - { op: not_contains, target: smartpush_injection, value: "stm_" }
semantic:
  - "SmartPush 注入是否包含前几轮积累的记忆信息？"
  - "注入是否以 HTML 结构化格式呈现（h2 关键记忆 → h3 实体名 → 条目列表）？"
  - "注入文本是否完全从玩家视角可读，没有任何内部 ID 或数据库标识符泄露？"
  - "同一事件反复注入时（如果发生），内容是否稳定、无多余重复？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# SmartPush Group A — 基础质量（注入非空 + 无来源标记 + 去重 + 实体链格式）

## 目标
覆盖四个 SmartPush 基础质量断言：
1. 注入非空（TC-01）— 有 STM 时注入包含记忆内容，非 state-only 降级
2. 无来源标记（TC-02）— 注入不含 →stm: / →[stm: / stm_ 内部标记
3. 注入去重（TC-05）— 同一事件反复注入时内容稳定、无多余重复
4. 实体链格式（v2）— 注入为 buildEntityBlock 生成的实体链分块文档

## 断言

### 结构性断言
- min_length: smartpush_injection >= 50
- not_contains: smartpush_injection →stm:
- not_contains: smartpush_injection →[stm:
- not_contains: smartpush_injection stm_

### 语义性断言（LLM 评估）
1. SmartPush 注入是否包含前几轮积累的记忆信息？
2. 注入是否以 HTML 结构化格式呈现（h2 关键记忆 + h3 实体名 + 条目列表）？
3. 注入文本是否完全从玩家视角可读，没有任何内部 ID 或标识符泄露？
4. 同一事件反复注入时，内容是否稳定、无多余重复？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
