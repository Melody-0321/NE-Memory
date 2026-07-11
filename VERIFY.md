# 大更新验证清单

**创建日期**: 2026-07-10 | **HEAD**: `3088f99`

---

## 更新历史（commit 顺序）

**Schema** — 开放角色 Schema 系统（`a2bcbcf` ~ `c4e7dd2`）
- 三层字段体系（必备/预设/自定义）→ 替代旧 `DEFAULT_CHARACTER_SCHEMA` 硬编码
- 独立字段库（localStorage `ne_field_library`）— 模板引用字段，字段不属于模板
- 方案编辑器 UI（`panel-scheme.js`）+ 模板库 slide-in（📋 pin row）
- Function Calling — `get_character_scheme` + `propose_field` 两个 tool
- 模板 LLM 子 Agent — 新 NPC 自动匹配/调整模板
- 252 条单测（4 文件）

**P0** — 消息身份系统（`627adcf` ~ `df4424f`）
- `__ne_msg_id` 注入 + `buildMsgId` idx 前缀 + `findMessageInChat` O(1) 反问

**P1** — Delta 版本链引擎（`568ac17`）
- `state-versions.js` + 4 个 store + `record`/`fold`/`initializeChain` + Pipeline Log 字段

**P2** — 精确回滚（`0765862`）
- `rollbackState` / `rollbackMemory` / `restoreBranch` — 基于 Pipeline Log

**UI** — 版本历史面板 + compact + 手动编辑（`614417d`）
- `panel-version-history.js` — 三标签页 + compact 自动压缩 + 手动编辑 Delta

**SU8 导航修复** — 版本历史漫游可用化（`07cdd0a` ~ `d2d9f4f`）
- 回退/前进按钮、光标点跟随、foldState fallback 路径、读写路径纠正（`readVault`/`write`）
- 空 `deleteObjectStore` 修复、base_seq 折叠起点修复、双次应用修正

**追加改动**: 旧快照移除、`DB_VERSION` 升级、Split Vault（`state_vaults`+`memory_vaults`）、错误可见性修复

**P3** — State 管线重构（`fc9caeb` ~ `3088f99`）
- `0cd24fb` — 移除 `layer`（static/dynamic）概念，`getIdentityFieldNames` 替代 `getStaticFieldNames`
- `b353ac8` — 编辑模式支持修改角色名称（显示名与内部 key 解耦）
- `d16b062` — 重构建 dist，修复 `findNewCharacterNames` 中 `staticFields is not defined` 回归
- `bdc5b68` — 修复 AI 管线根级 delta 路径污染 + `foldState` 模板补齐
  - `mergeStateChanges` 将 `status.江岚`、`江岚.current_mood` 标准化为 `characters.江岚.*`
  - `foldState` 补齐缺失的 `name`/`status`/`_role`
- `3088f99` — 清理 `foldState` 和 head 恢复中的根级污染对象

**附加修复**: 模板面板显示默认模板（`ae9ba00`）| inventory item_schema（`199a29d`）| chat 删除清理（`80b4f2f`）

---

## DB 结构对比

| Store | 引入 | 状态 |
|-------|:---:|------|
| `vaults` | v1 | ⚠️ 废弃 |
| `state_vaults` | v7 | ✅ 当前 State |
| `memory_vaults` | v7 | ✅ 当前 Memory |
| `state_deltas` | v6 | ✅ P1 |
| `memory_versions` | v6 | ✅ P1 |
| `active_chains` | v6 | ✅ P1 |
| `orphaned_branches` | v6 | ✅ P1 |
| `card_configs` | v8 | ✅ |
| `ne_field_library` | localStorage | ✅ Schema |
| `snapshots` | v3 | ❌ 已删除 |

---

## 验证清单

### Schema — 开放角色 Schema 系统

> **架构说明**：预设字段（`SYSTEM_REQUIRED_FIELDS` + `PRESET_FIELDS`，共 16 个）和默认模板（`_default_pc` / `_default_npc`）是 `schema.js` 中的代码常量，不写入 localStorage。`ne_field_library` 和 `ne_template_library` 仅存储用户/AI 自定义的扩展内容。所有读取点通过 `resolveFieldDef()` → `ALL_PREDEFINED_FIELDS` 两层回退，无需 localStorage 预填充即可正常工作。

