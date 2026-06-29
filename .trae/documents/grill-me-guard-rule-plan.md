# Grill-Me Guard Rule — 计划文档

## 摘要

在项目根目录创建 `AGENTS.md` 文件，作为项目级规则（Rule），在每轮对话开始时被自动加载。该规则指令 AI 根据任务复杂度三层判断是否需要触发 grill-me：

- **不触发**：任务匹配豁免清单（简单/单文件/纯调研）
- **提醒**：中等以上复杂度，在回复末尾一句话建议用户使用 `/grill-me`
- **直接执行**：用户显式使用触发词（"grill me"/"拷问"/"对齐需求"），自动加载 grill-me skill

## 当前状态分析

### 项目特征
- **NE-Memory Engine**：SillyTavern LLM 记忆管理插件，~50 源文件，三层架构（adapter/core/ui）
- **核心复杂度**：Pipeline 状态机（idle→state→stm→ltm）、BM25+向量混合检索、Schema 驱动状态管理、IndexedDB 快照版本管理
- **风险模块**：`pipeline-guard.js`（并发守卫）、`update.js`（增量编排）、`store.js`（数据持久化）、`schema.js`（Schema 引擎）
- **已有 Skills**：`grill-me`（已安装）、`prompt-engineering`（已安装）
- **开发模式**：独立开发，偶尔与 AI 协作。需求先在对话中澄清再动手

### TRAE Work 的 Rule 机制
- Rule 采用**全量加载**，每轮对话开始时注入上下文
- 项目级 Rule 通过 `AGENTS.md` 文件实现（已在设置中开启）
- 本项目当前无 `AGENTS.md` 文件
- Rule 应极简，避免占用过多上下文 token

### 现有 BUGS.md 记录的教训
24 个已解决的 Bug 中有相当比例源于需求未对齐：
- #6 processed_msg_ids 毒化 — 未考虑消息删除后的去重逻辑
- #7 msg_id=0 去重击穿 — 未考虑 falsy 值的边界情况
- #10 chatId 始终为 'default' — 未提前考虑多聊天实例场景
- 这些如果在实现前经过 grill-me 追问，很可能提前暴露

## 方案设计

### 改动范围
仅创建 1 个新文件，不修改任何现有代码。

### 新建文件

#### `d:\SillyTavern\xm\ne-memory\AGENTS.md`

**文件作用**：作为 TRAE Work 项目级规则，每轮对话自动加载。指示 AI 在写代码前对需求复杂度做三层判断。

**文件内容设计**（按 NE-Memory 项目特征定制）：

