---
name: smartpush-08
folder: retrieval/smartpush-08-visible-window-skip
title: 可见窗口跳过预取
objective: 验证事件全部 msg_id 在 visibleWindow 内时，prefetch 跳过该条目，实体链块中的原文引用（↓ 预取文本）聚焦于窗口外事件
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4（完整管线可触发）
  - 对话积累至少 6 轮以上（让 STM 和近期 DAG 形成）
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "注入的实体链块中的原文引用（↓ 预取文本 / > 引用行）是否聚焦于窗口外的事件，而非窗口内重复内容？"
  - "注入的实体链块中是否可见 msg_id 列表标注？"
minRounds: 6
maxRounds: 12
expectedRounds: "7-10"
timeoutPerRound: 120000
---

# smartpush-08: 可见窗口跳过预取

## 目标
验证可见窗口跳过预取机制：
1. 全部 msg_id 在 visibleWindow 内的条目 → prefetch 跳过
2. 注入中的原文引用（↓ 预取文本 / > 引用行）聚焦于窗口外事件
3. 窗口内事件仅以结构化条目呈现（无原文重复）

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- 对话积累至少 6 轮以上

## 对话设计
自然互动 6-7 轮，使可见窗口截断旧消息。提问触发 SmartPush 时，窗口外的旧事件应有原文预取，窗口内的新事件应跳过预取。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | 注入存在 |

### 语义性断言
1. 注入的实体链块中原文引用是否聚焦于窗口外事件？
2. 注入的实体链块中是否可见 msg_id 标注？

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 7-10
- timeoutPerRound: 120000
