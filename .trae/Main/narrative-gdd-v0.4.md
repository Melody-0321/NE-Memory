# Narrative Engine — 开发文档

> **文档版本**: 0.4\
> **项目版本**: 0.4\
> **状态**: 已发布（Smart Push + Memory Retrieval Service + Chat Metadata Embed）\
> **最后更新**: 2026-06-07

***

## 1. 游戏概念 — Elevator Pitch

**Narrative Engine 是一个纯前端记忆管理引擎，通过酒馆助手 (Tavern Helper) 的 iframe 沙箱运行，为超长对话（500+ 轮）提供结构化的事件记忆管理与智能检索。**

传统 AI 角色扮演中，对话越长，遗忘越严重。Narrative Engine v0.4 在增量记忆维护的基础上，引入 Smart Push 智能注入和 recall_memory 语义检索，使记忆注入量从 ~1,850 tok 降到 ~550 tok，同时大幅提升有效记忆回忆率。

与同类方案的差异：**NE 专注于叙事事件记忆**（发生了什么、为什么发生、当时什么感觉），**采用增量维护模型（O(1) 成本）而非全量处理**。与 SP 记忆库互补共存——SP 擅长结构化事实，NE 擅长叙事事件。

***

## 2. 核心循环 — Core Loop

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. MESSAGE_SENT / MESSAGE_RECEIVED 事件      │
│    前端将消息加入 pendingMessages 队列        │
│    队列攒够阈值 → 触发 flushPendingMessages() │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 2. executeIncrementalUpdate(chatId, batch)   │
│    → collectProcessedMsgIds() 去重           │
│    → filterNewMessages() 只留新消息          │
│    → callMemoryLLM() 调用副 API 提取 STM     │
│    → parseSTMResponse() 解析 LLM 输出        │
│    → appendSTMEntries() 追加到 vault         │
│    → saveVaultWithSnapshot() 保存 + 版本 +1  │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 3. executeConsolidation(chatId)             │
│    ⇒ 自适应阈值：条目数 + 文本密度双条件检查   │
│    → LLM 生成合并后 LTM 条目                 │
│    → 代码层自动推导 time_range 字段          │
│    → 标记 STM parent_ltm，不删除原始 STM    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 4. GENERATION_AFTER_COMMANDS 事件（Smart Push）│
│    → 若 Retrieval 开关关闭：                 │
│      formatVaultForPrompt(vault) ← 旧全量注入 │
│    → 若 Retrieval 开关开启：                 │
│      formatSmartContext(vault, chatMessages) │
│        → 最近用户消息 → BM25 预过滤 top-40   │
│        → callMemoryRetrieval() → LLM 合成    │
│        → 注入：叙事摘要 + 核心 State (~550 tok)│
│    + recall_memory Tool 注册（按需检索）      │
└─────────────────────────────────────────────┘
    │
    ▼
    主 LLM 生成回复（记忆已在 prompt 中或通过 Tool 获取）
```

***

## 3. 功能规格

### 3.1 模块树

```
ne-memory/                              ← 单一仓库
├── src/
│   ├── index.js                        ← TH 入口（初始化编排 + Smart Retrieval 开关）
│   ├── events.js                       ← 7 个 ST 事件绑定 + 消息队列 + 竞态保护
│   ├── tools.js                        ← 10 Tool 注册（4 核心 + 5 Schema + recall_memory）
│   ├── i18n.js                         ← 三语翻译表 (en/zh-cn/zh-tw)
│   ├── vault/
│   │   ├── store.js                    ← IndexedDB CRUD + 去重 + 回滚 + _meta 初始化
│   │   ├── schema.js                   ← 状态 Schema 引擎 + 5 区块 Schema 定义 + 摘要格式化
│   │   ├── versions.js                 ← 30 版本快照管理
│   │   └── retrieval-filter.js         ← BM25 预过滤（零依赖，5-15ms）
│   ├── engine/
│   │   ├── update.js                   ← 增量更新引擎（新增 delta → STM + state_changes）
│   │   ├── consolidate.js              ← LTM 整合引擎（自适应阈值 + time_range 推导）
│   │   └── retrieval.js                ← Retrieval Service prompt builder
│   ├── api/
│   │   └── llm.js                      ← LLM 调用（callMemoryPipeline + callMemoryRetrieval）
│   └── ui/
│       ├── vault-panel.js              ← Vault 面板 + formatSmartContext + Smart Push 注入
│       ├── state-templates.js          ← 12 状态模板渲染
│       ├── config-dialog.js            ← 设置弹窗 UI（含 Memory Budget 滑块）
│       └── utils.js                    ← escapeHtml + formatLocalTime
├── style.css                           ← 自定义样式
├── rollup.config.mjs                   ← Rollup IIFE 构建
├── jsconfig.json                       ← IDE 类型配置
├── package.json                        ← 依赖声明
├── README.md                           ← 安装说明
└── dist/
    └── index.js                         ← 发行版（~75KB IIFE）
