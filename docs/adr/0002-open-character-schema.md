# Open Character Schema

- 状态：已接受（v7.0 落地）
- 日期：2026-06-10（开放角色 Schema 改造计划启动）

## 背景（Context）

早期角色状态被硬编码为固定 Schema（`DEFAULT_CHARACTER_SCHEMA`，约 5 个 identity 字段）。问题：

- **不可扩展**：LLM 只能修改已知字段，任何新维度（能力、物品、派系、任务）都要改代码 + 发版。
- **Schema 与模板耦合**：字段定义写死在代码里，用户/社区无法自定义或按角色配置。
- **字段覆盖不足**：竞品可表达的能力描述、即时着装等维度缺失，限制角色扮演深度。

## 决策（Decision）

将角色 Schema 开放为"三层字段 + 独立库 + AI 字段发现"体系（`src/core/vault/schema.js`）：

- **三层字段**：必备（`SYSTEM_REQUIRED_FIELDS`，如 name/status）+ 预设（`PRESET_FIELDS`，按 identity/psychology/social/battle/ability/inventory/faction 分类）+ 自定义（用户/AI 定义）。
- **字段不属于模板**：独立字段库 `ne_field_library`（localStorage），模板只引用字段；`resolveFieldDef()` 两层回退（字段库 → `ALL_PREDEFINED_FIELDS` 代码常量），无需预填充即可工作。
- **模板库** `ne_template_library`：`_default_pc`/`_default_npc` 等方案模板，按角色应用。
- **Function Calling 字段发现**：`get_character_scheme`（新 NPC 自动匹配/调整模板）+ `propose_field`（AI 提议新字段）两个 tool。
- **模板 LLM 子 Agent**：新 NPC 出现时自动生成/调整方案，经独立 `ne_template_api` 通道。

## 后果（Consequences）

**正面**

- 可扩展性：新字段维度无需发版，用户/LLM 可自定义（abilities/power_level/current_outfit 等已扩展）。
- 动态 Prompt：注入表格按角色实际 Schema 动态构建，不再硬编码字段列表。
- 覆盖竞品能力维度，提升角色扮演深度与差异化。

**负面**

- 校验复杂度上升：`item_schema` 容器子结构步进、object 类型校验、required 空值拦截都需覆盖（P1-7 补齐缺口）。
- 旧数据迁移：已有角色需按新三层模型补齐/映射（`migrateStateIfNeeded`）。
- 原型链污染防护（`__proto__`/`constructor` 保留键拦截）成为必须的安全约束。

**关联**

- 配套计划：`.trae/documents/open-character-schema-data-model.md` / `-runtime.md` / `-ui-plan.md`
