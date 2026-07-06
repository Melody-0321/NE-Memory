---
name: state-field-validate
folder: pipeline/state-field-validate
title: State 字段白名单校验 — 拒绝 LLM 自创字段名
objective: 验证 validateStateChanges / validateField 正确过滤不在 schema 白名单中的字段路径；State LLM 输出的 state_changes 中不包含 LLM 自创的字段名（与 Current State 表中定义的字段名完全一致）
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启（预设或动态模式均可）
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "State LLM 的 state_changes 输出中是否存在 LLM 自创的字段路径？检查 pipeline_responses——所有字段路径是否与 Current State 表中的定义完全一致（如 gender_age、occupation、personality、status 等）？是否存在如 hobby、favorite_food、backstory 等非标准路径？"
  - "如果 LLM 确实尝试输出了不在 schema 中的字段路径，validateStateChanges 是否正确对其给出了警告（console.warn）并拒绝写入？检查 pipeline_changes 的最终结果——不应该有非标准字段。"
  - "是否存在字段名拼写错误（如 occupation 写成 ocupation、personality 写成 personalty）？理想情况下不应出现——LLM 应从 Current State 表中精确复制字段名。"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# state-field-validate: State 字段白名单校验

## 目标

验证 `validateStateChanges` 的字段白名单机制 —— State LLM 的 state_changes 输出中不应出现 LLM 自创的字段名。

## 相关函数

- `validateStateChanges` ([schema.js L378-L411](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L378-L411)) — 遍历变更路径，查 schema，调 validateField
- `validateField` ([schema.js L312-L353](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L312-L353)) — 类型校验（string truncate、number range、boolean、enum）
- `resolveSchemaPath` ([schema.js L356-L376](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L356-L376)) — dot-path 递归解析到 schema 定义

### 白名单策略

- 路径在 schema 中找到 → 严格类型校验
- 路径不在 schema 中但父路径在 → 警告但放行
- 路径完全不在 schema 中 → 警告但放行
- 类型校验失败 → 警告但拒绝该值

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- State Schema 已开启

## 对话设计

Driver 与 AI 自然互动 5-7 轮，引入 1-2 个角色参与对话。无需刻意诱导 LLM 输出错误字段名——正常流程中如果 LLM 有自创字段的倾向，pipeline_responses 和 pipeline_changes 的对比会暴露。

当 `pipeline_changes` 有内容后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `exists: pipeline_responses` | pipeline 响应完整 |
| 5 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性
1. state_changes 中是否存在 LLM 自创的字段路径？
2. 如果 LLM 输出了非标准路径，validateStateChanges 是否正确拒绝/警告？
3. 是否存在字段名拼写错误？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('state-field-validate')
```