```

### 3.2 各模块职责

| 模块                        | 职责                                                                                                                                            | 替代的旧模块                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **vault/store.js**        | IndexedDB 封装，vault 读写、合并、回滚、_meta 初始化、旧数据兼容                                                                                                       | `vault_store.py` (Python)     |
| **vault/schema.js**       | 状态 Schema 引擎 + 5 区块 Schema 定义 + 摘要格式化 + modularity toggle                                                                                     | 新增（替代自由 JSON）                 |
| **vault/versions.js**     | 30 快照版本管理，IndexedDB 独立 store                                                                                                                  | `versions.py` (Python)        |
| **vault/retrieval-filter.js** | BM25 预过滤：中文 2-gram 分词 + BM25 评分 + top-K 排序。零依赖，纯算法                                                                                           | 新增                             |
| **engine/update.js**      | 增量更新：去重→构建 prompt→解析 STM+state\_changes→追加 + 遥测记录                                                                                            | `update()` in vault\_store.py |
| **engine/consolidate.js** | LTM 整合：自适应阈值检查→合并→time\_range 推导→标记 parent\_ltm + 遥测记录                                                                                       | `_consolidate_stm_to_ltm()`   |
| **engine/retrieval.js**   | Retrieval Service prompt builder：Vault Identity 头部 + 6 规则约束 + 自验证 + 预算控制 + 中英双语                                                                | 新增                             |
| **api/llm.js**            | LLM 调用：前端 fetch（副 API）+ callMemoryPipeline(0.1) + callMemoryRetrieval(0.3) + TavernHelper 回退                                               | `llm_client.py` + `routes.py` |
| **index.js**              | TH 入口，初始化、locale 检测、事件监听 + Schema 开关桥接 + Smart Retrieval 开关                                                                                   | `init()` 前端入口                 |
| **events.js**             | 7 个 ST 事件绑定、消息队列管理、Smart Push/全量注入门控、pipelineRunning 竞态保护                                                                                    | 事件部分 + 桥接层                    |
| **tools.js**              | 10 Tool 注册（4 核心 + 5 Schema + recall_memory），按 Schema/Retrieval 开关条件激活                                                                  | Tool 部分                       |
| **ui/vault-panel.js**     | Vault 面板渲染、记忆表格、formatSmartContext（BM25→LLM合成→State注入→recall提示）、formatVaultForPrompt 回退、角色/势力/任务面板                                        | 前端 UI 全部                      |
| **ui/state-templates.js** | 12 种状态模板渲染（自由 JSON 回退路径）                                                                                                                      | 原渲染器                          |
| **ui/config-dialog.js**   | 设置弹窗（副 API + 遥测开关 + 记忆处理 + Schema + Smart Retrieval + Memory Budget）                                                                              | `config.html`                 |
| **style.css**             | 自定义样式                                                                                                                                         | 原 `style.css`                 |

### 3.3 State Schema 模块（可选）

同 v0.3。State Schema 引擎无破坏性变更。五大区块（global/characters/factions/quests/power\_slots）和模块化开关保持不变。

### 3.4 Smart Retrieval 模块（可选，v0.4 新增）

#### 3.4.1 概述

Smart Retrieval 是 NE v0.4 的核心新功能——用 Smart Push 智能注入替代全量表格注入，并新增 `recall_memory` Tool 供主 LLM 按需检索。基于 [Memory Retrieval Service 设计文档](file:///d:/SillyTavern/.trae/documents/Designs/memory-retrieval-design.md) 的完整设计实现。

#### 3.4.2 模块化开关

```
Enable Memory System (基础开关)
  ├── Enable State Schema (子开关)
  └── Enable Smart Retrieval (子开关)
```

| 开关状态                   | 行为                                             |
| ---------------------- | ---------------------------------------------- |
| Memory OFF             | Retrieval 开关隐藏。全量注入（旧 v0.3 行为）                    |
| Memory ON + Retrieval OFF | 全量注入（formatVaultForPrompt）。recall_memory Tool 不注册 |
| Memory ON + Retrieval ON  | Smart Push 注入 + recall_memory Tool 可用。注入量 ~550 tok |

#### 3.4.3 架构：Pipeline + Retrieval Service 分离

```
记忆 LLM（副 API）
     │
     ├── callMemoryPipeline(temperature=0.1)  ← 维护（异步）
     │       → STM 提取、Consolidation、State 检测
     │
     └── callMemoryRetrieval(temperature=0.3) ← 检索（同步）
             → BM25 预过滤 → LLM 合成 → 叙事答案
```

#### 3.4.4 Smart Push 流程

```
onBeforeGenerate
  → clientMessages → query (最近用户消息)
  → filterCandidates(query, allSTM, allLTM, 40) ← BM25
  → buildRetrievalMessages → callMemoryRetrieval ← LLM 合成
  → 成功：叙事摘要 + State (~550 tok)
  → 失败：回退 formatVaultForPrompt (全量注入，~1,850 tok)