```markdown
# AGENTS.md — NE-Memory 项目规则

## Grill-Me 闸门规则

在开始写代码之前，根据任务复杂度判断是否需要 `/grill-me`：

### 第一层：不触发（直接执行）

满足以下**任一**条件时，不触发 grill-me，直接执行：

1. 纯文本修改：翻译字符串 (i18n.js)、注释、错误文案、日志输出
2. 单文件 UI 修改：CSS 微调、HTML 结构调整（panel-*.js / style.css）
3. 确定性修复：已有明确的根因分析 + 修复方案（如 BUGS.md 中已记录）
4. typo / 命名修正 / 单行逻辑修正
5. 纯调研/探索：查阅文档、搜索代码、解释现有逻辑
6. 测试数据更新：test-data.generated.js、测试用例预期值调整
7. 构建/配置调整：package.json、rollup.config.mjs、.gitignore

### 第二层：提醒（建议使用）

满足以下**任一**条件时，在回复末尾加一句提醒（不超过一行）：

> 💡 这个改动涉及 [原因]，建议先用 `/grill-me` 对齐需求再动手？

触发条件：

1. **涉及核心编排器**：修改 `pipeline-guard.js`、`update.js` 中的流程控制逻辑
2. **涉及数据模型**：修改 `store.js`（IndexedDB CRUD）、`schema.js`（Schema 约束）、`versions.js`（快照管理）
3. **涉及检索逻辑**：修改 `retrieval.js`、`retrieval-fusion.js`、`bm25-grouper.js`、`retrieval-filter.js`
4. **涉及 LLM 交互**：新增/修改 prompt 模板、LLM API 调用参数（`llm.js`）
5. **涉及注入/事件**：修改 `injection.js`、`events.js` 中的事件绑定
6. **涉及矛盾/模糊逻辑**：修改 `contradiction.js`、`ambiguity.js`
7. **跨模块改动**：同时涉及 2+ 个 `src/core/engine/` 文件
8. **新增架构元素**：新建模块文件、新增 Vault 字段类型
9. **需求本身模糊**：用户描述中不含明确的输入/输出、边界条件、或改动范围

### 第三层：直接执行（自动加载 skill）

当用户消息包含以下**任一**显式触发词时，自动加载 grill-me skill 并进入追问模式：

- "grill me" / "grill-me" / "/grill-me"
- "拷问我" / "拷问" / "追问"
- "帮我理清思路" / "对齐需求" / "先对齐"

自动加载时不需要再次询问用户。

## Meta-Rule：自维护

当你（AI）在本项目中**创建新的源文件**时，必须同时更新本文档，将新文件纳入对应层级。

**判断准则**：

| 新文件位置 | 风险 | 加入层级 |
|-----------|------|---------|
| `src/core/engine/` — 影响 pipeline 流程、检索、注入、数据流 | 🔴 | 第二层提醒 + 风险表 |
| `src/core/vault/` — 影响存储结构、Schema、快照 | 🔴 | 第二层提醒 + 风险表 |
| `src/core/engine/` — 支持功能（遥测、统计、文本工具） | 🟡 | 仅风险表 |
| `src/core/` 根模块 — 轻量模块 | 🟡 | 仅风险表 |
| `src/adapter/` — 事件绑定、引导逻辑 | 🟡 | 第二层提醒 + 风险表 |
| `src/adapter/` — 纯 UI (panel-*.js) | 🟢 | 豁免清单 |
| `src/ui/` | 🟢 | 豁免清单 |
| `test/` 单元测试 | 🟢 | 豁免清单 |
| `test-cases/` 集成测试 | 🟢 | 豁免清单 |

更新后简要告知用户新增了哪个文件、归入哪一层。

## 项目上下文

- 项目名称：NE Memory Engine
- 项目定位：SillyTavern 长对话结构化记忆管理引擎
- 代码 Wiki：CODE_WIKI.md（~1470 行）
- 技术栈：JavaScript ES Modules → Rollup IIFE 构建
- 核心模块风险分级：
  - 🔴 高风险：pipeline-guard, update, store, schema, injection, retrieval
  - 🟡 中风险：state-pipeline, stm-pipeline, ltm-pipeline, consolidate, embedding, worldbook-sync
  - 🟢 低风险：panel-*.js, i18n.js, style.css, test-data, token-stats, telemetry
```

### 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 规则放置位置 | `AGENTS.md`（项目根目录） | 项目级生效，可跨 IDE 复用，符合 TRAE Work 规范 |
| 触发积极性 | 平衡型 | 在 NE-Memory 这种多模块耦合项目中，宁可提醒多一次，不要漏掉关键对齐 |
| 提醒 vs 执行区分 | 提醒为默认；仅用户显式触发词时自动执行 | grill-me "一次一问"的协议天然需要用户心理准备，单方面启动体验差 |
| 豁免清单 | 包含明确豁免 | 减少误触发，避免简单任务被打断 |
| 风险分级 | 基于 CODE_WIKI.md 模块职责定制 | 用具体文件路径定义风险，比抽象描述更可操作 |

### 为什么采用具体文件路径而非抽象描述

AGENTS.md 中列出的模块路径（如 `pipeline-guard.js`、`store.js`）直接来自 `CODE_WIKI.md` 中的模块列表。这比"涉及核心模块"这样的抽象描述更精确——AI 在判断时可以直接匹配"我即将修改的文件是否在这个列表里"，减少模糊判断。

