# Anima — Code Wiki

> **项目名称**: Anima Memory System (前端) + Anima RAG (后端)
> **描述**: SillyTavern 第三方记忆插件——独立后端驱动，基于向量检索 + BM25 双重引擎 + Echo 生命周期 + 分布式策略检索
> **许可**: AGPL-3.0
> **语言**: JavaScript (Frontend ES Module + Backend Node.js)
> **平台**: 浏览器端 + Node.js 独立后端
> **作者**: Ellinav
> **仓库**:
> - 前端: <https://github.com/Ellinav/Anima-Memory-System>
> - 后端: <https://github.com/Ellinav/anima-rag>

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [前端核心模块详解](#4-前端核心模块详解)
   - [4.1 入口与配置](#41-入口与配置)
   - [4.2 RAG 检索注入](#42-rag-检索注入)
   - [4.3 批量总结 (Summary)](#43-批量总结-summary)
   - [4.4 状态追踪 (Status)](#44-状态追踪-status)
   - [4.5 知识库 (Knowledge)](#45-知识库-knowledge)
   - [4.6 世界书集成](#46-世界书集成)
   - [4.7 工具与辅助](#47-工具与辅助)
5. [后端核心模块详解](#5-后端核心模块详解)
   - [5.1 API 路由](#51-api-路由)
   - [5.2 向量嵌入](#52-向量嵌入)
   - [5.3 分布式策略检索](#53-分布式策略检索)
   - [5.4 Echo 生命周期](#54-echo-生命周期)
   - [5.5 BM25 引擎](#55-bm25-引擎)
   - [5.6 重排 (Rerank)](#56-重排-rerank)
   - [5.7 代理转发](#57-代理转发)
6. [关键类与函数](#6-关键类与函数)
7. [数据流与核心流程](#7-数据流与核心流程)
8. [关键数据结构](#8-关键数据结构)
9. [依赖关系](#9-依赖关系)
10. [构建与运行](#10-构建与运行)

---

## 1. 项目概述

**Anima** 是一个由**前端 ST 扩展 + 独立 Node.js 后端**组成的 SillyTavern 记忆系统。它通过独立后端将向量存储、BM25 索引和重排计算从浏览器卸载到服务端，实现了可水平扩展的 RAG 记忆检索。

### 核心能力

| 能力 | 说明 |
|------|------|
| **独立后端** | Node.js Express 服务，向量存储 + BM25 + 重排 + 代理转发 |
| **分布式策略检索** | 7 阶段流水线：base → important → vibe → status → period → special → diversity → rerank |
| **双重检索引擎** | 向量 (OpenAI-compatible Embedding API) + BM25 (jieba-wasm + MiniSearch) |
| **Echo 生命周期** | 每段记忆有 life 值，每次命中消耗 life，枯竭后自动 GC；重要记忆有更高的 maxLife |
| **Swipe 复活** | 当用户 Swipe 时，已枯竭的记忆被临时复活，保证多样化输出 |
| **批量总结** | 按触发间隔 (默认 30轮) 自动调用 LLM 生成分层总结，存入世界书 |
| **状态追踪** | 通过 JSON/YAML 规则引擎追踪角色生理状态，注入 prompt |
| **知识库** | 独立文档知识库，支持向量 + BM25 跨库检索 |
| **世界书集成** | 所有记忆 (切片的总结、RAG 召回) 存入 ST 世界书，可绑定多个聊天 |

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    SillyTavern (Browser)                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │            Anima-Memory-System (Frontend Extension)          │ │
│  │                                                              │ │
│  │  interceptor.js    rag_logic.js    summary_logic.js         │ │
│  │  (注入拦截)        (RAG查询构建)   (批量总结)                │ │
│  │                                                              │ │
│  │  status_logic.js   knowledge.js     worldbook_api.js        │ │
│  │  (状态追踪)        (知识库UI)       (世界书CRUD)             │ │
│  │                                                              │ │
│  │  db_api.js (后端通信)  ──→  /api/plugins/anima-rag/*        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                    ST Plugin Proxy
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                Anima RAG Backend (Node.js)                       │
│                                                                  │
│  Express Router (23 endpoints)                                   │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │ /insert  │  /query  │ /merge   │ /delete  │ /rebuild │      │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │ /bm25/*  │ /export  │ /import  │ /proxy   │ /list    │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                  │
│  Core Engines:                                                   │
│  ┌────────────────────┐  ┌─────────────────┐                    │
│  │ Vector Store       │  │ BM25 Engine     │                    │
│  │ (FileSystem-based) │  │ (MiniSearch     │                    │
│  │ Cosine + Filter    │  │ + jieba-wasm)   │                    │
│  └────────────────────┘  └─────────────────┘                    │
│  ┌────────────────────┐  ┌─────────────────┐                    │
│  │ Echo Lifecycle     │  │ Rerank Engine   │                    │
│  │ (Memory GC/复活)   │  │ (Jina/Cohere)   │                    │
│  └────────────────────┘  └─────────────────┘                    │
│                                                                  │
│  Storage:                                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ data/vectors/{collectionId}/    (向量文件存储)          │     │
│  │ data/bm25_indexes/{dbId}.json   (BM25 索引文件)        │     │
│  │ data/sessions/                  (Echo会话状态)          │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 三条核心数据链路

```
Write Path (对话 → 后端存储)
  批量总结 → LLM 生成切片 → saveSummaryBatchToWorldbook
  → worldbook 条目 → 触发 BM25/向量增量构建

Read Path (检索 → 注入)
  Generation interceptor → constructRagQuery → query /api/query
  → 向量 + BM25 并行 → 分布式策略 → Echo生命周期 → 重排
  → 合并结果 → 写入世界书 → prompt 注入

Status Path (状态 → 追踪)
  statusLogic → YAML规则引擎 → 命中tags → 注入prompt + 检索增强
```

---

## 3. 目录结构

### Anima-Memory-System (前端)

```
Anima-Memory-System/
├── index.js                  # 扩展入口：注册面板、初始化模块
├── manifest.json             # ST 扩展清单
├── settings.html             # 设置面板 HTML
├── style.css                 # 扩展样式
│
├── scripts/
│   ├── api.js                # API 配置与代理请求 (LLM/RAG/Status)
│   ├── db_api.js             # 后端通信 (通用 fetch)
│   ├── interceptor.js        # 🧠 核心：生成拦截器 — RAG查询→注入
│   ├── rag_logic.js          # RAG 查询构造、内存管理、状态规则引擎
│   ├── rag.js                # RAG UI 设置面板、召回缓存
│   ├── rag_ui_components.js  # RAG 子组件 (策略表/标签表/文件列表)
│   ├── summary_logic.js      # 批量总结：自动触发 + 世界书写入
│   ├── status_logic.js       # 状态追踪：YAML + 规则引擎 + 注射器
│   ├── status_zod.js         # Zod 状态数据校验
│   ├── knowledge.js          # 知识库 UI：上传/搜索/嵌入
│   ├── knowledge_logic.js    # 知识库后端逻辑
│   ├── bm25_logic.js         # BM25 配置与后端同步
│   ├── worldbook_api.js      # 世界书 CRUD (插入/删除/更新切片)
│   ├── tools.js              # 工具：GPT JSON 格式转换
│   └── utils.js              # 工具函数：HTML转义、上下文数据、宏替换、JSON解析
│
└── third-party/
    └── assets/                # 第三方资源
```

### Anima RAG (后端)

```
anima-rag/
├── index.js                  # Express 服务入口 (3700+ 行) — 所有路由与核心逻辑
├── bm25_engine.js            # BM25 检索引擎 (jieba-wasm + MiniSearch)
├── package.json              # 依赖清单
│
├── data/
│   ├── vectors/              # 向量文件存储 (按 collectionId 目录)
│   ├── bm25_indexes/         # BM25 索引文件
│   └── sessions/             # Echo 会话状态文件
│
└── scripts/
    └── migrate_vector_metadata.js  # 元数据迁移脚本
```

---

## 4. 前端核心模块详解

### 4.1 入口与配置

#### [scripts/api.js](file:///d:/SillyTavern/xm/anima-memory/scripts/api.js)

**职责**: 定义插件的 API 配置结构，封装对后端的流式/非流式请求。

| 关键结构 | 说明 |
|----------|------|
| `defaultSettings.api.llm` | LLM API 配置 (source/url/key/model/temperature) |
| `defaultSettings.api.status` | 状态追踪专用 LLM 配置 |
| `defaultSettings.api.rag` | RAG Embedding API 配置 (top_k/threshold) |
| `defaultSettings.api.rerank` | 重排 API 配置 |
| `defaultSettings.api_profiles` | 多渠道预设仓库 |
| `proxyFetch(targetUrl, options)` | 后端代理请求 (流式/非流式) |
| `getAnimaConfig()` | 获取插件配置 |
| `generateText(messages, opts)` | LLM 文本生成 (支持 temperature/max_tokens 等) |

---

### 4.2 RAG 检索注入

#### [scripts/interceptor.js](file:///d:/SillyTavern/xm/anima-memory/scripts/interceptor.js)

**职责**: **核心注入模块**——在 LLM 生成前拦截，构造查询 → 调用后端检索 → 注入世界书。

| 函数 | 说明 |
|------|------|
| `constructRagQuery(chat, settings)` | 从原始聊天中提取最近消息构造检索查询。过滤系统消息 + skip_layer_zero |
| `formatMergedChat(mergedList)` | 将后端返回的 Chat 检索结果拼接为文本 |
| `formatMergedKb(mergedList)` | 将知识库检索结果按源文件分组拼接 |
| 注入逻辑 | → `updateRagEntry` 写入世界书条目 `[Anima RAG: Chat Results]` |

**注入流程:**
```
ST 生成前 → interceptor
  ↓
constructRagQuery (最近N条消息 → 查询字符串)
  ↓
queryDual (Chat集合 + KB集合 → 后端并行检索)
  ↓
formatMergedChat/formatMergedKb
  ↓
updateRagEntry → 写入世界书 → ST 自动注入 prompt
```

#### [scripts/rag_logic.js](file:///d:/SillyTavern/xm/anima-memory/scripts/rag_logic.js)

**职责**: RAG 核心逻辑——查询构造、状态规则引擎、时间/节日检测、内存管理。

| 核心功能 | 说明 |
|----------|------|
| **分布式策略构造** | `buildDistributedStrategy()` — 从 settings 解析 7 层策略 (base/important/vibe/status/period/special/diversity) |
| **状态规则引擎** | `evaluateStatusRules(data, rules)` — 读取角色的 anima_data JSON，按路径+操作符规则命中 tags |
| **时间/生理检测** | `findDateRecursive(obj)` — 递归查找日期字段；`detectHoliday()` — 节日匹配 |
| **Echo 配置** | `echoConfig`: base_life/imp_life/echo_max_count → 传给后端 |
| **查询规范化** | `getEffectiveSettings()` — 合并全局+本地设置 |
| **内存管理** | `insertMemory()/deleteMemory()` — 向世界书增删记忆 |
| **结果缓存** | `getLastRetrievalPayload()` — 缓存最近一次检索请求供调试 |

#### [scripts/rag.js](file:///d:/SillyTavern/xm/anima-memory/scripts/rag.js)

**职责**: RAG 设置面板 UI——分布式策略配置、标签表、文件列表、节日弹窗。

| 导出 | 说明 |
|------|------|
| `DEFAULT_RAG_SETTINGS` | 默认 RAG 设置 (base_count/min_score/recent_weight 等) |
| `updateLastRetrievalResult(data)` | 缓存检索结果并触发按钮高亮 |
| `clearLastRetrievalResult()` | 清除缓存 |
| `getChatRagFiles()` | 获取当前聊天的 RAG 集合文件 |

---

### 4.3 批量总结 (Summary)

#### [scripts/summary_logic.js](file:///d:/SillyTavern/xm/anima-memory/scripts/summary_logic.js)

**职责**: 根据触发间隔自动调用 LLM 生成分层总结切片，存入世界书。

| 配置项 | 默认值 | 说明 |
|------|:---:|------|
| `trigger_interval` | 30 | 多少轮触发一次总结 |
| `group_size` | 10 | 多少轮对话合为一个切片 |
| `hide_skip_count` | 5 | 隐藏最近 N 个切片在世界书列表中 |
| `wrapper_template` | `<{{index}}>{{summary}}</{{index}}>` | 切片包装格式 |
| `summary_messages` | system+user | 总结 prompt 消息对 |

**工作流程:**
```
对话轮数达到 trigger_interval 的倍数
  ↓
构造 prompt (role定义 + 数字前缀 + 分层包装 + 前文总结)
  ↓
generateText → 返回切片列表
  ↓
saveSummaryBatchToWorldbook → 存入世界书 [Anima Sigma: Batch N]
  ↓
triggerBm25BuildSingle → 增量更新 BM25 索引
```

**核心导出:**
- `runSummary()` / `runManualSummary(range)` — 自动/手动执行总结
- `getOrInitNarrativeTime()` — 获取或初始化叙事时间
- `getSummarySettings()` — 获取全球+本地合并设置

---

### 4.4 状态追踪 (Status)

#### [scripts/status_logic.js](file:///d:/SillyTavern/xm/anima-memory/scripts/status_logic.js)

**职责**: 通过 YAML 规则引擎追踪角色生理/情感状态，注入 LLM prompt。

| 规则类型 | 说明 |
|----------|------|
| `char_info` / `user_info` | 角色/用户信息占位 → prompt 渲染 |
| `{{status}}` | 实时状态插入位 |
| `{{chat_context}}` | 增量剧情自动上下文插入 |
| `beautify_settings` | 状态美化模板 |
| `injection_settings` | 注入位置 (at_depth/after_char/before_char) |

**工作流程:**
```
用户消息 → 构造请求 (更新上下文)
  ↓
generateText (status LLM) → 返回 YAML
  ↓
validateStatusData (Zod 校验) → 合并到 status
  ↓
渲染 prompt 中的 {{status}} 占位符
  ↓
注入到 system prompt 中
```

**核心导出:**
- `getStatusContext()` — 获取当前状态 YAML
- `runStatusQuery()` — 手动触发状态更新
- `injectStatusToPrompt(prompt)` — 注入到 prompt

---

### 4.5 知识库 (Knowledge)

#### [scripts/knowledge.js](file:///d:/SillyTavern/xm/anima-memory/scripts/knowledge.js)

**职责**: 独立知识库管理与 UI——文档上传、分片、向量化、跨库检索。

| 配置项 | 默认值 | 说明 |
|------|:---:|------|
| `chunk_size` | 500 | 分片大小 (字符) |
| `write_vector` | true | 写入向量索引 |
| `write_bm25` | true | 写入 BM25 索引 |
| `scan_floors` | 3 | 扫描最近楼层构造查询 |
| `search_top_k` | 3 | 向量检索数量 |
| `bm25_top_k` | 3 | BM25 检索数量 |
| `min_score` | 0.5 | 最低相关度阈值 |

**注入配置:**
- `knowledge_injection.strategy`: `constant` (始终注入) / `on_hit` (有命中时注入)
- `knowledge_injection.position`: before_character_definition / at_depth / etc.
- `knowledge_injection.template`: 注入模板 (`{{knowledge}}` 替换)

---

### 4.6 世界书集成

#### [scripts/worldbook_api.js](file:///d:/SillyTavern/xm/anima-memory/scripts/worldbook_api.js)

**职责**: 所有持久化通过 ST 世界书系统。管理总结切片、RAG 结果的世界书条目。

| 函数 | 说明 |
|------|------|
| `safeGetChatWorldbookName()` | 获取/自动恢复聊天世界书绑定 |
| `saveSummaryBatchToWorldbook(summaryList, batchId, ...)` | 批量写入总结切片 |
| `updateRagEntry(text)` | 更新 RAG 召回结果条目 |
| `clearRagEntry()` | 清除 RAG 结果 |
| `getLatestRecentSummaries(count)` | 获取最近 N 条总结 |
| `getPreviousSummaries(range)` | 获取指定范围的前文总结 |
| `updateKnowledgeEntry(text)` | 更新知识库召回条目 |
| `clearKnowledgeEntry()` | 清除知识库召回 |
| `toggleAllSummariesState(state)` | 批量启用/禁用所有总结条目 |
| `getIndexConflictInfo(index)` | 检测切片索引冲突 |
| `getLatestSummaryInfo()` | 获取最新切片元数据 |
| `markAllBm25Unsynced()` | 标记所有条目 BM25 失同步 |
| `syncRagSettingsToWorldbook(wbName)` | 同步 RAG 设置到世界书 |

---

### 4.7 工具与辅助

#### [scripts/db_api.js](file:///d:/SillyTavern/xm/anima-memory/scripts/db_api.js)

**职责**: 后端通信——统一的 `callBackend(endpoint, payload, method)` 函数。

所有请求自动带上 `apiConfig`（从 `getAnimaConfig()` 获取 RAG API 凭证），通过 `/api/plugins/anima-rag{endpoint}` 转发。

#### [scripts/utils.js](file:///d:/SillyTavern/xm/anima-memory/scripts/utils.js)

| 函数 | 说明 |
|------|------|
| `escapeHtml(text)` | HTML 实体转义 |
| `getContextData()` | 获取当前上下文 (角色名/描述/用户名/persona) |
| `createRenderContext(rawData)` | 注入 _user/_char 别名 |
| `processMacros(template, context)` | 宏替换 ({{char}}/{{user}}/{{time}} 等) |
| `extractJsonResult(text)` | 从 LLM 输出中提取 JSON |
| `deepMergeUpdates(target, updates)` | 递归深度合并 |
| `objectToYaml(obj)` / `yamlToObject(yaml)` | YAML 互转 |
| `applyRegexRules(text, rules)` | 正则过滤 |
| `getSmartCollectionId()` | 生成安全集合 ID |

#### [scripts/bm25_logic.js](file:///d:/SillyTavern/xm/anima-memory/scripts/bm25_logic.js)

**职责**: BM25 词典管理——为每个角色绑定自定义分词词典 (支持多词典切换)。

| 函数 | 说明 |
|------|------|
| `getBm25Settings()` | 获取全局 BM25 设置 |
| `getBm25BackendConfig(targetDictName)` | 构建发给后端的 BM25 配置包 |
| `triggerBm25BuildSingle(item)` | 触发单条目 BM25 增量构建 |
| `triggerFullBm25Rebuild()` | 全量重建 BM25 索引 |
| `autoUpdateDictionary(wbName, chatId)` | 自动更新角色绑定词典 |

---

## 5. 后端核心模块详解

### 5.1 API 路由

后端基于 Express，提供 **23 个 API 端点**：

| 端点 | 方法 | 说明 |
|------|:---:|------|
| `/insert` | POST | 插入记忆 (向量化 + BM25 写入) |
| `/query` | POST | **核心检索**：向量 + BM25 + 分布式策略 + Echo + 重排 |
| `/merge` | POST | 合并多条检索结果 (去重 + 排序) |
| `/delete` | POST | 单条删除 |
| `/delete_batch` | POST | 批量删除 |
| `/delete_collection` | POST | 删除整个集合 |
| `/rebuild_collection` | POST | 全量重建向量索引 |
| `/rebuild_vector_from_bm25` | POST | 从 BM25 索引重建向量 |
| `/export_collection` | POST | 导出集合 |
| `/import_collection` | POST | 导入集合 |
| `/check_collection_exists` | POST | 检查集合存在 |
| `/import_knowledge` | POST | 导入知识库文档 |
| `/list` | GET | 列出所有集合 |
| `/view_collection` | POST | 查看集合内容 (分页) |
| `/test_connection` | POST | 测试 API 连接 |
| `/bm25/list` | GET | 列出 BM25 索引 |
| `/bm25/export_single` | POST | 导出 BM25 索引 |
| `/bm25/import_single` | POST | 导入 BM25 索引 |
| `/bm25/delete_single` | POST | 删除 BM25 索引 |
| `/bm25/rebuild_collection` | POST | 重建 BM25 索引 |
| `/bm25/rebuild_slice` | POST | 重建单条 BM25 |
| `/bm25/rebuild_slice_batch` | POST | 批量重建 BM25 |
| `/proxy/forward` | POST | **代理转发** — 跨域 API 请求中转 |

---

### 5.2 向量嵌入

```javascript
// [anima-rag/index.js:L342-L400]
async function getEmbedding(text, config) {
    // 调用 OpenAI-compatible /embeddings 接口
    // 超时控制: 15s AbortController
    // 返回: vector (number[])
}
```

**向量存储**: 文件系统 (`data/vectors/{collectionId}/`)

每个 collection 使用 `vector-storage` 类似的轻量 FS 索引，支持：
- `listItems()` — 列出所有条目
- `addItem(item)` — 添加
- `deleteItem(id)` — 删除
- `search(vector, topK, filter)` — Cosine 相似度搜索

**关键特性:**
- 每次 insert 时写入前自检：清理同 index 的旧版本
- 索引之间去重：`getIndex(collectionId, create=false)` 支持读/写分离
- 向量写入失败时自动回退

---

### 5.3 分布式策略检索

这是 Anima 最核心的检索架构——不是简单的 top-K 向量检索，而是一个 **7 阶段策略流水线**：

```
performDynamicStrategy(indices, vector, strategy, ignoreIds)
  │
  ├── Stage 1: BASE (基础向量检索)
  │     → queryMultiIndices × candidateK → 按 min_score 过滤 → 取 base_count 条
  │
  ├── Stage 2: IMPORTANT (重要标签词分支检索)
  │     → queryMultiIndices filter={tags:{$in:[Important,重要,...]}}
  │     → 每条标签取 step.count 条 → 放入重排池
  │
  ├── Stage 3: VIBE (氛围标签词)
  │     → 检测当前对话的"氛围" → filter={tags:{$in:[vibe_tags]}}
  │
  ├── Stage 4: STATUS (状态标签词)
  │     → filter={tags:{$in:[Sick,Injury,...]}} → rule 引擎动态匹配 tags
  │
  ├── Stage 5: PERIOD (生理标签词)
  │     → filter={tags:{$in:[period_tags]}} → 基于时间规则触发
  │
  ├── Stage 6: SPECIAL (特殊/节日标签词)
  │     → filter={tags:{$in:[special_tags]}} → 节日自动检测
  │
  ├── Stage 7: DIVERSITY (丰富度兜底)
  │     → filter={tags:{$nin:[已命中tags]}} → 确保未出现的维度也有召回
  │
  └── 结果聚合:
        → 按时间排序 (时间戳升序)
        → 去重 (usedIds Set)
        → 服务端重排 (如果启用)
        → 返回 finalResults
```

**每阶段关键参数:**
- `candidateK = base_count × candidate_multiplier` (默认 2)
- `min_score`: 全局最低相关度阈值 (默认 0.2)
- `recent_weight`: 近期记忆加权 (默认 0.05)
- `count`: 每阶段保留条数

**Recent Weight 机制:**
```javascript
// 每条结果的分数 = 原始cosine分数 + recent_weight（如果属于当前 session）
if (recentWeight > 0 && currentSessionId && item.metadata.sessionId === currentSessionId) {
    res.score = rawScore + recentWeight;
    res._is_weighted = true;
}
```

---

### 5.4 Echo 生命周期

Anima 的记忆管理使用 **Echo 生命周期**——每段被召回的记忆有 `life` 值：

```
记忆状态机:
  ┌─────────┐   被召回     ┌──────────┐   life > 0   ┌──────────┐
  │  新建   │ ───────→  │  活跃记忆  │ ────────→   │  枯竭记忆  │
  │ life=N  │           │ life递减   │            │  life<=0   │
  └─────────┘           └──────────┘            └─────┬─────┘
                                                      │
                                         ┌─────────────┼──────────────┐
                                         │ Normal模式   │ Swipe模式     │
                                         │ GC 清理      │ 临时复活     │
                                         └──────────────┴──────────────┘
```

| 参数 | 默认值 | 说明 |
|------|:---:|------|
| `base_life` | 1 | 普通记忆的基础生命值 |
| `imp_life` | 2 | 重要记忆 (标签含 Important) 的生命值 |
| `echo_max_count` | 10 | 最大活跃记忆数量 |

```javascript
// [anima-rag/index.js:L280-L336]
function processEcho(currentResults, lastMemories, config) {
    // 1. GC: 旧记忆中 life > 0 的继承到 nextMemories
    // 2. 注册新记忆: 根据 tags 判断 base_life 或 imp_life
    // 3. 对每段记忆: 设置初始 life = 最大值，maxLife = 最大值
    // 返回: { echoItems, nextMemories, echoLogs }
}
```

**效果**: 一段记忆被多次召回的次数越多，life 消耗越快。重要的记忆 (标记为 Important) 有更多的 life。频繁但不重要的记忆会先枯竭，被 GC 清除。Swipe 时所有枯竭记忆被临时复活 (life=1)，保证多样化输出。

---

### 5.5 BM25 引擎

#### [bm25_engine.js](file:///d:/SillyTavern/xm/anima-rag/bm25_engine.js)

**职责**: 基于 jieba-wasm + MiniSearch 的 BM25 全文检索引擎。

| 组件 | 技术 |
|------|------|
| **分词器** | jieba-wasm `cut_for_search()` — CJK 分词 (支持自定义词典) |
| **搜索引擎** | MiniSearch — 内存 BM25 索引 |
| **存储** | 文件系统 JSON (data/bm25_indexes/{dbId}.json) |
| **停用词** | 内建 80+ 中文停用词 (代词/助词/语气词/标点) |
| **自定义词典** | 通过 bm25_logic.js 按角色绑定自定义词典，分词时用 `add_word()` 注册 |

**关键方法:**

| 方法 | 说明 |
|------|------|
| `_syncJieba(dictionary)` | 同步自定义词典到 jieba 分词器 |
| `_tokenize(text)` | CJK 分词 + 停用词过滤 |
| `buildIndex(dbId, items, dictionary)` | 构建/重建 BM25 索引 |
| `search(dbId, query, topK, dictionary)` | 搜索：返回 `[{id, score}]` |
| `addDocument(dbId, doc, dictionary)` | 增量添加文档 |
| `deleteDocument(dbId, id)` | 删除文档 |
| `exportIndex(dbId)` / `importIndex(dbId, data)` | 导入/导出索引 |

**BM25 与向量的协同:**
`/query` 端点同时执行向量检索和 BM25 检索，结果在后端合并后返回给前端。

---

### 5.6 重排 (Rerank)

```javascript
// [anima-rag/index.js — callRerank]
async function callRerank(query, documents, config) {
    // 调用 Jina/Cohere re-ranking API
    // 返回: re-ranked documents with scores
}
```

**触发条件**: `rerank_enabled = true` 且在分布式策略中指定了 `rerank` 步骤。

**作用**: 在 7 阶段初步结果聚合后，对 top-N 候选做精排，提升最终排序质量。

**执行模式**: 批量模式 — 累积一定数量的候选 → 一次性调用重排 API。

---

### 5.7 代理转发

```javascript
// [anima-rag/index.js:L3659-L3733]
router.post("/proxy/forward", async (req, res) => {
    // 转发任意 HTTP 请求 (解决浏览器 CORS)
    // 支持流式和非流式
    // 自动继承 ST 全局代理配置 (config.yaml)
    // GET/POST 动态路由
});
```

**用途:** 前端可能需要通过后端中转访问外部 API (LLM/Embedding/Rerank)，绕过浏览器的 CORS 限制。后端自动检测 ST 的 `config.yaml` 中的 proxy 配置。

---

## 6. 关键函数

### 6.1 constructRagQuery (前端核心)

[scripts/interceptor.js](file:///d:/SillyTavern/xm/anima-memory/scripts/interceptor.js)

```javascript
function constructRagQuery(chat, settings) {
    // 1. 获取全部原始聊天 (TavernHelper.getChatMessages)
    // 2. 过滤系统消息 + 空消息 + skip_layer_zero
    // 3. 按 prompt 配置构造: 取最近 N 条消息或指定角色
    // 4. 可选: 加入原始用户输入 (is_send=true)
    // 5. 返回: 查询字符串
}
```

### 6.2 buildDistributedStrategy (前端)

[scripts/rag_logic.js](file:///d:/SillyTavern/xm/anima-memory/scripts/rag_logic.js)

```javascript
function buildDistributedStrategy(settings, statusTags, vibeTag, holidayTags, periodTags) {
    // 构造发给后端的完整策略:
    return {
        enabled: true,
        min_score: 0.2,
        recent_weight: 0.05,
        candidate_multiplier: 2,
        steps: [
            { type: "base", count: 2 },
            { type: "important", labels: ["Important","重要"], count: 1 },
            { type: "vibe", labels: [vibeTag], count: 1 },
            { type: "status", labels: [statusTags], count: 1 },
            { type: "period", labels: [periodTags], count: 1 },
            { type: "special", labels: [holidayTags], count: 1 },
            { type: "diversity", count: 1 },
        ]
    };
}
```

### 6.3 performDynamicStrategy (后端核心)

[anima-rag/index.js:L880-L1220](file:///d:/SillyTavern/xm/anima-rag/index.js)

```javascript
async function performDynamicStrategy(indices, vector, strategy, ignoreIds) {
    // 循环 7 阶段 → 每阶段独立查询 → 去重 → 聚合
    // 重排: 批量调用 callRerank (如启用)
    // 最终排序: 时间戳升序 (保证叙事时间线)
    // 返回: finalResults[] + _debug_logs + _echo_pool
}
```

### 6.4 processEcho (后端)

[anima-rag/index.js:L260-L336](file:///d:/SillyTavern/xm/anima-rag/index.js)

```javascript
function processEcho(currentResults, lastMemories, config) {
    // 旧记忆衰减: life-- (可选)
    // GC: life <= 0 的记忆被清除 (Normal模式)
    // Swipe复活: 所有 life<=0 的记忆 → life=1
    // 新记忆注册: 根据标签设置 life
    // 返回: { echoItems, nextMemories }
}
```

### 6.5 BM25Engine (后端)

[bm25_engine.js](file:///d:/SillyTavern/xm/anima-rag/bm25_engine.js)

```javascript
class BM25Engine {
    constructor() { /* FS 缓存 + 内存索引 Map */ }
    _syncJieba(dictionary)   // 注册自定义词到分词器
    _tokenize(text)          // jieba cut_for_search + 停用词过滤
    buildIndex(dbId, items, dictionary)  // 构建 MiniSearch 索引
    search(dbId, query, topK, dictionary) // BM25 搜索
    addDocument/deleteDocument/export/import  // CRUD
}
```

---

## 7. 数据流与核心流程

### 7.1 检索注入流程 (最高频)

```
ST 生成前拦截
  │
  ├── constructRagQuery → 从最近消息中构造查询文本
  │
  ├── buildDistributedStrategy → 根据 settings + status/vibe/holiday 标签
  │
  ├── callBackend("/query") →
  │     {
  │       searchText: "查询词",
  │       bm25SearchText: "BM25查询词",
  │       chatContext: { ids: [chat_collections], strategy: {...} },
  │       kbContext: { ids: [kb_collections], strategy: {...} },
  │       echoConfig: { baseLife, impLife, echoMaxCount },
  │       sessionId: "...",
  │       is_swipe: false,
  │       rerankConfig: {...},
  │       bm25Configs: {...}
  │     }
  │
  ├── 后端处理:
  │     ├── getEmbedding → 向量 → Chat检索 + KB检索 (并行)
  │     ├── performDynamicStrategy → 7阶段向量检索
  │     ├── BM25 并行检索
  │     ├── processEcho → 记忆生命周期
  │     └── Rerank (可选)
  │
  ├── 前端收到:
  │     ├── formatMergedChat → 拼接Chat结果
  │     ├── formatMergedKb → 拼接KB结果
  │     └── updateRagEntry → 写入世界书 [Anima RAG: Chat Results]
  │
  └── ST 自动将世界书内容注入 prompt
```

### 7.2 记忆写入流程

```
对话 → 批量总结触发 (每 30 轮)
  │
  ├── runSummary → generateText (LLM)
  ↓
  saveSummaryBatchToWorldbook → 写入世界书
  ↓
  triggerBm25BuildSingle / triggerFullBm25Rebuild → 增量更新后端 BM25
  ↓
  后端 /insert → getEmbedding → 向量索引 + BM25 索引写入
```

### 7.3 状态追踪流程

```
用户消息 → status 构造请求 (最近对话 + 当前状态)
  ↓
generateText (status LLM) → YAML 输出
  ↓
validateStatusData (Zod)
  ↓
evaluateStatusRules → 匹配规则 → 命中 tags
  ↓
tags 同步到下次 RAG 检索的 distributed strategy 中 →
    Status 标签触发特定向量分路
```

### 7.4 知识库写入流程

```
用户上传文件 → /import_knowledge
  ↓
后端分片 (chunk_size=500)
  ↓
并行: vector insert + BM25 insert
  ↓
检索时: KB collections 与 chat collections 并行查询
```

---

## 8. 关键数据结构

### 8.1 向量索引条目 (metadata)

```javascript
{
  id: "uuid",
  metadata: {
    index: "3_2",           // 格式: batch_slice
    tags: ["Important", "战斗"],
    timestamp: 1718500000000,
    content: "原文/总结切片文本",
    sessionId: "chat_batch_3",
  },
  vector: [0.123, -0.456, ...]
}
```

### 8.2 Distributed Strategy (策略配置)

```javascript
{
  enabled: true,
  min_score: 0.2,
  recent_weight: 0.05,
  candidate_multiplier: 2,
  current_session_id: "chat_batch_5",
  searchText: "...",
  rerankConfig: { url, key, model },
  steps: [
    { type: "base",     count: 2 },
    { type: "important",labels: ["Important","重要"], count: 1 },
    { type: "vibe",     labels: ["Tense"], count: 1 },
    { type: "status",   labels: ["Sick","Injury"], count: 1 },
    { type: "period",   labels: ["Period"], count: 1 },
    { type: "special",  labels: ["新年"], count: 1 },
    { type: "diversity",count: 1 }
  ]
}
```

### 8.3 Echo Session (会话状态)

```javascript
{
  memories: {
    "mem_uuid_1": {
      life: 1,
      maxLife: 2,
      item: { id, metadata, score, source },
      score: 0.85
    },
    "mem_uuid_2": {
      life: 0,          // 枯竭 → 下次 GC 清除
      maxLife: 1,
      item: { ... }
    }
  }
}
```

### 8.4 RAG Settings (全局设置)

```javascript
{
  rag_enabled: true,
  base_life: 1,
  imp_life: 2,
  echo_max_count: 10,
  rerank_enabled: false,
  rerank_count: 30,
  min_score: 0.2,
  base_count: 2,
  virtual_time_mode: false,
  recent_weight: 0.05,
  distributed_retrieval: true,
  strategy_settings: {
    candidate_multiplier: 2,
    important: { labels: ["Important"], count: 1 },
    special: { count: 1 },
    period: { count: 1 },
    status: { labels: ["Sick", "Injury"], count: 1 },
    diversity: { count: 1 }
  },
  vector_prompt: [ /* 查询构造规则 */ ],
  summary_prompt: [ /* 总结构造规则 */ ],
  worldbook_settings: { /* 世界书注入配置 */ }
}
```

---

## 9. 依赖关系

### 9.1 前端模块依赖

```
interceptor.js
  ├── rag_logic.js (queryDual, buildDistributedStrategy, getEffectiveSettings)
  ├── worldbook_api.js (updateRagEntry, clearRagEntry, getLatestRecentSummaries)
  ├── rag.js (getChatRagFiles, clearLastRetrievalResult)
  ├── knowledge.js (getChatKbFiles, getKbSearchPayload)
  ├── bm25_logic.js (getBm25BackendConfig)
  └── utils.js (applyRegexRules, getSmartCollectionId, processMacros)

rag_logic.js
  ├── db_api.js (callBackend)
  ├── worldbook_api.js (insertMemory, deleteMemory, deleteBatchMemory)
  └── rag.js (updateLastRetrievalResult)

api.js
  └── proxyFetch → /api/plugins/anima-rag/proxy/forward

db_api.js
  └── callBackend → /api/plugins/anima-rag/* (所有后端通信)
```

### 9.2 后端依赖

| 依赖 | 用途 |
|------|------|
| `express` | HTTP 服务器框架 |
| `jieba-wasm` | CJK 分词 (BM25) |
| `minisearch` | BM25 搜索引擎 |
| `js-yaml` | YAML 解析 (ST config 读取) |
| `node-fetch` / `fetch` | HTTP 请求 (Node 18+ 内置) |

### 9.3 外部依赖

| 依赖 | 用途 | 必需 |
|------|------|------|
| `SillyTavern` (全局) | 宿主运行时 API | 是 |
| `TavernHelper` (全局) | 聊天/世界书 API | 是 |
| `jQuery` (全局) | AJAX 请求 | 是 |
| `toastr` (全局) | 通知 | 否 |
| `Zod` (vendor) | 状态数据校验 | 否 |
| LLM API (OpenAI-compatible) | 总结/状态生成 | 是 |
| Embedding API (OpenAI-compatible) | 向量编码 | 是 |
| Rerank API (Jina/Cohere) | 重排 | 否 |

---

## 10. 构建与运行

### 前端安装

**方法一: ST 扩展管理器**
```
仓库地址: https://github.com/Ellinav/Anima-Memory-System
```

**方法二: 手动安装**
```bash
cd SillyTavern/data/default-user/extensions/third-party
git clone https://github.com/Ellinav/Anima-Memory-System.git anima-memory
```

### 后端安装与启动

```bash
cd anima-rag
npm install
node index.js
# 默认监听 ST 插件系统自动分配的端口
```

后端通过 ST 的 Plugin API 注册，自动与 ST 的 Express 实例集成。

### 运行环境要求

| 组件 | 要求 |
|------|------|
| SillyTavern | >= 1.12.x |
| Node.js | >= 18 (后端) |
| 浏览器 | 支持 ES Module |
| LLM API | OpenAI-compatible (chat/completions) |
| Embedding API | OpenAI-compatible (/embeddings) |
| 磁盘空间 | vectors/ (按聊天量增长，每切片 ~1536×4 bytes) |

### 存储

| 存储 | 位置 | 用途 |
|------|------|------|
| ST 扩展设置 | localStorage → ST 后端 | 插件配置 (RAG/Summary/Status/BM25) |
| 世界书 | ST 内置 (文件系统) | 总结切片 + RAG 召回结果 |
| 向量索引 | `data/vectors/{collectionId}/` | 向量存储 |
| BM25 索引 | `data/bm25_indexes/{dbId}.json` | BM25 全文索引 |
| Echo 会话 | `data/sessions/{sessionId}.json` | 记忆生命周期状态 |
| 知识库向量 | 独立 collections | KB 文档向量 |

### 最小可用配置

1. 安装前端 + 后端
2. 配置 RAG API (Embedding url/key/model)
3. 配置 LLM API (总结/状态 LLM url/key/model)
4. 可选配置 Rerank API
5. 可选配置 BM25 自定义词典
