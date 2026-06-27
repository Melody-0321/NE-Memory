# NE Memory Engine — Code Wiki

> **SillyTavern 长对话结构化记忆管理引擎**
>
> 版本：基于 `4c04a31` | 语言：JavaScript (ES Modules) | 许可证：AGPL-3.0

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
| **STM/LTM 分层记忆** | 短期记忆 (STM) 自动提取，长期记忆 (LTM) 合并整合 |
| **增量更新** | 不重复处理同一消息，事件记忆消耗不随对话增长 |
| **三层穿透** | LTM 摘要 → STM 详情 → 原始对话原文 |
| **版本管理** | 30 个历史快照 + 精确回滚 |
| **状态维护** | Schema 驱动的字段级约束，LLM 只修改变化字段 |
| **Tool-calling** | 4 个注册工具（access / recall_memory / extract_stm / update_state） |
| **副 API 支持** | 记忆提取可用独立 API，节省主 API Token |
| **三语界面** | 简体中文 / 繁體中文 / English |
| **智能检索 (SmartPush)** | 生成前自动推送相关记忆到对话上下文 |
| **自动调参** | 根据历史统计数据自动调优各类阈值 |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                  SillyTavern 前端                        │
│               (浏览器运行时环境)                          │
├─────────────┬───────────────────────────────────────────┤
│   Tavern    │  NE Memory Engine                         │
│   Helper    │                                           │
│ (事件/注入/ │  ┌────────────────────────────────────┐  │
│  工具管理)  │  │  adapter/ ST 适配层                │  │
│             │  │  index.js → events.js → panel.js   │  │
│             │  └────────────┬───────────────────────┘  │
│             │               │                           │
│             │  ┌────────────▼───────────────────────┐  │
│             │  │  core/ 核心引擎 (平台无关)          │  │
│             │  │                                     │  │
│             │  │  runtime.js ← 依赖注入接口          │  │
│             │  │                                     │  │
│             │  │  ┌──────────────────────────────┐  │  │
│             │  │  │ engine/ 记忆流水线            │  │  │
│             │  │  │ update → stm-extractor →      │  │  │
│             │  │  │ consolidate → injection       │  │  │
│             │  │  │ retrieval → contradiction     │  │  │
│             │  │  └──────────┬───────────────────┘  │  │
│             │  │             │                       │  │
│             │  │  ┌──────────▼───────────────────┐  │  │
│             │  │  │ api/llm.js LLM 调用层         │  │  │
│             │  │  └──────────────────────────────┘  │  │
│             │  │             │                       │  │
│             │  │  ┌──────────▼───────────────────┐  │  │
│             │  │  │ vault/ 存储层                 │  │  │
│             │  │  │ store.js (IndexedDB)          │  │  │
│             │  │  │ schema.js (状态Schema)        │  │  │
│             │  │  │ versions.js (快照管理)        │  │  │
│             │  │  └──────────────────────────────┘  │  │
│             │  └─────────────────────────────────────┘  │
└─────────────┴───────────────────────────────────────────┘
```

### 分层设计理念

项目采用 **适配器模式** + **依赖注入**，将 SillyTavern 平台依赖全部集中在 `src/adapter/` 层。`src/core/` 通过 `runtime.js` 定义抽象接口，由 `index.js` 在启动时将 SillyTavern API 注入到 runtime。这使得核心引擎逻辑理论上可以在其他平台复用。

---

## 3. 模块职责详解

### 3.1 adapter/ — SillyTavern 适配层

#### 3.1.1 [index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js) — 入口 + 依赖注入

**职责**：引擎启动入口，负责将 SillyTavern / TavernHelper 的 API 注入到 `runtime` 对象中。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `bootNE()` | 引擎启动（等待 jQuery 就绪后调用 `init()`） |
| `init()` | 核心初始化：加载设置 → bootstrap → 注册事件监听 → 注册工具 |
| `getChatId()` | 获取当前聊天 ID（优先使用 fingerprint 策略） |
| `_buildDebugApi()` | 构造 `__ne_debug` 全局调试 API |
| `setupEventListeners()` | 带重试的事件监听注册（支持 eventSource 和 TavernHelper 两种机制） |
| `registerToolsWithRetry()` | 带指数退避的工具注册 |

**Runtime 注入**：通过 `Object.assign(runtime, {...})` 将以下 API 注入 `runtime`：
- `getChatId` / `getChat` / `getChatMetadata` / `saveChat` — 对话数据
- `getCharacters` / `getWorldInfo` — 角色和世界书
- `generateQuiet` / `generateRaw` — LLM 生成调用
- `on` / `emit` — 事件系统
- `injectPrompt` — prompt 注入
- `getLorebookEntries` / `setLorebookEntries` 等 — 世界书（Lorebook/WorldBook）管理
- `notify` / `confirm` — 通知与确认 UI

#### 3.1.2 [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) — 事件绑定与记忆注入

**职责**：绑定 ST 事件，驱动整个记忆流水线的触发时机。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `onMessageSent()` | 用户发送消息 → 加入 pending 缓冲区 |
| `onMessageReceived()` | AI 回复完成 → 触发增量更新 + 矛盾检测 |
| `onBeforeGenerate()` | 生成前 → 执行 SmartPush 智能记忆注入 |
| `onMessageDeleted()` / `onMessageSwiped()` | 消息删除/滑动 → 回滚相关记忆 |
| `onMessageUpdated()` | 消息编辑 → 标记待重处理 |

**核心流程**：
1. 用户消息 → `onMessageSent` → 存入 `pendingMessages[]`
2. `pendingMessages` 达到 `stmBatch` 阈值 → 在 `onMessageReceived` 时触发完整 pipeline
3. Pipeline 顺序：State 提取 → STM 提取 → LTM 整合
4. 每次生成前 → `onBeforeGenerate` → 根据设置注入记忆或 SmartPush 上下文

#### 3.1.3 [panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js) — Memory Vault UI

**职责**：渲染记忆管理面板（包括设置弹窗、记忆列表、状态面板、用量统计等）。

#### 3.1.4 [bootstrap.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/bootstrap.js) — 初始化引导

**职责**：引擎初始化逻辑，包括 Vault 加载、设置应用、迁移、面板渲染、副 API 自动连接。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `bootstrapVault(chatId, locale, settings)` | 主引导函数 |
| `migrateVaultIfNeeded(chatId, vault)` | 从旧 'default' key 迁移到 fingerprint key |

#### 3.1.5 [test-driver.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-driver.js) — 自动化测试驱动

**职责**：LLM 驱动的自动化测试循环。执行 seed 消息、监听管线、收集数据、评估断言。

#### 3.1.6 [test-runner.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-runner.js) — 测试运行器

**职责**：测试用例发现与 orchestration。

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

**职责**：统一的 LLM 调用入口，支持副 API 和 TavernHelper 双通道。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `callMemoryLLM(messages, options)` | 记忆 LLM 主调用（优先副 API，失败回退 TH） |
| `callMemoryPipeline(...)` | Pipeline 专用调用（STM / State / LTM 提取） |
| `callMemoryRetrieval(...)` | 检索专用调用（Smart Push / recall_memory） |
| `callMemoryRetrievalWithTools(...)` | 带 tool-calling 的检索调用 |
| `testSecondaryApiConnection(cfg)` | 副 API 连通性测试 |
| `recordTelemetry(entry, chatId)` | 遥测数据记录 |
| `initPowerSlots(state)` | 初始化角色的战力槽（power slots） |
| `onPipelineLLMCall(fn)` / `offPipelineLLMCall(fn)` | Pipeline LLM 调用钩子（测试用） |

---

### 3.4 core/engine/ — 记忆流水线引擎

#### 3.4.1 [pipeline-guard.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/pipeline-guard.js) — 流水线并发守卫

**职责**：确保 State → STM → LTM 三个阶段串行执行，防止并发冲突。

**状态机**：`idle → state → stm → ltm → idle`

| 函数 | 说明 |
|------|------|
| `tryAcquire(targetState)` | 尝试获取 pipeline 所有权 |
| `transitionTo(newState)` | 状态转移 |
| `releasePipeline()` | 释放 pipeline，唤醒所有等待者 |
| `isIdle()` / `getPipelinePhase()` | 状态查询 |
| `waitForPipelineTrackIdle(timeoutMs)` | 等待 pipeline 变为 idle |

#### 3.4.2 [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) — 增量更新引擎

**职责**：Pipeline 的主 orchestrator。协调 State 提取 → STM 提取 → LTM 整合全流程。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `executeIncrementalUpdate(chatId, messages)` | 核心增量更新入口 |
| `extractStateChangesOnly(chatId, messages, vault)` | 仅提取 State 变更 |
| `runLtmDecision(...)` | LTM 整合决策与执行 |
| `saveVaultWithSnapshot(chatId, vault)` | 原子写 vault + 快照 |
| `ensureStateStructure(vault)` | 初始化 / 迁移 vault state 结构 |

**处理流程**：
1. 收集已处理 msg_id 集合（去重）
2. 过滤出新消息
3. 将消息分组为 turns
4. 如果启用 State Schema → 构建 State injection table → 提取 State 变更
5. 批处理 turns → 调用 LLM 提取 STM entries
6. 如果 STM 未整合数达到阈值 → 触发 LTM 整合
7. 保存 vault + 快照 + 同步到 chat_metadata

#### 3.4.3 [stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-extractor.js) — STM 批量提取器

**职责**：将 turns 分批发送给 LLM，以 JSON 格式提取 STM 事件。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `runStmExtractorCore(turns, params)` | 单批 STM 提取核心 |
| `processTurnsInBatches(turns, params)` | 多批轮转提取（带 cursor） |

#### 3.4.4 [consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/consolidate.js) — STM→LTM 整合

**职责**：将多条未整合的 STM 条目合并为 LTM 条目。支持 open/closed LTM 状态。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `isLtmEnabled(vault)` | 判断是否需要触发 LTM 整合 |
| `getNextEligibleStmId(vault)` | 获取下一个待整合 STM id |
| `computeClosureSignals(openLtm, newStmEvents)` | 计算弧线闭合信号（时间跨度、角色重合、场景切换） |
| `runLtmRebatch(...)` | 触发 LTM 批处理 |
| `applyLtmDecision(vault, decision)` | 应用 LTM 决策结果 |

#### 3.4.5 [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js) — Smart Context 注入

**职责**：在每次生成前构建 Smart Push 上下文，包含相关记忆和状态信息。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `formatSmartContext(vault, chatMessages, budget)` | 构建 Smart Push 上下文 |
| `buildStateOnlyInjection(vault)` | 纯状态注入（无记忆时） |
| `estimateComplexityBudget(chatMessages, defaultBudget)` | 基于查询复杂度估算预算 |

#### 3.4.6 [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js) — 检索服务

**职责**：实体链查找、检索 prompt 构建。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `lookupEntityChains(content, entityNames)` | 查找实体的时间线链 |
| `extractEntityNames(query, content)` | 从查询中提取已知实体名 |
| `buildRetrievalMessagesLegacy(query, candidates, vault, budget, isSummaryMode)` | 构建检索 LLM prompt |
| `buildRetrievalMessages(...)` | v2 检索 prompt 构建 |

#### 3.4.7 [context-window.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/context-window.js) — 上下文窗口管理

**职责**：管理对话窗口内可见的记忆注入策略。最近 N 轮用完整文本，更早的用记忆摘要。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `computeWindowStartMsgId(chatMessages, contextWindowRounds)` | 计算窗口边界 |
| `formatContextMemory(vault, chatMessages, contextWindowRounds)` | 构建窗口前记忆摘要 |

#### 3.4.8 [contradiction.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/contradiction.js) — 矛盾检测

**职责**：AI 生成回复后检测事实矛盾。若检测到矛盾，注入原文证据并触发 LLM 重新生成。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `detectContradictions(chatId, aiMessage)` | 检测回复中的事实矛盾 |

#### 3.4.9 [ambiguity.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/ambiguity.js) — 模糊引用解析

**职责**：解析用户消息中的模糊引用（"那个铁匠"、"上次的事"），映射为具体实体名以提升 BM25 检索精度。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `resolveAmbiguousReferences(query, content)` | 解析模糊引用 |

#### 3.4.10 [bm25-grouper.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/bm25-grouper.js) — BM25 预分组器

**职责**：对输入消息计算相邻 BM25 相似度矩阵，生成语义预分组提示，辅助 LLM 更好地切分事件边界。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `preGroupItems(items, textExtractor)` | BM25 相似度分组 |
| `formatPreGroupHint(groups)` | 格式化分组提示 |

#### 3.4.11 [turn-segmenter.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/turn-segmenter.js) — 对话轮次分割

**职责**：将扁平消息列表按 (user, assistant) 配对分组为 turns。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `groupMessagesIntoTurns(messages)` | 消息→turns 分组 |
| `formatTurnsText(turns, turnIndices)` | turns 格式化为 LLM prompt 文本 |
| `collectMsgIdsFromTurns(turns, turnIndices)` | 从 turns 中收集 msg_id |

#### 3.4.12 [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js) — STM 输出验证

**职责**：验证 LLM 输出的 STM 条目是否完整、msgRange 是否合法。

#### 3.4.13 [text-utils.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/text-utils.js) — 文本工具

**关键函数**：

| 函数 | 说明 |
|------|------|
| `countTokens(text)` | GPT token 计数（基于 `gpt-tokenizer` 库） |
| `tokenize(text)` | CJK-aware 分词器 |
| `vocabularyOverlap(textA, textB)` | 计算两段文本的词汇重叠度 |

#### 3.4.14 [telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/telemetry.js) — 遥测日志

**职责**：异常检测（异常/用户信号/Token 用量）。

#### 3.4.15 [chat-telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/chat-telemetry.js) — 对话级遥测

**职责**：Per-chat 逐轮遥测计数，存储 Token 用量、LLM 调用次数等。

#### 3.4.16 [token-stats.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js) — Token 用量统计

**职责**：Session / 月度 / 全局 Token 用量统计与展示。

#### 3.4.17 [worldbook-sync.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/worldbook-sync.js) — 世界书同步

**职责**：自动创建和管理 `NE_Memory_State` 世界书（Lorebook），用于在角色卡和世界书中同步状态信息。

---

### 3.5 core/vault/ — 记忆存储层

#### 3.5.1 [store.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/store.js) — IndexedDB CRUD

**职责**：记忆数据的持久化存储，每个 chat_id 对应 IndexedDB 中的一条记录。同时管理快照 store。

**数据库结构**：
- **Database**: `ne_memory_vault` (v3)
- **Store `vaults`**: `{ chat_id, vault, updated_at }`
- **Store `snapshots`**: `{ id, chat_id, version, updated_at, data }`（索引：chat_id）

**关键函数**：

| 函数 | 说明 |
|------|------|
| `openDB()` | 打开/创建 IndexedDB |
| `read(chatId)` | 读取 vault（带迁移和格式化） |
| `write(chatId, vault)` | 写入 vault |
| `writeWithSnapshot(chatId, vault, snapshot)` | 原子写 vault + 快照 |
| `remove(chatId)` | 删除 vault |
| `emptyVault(chatId)` | 创建空 vault 模板 |
| `appendSTMEntries(vault, stmEntries)` | 追加 STM 条目（去重） |
| `rollbackByMsgIds(vault, removedMsgIds)` | 按 msg_id 回滚 |
| `collectAllMsgIds(vault)` | 收集所有已处理的 msg_id |
| `sortStmByMsgOrder(entries)` | 按消息顺序排序 STM |
| `getCursorState(vault, mode)` | 获取处理游标状态 |
| `updateCursorState(vault, mode, state)` | 更新处理游标 |

#### 3.5.2 [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) — 状态 Schema 引擎

**职责**：驱动的动态状态管理系统，定义角色卡/势力/任务的字段约束和验证。

**默认 Schema 常量**：

| 常量 | 说明 |
|------|------|
| `DEFAULT_GLOBAL_SCHEMA` | 全局状态 Schema（角色/势力/任务） |
| `DEFAULT_CHARACTER_SCHEMA` | 角色卡 Schema（protagonist + npc 块） |
| `DEFAULT_FACTION_SCHEMA` | 势力 Schema |
| `DEFAULT_QUESTS_SCHEMA` | 任务/目标/事件 Schema |
| `POWER_SLOTS_TEMPLATES` | 战力槽模板（修仙/科幻/现代） |
| `DEFAULT_NPC_SCHEME` | 默认 NPC 字段方案 |

**关键函数**：

| 函数 | 说明 |
|------|------|
| `validateField(value, fieldSchema)` | 类型检查 + max_length + enum 校验 |
| `resolveSchemaPath(stateSchema, dotPath)` | dot-path 递归解析 Schema 定义 |
| `validateStateChanges(stateSchema, changes)` | 校验状态变更（未知字段警告不阻塞） |
| `mergeStateChanges(state, validatedChanges)` | dot-path 深度合并变更到 state |
| `buildStateInjectionTable(state, messages, maxItems, world)` | 构建状态注入表格 |
| `formatStateSummary(state, stateSchema)` | 格式化状态摘要 |
| `formatCharacterSummary(state, characterSchema)` | 格式化角色摘要 |
| `formatQuestSummary(state, currentTime)` | 格式化任务摘要 |
| `rebuildPresentCharacters(state)` | 从各角色 status 重建 present_characters |
| `ensureCharacterTemplate(state, name, schemeKey)` | 确保角色有完整模板字段 |

#### 3.5.3 [versions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/versions.js) — 版本快照管理

**职责**：IndexedDB 中的快照存储，上限 30 个（自动裁剪旧版本）。

#### 3.5.4 [retrieval-filter.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/retrieval-filter.js) — BM25 检索过滤

**职责**：纯浏览器端 BM25 检索引擎。

**关键函数**：

| 函数 | 说明 |
|------|------|
| `filterCandidates(query, allSTM, allLTM, topK)` | BM25 检索 + topK 排序 |
| `parseTimeConstraint(query)` | 从查询中解析时间约束 |
| `applyTimeFilter(entries, timeConstraint)` | 按时间过滤记忆条目 |

#### 3.5.5 [retrieval-notebook.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/retrieval-notebook.js) — 检索工作区

**职责**：检索会话内维持的 mutable Notebook，跟踪已访问条目和线程，支持增量 diff。

**类**: `RetrievalNotebook`
- `addEntry(stmId, unifiedEntry)` — 添加条目
- `addThread(threadId, threadDef)` — 注册线程
- `extendThread(threadId, stmId)` — 扩展线程
- `diff()` — 获取增量（新增/展开的条目和线程）

---

### 3.6 core/test-runner/ — 自动化测试框架

| 文件 | 职责 |
|------|------|
| [test-driver.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-driver.js) | LLM 驱动测试核心循环（实际在 adapter 目录） |
| [assertions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/assertions.js) | 结构断言和语义断言评估 |
| [files.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/files.js) | 测试文件管理、trace/report 生成 |
| [monitor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/monitor.js) | Pipeline LLM 调用监控与数据收集 |
| [test-data.generated.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/test-data.generated.js) | 自动生成的测试数据 |

---

### 3.7 core/ 根模块

| 文件 | 职责 |
|------|------|
| [runtime.js](file:///d:/SillyTavern/xm/ne-memory/src/core/runtime.js) | 抽象运行时接口定义 |
| [settings.js](file:///d:/SillyTavern/xm/ne-memory/src/core/settings.js) | 运行时标志位（检索开关、stmMinLtmMerge） |
| [params.js](file:///d:/SillyTavern/xm/ne-memory/src/core/params.js) | 自动调参系统（stmBatch / topK / chainDepth 等自动计算） |
| [tools.js](file:///d:/SillyTavern/xm/ne-memory/src/core/tools.js) | Tool-calling 注册与执行（access / recall_memory / extract_stm） |
| [i18n.js](file:///d:/SillyTavern/xm/ne-memory/src/core/i18n.js) | 三语翻译表与翻译函数 |
| [auto-restore.js](file:///d:/SillyTavern/xm/ne-memory/src/core/auto-restore.js) | Vault 加载与自动恢复 |

---

### 3.8 src/ui/ — UI 工具函数

| 文件 | 职责 |
|------|------|
| [utils.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/utils.js) | HTML 转义、本地时间格式化 |

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
     tryAcquire('state') — 获取 pipeline
           │
           ├─ 失败（已在运行）→ 等待下次触发
           │
           └─ 成功
               │
               ┌──────────────────────────┐
               │ 1. State 提取             │
               │   transitionTo('state')   │
               │   提取角色/势力/任务状态变更 │
               │   验证 → 合并 → 保存       │
               ├──────────────────────────┤
               │ 2. STM 提取               │
               │   transitionTo('stm')     │
               │   消息 → turns → 批处理    │
               │   LLM 提取事件 → 追加      │
               ├──────────────────────────┤
               │ 3. LTM 整合               │
               │   transitionTo('ltm')     │
               │   STM > 阈值 → 合并为 LTM  │
               ├──────────────────────────┤
               │ 4. 收尾                   │
               │   releasePipeline()       │
               │   保存 vault + 快照        │
               └──────────────────────────┘
```

