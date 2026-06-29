---
name: retrieval-58
folder: retrieval/retrieval-58-short-chain-inline
title: 短链自动 inline
objective: 验证 mergePipelines Step 5 将 count <= 5 的实体链自动注入 notebook map，count > 5 的长链保留在 availableChains
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 角色卡包含至少 3 个不同角色
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "实体链分块注入中是否包含了短链实体（count <= 5）的事件条目？"
  - "注入中是否可以看到多个不同实体的分组块（反映多角色故事）？"
minRounds: 6
maxRounds: 12
expectedRounds: "7-10"
timeoutPerRound: 120000
---

# retrieval-58: 短链自动 inline

## 目标
验证 mergePipelines Step 5 将短链自动 inline 到 notebook map：
- count <= 5 的实体链自动注入的条目在 SmartPush 注入中以实体链块形式可见
- count > 5 的长链保留在 availableChains（不在注入中但可供 access() 递归展开）

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- 角色卡包含至少 3 个不同角色

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | SmartPush 注入存在 |

### 语义性断言
1. 注入中是否包含了短链实体（count <= 5）的事件条目？
2. 注入中是否可以看到多个不同实体的分组块？

### 手工验证
在 trace/report 中验证：
- `__ne_debug_last_merge` 的 availableChains 中长链仍保留
- 短链实体已在实体链分组块中出现

## 运行参数
- minRounds: 6
- maxRounds: 12
- expectedRounds: 7-10
- timeoutPerRound: 120000
