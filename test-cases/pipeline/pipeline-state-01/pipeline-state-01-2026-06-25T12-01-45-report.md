# State 管线架构验证 — Main LLM NE-CHAR 增量 + State LLM 静态字段 — 测试报告
运行时间: 2026-06-25T12:01:45.298Z
实际轮次: 10
总耗时: 16 分 18 秒

## 断言结果

### 结构性断言
- [x] `exists`: exists: pipeline_changes 不存在 → **PASS**
- [x] `min_length`: min_length: pipeline_changes >=1 → **PASS**
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [x] State LLM 是否从 Character Cards 和 World Book 上下文中提取了静态字段（gender_age/occupation/personality），而不是仅依赖对话文本推断？理想行为是首轮就填入多个字段，而非等到对话中显式提及。 → **PASS**
  - 评估: State LLM在首轮就提取了gender_age/occupation/personality等静态字段，并非仅依赖对话显式提及，符合从角色预设文件提取的预期行为。
- [x] State LLM 的 state_changes 输出是否不包含 affection_delta/current_mood/inner_thoughts？这些字段由 Main LLM 的 NE-CHAR 增量机制管理，State LLM 不应触碰。检查 pipeline_responses 中是否出现了这些字段名。 → **PASS**
  - 评估: 所有state_changes输出中均未出现affection_delta/current_mood/inner_thoughts字段，State LLM遵守了职责分离规则。
- [x] NE-CHAR 监测日志 [NE-CHAR-MONITOR] 是否正确剥离了所有 NE-CHAR 块（包含 affection_delta 等字段）？剥离数量应与原始标签数一致。 → **PASS**
  - 评估: 注入内容中NE-CHAR块数量与监测日志中的剥离数量一致（均为2个），剥离机制正确执行。

## 总结
**通过。** 所有断言通过。

**结束类型**: forced_max_rounds