### Token 开销评估

AGENTS.md 全文约 ~50 行、~1,800 字符、~500 tokens。在每轮对话中占用的上下文窗口微乎其微（通常上下文窗口在 8K-128K 范围），远低于 grill-me skill 按需加载后的几百行追问内容。

## 验证步骤

1. 确认 `AGENTS.md` 文件存在于 `d:\SillyTavern\xm\ne-memory\AGENTS.md`
2. 确认 TRAE Work 设置中「将 AGENTS.md 包含在上下文中」已开启
3. 功能验证（分三次对话测试）：

| 测试场景 | 用户输入 | 期望 AI 行为 |
|----------|---------|-------------|
| 豁免清单 | "把 i18n.js 里的 '记忆引擎' 改成 '记忆引擎 Pro'" | 直接执行，不提醒 |
| 核心模块改动 | "在 retrieval.js 里加一个按时间衰减的排序逻辑" | 提醒 grill-me |
| 显式触发 | "拷问我：我想给 LTM 加一个合并策略" | 自动加载 grill-me |

4. 在实际开发中观察：AI 是否在恰当的场景提醒、是否有误触发或漏触发，根据观察迭代 AGENTS.md 内容

### AGENTS.md 自维护机制

当 AI 在项目中**创建新的源文件**时，应同时更新 AGENTS.md，将新文件纳入对应风险层级。

**自动判断新文件风险等级的准则**：

| 新文件位置 | 风险等级 | 加入层级 |
|-----------|---------|---------|
| `src/core/engine/` 下，影响 pipeline 流程控制、数据流、检索、注入 | 🔴 高风险 | 第二层提醒 + 风险分级表 |
| `src/core/vault/` 下，影响存储结构、Schema、快照 | 🔴 高风险 | 第二层提醒 + 风险分级表 |
| `src/core/engine/` 下，支持性功能（遥测、统计、文本工具） | 🟡 中风险 | 风险分级表 |
| `src/core/` 根模块，非 runtime/settings/params 的轻量模块 | 🟡 中风险 | 风险分级表 |
| `src/adapter/` 下，事件绑定或引导逻辑 | 🟡 中风险 | 第二层提醒 + 风险分级表 |
| `src/adapter/` 下，纯 UI (panel-*.js) | 🟢 低风险 | 豁免清单（如涉及复杂状态逻辑则入第二层） |
| `src/ui/` 下 | 🟢 低风险 | 豁免清单 |
| `test/` 下（单元测试） | 🟢 低风险 | 豁免清单 |
| `test-cases/` 下（集成测试用例） | 🟢 低风险 | 豁免清单 |

**更新规则**：
- 如果新文件属于 🔴 高风险，必须在第二层「提醒」触发条件中添加对应条目
- 如果新文件属于 🟡 中风险，仅添加到风险分级表即可（除非它像 event.js 一样直接影响流水线触发）
- 如果新文件属于 🟢 低风险，添加到豁免清单（或风险分级表 🟢 层）
- 更新后简要告知用户：新增了哪个文件、被归入哪一层

**自维护指令将在 AGENTS.md 中以 Meta-Rule 形式嵌入。**

## 讨论未决项

以下问题由用户决定是否纳入当前范围：

- **是否添加「强制模式」**：用户可以用 `/grill-me force` 要求 AI 即使匹配豁免清单也要追问？
- **是否与 prompt-engineering skill 联动**：当 grill-me 提醒涉及 prompt 修改时，是否同时建议使用 prompt-engineering skill？

## 执行步骤

1. 在 `d:\SillyTavern\xm\ne-memory\AGENTS.md` 创建文件，写入完整内容（含自维护 Meta-Rule）
2. 无需修改任何现有文件
3. 无需运行构建或测试（规则文件不影响运行时行为）
