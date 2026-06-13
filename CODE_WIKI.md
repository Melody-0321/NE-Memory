# NE Memory Engine 项目 Code Wiki

> **项目名称**: NE Memory Engine (ne-memory)  
> **版本**: test3.0 (v4)  
> **描述**: 纯前端结构化记忆管理引擎，为 SillyTavern 的长对话提供标准化的记忆提取、存储、检索与状态管理能力。  
> **运行平台**: [Tavern Helper (JS-Slash-Runner)](https://github.com/...)，作为 TH-Script 在 ST 的 iframe 沙箱中运行。  
> **构建工具**: Rollup  
> **语言**: Vanilla JavaScript (ES6 Modules)

---

## 目录

1. [项目整体架构](#1-项目整体架构)
2. [目录结构](#2-目录结构)
3. [运行时环境与入口](#3-运行时环境与入口)
4. [核心模块详解](#4-核心模块详解)
   - 4.1 [入口模块 — index.js](#41-入口模块--indexjs)
   - 4.2 [事件系统 — events.js](#42-事件系统--eventsjs)
   - 4.3 [工具注册 — tools.js](#43-工具注册--toolsjs)
   - 4.4 [配置与持久化 — settings.js](#44-配置与持久化--settingsjs)
   - 4.5 [国际化 — i18n.js](#45-国际化--i18njs)
   - 4.6 [记忆存储 — vault/store.js](#46-记忆存储--vaultstorejs)
   - 4.7 [记忆 Schema — vault/schema.js](#47-记忆-schema--vaultschemajs)
   - 4.8 [版本快照 — vault/versions.js](#48-版本快照--vaultversionsjs)
   - 4.9 [检索过滤 — vault/retrieval-filter.js](#49-检索过滤--vaultretrieval-filterjs)
   - 4.10 [检索笔记本 — vault/retrieval-notebook.js](#410-检索笔记本--vaultretrieval-notebookjs)
   - 4.11 [LLM API 调用 — api/llm.js](#411-llm-api-调用--apillmjs)
   - 4.12 [STM 提取 — engine/stm-extractor.js](#412-stm-提取--enginestm-extractorjs)
   - 4.13 [增量更新 — engine/update.js](#413-增量更新--engineupdatejs)
   - 4.14 [LTM 整合 — engine/consolidate.js](#414-ltm-整合--engineconsolidatejs)
   - 4.15 [智能检索 — engine/retrieval.js](#415-智能检索--engineretrievaljs)
   - 4.16 [指代消解 — engine/ambiguity.js](#416-指代消解--engineambiguityjs)
   - 4.17 [矛盾检测 — engine/contradiction.js](#417-矛盾检测--enginecontradictionjs)
   - 4.18 [动态状态发现 — engine/state-discovery.js](#418-动态状态发现--enginestate-discoveryjs)
   - 4.19 [轮次切分 — engine/turn-segmenter.js](#419-轮次切分--engineturn-segmenterjs)
   - 4.20 [世界书同步 — engine/worldbook-sync.js](#420-世界书同步--engineworldbook-syncjs)
   - 4.21 [数据校验 — engine/validate.js](#421-数据校验--enginevalidatejs)
   - 4.22 [推送遥测 — engine/telemetry.js](#422-推送遥测--enginetelemetryjs)
   - 4.23 [对话统计 — engine/chat-telemetry.js](#423-对话统计--enginechat-telemetryjs)
   - 4.24 [嵌入恢复 — auto-restore.js](#424-嵌入恢复--auto-restorejs)
   - 4.25 [UI 工具 — ui/utils.js](#425-ui-工具--uiutilsjs)
   - 4.26 [Vault 面板 — ui/vault-panel.js](#426-vault-面板--uivault-paneljs)
   - 4.27 [BM25 分组 — engine/bm25-grouper.js](#427-bm25-分组--enginebm25-grouperjs)
5. [数据流与架构图](#5-数据流与架构图)
6. [依赖关系矩阵](#6-依赖关系矩阵)
7. [项目运行方式](#7-项目运行方式)
8. [构建与部署](#8-构建与部署)
9. [关键概念词汇表](#9-关键概念词汇表)

---

## 1. 项目整体架构

NE Memory Engine 采用**分层模块化架构**，主要分为六层：

```
┌─────────────────────────────────────────────────────────────────┐
│                        入口 & 初始化                              │
│                      src/index.js                                │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│ settings │  events  │  tools   │  i18n    │  auto-restore       │
│ 配置持久化│ 事件注册  │ 工具注册  │ 国际化    │ 嵌入Vault恢复        │
├──────────┴──────────┴──────────┴──────────┴─────────────────────┤
│                       Engine Layer (核心引擎)                     │
│  stm-extractor │ update │ consolidate │ retrieval │ ambiguity   │
│  contradiction │ state-discovery │ turn-segmenter │ validate    │
│  telemetry │ chat-telemetry │ worldbook-sync │ bm25-grouper     │
├──────────────────────────┬──────────────────────────────────────┤
│     Vault Layer (存储层)  │         API Layer (接口层)            │
│  store │ schema │ versions│         llm.js (API调用)             │
│  retrieval-filter        │                                       │
│  retrieval-notebook       │                                       │
├──────────────────────────┴──────────────────────────────────────┤
│                       UI Layer (界面层)                          │
│               ui/utils.js  │  ui/vault-panel.js                  │
├─────────────────────────────────────────────────────────────────┤
│                    Platform Bridge (平台桥接)                      │
│   TavernHelper API  │  SillyTavern.getContext()  │  ToolManager  │
└─────────────────────────────────────────────────────────────────┘
```

### 架构原则

1. **纯前端运行**: 所有逻辑在浏览器 iframe 沙箱中执行，通过 TH (Tavern Helper) 桥接层与 ST (SillyTavern) 主页面通信
2. **数据持久化**: 使用 `localStorage` 作为主要存储（Vault 数据 + 配置），使用 ST 的 `chat_metadata` 作为嵌入备份
3. **双重 API**: 支持主 API（记忆提取/整合）+ 副 API（智能检索），可配置分离或共用
4. **事件驱动**: 通过 ST 事件系统（MESSAGE_SENT / MESSAGE_RECEIVED / CHAT_CHANGED）触发记忆流水线

---

## 2. 目录结构

```
ne-memory/
├── dist/                           # 构建输出
│   ├── index.js                    # Rollup 打包后的主文件
│   ├── test-harness.js             # TH 平台测试桩
│   └── th-test.js                  # TH 平台加载测试
├── src/                            # 源码目录
│   ├── index.js                    # 入口文件：模块加载、初始化、控制变量
│   ├── events.js                   # ST 事件注册与处理（消息发送/接收等）
│   ├── tools.js                    # LLM Function Tool 注册
│   ├── settings.js                 # 设置页面渲染与持久化读写
│   ├── i18n.js                     # 国际化（中/英）文本映射
│   ├── auto-restore.js             # 从 chat_metadata 恢复嵌入式 Vault
│   ├── globals.d.ts                # TypeScript 类型声明（仅 IDE 辅助）
│   ├── api/
│   │   └── llm.js                  # LLM API 调用封装（主API/副API/检索API）
│   ├── engine/                     # 核心引擎模块
│   │   ├── stm-extractor.js        # STM 批量提取
│   │   ├── update.js               # 增量记忆更新（含 Smart Push）
│   │   ├── consolidate.js          # LTM 长期记忆整合
│   │   ├── retrieval.js            # 智能检索（实体识别 + 链查询）
│   │   ├── ambiguity.js            # 指代消解（代词→实体名）
│   │   ├── contradiction.js        # 生成后矛盾检测
│   │   ├── state-discovery.js      # 从角色卡动态发现状态字段
│   │   ├── turn-segmenter.js       # 对话轮次切分
│   │   ├── worldbook-sync.js       # 世界书条目同步
│   │   ├── validate.js             # Vault 数据合规校验
│   │   ├── telemetry.js            # Smart Push 推送遥测
│   │   ├── chat-telemetry.js       # Per-chat 逐轮统计
│   │   └── bm25-grouper.js         # BM25 并行分组
│   ├── vault/                      # 记忆存储与检索
│   │   ├── store.js                # Vault 读写 + IDs 缓存
│   │   ├── schema.js               # 状态 Schema 格式化
│   │   ├── versions.js             # Vault 版本快照
│   │   ├── retrieval-filter.js     # BM25 候选过滤
│   │   └── retrieval-notebook.js   # 检索调试笔记本
│   └── ui/                         # 界面模块
│       ├── utils.js                # UI 工具函数
│       └── vault-panel.js          # Vault 面板（抽屉 UI + 操作逻辑）
├── style.css                       # Vault 面板样式
├── rollup.config.mjs               # Rollup 构建配置
├── package.json                    # 项目依赖与脚本
├── jsconfig.json                   # VSCode JS 配置
├── th-script-template.json         # TH-Script 模板（CDN 加载方式）
├── 本体v3.0.json                    # ST 角色卡示例
├── .gitignore
├── README.md
├── BUGS.md
└── CODE_WIKI.md                    # 本文档
```

---

## 3. 运行时环境与入口

### 3.1 平台桥接 (globals.d.ts)

项目在 TH 的 iframe 沙箱中运行，通过以下全局变量与 ST 主页面通信：

| 全局变量 | 用途 |
|---|---|
| `TavernHelper` | TH 桥接核心 API：事件注册、prompt 注入、生成调用、世界书操作 |
| `SillyTavern` | ST 主上下文：聊天数据、角色数据、扩展 prompt 设置 |
| `ToolManager` | LLM Function Tool 注册 |
| `toastr` | ST 内置 toast 通知 |
| `window.jQuery / $` | jQuery 实例（操作 ST 主页面 DOM） |

### 3.2 入口模块 (index.js) 初始化流程

1. 声明核心控制变量（详见 [4.1 节](#41-入口模块--indexjs)）
2. `import './events.js'` → 注册所有事件处理器（自动执行）
3. `import './tools.js'` → 注册 LLM Function Tools（自动执行）
4. 等待 `DOMContentLoaded` → 注入样式、渲染设置面板

---

## 4. 核心模块详解

### 4.1 入口模块 — index.js

**文件**: [src/index.js](file:///d:/SillyTavern/xm/ne-memory/src/index.js)

**职责**: 项目的入口文件，声明全局控制变量并驱动所有模块的加载。

**核心全局变量:**

| 变量名 | 类型 | 说明 |
|---|---|---|
| `SYSTEM_STATE_ENABLED` | `boolean` | 是否启用状态 Schema |
| `SECONDARY_API_ENABLED` | `boolean` | 是否启用副 API |
| `CONTRADICTION_DETECTION_ENABLED` | `boolean` | 是否启用矛盾检测 |
| `CONTRADICTION_SILENT_FIX` | `boolean` | 矛盾检测是否静默修复 |
| `config` | `object` | 运行时配置快照 |
| `_vaultPending` / `_vaultRefresh` | `boolean` | Vault 刷新状态标记 |

**初始化顺序:**
1. 声明变量 → 2. 导入 events.js → 3. 导入 tools.js → 4. 注入样式 → 5. 加载设置 → 6. 渲染设置面板

---

### 4.2 事件系统 — events.js

**文件**: [src/events.js](file:///d:/SillyTavern/xm/ne-memory/src/events.js)

**职责**: 注册 ST 事件监听器，是记忆流水线的调度中心。

**监听的事件:**

| 事件名 | 触发时机 | 处理逻辑 |
|---|---|---|
| `MESSAGE_RECEIVED` | AI 回复生成完成 | ① 非流式：矛盾检测 → ② STM 提取 → ③ LTM 整合 → ④ 状态更新 → ⑤ 世界书同步 |
| `MESSAGE_SENT` | 用户发送消息 | ① 轮次计数 +1 → ② STM 提取 → ③ Smart Push → ④ 聊天遥测 |
| `CHAT_CHANGED` | 切换聊天 | 清除旧聊天缓存，触发新聊天初始化 |
| `EXTENSION_SETTINGS_LOADED` | 扩展设置加载后 | 刷新配置快照，注入 Vault 面板 UI |

**流水线执行顺序:**
```
MESSAGE_RECEIVED:
  1. 聊天遥测: incrementChatTurn(chatId)
  2. 矛盾检测: detectContradictions() → 如检测到矛盾，注入纠正 prompt，重新生成
  3. 嵌入恢复: checkAndRestoreEmbeddedVault()
  4. STM 提取: extractSTM()
  5. 增量更新: executeIncrementalUpdate()
  6. LTM 整合: 可选 triggerConsolidation()（根据阈值判断）
  7. 状态更新: 可选 applyStateUpdatesFromSTM()
  8. 世界书同步: syncWorldbook()

MESSAGE_SENT:
  1. chat-telemetry: incrementChatTurn(chatId)
  2. STM 提取: extractSTM()
  3. Smart Push: pushSmartMemory() → 注入记忆到上下文
  4. 聊天遥测: recordChatStat()
```

---

### 4.3 工具注册 — tools.js

**文件**: [src/tools.js](file:///d:/SillyTavern/xm/ne-memory/src/tools.js)

**职责**: 向 ST 的 `ToolManager` 注册 LLM Function Tools，使 LLM 能主动调用记忆操作。

**注册的工具:**

| 工具名 | 功能 | 参数 |
|---|---|---|
| `retrieveMemory` | 从记忆库检索指定主题的记忆 | `query` (string) - 检索查询词；`maxResults` (int) - 最大返回数 |
| `readVault` | 直接读取当前 Vault 全部记忆 | `chatId` (string, optional) - 聊天 ID |
| `searchMemory` | 综合记忆搜索（STM+LTM） | `keyword` (string) - 关键词；`limit` (int) - 返回数上限 |

这些工具通过 `ToolManager.registerFunctionTool()` 注册，LLM 可在生成过程中自动调用以获取上下文所需的历史记忆。

---

### 4.4 配置与持久化 — settings.js

**文件**: [src/settings.js](file:///d:/SillyTavern/xm/ne-memory/src/settings.js)

**职责**: 管理所有用户可配置项的读写与 UI 渲染。

**配置项分类:**

| 分类 | 配置项 | 存储键 |
|---|---|---|
| 核心开关 | `narrative_memory_enabled` | 主功能总开关 |
| 核心开关 | `smartpush_enabled` | Smart Push 开关 |
| API 配置 | `primary_api` | 主 API 配置（负责记忆提取/整合） |
| API 配置 | `secondary_api` | 副 API 配置（负责智能检索） |
| API 配置 | `retrieval_api` | 检索专用 API 配置 |
| API 配置 | `api_split_mode` | API 分离模式开关 |
| 功能开关 | `state_schema_enabled` | 状态 Schema 开关 |
| 功能开关 | `worldbook_sync_enabled` | 世界书同步开关 |
| 功能开关 | `auto_consolidate_enabled` | 自动 LTM 整合开关 |
| 功能开关 | `contradiction_detection_enabled` | 矛盾检测开关 |
| 功能开关 | `contradiction_silent_fix` | 矛盾检测静默修复 |
| 功能开关 | `dynamic_state_mode` | 动态状态字段发现模式 |
| 语言 | `language` | 界面语言 (`zh` / `en`) |

**存储实现**: 使用 `localStorage` 键 `ne_settings` 保存 JSON。

**关键函数:**
- `loadSettings()`: 从 localStorage 加载，合并默认值
- `saveSettings(settings)`: 写入 localStorage 并触发 `EXTENSION_SETTINGS_LOADED` 事件
- `renderSettings()`: 动态渲染设置面板 HTML

---

### 4.5 国际化 — i18n.js

**文件**: [src/i18n.js](file:///d:/SillyTavern/xm/ne-memory/src/i18n.js)

**职责**: 提供中英文双语文本映射。

**关键函数:**
- `t_narrative(key, replacements)`: 获取描述性文本（叙事记忆相关）
- `t_field(key, replacements)`: 获取字段标签文本
- `setFieldLocale(lang)`: 运行时切换语言

---

### 4.6 记忆存储 — vault/store.js

**文件**: [src/vault/store.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/store.js)

**职责**: Vault 数据的核心 CRUD 接口，是记忆数据的唯一读写入口。

**存储策略:**
- **localStorage**: 主存储，键名为 `ne_vault_{chatId}`
- **chat_metadata**: 嵌入存储（备用），键名为 `ne_vault`

**Vault 数据结构:**
```json
{
  "version": 4,
  "updatedAt": 1700000000000,
  "content": {
    "unconsolidated_stm": [ ... ],    // 未整合的 STM 条目
    "stm_entries": [ ... ],            // 已整合的 STM 条目
    "ltm_entries": [ ... ],            // LTM 长期记忆条目
    "state_changes": [ ... ],          // 状态变更历史
    "dynamic_state": { ... }           // 动态发现的角色状态
  }
}
```

**关键函数:**

| 函数 | 说明 |
|---|---|
| `read(chatId)` | 从 localStorage 读取 Vault，若不存在则初始化 |
| `write(chatId, vault)` | 写入 Vault 到 localStorage，同时写入 chat_metadata 嵌入备份 |
| `isStorageBlocked(chatId)` | 检测 localStorage 是否不可用（被阻止或配额满） |
| `reset(chatId)` | 重置 Vault 为空初始状态 |
| `isInitialized(chatId)` | 检查 Vault 是否已初始化 |
| `collectAllMsgIds(vault)` | 遍历 STM + LTM，收集所有关联的消息 ID |

---

### 4.7 记忆 Schema — vault/schema.js

**文件**: [src/vault/schema.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/schema.js)

**职责**: 定义状态变化的数据结构和格式化方法，支持角色、阵营、任务等多维状态追踪。

**核心数据结构:**

| Schema | 说明 |
|---|---|
| `CHARACTER_SCHEMA` | 角色状态：名称、阵营、职业、HP/MP/SP、气血/精神/精力、位置、情绪、关系等 |
| `FACTION_SCHEMA` | 阵营状态：名称、领袖、成员、势力范围、资源等 |
| `QUEST_SCHEMA` | 任务状态：名称、委托方、目标、进度等 |
| `CORE_STATE` | 核心全局状态：时间线、当前场景、剧情目标 |

**关键函数:**

| 函数 | 说明 |
|---|---|
| `formatStateSummary(vault)` | 格式化整个 Vault 的状态变化为自然语言摘要 |
| `formatCharacterSummary(charState)` | 格式化单个角色状态 |
| `formatActiveCharacterSummary(vault, chatId, lang)` | 格式化当前活跃角色状态 |
| `formatFactionSummary(factionState)` | 格式化阵营状态 |
| `formatQuestSummary(questState)` | 格式化任务状态 |
| `formatCoreStateSummary(coreState)` | 格式化核心全局状态 |
| `isStateSchemaEnabled()` | 检查状态 Schema 是否启用 |
| `isDynamicStateMode()` | 检查是否处于动态状态模式 |
| `getEffectiveSchema()` | 获取当前生效的 Schema（含动态字段） |
| `buildDynamicCharacterSchema(dynamicState, characterName)` | 构建某角色的动态 Schema |
| `DEFAULT_CHARACTER_SCHEMA` | 全局默认角色 Schema 初始值 |

---

### 4.8 版本快照 — vault/versions.js

**文件**: [src/vault/versions.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/versions.js)

**职责**: 实现 Vault 的版本快照功能，支持回滚到历史状态。

**存储键**: `ne_vault_snapshots_{chatId}`，最多保留 20 个快照。

**关键函数:**

| 函数 | 说明 |
|---|---|
| `saveSnapshot(chatId, vault)` | 保存当前 Vault 为快照 |
| `listSnapshots(chatId)` | 列出所有快照的元信息（时间、条目数） |
| `restoreSnapshot(chatId, snapshotId)` | 恢复指定快照 |
| `deleteSnapshot(chatId, snapshotId)` | 删除指定快照 |

---

### 4.9 检索过滤 — vault/retrieval-filter.js

**文件**: [src/vault/retrieval-filter.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/retrieval-filter.js)

**职责**: 实现 BM25 基础检索算法，对 STM 和 LTM 候选条目进行相关度排序。

**关键函数:**

| 函数 | 说明 |
|---|---|
| `filterCandidates(query, stmEntries, ltmEntries, topK)` | BM25 检索：对 STM + LTM 统一排序，返回 topK 结果 |
| `filterCandidatesSplit(query, stmEntries, ltmEntries, topKEach)` | 分别对 STM 和 LTM 检索，各自返回 topKEach，合并去重 |

**检索策略:**
- 采用 BM25 算法计算查询与记忆条目的文本相关度
- 记忆条目文本包括：实体名 + 场景 + 事件描述 + 时间标签
- 返回结果附带 BM25 分数、来源类型（STM/LTM）、时间范围

---

### 4.10 检索笔记本 — vault/retrieval-notebook.js

**文件**: [src/vault/retrieval-notebook.js](file:///d:/SillyTavern/xm/ne-memory/src/vault/retrieval-notebook.js)

**职责**: 提供检索调试工具，记录每次检索的查询、结果和性能指标。

**类: `RetrievalNotebook`**

| 方法 | 说明 |
|---|---|
| `record(query, results, candidates, duration)` | 记录一次检索的完整信息 |
| `getHistory()` | 返回检索历史列表 |
| `clear()` | 清空历史 |
| `toLogHTML(entry)` | 格式化单条记录为 HTML |

**存储键**: `ne_retrieval_notebook`

---

### 4.11 LLM API 调用 — api/llm.js

**文件**: [src/api/llm.js](file:///d:/SillyTavern/xm/ne-memory/src/api/llm.js)

**职责**: 封装所有 LLM API 调用，支持三种 API 配置（主/副/检索）。

**三种 API 通道:**

| API 通道 | 配置键 | 用途 |
|---|---|---|
| **主 API** | `primary_api` | 记忆提取、整合、状态更新、矛盾检测 |
| **副 API** | `secondary_api` | 智能检索（可选，通过 `api_split_mode` 启用以分担负载） |
| **检索 API** | `retrieval_api` | 专用的检索 API（独立于主/副 API） |

**关键函数:**

| 函数 | 说明 |
|---|---|
| `callMemoryLLM(messages, options)` | 调用主 API 发送 LLM 请求，默认 temperature=0 |
| `callMemoryRetrieval(query, context)` | 调用副/检索 API 执行智能检索 |
| `callMemoryRetrievalWithTools(query, context, tools)` | 带 Tool 定义的检索调用 |
| `testSecondaryApiConnection()` | 测试副 API 连接 |
| `sendSecondaryTestMessage()` | 发送测试消息 |
| `saveSecondaryApiConfig(config)` | 保存副 API 配置 |
| `loadSecondaryApiConfig()` | 加载副 API 配置 |
| `saveRetrievalApiConfig(config)` | 保存检索 API 配置 |
| `loadRetrievalApiConfig()` | 加载检索 API 配置 |
| `isApiSplitMode()` | 检查 API 分离模式 |
| `setApiSplitMode(enabled)` | 设置 API 分离模式 |

**API 调用流程:**
```
callMemoryLLM(messages, options)
  → 读取 API 配置（baseUrl, apiKey, model）
  → 构造 fetch 请求（POST /v1/chat/completions）
  → 解析 OpenAI 兼容响应格式
  → 返回模型输出文本
```

---

### 4.12 STM 提取 — engine/stm-extractor.js

**文件**: [src/engine/stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/stm-extractor.js)

**职责**: 从最新对话消息中批量提取短期记忆（STM, Short-Term Memory）。

**处理范围**: 仅处理最新一轮用户+AI 消息对（最高效）。

**提取的 STM 条目结构:**
```json
{
  "entry_id": "stm_xxx",
  "type": "stm",
  "event": "事件描述",
  "scene": "场景/地点",
  "entities": ["实体1", "实体2"],
  "time_label": "时间标签",
  "period": "时间跨度",
  "significance": 0.8,
  "source_msg_ids": [123, 124],
  "created_at": 1700000000000
}
```

**关键函数:**

| 函数 | 说明 |
|---|---|
| `extractSTM(chatId)` | 主入口：获取最新消息→调用 LLM→解析 STM→写入 Vault |
| `buildSTMPrompt(messages)` | 构建 STM 提取 prompt |
| `parseSTMResponse(response)` | 解析 LLM 返回的 JSON 为 STM 条目数组 |
| `deduplicateSTM(newEntries, existingEntries)` | 去重检查：比较已有 STM 条目 |

**prompt 设计特点:**
- 每次提取一批 STM 条目
- 包含实体识别、场景提取、时间标签
- significance 字段控制重要程度
- 提供已有 STM 上下文辅助判断重复

---

### 4.13 增量更新 — engine/update.js

**文件**: [src/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/update.js)

**职责**: 实现增量记忆更新，包括状态变化追踪和 Smart Push 注入。

**关键函数:**

| 函数 | 说明 |
|---|---|
| `executeIncrementalUpdate(vault)` | 执行增量更新：扫描 STM 变化 → 更新状态 Schema → 写入 Vault |
| `pushSmartMemory(chatId)` | Smart Push：在发送前将相关记忆注入 LLM 上下文 |
| `applyStateUpdatesFromSTM(vault)` | 从 STM 中提取状态变化并更新状态 Schema |
| `buildSmartPushPrompt(vault, chatId)` | 构建 Smart Push 注入的 prompt 文本 |

**Smart Push 机制:**
- 在用户消息发送后、AI 生成前触发
- 从 Vault 中检索与当前对话相关的记忆
- 将相关记忆格式化为系统提示注入上下文
- 通过 `TavernHelper.injectPrompts()` 实现

---

### 4.14 LTM 整合 — engine/consolidate.js

**文件**: [src/engine/consolidate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/consolidate.js)

**职责**: 将多轮 STM 条目整合为 LTM（Long-Term Memory）长期记忆。

**触发条件:**
- 未整合的 STM 条目数量 ≥ 阈值（可配置，默认 5）
- 手动触发（Vault 面板中的整合按钮）

**整合类型:**

| 类型 | 说明 |
|---|---|
| `create` | 创建新的 LTM 条目 |
| `update` | 更新已有 LTM 条目 |
| `merge` | 合并多个相关 LTM 条目 |
| `delete` | 标记删除（过时或不重要的记忆） |

**LTM 条目结构:**
```json
{
  "entry_id": "ltm_xxx",
  "type": "ltm",
  "topic": "主题标签",
  "summary": "整合后的记忆摘要",
  "details": ["细节1", "细节2"],
  "entities": ["实体1"],
  "time_range": "2024-01 ~ 2024-06",
  "source_stm_ids": ["stm_1", "stm_2"],
  "created_at": 1700000000000,
  "updated_at": 1700000000000
}
```

**关键函数:**

| 函数 | 说明 |
|---|---|
| `executeConsolidation(vault)` | 执行 LTM 整合流程 |
| `triggerConsolidation(chatId)` | 自动触发条件检查 |
| `buildConsolidationPrompt(unconsolidated, existingLTM)` | 构建整合 prompt |
| `parseConsolidationResponse(response)` | 解析 LLM 返回的整合操作 |

---

### 4.15 智能检索 — engine/retrieval.js

**文件**: [src/engine/retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/retrieval.js)

**职责**: 实现多阶段智能检索管道：实体名提取 → 关系链追踪 → BM25 检索 → LLM 重排序。

**检索管道:**

```
查询文本
  → extractEntityNames()        # LLM 提取实体名
  → lookupEntityChains()         # 从 Vault 中查找实体关系链
  → filterCandidates()           # BM25 候选检索
  → mergePipelines()             # 合并多实体管道结果
  → resolveAmbiguousReferences() # 指代消解
  → callMemoryRetrievalWithTools() # LLM 重排序/回答
```

**关键函数:**

| 函数 | 说明 |
|---|---|
| `extractEntityNames(text)` | 使用 LLM 从查询文本中提取实体名 |
| `lookupEntityChains(vault, entities)` | 从 Vault 中查找实体的关联记忆链 |
| `mergePipelines(pipelines)` | 合并多个实体的检索结果管道 |
| `buildRetrievalMessages(query, vault, chatId)` | 构建完整的检索 prompt |

---

### 4.16 指代消解 — engine/ambiguity.js

**文件**: [src/engine/ambiguity.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/ambiguity.js)

**职责**: 将用户输入中的代词（"他"、"那个地方"等）消解为具体实体名，提升检索精度。

**处理流程:**
1. 从 Vault 中提取已知实体列表
2. 使用 LLM 识别文本中的指代词并映射到实体
3. 返回消解后的查询文本

**关键函数:**

| 函数 | 说明 |
|---|---|
| `resolveAmbiguousReferences(text, vault, chatId)` | 主入口：消解文本中的指代 |
| `resolveWithLM(text, knownEntities)` | 使用 LLM 进行指代消解 |
| `buildKnownEntityList(vault)` | 从 Vault 中提取已知实体列表 |

---

### 4.17 矛盾检测 — engine/contradiction.js

**文件**: [src/engine/contradiction.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/contradiction.js)

**职责**: 在 AI 回复生成后，检测回复中是否存在与记忆库矛盾的事实主张。

**设计原则:**
- 默认关闭（UI 开关控制）
- 阻塞式：矛盾时阻止发送 → 注入证据 → LLM 重新生成
- 最多重试 1 次（防无限循环）
- 非流式路径优先

**三段式检测流程:**

```
AI 回复文本
  → 阶段1: extractClaims()      # LLM 提取事实主张（实体-断言对）
  → 阶段2: filterCandidates()   # BM25 检索相关候选记忆
  → 阶段3: verifyClaim()        # LLM 逐条验证是否矛盾
  → 构建纠正系统消息
```

**关键函数:**

| 函数 | 说明 |
|---|---|
| `detectContradictions(chatId, aiMessage)` | 主入口：三阶段检测 |
| `extractClaims(aiMessage)` | 阶段 1：LLM 提取事实主张 |
| `verifyClaim(claim, candidates)` | 阶段 3：LLM 验证主张是否与记忆矛盾 |
| `buildContradictionSystemMessage(contradictions)` | 构建矛盾证据系统消息 |

---

### 4.18 动态状态发现 — engine/state-discovery.js

**文件**: [src/engine/state-discovery.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/state-discovery.js)

**职责**: 从角色卡描述、开场白、世界书中自动发现状态栏字段定义，使 ne-memory 的 state 系统能自适应任意角色卡。

**双模式:**
- **动态模式** (`dynamic_state` 有数据): 使用发现的自定义字段
- **固定模式** (`dynamic_state` 为空): 回退到硬编码默认字段

**字段提取模式:**

| 模式 | 正则 | 示例 |
|---|---|---|
| 单行独立字段 | `key: value` | `气血: 充盈` |
| 多字段同行 | `HP: 100  MP: 200` | 状态栏密集格式 |
| 括号字段 | `【key: value】` / `[key: value]` | 结构化标注 |
| ST 变量语法 | `{{getvar::name}}` | ST 扩展变量 |

**关键函数:**

| 函数 | 说明 |
|---|---|
| `extractStateFields(text, characterNames)` | 从文本中提取 key:value 对 |
| `discoverDynamicFields(vault)` | 扫描角色卡+世界书，发现动态字段 |
| `buildDynamicStatePrompt(dynamicState, lang)` | 构建动态状态 prompt 注入文本 |
| `mergeDynamicState(dynamicState, changes)` | 合并 dot-path 状态变更 |
| `formatDynamicStateSummary(dynamicState)` | 格式化动态状态为摘要文本 |

---

### 4.19 轮次切分 — engine/turn-segmenter.js

**文件**: [src/engine/turn-segmenter.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/turn-segmenter.js)

**职责**: 对超长单条消息（如角色卡导入、长文本叙述）进行轮次切分，防止 LLM 上下文溢出。

**切分策略:**
- 按自然段切分，保证每段不超过 token 上限
- 保持语义完整性（不在句子中间切断）
- 使用 LLM 辅助判断语义边界

---

### 4.20 世界书同步 — engine/worldbook-sync.js

**文件**: [src/engine/worldbook-sync.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/worldbook-sync.js)

**职责**: 将 LTM 条目的关键信息同步到 ST 世界书（Lorebook），使世界书条目与记忆库保持一致。

**同步策略:**
- 从 LTM 条目中提取实体信息
- 通过 `TavernHelper.createLorebookEntries()` / `deleteLorebookEntries()` 操作世界书
- 支持自动同步和手动同步

---

### 4.21 数据校验 — engine/validate.js

**文件**: [src/engine/validate.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/validate.js)

**职责**: 对 Vault 数据进行合规性校验，处理版本迁移和损坏修复。

**校验项:**
- Vault 结构完整性（是否有 content、stm_entries、ltm_entries）
- entry 字段完整性（必须有 entry_id、event）
- 版本号校验与迁移
- 孤儿条目清理

---

### 4.22 推送遥测 — engine/telemetry.js

**文件**: [src/engine/telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/telemetry.js)

**职责**: 记录 Smart Push 的推送历史，用于调试和分析记忆注入效果。

**存储键**: `ne_telemetry`，保留最近 100 条记录。

**记录内容:**
- 推送时间戳
- 聊天 ID
- 注入的 prompt 文本（截断）
- 检索耗时

---

### 4.23 对话统计 — engine/chat-telemetry.js

**文件**: [src/engine/chat-telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/chat-telemetry.js)

**职责**: Per-chat 逐轮遥测计数器，统计每轮对话的记忆处理指标。

**存储键**: `ne_chat_stats`

**统计维度:**

| 维度 | 键 | 说明 |
|---|---|---|
| 轮次 | `t` | 当前轮号 |
| STM 条目数 | `stm` | 当前 Vault 中 STM 总数 |
| LTM 条目数 | `ltm` | 当前 Vault 中 LTM 总数 |
| LLM 调用次数 | `llm` | 本轮 LLM 调用次数 |
| Tool 调用次数 | `tool` | 本轮 Tool 调用次数 |
| Token 消耗 | `tok` | 本轮 Token 消耗 |
| 错误数 | `err` | 本轮错误次数 |
| 管线耗时 | `dur` | 本轮管线总耗时 (ms) |

**关键函数:**

| 函数 | 说明 |
|---|---|
| `incrementChatTurn(chatId)` | 推进一轮，创建新快照 |
| `recordChatStat(chatId, key, value)` | 更新当前轮指标 |
| `getChatTurnNumber(chatId)` | 获取当前轮号 |
| `getChatStats(chatId)` | 获取某 chat 完整统计 |
| `getAllChatStats()` | 获取所有 chat 统计 |
| `clearChatStats(chatId)` | 清除某 chat 统计 |

---

### 4.24 嵌入恢复 — auto-restore.js

**文件**: [src/auto-restore.js](file:///d:/SillyTavern/xm/ne-memory/src/auto-restore.js)

**职责**: 从 ST 的 `chat_metadata.ne_vault` 中自动恢复嵌入式 Vault 数据。

**恢复流程:**
1. 检查 `chat_metadata.ne_vault` 是否存在
2. 若已有 localStorage Vault（version > 0），跳过恢复，清理 metadata
3. 若不存在，弹出确认对话框（使用 toastr 通知 + confirm）
4. 用户确认后恢复，写入 localStorage，清理 metadata
5. 触发动态状态发现（若启用动态模式）

**关键函数:**
- `checkAndRestoreEmbeddedVault(chatId)`: 检查并恢复嵌入式 Vault

---

### 4.25 UI 工具 — ui/utils.js

**文件**: [src/ui/utils.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/utils.js)

**职责**: 提供 UI 辅助函数。

**关键函数:**

| 函数 | 说明 |
|---|---|
| `escapeHtml(str)` | HTML 实体转义 |
| `formatLocalTime(timestamp)` | 时间戳格式化（本地时间） |
| `truncateText(text, maxLength)` | 文本截断 |
| `highlightKeywords(text, keywords)` | 关键词高亮 |

---

### 4.26 Vault 面板 — ui/vault-panel.js

**文件**: [src/ui/vault-panel.js](file:///d:/SillyTavern/xm/ne-memory/src/ui/vault-panel.js)

**职责**: 实现 Vault 的可视化操作面板（抽屉式 UI），是用户与记忆系统交互的主要界面。

**UI 结构:**

```
抽屉面板 (ne_vault_drawer)
  ├── 头部 (ne_vault_header)
  │   ├── 标题 (ne_vault_title)
  │   ├── 版本信息 (ne_vault_version)
  │   └── 活动指示器 (narrative_vault_activity)
  ├── 标签栏 (ne_vault_tabs)
  │   ├── 概览标签
  │   ├── STM 标签
  │   ├── LTM 标签
  │   ├── 状态标签
  │   ├── 检索标签
  │   └── 日志标签
  ├── 内容区 (ne_vault_body)
  │   └── 各标签页内容
  └── 底部工具栏 (ne_vault_footer)
      ├── 整合按钮
      ├── 重置按钮
      └── 刷新按钮
```

**DOM 操作:**
- 通过 `window.parent.document` (PD) 操作 ST 主页面 DOM
- 动态创建/销毁 HTML 元素
- 抽屉动画（CSS transform transition）

**核心方法 (class VaultPanel):**

| 方法 | 说明 |
|---|---|
| `render()` | 渲染整个面板 |
| `renderOverview()` | 渲染概览标签页 |
| `renderSTM()` | 渲染 STM 记忆列表 |
| `renderLTM()` | 渲染 LTM 记忆列表（含手风琴展开） |
| `renderState()` | 渲染状态 Schema 视图 |
| `renderRetrieval()` | 渲染检索调试界面 |
| `renderLog()` | 渲染操作日志 |
| `toggleDrawer()` | 切换抽屉展开/收起 |
| `switchTab(tabName)` | 切换标签页 |

---

### 4.27 BM25 分组 — engine/bm25-grouper.js

**文件**: [src/engine/bm25-grouper.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/bm25-grouper.js)

**职责**: 实现 BM25 算法的并行分组执行，用于大批量候选项的高效排序。

**关键函数:**
- `bm25Group(candidates, query)`: 将候选项按 BM25 分数分组排序
- 使用 Web Worker 或 `Promise.all` 实现并行计算

---

## 5. 数据流与架构图

### 5.1 记忆生命周期

```
用户发送消息
    │
    ▼
[MESSAGE_SENT 事件]
    │
    ├──→ chat-telemetry.incrementChatTurn()  [轮次+1]
    ├──→ stm-extractor.extractSTM()          [提取STM]
    ├──→ update.executeIncrementalUpdate()    [增量更新状态]
    └──→ update.pushSmartMemory()            [Smart Push注入]
            │
            ▼
        [LLM 生成回复]
            │
            ▼
[MESSAGE_RECEIVED 事件]
    │
    ├──→ contradiction.detectContradictions() [矛盾检测]
    │       ├── 有矛盾 → 注入纠正prompt → 重新生成 → 退出
    │       └── 无矛盾 → 继续
    ├──→ auto-restore.checkAndRestore()       [嵌入恢复检查]
    ├──→ stm-extractor.extractSTM()           [新一轮STM提取]
    ├──→ update.executeIncrementalUpdate()     [增量状态更新]
    ├──→ consolidate.triggerConsolidation()   [条件触发LTM整合]
    ├──→ update.applyStateUpdatesFromSTM()    [状态Schema更新]
    └──→ worldbook-sync.syncWorldbook()       [世界书同步]
```

### 5.2 数据存储架构

```
┌────────────────────────────────────────────┐
│                 localStorage                │
│                                             │
│  ne_vault_{chatId}     → Vault主数据        │
│  ne_vault_snapshots_{chatId} → 版本快照     │
│  ne_settings           → 用户配置           │
│  ne_chat_stats         → 对话统计           │
│  ne_telemetry          → 推送遥测           │
│  ne_retrieval_notebook → 检索笔记本          │
│  ne_vault_log_{chatId} → 操作日志           │
│                                             │
├────────────────────────────────────────────┤
│              chat_metadata                  │
│                                             │
│  ne_vault (嵌入)       → Vault备用备份      │
│                                             │
└────────────────────────────────────────────┘
```

---

## 6. 依赖关系矩阵

### 6.1 模块间导入关系

| 模块 | 依赖 |
|---|---|
| **index.js** | events.js, tools.js, settings.js, i18n.js |
| **events.js** | vault/store.js, engine/stm-extractor.js, engine/update.js, engine/consolidate.js, engine/contradiction.js, auto-restore.js, engine/worldbook-sync.js, engine/chat-telemetry.js, engine/telemetry.js, vault/schema.js, api/llm.js |
| **tools.js** | vault/store.js, vault/retrieval-filter.js, engine/retrieval.js, api/llm.js |
| **settings.js** | i18n.js, api/llm.js |
| **api/llm.js** | (无内部依赖，仅依赖 ST 平台 API) |
| **vault/store.js** | (无内部依赖，仅依赖 localStorage) |
| **vault/schema.js** | (无内部依赖) |
| **vault/versions.js** | vault/store.js |
| **vault/retrieval-filter.js** | (无内部依赖，纯算法) |
| **vault/retrieval-notebook.js** | (无内部依赖) |
| **engine/stm-extractor.js** | vault/store.js, api/llm.js |
| **engine/update.js** | vault/store.js, vault/schema.js, api/llm.js |
| **engine/consolidate.js** | vault/store.js, api/llm.js |
| **engine/retrieval.js** | vault/store.js, vault/retrieval-filter.js, api/llm.js |
| **engine/ambiguity.js** | api/llm.js |
| **engine/contradiction.js** | vault/store.js, vault/retrieval-filter.js, api/llm.js |
| **engine/state-discovery.js** | vault/schema.js, i18n.js |
| **engine/turn-segmenter.js** | api/llm.js |
| **engine/worldbook-sync.js** | vault/store.js |
| **engine/validate.js** | vault/store.js |
| **engine/telemetry.js** | (无内部依赖) |
| **engine/chat-telemetry.js** | (无内部依赖) |
| **engine/bm25-grouper.js** | (无内部依赖) |
| **auto-restore.js** | vault/store.js, engine/state-discovery.js, vault/schema.js, i18n.js |
| **ui/utils.js** | (无内部依赖) |
| **ui/vault-panel.js** | vault/store.js, vault/versions.js, engine/consolidate.js, engine/update.js, i18n.js, ui/utils.js, vault/schema.js, api/llm.js, vault/retrieval-filter.js, engine/retrieval.js, engine/ambiguity.js, tools.js, vault/retrieval-notebook.js, engine/chat-telemetry.js |

### 6.2 核心依赖图

```
vault/store.js  ←── 被几乎所有模块依赖（数据读写中枢）
api/llm.js      ←── 被所有需要LLM调用的模块依赖
vault/schema.js ←── 被 update, ui/vault-panel, state-discovery, events 依赖
i18n.js         ←── 被 settings, ui/vault-panel, auto-restore 依赖
```

---

## 7. 项目运行方式

### 7.1 构建

```bash
# 安装依赖
npm install

# 构建项目（Rollup 打包）
npm run build
```

构建输出:
- `dist/index.js` — 打包后的主脚本（IIFE 格式，可直接在浏览器中加载）
- `dist/test-harness.js` — TH 平台测试桩
- `dist/th-test.js` — TH 平台加载测试

### 7.2 开发

```bash
# 监听模式（文件变更自动构建）
npm run dev

# 类型检查（使用 JSDoc 注解，通过 ts-check）
# 在 VSCode 中启用 jsconfig.json 的 checkJs
```

### 7.3 在 SillyTavern 中加载

**方式一：TH-Script（CDN 加载）**

在 ST 的 Tavern Helper 扩展中导入 `th-script-template.json`，脚本通过 CDN 加载：
```
https://gcore.jsdelivr.net/gh/Melody-0321/NE-Memory@test3.0/dist/index.js
```

**方式二：本地开发加载**

1. 构建 `dist/index.js`
2. 在 TH 中添加脚本，内容指向本地文件或本地静态服务器

### 7.4 环境要求

- **SillyTavern** v1.11+ （提供 `SillyTavern.getContext()` API）
- **Tavern Helper** (JS-Slash-Runner) — 提供 iframe 沙箱和 `TavernHelper` API
- **现代浏览器**: Chrome/Firefox/Edge 最新版（需支持 ES6 Module、fetch、localStorage）

### 7.5 Rollup 构建配置

**文件**: [rollup.config.mjs](file:///d:/SillyTavern/xm/ne-memory/rollup.config.mjs)

- 入口: `src/index.js`
- 输出: `dist/index.js` (IIFE 格式)
- 插件: `@rollup/plugin-node-resolve`
- 不包含 Node.js 内置模块（纯浏览器运行时）

---

## 8. 构建与部署

### 构建命令

| 命令 | 说明 |
|---|---|
| `npm install` | 安装构建依赖 |
| `npm run build` | Rollup 生产构建 |
| `npm run dev` | Rollup 监听模式 |

### 部署方式

1. **CDN 部署**: 将 `dist/index.js` 上传到 CDN（如 jsDelivr），通过 TH-Script JSON 配置引用
2. **本地部署**: 将 `dist/index.js` 直接复制到 ST 扩展目录
3. **开发调试**: 使用本地静态服务器 + TH 开发模式

---

## 9. 关键概念词汇表

| 术语 | 全称 | 说明 |
|---|---|---|
| **NE** | Narrative Engine | 项目简称，叙事记忆引擎 |
| **ST** | SillyTavern | AI 角色扮演前端平台 |
| **TH** | Tavern Helper | ST 的脚本扩展平台 |
| **STM** | Short-Term Memory | 短期记忆：从最新消息中提取的事件片段 |
| **LTM** | Long-Term Memory | 长期记忆：多轮 STM 整合形成的持久化记忆 |
| **Vault** | 记忆库 | 每个聊天的完整记忆数据容器（STM + LTM + 状态） |
| **Smart Push** | 智能注入 | 在 AI 生成前将相关记忆注入上下文 |
| **State Schema** | 状态模式 | 结构化的角色/阵营/任务状态追踪 |
| **Dynamic State** | 动态状态 | 从角色卡自动发现的状态字段（替代硬编码 Schema） |
| **BM25** | Best Match 25 | 信息检索算法，用于候选记忆排序 |
| **Consolidation** | 整合 | 将多条 STM 合并归一化为 LTM |
| **Entity Chain** | 实体链 | 实体在记忆中的关联历史记录 |
| **Contradiction Detection** | 矛盾检测 | 检测 AI 回复是否与记忆库事实冲突 |
| **Ambiguity Resolution** | 指代消解 | 将代词转换为具体实体名 |

---

> **文档生成时间**: 2026-06-13  
> **项目版本**: test3.0 (Vault v4)  
> **文档维护**: 随代码更新同步维护