### 4.2 SmartPush 注入流程

```
每次 AI 生成前 → onBeforeGenerate()
     │
     ▼
formatSmartContext() 或 formatContextMemory()
     │
     ▼
通过 TavernHelper.injectPrompts() 注入到对话上下文
     │
     ▼
LLM 收到带记忆上下文的 prompt → 生成回复
```

### 4.3 三层穿透检索路径

```
LTM 摘要（直接注入）
     │
     ▼
STM 详情（通过 tool-calling 调用 lookup_stm）
     │
     ▼
原始对话原文（通过 tool-calling 调用 lookup_memory_source 或 access msg#N）
```

---

## 5. 关键类与接口

### 5.1 Vault 数据结构

```javascript
{
  chat_id: string,          // 对话标识
  version: number,          // 递增版本号
  tokens: number,           // 累计 token 消耗
  updated_at: string,       // ISO 更新时间
  _meta: {
    created_at: string,
    last_pipeline_task: string|null,
    last_pipeline_time: string|null
  },
  content: {
    story_time: string,     // 当前故事时间
    story_scene: string,    // 当前场景
    story_date: string,     // 故事日期
    summary: string,        // 开场摘要
    state: {
      main_event: string,
      present_characters: string,
      characters: {         // 角色卡状态
        [name]: { status, gender_age, occupation, ... }
      },
      factions: { ... },    // 势力状态
      quests: {             // 任务/目标/事件
        tasks: {}, goals: {}, events: {}
      }
    },
    state_schema: object|null,     // 状态 Schema 定义
    ltm_entries: [],               // 长期记忆条目 [{ id, event, scene, period, stm_refs, msg_ids, entities, status }]
    stm_entries: [],               // 已整合 STM 条目
    unconsolidated_stm: [],        // 未整合 STM 条目
    cursor_state: {                // 处理游标
      stm: { completedTurns, position, pending_partials },
      ltm: { position, pending_partials }
    }
  }
}
```

