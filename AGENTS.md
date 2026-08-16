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
10. **涉及 engine 或 vault 模块**：自动读取对应目录下的 `.rules.md` 获取模块级约束

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
| `src/core/vault/` - 影响存储结构、Schema、快照 | 🔴 | 第二层提醒 + 风险表 |
| `src/core/vault/template-defs.js` - 纯数据常量（默认模板定义） | 🟡 | 仅风险表 |
| `src/core/engine/` - 支持功能（遥测、统计、文本工具） | 🟡 | 仅风险表 |
| `src/core/` 根模块 — 轻量模块 | 🟡 | 仅风险表 |
| `src/adapter/` — 事件绑定、引导逻辑 | 🟡 | 第二层提醒 + 风险表 |
| `src/adapter/` — 纯 UI (panel-*.js) | 🟢 | 豁免清单 |
| `src/ui/` | 🟢 | 豁免清单 |
| `test/` 单元测试 | 🟢 | 豁免清单 |
| `test-cases/` 集成测试 | 🟢 | 豁免清单 |
| `.trae/documents/` | 🟢 | 豁免清单 |
| `.github/` | 🟢 | 豁免清单 |
| `docs/adr/` — 架构决策记录 | 🟢 | 豁免清单 |
| `src/core/engine/.rules.md` | 🟢 | 纯规则文档 |
| `src/core/vault/.rules.md` | 🟢 | 纯规则文档 |

更新后简要告知用户新增了哪个文件、归入哪一层。

## Plan-Rule：计划文档追踪

当你执行 `.trae/documents/` 中的计划文档时，**必须在编辑该文件时同步更新其 YAML frontmatter**：

```yaml
---
status: in_progress  # 或 completed / not_started / abandoned
created: 2026-06-10
updated: 2026-07-09
---
```

### 何时更新

| 时机 | 操作 |
|------|------|
| **开始执行计划** | 将 `status` 改为 `in_progress`，更新 `updated` |
| **计划全部完成** | 将 `status` 改为 `completed`，更新 `updated` |
| **创建新计划文档** | 必须带完整 frontmatter（status + created + updated） |
| **计划被废弃** | 将 `status` 改为 `abandoned`，更新 `updated` |

### 不需要手动维护

- `INDEX.md` 由 `npm run build:doc-index` 脚本自动从 frontmatter 生成，挂载在 `.githooks/pre-commit` 中。**不要手动编辑 INDEX.md。**
- 查看所有计划的状态汇总：打开项目根目录下的 `PLAN_INDEX.md`。

## Fix-Rule：修复追踪

修复 `算法优化分析报告.md`（审计产出）或用户反馈的任何缺陷后，**必须同步更新以下文档**，且每次修复都如此：

1. `BUGS.md`（**根因唯一真源**）：新增编号条目，写全 影响 / 根因 / 修复 / commit。
   - 已发版版本用 `vX.Y-N`；未发版（Unreleased）用 `vNext-N`（在 vNext 段追加）。
2. `CHANGELOG.md` 顶部 **Unreleased 块**：追加一条**一句话用户可见摘要**（现象 → 修复方式），末尾标注 BUGS.md 编号（如 `vNext-3`）。不重复写根因。
3. `算法优化分析报告.md` 的**修复状态追踪表**（"〇"节）：状态改为 ✅ 已修复，**引用 BUGS.md 编号**（如 `→ BUGS.md vNext-3`），不再重复写完整修复方式。

规则细则：

- 报告表中不存在对应条目时，在表中新增一行（引用编号）
- 发版时（release-rules.md 流程）：BUGS.md 的 `vNext-N` 条目随发版批量改为 `vX.Y-N`；CHANGELOG Unreleased 块随版本号升级为正式版本块
- 纯 UI/交互修复同样走上述三处流程
- 根因分析**只写在 BUGS.md**，CHANGELOG / 审计表只做摘要 + 引用，避免多源真相

## Commit Message 规范

提交消息必须遵循 conventional commit 格式，类型白名单如下：

```
feat fix perf refactor docs test build ci chore style revert
release dev-build    # 发版流程专用（release-rules Step 4 / Step 6）
```

- 禁止使用 `test+fix`、`fix+feat`、`debug` 等非标前缀——复合改动应拆成独立提交
- `--no-verify` 仅限发版提交（release-rules Step 4 / Step 6），普通提交不得绕过
- 本地 `commit-msg` 钩子 + CI 双门禁拦截，未通过时提交会被拒绝

## 项目上下文

- 项目名称：NE Memory Engine
- 项目定位：SillyTavern 长对话结构化记忆管理引擎
- 代码 Wiki：CODE_WIKI.md（~1470 行）
- 技术栈：JavaScript ES Modules → Rollup IIFE 构建
- 核心模块风险分级：
  - 🔴 高风险：pipeline-guard, update, store, schema, injection, retrieval
  - 🟡 中风险：state-pipeline, stm-pipeline, ltm-pipeline, consolidate, embedding, template-defs, adaptive-context（自适应上下文裁剪，影响注入策略）
  - 🟢 低风险：panel-*.js, i18n.js, style.css, test-data, token-stats, telemetry