```

#### 3.4.5 recall_memory Tool

```javascript
recall_memory(query)
  → filterCandidates(query, allSTM, allLTM, 40) ← BM25
  → buildRetrievalMessages → callMemoryRetrieval ← LLM 合成
  → 返回带 [→msg#X] / [→state:path] 标记的叙事答案
```

#### 3.4.6 Memory Budget

用户可调的记忆注入预算（500-2000 tok，默认 800）。Smart Push 的 LLM 合成 prompt 中包含 `Keep under X tokens` 约束。

#### 3.4.7 Tool 访问边界

| Tool | Pipeline | Retrieval | 主 LLM |
|------|:--:|:--:|:--:|
| lookup_memory_source | ❌ | ✅ | ✅ |
| lookup_stm | ❌ | ✅ | ✅ |
| vault_lookup | ❌ | ✅ | ✅ |
| recall_memory | ❌ | ❌ | ✅ |
| update_state | ❌ | ❌ | ⚠️ 纠正性 |
| update_opening_summary | ❌ | ❌ | ✅ |
| rollback_memory | ❌ | ❌ | ✅ |

### 3.5 用户故事

同 v0.3，追加：

```
作为长篇角色扮演玩家，我希望记忆注入不要每轮都塞满无关内容，
      以便注意力不被稀释，角色扮演更自然。

作为中文 ST 用户，我希望检索我的记忆不需要下载 GB 级模型，
      粘贴 URL 后就能用。
```

***

## 4. 技术架构

### 4.1 系统上下文图

```
┌──────────────────────────────────────────────────────────────┐
│                    TH iframe 环境                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ne-memory/dist/index.js (IIFE ~75KB)               │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────────────┐ ┌─────────────┐  │   │
│  │  │ vault/   │ │ engine/          │ │ api/llm.js  │  │   │
│  │  │ ·store   │ │ ·update          │ │ Pipeline    │  │   │
│  │  │ ·schema  │ │ ·consolidate     │ │ Retrieval   │  │   │
│  │  │ ·version │ │ ·retrieval       │ └─────────────┘  │   │
│  │  │ ·filter  │ └──────────────────┘                  │   │
│  │  └──────────┘                                       │   │
│  │                                                      │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │ ui/ + events.js + tools.js + i18n.js         │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  │                                                      │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │  TH 提供的 API                                       │   │
│  │  TavernHelper._eventOn / generateRaw / injectPrompts │   │
│  │  ToolManager.registerFunctionTool                     │   │
│  │  SillyTavern.getContext()                              │   │
│  │  localStorage, IndexedDB                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 关键数据流

**数据流 A：Smart Push 注入**

```
GENERATION_AFTER_COMMANDS 事件
→ isRetrievalEnabled()?
  ├─ 否 → formatVaultForPrompt(vault) → 全量注入
  └─ 是 → formatSmartContext(vault, chatMessages, budget)
          → 最近用户消息为 query → BM25 预过滤 top-40
          → callMemoryRetrieval() → LLM 叙事合成
          → 成功：注入叙事摘要 + 核心 State (~550 tok)
          → 失败：回退 formatVaultForPrompt
→ TavernHelper.injectPrompts([{id:'ne_memory_vault', content, ...}])
```

**数据流 B：增量记忆更新**

```
MESSAGE_SENT / MESSAGE_RECEIVED 事件
→ 消息加入 pendingMessages 队列
→ 队列满或字数达标 → flushPendingMessages()
→ pipelineRunning = true
→ collectProcessedMsgIds() 去重
→ filterNewMessages() 只留新消息
→ callMemoryPipeline() 提取 STM 条目 + state_changes
→ appendSTMEntries() 追加到 IndexedDB vault
→ saveSnapshot() 保存版本快照
→ checkConsolidateThreshold() 自适应阈值检查整合
→ vault._meta 更新
→ pipelineRunning = false
```

**数据流 C：Tool-calling 语义检索**

```
主 LLM 调用 recall_memory(query)
→ Tool action 在前端执行
→ filterCandidates(query, allSTM, allLTM, 40) ← BM25
→ callMemoryRetrieval() ← LLM 合成
→ 返回带 [→msg#X] / [→state:path] 标记的叙事答案
```

### 4.3 数据模型

**Vault JSON 结构（IndexedDB 存储）—— v0.4 新增字段**

```json
{
  "chat_id": "string",
  "version": "number",
  "tokens": "number",
  "updated_at": "ISO datetime",
  "_meta": {
    "created_at": "ISO datetime",
    "last_pipeline_task": "stm_extract|consolidation|null",
    "last_pipeline_time": "ISO datetime|null"
  },
  "content": {
    "summary": "string",
    "opening_summary": { "text": "string", "source_msg_ids": [] },
    "state": {},
    "state_template": "auto|dating|rpg|slice_of_life|cultivation|...",
    "state_schema": { /* 可选，Schema 定义 */ },
    "ltm_entries": [{ "id", "period", "time_range", "scene", "event", "stm_refs" }],
    "stm_entries": [{ "id", "period", "time_label", "scene", "event", "msg_ids", "parent_ltm", "timestamp" }],
    "unconsolidated_stm": [{ /* 同上结构 */ }],
    "current_scene": "string",
    "consolidate_threshold": 5,
    "language": "zh|en"
  },
  "stm_index": { "stm_id": { "ltm_id", "summary", "msg_ids" } },
  "memory_system_prompt": "string"
}
```

**v0.4 新增字段说明：**
- `_meta` — Pipeline 执行元数据（身份持久化、调试回溯）
- `ltm_entries[].time_range` — 从源 STM 推导的时间范围（代码层自动计算）
- STM 条目的 `period` 继承自 `state.time`，不再由 LLM 自由编造

***

## 5. 开发日志

### 5.1 活跃条目 — Bug

> 全部 Bug 已移至 5.4 已解决。

### 5.2 活跃条目 — TODO

| # | 标题                                                                                                                                                                              | 优先级   | 状态    | 所属版本 |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | ---- |
| 1 | GM Agent（场景分析 + 角色调度 + 知识边界）— 重新评估后降级为 P3。标准 RP 场景中五个职责无真实叙事贡献；唯一独特的"知识边界"仅在群聊/多线分离叙事中生效且场景极窄。AI 跑团生态中目前不存在独立的 GM Agent——所有平台均由主 LLM 同时扮演 DM 和角色，不做分离。该条目可能在重新定位为"离线世界模拟器"后重新激活 | P3-低优 | 待重新设计 | 0.6+ |
| 2 | Agent 重用式多角色状态管理（Character Agent 每人独立 Schema 条目）                                                                                                                                | P1-重要 | 待实现   | 0.5  |
| 3 | 剧情推进引擎（类似 SP 的 Plot Engine，拦截 TH.generate 改写用户消息）                                                                                                                               | P2-一般 | 待实现   | 0.5  |
| 4 | Vault 面板"合并 STM 到 LTM"批量选择 UI                                                                                                                                                   | P2-一般 | 待实现   | 0.5  |
| 5 | 遥测导出"一键复制到剪贴板"功能                                                                                                                                                                | P2-一般 | 待实现   | 0.5  |
| 6 | LLM 输出的 markdown 代码块包装处理 (` ```json `)                                                                                                                                          | P2-一般 | 待实现   | 0.5  |
| 7 | 索引化已整合 STM 老化淘汰（超过 N 轮的已整合 STM 压缩为元数据）                                                                                                                                          | P2-一般 | 待实现   | 0.5  |
| 8 | `vault/store.js` IndexedDB 不可用时静默返回空 vault — 首次安装用户可能不知道记忆未生效                                                                                                                   | P2-一般 | 待修复   | 0.5  |
| 9 | **LTM 灰度激活 — 双池 Top-K 分配**。当前硬阈值 500 STM 后才启用 LTM。未来在 200-500 STM 区间做平滑过渡：ST/LTM 各跑 BM25 Top-K，按 `(stmCount - 200) / 300` 线性分配 slot，避免 500 轮处的检索质量突变。路线 B 实现，不污染 BM25 评分语义 | P3-低优 | 设计完成 | 0.6+ |
| 10 | `engine/consolidate.js` 并行 LLM 调用缺少 `Promise.allSettled` 包装 — 任一个 reject 导致静默失败                                                                                                 | P2-一般 | 待修复   | 0.5  |

### 5.3 活跃条目 — 扩展计划

| # | 标题                                                                                                                                                                                                                                                                                                          | 优先级   | 状态   | 所属版本 |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---- |
| 1 | 多角色群聊记忆分区（每个角色独立 vault）                                                                                                                                                                                                                                                                                     | P1-重要 | 计划中  | 0.5  |
| 2 | 状态 Schema 模板引擎（类似 SP 的 SQL 模板语法）                                                                                                                                                                                                                                                                            | P3-低优 | 计划中  | 0.5  |
| 3 | 消息元数据备份（IndexedDB 数据写入 `msg.TavernDB_NE_*` 字段防止浏览器清除）                                                                                                                                                                                                                                                       | P3-低优 | 计划中  | 0.5  |
| 4 | 倒置 Agent 架构实验模式 — 在 AI 跑团（群聊多角色）场景测试，价值待验证                                                                                                                                                                                                                                                                  | P3-低优 | 计划中  | 实验   |
| 5 | **TRPG Module 外接插件** — 依赖 NE 的跑团规则层：Dice Engine（代码层掷骰）、Combat Tracker（回合/HP/conditions 自动计算）、Rule Adjudicator（SRD 规则查询）、角色数值 Schema 扩展（ability\_scores/AC/spell\_slots）、Combat + Party Schema 区块、预置 D\&D 5e 模板。不内建到 NE，作为独立 TH 脚本分发。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/trpg-module-design.md) | P2-一般 | 设计完成 | 0.6+ |
| 6 | **本地小模型 Retrieval Service** — 用知识蒸馏训练 1-3B 专属记忆模型，替代 gpt-4o-mini 做检索合成。不是为了省钱——是为 0.3s 延迟使每轮 Smart Push 都能做完整 LLM 合成（而非仅 embedding 预过滤）。仅在规模化商业场景或 NE 积累足够 Pipeline 训练数据后值得投入 | P3-低优 | 设想 | 远期 |
| 7 | **对话阶段感知** — 根据 LTM 条目数量 + state.time 推断故事阶段（早期/中期/后期），影响检索偏向 | P3-低优 | 设想 | 远期 |
| 8 | **recall 反馈循环** — 主 LLM 调 recall 后，已消费信息标注为"已使用"，避免 Smart Push 重复注入相同信息 | P3-低优 | 设想 | 远期 |
| 9 | **记忆 LLM 协作增强** — 批量多话题查询（`;;` 分隔）、msg_id 指纹去重、节标题回退去重。NE 独有：利用 msg_id 双向绑定精确去重 | P1-重要 | 已实现 | 0.4 |
| 10 | **叙事实体标记** — STM/LTM 条目标注角色+关键物品/势力/概念。查询时按 entity 自动合成事件链（每节点简化为事件描述+msg标记）。Smart Push 输出活跃链概述。完全可选字段，零耦合。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/narrative-entity-tagging-design.md) | P1-重要 | 设计完成 | 0.5 |
| 11 | **自适应 Smart Push 预算** — 根据用户输入复杂度（长度/实体数/问句数/叙事关键词）自动调整注入预算。range=500-1200 tok，以用户选择的默认预算 800 为基线。纯启发式，代码判断，LLM 不知情。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/narrative-entity-tagging-design.md) §四 | P1-重要 | 已实现 | 0.4 |
| 12 | **ST 标准插件双模式** — NE 当前以 TH 脚本分发（一键直用）。未来提供标准 ST 插件包（放入 extensions 目录），功能完全相同，但可直接访问 ST 内核 API。主要收益：可设置 `chat_truncation` 控制原生上下文滑动窗口，避免主 LLM 被无限历史稀释注意力。玩家在易用性（TH URL）和实际效果（标准插件）中自行选择。源码统一，仅打包方式不同 | P3-低优 | 设想 | 远期 |
| 13 | **深度整合（LLTM）** — 当 LTM 池超过阈值（如 100 条）时触发二次整合，将关联 LTM 合并为更高层级的叙事弧线容器的摘要。BM25 候选池中 LLTM 优先于散落的 LTM 叶子节点，提升超长对话中 Smart Push 的结构化检索精度。原有 LTM 通过 parent 标记从活跃池移除，`access` 嵌套递归定位到叶子层级。仅 1000+ 轮超长对话中体现价值 | P3-低优 | 设想 | 0.6+ |
| 14 | **全局叙事上下文字段解耦** — `story_time` + `story_scene` 从 State Schema 中分离为 `vault.content` 顶层字段。无论 State Schema 是否启用，这两个字段始终可用——提取 prompt 从它们读取时间/场景信息，检索 prompt 从它们读取当前时间锚点。向后兼容 `state.time` / `state.scene`（仍在 state 中保留） | P1-重要 | 已实现 | 0.4 |

### 5.4 已解决

#### v0.2 — Bug 修复

| #  | 类型  | 标题                                                                                                     | 解决日期       |
| -- | --- | ------------------------------------------------------------------------------------------------------ | ---------- |
| 1  | Bug | `tools.js` 中 `rollbackByMsgIds` 已导入但从未注册为 Tool — 前端无一键回滚入口                                             | 2026-05-30 |
| 2  | Bug | `events.js` 中未绑定 `MESSAGE_DELETED` / `MESSAGE_SWIPED` / `MESSAGE_UPDATED` 事件 — 消息编辑/删除/滑动不会触发 vault 回滚 | 2026-05-30 |
| 3  | Bug | Vault 面板 UI 缺少遥测导出按钮、LLM 操作日志、Tool 调用日志 — 调试能力降低（已验证原有功能完整）                                            | 2026-05-30 |
| 4  | Bug | `events.js` 的 `onBeforeGenerate` 缺少 `isContextChanged` 检测 — 跨聊天上下文可能残留旧 vault 注入                       | 2026-05-30 |
| 5  | Bug | `update.js` 中 `parseSTMResponse` 的 JSON 回退逻辑不够健壮 — LLM 输出非标准 JSON 时可能解析失败                              | 2026-05-30 |
| 6  | Bug | `package.json` 重复 `"type"` 键（先 `"module"` 后 `"commonjs"`）— Node.js 只认后一个值，Rollup ES 构建可能误以 CJS 运行      | 2026-05-30 |
| 7  | Bug | `events.js` `setupEventListeners` 使用 500ms 定时轮询等待 `TavernHelper` 就绪，无上限退避 — TH 加载超慢时永不失败也永不成功          | 2026-05-30 |
| 8  | Bug | `api/llm.js` `callMemoryLLM` 的 `AbortController` timer 在 fetch 成功时只清除当前 timer — 并发请求场景下可能误取消其他请求       | 2026-05-30 |
| 9  | Bug | `tools.js` `lookupMemorySource` / `lookupStmDetails` 仍 fetch 到旧 Python 后端 URL — 已验证无此问题 (v0.2 迁移时已修复)  | 2026-05-30 |
| 10 | Bug | `vault-panel.js` `injectPinCSS()` 每次调用时重新注入 `<style>` 标签，无去重 — 已验证 v0.2 已有去重检查                         | 2026-05-30 |

#### v0.2 — TODO 完成

| #  | 类型   | 标题                                               | 解决日期       |
| -- | ---- | ------------------------------------------------ | ---------- |
| 11 | TODO | 状态 Schema 的内置预设（从 12 个状态模板提取字段定义）                | 2026-05-30 |
| 12 | TODO | Inject 注入时携带 Schema 摘要而非全量 JSON（空 Schema 时回退旧逻辑） | 2026-05-30 |

#### v0.3 — State Schema 模块

| #  | 类型 | 标题                                                                    | 解决日期       |
| -- | -- | --------------------------------------------------------------------- | ---------- |
| 28 | 特性 | State Schema 引擎 — 字段校验 + 摘要格式化 + 路径解析 + 深度合并                          | 2026-05-30 |
| 29 | 特性 | 五大区块 Schema 定义 + 默认值 (global/characters/factions/quests/power\_slots) | 2026-05-30 |
| 30 | 特性 | 角色面板 — Actor 模型 + 三态 + 虚拟 present\_characters + vault\_lookup         | 2026-05-30 |
| 31 | 特性 | 势力关系 — per-faction 节点 + relations 子对象 + vault\_lookup                 | 2026-05-30 |
| 32 | 特性 | 任务/目标/世界事件 — 双层暴露 + vault\_lookup + 自动完成时间转换                          | 2026-05-30 |
| 33 | 特性 | power\_slots 模板驱动 — 副 API 初始化 + 世界书优先命名                               | 2026-05-30 |
| 34 | 特性 | Schema 模块化开关 — Memory 子开关 + 三态门控                                      | 2026-05-30 |

#### v0.4 — Smart Push + Memory Retrieval Service

| #  | 类型 | 标题 | 解决日期 |
| -- | -- | ---- | ---------- |
| 35 | 特性 | Smart Retrieval 模块化开关 — Memory→Smart Retrieval 子开关，关闭即回退全量注入 | 2026-06-01 |
| 36 | 特性 | Smart Push 注入 — BM25 预过滤 + LLM 叙事合成替代全量表格注入，注入量 1,850→550 tok | 2026-06-01 |
| 37 | 特性 | recall_memory Tool — 主 LLM 按需语义检索，返回带来源标记的叙事答案 | 2026-06-01 |
| 38 | 特性 | Memory Retrieval Service 架构分离 — Pipeline(0.1) / Retrieval(0.3) 双函数拆分 | 2026-06-01 |
| 39 | 特性 | BM25 预过滤 — 零依赖、5-15ms 纯算法检索，LLM 精排兜底语义盲区 | 2026-06-01 |
| 40 | 特性 | vault._meta 初始化 — created_at + last_pipeline_task + last_pipeline_time | 2026-06-01 |
| 41 | 特性 | 鲁棒性增强 — Smart Push 失败回退全量注入、Pipeline 竞态保护、recall 提示注入 | 2026-06-01 |
| 42 | 优化 | LTM time_range 字段 — 代码层自动从源 STM 推导时间范围 | 2026-06-01 |
| 43 | 特性 | **Process History** — Vault 面板按钮，分批处理全部历史消息为 STM/LTM（已整合） | 2026-06-07 |
| 44 | 特性 | **STM 提取批次 + 未整合上限滑条** — Basic 面板可配置参数，STM 批次(1-30)、未整合上限(2-30) | 2026-06-07 |
| 45 | 特性 | **Vault 导出/导入 JSON** — 浏览器下载文件夹导出 `ne_vault_{chatId}.json`，文件选择器导入恢复 | 2026-06-07 |
| 46 | 优化 | LTM 灰度激活 — BM25 搜索池在 500 条 STM 前排除 LTM，阈值后排除已整合 STM 只留 LTM | 2026-06-07 |
| 47 | 特性 | **Vault 嵌入到聊天** — 一键将 vault JSON 写入 `chat_metadata.ne_vault`，随 ST 导出/备份/回滚自动迁移，CHAT_CHANGED 时自动检测并弹窗恢复 | 2026-06-07 |
| 48 | 特性 | **LLM 输出检查站验证** — STM/LTM 产出双层把关：`_checkpoints` 块 (time/scene 必填) + event 必填，不通过则拒绝重试 (1次)，重试失败则后处理补全 (period→checkpoints.time, scene→checkpoints.scene, stm_refs→源 STM 列表)。State time/scene/tone 在 Schema OFF 时白名单通过 | 2026-06-07 |
| 49 | 优化 | period 继承 state.time — STM/LTM 的 period 不再由 LLM 自由编造 | 2026-06-01 |
| 50 | 优化 | 自适应整合阈值 — 条目数 + 文本密度双条件，稀疏 STM 跳过整合 | 2026-06-01 |
| 51 | 优化 | Smart Push 查询优化 — 用最近用户消息替代 state.time+scene 为 query | 2026-06-01 |
| 52 | 优化 | Memory Budget 滑块 — 用户可调注入预算 500-2000 tok，默认 800 | 2026-06-01 |
| 53 | 优化 | 扩展遥测 — Pipeline/整合/Smart Push/recall 四级节点详细日志 | 2026-06-01 |
| 54 | 设计 | Tool 访问边界定义 — Pipeline 0 Tool / Retrieval 3 只读 / 主 LLM 7 Tool | 2026-06-01 |
| 55 | 设计 | 检索结果自验证 — 返回前检查内部矛盾，防止记忆 LLM 合成错误传递 | 2026-06-01 |
| 56 | 设计 | 记忆 LLM 身份持久化 — Vault Identity 头部（opening_summary + 计数 + 最近活动） | 2026-06-01 |
| 57 | 特性 | **双语提取与跨语言 BM25 索引** — extraction prompt 增加 `translation` 字段输出指令（英→中/中→英）；`buildSearchableText` 拼接原始 event 与 translation；跨语言 BM25 R@5 从 0% 提升至 35.7%；中文查询 R@5 从 46.7% 提升至 60.2% | 2026-06-03 |
| 58 | 优化 | **分阶段 LLM 温度策略** — Extraction/Translation (0.1)、Consolidation (0.1-0.2)、Smart Push (0.3)、Synthesis (0.4)。改动范围：ne-memory (update.js/consolidate.js/tools.js) 和 ne-memory-core (extract.js/consolidate.js/retrieval.js)。`callMemoryRetrieval` wrapper 改为支持温度覆写 | 2026-06-03 |
| 59 | 优化 | **Level 1 跨语言优化** — (a) translation 字段从 80→200 chars；(b) 查询端翻译：检索候选 <5 时自动对译查询做二次 BM25 检索并交错合并；(c) 候选 <3 时放宽 score-0 filter。跨语言 R@5 从 35.7%→50.0%(+14.3pp)，MRR 0.417→1.000。浏览器端 prompts 同步添加 translation 指令。改动范围：prompts.js、retrieval.js、retrieval-filter.js (core+vault)、update.js、consolidate.js、test-data.mjs | 2026-06-03 |
| 60 | 特性 | **B 层回灌 — 语义 msgRange + BM25 预分组 + Partial 追踪** — 将 ne-memory-core cursor engine 的语义分割能力回灌到 ST 插件。核心变更：(a) LLM 自适应 msgRange 替换机械均分 `msg_ids`；(b) BM25 相似度预分组为 LLM 提供事件边界提示；(c) Partial 跨轮次事件追踪（pending_partials → parent_partial 闭环）；(d) `processed_msg_ids` O(1) 去重。新增 `bm25-grouper.js`，改动 `store.js`(cursor_state + processed_msg_ids)、`validate.js`(validateMsgRanges)、`update.js`(prompt 重写 + msgRange 映射 + partial 追踪)、`consolidate.js`(BM25 预分组 + stmRange 支持) | 2026-06-05 |
| 61 | 优化 | **BM25 自适应提取 — 分数断崖检测** — `filterCandidates` 不再固定取 topK 条；排序后检测相邻分数断崖（ratio > 3x 且 < 首项 15%），在断层处自然截断。具体查询节省 80-95% 噪音候选，零分查询保留 minResults=3 保底。三处调用方接口不变。改动：`retrieval-filter.js` L160-179 | 2026-06-05 |

#### v0.5 — Dynamic State Discovery

| #  | 类型 | 标题 | 解决日期 |
| -- | -- | ---- | ---------- |
| 62 | 特性 | **动态字段发现** — `src/engine/state-discovery.js` 核心模块。从角色卡描述/开场白/世界书自动提取 key:value 状态字段（4 种 regex 模式：单行 KV、多字段同行、括号字段、ST 变量语法），过滤叙述词假阳性。存储到 `vault.content.dynamic_state`（`{global: {}, characters: {name: {key: value}}}` 结构），与固定 schema 平行共存。双模式自动切换：`dynamic_state` 有数据 → 动态模式，空 → 回退硬编码字段。 | 2026-06-05 |
| 63 | 特性 | **动态字段 LLM 注入** — `update.js` 的 `buildSTMUpdatePrompt` / `buildStateChangesPrompt` 中动态字段 prompt 注入。`buildDynamicStatePrompt(lang)` 中英双语格式化，prepend 到现有 `stateChangesEn/Zh` 指令头部，主 LLM 通过 `dynamic.characters.张三.气血` 路径更新。`executeIncrementalUpdate` 首次调用时自动触发 `discoverDynamicFields`。Smart Push 的 `currentStateSnapshot` 同步注入动态字段摘要。 | 2026-06-05 |
| 64 | 特性 | **update_state 动态路径路由** — `tools.js` 的 `update_state` Tool 按 key 前缀分流：`dynamic.*` → `mergeDynamicState`（自由 dot-path 无校验），`state.*` → `validateStateChanges` + `mergeStateChanges`（schema 校验）。两种变更并行处理、独立写入。 | 2026-06-05 |
| 65 | 特性 | **auto-restore 发现触发** — `auto-restore.js` 在聊天加载时检查 `dynamic_state` 是否存在，缺失则调用 `discoverDynamicFields`。覆盖三种路径：无嵌入 vault（检查现有 vault）、存在但跳过恢复（检查现有 vault）、成功恢复嵌入 vault（检查恢复后 vault）。 | 2026-06-05 |
| 66 | Bug | **事件处理器缺少 try/catch 导致 ST 消息管线卡死** — `onBeforeGenerate` / `onMessageReceived` / `onMessageSent` 三个关键事件处理器均无顶层 try/catch。任何内部异常（包括动态发现代码的潜在错误）都会作为 unhandled rejection 传播到 ST 事件链，破坏 UI 刷新机制。症状：发送消息后无回复显示，按钮在"发送"/"终止请求"间反复切换，控制台有日志但 UI 需刷新才能看到消息。修复：三个事件处理器加顶层 try/catch + `_discoverIfNeeded` 加 try/catch + `saveVaultWithSnapshot` 移除 catch-rethrow 反模式。 | 2026-06-05 |
| 67 | Bug | **Phase Swap 导致 vault 空白 — cursor 阶段失败时 Phase 1 state 数据丢失** — Phase swap（state 先于 cursor）将唯一 `saveVaultWithSnapshot` 移到两阶段之后，Phase 1 的 `postFillSTM` 仅修改内存。若 cursor 阶段崩溃/超时，Phase 1 state 数据随内存丢失。症状：对话后 vault 无新内容，刷新后仍为空。修复：Phase 1 完成后立即 `saveVaultWithSnapshot` 持久化 state；cursor 调用加 try-catch 确保 Phase 3 仍能执行。 | 2026-06-06 |

***

### 5.5 开发中优化 — 架构决策

| # | 日期 | 决策 | 影响 |
|---|------|------|------|
| — | 2026-06-01 | **弃 GM Agent** — 标准 RP 场景无叙事贡献，知识边界场景极窄 | 砍掉 P1 条目，架构瘦身 |
| — | 2026-06-01 | **弃第三层记忆（Mega-LTM）** — Smart Push 嵌入预过滤已解决注入膨胀，第三层为 Push All 补丁 | 保留 STM/LTM 双层 |
| — | 2026-06-01 | **弃 Transformers.js，选 BM25** — 中文模型 470MB 对"粘贴 URL 即用"不可接受 | 零依赖、零延迟 |
| — | 2026-06-01 | **Pipeline 不给 Tool** — 纯请求-响应，Tool 访问仅增加延迟 | 维护管线更简洁 |
| — | 2026-06-01 | **BM25 增强全量注入** — `formatVaultForPrompt` 中加入 BM25 过滤（LTM + 未整合 STM，top-25）。已整合 STM 永不注入 | Retrieval OFF 时注入量从 ~1,850 → ~900 tok |

### 5.6 记忆 LLM 协作增强（v0.4 已实现）

单次对话中主 LLM 可能多次调用 `recall_memory`。以下三项优化将多次调用从"独立"升级为"协作"：

**A. 批量多话题查询**

`recall_memory` 的 tool description 引导主 LLM 用 `;;` 分隔同时查询多个独立话题。记忆 LLM prompt 同步加入 `;;` 分节处理规则。一次 API 调用替代多次。省往返、省 token。

**B. msg_id 指纹去重（NE 独有）**

NE 独有优势：每个记忆条目绑定原始消息的 `msg_id`。单次对话中第二次 recall 时，从上一轮答案提取所有 `[→msg#X]` 标记，为每个候选条目注释其源消息是否已在上轮使用。记忆 LLM 不再模糊"避免重复"——它知道每条候选的源消息是否已覆盖。其他记忆系统（SP、Mem0、Mnemis）无此能力。

**C. 节标题回退**

msg_id 不可用时（如 LTM 的 `stm_refs`），退回到上一轮答案的 `##` 节标题作为去重信号。

**代价**：+35 行代码，~50-80 tok/次额外去重注释，~1ms 解析开销。

---

## 6. 版本路线图

| 版本      | 目标           | 核心功能                                                                                                                                          | 判断指标                        |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **0.1** | MVP 可用（已归档）  | Python 后端 + ST Extension 三端架构                                                                                                                 | 已存档于 v0.1 文档                |
| **0.2** | 纯前端 TH 脚本    | ✅ 所有核心逻辑移植到 JS✅ IndexedDB 存储✅ TH 单文件分发✅ Schema 模块✅ Rollup 构建⚠️ GM Agent 待移植⚠️ 消息编辑/删除/滑动事件绑定待补全                                               | 粘贴 URL 到 TH 即用构建通过 (\~45KB) |
| **0.3** | State Schema | ✅ Schema 引擎（校验+摘要+合并）✅ 五大区块（global/characters/factions/quests/power\_slots）✅ 模块化开关（Memory→Schema 门控）✅ 9 Tool 注册（4 核心 + 5 Schema）✅ Rollup 构建通过 | 粘贴 URL 到 TH 即用构建通过 (\~55KB) |
| **0.4** | Smart Push + Memory Retrieval | ✅ Smart Push 智能注入 (Phase B)✅ recall\_memory Tool (Phase C)✅ BM25 预过滤 (Phase D)✅ 架构分离 (Phase A)✅ 鲁棒性增强 (Phase E)✅ 模块化可开关✅ 自适应整合阈值✅ Memory Budget 滑块 | 注入量 ~550 tok；recall tool 可用；Rollup 构建通过 (\~75KB) |
| **0.5** | 打磨与生态 | TODO #4-9 修复、多角色群聊记忆分区、State Schema 模板引擎、消息元数据备份、用户反馈收集 | 发布到 ST 社区，获取真实用户数据 |
| **0.6** | 外接插件 + 生态 | TRPG Module（Dice Engine + Combat Tracker + Rule Adjudicator）、规则系统扩展、社区模版库 | 单人 AI DM 体验稳定可用 |
| **1.0** | 稳定发布         | 性能优化文档完善用户 onboarding插件市场提交                                                                                                                   | 1000 轮对话测试零退化               |
| **远期** | 本地小模型加速 + 检索优化 | 知识蒸馏 1-3B 专属记忆模型：Pipeline 级蒸馏（替代 mini 做提取）→ Retrieval 级蒸馏（0.3s 合成替代 2s API 调用）→ 每轮 Smart Push 完整 LLM 合成无需 API。LTM 灰度激活（200-500 STM 双池线性过渡） | 本地推理 <0.5s；Retrieval 质量 ≥ mini 的 95% |

---

## 7. 遥测与迭代

### 7.1 收集的数据（v0.4 扩展）

用户开启"测试模式"后，插件记录：

| 类别 | 内容 | 用途 |
|------|------|------|
| **LLM 调用** | 操作类型、API 来源、耗时、响应长度 | 分析记忆提取效率 |
| **Pipeline 日志** | 任务类型（stm_extract/consolidation）、新生条目数、state_change 数、parse_error | 检测提取质量 |
| **Smart Push 日志** | 推送方法（llm_synthesis/bm25_fallback）、BM25 候选数、注入 token 量、memory_budget | 评估检索质量 |
| **recall 日志** | 查询文本、结果长度、方法（llm/error） | 识别高频查询、优化方向 |
| **Token 消耗** | 按操作类型拆分 | 判断 API 消耗合理性 |
| **异常信号** | 超时调用（>5s）、连续失败链 | 定位性能瓶颈 |
| **用户干预** | 面板打开次数、手动刷新次数 | 判断用户信任度 |
| **系统环境** | 副 API 配置状态、语言 | 跨版本兼容性分析 |

### 7.2 判断标准

| 指标 | 目标值 | 低于目标说明 |
|------|------|------|
| STM 提取成功率 | > 90% | LLM prompt 或 API 配置有问题 |
| Smart Push LLM 合成率 | > 80% | 副 API 不稳定或超时设置过低 |
| BM25 候选数（500+ 轮） | > 10 | 检索退化，需调参 |
| recall 成功率 | > 90% | 副 API 或 Tool 注册有问题 |

---

## 8. 附录

### 8.1 术语表

| 术语 | 说明 |
|------|------|
| **STM** | Short-term Memory，短期记忆，未整合的近期事件 |
| **LTM** | Long-term Memory，长期记忆，已整合的关键事件流 |
| **Vault** | 记忆区，IndexedDB 存储的结构化记忆 |
| **Consolidate** | 整合，将 STM 合并到 LTM 的过程（不删除原始 STM） |
| **Schema** | 状态字段定义，声明 LLM 可修改的字段及其类型/约束 |
| **Tool-calling** | 主 LLM 通过注册的工具函数查询记忆 |
| **TH** | 酒馆助手 (Tavern Helper / JS-Slash-Runner) |
| **IIFE** | Immediately Invoked Function Expression，单文件脚本打包格式 |
| **Smart Push** | v0.4 新增的智能注入系统，BM25 预过滤 + LLM 叙事合成替代全量表格注入 |
| **Recall** | v0.4 新增的 `recall_memory` Tool，主 LLM 按需语义检索记忆 |
| **BM25** | 稀疏检索算法，零依赖 5-15ms，用于记忆粗筛 |
| **Pipeline** | 记忆维护管线（STM 提取、Consolidation、State 检测），异步不阻塞 |
| **Retrieval Service** | 记忆检索服务（Smart Push 注入 + recall Tool），同步等待 |

### 8.2 项目结构

```
ne-memory/                              ← 当前（纯前端）
├── src/                                ← 源文件
│   ├── index.js / events.js / tools.js / i18n.js
│   ├── vault/ (store.js, schema.js, versions.js, retrieval-filter.js)
│   ├── engine/ (update.js, consolidate.js, retrieval.js, state-discovery.js)
│   ├── api/ (llm.js)
│   └── ui/ (vault-panel.js, state-templates.js, config-dialog.js, utils.js)
├── style.css
├── rollup.config.mjs
├── package.json
├── README.md
└── dist/index.js                       ← 发行版（用户粘贴到 TH，~75KB）

sillytavern-narrative/                  ← 旧架构（已归档，不维护）
```

### 8.3 技术栈

| 层 | 技术 |
|------|------|
| 运行时 | Tavern Helper (JS-Slash-Runner) iframe |
| 语言 | Vanilla JavaScript (ES modules → Rollup IIFE) |
| 存储 | IndexedDB 浏览器内置数据库 |
| LLM 调用 | 前端 fetch (副 API) + TavernHelper.generateRaw (回退) |
| 检索 | BM25 纯算法（零依赖）+ 副 API LLM 精排 |
| 构建 | Rollup 4 + Babel + Terser |
| UI | jQuery (TH 注入) + 模板字符串 |
| 翻译 | 内联三语表 (en/zh-cn/zh-tw) |

### 8.4 竞品对比速查

| 维度 | SP 记忆库 v3.7 | NE Memory Engine v0.4 |
|------|------|------|
| 记忆模型 | 表格覆盖写（DDL/SQL 驱动） | 事件增量追加（STM/LTM 分层） |
| 维护成本 | O(N) 每次全量读写 | **O(1)** delta only |
| 注入方式 | 世界书条目 (constant/keyword) | Smart Push (~550 tok) 或全量回退 |
| 语义检索 | keyword | **BM25 + LLM 合成 (recall_memory)** |
| 整合后数据 | 覆盖不保留 | **标记不删除，三层可追溯** |
| 双 LLM 分离 | ⚠️ 支持但不直观 | **核心设计（Pipeline vs Retrieval）** |
| 安装方式 | 粘贴 URL 到 TH | 粘贴 URL 到 TH |
| 运行环境 | TH iframe | TH iframe |
| 架构体积 | — | ~75KB IIFE |
