# LTM 流式整合测试（STM+LTM 合流） — 测试报告
运行时间: 2026-06-17T19:14:17.854Z
实际轮次: 8
总耗时: 5 分 35 秒

## 断言结果

### 结构性断言
- [ ] `exists`: exists: stm_events 不存在 → **FAIL**
  - 详情: 不存在, 期望=true
- [ ] `min_length`: min_length: stm_events >=1 → **FAIL**
  - 详情: 实际长度=0 (要求>=1)
- [ ] `exists`: exists: ltm_decision 不存在 → **FAIL**
  - 详情: 不存在, 期望=true
- [ ] `contains`: contains: pipeline_responses 含 "\\\"ltm_decision\\\"" → **FAIL**
  - 详情: 缺少: \"ltm_decision\"
- [ ] `contains`: contains: pipeline_responses 含 "\\\"updated_title\\\"" → **FAIL**
  - 详情: 缺少: \"updated_title\"
- [ ] `min_length`: min_length: ltm_state >=10 → **FAIL**
  - 详情: 实际长度=0 (要求>=10)
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [ ] LTM 管线是否在 STM 提取的同一次 LLM 调用中正确输出了 ltm_decision（包含 action + updated_title + updated_event）？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] LLM 的闭合决策（append/close_and_new/skip）是否合理，基于对话中的时间/场景/实体变化？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] updated_title 和 updated_event 是否准确反映了当前 LTM 包含的所有 STM 的事件内容（非空壳、非旧标题复制）？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] trace 中是否出现了 1-ref LTM（单条 STM 组成的 LTM）？如出现，是新弧开启还是孤立的未闭合残留？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。
- [ ] 硬上限（15条 STM）自动闭合逻辑是否在代码侧正常工作（从 trace 的 vault stats 观察 open LTM 是否超限）？ → **FAIL**
  - 评估: LLM 评估失败，无法判断。

## 总结
**未通过。** 存在失败的断言，详见上方。

**结束类型**: error
