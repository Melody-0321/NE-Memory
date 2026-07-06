---
name: smartpush-12
folder: retrieval/smartpush-12-prompt-structure
title: SmartPush Memory LLM 系统提示词结构
objective: 验证 Memory LLM 收到的 system prompt 遵循三层认知结构（角色→需要做→空输出→严格禁止），候选按实体链分组展示、含 KB 标注指引、access() 限制已告知、无原文泄漏
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - stmBatch >= 4
  - 副 API 可用
structural:
  - { op: exists, target: smartpush_prompt }
  - { op: not_contains, target: smartpush_prompt, value: "## 最近一轮对话上下文" }
  - { op: not_contains, target: smartpush_prompt, value: "[msg_undefined]" }
  - { op: contains, target: smartpush_prompt, value: "[msgs:" }
  - { op: contains, target: smartpush_prompt, value: "access()" }
  - { op: contains, target: smartpush_prompt, value: "严格禁止" }
  - { op: min_length, target: smartpush_prompt, value: 200 }
semantic:
  - "System prompt 中是否存在三层结构：## Role/角色（身份） → ## To Do/需要做（KB 标注 + 缺口检测 + 残余缺口格式） → ## 空输出（空路径建模） → ## 严格禁止（具体禁止短语）？每一层是否出现在正确的位置顺序？"
  - "候选记忆是否按实体链分组展示（## 实体名 + 时间排序条目列表），而非扁平 BM25 列表？"
  - "## To Do 段是否包含 4 级认知标注指引（直接知晓/间接知晓/线索/未知）和输出格式 [实体: X] / [KB: X=Y]？"
  - "## 严格禁止 段是否包含"她感到""他心想""由此可见""这表明"等具体禁止短语（非空泛规则）？"
  - "可见窗口段是否仅包含 [msg_N] 格式的紧凑列表（无原文）？"
  - "[msg_N] 中的 N 是否为有效数字（而非 undefined/null）？"
  - "System prompt 中是否未出现主 LLM 的对话原文泄漏？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# smartpush-12: Memory LLM 系统提示词结构

## 目标
验证 SmartPush 触发时，Memory LLM 收到的 system prompt 遵循 v2 三层认知结构：

1. **三层结构顺序** — Role/角色 → 输入（实体分链候选） → To Do/需要做（KB 标注 + 缺口检测） → 空输出（建模空路径） → 严格禁止（具体禁止短语），自顶向下面向 LLM 认知模型
2. **实体链分组** — 候选按实体分链展示（`## 实体名 (N events)`），而非扁平 BM25 列表；含原文预取 ↓ 文本、关联引用、RRF 评分
3. **KB 标注指引** — 4 级认知等级（直接知晓/间接知晓/线索/未知）+ 输出格式 `[实体: X]` / `[KB: 角色=等级(理由)]`
4. **缺口检测** — access() 递归最多 4 次（vector 路径）或 2 次（BM25 路径），残余缺口输出 `## 缺口`
5. **严格禁止** — 末尾列出具体禁止短语（"她感到""他心想""由此可见""这表明"），非空泛规则
6. **无原文泄漏** — 可见窗口不含原文复述，msg_id 有效

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
| `not_contains: "[msg_undefined]"` | msg_id 全部有效 |
| `contains: "[msgs:"` | 候选条目带有 msgs 标签——对照链路存在 |
| `contains: "access()"` | access() 工具指引已告知 |
| `contains: "严格禁止"` | 三层结构的关键层出现——禁止叙事短语 |
| `min_length: 200` | System prompt 非空 |

### 语义性断言（LLM 评估 trace）
1. System prompt 中是否存在三层结构：Role→To Do（KB 标注+缺口检测）→空输出→严格禁止？每一层是否按正确顺序出现？
2. 候选记忆是否按实体链分组展示（`## 实体名 (N events)`），而非扁平列表？
3. To Do 段是否包含 4 级认知标注指引和 [实体: X] / [KB: X=Y] 输出格式说明？
4. 严格禁止段是否包含具体禁止短语（"她感到""他心想""由此可见""这表明"）？
5. 可见窗口段是否仅包含 `[msg_N]` 紧凑列表（无原文）？
6. `[msg_N]` 中的 N 是否为有效数字？
7. System prompt 中是否未出现主 LLM 的对话原文泄漏？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明

此测试的验证对象是 **Memory LLM 的 system prompt**（即 trace 中的 `## System Prompt` 段），而非注入主 LLM 的 `smartpush_injection` 文本。

v2 重构后 prompt 从"7 层结构 + 规则 1-9 + 叙事合成"切换为"三层结构 + 实体链分组 + 标注清单"。
核心变化：
- LLM 不再输出叙事散文，只输出 `[实体: X]` / `[KB: X=Y]` / `## 缺口`
- 候选不再按 BM25 排序平铺，改为按实体链分组（代码层 groupCandidatesByEntity）
- 末尾增加 `## 严格禁止` 段，含具体禁止短语
- access() 调用限制从固定"最多 2 次"改为"最多 4 次"（vector）/ "最多 2 次"（BM25）

## 调用方式

```javascript
await __ne_debug.runTestByName('smartpush-12')
```
