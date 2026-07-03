# CODE_WIKI v6.0 更新计划

## 摘要

根据 `ce0fc40`（删除检索 LLM 合成）和 `11fab08`（v5.6 架构重构）两个核心 commit 的代码变更，将 CODE_WIKI.md 中所有过时的架构描述更新为 v6.0 实际状态。核心修正：SmartPush 检索不再有任何 LLM 参与——是纯本地检索 + 代码格式化注入。

## 发现的所有需要修正的位置

### ① 功能列表 (L47-L49) — 副 API 渠道 + SmartPush 描述

**当前错误**:
- "SmartPush 检索"被列入副 API 渠道
- SmartPush 描述为 "LLM 输出结构化 KB 标注"

**修正**: 
- 副 API 渠道：仅 Pipeline + Embedding 两类（删除 "SmartPush 检索"）
- SmartPush：纯本地 BM25 + 向量 RRF → 实体链分组 → 代码格式化注入

### ② 功能列表 (L44) — 工具数量

**当前**: "5 个注册工具"
**修正**: "2 个注册工具（`access` + `recall_memory`）"

### ③ 架构图 (L94) — callMemoryRetrievalWithTools

**当前**: 架构图中列出 `callMemoryRetrievalWithTools`
**修正**: 该函数已由 `ce0fc40` 删除，从架构图中移除

### ④ 架构图 (L110) — context-window.js

**当前**: 架构图中列出 `context-window.js`
**修正**: 该文件已由 `11fab08` 删除，从架构图中移除

### ⑤ events.js 描述 (L208) — onBeforeGenerate

**当前**: "SmartPush 智能记忆注入**或 context-window 记忆格式化**"
**修正**: context-window 注入已删除，只剩 SmartPush + 对话轮数截断

### ⑥ llm.js 描述 (L289, L297-L298)

**当前**: 
- "检索 API（SmartPush）分离"
- `callMemoryRetrieval` — "检索专用调用（Smart Push / recall_memory）"
- `callMemoryRetrievalWithTools` — 存在

**修正**:
- `callMemoryRetrieval` — 仅为 `recall_memory` 工具使用，不参与 SmartPush
- `callMemoryRetrievalWithTools` — 已删除，移除条目

### ⑦ injection.js 描述 (L418-L459) — 核心重写

**当前错误**: 整个 3.4.9 节描述了包含 LLM 的流程：
- `formatSmartContext` 说是 "LLM 输出 KB 标注"
- 提到 `parseEntityAnnotations`（已删除）
- 提到 `buildMemoryUsageGuide`（已删除）
- 描述 10-12 步全部涉及 LLM prompt + KB 标注解析
- "关键设计变更" 描述 LLM 结构化标注

**修正**: 重写为：
- `formatSmartContext`：纯本地计算 → BM25 → RRF → 实体链 → `buildEntityBlock` 代码组装
- 移除 `parseEntityAnnotations`、`buildRetrievalMessages`、`buildRetrievalPrompt` 引用
- 步骤简化：检索 → 分组 → 代码格式化注入

### ⑧ retrieval.js 描述 (L461-L476) — 删除 LLM 函数

**当前**: 列出 `buildRetrievalPrompt`、`buildRetrievalMessages`
**修正**: 这两个检索 LLM prompt 函数已由 `ce0fc40` 删除，从表中移除

### ⑨ 上下文窗口删除 (L501-L530) — 整节删除

**当前**: `3.4.13 context-window.js` 完整描述
**修正**: 该文件已由 `11fab08` 删除。若仍有测试文件 `test/context-window.test.js`，确认其依赖的源码是否仍存在；若源文件已删除则整节移除

### ⑩ SmartPush 注入流程图 (L879-L917) — 完全重写

**当前**: 图中包含 `LLM → callMemoryRetrievalWithTools(access)`、KB 标注输出、缺口检测
**修正**: 移除 LLM 步骤，改为：

```
formatSmartContext()
  ├─ 构建查询
  ├─ BM25 检索 → filterCandidates() top-40
  │     └─ 可选: 向量搜索 + RRF 融合
  ├─ 实体链查询 → lookupEntityChains()
  ├─ 管道合并 → mergePipelines()
  ├─ 按实体分组 → groupCandidatesByEntity()
  ├─ buildEntityBlock() → 代码组装实体记忆链
  └─ 组装最终注入文本
```

### ⑪ Tool-calling 检索路径 (L934-L939) — 修正

**当前**: `recall_memory` 流程中说 "LLM callMemoryRetrieval: 合成叙事回答"
**修正**: `recall_memory` 确实用 `callMemoryRetrieval` 让 LLM 合成回答，但这是工具单独的功能，不是 SmartPush 的一部分。描述本身不错误但需要加注"仅 recall_memory 工具使用，SmartPush 注入不使用 LLM"

### ⑫ 模块依赖图 (L1223) — 移除 context-window.js

**当前**: 依赖图中含 `engine/context-window.js`
**修正**: 移除

### ⑬ CDN 导入模板 (L1294-L1303) — 更新

**当前**: 使用 `import()` 语法 + 硬编码 `@8b2af34`
**修正**: 改为 `<script>` 标签 + gcore/jsDelivr 双通道（参考 `test6.0.json`）+ 更新版本标记

### ⑭ 版本标签 (L7, L1477)

**当前**: "v5.6 重构后"、"基于 ne-memory v4c04a31"
**修正**: "v6.0 Pipeline 架构"、"基于 v6.0.0"

### ⑮ settings.js 描述 (L781)

**当前**: 列出 `isRetrievalEnabled()` / `setRetrievalEnabled()`
**修正**: Enable Smart Retrieval 开关已移除（功能始终启用），删除相关函数描述

### ⑯ 版本历史末尾 (L1474+)

需新增 v5.6 → v6.0 的变更摘要条目

## 执行步骤

1. 更新版本标签 (L7, L1477)
2. 修正功能列表 (L44-L49)：工具数、副 API 说明、SmartPush 描述
3. 修正架构图 (L94, L110)：移除 callMemoryRetrievalWithTools 和 context-window.js
4. 修正 events.js (L208)：移除 context-window 记忆格式化
5. 修正 llm.js (L289, L297-298)：更新 callMemoryRetrieval 职责说明，移除 callMemoryRetrievalWithTools
6. 重写 injection.js 节 (L418-L459)：去除所有 LLM 相关的步骤和函数描述
7. 清理 retrieval.js 节 (L461-L476)：移除 buildRetrievalPrompt/buildRetrievalMessages
8. 删除/标记 context-window.js 节 (L501-L530)
9. 重写 SmartPush 注入流程图 (L879-L917)
10. 修正 recall_memory 注释 (L934-L939)
11. 更新模块依赖图 (L1223)
12. 更新 CDN 模板 (L1294-L1303)
13. 清理 settings.js (L781)：移除 isRetrievalEnabled
14. 新增 v5.6 → v6.0 变更记录

## 验证方式

- 搜索 CODE_WIKI.md 中所有 `callMemoryRetrieval` 引用，确认只在正确语境（`recall_memory` 工具）出现
- 搜索 `LLM` + `检索` / `SmartPush` 共现，确认无错误的 LLM 参与描述
- 搜索 `context-window`，确认移除/标记
- 搜索 `buildRetrievalPrompt` / `buildRetrievalMessages`，确认不在 injection.js 上下文中描述
