---
name: tc-xx
folder: tc-xx
title: 测试名称
objective: 简要描述要验证什么
preconditions:
  - NE-Memory 已初始化
  - 副 API 可用
structural:
  - { op: min_length, target: smartpush_injection, value: 50 }
  - { op: not_contains, target: smartpush_injection, value: "内部标记" }
semantic:
  - "语义检查问题 1"
  - "语义检查问题 2"
minRounds: 3
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# TC-XX: 测试名称

## 目标
简要描述要验证什么。

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- （其他条件）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 3 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

在这里告诉 Driver 引导策略（测试技巧，不是故事设定）：
- 何时引入多角色互动
- 何时切入测试查询（提出与之前对话相关的问题触发检索）
- 需要积累多少轮对话

例如：
- "跟随 AI 的故事自然互动。前 5 轮引入新细节和事件发展。第 6 轮提出一个与之前内容相关的具体问题，触发 SmartPush。"
- "跟随 AI 的故事。在对话中自然引入 2-3 个新角色，建立多线叙事。积累 8 轮后提问。"

## 断言
### 结构性
- `min_length`: smartpush_injection >= N
- `not_contains`: smartpush_injection 不含 `xxx`

### 语义性
- 注入内容是否包含与查询相关的记忆信息？
- （其他语义检查问题）

## 运行参数说明
- **minRounds**: 软下限，此轮数前 [DONE] 被忽略，driver 强制继续
- **maxRounds**: 硬上限，此轮数后强制截断
- **expectedRounds**: 给 LLM 的参考区间，指导 [DONE] 节奏

## 调用方式

```javascript
await __ne_debug.runTestByName('tc-xx')
```
