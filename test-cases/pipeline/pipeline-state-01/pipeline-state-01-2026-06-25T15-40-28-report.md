# State 管线架构验证 — Main LLM NE-CHAR 增量 + State LLM 静态字段 — 测试报告
运行时间: 2026-06-25T15:40:28.935Z
实际轮次: 9
总耗时: 21 分 29 秒

## 断言结果

### 结构性断言
- [x] `exists`: exists: pipeline_changes 不存在 → **PASS**
- [x] `min_length`: min_length: pipeline_changes >=1 → **PASS**
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [ ] State LLM 是否从 Character Cards 和 World Book 上下文中提取了静态字段（gender_age/occupation/personality），而不是仅依赖对话文本推断？理想行为是首轮就填入多个字段，而非等到对话中显式提及。 → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] State LLM 的 state_changes 输出是否不包含 affection_delta/current_mood/inner_thoughts？这些字段由 Main LLM 的 NE-CHAR 增量机制管理，State LLM 不应触碰。检查 pipeline_responses 中是否出现了这些字段名。 → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] NE-CHAR 监测日志 [NE-CHAR-MONITOR] 是否正确剥离了所有 NE-CHAR 块（包含 affection_delta 等字段）？剥离数量应与原始标签数一致。 → **FAIL**
  - 评估: LLM 评估失败，无法判断。

## 总结
**未通过。** 存在失败的断言，详见上方。

**结束类型**: semantic_fail
