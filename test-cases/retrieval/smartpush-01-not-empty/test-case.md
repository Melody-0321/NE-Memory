---
name: smartpush-01
folder: retrieval/smartpush-01-not-empty
status: passed
last_run: 2026-06-15
title: SmartPush 注入非空
objective: 验证在有 STM 记录的情况下，SmartPush 向主 LLM 注入了实体链分块记忆内容（非 state-only 降级）
preconditions:
  - NE-Memory 已初始化
  - 副 API 可用
  - SmartPush 已启用（stmBatch >= 4 触发完整管线）
structural:
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: not_contains, target: smartpush_injection, value: "→[stm:" }
semantic:
  - "SmartPush 注入是否包含前几轮积累的记忆信息？"
  - "注入是否以 HTML 结构化格式呈现（h2 关键记忆 + h3 实体名 + 条目列表）？"
  - "注入中是否能看到具体的记忆条目，而不仅仅是 state-only 占位符？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-01: SmartPush 注入非空

## 目标
验证 SmartPush 在有 STM 时注入了实体链分块记忆内容：
1. 注入长度 ≥ 50 chars（非空壳）
2. 无内部标记泄漏（→stm: / →[stm: 格式）
3. 包含实际的记忆条目（非 state-only 降级）

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- SmartPush 已启用（stmBatch >= 4）

## 对话设计
Driver 跟随 AI 自然互动。4-5 轮自然积累 STM，然后提出与对话相关的具体问题。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `min_length: 50` | 注入非空壳 |
| `not_contains: →stm:` | 无内部标记泄漏 |
| `not_contains: →[stm:` | 无内部标记泄漏 |

### 语义性断言
1. SmartPush 注入是否包含前几轮积累的记忆信息？
2. 注入是否以 HTML 结构化格式呈现（h2 关键记忆 + h3 实体名 + 条目列表）？
3. 注入中是否能看到具体的记忆条目（非 state-only 占位符）？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明
v2 重构后注入格式从 LLM 叙事散文切换为代码拼装的实体链分块文档。
注入内容由 buildEntityBlock + buildMemoryUsageGuide 生成，LLM 仅输出 KB 标注。
