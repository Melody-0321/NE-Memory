# LTM `title`+`event` 分离重构计划

## 摘要

将 LTM 条目从单一 `event` 字段拆分为 `title`（DAG 导航标签）和 `event`（内容载体）两个字段，使其结构与其在检索管线中承担的角色匹配。同步修复 LTM 无 `timestamp` 的排序 bug。

---

## 一、动机与背景

### 1.1 问题陈述

当前 LTM 条目的 `event` 字段同时承担三条角色：

| 角色 | 在哪里使用 | 需要 | 现状 |
|------|-----------|------|------|
| ① DAG 弧导航标签 | `threadIndex[label]`（retrieval.js）、目录块（retrieval.js）、`formatFullDump`（vault-panel.js） | **15-40 字**，一目了然 | 80-160 字叙事句 |
| ② 目录可浏览摘要 | 目录块、`buildConsolidatePrompt` 已有 LTM 预览、`formatVaultForPrompt` | **15-40 字**，一眼可扫 | 同上 |
| ③ 内容详情 | `access('ltm_X')`、Vault 面板表格、`contradiction.js` 校验 | **80-120 字**，够判断是否下钻 | 刚好匹配 |

**结论**：80-160 字对导航/目录太长，对内容刚好。只改长度解决不了结构矛盾。

### 1.2 基础数据（全量 inventory）

| 文件 | 读取 `event` | 读取 `title`（新增） | 有 `event\|summary` fallback | 当前 LTM timestamp |
|------|-------------|-------------------|------------------------|-------------------|
| consolidate.js | 9 处 | 0 | 无 | **未设置**（缺失） |
| validate.js | 1 处（必填校验） | 0 | 无 | - |
| retrieval.js | 6 处 | 0 | 3 处 | 读取但不存在 |
| vault-panel.js | >8 处 | 0 | 5 处 | 读取但不存在 |
| tools.js | 3 处 | 0 | 1 处 | - |
| retrieval-filter.js | 2 处 | 0 | 1 处 | 读取但不存在 |
| contradiction.js | 1 处 | 0 | 1 处 | - |
| retrieval-notebook.js | 1 处 | 0 | 0 | - |

### 1.3 设计决策

| 决策 | 结论 | 理由 |
|------|------|------|
| 新增字段名 | `title` | 已有 `summary` 字段被多处作为 `event` fallback 使用，语义冲突。`title` 无冲突 |
| `title` 是否必填 | **是**（LLM prompt 要求） | 向后兼容：无 `title` 时 fallback `event` |
| `event` 长度 | 120-140 字（与 STM 一致） | 让 `event` 成为内容载体而非标签 |
| `title` 长度 | 15-40 字 | 标签级，够 LLM 判断弧内容 |
| `event` 是否保留 | **是** | BM25 索引 + access 使用 |
| `summary` 字段 | **不做改动** | 只读 fallback，不影响 |
| 第三级 DAG (ATM) | **暂不实现** | LTM < 50 条时无收益，超过后再按 story_date 自动分组 |
| Vault 表格用户浏览 | **保留，定位为调试视图** | core 交互是 SmartPush 自动注入，表格是调试/手动修正入口 |

### 1.4 Vault 表格的设计定位

目前 LTM 正从「用户友好目录」向「检索结构节点」演进。这是一条正确的方向——因为 99%+ 的用户交互是通过 SmartPush 自动注入，而非打开 Vault 面板浏览。

Vault 表格的定位调整为 **调试/手动修正视图**：
- 主行显示 `title`（15-40 字）作为可浏览标签
- 行内可展开查看 `event`（120-140 字）+ 子 STM 详情
- 用户仍然可以编辑、删除条目
- 不为「方便浏览」而拉长 `title`

**结论**：保留表格，`title` 为主、`event` 为展开详情。不接受为了用户浏览而让 LTM 长度影响检索效率。

---

## 二、改动清单

