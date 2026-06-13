# SmartPush-01: 注入非空

## 目标
验证在有 STM 记录的情况下，SmartPush 向主 LLM 注入了记忆内容。
（State-only 降级不算有效注入——注入需要包含具体的记忆条目。）

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- SmartPush 已启用（stmBatch >= 4 触发完整管线）

## 对话设计（给 LLM Driver 的指导）
交互模式: 混合。
身份: 你是故事作者。主角叫阿明，是一名矿工，在矿山小镇生活。
需要引入的角色: 老张（铁匠）、许瑶（地质师）、工头（不在镇上）。

话题路线:
1. 前 2 轮——日常引入：阿明在矿山小镇的日常，提及矿洞最近有些异常
2. 第 3-4 轮——事件推进：老张来了，说在矿洞深处看到奇怪的光
3. 第 5-6 轮——积累线索：讨论是否报告工头、找许瑶帮忙、矿洞入口水位上升
4. 第 7 轮——测试查询：询问矿洞现在的情况，触发 SmartPush 检索

Driver 应该在 6 轮积累后自然触发 SmartPush 管线（4 条消息 batch）。

## 断言
### 结构性
- `min_length`: smartpush_injection >= 50
- `not_contains`: smartpush_injection 不含 `→stm:`
- `not_contains`: smartpush_injection 不含 `→[stm:`

### 语义性
- SmartPush 注入是否包含前 6 轮积累的记忆信息（如矿洞异常、老张看到光、水位上升）？
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
