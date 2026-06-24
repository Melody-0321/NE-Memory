# State Pipeline 测试用例更新

## 摘要

架构变更（Plan A+B）后，5 个 state pipeline 测试用例中 3 个需要实质性更新、1 个废弃、1 个保留。

## 变更对照

| 测试 | 状态 | 说明 |
|------|------|------|
| pipeline-state-01 | **重写** | PC/NPC 字段分离 → Main LLM NE-CHAR delta + State LLM 静态字段职责分离 |
| pipeline-state-02 | **微调** | BANNER 格式验证本身不变，断言需适配最新 banner 指令 |
| pipeline-state-03 | **重写** | (未填)+禁止编造 → Character Cards 优先提取 + World Book 参考 |
| pipeline-state-04 | **废弃** | ne_context_memory 已被删除 |
| pipeline-state-05 | **保留** | autoDecayStaleCharacters 机制未变 |

---

## pipeline-state-01: 重写

### 修改前
- 验证 PC/NPC 字段分离（PC 无 affection/relationship/inner_thoughts/current_mood）
- protagonist_name 从 ctx.name1 推断
- semantic: "PC 的状态变更中是否不包含 NPC 专属字段？"

### 修改后
验证新架构下三类职责分工正常运转：

1. **Main LLM NE-CHAR**：每轮输出活跃角色的 affection_delta/current_mood/inner_thoughts
2. **State LLM**：管理 gender_age/occupation/personality/clothing_build/status 等静态字段，不输出 affection/current_mood/inner_thoughts
3. **信息源**：State LLM 从 Character Cards + World Book（有未填字段时）提取初始值

结构性断言：
- `exists: pipeline_changes` — State 管线执行过
- `not_contains: pipeline_changes [error]` — 无报错
- `not_contains: pipeline_responses ["affection"]` — State LLM 不输出 affection（由 Main LLM NE-CHAR 管理）
- `not_contains: pipeline_responses ["current_mood"]` — State LLM 不输出 current_mood
- `not_contains: pipeline_responses ["inner_thoughts"]` — State LLM 不输出 inner_thoughts
- `exists: state_block_instruction` — NE-CHAR 指令已注入
- `contains: state_block_instruction ["affection_delta"]` — 指令包含增量格式

语义性断言：
1. State LLM 是否从 Character Cards 中提取了静态字段（gender_age/occupation/personality），而非仅依赖对话推断？
2. State LLM 的 state_changes 是否不包含 affection/current_mood/inner_thoughts（这些由 Main LLM 的 NE-CHAR 管理）？
3. NE-CHAR 监测日志是否记录了每轮有变化时的增量合并？

---

## pipeline-state-02: 微调

BANNER 格式未变。断言内容需验证 banner 指令的最新格式。

结构性断言更新：
- 原 `contains: 场景|` → 保留（当前指令仍含此文本）
- 原 `contains: 天数只写数字` → 保留
- 其他断言保留

---

## pipeline-state-03: 重写

### 修改前
- 验证 per-field (未填) 标记
- 验证 required/optional 分层规则
- 验证 LLM 对无法推断的字段留空（禁止编造）

### 修改后
验证新规则：State LLM 从 Character Cards + World Book 上下文主动提取字段。

结构性断言：
- `exists: pipeline_changes` — State 管线执行过
- `not_contains: pipeline_changes [error]` — 无报错
- `contains: pipeline_changes ["characters."]` — state_changes 包含角色字段
- `exists: state_block_instruction` — 指令已注入
- `contains: state_block_instruction ["Character Cards"]` — 指令引用了角色卡

语义性断言：
1. State LLM 是否在首轮就主动从 Character Cards 中提取了静态字段，而不是等对话提及？
2. 新角色字段是否正确使用了系统预定义的路径（无 LLM 自创字段名）？
3. State LLM 是否正确遵守了职责边界：不输出 affection/current_mood/inner_thoughts？

---

## pipeline-state-04: 废弃

`ne_context_memory` 注入已被删除（commit `f5eb1ab`）。
`context_memory` 监控目标将始终为空。

**处理**：将 test-case.md 改为注释说明已废弃，或在 generate-test-data.cjs 中过滤。

---

## pipeline-state-05: 保留

autoDecayStaleCharacters 机制未变。无需修改。

---

## 实施步骤

1. 重写 pipeline-state-01/test-case.md
2. 重写 pipeline-state-03/test-case.md
3. 微调 pipeline-state-02/test-case.md
4. 标记 pipeline-state-04 为废弃（删除 frontmatter 但保留文件说明）
5. `npm run build` 验证
