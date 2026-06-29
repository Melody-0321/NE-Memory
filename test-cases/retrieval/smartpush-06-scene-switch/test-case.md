---
name: smartpush-06
folder: retrieval/smartpush-06-scene-switch
title: 跨场景注入切换
objective: 验证对话场景切换后 SmartPush 注入的实体链块重心从老场景转向新场景
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "场景切换后，注入的实体链块中是否以新场景的实体事件为主（而非老场景的旧事件占主导）？"
  - "注入的实体链块是否同时包含新老场景的实体，且新场景实体排在前列或事件数更多？"
minRounds: 8
maxRounds: 14
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# smartpush-06: 跨场景注入切换

## 目标
验证对话场景切换后 SmartPush 检索重心正确转移：
1. 开启一段故事 → 积累老场景 STM
2. 自然过渡到新场景（不同地点/时间）→ 继续积累新场景 STM
3. 提问触发 SmartPush → 注入的实体链块中新场景实体排在前列或事件数更多

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计
先展开老场景 4-5 轮（积累实体 A 的 STM），然后自然切换到新场景 4-5 轮（积累实体 B 的 STM），提问触发 SmartPush。检查注入的实体链块是否优先展示新场景的实体。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | 注入存在 |

### 语义性断言
1. 注入的实体链块是否以新场景的实体事件为主？
2. 新老场景的实体是否都在注入中出现，但新场景实体排在前列？

## 运行参数
- minRounds: 8
- maxRounds: 14
- expectedRounds: 10-12
- timeoutPerRound: 120000
