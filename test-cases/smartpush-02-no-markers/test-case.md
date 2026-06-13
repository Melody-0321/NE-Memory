# SmartPush-02: 注入无来源标记

## 目标
验证 SmartPush 注入文本不包含内部来源标记（`→stm:` 或 `→[stm:` 格式）。
这些是 NE-Memory 内部使用的标记，不应该暴露给主 LLM。

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- 已有足够的 STM 条目触发 SmartPush（>= 4 条）

## 对话设计（给 LLM Driver 的指导）
交互模式: 混合。
身份: 你是故事作者。主角叫阿明，矿工。

话题路线:
1. 前 3 轮——角色引入：阿明、老张、许瑶陆续登场，建立多角色互动
2. 第 4-5 轮——事件推进：矿洞异常、老张看到奇怪光、工头不在
3. 第 6 轮——测试查询：围绕矿洞情况提问，触发 SmartPush 检索

关键：Driver 的目标是让 NE 积累足够的 STM 条目来触发 SmartPush，
然后检查注入文本是否格式干净。

## 断言
### 结构性
- `min_length`: smartpush_injection >= 80
- `not_contains`: smartpush_injection 不含 `→stm:`
- `not_contains`: smartpush_injection 不含 `→[stm:`
- `not_contains`: smartpush_injection 不含 `stm_`

### 语义性
- 注入文本是否完全从玩家视角可读，没有任何内部 ID 或数据库标识符泄露？
- 即使有多条记忆，注入是否以流畅的自然语言呈现？

## 运行参数
- maxRounds: 6
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTest(__ne_debug._testPresets.smartpush02)
```

或手动指定 config。

> **注意**：运行前确保聊天框中已加载角色卡且有开场白。Driver 通过 AI 回复自然感知故事世界。
> 测试期间请不要手动操作聊天框。