### 5.2 STM Entry 结构

```javascript
{
  id: 'stm_N',              // 唯一标识
  event: string,            // 事件描述
  period: string,           // 时间段
  scene: string,            // 场景
  status: 'closed'|'partial', // 事件状态
  entity: string,           // 主要实体
  turns: [start, end],      // Turn 范围
  msg_ids: [...],           // 关联消息 ID
  entities: [{name, type}], // 关联实体
  parent_ltm: string|null,  // 父 LTM id（整合后）
  timestamp: string         // ISO 时间戳
}
```

### 5.3 LTM Entry 结构

```javascript
{
  id: 'ltm_N',              // 唯一标识
  title: string,            // 标题
  event: string,            // 整合后的事件描述
  scene: string,            // 场景
  time_range: string,       // 时间范围
  status: 'open'|'closed',  // 弧线状态
  stm_refs: ['stm_X', ...], // 引用的 STM id
  msg_ids: [...],           // 所有关联消息 ID
  entities: [{name, type}]  // 关联实体
}
```

### 5.4 Runtime 接口

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

---

## 6. 依赖关系

### 6.1 外部依赖

| 依赖 | 类型 | 用途 |
|------|------|------|
| `gpt-tokenizer` (v3.4.0) | npm 运行时 | GPT token 计数 |
| `rollup` (v4.60.4) | npm dev | 构建打包 |
| `@rollup/plugin-babel` | npm dev | ES6+ 转译 |
| `@rollup/plugin-commonjs` | npm dev | CJS → ESM 转换 |
| `@rollup/plugin-node-resolve` | npm dev | node_modules 解析 |
| `@rollup/plugin-terser` | npm dev | 代码压缩 |
| `@babel/core` + `@babel/preset-env` | npm dev | Babel 编译 |

