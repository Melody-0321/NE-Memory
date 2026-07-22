---
name: smartpush-group-b
folder: retrieval/smartpush-group-b
status: passed
last_run: 2026-06-16
title: "[组合] SmartPush 检索优化（去重+可见窗口+预取+query+短链+实体链格式）"
objective: 单次对话覆盖 TC-05/08/10/11/55/58 的 trace 和语义验证，验证 v2 实体链分块格式
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 角色卡包含至少 3 个不同角色
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "在 trace 中是否出现了两次或多次 SmartPush 注入？如果是，第二次注入中关于同一事件的信息是否与第一次注入一致，没有出现内容 2x+ 膨胀或矛盾？"
  - "注入内容是否聚焦于窗口外的事件而非窗口内重复内容？"
  - "注入是否以 HTML 结构化格式呈现（h2 关键记忆 → h3 实体名 → 条目列表）？"
  - "注入中是否可见实体链标题行的高相关事件计数？"
minRounds: 8
maxRounds: 14
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# SmartPush Group B — 检索优化组合（去重+可见窗口+预取+短链+实体链格式）

## 目标
单次对话覆盖 6 个检查点：
1. TC-05：注入去重（二次注入一致性）
2. TC-08：可见窗口跳过（聚焦窗口外事件）
3. TC-10：预取完整度
4. TC-11：query 含 AI reply
5. retrieval-55：注入格式（v2 实体链分块）
6. retrieval-58：短链 inline

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- 角色卡包含至少 3 个角色（确保多实体链分组生效）

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | SmartPush 注入存在 |

### 语义性断言
1. 二次注入中同一事件信息是否与首次一致（无 2x+ 膨胀或矛盾）？
2. 注入内容是否聚焦于窗口外的事件？
3. 注入是否以 HTML 结构化格式呈现？
4. 注入中是否可见实体链标题行的高相关事件计数？

## 运行参数
- minRounds: 8
- maxRounds: 14
- expectedRounds: 10-12
- timeoutPerRound: 120000
