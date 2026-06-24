---
name: smartpush-12
folder: retrieval/smartpush-12-prompt-structure
title: SmartPush Memory LLM 系统提示词结构
objective: 验证 Memory LLM 收到的 system prompt 遵循 7 层认知结构，不含原文泄漏、msg_id 为有效数字、候选条目带 msgs 标签、access() 限制已告知
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 副 API 可用
structural:
  - { op: exists, target: smartpush_prompt }
  - { op: not_contains, target: smartpush_prompt, value: "## 最近一轮对话上下文" }
  - { op: not_contains, target: smartpush_prompt, value: "[msg_undefined]" }
  - { op: contains, target: smartpush_prompt, value: "[msgs:" }
  - { op: contains, target: smartpush_prompt, value: "最多 2 次 access" }
  - { op: min_length, target: smartpush_prompt, value: 200 }
semantic:
  - "System prompt 中是否存在 7 层结构：身份+任务 → 规则 → 当前语境 → 可见窗口 → 候选记忆 → 工具？每一层是否出现在正确的位置顺序？"
  - "可见窗口段是否仅包含 [msg_N] 格式的紧凑列表（无原文）？"
  - "候选记忆条目是否带有 [msgs: X,Y] 标签？"
  - "[msg_N] 中的 N 是否为有效数字（而非 undefined/null）？"
  - "System prompt 中是否未出现主 LLM 的对话原文泄漏（conversationBlock 已删除）？"
  - "规则 8「认知边界」是否引用 entities[] 和线程标签（而非 conversation context 原文）？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-12: Memory LLM 系统提示词结构

## 目标
验证 SmartPush 触发时，Memory LLM 收到的 system prompt 遵循以下结构约束：

1. **7 层认知顺序** — 身份→规则→语境→可见窗口→候选→工具，自顶向下面向 LLM 认知模型
2. **无原文泄漏** — `## 最近一轮对话上下文` 段已删除；可见窗口不含 200 chars 原文复述
3. **msg_id 有效** — 可见窗口中 `[msg_N]` 的 N 为实际数字（非 `undefined`）
4. **候选带 msgs 标签** — 条目含 `[msgs: X,Y]` 用于对照可见窗口
5. **access() 限制** — 工具段明确「最多 2 次 access() 调用」
6. **规则 8 来源正确** — 活跃角色从 `entities[]` + 线程标签识别，不引用已删除的 conversation context

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4
- 副 API 可用

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：自然互动 4-5 轮积累 STM，然后提出一个与之前对话内容相关的具体问题，触发 SmartPush。无需特殊构造——正常对话即可触发。

## 断言

### 结构性断言（代码自动检查）
| 断言 | 含义 |
|------|------|
| `exists: smartpush_prompt` | SmartPush 触发后 system prompt 存在 |
| `not_contains: "## 最近一轮对话上下文"` | conversationBlock 已删除——无原文泄漏 |
| `not_contains: "[msg_undefined]"` | msg_id 全部有效——`computeVisibleWindow` 的 `_msg_id` 已注入 |
| `contains: "[msgs:"` | 候选条目带有 msgs 标签——对照链路存在 |
| `contains: "最多 2 次 access"` | access() 调用限制已在 prompt 中告知 |
| `min_length: 200` | System prompt 非空且小于合理长度 |

### 语义性断言（LLM 评估 trace）
1. System prompt 中是否存在 7 层结构？每一层是否出现在正确的位置顺序？
2. 可见窗口段是否仅包含 `[msg_N]` 格式的紧凑列表（无原文）？
3. 候选记忆条目是否带有 `[msgs: X,Y]` 标签？
4. `[msg_N]` 中的 N 是否为有效数字？
5. System prompt 中是否未出现主 LLM 的对话原文泄漏？
6. 规则 8 是否引用 `entities[]` 和线程标签（而非 conversation context）？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明

此测试的验证对象是 **Memory LLM 的 system prompt**（即 trace 中的 `## System Prompt` 段），而非注入主 LLM 的 `smartpush_injection` 文本。

需要新增 assertion target `smartpush_prompt`：在 `assertions.js` 的 `resolveTarget` 中添加：

```javascript
case 'smartpush_prompt':
    return collected.prompt || '';
```

在 `monitor.js` 的 `collectRoundData` 中捕获 prompt 内容：

```javascript
var prompt = globalThis.__ne_debug_last_pipeline || null;
// 提取 system message content
```

`smartpush_injection` 已有测试（retrieval-55 / smartpush-group-b），本测试专门覆盖 prompt 结构。

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-12')
```
