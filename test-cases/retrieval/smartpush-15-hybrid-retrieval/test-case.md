---
name: smartpush-15
folder: retrieval/smartpush-15-hybrid-retrieval
title: BM25+Vector 混合检索端到端验证
objective: 验证向量搜索启用时 SmartPush 端到端正常运转 — 注入为实体链分块格式、无内部标记、向量索引已构建、降级路径不破坏现有行为
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 副 API 可用
  - Embedding API 已配置（ne_embedding_api localStorage 中 url/key/model 齐全）
  - ne_settings.enableVectorSearch = true
structural:
  - { op: exists, target: smartpush_injection }
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "→stm:" }
semantic:
  - "SmartPush 注入是否包含前几轮积累的记忆信息（非 state-only 占位、非空壳），以实体链分块格式呈现？"
  - "注入内容是否与对话历史相关（能看到按实体分组的具******件信息）？"
  - "注入文本中是否无原始数据转储痕迹（无 JSON、无 stm_id 泄漏）？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-15: BM25+Vector 混合检索验证

## 目标
验证向量搜索启用时 SmartPush 端到端正常：
1. 注入非空（≥ 50 chars）
2. 无内部标记
3. 注入为实体链分块格式
4. 向量索引正常工作
5. 降级路径不破坏行为

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- Embedding API 已配置
- enableVectorSearch = true

## 对话设计
自然互动 4-5 轮积累 STM，提出与对话相关的问题触发 SmartPush。

## 断言

### 结构性断言
| 断言 | 含义 |
|------|------|
| `exists: smartpush_injection` | 混合检索下注入存在 |
| `min_length: 50` | 注入非空壳 |
| `not_contains: →stm:` | 无内部标记 |

### 语义性断言
1. SmartPush 注入是否以实体链分块格式呈现，包含记忆信息（非 state-only 占位）？
2. 注入内容是否与对话历史相关（按实体分组的具******件信息）？
3. 注入无原始数据转储痕迹（无 JSON、无 stm_id）？

### 手工验证
运行后在 Console 中检查：
- vector index 状态（entries >= STM 条目数、vectors[i].length === 1536）
- trace 中 `useVectorScore` 是否为 true

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000
