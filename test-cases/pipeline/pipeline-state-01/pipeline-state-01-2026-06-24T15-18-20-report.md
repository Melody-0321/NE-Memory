# State 管线集成测试（PC/NPC 字段分离 + protagonist_name） — 测试报告
运行时间: 2026-06-24T15:18:20.029Z
实际轮次: 10
总耗时: 13 分 45 秒

## 断言结果

### 结构性断言
- [x] `exists`: exists: pipeline_changes 不存在 → **PASS**
- [x] `min_length`: min_length: pipeline_changes >=1 → **PASS**
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [ ] State 管线是否提取了对话中出现的角色的状态变化（入场/离场/状态改变）？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。 (超时截断，按不通过处理)
- [ ] 提取的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection 等），而非 LLM 自创的字段名？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。 (超时截断，按不通过处理)
- [ ] state_changes 的 value 是否与对话中实际发生的情况一致（无编造）？对无法推断的字段是否留空而不是编造？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。 (超时截断，按不通过处理)
- [ ] 主角（PC）的状态变更中是否不包含 affection/relationship/inner_thoughts/current_mood 等 NPC 专属字段？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。 (超时截断，按不通过处理)
- [ ] NPC 的状态变更中是否正确包含了 affection/relationship/current_mood 等 NPC 专属字段？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。 (超时截断，按不通过处理)

## 总结
**未通过。** 存在失败的断言，详见上方。

**结束类型**: forced_max_rounds
