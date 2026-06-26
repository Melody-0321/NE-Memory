# State 管线架构验证 — Main LLM NE-CHAR 增量 + State LLM 静态字段 — 测试报告
运行时间: 2026-06-25T17:39:25.767Z
实际轮次: 10
总耗时: 11 分 44 秒

## 断言结果

### 结构性断言
- [x] `exists`: exists: pipeline_changes 不存在 → **PASS**
- [x] `min_length`: min_length: pipeline_changes >=1 → **PASS**
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [x] State LLM 是否从 Character Cards 和 World Book 上下文中提取了静态字段（gender_age/occupation/personality），而不是仅依赖对话文本推断？理想行为是首轮就填入多个字段，而非等到对话中显式提及。 → **PASS**
  - 评估: State LLM 已从上下文中提取了 gender_age、occupation、personality 等静态字段，在 pipeline_responses 的 state_changes 中可见（如江岚的 gender_age='男，青年'、occupation='作家'、personality='冷静、直接、竞争心强、沉默'），并非仅依赖对话文本推断。
- [x] State LLM 的 state_changes 输出是否不包含 affection_delta/current_mood/inner_thoughts？这些字段由 Main LLM 的 NE-CHAR 增量机制管理，State LLM 不应触碰。检查 pipeline_responses 中是否出现了这些字段名。 → **PASS**
  - 评估: 在提供的 pipeline_responses 中，State LLM 的 state_changes 输出仅限于 past_experience、clothing_build、status、relationship 等字段，未出现 affection_delta、current_mood、inner_thoughts。这些情感字段在注入内容末尾的 NE-CHAR 说明中出现，但那是 Main LLM 的输出格式规范，不属于 State LLM 的 state_changes 内容。
- [ ] NE-CHAR 监测日志 [NE-CHAR-MONITOR] 是否正确剥离了所有 NE-CHAR 块（包含 affection_delta 等字段）？剥离数量应与原始标签数一致。 → **FAIL**
  - 评估: 注入内容中未包含 NE-CHAR-MONITOR 日志或任何显示剥离过程的记录，仅存在 NE-CHAR 输出格式的说明（描述 PC 与 NPC 如何输出好感度变化）。无法从现有数据判断 NE-CHAR 块是否被正确剥离以及剥离数量是否与原始标签数一致。数据不足。 (超时截断，按不通过处理)

## 总结
**未通过。** 存在失败的断言，详见上方。

**结束类型**: forced_max_rounds
