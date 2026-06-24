# State 管线集成测试（PC/NPC 字段分离 + protagonist_name） — 测试报告
运行时间: 2026-06-24T11:58:11.992Z
实际轮次: 10
总耗时: 8 分 0 秒

## 断言结果

### 结构性断言
- [x] `exists`: exists: pipeline_changes 不存在 → **PASS**
- [x] `min_length`: min_length: pipeline_changes >=1 → **PASS**
- [x] `not_contains`: not_contains: pipeline_changes 不含 "error" → **PASS**
- [x] `exists`: exists: stm_events 不存在 → **PASS**
- [x] `not_contains`: not_contains: pipeline_responses 不含 "undefined" → **PASS**

### 语义性断言
- [x] State 管线是否提取了对话中出现的角色的状态变化（入场/离场/状态改变）？ → **PASS**
  - 评估: 对话中角色的状态变化被完整捕捉。安然的 current_mood 从'挑衅中带着一丝认可'变为'兴奋，期待赌约'再到'放松，等待'，inner_thoughts 也随对话推进而更新。江岚的 current_mood 和 inner_thoughts 同样被提取（'被挑衅后略感意外，但似乎并不生气'→'被挑衅，考虑是否接招'→'认真，准备改文'），状态变化链条完整。
- [x] 提取的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection 等），而非 LLM 自创的字段名？ → **PASS**
  - 评估: 所有 state_changes 均使用系统预定义字段路径。使用到的字段包括：current_mood、inner_thoughts、affection、past_experience，均在系统规定的字段范围内，未见 LLM 自创的字段名。affection 使用数值增量（+5、+3），格式规范。
- [x] state_changes 的 value 是否与对话中实际发生的情况一致（无编造）？对无法推断的字段是否留空而不是编造？ → **PASS**
  - 评估: state_changes 的值与对话实际行为一致。安然从质疑江岚写作能力到认可其设定（inner_thoughts: '这家伙虽然写得慢，但设定确实有点意思，值得借鉴'），江岚从淡漠到被激起竞争心（inner_thoughts: '这丫头嘴皮子厉害，但眼光确实毒辣'），均能在对话中找到对应台词。无编造内容。对于对话中未体现的字段（如 gender_age、occupation 等）均未输出，符合留空要求。

## 总结
**通过。** 所有断言通过。

**结束类型**: forced_max_rounds
