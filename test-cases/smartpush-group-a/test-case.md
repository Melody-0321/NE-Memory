# SmartPush Group A — 基础质量（注入非空 + 无来源标记 + 去重）

## 目标
覆盖三个 SmartPush 基础质量断言：
1. 注入非空（TC-01）— 有 STM 时注入包含记忆内容，非 state-only 降级
2. 无来源标记（TC-02）— 注入不含 `→stm:` / `→[stm:` / `stm_` 内部标记
3. 注入去重（TC-05）— 同一事件反复注入时内容稳定、无多余重复

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- stmBatch >= 4（完整管线可触发）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：
- 前 5-6 轮自然推进，在每轮中引入新的细节或事件，让对话持续积累内容
- 引入多个角色或情节线，让对话丰富起来
- 第 7 轮及之后，可以提到之前发生的事来触发 SmartPush 检索
- 重复问两次同一个话题（验证去重），观察注入是否稳定

## 断言

### 结构性断言
- min_length: smartpush_injection >= 50
- not_contains: smartpush_injection →stm:
- not_contains: smartpush_injection →[stm:
- not_contains: smartpush_injection stm_

### 语义性断言（LLM 评估）
1. SmartPush 注入是否包含前几轮积累的记忆信息？
2. 注入是否以自然语言呈现，而非原始数据转储？
3. 注入文本是否完全从玩家视角可读，没有任何内部 ID 或数据库标识符泄露？
4. 同一事件反复注入时（如果发生），内容是否稳定、无多余重复？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000
