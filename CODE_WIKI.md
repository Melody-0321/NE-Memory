# NE-Memory — Code Wiki

> **版本**: v0.2.0  
> **平台**: SillyTavern 扩展插件  
> **构建工具**: Rollup + Terser  
> **语言**: JavaScript (ES Module)

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [入口与注册](#4-入口与注册)
5. [事件驱动管线](#5-事件驱动管线)
6. [记忆引擎 (engine)](#6-记忆引擎-engine)
7. [记忆库 (vault)](#7-记忆库-vault)
8. [LLM 通信层 (api)](#8-llm-通信层-api)
9. [用户界面 (ui)](#9-用户界面-ui)
10. [工具模块 (Tools)](#10-工具模块-tools)
11. [辅助模块](#11-辅助模块)
12. [依赖关系图](#12-依赖关系图)
13. [数据流图](#13-数据流图)
14. [项目运行方式](#14-项目运行方式)
15. [关键类与函数索引](#15-关键类与函数索引)

---

## 1. 项目概述

NE-Memory 是 SillyTavern 前端聊天平台的一个扩展插件，实现了**叙事引擎 (Narrative Engine)** 与**多层记忆系统**。它是纯客户端 JavaScript 项目，运行在浏览器沙盒环境中，通过 SillyTavern 的扩展 API 注册运行。

### 核心功能

| 功能 | 描述 |
|------|------|
| **叙事引擎** | 自动监控聊天消息，驱动记忆管线运行 |
| **STM 短期记忆** | 从最近消息中提取结构化事件条目 |
| **LTM 长期记忆** | 将 STM 条目整合为持久的长期记忆概要 |
| **状态 Schema** | 基于 JSON Schema 的角色状态追踪与验证 |
| **GM Agent** | 游戏主控代理，可响应发言自动推进叙事 |
| **Smart Retrieval** | BM25 分组的智能消息检索与注入 |
| **记忆库面板** | 右侧抽屉式 UI，可视化查看/编辑记忆和状态 |
| **Function Tools** | 注册到 ST ToolManager 的 access 和 recall_memory 工具，供 LLM Agent 调用以查询记忆 |
| **记忆库迁移** | 从 chatMetadata 中自动检测并恢复嵌入式记忆库 |
| **遥测导出** | 收集 LLM 调用统计数据，生成 GitHub Issue 报告 |

### 关键设计理念

- **事件驱动**: 所有记忆处理由 SillyTavern 消息事件触发
- **流水线架构**: 消息 → 分组 → 检索 → 提取 → 整合 → 验证，线性流水线
- **分级记忆**: STM (短期) → LTM (长期) 两层记忆体系
- **双层 API**: 主/副 API 分离，记忆处理可独立使用低成本模型

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    SillyTavern Extension API                     │
│   ┌─────────────┐  ┌──────────────────┐                         │
│   │ ToolManager  │  │  chatMetadata     │                        │
│   │ (Function    │  │  (嵌入式记忆库)    │                        │
│   │  Calling)    │  │                   │                        │
│   └──────┬───────┘  └────────┬──────────┘                        │
├──────────┼───────────────────┼──────────────────────────────────┤
│          │                   │                                   │
│  ┌───────┴───────────────────┴──────────────────────────────┐   │
│  │              tools.js (access / recall_memory)            │   │
│  │              auto-restore.js (记忆库迁移)                  │   │
│  └────────────────────────┬─────────────────────────────────┘   │
│                           │                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │  events  │   │  tools   │   │  auto-   │   │   ui/        │ │
│  │  (管线)   │   │ (命令)    │   │ restore  │   │ config-dialog│ │
│  │          │   │          │   │ (恢复)    │   │ vault-panel  │ │
│  └────┬─────┘   └──────────┘   └──────────┘   └──────────────┘ │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 engine/ (记忆引擎核心)                      │   │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │cursor  │ │telemetry │ │retrieval │ │bm25-grouper  │  │   │
│  │  │(游标)  │ │(LLM路由) │ │(检索管线) │ │(消息分组)     │  │   │
│  │  └────────┘ └──────────┘ └──────────┘ └──────────────┘  │   │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │update  │ │consolidate│ │validate  │ │state-discov. │  │   │
│  │  │(STM)   │ │(LTM)      │ │(校验)     │ │(状态发现)     │  │   │
│  │  └────────┘ └──────────┘ └──────────┘ └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  vault/store │  │  vault/      │  │  api/llm             │   │
│  │  (记忆持久化) │  │  schema      │  │  (LLM HTTP 通信)     │   │
│  │              │  │  (状态定义)   │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心模块关系

```
index.js (入口) ──注册扩展──► SillyTavern
    │
    ├──► events.js (事件监听 + 管线编排)
    │       ├──► engine/cursor.js
    │       ├──► engine/chat-telemetry.js
    │       ├──► engine/bm25-grouper.js
    │       ├──► engine/retrieval.js
    │       ├──► engine/update.js (STM)
    │       ├──► engine/consolidate.js (LTM)
    │       ├──► engine/validate.js
    │       └──► engine/state-discovery.js
    │
    ├──► tools.js (斜杠命令注册)
    ├──► auto-restore.js (LTM 自动恢复)
    ├──► settings.js (配置读写)
    ├──► i18n.js (国际化)
    │
    └──► ui/
          ├──► config-dialog.js (设置面板)
          └──► vault-panel.js (记忆库面板)
```

---

## 3. 目录结构

```
ne-memory/
├── .gitignore                 # Git 忽略规则
├── package.json               # 项目元信息与依赖
├── rollup.config.mjs          # Rollup 构建配置
├── jsconfig.json              # JS 配置 (模块解析)
├── th-script-template.json    # TavernHelper 脚本模板
├── style.css                  # 全局样式表
├── README.md                  # 项目说明
├── src/
│   ├── index.js               # 扩展入口，注册到 SillyTavern
│   ├── events.js              # 事件驱动管线编排
│   ├── settings.js            # 设置读写 (基于 localStorage)
│   ├── i18n.js                # 中/英双语国际化的 key 映射
│   ├── tools.js               # SillyTavern 斜杠命令注册
│   ├── auto-restore.js        # LTM 条目自动恢复逻辑
│   ├── globals.d.ts           # TypeScript 全局类型声明
│   ├── api/
│   │   └── llm.js             # LLM API 通信层
│   ├── engine/
│   │   ├── cursor.js          # 对话游标 (memoryCursor)
│   │   ├── telemetry.js       # LLM 调用缓存与路由中间件
│   │   ├── chat-telemetry.js  # 聊天消息埋点
│   │   ├── retrieval.js       # Smart Retrieval 检索管线
│   │   ├── bm25-grouper.js    # BM25 消息分组
│   │   ├── update.js          # STM 提取管线
│   │   ├── consolidate.js     # LTM 整合管线
│   │   ├── validate.js        # 记忆校验逻辑
│   │   └── state-discovery.js # 动态状态字段发现
│   ├── vault/
│   │   ├── store.js           # 记忆库核心操作 (读写/合并/导出)
│   │   ├── schema.js          # 状态 Schema 定义与模板
│   │   ├── versions.js        # 记忆库版本管理
│   │   └── retrieval-filter.js# 检索过滤器
│   └── ui/
│       ├── config-dialog.js   # 扩展设置面板 (inline-drawer)
│       ├── vault-panel.js     # 记忆库右侧抽屉面板
│       └── utils.js           # UI 工具函数 (escapeHtml, formatLocalTime)
└── dist/                      # 构建输出目录 (由 rollup 生成)
    └── ne-memory.js           # 打包后的单文件扩展
```

---

## 4. 入口与注册

### [index.js](file:///d:/SillyTavern/ne-memory/src/index.js) — 扩展入口

扩展通过 SillyTavern 的 `jQuery` 就绪事件注册：

```javascript
jQuery(async () => { /* ... */ });
```

#### 初始化流程

1. **导入依赖**: 加载 i18n、settings、tools、auto-restore、events、UI 模块
2. **国际化初始化**: 调用 `initI18n()` 加载语言偏好
3. **注册扩展**: 通过 `window['__NarrativeEngineMemory__']` 暴露模块引用
4. **挂载设置面板**: 调用 `renderConfigDialog()` 将 UI 插入 `#extensions_settings`
5. **启动记忆管线**: 调用 `startMemoryEngine()` 开始监控消息事件
6. **注册斜杠命令**: 调用 `registerSlashCommands()` 添加聊天命令
7. **挂载记忆库面板**: 调用 `mountVaultPanel()` 创建右侧抽屉
8. **绑定自动恢复钩子**: 调用 `bindAutoRestore()` 设置 LTM 恢复
9. **切换样式**: 启用/禁用检索时有对应 CSS class 切换

### 外部 API 暴露

`window['__NarrativeEngineMemory__']` 对象暴露了以下模块供 SillyTavern 或其他扩展调用：

| 属性 | 模块 | 说明 |
|------|------|------|
| `memoryCursor` | engine/cursor | 游标工具 |
| `telemetry` | engine/telemetry | LLM 调用路由 |
| `callLLM` | api/llm | 直接 LLM 调用 |
| `i18n` | i18n | 翻译函数 |
| `startMemoryEngine` | events | 启动/重启管线 |
| `narrativeVault` | vault/store | 记忆库操作 |
| `renderConfigDialog` | ui/config-dialog | 设置面板渲染 |
| `registerSlashCommands` | tools | 命令注册 |
| `mountVaultPanel` | ui/vault-panel | 面板挂载 |
| `bindAutoRestore` | auto-restore | 自动恢复绑定 |

---

## 5. 事件驱动管线

### [events.js](file:///d:/SillyTavern/ne-memory/src/events.js) — 核心管线编排

**职责**: 是整个扩展的"大脑"，监听 SillyTavern 的消息事件 (MSG_RECEIVED / MESSAGE_SENT)，驱动记忆处理流水线。

#### 主要导出

| 导出 | 类型 | 说明 |
|------|------|------|
| `startMemoryEngine(getChatId)` | Function | 启动记忆管线的主入口 |
| `stopMemoryEngine()` | Function | 停止所有事件监听 |
| `handlePipeline(getChatId)` | Function | 执行完整的记忆处理流水线 |

#### 流水线阶段 (handlePipeline)

```
1. 前置检查
   ├── 检查引擎启用状态
   ├── 检查记忆系统启用状态
   └── 导航到正确的 ST 聊天缓存

2. Phase 1: 消息分组 (BM25)
   └── bm25-groupMessages(chat) → 将消息按语义分组

3. Phase 2: 智能检索 (Smart Retrieval)
   └── runRetrievalPipeline(chatId, chat, ...)
       ├── 处理最新消息
       ├── 对分组进行 BM25 检索
       ├── 注入检索到的上下文
       └── 返回增强后的 chat 数组

4. Phase 3: STM 提取 (update)
   └── runUpdatePipeline(chatId, chat, ...)
       ├── 收集未处理的 STM 批次
       ├── 调用 LLM 提取新 STM 条目
       ├── 去重 & 过滤
       └── 写入记忆库

5. Phase 4: LTM 整合 (consolidate)
   └── runConsolidationPipeline(chatId, ...)
       ├── 检查未整合的 STM 条目数
       ├── 超过阈值则调用 LLM 整合
       └── 更新 LTM 和 State

6. Phase 5: 校验 (validate)
   └── validateAll(chatId)
       ├── 校验 LTM 合理性
       ├── 校验 State Schema
       └── 自动修复异常

7. 收尾
   ├── 更新游标
   ├── 记录遥测
   └── 上报状态到 UI
```

#### 引擎控制状态

| 局部变量 | 说明 |
|----------|------|
| `engineRunning` | 管线是否正在运行 (防重入) |
| `lastPipelineMs` | 上次管线执行时间戳 (防抖) |
| `retryTimers[chatId]` | 失败重试定时器映射 |

---

## 6. 记忆引擎 (engine)

### 6.1 [cursor.js](file:///d:/SillyTavern/ne-memory/src/engine/cursor.js) — 对话游标

维护每个 chat 的处理进度游标，记录已处理到哪条消息，避免重复处理。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `getSessionState(chatId)` | 获取或初始化 chat 的会话状态 |
| `advanceCursor(chatId, messageId)` | 推进游标到指定消息 |
| `saveSessionState(chatId)` | 持久化会话状态到 localStorage |

**数据结构** — `memoryCursor`:
```javascript
{
    [chatId]: {
        processedMessageIds: Set,  // 已处理的消息 ID 集合
        lastProcessedIndex: number // 最后处理的消息索引
    }
}
```

---

### 6.2 [telemetry.js](file:///d:/SillyTavern/ne-memory/src/engine/telemetry.js) — LLM 调用路由

LLM 调用的中间件层，提供**缓存**和**路由**功能。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `cachedLLMCall(chatId, op, buildPrompt, ...)` | 带缓存的 LLM 调用，相同 chat+op+prompt 返回缓存结果 |
| `routeLLMCall(chatId, op, buildPrompt, ...)` | 智能路由：检测副 API 配置决定使用主/副 API |
| `recordTelemetry(entry)` | 记录一次 LLM 调用遥测数据 |

**路由逻辑**:
```
routeLLMCall
    └── 检查 localStorage['ne_secondary_api'] 是否有有效配置
        ├── 有 → 使用副 API (callSecondaryLLM)
        └── 无 → 降级到主 API (callMainLLM)
```

**缓存键**: `ne_llm_cache:{chatId}:{operation}:{promptHash}`

---

### 6.3 [chat-telemetry.js](file:///d:/SillyTavern/ne-memory/src/engine/chat-telemetry.js) — 聊天遥测

注入到 SillyTavern 消息发送流程中的钩子，记录每条用户消息的 metadata (时间戳、长度、角色等) 供记忆管线分析参考。

---

### 6.4 [retrieval.js](file:///d:/SillyTavern/ne-memory/src/engine/retrieval.js) — 检索管线

Smart Retrieval 的实现核心，将相关历史记忆注入到当前对话上下文。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `runRetrievalPipeline(chatId, chat, getChatId)` | 检索管线主入口 |
| `retrievalQueryBuilder(chat, recentMessages)` | 构建检索查询 (基于最近 N 条消息) |
| `bm25SearchGroups(groups, query)` | BM25 搜索分组 |
| `injectRetrievedContext(chat, retrievedGroups)` | 将检索结果注入到聊天消息中 |

**流程**:
```
1. 取最新消息构建 query
2. BM25 搜索匹配的历史分组
3. 根据 memoryBudget 限制注入 token 数
4. 将检索到的 memory block 作为系统消息注入 chat 数组
```

---

### 6.5 [bm25-grouper.js](file:///d:/SillyTavern/ne-memory/src/engine/bm25-grouper.js) — BM25 消息分组

将对话消息按语义相似度进行分组，每组视为一个"话题块"。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `bm25GroupMessages(chatOrMessages)` | 主入口，返回分组数组 |
| `computeBM25Score(term, doc, docFreq, avgDocLen)` | 计算单文档 BM25 分数 |
| `tokenize(text)` | 简单分词器 |

**分组策略**: 滑动窗口 + BM25 相似度阈值，相邻消息相似度高则合并为同一组。

**输出格式**:
```javascript
[
    {
        groupId: "group_0",
        messages: [...],
        summary: "话题概要",
        startIndex: 0,
        endIndex: 4
    },
    ...
]
```

---

### 6.6 [update.js](file:///d:/SillyTavern/ne-memory/src/engine/update.js) — STM 提取管线

从对话消息中提取短期记忆条目 (Short-Term Memory)。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `runUpdatePipeline(chatId, chat, getChatId)` | STM 提取主入口 |
| `buildSTMPrompt(messages)` | 构建 STM 提取的 LLM prompt |
| `parseSTMResponse(llmOutput)` | 解析 LLM 返回的 STM 条目 |
| `deduplicateSTM(entries, existing)` | 去重检查 |

**STM 条目结构**:
```javascript
{
    id: "stm_chatId_timestamp",
    type: "event | dialogue | thought | action",
    summary: "简要描述",
    detail: "详细内容",
    sourceMsgId: "原始消息ID",
    timestamp: "ISO时间戳",
    characters: ["角色名"],
    importance: 1-5
}
```

**提取策略**:
- 每 `stmBatch` (默认 10) 条消息一批
- 调用 LLM 用结构化 prompt 提取事件
- 限制单条 `stm_max_chars` 和单次 `stm_max_tokens`

---

### 6.7 [consolidate.js](file:///d:/SillyTavern/ne-memory/src/engine/consolidate.js) — LTM 整合管线

将多个 STM 条目整合为长期记忆块 (Long-Term Memory)。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `runConsolidationPipeline(chatId, getChatId)` | LTM 整合主入口 |
| `buildLTMPrompt(stmEntries, existingLTM)` | 构建 LTM 整合 prompt |
| `parseLTMResponse(llmOutput)` | 解析 LLM 返回的 LTM 块 |
| `mergeLTMIntoVault(chatId, ltmBlocks)` | 将 LTM 块合并到记忆库 |
| `updateState(chatId, newState)` | 更新角色状态 |

**LTM 块结构**:
```javascript
{
    id: "ltm_chatId_timestamp",
    summary: "记忆概要",
    detail: "详细记忆内容",
    sourceSTM: ["stm_id_1", "stm_id_2"],
    stateUpdate: { /* 状态变更 */ },
    timestamp: "ISO时间戳"
}
```

**触发条件**: 未整合的 STM 条目数超过 `stmMaxUnconsolidated` (默认 5)。

---

### 6.8 [validate.js](file:///d:/SillyTavern/ne-memory/src/engine/validate.js) — 记忆校验

校验 LTM 和 State 的一致性与合理性。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `validateAll(chatId)` | 校验主入口 |
| `validateLTM(ltmBlocks)` | 检查 LTM 条目一致性 |
| `validateState(state, schema)` | 基于 Schema 校验状态 |
| `autoFix(chatId, issues)` | 自动修复检测到的问题 |

**校验项目**:
- LTM 条目是否重复/矛盾
- State 字段是否符合 Schema 约束
- 时间戳序列是否合理

---

### 6.9 [state-discovery.js](file:///d:/SillyTavern/ne-memory/src/engine/state-discovery.js) — 动态状态发现

启用 `useDynamicState` 时，从角色卡 (character card) 和世界书 (world book) 中自动发现状态字段。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `discoverStateFields(chatId)` | 自动发现状态字段 |
| `parseCharacterCard(card)` | 解析角色卡字段 |
| `matchPowerSlots(fields)` | 与 Power Slots 模板匹配 |
| `generateDynamicSchema(fields)` | 生成动态 JSON Schema |

---

## 7. 记忆库 (vault)

### 7.1 [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) — 记忆库核心

记忆库的 CRUD 操作核心，所有记忆数据存储在此。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `loadVault(chatId)` | 从 localStorage 加载记忆库 |
| `saveVault(chatId, vault)` | 保存记忆库到 localStorage |
| `addSTM(chatId, entry)` | 添加 STM 条目 |
| `addLTM(chatId, block)` | 添加 LTM 块 |
| `merge(chatId, newEntries)` | 合并新记忆 (自动去重) |
| `updateState(chatId, state)` | 更新角色状态 |
| `getVaultVersion(chatId)` | 获取记忆库版本 |
| `exportVault(chatId)` | 导出记忆库为 JSON |
| `importVault(chatId, data)` | 从 JSON 导入记忆库 |

**记忆库数据结构** (narrativeVault):
```javascript
{
    version: 2,
    updatedAt: "ISO时间戳",
    stm: [
        {
            id: "stm_xxx",
            type: "event",
            summary: "...",
            detail: "...",
            sourceMsgIds: [...],
            timestamp: "...",
            characters: [...],
            importance: 3,
            consolidated: false  // 是否已整合到 LTM
        },
        ...
    ],
    ltm: [
        {
            id: "ltm_xxx",
            summary: "...",
            detail: "...",
            sourceSTM: [...],
            sourceMessageIds: [...],
            timestamp: "...",
            stateUpdates: {...}
        },
        ...
    ],
    state: { /* 角色状态对象 */ },
    openingSummary: "...",
    retrievalIndex: { /* BM25 索引数据 */ }
}
```

---

### 7.2 [schema.js](file:///d:/SillyTavern/ne-memory/src/vault/schema.js) — 状态 Schema

定义角色状态的 JSON Schema 约束和模板。

**主要导出**:

| 导出 | 类型 | 说明 |
|------|------|------|
| `DEFAULT_GLOBAL_SCHEMA` | Object | 默认全局状态 Schema (阵营、情绪、HP/MP 等) |
| `DEFAULT_CHARACTER_SCHEMA` | Object | 默认角色卡 Schema (protagonist + npc 区块) |
| `POWER_SLOTS_TEMPLATES` | Object | 灵力/能量系统预设模板 |
| `setDynamicStateMode(enabled)` | Function | 切换动态状态发现模式 |
| `isDynamicStateMode()` | Function | 查询当前模式 |

**DEFAULT_GLOBAL_SCHEMA 示例字段**:
```json
{
    "type": "object",
    "properties": {
        "alignment": { "type": "string", "enum": ["lawful_good", "chaotic_good", ...] },
        "mood": { "type": "string" },
        "health": { "type": "integer", "minimum": 0, "maximum": 100 },
        ...
    }
}
```

---

### 7.3 [versions.js](file:///d:/SillyTavern/ne-memory/src/vault/versions.js) — 版本管理

记忆库数据格式的版本迁移管理。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `migrateVault(vault, fromVersion, toVersion)` | 执行版本迁移 |
| `getCurrentVersion()` | 获取当前数据格式版本 |

---

### 7.4 [retrieval-filter.js](file:///d:/SillyTavern/ne-memory/src/vault/retrieval-filter.js) — 检索过滤器

辅助检索管线过滤/排序记忆条目。

---

## 8. LLM 通信层 (api)

### [llm.js](file:///d:/SillyTavern/ne-memory/src/api/llm.js) — LLM API 通信

封装与 LLM API 的 HTTP 通信。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `callLLM(prompt, config)` | 调用主 LLM (通过 ST 的连接器) |
| `callSecondaryLLM(prompt, config)` | 调用副 LLM (独立 API 连接) |
| `saveSecondaryApiConfig(config)` | 保存副 API 配置到 localStorage |
| `loadSecondaryApiConfig()` | 读取副 API 配置 |
| `telemetryBuffer` | Array — 遥测缓冲区 |
| `recordTelemetry(entry)` | 追加遥测记录 |
| `isTelemetryEnabled()` | 查询遥测开关 |

**副 API 配置** (localStorage key: `ne_secondary_api`):
```javascript
{
    url: "http://127.0.0.1:8000/llm/chat",
    key: "sk-...",
    model: "deepseek-v4-flash"
}
```

**遥测条目结构**:
```javascript
{
    timestamp: "ISO",
    operation: "stm_extract | ltm_consolidate | state_init | ...",
    api_source: "main | secondary",
    duration_ms: 1234,
    tokens: 500,
    error: null | "error message"
}
```

---

## 9. 用户界面 (ui)

### 9.1 [config-dialog.js](file:///d:/SillyTavern/ne-memory/src/ui/config-dialog.js) — 设置面板

挂载在 ST 扩展设置抽屉 (`#extensions_settings`) 内的 inline-drawer UI。

**UI 结构** — 4 个 Tab:

| Tab | 内容 |
|-----|------|
| **基本设置** | 引擎/Agent/记忆开关、检索开关、记忆预算、STM 批量抽取数、LTM 整合阈值 |
| **副 API** | API URL、Key、Model 配置 |
| **记忆处理** | Temperature、STM/LTM/开场摘要/状态初始化的 token/chars 上限 |
| **状态 Schema** | Global Schema 编辑器、Character Schema 编辑器、Quests 开关、Power Slots 模板编辑器 |

**核心函数**:

| 函数 | 说明 |
|------|------|
| `renderConfigDialog(getChatId)` | 渲染设置面板 (幂等: 已存在则跳过) |
| `loadConfigUI()` | 从 localStorage 加载设置到 UI |
| `saveConfigUI()` | 保存 UI 设置到 localStorage |
| `collectTelemetryData(chatId)` | 聚合遥测数据生成报告 |
| `uploadTelemetryToIssue(data)` | 将遥测数据填充到 GitHub Issue 模板 |
| `renderPowerSlotsEditor()` | 渲染 Power Slots 模板编辑器 |
| `loadPowerSlotsTemplates()` | 读取 Power Slots 模板 |
| `savePowerSlotsTemplates(templates)` | 保存 Power Slots 模板 |

**localStorage keys**:
- `ne_settings` — 所有引擎设置
- `ne_secondary_api` — 副 API 配置
- `ne_power_slots_templates` — Power Slots 模板

---

### 9.2 [vault-panel.js](file:///d:/SillyTavern/ne-memory/src/ui/vault-panel.js) — 记忆库面板

右侧滑入式抽屉面板，可视化展示记忆库内容。

**UI 结构**:
```
┌──────────────────────────────────┐
│ NE Memory Vault          [v] [X]│  ← 头部 (标题 + 版本 + 关闭)
├──────────────────────────────────┤
│ [Summary] [STM] [LTM] [State]   │  ← 标签栏
│ [Logs]   [Tools]                 │
├──────────────────────────────────┤
│                                  │
│          Tab 内容区               │  ← 可滚动内容体
│                                  │
├──────────────────────────────────┤
│ [刷新] [导出] [导入]              │  ← 底部操作栏
└──────────────────────────────────┘
```

**标签页**:

| 标签 | 内容 |
|------|------|
| Summary | 开场摘要 + 最近的记忆概览 |
| STM | 短期记忆表格 (可点击跳转到源码消息) |
| LTM | 长期记忆表格 (可展开查看关联 STM) |
| State | JSON 状态查看器 + 编辑器 |
| Logs | 引擎运行日志 (管线耗时、LLM 调用记录) |
| Tools | 已注册的斜杠命令列表 |

**核心函数**:

| 函数 | 说明 |
|------|------|
| `mountVaultPanel()` | 创建抽屉 DOM 并挂载到 body |
| `switchTab(tabName)` | 切换标签页 |
| `renderSummaryTab(chatId)` | 渲染 Summary |
| `renderSTMTab(chatId)` | 渲染 STM 表格 |
| `renderLTMTab(chatId)` | 渲染 LTM 表格 |
| `renderStateTab(chatId)` | 渲染状态编辑器 |
| `renderLogsTab()` | 渲染日志列表 |
| `renderToolsTab()` | 渲染工具命令列表 |

---

### 9.3 [utils.js](file:///d:/SillyTavern/ne-memory/src/ui/utils.js) — UI 工具

| 函数 | 说明 |
|------|------|
| `escapeHtml(str)` | HTML 转义 (防 XSS) |
| `formatLocalTime(isoStr)` | ISO 时间戳转本地格式化时间 |

---
## 10. 工具模块 (Tools)

本模块实现了两个与 **SillyTavern 外部系统直接交互** 的关键功能：

| 模块 | 文件 | 对接系统 | 作用 |
|------|------|----------|------|
| **Function Tools** | [tools.js](file:///d:/SillyTavern/ne-memory/src/tools.js) | ST `ToolManager` API | 向 SillyTavern 的 LLM Agent 注册 Function Calling 工具，让 AI 能主动查询记忆库 |
| **记忆库迁移** | [auto-restore.js](file:///d:/SillyTavern/ne-memory/src/auto-restore.js) | ST `chatMetadata` API | 从聊天元数据中检测并恢复嵌入式记忆库，实现跨设备记忆迁移 |

---

### 10.1 [tools.js](file:///d:/SillyTavern/ne-memory/src/tools.js) — SillyTavern Function Tools

#### 对外系统交互

tools.js 通过 **SillyTavern 的 `ToolManager` API** (`ToolManager.registerFunctionTool()`) 向 AI Agent 注册可调用的 Function Tools。当 ST 的 LLM 在处理对话时，可以主动调用这些工具来查询角色的记忆和状态数据。

```
ST LLM Agent (对话中)
    │
    │ ToolManager 调度
    ▼
┌──────────────────────────────────────────────┐
│  tools.js: registerAllTools()                │
│                                              │
│  ┌─────────────────────────────────────┐     │
│  │ access (统一数据存取)                 │     │
│  │ 交互系统:                            │     │
│  │  · ToolManager (ST Function Call)   │     │
│  │  · vault/store (记忆库读取)           │     │
│  │  · getChatMessages() (原始消息查询)    │     │
│  │  · telemetry (调用统计)               │     │
│  │  · chat-telemetry (埋点)             │     │
│  └─────────────────────────────────────┘     │
│                                              │
│  ┌─────────────────────────────────────┐     │
│  │ recall_memory (语义记忆检索)          │     │
│  │ 交互系统:                            │     │
│  │  · ToolManager (ST Function Call)   │     │
│  │  · vault/store (记忆库读取)           │     │
│  │  · retrieval-filter (BM25 候选筛选)   │     │
│  │  · engine/retrieval (提示词构建)       │     │
│  │  · api/llm (LLM 合成回答)            │     │
│  │  · telemetry + chat-telemetry        │     │
│  │  · cross-language (中英文翻译)         │     │
│  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

#### 入口函数

| 函数 | 说明 |
|------|------|
| `registerAllTools(getChatId, getChatMessages)` | 注册所有工具到 ToolManager。检查 `ToolManager` 是否存在，然后注册 `access`（总是注册）和 `recall_memory`（仅在开启检索时注册） |

---

#### 10.1.1 `access` 工具 — 统一记忆与状态存取

**工具名称**: `access`  
**显示名称**: `Access Memory & State`  
**注册系统**: ST `ToolManager.registerFunctionTool()`  

**作用**: 为 LLM Agent 提供一个**统一的数据读取接口**，通过引用字符串 (ref) 以只读方式访问记忆库中所有类型的数据。这是 AI 在对话中"回忆"特定信息的快捷方式。

**支持的 ref 格式与交互逻辑**:

| ref 格式 | 交互目标 | 读取路径 | 说明 |
|----------|----------|----------|------|
| `"stm_12"` | vault → STM entries | `content.unconsolidated_stm + stm_entries` | 返回 STM 条目的完整文本（时间段、场景、事件、实体、子引用） |
| `"ltm_3"` | vault → LTM entries | `content.ltm_entries` | 返回 LTM 块的详细信息，含关联的 STM 子条目 (`stm_refs`) 和源消息 ID |
| `"95"` / `"msg#95"` | **ST 聊天消息** (not vault) | `getChatMessages()` | **直接读取原始聊天消息文本**。支持 `entities` 参数按角色名过滤段落 |
| `"chain.爱丽丝"` | vault → STM entries | 全量 STM 按 entity.name 过滤 | 按实体名构建**叙事链条 (Narrative Chain)**，按时间排序展示该实体相关所有事件 |
| `"characters.爱丽丝"` | vault → state | `state.characters[name]` | 返回角色的详细状态卡（姓名、性别年龄、职业、性格、随身物品、好感度等） |
| `"factions.House Frost"` | vault → state | `state.factions[name]` | 返回阵营详情（描述、领袖、对玩家态度、外交关系等） |
| `"quests.Main"` | vault → state | `state.quests.{tasks/goals/events}` | 查询任务/目标/世界事件的完整详情（状态、期限、进度、奖励等） |

**参数 Schema** (注册到 ToolManager 的 JSON Schema):

```javascript
{
    ref: string,      // 必需: 引用字符串
    entities: string[] // 可选: 仅在 ref 指向消息时使用，按实体名过滤段落
}
```

**action 内部流程**:
```
1. 解析 ref 字符串，判定 refType (stm/ltm/msg/chain/character/faction/quest)
2. 调用 vault/store.read(chatId) 读取记忆库
3. 根据 refType 分流处理:
   ├── msg → 调用 getChatMessages() 从 ST 聊天数组查找原始消息
   ├── stm/ltm → 从 vault.content 中遍历匹配 entry.id
   ├── chain.X → 遍历所有 STM，筛选 entity.name === X 的条目，按时间排序
   └── domain.Name → lookupCharacter / lookupFaction / lookupQuest
4. 记录遥测 (access_ref, access_ref_type, latency, success)
5. 记录 ToolCall 日志 (addToolCall / recordChatStat)
6. 返回格式化文本结果
```

**与外部系统的交互总结**:

| 交互系统 | 调用方向 | 用途 |
|----------|----------|------|
| `ToolManager` (ST) | 注册 | 将 access 工具的 name/description/parameters/action 注册到 ST，供 LLM 发现和调用 |
| `vault/store.read()` | 读取 | 从 localStorage 加载记忆库 JSON |
| `getChatMessages()` | 读取 | 从 ST 的聊天消息数组中按 ID 查找原始消息 |
| `telemetry` (recordTelemetry) | 写入 | 记录每次 access 调用的 ref 类型、耗时、成功/失败 |
| `telemetry` (addToolCall) | 写入 | 记录完整的 Function Call 调用链 |
| `chat-telemetry` (recordChatStat) | 写入 | 记录工具调用统计 (tool 类型) |

---

#### 10.1.2 `recall_memory` 工具 — 语义记忆检索

**工具名称**: `recall_memory`  
**显示名称**: `Recall Memory`  
**注册系统**: ST `ToolManager.registerFunctionTool()`  
**启用条件**: 仅当 `retrievalEnabled === true` 时注册

**作用**: 为 LLM Agent 提供一个**语义搜索接口**，让 AI 可以用自然语言查询"关于某个话题/实体/事件我记住了什么"。这是 AI 的"回想"能力——不同于 `access` 的精确查找，`recall_memory` 支持模糊语义搜索。

**核心差异 — access vs recall_memory**:

| 维度 | access | recall_memory |
|------|--------|---------------|
| 查询方式 | 精确引用 (stm_12, characters.X) | 自然语言语义查询 |
| 返回结果 | 原始数据结构 | LLM 合成的叙事化回答 |
| 需要 LLM | 否（纯数据查找） | 是（BM25 候选 + LLM 合成） |
| 适用场景 | AI 已知道具体的 ID/名称 | AI 不确定要查什么，需要语义搜索 |

**参数 Schema**:

```javascript
{
    query: string,    // 必需: 自然语言查询。支持 ";;" 分隔多主题并行查询
    timeOnly: boolean  // 可选: 跳过 BM25，返回完整时间线（用于纯时间查询如"今早发生了什么"）
}
```

**action 内部流程** (复杂的多阶段流水线):

```
1. 读取记忆库
   └── vault/store.read(chatId) → content, allSTM, allLTM

2. 时间约束解析
   └── parseTimeConstraint(query) → timeConstraint
       ├── 有 timeConstraint → applyTimeFilter 预筛选
       │   ├── timeOnly 或 结果 ≤ 15 条 → 跳过 BM25，按时间排序返回（摘要模式）
       │   └── 否则 → BM25 在时间过滤池上搜索
       └── 无 timeConstraint → BM25 全局搜索

3. BM25 候选筛选
   └── retrieval-filter.filterCandidates(query, stm, ltm, 40)
       └── 返回 top 40 候选条目

4. 跨语言翻译增强 (条件触发)
   └── 候选 < 5 条 且 记忆库有中英混合文本
       └── callMemoryLLM 翻译 query 到另一种语言
           └── filterCandidates 用翻译后 query 重新搜索
               └── 合并去重 → 扩充候选池

5. 去重 (跨调用记忆)
   └── 缓存上一次调用的 msg_ids
       └── 本次候选如与上次 msg_ids 重叠 → 标记 _already_covered
           └── 注入 [DEDUP] 提示指导 LLM 避免重复

6. LLM 合成
   └── engine/retrieval.buildRetrievalMessages(query, candidates, vault, 800)
       └── api/llm.callMemoryRetrieval(messages, {timeout:3, temperature:0.3})
           └── 返回 LLM 合成的叙事化回答（含 →msgId 源引用）

7. 缓存更新 & 遥测
   └── 提取回答中的 →msgId 引用 → lastRecallMsgIds（下次去重用）
   └── 提取回答中的 ## Section 标题 → lastRecallHeaders（fallback 去重）
   └── recordTelemetry / addToolCall / recordChatStat
```

**LLM 不可用时的降级**:
```javascript
formatBM25Fallback(candidates, content)
    └── 返回裸 BM25 候选列表（序号 + 时间段 + 事件），不经过 LLM 合成
```

**与外部系统的交互总结**:

| 交互系统 | 调用方向 | 用途 |
|----------|----------|------|
| `ToolManager` (ST) | 注册 | 向 ST LLM Agent 暴露 recall_memory 工具 |
| `vault/store.read()` | 读取 | 加载记忆库以获取所有 STM/LTM 条目 |
| `retrieval-filter` | 调用 | BM25 候选筛选 + 时间约束解析 + 纯时间查询判定 |
| `engine/retrieval.buildRetrievalMessages()` | 调用 | 构建发给 LLM 的检索提示词 |
| `api/llm.callMemoryRetrieval()` | 调用 | 调用 LLM 合成叙事化回答（独立 LLM 调用，不经过副 API 路由） |
| `api/llm.callMemoryLLM()` | 调用 | 跨语言翻译 query |
| `telemetry` | 写入 | 记录调用统计 |
| `chat-telemetry` | 写入 | 记录工具调用埋点 |

**跨调用去重机制**:

```javascript
// 全局状态 (模块级变量)
lastRecallMsgIds  // 上一次 recall 回答中的 →msgId 引用数组
lastRecallHeaders // 上一次 recall 回答中的 ## Section 标题数组
lastRecallChatId  // 上一个 chat ID
lastRecallVaultVersion // 上一个记忆库版本

// 清理时机: chatId 变化 或 记忆库版本升级
```

---

### 10.2 [auto-restore.js](file:///d:/SillyTavern/ne-memory/src/auto-restore.js) — 记忆库迁移与状态恢复

#### 对外系统交互

auto-restore.js 通过 **SillyTavern 的 `chatMetadata` API** (`SillyTavern.getContext().chatMetadata`) 实现记忆库的**跨设备/跨会话迁移**。

#### 工作原理

```
用户加载聊天
    │
    ▼
checkAndRestoreEmbeddedVault(chatId)
    │
    ├── 1. 防重入检查 (_restoredChatIds, 上限 50)
    │
    ├── 2. 读取 chatMetadata.ne_vault
    │   └── SillyTavern.getContext().chatMetadata
    │       ├── 无嵌入 → 检查现有 vault 是否需要动态状态发现 → 返回
    │       └── 有嵌入 → 继续
    │
    ├── 3. 检查本地是否已有记忆库
    │   └── vault/store.read(chatId)
    │       ├── 已有 (version > 0) → 删除嵌入数据，仅触发动态状态发现
    │       └── 无本地数据 → 弹出确认对话框
    │
    └── 4. 用户确认后执行恢复
        └── JSON.parse(neVaultJson) → vault/store.write(chatId, vault)
            └── 删除 chatMetadata.ne_vault（清理嵌入数据）
                └── 触发动态状态发现 (_discoverIfNeeded)
```

#### 核心函数

| 函数 | 说明 |
|------|------|
| `checkAndRestoreEmbeddedVault(chatId)` | 主入口：检查聊天元数据中是否有嵌入的记忆库 JSON，有则提示用户恢复 |
| `_discoverIfNeeded(chatId, vault)` | 条件触发：仅在启用动态状态模式 (`isDynamicStateMode()`) 且记忆库尚未执行过动态发现时 (`!vault.content.dynamic_state`)，调用 `discoverDynamicFields(vault)` |
| `deleteChatMetadataNeVault()` | 清理：从 `chatMetadata` 中删除 `ne_vault` 字段，避免重复提示 |

#### 与外部系统的交互总结

| 交互系统 | 调用方向 | 用途 |
|----------|----------|------|
| `SillyTavern.getContext().chatMetadata` | **读取 + 写入** | 读取 `ne_vault` 嵌入字段，恢复后删除该字段 |
| `vault/store.read(chatId)` | 读取 | 检查本地是否已有记忆库 |
| `vault/store.write(chatId, vault)` | 写入 | 将恢复的记忆库写入 localStorage |
| `state-discovery.discoverDynamicFields()` | 调用 | 恢复后自动执行动态状态字段发现 |
| `vault/schema.isDynamicStateMode()` | 调用 | 判断是否需要触发动态发现 |
| `toastr` (ST) | 调用 | 显示恢复提示的 Toast 通知 |
| `confirm()` (浏览器) | 调用 | 弹出确认对话框 |

#### 使用场景

| 场景 | 说明 |
|------|------|
| **跨设备迁移** | 用户在设备 A 上导出的记忆库嵌入到角色卡/聊天的 `chatMetadata` 中，在设备 B 加载聊天时自动检测并恢复 |
| **角色卡分发** | 角色卡作者将预制记忆库嵌入到 `chatMetadata` 中，用户首次加载时自动导入 |
| **动态状态发现** | 恢复后自动分析角色卡和世界书，动态生成 State Schema 字段 |

---

## 11. 辅助模块

### 11.1 [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) — 设置管理

对 `localStorage['ne_settings']` 的读写封装。

| 函数 | 说明 |
|------|------|
| `loadSettings()` | 加载设置对象 |
| `saveSettings(settings)` | 保存设置对象 |
| `isEngineEnabled()` | 检查引擎是否启用 |
| `isMemoryEnabled()` | 检查记忆系统是否启用 |
| `isGMEnabled()` | 检查 GM Agent 是否启用 |
| `isRetrievalEnabled()` | 查询检索开关 |
| `setRetrievalEnabled(enabled)` | 设置检索开关 |
| `getMemoryBudget()` | 获取记忆预算 (tokens) |
| `getSTMConfig()` | 获取 STM 配置 |

### 11.2 [i18n.js](file:///d:/SillyTavern/ne-memory/src/i18n.js) — 国际化

基于 key-value 映射的轻量级 i18n，支持中文/英文。

**主要导出**:

| 导出 | 说明 |
|------|------|
| `t_config(key)` | 配置相关翻译 |
| `t_narrative(key)` | 叙事引擎相关翻译 |
| `t_tools(key)` | 工具命令翻译 |
| `initI18n()` | 初始化语言 (读 ST 语言设置) |

### 11.3 [globals.d.ts](file:///d:/SillyTavern/ne-memory/src/globals.d.ts) — 类型声明

SillyTavern 全局对象 (`SillyTavern`, `TavernHelper`, `jQuery`, `toastr`, `PowerForge`) 的 TypeScript 类型声明，用于 IDE 智能提示。

---

## 12. 依赖关系图

### 模块依赖矩阵

```
                         ┌──────────────────────┐
                         │      ToolManager      │ (ST Function Calling)
                         │      chatMetadata     │ (嵌入式记忆库)
                         └──────────┬───────────┘
                                    │
                               tools.js
                              auto-restore.js
                                    │
                               ┌────┴────┐
                              index      │
                             /  |  \     │
                            /   |   \    │
                      events  tools  auto-restore
                     /  |  \     
                    /   |   \    
               cursor  chat-telemetry  engine/*
                 |        |              |
                 +--------+------+-------+
                 |        |      |       |
             retrieval  bm25   update  consolidate
                 |        |      |       |
                 +--------+------+-------+
                          |
                   api/llm  vault/*
                     |        |
                telemetry   store
                     |        |
                  settings  schema
                     |        |
                    i18n   versions
```

### 外部依赖

| 依赖 | 来源 | 用途 |
|------|------|------|
| `jQuery` | SillyTavern 全局 | DOM 操作 |
| `SillyTavern.getContext()` | SillyTavern API | 获取聊天上下文 / chatMetadata |
| `ToolManager` | SillyTavern API | 注册 Function Calling 工具供 LLM 调用 |
| `TavernHelper` | TavernHelper 框架 | 脚本执行环境 |
| `toastr` | SillyTavern 全局 | Toast 通知 |
| `PowerForge` | SillyTavern 全局 | 电力系统扩展框架 |

### 构建依赖 (package.json)

| 依赖 | 版本 | 说明 |
|------|------|------|
| `@rollup/plugin-terser` | ^0.4.4 | Rollup 代码压缩插件 |

---

## 13. 数据流图

### 消息 → 记忆 完整数据流

```
SillyTavern 发送消息
        │
        ▼
  events.js: handlePipeline()
        │
        ▼
  ┌─────────────────────┐
  │ Phase 1: BM25 分组   │  chat → bm25-groupMessages() → groups[]
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────┐
  │ Phase 2: 检索        │  groups[] → runRetrievalPipeline() → enhanced chat
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────┐
  │ Phase 3: STM 提取    │  chat → runUpdatePipeline()
  │                     │    └→ callLLM(prompt) → STM entries[]
  │                     │    └→ vault.addSTM() / vault.merge()
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────┐
  │ Phase 4: LTM 整合    │  STM[] (unconsolidated) → runConsolidationPipeline()
  │                     │    └→ callLLM(prompt) → LTM blocks[]
  │                     │    └→ vault.addLTM() / vault.updateState()
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────┐
  │ Phase 5: 校验        │  vault → validateAll()
  │                     │    └→ 自动修复
  └────────┬────────────┘
           │
           ▼
  localStorage['ne_vault:{chatId}'] ← 持久化
  localStorage['ne_cursor:{chatId}'] ← 游标持久化
  localStorage['ne_telemetry'] ← 遥测持久化
```

### LLM 调用路由

```
callLLM / routeLLMCall
    │
    ├── 检查 ne_secondary_api 是否有 valid config
    │       │
    │       ├── 有 → HTTP POST to 副 API URL
    │       │        └── headers: { Authorization: Bearer {key} }
    │       │
    │       └── 无 → SillyTavern 主连接器
    │                └── ST 内置的 LLM 连接
    │
    └── telemetry.recordTelemetry()
         └── 记录 duration_ms, tokens, error, api_source
```

### Function Tools 调用数据流

```
ST LLM Agent 发起 function_call
        │
        ├── name: "access", arguments: {ref: "stm_12"}
        │       │
        │       ▼
        │   tools.js: access action
        │       ├── vault/store.read(chatId) → 记忆库
        │       ├── getChatMessages() → ST 聊天消息 (仅 msg ref)
        │       ├── lookupCharacter / lookupFaction / lookupQuest → state
        │       └── 返回: 格式化文本结果
        │
        └── name: "recall_memory", arguments: {query: "关于Dragonfang..."}
                │
                ▼
            tools.js: recall_memory action
                ├── vault/store.read(chatId) → 记忆库
                ├── parseTimeConstraint(query) → 时间约束
                ├── retrieval-filter.filterCandidates() → BM25 候选
                ├── [条件] callMemoryLLM(query翻译)
                ├── engine/retrieval.buildRetrievalMessages()
                ├── api/llm.callMemoryRetrieval() → LLM 合成回答
                └── 返回: 叙事化回答 (含 →msgId 源引用)
```

### 记忆库迁移数据流

```
用户加载聊天
        │
        ▼
auto-restore.js: checkAndRestoreEmbeddedVault(chatId)
        │
        ├── SillyTavern.getContext().chatMetadata.ne_vault
        │       │
        │       ├── 无 → 返回 (仅可能触发动态状态发现)
        │       │
        │       └── 有 (JSON 字符串)
        │               │
        │               ├── 本地已有 vault → 删除嵌入 + 动态发现
        │               │
        │               └── 本地无 vault → confirm() 确认
        │                       │
        │                       ├── 确认 → JSON.parse → vault/store.write()
        │                       │            → delete chatMetadata.ne_vault
        │                       │            → 动态状态发现
        │                       │
        │                       └── 取消 → delete chatMetadata.ne_vault
```

---

## 14. 项目运行方式

### 前置条件

- **SillyTavern** v1.12+ 环境
- Node.js 20+ (仅构建时需要)

### 本地开发

```bash
# 1. 进入项目目录
cd ne-memory

# 2. 安装依赖 (仅 rollup 构建工具)
npm install

# 3. 构建 (输出 dist/ne-memory.js)
npm run build

# 4. 将 dist/ne-memory.js 放入 SillyTavern 的扩展目录
#    目标路径: SillyTavern/data/default-user/extensions/ne-memory/
```

### 在 SillyTavern 中使用

1. 将 `dist/ne-memory.js`、`style.css`、`th-script-template.json` 复制到 ST 扩展目录
2. 在 ST 设置 → 扩展中启用 "Narrative Engine Memory"
3. 配置副 API (可选，推荐) 以降低主 API 成本
4. 在聊天中发送消息即可触发自动记忆管线

### 配置项说明

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `enabled` | false | 总开关 |
| `gmEnabled` | false | GM Agent 开关 |
| `memoryEnabled` | false | 记忆系统开关 |
| `enableStateSchema` | false | 状态 Schema 验证开关 |
| `useDynamicState` | false | 动态字段发现 |
| `retrievalEnabled` | false | 智能检索开关 |
| `memoryBudget` | 800 | 检索上下文 token 预算 |
| `stmBatch` | 10 | STM 提取批大小 |
| `stmMaxUnconsolidated` | 5 | LTM 整合触发阈值 |
| `memoryConfig.temperature` | 0.2 | 记忆 LLM 温度 |

### localStorage 结构

| Key | 内容 |
|-----|------|
| `ne_settings` | 引擎全局设置 (JSON) |
| `ne_secondary_api` | 副 API 配置 (JSON) |
| `ne_vault:{chatId}` | 记忆库数据 (JSON) |
| `ne_cursor:{chatId}` | 处理游标 (JSON) |
| `ne_telemetry` | 遥测缓冲区 (JSON Array) |
| `ne_power_slots_templates` | Power Slots 模板 (JSON) |
| `ne_llm_cache:{chatId}:{op}:{hash}` | LLM 调用缓存 |

---

## 15. 关键类与函数索引

### 管线控制

| 函数 | 文件 | 说明 |
|------|------|------|
| `startMemoryEngine(getChatId)` | [events.js](file:///d:/SillyTavern/ne-memory/src/events.js) | 启动管线 |
| `stopMemoryEngine()` | [events.js](file:///d:/SillyTavern/ne-memory/src/events.js) | 停止管线 |
| `handlePipeline(getChatId)` | [events.js](file:///d:/SillyTavern/ne-memory/src/events.js) | 执行完整流水线 |

### 工具模块 (Tools)

| 函数 | 文件 | 说明 |
|------|------|------|
| `registerAllTools(getChatId, getChatMessages)` | [tools.js](file:///d:/SillyTavern/ne-memory/src/tools.js) | 注册 access + recall_memory 到 ST ToolManager |
| `checkAndRestoreEmbeddedVault(chatId)` | [auto-restore.js](file:///d:/SillyTavern/ne-memory/src/auto-restore.js) | 从 chatMetadata 检测并恢复嵌入式记忆库 |
| `_discoverIfNeeded(chatId, vault)` | [auto-restore.js](file:///d:/SillyTavern/ne-memory/src/auto-restore.js) | 条件触发动态状态字段发现 |
| `deleteChatMetadataNeVault()` | [auto-restore.js](file:///d:/SillyTavern/ne-memory/src/auto-restore.js) | 清理 chatMetadata 中的嵌入记忆库 |

### 记忆引擎

| 函数 | 文件 | 说明 |
|------|------|------|
| `getSessionState(chatId)` | [cursor.js](file:///d:/SillyTavern/ne-memory/src/engine/cursor.js) | 获取/初始化游标 |
| `cachedLLMCall(...)` | [telemetry.js](file:///d:/SillyTavern/ne-memory/src/engine/telemetry.js) | 带缓存的 LLM 调用 |
| `routeLLMCall(...)` | [telemetry.js](file:///d:/SillyTavern/ne-memory/src/engine/telemetry.js) | 智能路由 LLM 调用 |
| `runRetrievalPipeline(...)` | [retrieval.js](file:///d:/SillyTavern/ne-memory/src/engine/retrieval.js) | 检索管线 |
| `bm25GroupMessages(chat)` | [bm25-grouper.js](file:///d:/SillyTavern/ne-memory/src/engine/bm25-grouper.js) | BM25 消息分组 |
| `runUpdatePipeline(...)` | [update.js](file:///d:/SillyTavern/ne-memory/src/engine/update.js) | STM 提取管线 |
| `runConsolidationPipeline(...)` | [consolidate.js](file:///d:/SillyTavern/ne-memory/src/engine/consolidate.js) | LTM 整合管线 |
| `validateAll(chatId)` | [validate.js](file:///d:/SillyTavern/ne-memory/src/engine/validate.js) | 记忆校验 |
| `discoverStateFields(chatId)` | [state-discovery.js](file:///d:/SillyTavern/ne-memory/src/engine/state-discovery.js) | 动态状态发现 |

### 记忆库操作

| 函数 | 文件 | 说明 |
|------|------|------|
| `loadVault(chatId)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 加载记忆库 |
| `saveVault(chatId, vault)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 保存记忆库 |
| `addSTM(chatId, entry)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 添加 STM |
| `addLTM(chatId, block)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 添加 LTM |
| `merge(chatId, entries)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 合并记忆 |
| `updateState(chatId, state)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 更新状态 |
| `exportVault(chatId)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 导出 |
| `importVault(chatId, data)` | [store.js](file:///d:/SillyTavern/ne-memory/src/vault/store.js) | 导入 |
| `migrateVault(vault, from, to)` | [versions.js](file:///d:/SillyTavern/ne-memory/src/vault/versions.js) | 版本迁移 |

### LLM API

| 函数 | 文件 | 说明 |
|------|------|------|
| `callLLM(prompt, config)` | [llm.js](file:///d:/SillyTavern/ne-memory/src/api/llm.js) | 主 API 调用 |
| `callSecondaryLLM(prompt, config)` | [llm.js](file:///d:/SillyTavern/ne-memory/src/api/llm.js) | 副 API 调用 |
| `saveSecondaryApiConfig(cfg)` | [llm.js](file:///d:/SillyTavern/ne-memory/src/api/llm.js) | 保存副 API 配置 |
| `recordTelemetry(entry)` | [llm.js](file:///d:/SillyTavern/ne-memory/src/api/llm.js) | 记录遥测 |

### UI

| 函数 | 文件 | 说明 |
|------|------|------|
| `renderConfigDialog(getChatId)` | [config-dialog.js](file:///d:/SillyTavern/ne-memory/src/ui/config-dialog.js) | 渲染设置面板 |
| `mountVaultPanel()` | [vault-panel.js](file:///d:/SillyTavern/ne-memory/src/ui/vault-panel.js) | 挂载记忆库面板 |
| `escapeHtml(str)` | [utils.js](file:///d:/SillyTavern/ne-memory/src/ui/utils.js) | HTML 转义 |
| `formatLocalTime(isoStr)` | [utils.js](file:///d:/SillyTavern/ne-memory/src/ui/utils.js) | 时间格式化 |

### 设置

| 函数 | 文件 | 说明 |
|------|------|------|
| `loadSettings()` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 加载设置 |
| `isEngineEnabled()` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 引擎开关查询 |
| `isRetrievalEnabled()` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 检索开关查询 |
| `setRetrievalEnabled(v)` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 设置检索开关 |
| `getMemoryBudget()` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 获取记忆预算 |
| `getSTMConfig()` | [settings.js](file:///d:/SillyTavern/ne-memory/src/settings.js) | 获取 STM 配置 |
| `setDynamicStateMode(v)` | [schema.js](file:///d:/SillyTavern/ne-memory/src/vault/schema.js) | 切换动态状态模式 |

---

*文档生成时间: 2026-06-09 | 项目版本: v0.2.0*