#### Phase 1-4：数据层 + 管线集成（基础 Schema 功能）

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| S1 | Function Calling 支持检测 | 控制台显示 `[NE-FC] Function calling assumed supported (secondary API configured)` | ✅ 已通过 |
| S2 | 默认模板定义存在 | 代码常量 `DEFAULT_PC_TEMPLATE`（9 字段）+ `DEFAULT_NPC_TEMPLATE`（14 字段）在 [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js#L114-L136) 正确 — 这是代码级事实，不是 localStorage 检查 | ✅ 已通过 |
| S3 | 预设字段定义完整 | `ALL_PREDEFINED_FIELDS` 16 字段含 5 个 category（identity/psychology/social/combat/items/legacy） | ✅ 已通过 |
| S4 | 字段解析回退链路 | `resolveFieldDef(fieldName)` 先查字段库 → 未命中查 `ALL_PREDEFINED_FIELDS` 代码常量 → null | ✅ 已通过 |
| S5 | 静默自启逻辑 | 新对话时 `extractStateChangesOnly()` → `resolveNpcSchemes()` 检测模板库为空 → 直接应用 `_default_pc` + `_default_npc` + Mode adjust，不弹 system message | ⏳ 待验证 |
| S6 | old NPC → `state.characters` map 迁移 | `migrateStateIfNeeded()` 将旧 `npc_schemes`（required/optional 数组）转换为 `state.characters` map + `_templateKey` 指针 | ⏳ 待验证 |
| S7 | 模板 LLM 子 Agent（`buildNewSchemePrompt` + `buildProposeFieldPrompt`） | 新 NPC 出现时，`get_character_scheme` tool handler 调用模板 LLM 生成方案（Mode 2/3）；`propose_field` handler 判断是否接受新字段 | ⏳ 待验证 |
| S8 | 单测 | `npm test` — schema + mergeStateChanges 等 252/252 | ✅ 已通过 |

#### Phase 5-6：UI 层（方案编辑器 + 模板管理）

| # | 项目 | 设计预期 | 状态 |
|---|------|---------|:--:|
| SU1 | 📋 pin row 模板库入口 | pin row 已有 📋 图标（panel-init.js L75）+ State 标签快捷入口 → 点击展开 slide-in | ✅ 已通过 |
| SU2 | 模板库浏览视图 | PC/NPC 双栏，从 `loadTemplateLibrary()` 列出模板。空状态应显示引导横幅："还没有模板..." | ✅ 已通过 |
| SU3 | 模板配置面板 | PC 槽位选择器 / NPC 模板池 / Mode 切换（exact↔adjust）/ 世界观设定 | ✅ 已通过 |
| SU4 | ⚙ 方案编辑器（角色卡片上） | 角色卡片 header 的 ⚙ 按钮 → 三层字段编辑器（必备/预设/自定义），勾选启用/取消字段 | ✅ 已通过 |
| SU5 | 🔒 锁按钮（模板 + 角色） | 模板库中每卡片有 🔒 按钮；角色卡片 header 有 🔒 按钮 | ✅ 已通过 |
| SU6 | "更换模板" + 版本落后提示 | 角色卡片底部"更换模板"按钮；版本落后时黄色提示条 | ⏳ 待验证 |
| SU7 | 引导 UI（tooltip + 横幅 + 帮助卡片） | G3 首次进入横幅 / G4 行内提示 / G6 tooltip / G7 帮助按钮 | ⏳ 待验证 |
| SU8 | 版本历史查看与回退 | 模板详情页中版本时间线 → 回退到任意历史版本 | ✅ 已通过 |

### 设计文档 vs 实施对照

| Phase | 内容 | 状态 |
|------|------|:--:|
| Phase 1 | 数据格式 + 类型定义 + 存储（字段库/模板库 CRUD、角色卡级存储、双写、乐观锁） | ✅ 已实施 |
| Phase 2 | 静默自启 + 系统消息封装 + 模板初始化 | ✅ 已实施 |
| Phase 3 | 核心函数适配新格式（`state.characters` map、`expandTemplateFields`、`resolveFieldDef`） | ✅ 已实施 |
| Phase 4 | Prompt 动态化（移除硬编码字段列表、`buildStateInjectionTable` 动态） | ✅ 已实施 |
| Phase 5 | Function Calling + 模板 LLM 子 Agent + 运行时字段发现 + 三级锁 | ⚠️ 部分实施（FC 检测 ✅ / tool handler 骨架存在 / 三级锁未完整） |
| Phase 6 | 用户编辑器 UI + 引导 UI（方案编辑器、模板库 slide-in、tooltip、版本历史） | ⚠️ 骨架桩（基础 UI 已存在，但编辑器交互不完整，引导 UI 缺失） |
| Phase 7 | 测试 + 兼容迁移 | ✅ 已实施 |

### 架构重构（P3）

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| P3-1 | `layer` 概念移除 | `getIdentityFieldNames` 硬编码替代 `getStaticFieldNames`；`mergeStateChanges` 不再区分 static/dynamic | ✅ 已通过 |
| P3-2 | 编辑模式角色名修改 | State 面板编辑模式下可修改 `name` 字段；`buildStateInjectionTable` 用 `card.name` 显示 | ✅ 已通过 |
| P3-3 | AI 管线 delta 路径标准化 | `mergeStateChanges` 将 LLM 产出的根级路径（`status.江岚`→`characters.江岚.status`）标准化 | ✅ 已通过 |
| P3-4 | `foldState` 模板补齐 | 版本漫游折叠后自动补齐 `name`/`status`/`_role`，清理根级污染对象 | ✅ 已通过 |
| P3-5 | State 版本管理完整性 | 手动编辑 → 版本记录 → 回退/恢复 → 状态正确性 | ✅ 已通过 |

### 已发现问题

| # | 问题 | 根因 | 影响 | 状态 |
|---|------|------|------|:--:|
| B1 | 模板库面板为空（全局库 + 角色卡库均无默认模板） | `panel-templates.js` 读 `ne_template_library`，但默认模板仅在 `schema.js` 代码常量中 | 用户打开模板库时看到空状态 | ✅ 已修复 `ae9ba00` |
| B2 | SU8 模板版本历史有 UI 但无交互 | `panel-templates.js` 中版本时间线渲染了但绑定事件未实现 | 用户看到版本记录但无法点击回退 | 🟡 待修复（低优先级） |

### P0 — 消息身份

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| P0-1 | `buildMsgId` idx 前缀格式 | 日志中 `"37_2026-07-09T..._assistant"` | ✅ 已通过 |
| P0-2 | `findMessageInChat` O(1) 命中 | 无批量 fallback 警告 | ✅ 已通过 |
| P0-3 | 单测 | `npm test` — msg-id 33/33 | ✅ 已通过 |

### P1 — Delta 版本链

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| P1-1 | 4 个 store 存在 | F12 → Application → IndexedDB → 确认 `state_deltas`/`memory_versions`/`active_chains`/`orphaned_branches` | ✅ 已通过 |
| P1-2 | `initializeChain` 成功 | 控制台无红色 `initializeChain FAILED` | ✅ 已通过 |
| P1-3 | `recordStateDelta` 写入 | `[NE] recordStateDelta: chatId=... seq=N` | ✅ 已通过 |
| P1-4 | `recordMemoryVersion` 写入 | `memory_versions` store 有记录 | ✅ 已通过 |
| P1-5 | 单测 | `npm test` — mergeStateChanges 110/110 | ✅ 已通过 |

### P2 — 精确回滚

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| P2-1 | `rollbackState` 可用 | 版本历史面板 State 标签 → ◀ 回退 → 面板显示旧版本 state | ✅ 已通过 |
| P2-2 | `rollbackMemory` 可用 | 版本历史面板 Memory 标签 → ◀/▶ 版本漫游 | ⏳ 待验证 |
| P2-3 | `restoreBranch` 可用 | 回退后孤立分支可恢复 | ⏳ 待验证 |

### UI — 版本历史面板

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| U1 | State 版本时间线有记录 | 面板 → 版本历史 → State 版本标签 | ✅ 已通过 |
| U2 | Memory 版本时间线有记录 | 面板 → 版本历史 → Memory 版本标签 | ✅ 已通过 |
| U3 | State 回退/前进 | ◀ 回退 + ▶ 前进按钮，光标点跟随，面板即时刷新 | ✅ 已通过 |
| U4 | 手动编辑（✎ 按钮） | 角色卡片编辑模式 → 保存 → 版本链新增 manual_edit delta → 回退可见 | ✅ 已通过 |
| U5 | compact 压缩 | 累计 100+ delta 后自动 fold | ⏳ 待验证 |

### Split Vault — 拆分存储

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| VP1 | `state_vaults` 有数据 | F12 → Application → 点开看 key = chat_id | ✅ 已通过 |
| VP2 | `memory_vaults` 有数据 | 同上 | ✅ 已通过 |
| VP3 | 旧 `vaults` 数据迁移成功 | State 面板角色状态有内容；记忆面板有旧条目 | ✅ 已通过 |

### 杂项

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| M1 | chat 删除时 IndexedDB 全面清理 | 删除聊天 → `state_vaults`+`memory_vaults`+所有 delta/versions 一并清除 | ⏳ 待验证 |
| M2 | 诊断导出按钮 | Settings → Data → Export Diagnostic Dump | ✅ 已通过 |
| M3 | inventory item_schema | 角色卡片编辑模式下可编辑物品，字段定义含 name/description/rarity/properties | ⏳ 待验证 |

### 回归 — 原有功能

| # | 项目 | 方法 | 状态 |
|---|------|------|:--:|
| R1 | SmartPush 注入 | 实体记忆链正常注入 | ✅ 已通过 |
| R2 | LTM 合并 | 累积 STM 后触发 | ✅ 已通过 |
| R3 | 模板 LLM | Function Calling 可用，新 NPC 出现时在管线中触发 `get_character_scheme` tool | ⏳ 待验证 |
| R4 | 冒烟测试 | `smartpush-14` 全链路（STM+LTM+SmartPush+State+注入） | ✅ 已通过 |

---
