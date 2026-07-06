---
name: smartpush-05
folder: retrieval/smartpush-05-dedup
title: 注入内容去重
objective: 验证同一事件在对话中被二次引述时，SmartPush 的注入内容稳定、无多余重复膨胀，实体链块结构一致
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？"
  - "两次注入的实体链块结构是否一致（同一实体的条目数未异常膨胀）？"
minRounds: 6
maxRounds: 12
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# smartpush-05: 注入内容去重

## 目标
验证 SmartPush 注入去重效果：
1. 同一事件二次引述时注入信息与首次一致
2. 无 2x+ 内容膨胀或矛盾
3. v2 实体链块条目数稳定（不随反复注入而膨胀）

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计
1. 先自由互动 3-4 轮，积累 STM
2. 提问一个与之前事件相关的问题 → 触发首次 SmartPush 注入
3. 继续 1-2 轮自然对话后，再次提及同一事件 → 触发第二次注入

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | 注入存在 |

### 语义性断言
1. 第二次注入中同一事件信息是否与首次一致、无 2x+ 膨胀或矛盾？
2. 两次注入的实体链块结构是否一致（条目数稳定）？

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 8-10
- timeoutPerRound: 120000