### 6.2 运行时环境依赖

| 依赖 | 说明 |
|------|------|
| **SillyTavern** (前端) | 提供 SillyTavern.getContext() API |
| **Tavern Helper** (TH) | 提供 ToolManager、injectPrompts、Lorebook 管理 |
| **jQuery** | UI 渲染准备（`$(fn)` 延迟初始化） |
| **toastr** | 通知弹窗 |

### 6.3 构建产物

| 输入 | 输出 | 格式 |
|------|------|------|
| `src/adapter/index.js` | `dist/index.js` | IIFE（立即执行函数） |
| 全局名 | `NEMemoryEngine` | window 暴露 |
| External | jQuery, TavernHelper, SillyTavern, ToolManager | 运行时由宿主提供 |

### 6.4 Rollup 配置

```javascript
// rollup.config.mjs
input: 'src/adapter/index.js'
output: { format: 'iife', name: 'NEMemoryEngine' }
external: ['jQuery', '$', 'TavernHelper', 'SillyTavern', 'ToolManager']
plugins: [node-resolve, commonjs, babel, terser]
```

### 6.5 模块间依赖图（简化）

```
adapter/index.js
  ├── adapter/events.js ──────── engine/update.js ──────── api/llm.js
  │      │                            │                      │
  │      ├── engine/contradiction.js  ├── stm-extractor.js   ├── chat-telemetry.js
  │      ├── engine/injection.js      ├── consolidate.js     └── token-stats.js
  │      ├── engine/context-window.js ├── pipeline-guard.js
  │      └── vault/schema.js          ├── vault/store.js
  │                                   ├── vault/schema.js
  ├── adapter/panel.js               └── vault/versions.js
  ├── adapter/bootstrap.js ─── core/auto-restore.js ─── vault/store.js
  ├── adapter/test-driver.js ── test-runner/
  ├── adapter/test-runner.js
  ├── core/runtime.js
  ├── core/tools.js ────────── vault/store.js + vault/retrieval-filter.js
  ├── core/i18n.js
  └── core/settings.js
```

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

