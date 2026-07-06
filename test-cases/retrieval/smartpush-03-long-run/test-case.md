---
name: smartpush-03
folder: retrieval/smartpush-03-long-run
title: 大轮次注入稳定性
objective: 验证连续 15-20 轮对话中 SmartPush 持续稳定注入实体链分块记忆，无退化（变空、乱码、重复碎片）
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
  - { op: not_contains, target: smartpush_injection, value: "→[stm:" }
semantic:
  - "注入质量在后半段是否无明显退化（变空、乱码、重复碎片），实体链分块结构是否始终保持？"
  - "注入内容是否始终保持与当前对话语境相关（实体链中的事件与当前话题可关联）？"
minRounds: 8
maxRounds: 20
expectedRounds: "15-20"
timeoutPerRound: 120000
---

# smartpush-03: 大轮次注入稳定性

## 目标
验证长时间对话中 SmartPush 注入保持稳定：
1. 注入长度持续 ≥ 50 chars
2. 无内部标记泄漏
3. 实体链分块结构不退化
4. 注入内容与语境持续相关

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计
Driver 通过 15-20 轮自然对话，保持连贯故事线。后半段验证注入格式是否保持一致，无退化。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `min_length: 50` | 持续非空 |
| `not_contains: →stm:` | 无标记泄漏 |
| `not_contains: →[stm:` | 无标记泄漏 |

### 语义性断言
1. 注入质量在后半段是否无明显退化（实体链分块结构是否始终保持）？
2. 注入内容是否始终保持与当前对话语境相关？

## 运行参数
- minRounds: 8
- maxRounds: 20
- expectedRounds: 15-20
- timeoutPerRound: 120000