### 改动 1：整合 prompt 增加 `title` 字段 + 降低 `event` 长度要求

**文件**：[consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/consolidate.js) L65-101

**目的**：LLM 输出的 JSON schema 增加 `title`，`event` 回退到 120-140 字

**改动内容**：EN/ZH 两个分支的 schema 和 rules 文本。

```
旧 schema:
{
  "stm_refs": ["stm_X", "stm_Y"],
  "event": "abstract summary (max 160 chars)"
}

新 schema:
{
  "stm_refs": ["stm_X", "stm_Y"],
  "title": "scene: concise label (15-40 chars, no pronouns) — e.g. '酒馆: 苏蔓失踪·报警'",
  "event": "a complete sentence describing the arc content (80-140 chars)"
}
```

rules 段补充 `"title" MUST be a short label (15-40 chars), NOT a full sentence.`。

### 改动 2：已有 LTM 预览改用 `title`

**文件**：[consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/consolidate.js) L44-47

**改动**：`buildConsolidatePrompt` 中已有 LTM 格式化：
```javascript
// 旧
'${e.period || ''}: ${e.event || ''}'
// 新
'${e.period || ''}: ${e.title || e.event || ''}'
```

**目的**：LLM 在 LTM 整合时看到 `title` 而非长 event，减少 token 消耗 + 让 LLM 知道它之前写了什么标签。

### 改动 3：整合时给 LTM 设置 `timestamp`

**文件**：[consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/consolidate.js) L267-292，`applyConsolidation` 函数内

**改动**：给每条新 LTM 设置 `timestamp`，取 source STM 中的最大值（最晚时间戳）。
```javascript
var maxTs = 0;
sourceSTM.forEach(function(s) { if (s.timestamp && s.timestamp > maxTs) maxTs = s.timestamp; });
ltm.timestamp = maxTs || Date.now();
```

**目的**：修复实体链排序混乱和 LTM 目录排序。当前 `timestamp` 从未被设置（consolidate.js 内搜索 `timestamp` 零结果），但 retrieval.js 和 retrieval-filter.js 都用它排序。

### 改动 4：LTM 校验增加 `title`

**文件**：[validate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/validate.js) L88-96

**改动**：
- `event` 保持必填（向后兼容）
- `title` 可选校验：`if (entry.title && !String(entry.title).trim()) → warn`，不阻断
- `postFillLTM` 中若无 `title` 且 `event` 存在，取 `event` 前 40 字作为 `title` fallback

### 改动 5：DAG 弧标注改用 `title`

**文件**：[retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/retrieval.js) L315

**改动**：`mergePipelines` 中 threadIndex label：
```javascript
var label = ltm.title || ltm.event || ltm.summary || '';
```

**目的**：DAG 标注 `{G:ltm_1:酒馆·苏蔓失踪报警#3/7}` 在 40 字内完成导航，不需要 LLM 跨块查 ID。

### 改动 6：目录块改用 `title`

**文件**：[retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/retrieval.js) L375-377

**改动**：`buildRetrievalPrompt` 目录块渲染：
```javascript
// 旧: 120 字截断
event: (e.entry.event || e.entry.summary || '').substring(0, 120),
// 新: 60 字截断，title 优先
event: (e.entry.title || e.entry.event || e.entry.summary || '').substring(0, 60),
```

**目的**：目录块从 ~2000 字降到 ~600 字（20 条 × 30 字）。

### 改动 7：Vault 面板 LTM 表格 — title 为主行、event 为展开详情

**文件**：[vault-panel.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/vault-panel.js) L1098

**改动**：`renderMemoryTable` 中 LTM 类型的主表格单元格从单文本改为分层结构：

```javascript
// 旧 (简单替换 event)
'<td>' + (entry.event || entry.summary || '') + '</td>'

// 新 (title 为主行 + event 为可展开副行)
'<td>' +
  '<div style="font-weight:bold;">' + (entry.title || entry.event || entry.summary || '') + '</div>' +
  (entry.title && entry.event && entry.event !== entry.title ? '<div style="font-size:0.85em;color:#999;">' + entry.event.substring(0, 120) + '</div>' : '') +
'</td>'
```