### 7.2 在 SillyTavern 中安装

1. 确保已安装 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)
2. 在 TH 脚本管理器中导入以下 JSON：

```json
{
  "type": "script",
  "enabled": true,
  "name": "NE Memory Engine",
  "id": "ne_memory_engine",
  "content": "import('https://cdn.jsdelivr.net/gh/Melody-0321/NE-Memory@8b2af34/dist/index.js')",
  "info": "长对话结构化记忆管理引擎。"
}
```

3. 启用脚本，Memory Vault 面板会自动出现在 TH 弹窗中

### 7.3 开发模式

```bash
# 监听模式（文件变更自动重新构建）
npm run watch
```

### 7.4 测试

```bash
# 单元测试（需要 Node.js 环境）
node test/run.mjs
```

测试文件位于 `test/` 目录：
- `test/consolidate.test.js` — LTM 整合单元测试
- `test/state-discovery.test.js` — State 发现测试
- `test/pipeline-guard.test.js` — Pipeline 守卫测试
- `test/concurrency-guard.test.js` — 并发守卫测试
- `test/text-utils.test.js` — 文本工具测试
- `test/ltm-rebatch-call-pattern.test.js` — LTM 批处理模式测试

### 7.5 数据目录

| 位置 | 存储方式 | 内容 |
|------|----------|------|
| IndexedDB `ne_memory_vault` | 浏览器 | Vault 数据 + 快照 |
| localStorage `ne_settings` | 浏览器 | 用户设置 |
| localStorage `ne_chat_stats` | 浏览器 | 遥测统计数据 |
| localStorage `ne_secondary_api` | 浏览器 | 副 API 配置 |
| localStorage `ne_pending` / `ne_inflight` | 浏览器 | 暂存消息（崩溃恢复） |

---

## 8. 测试体系

### 8.1 测试层次

```
test-cases/
  ├── retrieval/        # 检索功能测试（smartpush-01 到 12, group-a/b, retrieval-55/58）
  ├── pipeline/         # 管线功能测试（pipeline-state-01 到 06, stm/ltm/vault 等）
  └── smoke/            # 冒烟测试（smartpush-14 全链路）
```

### 8.2 测试用例结构

每个测试用例目录包含：
- `test-case.md` — YAML frontmatter + Markdown 描述的测试规范
- `*-report.md` — 测试报告（自动生成）
- `*-trace.md` — 测试追踪（自动生成）

### 8.3 测试运行方式

通过浏览器 Console 中的 `__ne_debug` API 触发：
```javascript
// 运行指定测试
__ne_debug.runTestByName('smartpush-01-not-empty')

// 列出所有测试
__ne_debug.listTests()
```

---

> 本文档基于 `ne-memory` v4c04a31 生成。项目持续迭代中，请以实际代码为准。
