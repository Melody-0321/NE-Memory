# State 管线集成测试 — 测试报告
运行时间: 2026-06-21T19:52:16.968Z
实际轮次: 9
总耗时: 5 分 5 秒

## 断言结果

### 结构性断言
- [ ] `exists`: exists: pipeline_changes 不存在 → **FAIL**
  - 详情: 不存在, 期望=true
- [ ] `min_length`: min_length: pipeline_changes >=1 → **FAIL**
  - 详情: 实际长度=0 (要求>=1)
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [ ] State 管线是否提取了对话中出现的角色的状态变化（入场/离场/状态改变）？ → **FAIL**
  - 评估: 本轮注入内容仅包含 Event Log 和 Consolidated Memories，未提供任何 State 管线的输出或状态变化提取结果，无法判断是否提取了角色的状态变化。
- [ ] 提取的 state_changes 是否包含时间、场景、npc_names 等必填字段？ → **FAIL**
  - 评估: 注入内容中未包含 state_changes 字段或相关状态数据，无法评估其必填字段的完整性。
- [ ] state_changes 的 value 是否与对话中实际发生的情况一致（无编造）？ → **FAIL**
  - 评估: 由于注入内容中不存在 state_changes 数据，无法将其与对话实际发生情况进行比对，以此判断是否一致。

## 总结
**未通过。** 存在失败的断言，详见上方。

**结束类型**: semantic_fail
