# SmartPush-01: 注入非空

## 目标
验证在有 STM 记录的情况下，SmartPush 向主 LLM 注入了记忆内容。
（State-only 降级不算有效注入——注入需要包含具体的记忆条目。）

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- SmartPush 已启用（stmBatch >= 4 触发完整管线）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动。**不编造特定故事背景。**

引导策略：
1. 前 5-6 轮——跟随 AI 的故事自然推进，每轮引入新的细节或发展，让对话持续积累内容
2. 第 7 轮——提出一个与之前对话中已建立的信息相关的具体问题，触发 SmartPush 检索

Driver 应该在 6 轮积累后自然触发 SmartPush 管线（4 条消息 batch）。

## 断言
### 结构性
- `min_length`: smartpush_injection >= 50
- `not_contains`: smartpush_injection 不含 `→stm:`
- `not_contains`: smartpush_injection 不含 `→[stm:`

### 语义性
- SmartPush 注入是否包含前几轮积累的记忆信息？
- 注入是否以系统提示形式自然融入，而非原始数据转储？
- 注入中是否能看到具体的记忆条目（STM entries），而不仅仅是 state-only 占位符？

## 运行参数
- maxRounds: 7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTest(__ne_debug._testPresets.smartpush01)
```

或手动指定 config。

> **注意**：运行前确保聊天框中已加载角色卡且有开场白。Driver 通过 AI 回复自然感知故事世界。
> 测试期间请不要手动操作聊天框。
