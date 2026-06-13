# TC-XX: 测试名称

## 目标
简要描述要验证什么。

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- （其他条件）

## 对话设计（给 LLM Driver 的指导）
描述 LLM Driver 应如何积累对话以触发测试条件。
例如：积累 6 轮矿山相关的对话后，在第 7 轮询问与之前记忆相关的问题。

## 断言
### 结构性
- `min_length`: smartpush_injection >= N
- `not_contains`: smartpush_injection 不含 `xxx`

### 语义性
- 注入内容是否包含与查询相关的记忆信息？
- （其他语义检查问题）

## 运行参数
- maxRounds: N
- timeoutPerRound: 120000