STM type 不变（STM 没有 title）。

### 改动 8：formatVaultForPrompt 改用 `title`

**文件**：[vault-panel.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/vault-panel.js) L1225

**改动**：LTM markdown 表：
```javascript
(e.title || e.event || '')
```

### 改动 9：formatFullDump 改用 `title`

**文件**：[vault-panel.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/vault-panel.js) L1623, L1630-1632

**改动**：LTM section 渲染：
```javascript
(c.title || c.event || c.summary || '')
```

### 改动 10：compileRetrievalBudget 改用 `title`

**文件**：[vault-panel.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/vault-panel.js) L1599

**改动**：summary truncation for LTM：
```javascript
(e.title || e.event || e.summary || '').substring(0, 35)
```

### 改动 11：tools.js access 显示

**文件**：[tools.js](file:///d:/SillyTavern/xm/ne-memory/src/tools.js) L62-66

**改动**：`executeAccess` LTM 显示 title 和 event 两行：
```javascript
if (entry.title) lines.push('Title: ' + entry.title);
if (entry.event) lines.push('Event: ' + entry.event);
```

### 改动 12：contradiction.js 校验显示

**文件**：[contradiction.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/contradiction.js) L140-142

**改动**：
```javascript
var evText = (c.title || c.event || c.summary || '');
```

### 改动 13：retrieval-notebook.js 标题显示

**文件**：[retrieval-notebook.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/retrieval-notebook.js) L232

**改动**：
```javascript
(entry.entry.title || entry.entry.event || '').substring(0, 60)
```

### 改动不涉及的文件

| 文件 | 理由 |
|------|------|
| [retrieval-filter.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/retrieval-filter.js) | BM25 索引只用 `event`（内容字段），不用 `title`。LTM 目录条目继承全部字段，不受影响 |
| [store.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/store.js) | 仅操作 `stm_refs`（rollback），不涉及内容字段 |
| [security-validator.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/security-validator.js) | 对 LTM 条目做安全过滤，不关心具体内容 |
| [stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/stm-extractor.js) | 只生成 STM，不接触 LTM |
| [ambiguity.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/ambiguity.js) | 只读 `entities` 字段 |

---

## 三、向后兼容

新 `title` 字段仅对新生成的 LTM 生效。历史 LTM 无 `title` 时，所有显示/标注位 fallback 到 `event`。

**不需要数据迁移**。新增 `title` 后，`event` 保持写入（长度从 160 降到 120-140）。无 `title` 的历史条目在所有显示位置仍显示 `event`。

---

## 四、验证步骤

1. `npm run build` 通过
2. Process History 执行一次 LTM 整合，检查生成条目的 `title` + `event` 字段
3. Vault 面板 LTM 表：`title` 加粗显示为主行，`event` 灰色副行，无 `title` 的历史条目正常 fallback
4. LTM 展开行：子 STM 详情显示正常
5. SmartPush 触发，检查目录块和 DAG 标注使用 `title`
6. `executeAccess('ltm_X')` 返回 `Title:` + `Event:` 两行
7. 手动触发 contradiction 检测，LTM 候选显示正常

---

## 五、不做的事

| 事项 | 原因 |
|------|------|
| 第三级 DAG (ATM) | LTM < 50 条时无收益。超过后按 story_date 自动分组，不通过 LLM 生成 |
| 删除 Vault LTM 表格 | 保留作为调试/手动修正入口，但定位不再是用户友好的叙事目录 |
| summary 字段整理 | 只读 fallback, 无实际写入路径。改动会影响向后兼容，不必要 |
| 数据迁移 | 历史 LTM 无 title 时自动 fallback，不需要迁移脚本 |
