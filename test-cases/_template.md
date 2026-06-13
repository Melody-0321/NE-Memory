# TC-XX: 测试名称

## 目标
简要描述要验证什么。

## 前置条件
- NE-Memory 已初始化
- 副 API 可用
- （其他条件）

## 对话设计（给 LLM Driver 的指导）
Driver 是模拟玩家——只看 AI 回复，不看角色卡内部数据。
在这里告诉 Driver：用什么身份、说什么话题、何时切入测试查询。
例如：
- "你是一名矿工，叫阿明。多轮聊天围绕矿山异常展开。积累 6 轮对话后询问矿洞情况，触发 SmartPush 检索。"
- "你要在对话中自然提到老张（铁匠）、许瑶（地质师），让 NE 建立实体链。"

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
