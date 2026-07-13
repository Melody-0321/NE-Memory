---
name: smartpush-02
folder: retrieval/smartpush-02-no-markers
status: passed
last_run: 2026-06-16
title: SmartPush 注入无来源标记
objective: 验证 SmartPush 注入文本不包含内部来源标记（→st: 或 stm_ 格式），以实体链分块形式的自然描述呈现
preconditions:
  - NE-Memory 已初始化
  - 副 API 可用
  - 已有足够的 STM 条目触发 SmartPush（>= 4 条）
structural:
  - { op: min_length, target: smartpush_injection, value: 80 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: not_contains, target: smartpush_injection, value: "→[stm:" }
  - { op: not_contains, target: smartpush_injection, value: "stm_" }
semantic:
  - "注入文本是否完全从玩家视角可读，没有任何内部 ID 或数据库标识符泄露？"
  - "即使有多条记忆，注入是否以清晰的 HTML 结构化格式呈现（h2 关键记忆标题下的事件条目）？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-02: 注入无来源标记

## 目标
验证 SmartPush 注入文本不含任何内部标记：
1. 无 `→stm:` 格式
2. 无 `→[stm:` 格式
3. 无 `stm_` 前缀（数据库 ID 泄漏）
4. 注入以实体链分块格式呈现，从玩家视角可读

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- STM >= 4 条触发 SmartPush

## 对话设计
自然互动 4-5 轮积累 STM，提出与对话相关的问题触发 SmartPush。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `min_length: 80` | 注入非空 |
| `not_contains: →stm:` | 三重标记检查 |
| `not_contains: →[stm:` | 三重标记检查 |
| `not_contains: stm_` | 无 stm_ 前缀泄漏 |

### 语义性断言
1. 注入文本是否完全从玩家视角可读，无任何内部 ID 或标识符泄露？
2. 注入是否以清晰的 HTML 结构化格式呈现？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000
