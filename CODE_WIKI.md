# NE Memory Engine — Code Wiki

> **SillyTavern 长对话结构化记忆管理引擎**
>
> 版本：v6.8.0 | 语言：JavaScript (ES Modules) | 许可证：AGPL-3.0
> 入口：`src/adapter/index.js` | 构建输出：`dist/index.js` (IIFE, 全局名 `NEMemoryEngine`)
> 最后更新：2026-07-07（v6.8 角色卡删除 · 消息崩溃修复 · max_tokens 提升）

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [模块职责详解](#3-模块职责详解)
   - [3.1 adapter/ — SillyTavern 适配层](#31-adapter---sillytavern-适配层)
   - [3.2 core/runtime.js — 抽象运行时](#32-coreruntimejs--抽象运行时)
   - [3.3 core/api/ — LLM API 抽象层](#33-coreapi--llm-api-抽象层)
   - [3.4 core/engine/ — 记忆流水线引擎](#34-coreengine--记忆流水线引擎)
   - [3.5 core/vault/ — 记忆存储层](#35-corevault--记忆存储层)
   - [3.6 core/test-runner/ — 自动化测试框架](#36-coretest-runner--自动化测试框架)
   - [3.7 core/ 根模块](#37-core-根模块)
   - [3.8 src/ui/ — UI 工具函数](#38-srcui--ui-工具函数)
   - [3.9 style.css — 面板样式表](#39-stylecss--面板样式表)
4. [关键数据流（Pipeline）](#4-关键数据流pipeline)
5. [关键类与接口](#5-关键类与接口)
6. [依赖关系](#6-依赖关系)
7. [项目运行方式](#7-项目运行方式)
8. [测试体系](#8-测试体系)

---

## 1. 项目概述

NE Memory Engine 是为 [SillyTavern](https://github.com/SillyTavern/SillyTavern) AI 角色扮演前端打造的记忆管理引擎，基于 [酒馆助手 (Tavern Helper)](https://github.com/N0VI028/JS-Slash-Runner) 运行。它提供分层记忆管理，使 LLM 在长对话中能持续追踪叙事事件、角色状态和势力关系。

### 核心能力

| 能力 | 说明 |
|------|------|
| **STM/LTM 分层记忆** | 短期记忆 (STM) 自动从对话轮次中提取；长期记忆 (LTM) 合并整合 STM，形成叙事弧线（`consolidate.js`，参数 `k1=1.5, b=0.75`） |
| **增量更新** | 代码级保证不重复处理同一消息（msg_id 去重 + cursor 游标追踪），事件记忆消耗不随对话长度增长 |
| **三层穿透检索** | LTM 摘要 → STM 详情 → 原始对话原文，层层下钻（`access` Tool / RetrievalNotebook） |
| **版本管理** | IndexedDB 快照存储，最多 30 个历史快照 + 精确回滚（`versions.js`） |
| **状态维护** | Schema 驱动的字段级约束，LLM 只修改变化字段，不重写全量（`schema.js`） |
| **Tool-calling** | 2 个注册工具：`access`（统一引用查询）、`recall_memory`（开放语义检索） |
| **副 API 渠道** | 记忆 Pipeline 和 Embedding 可分别配置独立 API（`callMemoryPipeline` / `computeEmbeddings`），节省主 API Token |
| **三语界面** | 简体中文 / 繁體中文 / English，包含 Narrative 面板、Config 设置和 State 字段三级翻译表 |
| **智能检索 (SmartPush)** | 每次 LLM 生成前，自动检索并注入相关记忆。**纯本地管线**：BM25 检索 → 可选向量 RRF 融合 → 实体链分组 → 代码格式化实体记忆链，无 LLM 参与 |
| **RRF 融合检索** | BM25 候选与向量候选按 Reciprocal Rank Fusion 公式融合（`k=60`），无需 Embedding 时纯 BM25 兜底 |
| **Embedding API** | 可选的向量相似度增强检索（余弦相似度），独立配置 Embedding API，索引按 chat 维度就地维护 |
| **自动调参** | 根据历史 Telemetry 统计数据自动调优 stmBatch / topK / chainDepth 等阈值（`params.js`） |
| **Token 用量统计** | Session / 月度 / 全局 / Per-chat 四级 Token 统计，按管线操作细分 |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        SillyTavern 前端                            │
│                     (浏览器运行时环境)                               │
├──────────────────┬───────────────────────────────────────────────┤
│   Tavern Helper  │           NE Memory Engine                     │
│  (事件/注入/      │                                                │
│   工具管理)       │  ┌─────────────────────────────────────────┐  │
│                  │  │  adapter/  ST 适配层                       │  │
│                  │  │  index.js → bootstrap.js                  │  │
│                  │  │  events.js → panel.js (barrel re-export)   │  │
│                  │  │  panel-shared.js / panel-init.js           │  │
│                  │  │  panel-drawer.js / panel-popout.js         │  │
│                  │  │  panel-content.js / panel-settings.js      │  │
│                  │  │  panel-state-cards.js / panel-usage.js     │  │
│                  │  │  panel-tools.js / test-driver.js            │  │
│                  │  │  test-driver.js → test-runner.js          │  │
│                  │  └──────────────┬──────────────────────────┘  │
│                  │                 │                               │
│                  │  ┌──────────────▼──────────────────────────┐  │
│                  │  │  core/ 核心引擎 (平台无关)                 │  │
│                  │  │                                          │  │
│                  │  │  runtime.js      ← 依赖注入接口           │  │
│                  │  │  settings.js     ← 运行时标志位           │  │
│                  │  │  params.js       ← 自动调参              │  │
│                  │  │  tools.js        ← Tool-calling 注册     │  │
│                  │  │  i18n.js         ← 三语翻译              │  │
│                  │  │  auto-restore.js ← 嵌入恢复              │  │
│                  │  │  globals.d.ts    ← IDE 类型声明           │  │
│                  │  │  types.js        ← JSDoc @typedef 定义    │  │
│                  │  │                                          │  │
│                  │  │  ┌────────────────────────────────────┐  │  │
│                  │  │  │ api/llm.js   LLM 调用层             │  │  │
│                  │  │  │   - callMemoryLLM (副API/TH双通道)   │  │  │
│                  │  │  │   - callMemoryPipeline              │  │  │
│                  │  │  └────────────────────────────────────┘  │  │
│                  │  │                                          │  │
│                  │  │  ┌────────────────────────────────────┐  │  │
│                  │  │  │ engine/  记忆流水线引擎               │  │  │
│                  │  │  │  pipeline-guard.js   并发守卫 (状态机) │  │  │
│                  │  │  │  pipeline-shared.js  管线共享工具     │  │  │
│                  │  │  │  update.js           增量更新编排     │  │  │
│                  │  │  │  state-pipeline.js   State 提取管线   │  │  │
│                  │  │  │  stm-pipeline.js     STM 提取管线     │  │  │
│                  │  │  │  ltm-pipeline.js     LTM 整合管线     │  │  │
│                  │  │  │  consolidate.js      STM→LTM 整合     │  │  │
│                  │  │  │  injection.js        SmartPush 注入   │  │  │
│                  │  │  │  retrieval.js        检索服务构建      │  │  │
│                  │  │  │  retrieval-fusion.js 向量融合检索      │  │  │
│                  │  │  │  retrieval-text.js   可搜索文本构建    │  │  │
│                  │  │  │  contradiction.js    事实矛盾检测      │  │  │
│                  │  │  │  ambiguity.js        模糊引用解析      │  │  │
│                  │  │  │  bm25-grouper.js     BM25 预分组      │  │  │
│                  │  │  │  turn-segmenter.js   对话轮次分割      │  │  │
│                  │  │  │  validate.js         STM/LTM 输出校验 │  │  │
│                  │  │  │  embedding.js        向量嵌入支持      │  │  │
│                  │  │  │  chat-telemetry.js   Per-chat 遥测    │  │  │
│                  │  │  │  telemetry.js        遥测日志          │  │  │
│                  │  │  │  token-stats.js      Token 统计面板    │  │  │
│                  │  │  │  text-utils.js       文本工具函数      │  │  │
│                  │  │  │  json-fallback.js    JSON 解析回退    │  │  │
│                  │  │  └────────────────────────────────────┘  │  │
│                  │  │                                          │  │
│                  │  │  ┌────────────────────────────────────┐  │  │
│                  │  │  │ vault/  存储层                       │  │  │
│                  │  │  │  store.js              IndexedDB CRUD│  │  │
│                  │  │  │  schema.js             状态Schema引擎│  │  │
│                  │  │  │  versions.js           快照版本管理  │  │  │
│                  │  │  │  retrieval-filter.js   BM25 检索过滤 │  │  │
│                  │  │  │  garbage-collector.js  IndexedDB GC  │  │  │
│                  │  │  └────────────────────────────────────┘  │  │
│                  │  │                                          │  │
│                  │  │  ┌────────────────────────────────────┐  │  │
│                  │  │  │ test-runner/  测试框架               │  │  │
│                  │  │  │  assertions.js    断言引擎           │  │  │
│                  │  │  │  files.js         测试用例/报告      │  │  │
│                  │  │  │  monitor.js       管线监控采集       │  │  │
│                  │  │  │  test-data.generated.js 自动生成数据 │  │  │
│                  │  │  └────────────────────────────────────┘  │  │
│                  │  └─────────────────────────────────────────┘  │
│                  │                                               │
│                  │  ┌─────────────────────────────────────────┐  │
│                  │  │  ui/utils.js   UI 工具函数               │  │
│                  │  └─────────────────────────────────────────┘  │
│                  │                                               │
│                  │  style.css — 面板样式表                        │
└──────────────────┴───────────────────────────────────────────────┘
```

### 分层设计理念

项目采用 **适配器模式** + **依赖注入**，将 SillyTavern 平台依赖全部集中在 `src/adapter/` 层。`src/core/` 通过 `runtime.js` 定义抽象接口（`getChat`, `generateQuiet`, `injectPrompt` 等），由 `adapter/index.js` 在启动时将 SillyTavern API 注入到 `runtime` 对象。这使得核心引擎逻辑理论上可以在其他平台复用。

---

## 3. 模块职责详解

### 3.1 adapter/ — SillyTavern 适配层

#### 3.1.1 [index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js) — 入口 + 依赖注入

**职责**：引擎启动入口，负责将 SillyTavern / TavernHelper 的 API 注入到 `runtime` 对象中。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `bootNE()` | 引擎启动（等待 jQuery 就绪后调用 `init()`） |
| `init()` | 核心初始化：加载设置 → bootstrap → 注册事件监听 → 注册工具 → 注入 `/ne` 斜杠命令 |
| `getChatId()` | 获取当前聊天 ID（优先使用 chat_metadata 指纹策略） |
| `_buildDebugApi()` | 构造 `window.__ne_debug` 全局调试 API（支持手动触发 pipeline、运行测试） |
| `setupEventListeners()` | 带重试的事件监听注册（支持 eventSource 和 TavernHelper 两种机制） |
| `registerToolsWithRetry()` | 带指数退避的 Tool-calling 工具注册 |
| `injectSlashCommand()` | 注入 `/ne search`、`/ne stats`、`/ne ltm` 等斜杠命令 |

**Runtime 注入项**：通过 `Object.assign(runtime, {...})` 将以下 API 注入：
- `getChatId` / `getChat` / `getChatMetadata` / `saveChat` — 对话数据读写
- `getCharacters` / `getWorldInfo` — 角色和世界书数据
- `generateQuiet` / `generateRaw` — LLM 生成调用
- `on` / `emit` — 事件系统
- `injectPrompt` — prompt 注入（通过 TH API）
- `getLorebookEntries` / `setLorebookEntries` / `createLorebookEntries` / `deleteLorebookEntries` / `getLorebooks` — 世界书（Lorebook）CRUD 管理
- `notify` / `confirm` — 通知与确认 UI
- `getParentDoc` — DOM 根文档引用

#### 3.1.2 [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) — 事件绑定与记忆注入

**职责**：绑定 ST 事件，驱动整个记忆流水线的触发时机。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `onMessageSent()` | 用户发送消息 → 加入 `pendingMessages[]` 缓冲区 |
| `onMessageReceived()` | AI 回复完成 → 触发增量更新 + 矛盾检测 |
| `onBeforeGenerate()` | 生成前 → 执行 SmartPush 智能记忆注入（或按对话轮数截断） |
| `onMessageDeleted()` / `onMessageSwiped()` | 消息删除/滑动 → 回滚相关记忆 |
| `onMessageUpdated()` | 消息编辑 → 标记待重处理 |
| `onSettingsChanged()` | 设置变更回调 |
| `onWorldInfoChange()` | World Info 变更 → 标记需要重新提取派系信息 |
| `initPowerSlot()` | 初始化角色战力槽（Power Slots） |

**核心触发流程**：
1. 用户消息 → `onMessageSent` → 存入 `pendingMessages[]` 缓冲区
2. `pendingMessages` 达到 `stmBatch` 阈值 → 在 `onMessageReceived` 时触发完整 pipeline
3. Pipeline 顺序：`idle → state → stm → ltm → idle`（由 `pipeline-guard.js` 状态机保证串行）
4. 每次生成前 → `onBeforeGenerate` → 根据设置注入 SmartPush 上下文（或按对话轮数截断 chat）
5. 生成后 → 可选矛盾检测 (`contradiction.js`) → 若检测到矛盾则注入证据触发 LLM 重新生成

#### 3.1.3 panel/ — Memory Vault UI（多文件拆分）

**说明**：`panel.js` 现为 barrel 导出文件，实际逻辑拆分到以下文件：

| 文件 | 职责 |
|------|------|
| [panel-shared.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-shared.js) | 共享工具函数 — DOM 查询（`qs`/`qsa`/`byId`）、国际化包装、Vault 活动状态、CSS 注入、LLM 日志缓冲 |
| [panel-drawer.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-drawer.js) | 抽屉面板 / 折叠面板 / 条目管理 — 折叠状态保存/加载、快速索引、Tab 切换、单条记忆保存/删除、状态横幅注入 |
| [panel-init.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-init.js) | 面板入口 — `renderVaultPanel()` 主渲染函数 |
| [panel-popout.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-popout.js) | 弹出层控制 — `createVaultPopout()` / `toggleVaultPanel()` / `renderHistory()` |
| [panel-content.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-content.js) | Vault 查看器内容渲染 — `updateVaultViewerPopout()` |
| [panel-settings.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-settings.js) | 设置标签页 — `renderSettingsTab()` |
| [panel-state-cards.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-state-cards.js) | 角色/势力/任务卡片 + 记忆表格 + 内联编辑 — `renderCharacterPanelHTML()` / `renderFactionPanelHTML()` / `renderQuestPanelHTML()` / `enterCardEditMode()` / `renderMemoryTable()` / `saveCardFields()` |
| [panel-tools.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-tools.js) | 测试工具 — `initTestRunner()`（仅 dev 模式生效） |
| [panel-usage.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-usage.js) | 用量统计标签页 — `renderUsageTab()`（依赖 Chart.js） |

**面板功能列表**：
- Memory List — STM/LTM 列表展示、编辑、删除
- State Board — 角色卡/势力/任务分 Tab 展示状态
- 版本历史 — 快照列表 + 恢复/删除操作
- 导出/导入 JSON — Vault 数据备份与恢复
- 嵌入到聊天 — 将 Vault 嵌入 `chat_metadata` 随聊天导出备份
- Process History — 手动触发全量历史处理
- Consolidate — 手动触发 STM→LTM 整合

#### 3.1.4 [bootstrap.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/bootstrap.js) — 初始化引导

**职责**：引擎初始化逻辑，包括 Vault 加载、设置应用、迁移、面板渲染、副 API 自动连接。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `bootstrapVault(chatId, locale, settings)` | 主引导函数——加载Vault → 迁移 → 渲染面板 → 启动遥测 |
| `migrateVaultIfNeeded(chatId, vault)` | 从旧 'default' key 迁移到基于 chat_metadata 指纹的新 key |

#### 3.1.5 [test-driver.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-driver.js) — 自动化测试驱动

**职责**：LLM 驱动的自动化测试循环。注册全局 Hook (`window.__ne_llm_hook`)，执行 seed 消息、监听管线、收集数据、评估断言。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `startTestSession(name)` | 启动测试会话 |
| `runOneRound(testCase, round, state, callAI)` | 执行单轮测试（seed 消息 → 等待 pipeline → 收集数据） |
| `endTestSession(chatId)` | 结束测试会话，生成 trace 和 report |

#### 3.1.6 [test-runner.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-runner.js) — 测试运行器 UI

**职责**：在 ST 面板中展示测试管理界面（测试列表、运行/停止按钮、逐轮进度）。

---

### 3.2 core/runtime.js — 抽象运行时

**职责**：定义核心引擎所需的抽象接口，所有平台依赖由 adapter 层注入。

```javascript
// 这是一个纯接口定义，adapter 层在启动时通过 Object.assign 覆盖
export var runtime = {
    getChat, getChatMetadata, saveChat,
    getCharacters, getWorldInfo,
    generateQuiet, generateRaw,
    maxContext, getLanguage,
    on, emit, injectPrompt,
    getLorebookEntries, setLorebookEntries,
    createLorebookEntries, deleteLorebookEntries, getLorebooks,
    getParentDoc, notify, confirm
};
```

---

### 3.3 core/api/ — LLM API 抽象层

#### 3.3.1 [llm.js](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js) — LLM 调用封装

**职责**：统一的 LLM 调用入口，支持维护 API（Pipeline）单独配置。提供主/副 API 双通道和 CORS-proxy 自动回退。**支持 keyless 模式**接入本地 LLM（Ollama、vLLM、LM Studio 等）。

**调用路径**：

```
callMemoryLLM(messages, options)
  ├── 副 API 已配置 → callCustomAPI(config, messages, options)
  │     ├── normalizeApiUrl(url) → 自动校正 http://localhost:11434 → localhost:11434/v1/chat/completions
  │     ├── 无 Key → 跳过 Authorization header（本地 LLM keyless 模式）
  │     ├── attemptFetch → POST OpenAI-compatible JSON {model,messages,temperature,max_tokens,response_format}
  │     │     └── 解析响应 → data.choices[0].message.content
  │     ├── 失败 → ST CORS proxy 回退（对 localhost 不生效，localhost 无 CORS 限制）
  │     └── 失败 → callTavernHelper → generateQuiet/generateRaw 回退
  └── 副 API 未配置 → callTavernHelper(messages, options)
        ├── generateQuiet(messages[n-1].content, messages[0].content) → 静默背景处理
        └── generateRaw({ordered_prompts, should_stream: false}) → 回退方案
```

**`normalizeApiUrl` 行为** ([llm.js:L182-198](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L182))：
- `http://localhost:1234` → `http://localhost:1234/v1/chat/completions`（本地 LLM）
- `https://api.deepseek.com/v1` → `https://api.deepseek.com/v1/chat/completions`
- 已是 `/v1/chat/completions` → 原样返回
- `/llm/chat` → 原样返回（ST 本地代理）
- 任何不明路径 → 警告，原样返回

**keyless 模式** ([llm.js:L245](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L245))：`if (config.key)` 条件跳过 `Authorization` header。本地 LLM 用户只需填写 URL 和 Model，Key 留空即可。这覆盖了 Ollama、vLLM、LM Studio、LocalAI 等所有 OpenAI 兼容的本地端点。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `callMemoryLLM(messages, options)` | `(Array, Object) → Promise<string>` | 记忆 LLM 主调用（优先副 API，失败回退 TH `generateQuiet`） |
| `callMemoryPipeline(messages, options, chatId)` | `(Array, Object, string) → Promise<string>` | Pipeline 专用调用（STM / State / LTM 提取），嵌入 LLM 调用钩子供测试监控 |
| `callMemoryRetrieval(messages, options)` | `(Array, Object) → Promise<string>` | `recall_memory` 工具专用调用（不参与 SmartPush 注入） |
| `testSecondaryApiConnection(cfg)` | `(Object) → Promise<{success, error?}>` | 副 API 连通性测试 |
| `recordTelemetry(entry, chatId)` | `(Object, string) → void` | 遥测数据记录到 localStorage `ne_telemetry` |
| `initPowerSlots(state)` | `(Object) → void` | 初始化角色的战力槽（Power Slots）基于 Power Slots 模板 |
| `onPipelineLLMCall(fn)` / `offPipelineLLMCall(fn)` | `(Function) → void` | Pipeline LLM 调用钩子（注册/注销测试监控回调） |
| `releasePipeline()` | `() → void` | 释放 Pipeline 连接（重置 API Key 轮转等） |

---

### 3.4 core/engine/ — 记忆流水线引擎

#### 3.4.1 [pipeline-guard.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/pipeline-guard.js) — 流水线并发守卫

**职责**：确保 State → STM → LTM 三个阶段串行执行，防止并发冲突。

**状态机**：`idle → state → stm → ltm → idle`

**常量**：`PIPELINE_PHASES = ['state', 'stm', 'ltm']`

| 函数 | 签名 | 说明 |
|------|------|------|
| `tryAcquire(targetState)` | `(string) → boolean` | 尝试从 idle 获取 pipeline 所有权进入 targetState |
| `transitionTo(newState)` | `(string) → void` | 状态转移（state→stm, stm→ltm 等） |
| `releasePipeline()` | `() → void` | 释放 pipeline 回到 idle，唤醒所有 `waitForPipelineTrackIdle` 等待者 |
| `isIdle()` / `getPipelinePhase()` | `() → boolean/string` | 状态查询 |
| `reset()` | `() → void` | 强制重置状态机（异常恢复） |
| `waitForPipelineTrackIdle(timeoutMs)` | `(number) → Promise<void>` | 等待 pipeline 变为 idle（默认 15s 超时），非 idle 时注册 Promise resolve 到等待队列 |

#### 3.4.2 [pipeline-shared.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/pipeline-shared.js) — 管线共享工具

**职责**：被 state/stm/ltm 子管线共享的工具函数，从原 `update.js` 提取。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `saveVaultWithSnapshot(chatId, vault)` | `(string, Object) → Promise<void>` | 原子写 vault + 快照（版本号+1） + 同步到 chat_metadata，并清理旧快照 |
| `ensureStateStructure(vault)` | `(Object) → void` | 初始化/迁移 vault state 结构，含 `state_css` 字段 |
| `filterNewMessages(messages, processedIds)` | `(Array, Set) → Array` | 过滤已处理消息，返回新消息 |
| `parseSTMResponse(llmResponse)` | `(string) → Object\|null` | 解析 LLM 返回的 STM JSON（委托给 `json-fallback.js`） |
| `handleQuestCompletion(state, validatedChanges, currentTime)` | `(Object, Object, string) → void` | 检测状态变更中是否涉及任务完成，更新 quests 完成时间 |

#### 3.4.3 [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) — 增量更新引擎（精简协调层）

**职责**：Pipeline 的主协调入口。v5.6 重构后，**具体 LLM prompt 构建已移至三个子管线文件**，`update.js` 现只负责 `events.js` 事件的调度协调，将消息派发到 [state-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/state-pipeline.js)、[stm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js)、[ltm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/ltm-pipeline.js)。原始 `update.js.bak` 保留作为历史参考。

#### 3.4.4 [state-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/state-pipeline.js) — State 提取管线

**职责**：从原 `update.js` 提取的 State 阶段。负责构建角色卡摘要、发现新角色、构建 State injection table、派系提取、调用 LLM 提取状态变更。

**关键导出函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `extractStateChangesOnly(chatId, latestUserMsg, latestAssistantMsg)` | `(string, Object, Object) → Promise<Object>` | **逐轮轻量状态提取**：构建 State 提示词 → LLM 提取变更 → Schema 验证 → 合并到 state → 保存 |
| `resolveNpcSchemes(vault, chatId, messages)` | `(Object, string, Array) → Promise<void>` | NPC 方案发现 + 派系关键词激活提取（含 Promise.all 并行派系扫描） |

**内部函数**（未导出）：
- `buildStatePrompt_Preset` — 角色卡 + 当前状态表 + World Book + 派系上下文 prompt 构建
- `findNewCharacterNames` — 检测 state.characters 中所有静态字段为空的角色名
- `scanMessageForFactions` / `buildFactionKeywords` — 从 World Book 获取派系关键词并扫描消息

#### 3.4.5 [stm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js) — STM 提取管线

**职责**：从原 `update.js` 提取的 STM 阶段 prompt 构建与执行。负责消息分组、BM25 预分组提示、LLM prompt 组装，**同时也是 `executeIncrementalUpdate` 的新家**（从 `update.js` 迁移）。

**关键导出函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `executeIncrementalUpdate(chatId, newMessages, force, onProgress)` | `(string, Array, boolean, Function) → Promise<void>` | **核心增量更新入口**：收集已处理 msg_id → 过滤新消息 → 状态提取 → STM 批处理 → LTM 决策 → 保存快照 |
| `buildSTMUpdatePrompt(newMessages, vault, partials)` | `(Array, Object, Array) → string` | 构建单批消息的 STM 提取 prompt（含当前状态快照、BM25 预分组提示） |
| `buildBatchPrompt(turns, vault)` | `(Array, Object) → string` | 构建批量 turns 的 STM + LTM 联合提取 prompt（含开放 LTM 决策上下文） |
| `buildStmOnlyPrompt(turns, vault)` | `(Array, Object) → string` | 构建纯 STM 提取 prompt（无 LTM 决策上下文） |

**内部函数**（未导出）：
- `segmentTurns` — 三级切分（L1_CUT/L2_CUT/L2_KEEP/L3_ASK），结合 BM25 相似度矩阵
- `computeTurnBoundarySignals` / `classifyBoundary` — 计算并分类 turn 边界信号
- `askBoundaryJudge` — 模糊边界交由 LLM 裁决

#### 3.4.6 [ltm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/ltm-pipeline.js) — LTM 整合管线

**职责**：从原 `update.js` 提取的 LTM 阶段决策，构建 LLM prompt 并执行。负责当前开放弧上下文、闭合信号预计算、LLM 决策。

**关键导出函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `runLtmDecision(vault, newStmIds, callMemoryPipeline)` | `(Object, Array, Function) → Promise<void>` | **唯一导出入口**：构建 LTM 决策 prompt → 调用 LLM → 校验输出 → 应用 LTM 决策 |

**内部函数**（未导出）：
- `buildLtmDecisionPrompt(vault, newStmEntries)` — 构建 LTM 决策 prompt（含开放弧、已闭合弧目录、闭合信号）
- `_validateLtmEventText` — 校验 LTM event 文本完整性（是否截断、长度是否过短）

**Turn 切分层级常量**（在 `stm-pipeline.js` 的 `segmentTurns` 中使用）：
- `L1_CUT`：利用 BM25 相似度矩阵自动切分事件边界
- `L2_CUT`：高置信度强制切分
- `L2_KEEP`：高置信度保持连续
- `L3_ASK`：模糊边界，交由 LLM 裁判决定

#### 3.4.7 [consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/consolidate.js) — STM→LTM 流式整合

**职责**：将多条未整合的 STM 条目合并为 LTM 叙事弧线。支持 **open/closed** LTM 状态——开放弧线的 LTM 可持续追加新 STM 直到弧线自然终结。

**常量**：`MAX_OPEN_STM_REFS = 15`（开放 LTM 的 STM 引用硬上限）

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `isLtmEnabled(vault)` | `(Object) → boolean` | 未整合 STM ≥ `stmMaxUnconsolidated` 阈值 → 返回 true |
| `getNextEligibleStmId(vault)` | `(Object) → string|null` | 获取下一个待整合的 STM id（按 msg 顺序） |
| `computeClosureSignals(openLtm, newStmEvents)` | `(Object, Array) → Object` | 计算弧线闭合信号（时间跨度、角色重合度、场景切换检测） |
| `findOpenLtm(vault)` | `(Object) → Object|null` | 查找当前开放的 LTM（同时清理多个 open 的异常状态） |
| `applyLtmDecision(vault, ltmDecision, consumedStmIds)` | `(Object, Object, Array) → void` | 应用 LTM 决策结果（append / close_and_new / skip） |
| `runLtmRebatch(vault, callMemoryPipeline)` | `(Object, Function) → Promise<void>` | 处理孤立的 `parent_ltm` 条目重新批处理 |
| `splitStmsIntoContiguousGroups(stms, tolerance)` | `(Array, number) → Array` | 按时间连续性将 STM 分组，tolerance=2 允许间隔最多 2 条消息 |
| `formatLtmCatalog(ltmEntries)` | `(Array) → string` | 格式化 LTM 目录（仅展示最近 5 个闭合弧） |
| `getLtmSummary(vault)` | `(Object) → Object` | 获取 LTM 统计摘要（总数/open/closed） |

#### 3.4.9 [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js) — SmartPush 智能上下文注入

**职责**：在每次 LLM 生成前构建 SmartPush 上下文，包含相关记忆和状态信息。纯本地计算（无 LLM 参与），是 SmartPush 的主入口。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `formatSmartContext(vault, chatMessages, budget, chatId)` | `(Object, Array, number, string) → Promise<string>` | **主入口**：BM25 检索 → 可选向量 RRF 融合 → 实体链分组 → `buildEntityBlock` 代码组装最终注入文本 |
| `buildStateOnlyInjection(vault)` | `(Object) → string` | 纯状态注入（无记忆时的回退方案） |
| `estimateComplexityBudget(chatMessages, defaultBudget)` | `(Array, number) → number` | 基于最后一条消息的复杂度估算检索 Token 预算 |
| `buildEntityBlock(groupedResult, annotations, activeChars, entityChains)` | `(Object, Object, Array, Object) → string` | 代码组装实体记忆链块（实体子标题 + KB 标注 + 事件列表） |
| `buildKeyHighlights(topCandidates, entityChains)` | `(Array, Object) → string` | 提取 top-5 高相关度实体事件作为关键记忆 |
| `compileRetrievalBudget(content, query, entityNames, chains, tokens)` | `(Object, string, Array, Object, number) → string` | 按 Token 预算分配相关实体事件摘要（可选） |

**内部处理流程**（纯本地，无线 LLM 调用）：
1. `computeVisibleWindow` — 计算当前在主 LLM 上下文窗口中的消息范围
2. 构建查询 — 从最近 2 轮对话 + 当前故事时间/场景/活跃角色 + 歧义消解构建检索查询
3. BM25 检索 — 调用 `retrieval-filter.js` 的 `filterCandidates()` 获取 top-k 候选（默认 40，auto 模式自适应）
4. **可选向量 RRF 融合** — 若向量搜索已启用且 Embedding API 已配置，`filterCandidates()` 内部触发 `vectorSearch()` → `rrfFuse()` 按倒数排名融合（α=0.20 BM25 权重, k=60），结果标记 `_vectorUsed`
5. 实体链查询 — 从候选结果中提取实体名，调用 `retrieval.js` 的 `lookupEntityChains`
6. 管道合并 — 调用 `retrieval.js` 的 `mergePipelines`（BM25/向量结果 + 实体链 + LTM 目录 → 多源融合到统一 Map）
7. `prefetchOriginalTexts` — 为 top-3 候选预取原始对话文本
8. 按实体分组 — `groupCandidatesByEntity()` 将候选按实体名归类
9. 最终注入文本组装（纯代码拼接，无 LLM 参与）：
   - `buildKeyHighlights()` — top-5 高相关度实体事件
   - `buildEntityBlock()` — 实体记忆链（实体子标题 + 事件列表 + KB 认知标注）
   - 未命中链跨度标注
   - `compileRetrievalBudget()` — Token 预算分配后的实体事件摘要（可选）

**设计要点**：v6.0 SmartPush 不经过任何 LLM 合成环节。检索结果由 `buildEntityBlock` 直接从结构化数据（`relevance`、`entity`、`event`、`stm_refs`）组装为固定格式的注入文本。这确保了注入格式稳定、Token 可控、零额外 API 成本。

#### 3.4.10 [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js) — 检索服务

**职责**：v2 实体链查询 + 注入。自动从 STM/LTM 条目构建实体时间线，注入为"已知实体时间线"。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `lookupEntityChains(content, entityNames)` | `(Object, Array) → Object` | 根据实体名查询其在 STM/LTM 中的所有关联条目（含自动深度采样：head + recent + mid 三段式） |
| `extractEntityNames(query, content)` | `(string, Object) → Array` | 从查询中提取已知实体名（从 characters/factions/STM entities 收集，最长 5 个） |
| `mergePipelines(bm25Results, entityChains, allLTM, state, allSTM)` | `(Array, Object, Array, Object, Array) → Object` | 合并 BM25 结果与实体链为统一 Map + ThreadIndex（含隐式实体发现 + 短链内联） |
| `groupCandidatesByEntity(map, threadIndex)` | `(Map, Object) → Object` | 将候选按实体名分组，支持跨实体引用标注 |
| `formatEntityGroupedText(groupedResult)` | `(Object) → string` | 格式化按实体分组后的文本（含 RRF 分数标记、关联条目、预取原文） |
| `buildRetrievalPromptLegacy(notebook, query, vault)` | `(Object, string, Object) → Object` | 仅为 `recall_memory` 工具提供 legacy prompt（非 SmartPush 使用） |

#### 3.4.11 [retrieval-fusion.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval-fusion.js) — 向量融合检索

**职责**：维护内存中的向量索引，对 STM 条目批量计算 Embedding 并缓存，用于向量相似度增强的 BM25 检索。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `resetVectorIndex(chatId)` | `(string) → void` | 重置指定/全部对话的向量索引 |
| `getVectorIndex(chatId)` | `(string) → Object` | 获取向量索引引用 |
| `ensureVectorIndex(allSTM, aliasesMap, chatId)` | `(Array, Object, string) → Promise<void>` | 确保向量索引与 STM 数据同步（新增计算 Embedding，清理已删除条目） |
| `vectorSearch(queryEmbedding, vectorIndex, k)` | `(Float32Array, Object, number) → Array` | 纯向量搜索：余弦相似度，返回 top-k |
| `rrfFuse(bm25Candidates, vectorCandidates, k, topK)` | `(Array, Array, number, number) → Array` | **RRF 融合**：BM25 与向量候选按倒数排名融合，`k` 默认为 60 |

#### 3.4.12 [retrieval-text.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval-text.js) — 可搜索文本构建

**职责**：为 STM 条目构建统一的搜索文本（含别名扩展），供给 retrieval-fusion.js 的向量索引和检索使用。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `buildSearchableText(entry, aliasesMap)` | `(Object, Object) → string` | 拼接条目的 period / scene / event / entities / translation / aliases 为可搜索文本 |

#### 3.4.13 [contradiction.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/contradiction.js) — 矛盾检测

**职责**：AI 生成回复后检测事实矛盾。若检测到矛盾，注入原文证据并触发 LLM 重新生成。

**置信度阈值**：0.6

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `detectContradictions(chatId, aiMessage)` | `(string, Object) → Promise<Object|null>` | 检测回复中的事实矛盾 |

**内部流程**：
1. `extractClaims` — 调用 LLM 从 AI 回复中提取事实主张
2. `verifyClaim` — 对每条主张调用 BM25 检索验证，调用 LLM 比对矛盾
3. `buildContradictionSystemMessage` — 构建包含矛盾证据的 system message 注入到主 LLM

#### 3.4.14 [ambiguity.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/ambiguity.js) — 模糊引用解析

**职责**：解析用户消息中的模糊引用（"那个铁匠"、"上次的事"），映射为具体实体名以提升 BM25 检索精度。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `resolveAmbiguousReferences(query, content)` | `(string, Object) → Promise<string>` | 解析模糊引用，返回增强后的查询字符串 |

#### 3.4.16 [bm25-grouper.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/bm25-grouper.js) — BM25 预分组器

**职责**：对输入消息计算相邻 BM25 相似度矩阵，生成语义预分组提示，辅助 LLM 更好地切分事件边界。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `preGroupItems(items, textExtractor)` | `(Array, Function) → Array` | 基于 BM25 相似度将 items 预分组 |
| `formatPreGroupHint(groups)` | `(Array) → string` | 格式化分组提示文本 |

#### 3.4.17 [turn-segmenter.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/turn-segmenter.js) — 对话轮次分割

**职责**：将扁平消息列表按 `(user, assistant)` 配对分组为 turns。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `groupMessagesIntoTurns(messages)` | `(Array) → Array` | 消息→turns 分组 |
| `formatTurnsText(turns, turnIndices)` | `(Array, Array) → string` | turns 格式化为 LLM prompt 文本 |
| `collectMsgIdsFromTurns(turns, turnIndices)` | `(Array, Array) → Array` | 从 turns 中收集 msg_id |

#### 3.4.18 [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js) — STM/LTM 输出验证

**职责**：验证 LLM 输出的 STM/LTM 条目结构完整性和 msgRange 合法性。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `validateSTMOutput(parsed, vault, messageCount)` | `(Object, Object, number) → Array` | 验证 STM 输出的 event 必填、msgRange 格式 |
| `validateMsgRanges(stmEntries, messageCount)` | `(Array, number) → Array` | 验证 msgRange 全覆盖、无重叠、不越界 |
| `postFillSTM(parsed, vault)` | `(Object, Object) → Object` | STM 后处理：填充 story_time、story_date、story_scene |
| `validateLTMOutput(result)` | `(Object) → Array` | 验证 LTM 输出的 event 必填、stm_refs 必填且 ≥ minLtmMerge |
| `postFillLTM(result, sourceSTMList)` | `(Object, Array) → Object` | LTM 后处理：修复 stm_refs 引用、填充 period/id/title/status |
| `mergeStoryPeriod(storyTime, storyDate)` | `(string, string) → string` | 合并故事时间文本 |

#### 3.4.19 [text-utils.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/text-utils.js) — 文本工具

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `countTokens(text)` | `(string) → number` | GPT token 计数（基于 `gpt-tokenizer` 库） |
| `tokenize(text)` | `(string) → Array` | CJK-aware 分词器 |
| `vocabularyOverlap(textA, textB)` | `(string, string) → number` | 计算两段文本的词汇重叠度 |

#### 3.4.20 [telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/telemetry.js) — 遥测日志

**职责**：异常检测（异常/用户信号/Token 用量），记录到 localStorage `ne_stm_telemetry`。

#### 3.4.21 [chat-telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/chat-telemetry.js) — 对话级遥测

**职责**：Per-chat 逐轮遥测计数器。存储到 localStorage `ne_chat_stats`。

**存储结构**：
```javascript
{
  "chat_abc123": {
    "turns": [
      { "t": 1, "stm": 3, "ltm": 0, "llm": 2, "tool": 0, "tok": 500, "tok_stm": 300, "tok_ltm": 120, "tok_sp": 50, "tok_tool": 30, "tok_chat": 0, "err": 0, "dur": 1200 }
    ],
    "aggregates": {
      "total_turns": 2, "total_stm_count": 5, "total_ltm_count": 2,
      "total_llm_calls": 4, "total_tool_calls": 1, "total_tokens": 1300,
      "total_tok_stm": 800, "total_tok_ltm": 300, "total_tok_sp": 120,
      "total_tok_tool": 80, "total_tok_chat": 0, "total_errors": 0,
      "total_smartpush_injections": 2, "total_pipeline_duration_ms": 2700
    }
  }
}
```

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `incrementChatTurn(chatId)` | `(string) → void` | 对话轮次推进，创建新一轮快照 |
| `recordChatStat(chatId, key, value)` | `(string, string, number) → void` | 更新当前轮快照字段（累加模式） |
| `recordChatToken(chatId, tokenOp, value)` | `(string, string, number) → void` | 按操作分类记录 Token 消耗 |
| `getChatTurnNumber(chatId)` | `(string) → number` | 获取当前轮号 |
| `getChatStats(chatId)` | `(string) → Object` | 获取某 chat 的完整统计 |
| `getAllChatStats()` | `() → Object` | 获取所有 chat 的统计摘要 |
| `clearChatStats(chatId)` | `(string) → void` | 清除某 chat 统计 |

#### 3.4.22 [token-stats.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js) — Token 用量统计

**职责**：Session / 月度 / 全局 Token 用量统计与面板展示。

#### 3.4.23 [embedding.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/embedding.js) — 向量嵌入

**职责**：可选的向量相似度增强检索。独立配置 Embedding API。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `computeEmbedding(text)` | `(string) → Promise<Float32Array\|null>` | 计算单条文本的嵌入向量 |
| `computeEmbeddings(texts)` | `(Array) → Promise<Array<Float32Array>\|null>` | 批量计算文本的嵌入向量 |
| `cosineSimilarity(a, b)` | `(Float32Array, Float32Array) → number` | 计算余弦相似度 |
| `testEmbeddingApiConnection(cfg)` | `(Object) → Promise<{success, error?, dimensions?}>` | 测试 Embedding API 连通性 |
| `isVectorSearchEnabled()` | `() → boolean` | 是否启用向量搜索 |
| `loadEmbeddingApiConfig()` | `() → Object\|null` | 从 localStorage `ne_embedding_api` 加载配置 |
| `saveEmbeddingApiConfig(config)` | `(Object) → void` | 保存 Embedding API 配置 |

#### 3.4.24 [json-fallback.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/json-fallback.js) — JSON 解析回退

**职责**：LLM 输出的 JSON 解析失败时的多级回退策略（修复截断 JSON、提取 JSON 块、多行拼接等）。

---

### 3.5 core/vault/ — 记忆存储层

#### 3.5.1 [store.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/store.js) — IndexedDB CRUD

**职责**：记忆数据的持久化存储，每个 chat_id 对应 IndexedDB 中的一条记录。同时管理快照 store。

**数据库结构**：
- **Database**: `ne_memory_vaults` (v3)
- **Store `vaults`**: `{ chat_id, vault, updated_at }`
- **Store `snapshots`**: `{ id, chat_id, version, updated_at, data }`（索引：chat_id）

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `openDB()` | `() → Promise<IDBDatabase>` | 打开/创建 IndexedDB |
| `read(chatId)` | `(string) → Promise<Object>` | 读取 vault（带迁移和格式化） |
| `write(chatId, vault)` | `(string, Object) → Promise<void>` | 写入 vault |
| `writeWithSnapshot(chatId, vault, snapshot)` | `(string, Object, Object) → Promise<void>` | 原子写 vault + 快照 |
| `remove(chatId)` | `(string) → Promise<void>` | 删除 vault |
| `emptyVault(chatId)` | `(string) → Object` | 创建空 vault 模板 |
| `appendSTMEntries(vault, stmEntries)` | `(Object, Array) → Object` | 追加 STM 条目（自动去重） |
| `rollbackByMsgIds(vault, removedMsgIds)` | `(Object, Array) → Object` | 按 msg_id 回滚相关条目 |
| `collectAllMsgIds(vault)` | `(Object) → Set` | 收集所有已处理的 msg_id |
| `sortStmByMsgOrder(entries)` | `(Array) → Array` | 按消息顺序排序 STM |
| `getCursorState(vault, mode)` | `(Object, string) → Object` | 获取处理游标状态 ('stm' / 'ltm') |
| `updateCursorState(vault, mode, state)` | `(Object, string, Object) → void` | 更新处理游标 |

#### 3.5.2 [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) — 状态 Schema 引擎

**职责**：驱动的动态状态管理系统，定义角色卡/势力/任务的字段约束和验证。

**默认 Schema 常量**：

| 常量 | 说明 |
|------|------|
| `DEFAULT_GLOBAL_SCHEMA` | 全局状态 Schema（characters, factions, quests, power_slots） |
| `DEFAULT_CHARACTER_SCHEMA` | 角色卡 Schema（protagonist + npc 两个 block） |
| `DEFAULT_FACTION_SCHEMA` | 势力 Schema（name, description, leader, relations 等） |
| `DEFAULT_QUESTS_SCHEMA` | 任务/目标/事件 Schema（tasks, goals, events 三个子块） |
| `POWER_SLOTS_TEMPLATES` | 战力槽模板（修仙: 修为/真气/境界、科幻: energy/shield、现代: stamina/morale） |
| `DEFAULT_NPC_SCHEME` | 默认 NPC 字段方案（standard / complex 等） |

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `validateField(value, fieldSchema)` | `(any, Object) → Object` | 类型检查 + max_length + enum 校验 |
| `resolveSchemaPath(stateSchema, dotPath)` | `(Object, string) → Object` | dot-path 递归解析 Schema 定义（如 `characters.爱丽丝.status`） |
| `validateStateChanges(stateSchema, changes)` | `(Object, Object) → Object` | 校验状态变更（未知字段警告不阻塞） |
| `mergeStateChanges(state, validatedChanges)` | `(Object, Object) → Object` | dot-path 深度合并变更到当前状态 |
| `buildStateInjectionTable(state, messages, maxItems, world)` | `(Object, Array, number, Object) → string` | 构建状态注入表格（用于 LLM prompt） |
| `formatStateSummary(state, stateSchema)` | `(Object, Object) → Object` | 格式化状态摘要 |
| `formatCharacterSummary(state, characterSchema)` | `(Object, Object) → string` | 格式化角色摘要 |
| `formatQuestSummary(state, currentTime)` | `(Object, string) → string` | 格式化任务摘要 |
| `rebuildPresentCharacters(state)` | `(Object) → void` | 从各角色 status 重建 present_characters 列表 |
| `ensureCharacterTemplate(state, name, schemeKey)` | `(Object, string, string) → void` | 确保角色有完整模板字段 |
| `getNpcInjectionFields(schemeName, state)` | `(string, Object) → Array` | 获取 NPC 注入字段 |

#### 3.5.3 [versions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/versions.js) — 版本快照管理

**职责**：IndexedDB 中的快照存储，上限 30 个（自动裁剪旧版本）。支持回滚。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `pruneSnapshotsForChat(chatId, maxSnapshots)` | `(string, number) → Promise<void>` | 删除旧快照（默认保留 30 个） |
| `rollbackByMsgIds(chatId, msgIds)` | `(string, Array) → Promise<void>` | 按 msg_id 回滚 Vault（消息删除时使用） |
| `getVaultVersion(chatId)` | `(string) → Promise<number>` | 获取当前 Vault 版本号 |

#### 3.5.4 [retrieval-filter.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/retrieval-filter.js) — BM25 检索过滤

**职责**：纯浏览器端 BM25 检索引擎。支持别名扩展、向量评分增强（可选）、去重缓存。

**BM25 参数常量**：`BM25_K1 = 1.2`, `BM25_B = 0.75`

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `filterCandidates(query, allSTM, allLTM, topK, minScore, aliasesMap, chatId)` | `(string, Array, Array, number, number, Object, string) → Promise<Array>` | BM25 检索 + topK 排序 |
| `parseTimeConstraint(query)` | `(string) → Object\|null` | 从查询中解析时间约束 |
| `applyTimeFilter(entries, timeConstraint)` | `(Array, Object) → Array` | 按时间过滤记忆条目 |

#### 3.5.5 [garbage-collector.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/garbage-collector.js) — IndexedDB 孤儿数据 GC

**职责**：遍历 IndexedDB 中所有 vault 数据，与 ST `ctx.characters` / `ctx.groups` 做差集对比，找出并清理已删除聊天遗留的 vault + snapshot 数据。

**关键函数**：

| 函数 | 签名 | 说明 |
|------|------|------|
| `collectSTChatIds()` | `() → Set<string>` | 从 ST context 中收集所有现存的聊天 ID |
| `scanOrphans()` | `() → Promise<Array>` | 扫描所有 vault，返回不在现存 chat ID 中的孤儿列表 |
| `purgeOrphanChatData(chatId)` | `(string) → Promise<void>` | 删除单个孤儿 vault 及其对应的 snapshots |
| `listAllChatIds()` | `() → Promise<Array>` | 列出 IndexedDB 中的所有 chat_id |

---

### 3.6 core/test-runner/ — 自动化测试框架

| 文件 | 职责 |
|------|------|
| [assertions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/assertions.js) | 断言引擎：支持结构性断言（min_length, max_length, contains, not_contains, equals, exists, regex, type）和 LLM 驱动的语义性断言（三态结果 passed=true/false/null） |
| [files.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/files.js) | 测试文件管理：YAML frontmatter 解析、测试用例发现、trace 日志生成、report 报告生成 |
| [monitor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/monitor.js) | Pipeline LLM 调用监控：`startCollectingPipelineCalls` / `stopCollectingPipelineCalls` / `collectRoundData` / `collectVaultSummary` |
| [test-data.generated.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/test-data.generated.js) | 自动生成的测试数据（由 `scripts/generate-test-data.cjs` 从 `test-cases/` 生成） |

---

### 3.7 core/ 根模块

| 文件 | 职责 |
|------|------|
| [runtime.js](file:///d:/SillyTavern/xm/ne-memory/src/core/runtime.js) | 抽象运行时接口定义，adapter 层通过 `Object.assign` 覆盖 |
| [settings.js](file:///d:/SillyTavern/xm/ne-memory/src/core/settings.js) | 运行时标志位：`getStmMinLtmMerge()` / `getVectorSearchConfig()`（从 localStorage `ne_settings` 读取） |
| [params.js](file:///d:/SillyTavern/xm/ne-memory/src/core/params.js) | 自动调参系统：`computeStmBatch` / `computeTopK` / `computeChainDepth` / `computeChainRecentWindow` / `computeLtmDirCount` / `computeMinResults` / `computeChainHeadCount` |
| [tools.js](file:///d:/SillyTavern/xm/ne-memory/src/core/tools.js) | Tool-calling 注册与执行：`registerAllTools` — 注册 `access`（统一引用查询）和 `recall_memory`（开放语义检索）；`executeAccess` — 解释多种引用格式 |
| [i18n.js](file:///d:/SillyTavern/xm/ne-memory/src/core/i18n.js) | 三级翻译表：`NARRATIVE_I18N`（面板文本）、`CONFIG_I18N`（设置弹窗文本）、`STATE_FIELD_I18N`（状态字段名）三语翻译（zh-cn/zh-tw/en） |
| [auto-restore.js](file:///d:/SillyTavern/xm/ne-memory/src/core/auto-restore.js) | Vault 自动恢复：`loadVault` 分层加载（聊天文件优先 → IndexedDB 兜底 → 自动回填）；`persistVaultToChatFile` 增量同步 |
| [globals.d.ts](file:///d:/SillyTavern/xm/ne-memory/src/globals.d.ts) | IDE 类型声明文件，声明 iframe 中由 TH 注入的全局变量类型（`TavernHelper`、`ToolManager`、`SillyTavern` 等） |
| [types.js](file:///d:/SillyTavern/xm/ne-memory/src/types.js) | 集中类型定义 — 25+ `@typedef` JSDoc 类型（Vault, VaultMeta, VaultContent, State, CharacterCard, Faction, QuestsState, STMEvent, LTMEntry, Entity, UnifiedEntry, ThreadRef, ThreadDef, Turn, Message, Snapshot, CursorState, ClosureSignals, LTMDecision, PipelineGuard, StateChanges, ValidationResult, SchemaFieldDef 等），零运行时开销 |

---

### 3.8 src/ui/ — UI 工具函数

| 文件 | 职责 |
|------|------|
| [utils.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/utils.js) | `escapeHtml(str)` — HTML 转义防 XSS；`formatLocalTime(isoStr)` — 格式化 ISO 时间为 `YYYY-MM-DD HH:mm:ss` |

---

### 3.9 style.css — 面板样式表

**职责**：NE Memory 扩展的完整 UI 样式表，包含：
- 设置面板样式（Slider、Toggle、代码块、计时器）
- 记忆列表表格样式
- Token 统计面板样式
- 测试运行器面板样式

---

## 4. 关键数据流（Pipeline）

### 4.1 完整 Pipeline 触发流程

```
用户发送消息
     │
     ▼
onMessageSent() → 消息加入 pendingMessages[]
     │
     ├─ pendingMessages.length < stmBatch → 等待更多消息
     │
     └─ pendingMessages.length >= stmBatch
           │
           ▼
     AI 回复完成 → onMessageReceived()
           │
           ▼
     tryAcquire('state') — 获取 pipeline 所有权
           │
           ├─ 失败（已在运行）→ 等待下次触发
           │
           └─ 成功
               │
               ┌──────────────────────────────────────┐
               │ 1. STATE 提取                         │
               │    transitionTo('state')              │
               │    构建 State injection table          │
               │    LLM 提取角色/势力/任务状态变更        │
               │    Schema 验证 → mergeStateChanges    │
               │    保存中间 vault                      │
               ├──────────────────────────────────────┤
               │ 2. STM 提取                           │
               │    transitionTo('stm')                │
               │    turn-segmenter: 消息 → (User,AI) turns │
               │    bm25-grouper: 语义预分组            │
               │    stm-pipeline: buildBatchPrompt → LLM│
               │    validateSTMOutput: 校验输出          │
               │    appendSTMEntries: 追加到 vault       │
               ├──────────────────────────────────────┤
               │ 3. LTM 整合                           │
               │    transitionTo('ltm')                │
               │    isLtmEnabled: 未整合 STM ≥ 阈值?    │
               │    computeClosureSignals: 弧线闭合判断 │
               │    LLM 决策: append/close_and_new/skip │
               │    applyLtmDecision: 应用决策          │
               │    postFillLTM: 后处理修复引用          │
               ├──────────────────────────────────────┤
               │ 4. 收尾                               │
               │    releasePipeline() → idle           │
               │    saveVaultWithSnapshot: 原子保存     │
               │    persistVaultToChatFile: 同步到文件  │
               └──────────────────────────────────────┘
```

### 4.2 逐轮轻量 State 提取（非阈值轮）

```
每次 AI 回复后（pendingMessages < stmBatch 时）
     │
     ▼
extractStateChangesOnly()
     │
     ▼
仅提取 State 变更（不处理 STM/LTM）
     │
     ▼
Schema 验证 → mergeStateChanges → 保存 vault
```

### 4.3 SmartPush 注入流程

```
每次 AI 生成前 → onBeforeGenerate()
     │
     ├─ 启用 SmartPush → formatSmartContext() (纯本地，无 LLM 调用)
     │     │
     │     ├─ 构建查询（最后2轮对话 + 故事时间/场景/活跃角色 + 歧义消解）
     │     ├─ BM25 检索 → filterCandidates() top-k（默认 40，auto 模式自适应）
     │     │     └─ 可选: 向量搜索 + RRF 融合
     │     │           │  ensureVectorIndex() 同步索引
     │     │           │  vectorSearch() 余弦相似度
     │     │           │  rrfFuse() 倒数排名融合 (α=0.20, k=60)
     │     │           └─ 结果标记 _vectorUsed
     │     ├─ 实体链查询 → lookupEntityChains()
     │     ├─ 管道合并 → mergePipelines() 多源融合（Map + ThreadIndex）
     │     ├─ 按实体分组 → groupCandidatesByEntity()
     │     ├─ buildEntityBlock() → 代码组装实体记忆链
     │     │     └─ 实体子标题 + 事件列表 + KB 认知标注
     │     ├─ buildKeyHighlights() → top-5 高相关度事件
     │     └─ compileRetrievalBudget() → Token 预算实体摘要（可选）
     │
     └─ 未启用 SmartPush → 按 dialogWindowRounds 截断对话
     │
     ▼
通过 injectPrompt() 注入到主 LLM 上下文
     │
     ▼
LLM 收到带结构化记忆（实体链 + KB 标注 + 缺口）的 prompt → 生成回复
```

### 4.4 Tool-calling 检索路径

```
LLM 调用 access(ref)
     │
     ├─ "msg#95" or "95" → 返回原始消息文本
     ├─ "stm_12" or "ltm_3" → 返回记忆条目详情
     ├─ "chain.龙牙剑" → 返回实体完整时间线
     ├─ "characters.爱丽丝" → 返回角色卡完整状态
     ├─ "factions.House Frost" → 返回势力详情
     └─ "quests.Main" → 返回任务详情

LLM 调用 recall_memory(query)
     │
     ├─ parseTimeConstraint: 解析时间约束
     ├─ BM25 filterCandidates: 检索候选记忆
     ├─ 跨语言翻译增强: 中英双语检索合并
     ├─ msg_id 指纹去重: 避免重复展示
     ├─ LLM callMemoryRetrieval: 合成叙事回答
     └─ 回退: formatBM25Fallback (LLM 不可用时)
```

### 4.5 矛盾检测流程（可选）

```
AI 生成回复后
     │
     ▼
detectContradictions()
     │
     ├─ extractClaims: LLM 提取事实主张
     ├─ verifyClaim: BM25 检索 + LLM 比对
     └─ 若 confidence ≥ 0.6 且矛盾
           │
           ▼
     buildContradictionSystemMessage()
           │
           ▼
     注入证据 system message → 触发 LLM 重新生成
```

---

## 5. 关键类与接口

### 5.1 Vault 数据结构

```javascript
{
  chat_id: string,          // 对话标识
  version: number,          // 递增版本号（每次 saveVaultWithSnapshot +1）
  tokens: number,           // 累计 token 消耗
  updated_at: string,       // ISO 更新时间
  _meta: {
    created_at: string,               // 创建时间
    last_pipeline_task: string|null,   // 上次管线任务类型
    last_pipeline_time: string|null    // 上次管线执行时间
  },
  content: {
    language: string,        // 语言标记（'zh' / 'en'）

    // 叙事时间
    story_time: string,     // 当前故事时间（如 "Day 3 傍晚"）
    story_scene: string,    // 当前场景（如 "龙牙酒馆"）
    story_date: string,     // 故事日期（如 "2024-03-15"）
    summary: string,        // 开场摘要（初始化时生成）

    // 结构化状态
    state_css: string,      // State 面板自定义 CSS（可编辑）
    state: {
      main_event: string,             // 当前主线事件
      present_characters: string,     // 出场角色
      characters: {                   // 角色卡状态
        [name]: {
          status: '活跃'|'非活跃'|'已退场',
          gender_age: string,
          occupation: string,
          personality: string,
          clothing_build: string,
          inventory: { gold: number, items: Array },
          injuries: string,
          status_effects: string,
          inner_thoughts: string,     // NPC only
          affection: number,          // NPC only
          relationship: string,       // NPC only
          current_mood: string,       // NPC only
          past_experience: string,    // NPC only
          power_slots: { ... }        // 战力值
        }
      },
      factions: {                     // 势力状态
        [name]: {
          name, description, leader,
          attitude_toward_player, notes,
          relations: { [targetFaction]: status }
        }
      },
      quests: {                       // 任务/目标/事件
        tasks: {
          [name]: { name, status, type, issuer, desc, progress,
                    posted_time, deadline, reward, penalty }
        },
        goals: {
          [name]: { name, status, desc, progress,
                    posted_time, completed_time }
        },
        events: {
          [name]: { name, status, desc,
                    started_time, ended_time }
        }
      },
      npc_names: string[]             // NPC 名字列表
    },
    state_schema: object|null,        // 状态 Schema 定义（可编辑）
    character_schema: object|null,    // 角色卡 Schema 定义（可编辑）

    // 记忆条目
    ltm_entries: [],                  // 长期记忆条目
    stm_entries: [],                  // 已整合 STM 条目
    unconsolidated_stm: [],           // 未整合 STM 条目（活跃区）

    // 处理游标
    cursor_state: {
      stm: { completedTurns: number, position: number, pending_partials: Array },
      ltm: { position: number, pending_partials: Array }
    }
  }
}
```

### 5.2 STM Entry 结构

```javascript
{
  id: 'stm_<N>',            // 唯一标识（如 stm_001）
  event: string,            // 事件描述（20-80 字简洁事实陈述）
  period: string,           // 时间段（如 "Day 3 傍晚"）
  scene: string,            // 场景名
  status: 'closed'|'partial', // 事件状态：closed=完整事件, partial=待续
  entity: string,           // 主要实体名
  turns: [startNum, endNum],   // Turn 范围索引
  msg_ids: [...],           // 关联消息 ID 数组
  entities: [{name, type}], // 关联实体（type: character|item|faction|concept|location|event）
  parent_ltm: string|null,  // 父 LTM id（整合后回填）
  timestamp: string         // ISO 时间戳
}
```

### 5.3 LTM Entry 结构

```javascript
{
  id: 'ltm_<N>',            // 唯一标识（如 ltm_001）
  title: string,            // 标题（截取 event 前 40 字）
  event: string,            // 整合后的事件描述
  scene: string,            // 主场景
  time_range: string,       // 时间范围（如 "Day 3 上午 → Day 5 傍晚"）
  period: string,           // 时间段（兼容字段）
  status: 'open'|'closed',  // 弧线状态：open=可追加STM, closed=已完结
  stm_refs: ['stm_X', ...], // 引用的 STM id 列表（≥ minLtmMerge）
  msg_ids: [...],           // 所有关联消息 ID（从 stm_refs 展开）
  entities: [{name, type}]  // 关联实体
}
```

### 5.4 State Schema 结构

```javascript
// DEFAULT_GLOBAL_SCHEMA
{
  characters: {
    type: 'object',
    description: '每个角色卡的状态',
    additionalProperties: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        gender_age: { type: 'string', max_length: 80 },
        occupation: { type: 'string', max_length: 120 },
        personality: { type: 'string', max_length: 300 },
        status: { type: 'string', enum: ['活跃', '非活跃', '已退场'] },
        clothing_build: { type: 'string', max_length: 200 },
        inventory: { type: 'object' },
        injuries: { type: 'string', max_length: 300 },
        status_effects: { type: 'string', max_length: 300 },
        power_slots: { type: 'object' }
      }
    }
  },
  factions: { /* name, description, leader, relations 等 */ },
  quests: { /* tasks {}, goals {}, events {} 三个子块 */ }
}
```

### 5.5 Runtime 接口

```typescript
interface Runtime {
  getChatId(): string;
  getChat(): Array<{id, role, mes, name, is_user}>;
  getChatMetadata(): object;
  saveChat(): Promise<void>;
  getCharacters(): Array<object>;
  getWorldInfo(): { entries: object, globalSelect: Array };
  readonly maxContext: number;
  getLanguage(): string;
  generateQuiet(prompt: string, systemPrompt?: string): Promise<string>;
  generateRaw(opts: object): Promise<string>;
  on(name: string, fn: Function): void;
  emit(name: string, data: any): void;
  injectPrompt(key: string, value: string, position?: string, depth?: number, role?: string): void;
  getLorebookEntries(bookName: string): Promise<Array>;
  setLorebookEntries(bookName: string, entries: Array): Promise<void>;
  createLorebookEntries(bookName: string, entries: Array): Promise<void>;
  deleteLorebookEntries(bookName: string, uids: Array): Promise<void>;
  getLorebooks(): Promise<Array>;
  getParentDoc(): Document;
  notify(msg: string, title?: string, opts?: object): void;
  confirm(msg: string): boolean;
}
```

### 5.6 Pipeline Guard 状态机

```
                    ┌──────────────────────────┐
                    │                          │
                    ▼                          │
  ┌──────┐   tryAcquire   ┌─────────┐  transitionTo  ┌─────────┐  transitionTo  ┌─────────┐
  │ idle │ ─────────────→ │  state  │ ──────────────→ │   stm   │ ──────────────→ │   ltm   │
  └──────┘                └─────────┘                 └─────────┘                 └─────────┘
      ▲                                                                                │
      │                         releasePipeline()                                       │
      └────────────────────────────────────────────────────────────────────────────────┘

  waitForPipelineTrackIdle(): 非idle时注册Promise到等待队列，idle时批量resolve
  reset(): 强制重置到idle（异常恢复用）
```

---

## 6. 依赖关系

### 6.1 外部 npm 依赖

| 依赖 | 版本 | 类型 | 用途 |
|------|------|------|------|
| `gpt-tokenizer` | ^3.4.0 | runtime | GPT token 精确计数（cl100k_base 编码） |
| `rollup` | ^4.60.4 | dev | 构建打包（IIFE 格式输出） |
| `@rollup/plugin-babel` | ^7.1.0 | dev | ES6+ 转译为 ES5 兼容代码 |
| `@rollup/plugin-commonjs` | ^29.0.3 | dev | CommonJS → ESM 模块转换 |
| `@rollup/plugin-node-resolve` | ^16.0.3 | dev | node_modules 中的依赖解析 |
| `@rollup/plugin-terser` | ^1.0.0 | dev | 代码压缩（保留 console.log） |
| `@babel/core` | ^7.29.7 | dev | Babel 编译核心 |
| `@babel/preset-env` | ^7.29.7 | dev | ES6+ 语法降级 |

### 6.2 运行时环境依赖

| 依赖 | 说明 |
|------|------|
| **SillyTavern** (前端) | 提供 `SillyTavern.getContext()` 等全局 API |
| **Tavern Helper** (TH / JS-Slash-Runner) | 提供 `ToolManager`、`injectPrompts`、Lorebook 管理 |
| **jQuery** | UI 渲染准备（`$(fn)` 延迟初始化） |
| **toastr** | 通知弹窗提示 |
| **IndexedDB** | 浏览器本地持久化存储（Vault + 快照） |
| **localStorage** | 设置、遥测、副 API 配置、Embedding API 配置 |
| **fetch API** | HTTP 调用 LLM API 和 Embedding API |

### 6.3 构建产物

| 输入 | 输出 | 格式 | 说明 |
|------|------|------|------|
| `src/adapter/index.js` | `dist/index.js` | IIFE（立即执行） | ST 生产扩展入口 |
| 全局名 | `NEMemoryEngine` | `window` 暴露 | 脚本加载后全局可用 |
| External | `jQuery`, `$`, `TavernHelper`, `SillyTavern`, `ToolManager` | 运行时由宿主提供 | 不打包进产物 |
| — | [`dist/test-harness.js`](file:///d:/SillyTavern/xm/ne-memory/dist/test-harness.js) | 纯 JS | 浏览器控制台测试工具（`NEMTest` 全局对象），包含 seed 消息、运行检索、生成报告等辅助函数 |
| — | [`dist/th-test.js`](file:///d:/SillyTavern/xm/ne-memory/dist/th-test.js) | 纯 JS | TH 脚本加载验证，设置 `window.__NE_TEST_DONE__` 标记 |
| `update.js.bak` | — | — | `update.js` 重构前的完整备份（用于拆分 ltm/stm/state 子管线） |
| `panel.js.bak` | — | — | `panel.js` 重构前的完整备份（面板拆分前的原始版本） |
| [`scripts/extract-precise.cjs`](file:///d:/SillyTavern/xm/ne-memory/scripts/extract-precise.cjs) | — | CJS | 从 `update.js.bak` 精确提取代码行范围的辅助脚本 |
| `_old_consolidate.js` | — | — | consolidate 逻辑的旧版本备份 |
| [`jsconfig.json`](file:///d:/SillyTavern/xm/ne-memory/jsconfig.json) | — | JSON | VS Code JS 配置（ES2020 + ESNext 模块 + 类型检查） |

### 6.4 Rollup 配置

```javascript
// rollup.config.mjs
input: 'src/adapter/index.js'
output: { format: 'iife', name: 'NEMemoryEngine', file: 'dist/index.js',
          globals: { '$': '$', 'jQuery': '$' } }
external: ['jQuery', '$', 'TavernHelper', 'SillyTavern', 'ToolManager']
plugins: [resolve({ browser: true }), commonjs({ include: 'node_modules/**' }),
          babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'], exclude: 'node_modules/**' }),
          terser({ compress: { drop_console: false, side_effects: false } })]
```

### 6.5 模块间依赖图（简化）

```
adapter/index.js (入口)
  ├── adapter/events.js ────────── engine/update.js ────────── api/llm.js
  │      │                              │                         │
  │      ├── engine/contradiction.js    ├── engine/state-pipeline.js  ├── chat-telemetry.js
  │      ├── engine/injection.js        ├── engine/stm-pipeline.js   ├── token-stats.js
  │      ├── vault/schema.js            ├── engine/pipeline-shared.js
  │      ├── vault/versions.js          ├── engine/consolidate.js
  │      └── vault/garbage-collector.js ├── engine/pipeline-guard.js
  │                                     ├── engine/retrieval-fusion.js
  │                                     ├── engine/retrieval-text.js
  │                                     ├── vault/store.js
  │                                     ├── vault/schema.js
  │                                     ├── turn-segmenter.js
  │                                     ├── bm25-grouper.js
  │                                     ├── validate.js
  │                                     ├── text-utils.js
  │                                     └── json-fallback.js
  ├── adapter/panel-init.js (barrel: panel.js)
  │   ├── panel-shared.js ── panel-drawer.js / panel-popout.js
  │   │                    ── panel-content.js / panel-settings.js
  │   │                    ── panel-state-cards.js / panel-usage.js
  │   │                    ── panel-tools.js
  │   └── panel-popout.js ── panel-content.js
  ├── adapter/bootstrap.js ── core/auto-restore.js ── vault/store.js
  ├── adapter/test-driver.js ── core/test-runner/
  ├── adapter/test-runner.js ── core/test-runner/files.js
  ├── core/runtime.js (接口定义)
  ├── core/tools.js ── vault/store.js + vault/retrieval-filter.js + api/llm.js
  ├── core/settings.js (独立，读写 localStorage)
  ├── core/params.js (独立，读写 localStorage)
  ├── core/i18n.js (独立，纯静态翻译表)
  ├── core/types.js (纯 JSDoc @typedef，零运行时开销)
  └── src/globals.d.ts (IDE 类型声明，不参与运行时)
```

### 6.6 数据存储位置

| 位置 | Key / DB | 内容 |
|------|----------|------|
| IndexedDB | `ne_memory_vaults` | Vault 数据（`vaults` store） + 快照（`snapshots` store） |
| localStorage | `ne_settings` | 用户设置（stmBatch, contextWindowRounds, apiUrl 等） |
| localStorage | `ne_chat_stats` | Per-chat 逐轮遥测统计数据 |
| localStorage | `ne_stm_telemetry` | STM 提取遥测日志 |
| localStorage | `ne_params_auto` | 自动调参开关状态 |
| localStorage | `ne_secondary_api` | 副维护 API 配置（url, key, model） |
| localStorage | `ne_retrieval_api` | 检索 API 配置 |
| localStorage | `ne_embedding_api` | Embedding API 配置 |
| localStorage | `ne_pending` / `ne_inflight` | 暂存消息缓冲区（崩溃恢复） |
| chat_metadata | `ne_vault` | Vault JSON 嵌入聊天文件（随导出/备份迁移） |

---

## 7. 项目运行方式

### 7.1 构建

```bash
# 安装依赖
npm install

# 构建（生成测试数据 + Rollup 打包）
npm run build

# 产物位于 dist/index.js
```

构建流程：
1. `scripts/generate-test-data.cjs` — 扫描 `test-cases/` 目录，生成 `src/core/test-runner/test-data.generated.js`
2. `rollup -c` — 打包 `src/adapter/index.js` → `dist/index.js`（IIFE，全局名 `NEMemoryEngine`）

### 7.2 在 SillyTavern 中安装

1. 确保已安装 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)
2. 在 TH 脚本管理器中点击**导入**，粘贴以下 JSON：

```json
{
  "type": "script",
  "enabled": true,
  "name": "NE Memory Engine v6.3",
  ...
  "content": "(function(){var s=document.createElement('script');s.src='https://gcore.jsdelivr.net/gh/Melody-0321/NE-Memory@test6.3/dist/index.js';s.onerror=function(){var f=document.createElement('script');f.src='https://cdn.jsdelivr.net/gh/Melody-0321/NE-Memory@test6.3/dist/index.js';document.head.appendChild(f)};document.head.appendChild(s)})()",
  "info": "🧠 v6.3 — 持久化 Bug 集中修复 · 设置面板/记忆编辑/处理历史/滑动关闭"
}
```

3. 启用脚本，Memory Vault 面板会自动出现在 TH 弹窗中

### 7.3 开发模式

```bash
# 监听模式（文件变更自动重新构建）
npm run watch

# 配合本地文件引入进行调试
# content: "import('http://localhost:8080/dist/index.js')"
```

### 7.4 单元测试

```bash
# 运行全部单元测试（需要 Node.js 环境）
npm run test:unit

# 运行架构棘轮测试
npm run test:ratchet

# 两者一起运行
npm test
```

测试文件位于 `test/` 目录（使用 Node.js `test/run.mjs` 运行，通过 `mock-runtime.js` 模拟 ST 环境）：

| 测试文件 | 用途 |
|---------|------|
| `test/consolidate.test.js` | LTM 整合单元测试 |
| `test/consolidate-core.test.js` | LTM 归并核心逻辑（`findOpenLtm`、`computeClosureSignals`） |
| `test/consolidate-apply.test.js` | `applyLtmDecision`、`findOpenLtm` 查找/追加逻辑 |
| `test/state-discovery.test.js` | State 发现测试 |
| `test/pipeline-guard.test.js` | Pipeline 守卫测试 |
| `test/concurrency-guard.test.js` | 并发守卫测试 |
| `test/text-utils.test.js` | 文本工具测试 |
| `test/context-window.test.js` | ⚠ 上下文窗口测试（源文件已删除，测试待迁移） |
| `test/dialog-window.test.js` | 对话框窗口上下文测试 |
| `test/ltm-rebatch-call-pattern.test.js` | LTM 批处理模式测试 |
| `test/ltm-rebatch.test.js` | `splitStmsIntoContiguousGroups` 分组测试 |
| `test/ltm-validate.test.js` | `validateLTMOutput` / `postFillLTM` 验证测试 |
| `test/stm-validate.test.js` | `validateSTMOutput` / `validateMsgRanges` 验证测试 |
| `test/bm25-grouper.test.js` | `preGroupItems` 分组测试 |
| `test/bm25-scoring.test.js` | `buildSearchableText` / `bm25Score` 打分测试 |
| `test/json-fallback.test.js` | `safeJsonParse` 五阶段降级测试 |
| `test/kb-annotations.test.js` | KB 注释解析测试 |
| `test/entity-seed.test.js` | 实体种子命名规则与提取测试 |
| `test/entity-grouping.test.js` | 实体分组与去重测试 |
| `test/merge-story-period.test.js` | `mergeStoryPeriod` 格式化测试 |
| `test/notebook-core.test.js` | `RetrievalNotebook` 核心操作测试 |
| `test/notebook-sort.test.js` | `RetrievalNotebook` 排序/边界测试 |
| `test/schema.test.js` | Schema `validateField` / `resolveSchemaPath` 测试 |
| `test/smartpush-query.test.js` | `estimateComplexityBudget` / `resolveAmbiguousReferences` 测试 |
| `test/time-filter.test.js` | `parseTimeConstraint` / `applyTimeFilter` 测试 |
| `test/turn-segmenter.test.js` | `groupMessagesIntoTurns` 配对分组测试 |
| `test/run-ratchets.mjs` | 棘轮测试运行器（依次运行三个棘轮测试） |
| `test/ratchet-arch-layers.test.js` | 架构分层约束棘轮（`core/` 不得 import `adapter/` 或 `panel/`） |
| `test/ratchet-dead-exports.test.js` | 死导出检测棘轮 |
| `test/ratchet-empty-catch.test.js` | 空 `catch` 块计数棘轮（基线 3 个不允许增长） |

### 7.5 通过 `__ne_debug` API 手动操作

```javascript
// 手动触发 pipeline
__ne_debug.triggerPipeline()

// 导出 vault
__ne_debug.exportVault()

// 列出所有测试
__ne_debug.listTests()

// 运行指定测试
__ne_debug.runTestByName('smartpush-01-not-empty')

// 手动触发 state 提取
__ne_debug.extractState()
```

---

## 8. 测试体系

### 8.1 测试层次结构

```
test-cases/
  ├── retrieval/         # 检索功能测试（smartpush-01~06/08/09/12/15, group-a/b, retrieval-55/58）
  │   ├── smartpush-01-not-empty/
  │   ├── smartpush-02-no-markers/
  │   ├── smartpush-03-long-run/
  │   ├── smartpush-04-stm-zero/
  │   ├── smartpush-05-dedup/
  │   ├── smartpush-06-scene-switch/
  │   ├── smartpush-08-visible-window-skip/
  │   ├── smartpush-09-visible-window-precision/
  │   ├── smartpush-12-prompt-structure/
  │   ├── smartpush-15-hybrid-retrieval/
  │   ├── smartpush-group-a/
  │   ├── smartpush-group-b/
  │   ├── retrieval-55-system-prompt-structure/
  │   └── retrieval-58-short-chain-inline/
  ├── pipeline/          # 管线功能测试
  │   ├── integ-msg-delete/
  │   ├── ltm-consolidate/
  │   ├── pipeline-state-01~06/
  │   ├── pipeline-stm-01/
  │   ├── state-field-validate/
  │   ├── state-merge-retain/
  │   ├── stm-scene-switch/
  │   ├── vault-dedup-msg/
  │   └── vault-msg-rollback/
  └── smoke/             # 冒烟测试（全链路）
      └── smartpush-14-full-chain-smoke/
```

### 8.2 测试用例结构

每个测试用例目录包含：
- `test-case.md` — YAML frontmatter + Markdown 描述的测试规范（包含 seed 消息、轮次定义、断言规则）
- `*-report.md` — 测试报告（自动生成，含逐轮 Token 用量表、总耗时、断言结果）
- `*-trace.md` — 测试追踪日志（自动生成，含逐轮 LLM 调用详情、Pipeline 状态变更）

### 8.3 模板

- `test-cases/_template.md` — 新建测试用例的模板文件

### 8.4 断言类型

**结构性断言**（`assertions.js`）：
- `min_length` / `max_length` — 字符串长度范围
- `contains` / `not_contains` — 子串包含检查
- `equals` — 精确匹配
- `exists` — 字段存在性
- `regex` — 正则匹配
- `type` — 类型检查

**语义性断言**（LLM 驱动）：
- 三态结果：`passed=true`（通过）/ `false`（失败）/ `null`（不确定）
- 由 LLM 根据注入内容和问题判断记忆检索质量

### 8.5 测试运行方式

通过浏览器 Console 中的 `__ne_debug` API 触发：
```javascript
// 运行指定测试
__ne_debug.runTestByName('smartpush-01-not-empty')

// 列出所有测试
__ne_debug.listTests()

// 运行冒烟测试
__ne_debug.runTestByName('smartpush-14-full-chain-smoke')
```

测试框架通过 `test-runner/monitor.js` 采集 Pipeline LLM 调用数据（通过全局 Hook `window.__ne_llm_hook`），由 `test-runner/assertions.js` 评估断言结果，最终由 `test-runner/files.js` 生成 trace 和 report 文件。

### 8.6 辅助测试文件

| 文件 | 用途 |
|------|------|
| `test/mock-runtime.js` | Mock SillyTavern runtime 环境用于单元测试 |
| `test/run.mjs` | Node.js 测试运行入口 |
| `test/run-ratchets.mjs` | 棘轮测试运行器（`npm run test:ratchet`） |
| `test/ratchet-arch-layers.test.js` | 架构分层棘轮：确保 `core/` 不依赖 `adapter/` 或 `panel/` |
| `test/ratchet-dead-exports.test.js` | 死导出检测棘轮：扫描无引用的 export |
| `test/ratchet-empty-catch.test.js` | 空 catch 块计数棘轮：只减少不增长 |
| `test5.0.json` / `test5.1.json` | 测试用配置预设 |
| `testv4.1.json` / `testv4.2.json` | 旧版测试配置 |

---

> 本文档基于 `ne-memory` v6.0.0 生成。项目持续迭代中，请以实际代码为准。

## v5.6 → v6.0 核心变更

| 类别 | 变更 |
|------|------|
| **SmartPush** | 检索 LLM 合成全面删除（`ce0fc40`）。`formatSmartContext` 改为纯本地管线：BM25 → 可选向量 RRF → 实体链分组 → `buildEntityBlock` 代码组装注入文本。零额外 API 成本。 |
| **Pipeline** | `update.js`（1743 行）拆分为 `stm-pipeline.js` / `state-pipeline.js` / `ltm-pipeline.js` / `pipeline-guard.js` / `pipeline-shared.js`。STM/State 可并行执行（独立锁）。 |
| **注入格式** | 从 LLM 叙事散文合成切换为 HL+GP 代码拼装实体链块。`buildEntityBlock` 自动生成实体子标题 + 事件列表 + KB 标注。 |
| **工具** | 仅保留 `access` + `recall_memory`（从 5 个精简）。`update_state` / `rollback_memory` / `callMemoryLLMWithTools` 移除。 |
| **上下文窗口** | `context-window.js` 删除，替换为 `dialogWindowRounds` 对话轮数截断。 |
| **Token 优化** | 砍掉 STM prompt 中角色心理状态段；LTM 弧开放时用占位符互补标题/摘要。 |
| **面板** | `panel.js` 拆分为 8 模块；移除 Entity 面板和 State Schema / Smart Retrieval 开关。 |
| **向量搜索** | BM25+Vector RRF 融合（α=0.20 BM25 权重, k=60）+ 一键预设 SiliconFlow bge-m3。 |
| **修复** | 检索 0 命中（STM<15 bypass 遗漏 `__relevance`）+ NE-CHAR 泄漏 + NE-BANNER 折叠 + i18n 补全。 |