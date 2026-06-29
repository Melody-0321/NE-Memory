---
name: retrieval-55
folder: retrieval/retrieval-55-system-prompt-structure
status: passed
last_run: 2026-06-15
title: SmartPush 注入内容格式（实体链分块 + msgs 标注）
objective: 验证 SmartPush 注入内容以实体链分块格式组织，条目带时间戳和 msgs 链接标注
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
structural:
  - { op: exists, target: smartpush_injection }
semantic:
  - "注入内容是否以实体链分块格式组织（## 实体记忆链 → ### 实体名 (N events) → 条目列表）？"
  - "注入中每条实体链是否带 KB 标注（[KB: 角色=等级]）在链标题行？"
  - "注入是否包含 ## 记忆使用指南 段，解释 4 级认知等级？"
  - "注入内容是否避免了乱码、截断或重复碎片？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# retrieval-55: SmartPush 注入内容格式

## 目标
验证 v2 重构后的 SmartPush 注入主 LLM 的内容格式：

1. **实体链分块** — `## 实体记忆链` 下按实体分 `### 实体名 (N events)` 块
2. **KB 标注内联** — 每个实体链标题行带 `[KB: 角色=等级(...)]` 认知标注
3. **记忆使用指南** — 末尾 `## 记忆使用指南` 解释 4 级认知等级
4. **缺口段** — 如 LLM 报告缺口，末尾出现 `## 缺口` 段

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4

## 对话设计
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
自然互动 4-5 轮积累 STM，提出与对话相关的具体问题触发 SmartPush。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | SmartPush 注入内容存在 |

### 语义性断言
1. 注入内容是否以实体链分块格式组织（## 实体记忆链 → ### 实体名 → 条目列表）？
2. 注入中每条实体链是否带 KB 标注在链标题行？
3. 注入是否包含 ## 记忆使用指南 段？
4. 注入内容是否避免了乱码、截断或重复碎片？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明
v2 重构后注入格式从"LLM 叙事散文 + KB 标注块"切换为"代码拼装实体链块 + 使用指南"。
代码层 buildEntityBlock + buildMemoryUsageGuide 拼装最终注入文档，LLM 仅输出 KB 标注和缺口检测。
