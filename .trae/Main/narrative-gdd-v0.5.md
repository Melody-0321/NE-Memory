# Narrative Engine — 开发文档

> **文档版本**: 1.0\
> **项目版本**: 1.0\
> **状态**: 已发布 — v1.0 生产级记忆管理引擎，11项生产打磨完成\
> **最后更新**: 2026-06-07

***

## 1. 游戏概念 — Elevator Pitch

**Narrative Engine 是一个纯前端记忆管理引擎，通过酒馆助手 (Tavern Helper) 的 iframe 沙箱运行，为超长对话（500+ 轮）提供结构化的事件记忆管理与智能检索。**

v0.5 完成了 State Schema 系统的核心大修：Core/Extension 架构分层（Schema OFF 仅维护时间/场景，Schema ON 两套专用 prompt 分别驱动预设模式和动态模式），并将 Smartpush（记忆 LLM 合成）接入 onBeforeGenerate 成为默认注入路径。角色卡自动识别 NPC/PC 分类、present_characters 自动重建、全局字段完整性覆盖。记忆注入从全量表格式演进为「当前局面快照 + 事件记忆叙事合成」分层结构。

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
│ 4. onBeforeGenerate 事件（Smart Push 默认）   │
│    → formatSmartContext(vault, chatMessages) │
│      → 最近用户消息 → BM25 预过滤 top-40     │
│      → callMemoryRetrieval() → LLM 合成      │
│      → 分层注入：                             │
│        Layer 0: memory_system_prompt         │
│        Layer 1: 当前局面（State/角色/阵营/任务） │
│        Layer 2: 事件记忆叙事段落（LLM 合成）    │
│        Layer 3: 工具提示（access/recall_memory） │
│    + recall_memory Tool（按需补充检索）        │
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
│   │   ├── cursor.js                   ← Cursor 管线（语义 msgRange + partial 追踪）
│   │   ├── validate.js                 ← 输出验证 + 双层检查站 + 白名单
│   │   ├── state-discovery.js          ← 动态字段发现（角色卡/世界书）
│   │   ├── bm25-grouper.js             ← BM25 预分组（事件边界提示）
│   │   ├── telemetry.js                ← 工具调用日志（4 Tool action 接入）
│   │   ├── update.js                   ← 增量更新引擎（两套 State prompt + thought 缓冲区）
│   │   ├── consolidate.js              ← LTM 整合引擎（自适应阈值 + time_range 推导）
│   │   └── retrieval.js                ← Retrieval Service prompt builder
│   ├── api/
│   │   └── llm.js                      ← LLM 调用（callMemoryPipeline + callMemoryRetrieval）
│   ├── ui/
│   │   ├── vault-panel.js              ← Vault 面板 + formatSmartContext + Smart Push 默认注入
│   │   ├── config-dialog.js            ← 设置弹窗 UI
│   │   └── utils.js                    ← escapeHtml + formatLocalTime
│   ├── auto-restore.js                 ← 聊天切换时 vault 嵌入恢复 + 动态发现触发
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
| **engine/update.js**      | 增量更新：去重→模式判定→专用 prompt 构建（preset/dynamic）→thought 缓冲剥离→解析 STM+state\_changes→追加 + 遥测记录                                                                   | `update()` in vault\_store.py |
| **engine/consolidate.js** | LTM 整合：自适应阈值检查→合并→time\_range 推导→标记 parent\_ltm + 遥测记录                                                                                       | `_consolidate_stm_to_ltm()`   |
| **engine/retrieval.js**   | Retrieval Service prompt builder：Vault Identity 头部 + 6 规则约束 + 自验证 + 预算控制 + 中英双语                                                                | 新增                             |
| **engine/cursor.js**      | Cursor 管线：语义 msgRange + BM25 预分组 → STM postFill → partial 跨轮次追踪                                                                             | 新增                             |
| **engine/validate.js**    | 输出验证：_checkpoints 双层检查站 + state\_changes 白名单过滤（Schema OFF 仅 Core 字段）                                                                        | 新增                             |
| **engine/state-discovery.js** | 动态字段发现：4 种 regex 模式从角色卡/世界书提取 key:value → dynamic\_state 存储                                                                      | 新增                             |
| **engine/bm25-grouper.js** | BM25 预分组：为 Cursor 管线提供事件边界提示                                                                                                              | 新增                             |
| **engine/telemetry.js**   | 工具调用日志：access/recall\_memory/update\_state/rollback\_memory 四工具 action 接入                                                                 | 新增                             |
| **auto-restore.js**       | 自动恢复：聊天加载时检测嵌入 vault，缺失时触发动态发现                                                                                                            | 新增                             |
| **api/llm.js**            | LLM 调用：前端 fetch（副 API）+ callMemoryPipeline(0.1) + callMemoryRetrieval(0.3) + TavernHelper 回退                                               | `llm_client.py` + `routes.py` |
| **index.js**              | TH 入口，初始化、locale 检测、事件监听 + Schema 开关桥接 + Smart Retrieval 开关                                                                                   | `init()` 前端入口                 |
| **events.js**             | 7 个 ST 事件绑定、消息队列管理、Smart Push/全量注入门控、pipelineRunning 竞态保护                                                                                    | 事件部分 + 桥接层                    |
| **tools.js**              | 10 Tool 注册（4 核心 + 5 Schema + recall\_memory），按 Schema/Retrieval 开关条件激活                                                                  | Tool 部分                       |
| **ui/vault-panel.js**     | Vault 面板渲染（Core 始终显示）+ formatSmartContext（BM25→LLM合成→分层注入）+ 角色/势力/任务面板（动态模式使用 dynamic\_state 字段）                                              | 前端 UI 全部                      |
| **ui/config-dialog.js**   | 设置弹窗（副 API + 遥测开关 + 记忆处理 + Schema + Smart Retrieval + Memory Budget）                                                                              | `config.html`                 |
| **style.css**             | 自定义样式                                                                                                                                         | 原 `style.css`                 |

### 3.3 State Schema 模块（v0.5 大修）

State Schema 引擎完成 Core/Extension 分层重构，三模式架构落地。

#### 3.3.1 模式架构

| 模式 | Pipeline 1（State LLM） | 状态字段 | 角色 Schema | Prompt |
|------|:---:|------|------|------|
| **Schema OFF** | **跳过**（Cursor 管线 _checkpoints 维护 time/scene） | 仅 Core（time/scene/story_date） | 无 | 无 |
| **Schema ON（预设）** | 启用 | Core + Extension 全量 | 预设角色 Schema | buildStatePrompt_Preset |
| **Schema ON（动态）** | 启用 | Core + Extension 全量 | dynamic_state.characters 定义 | buildStatePrompt_Dynamic |

#### 3.3.2 Core Layer vs Extension Layer

| 层 | 字段 | 始终存在？ | 受 Schema 开关影响？ |
|------|------|:---:|:---:|
| Core | time, scene, story_date | 是 | 否 |
| Extension | characters, factions, quests, main_event, present_characters, power_slots | 否 | 是（Schema OFF 不初始化） |

#### 3.3.3 角色自动分类

- Prompt 新增 `npc_names` 字段：LLM 在 state_changes 中输出 NPC 列表
- `getCharacterCardType` 默认 `npc`（非主控）
- Vault 面板按 NPC/PC 分组渲染

#### 3.3.4 present_characters 自动重建

代码层从角色 status 字段自动推导 `state.present_characters`（所有标记"活跃"的角色名拼接），不经过 LLM。

#### 3.3.5 三套专用 Prompt

每个模式独立 prompt，可部分重合但结构完整。共同特性：
- `<thought>` 缓冲区（SP DB 模式，防止 LLM 在思考后停止）
- HARD GATE（显式禁止行为列表）
- 两段输出格式：`_checkpoints` + `state_changes`

### 3.4 Smart Retrieval 模块（v1.0 — 默认注入路径）

#### 3.4.1 概述

Smart Retrieval 在 v0.5 成为默认注入路径。`onBeforeGenerate` 从 `formatVaultForPrompt`（全量表格注入）切换为 `formatSmartContext`（BM25 + 记忆 LLM 合成 + 分层上下文）。

#### 3.4.2 注入结构

```
┌─ Layer 0: memory_system_prompt ─────────────────┐
│ 用户自定义的系统级记忆提示词（可选）                │
├─ Layer 1: Current Situation ────────────────────┤
│ Current State（state 摘要）                       │
│ Characters（活跃角色名单）                         │
│ Factions（非中立阵营摘要）                         │
│ Quests（任务基本状态）                             │
├─ Layer 2: Event Memory ─────────────────────────┤
│ [记忆 LLM 合成叙事段落 — "过去发生了什么事"]       │
│ BM25 预过滤 top-40 → callMemoryRetrieval(0.3)    │
├─ Layer 3: Tool Hints ───────────────────────────┤
│ If you need more details → recall_memory / access │
└────────────────────────────────────────────────┘
```

#### 3.4.3 Smart Push 流程

```
onBeforeGenerate
  → clientMessages → query (最近用户消息)
  → filterCandidates(query, allSTM, allLTM, 40) ← BM25 预过滤 + 分数断崖检测
  → buildRetrievalMessages → callMemoryRetrieval ← LLM 合成
  → 分层拼接（当前局面 + 事件记忆 + 工具提示）
  → 失败：回退到仅状态快照
```

#### 3.4.4 recall_memory Tool

保留作为补充检索。LLM 对话中可通过 `recall_memory(query)` 按需获取更细粒度的叙事事件详情。支持 `;;` 分隔多话题并行查询、msg_id 指纹去重。

#### 3.4.5 检索方向

不使用主 LLM 决定检索 query。检索方向来自**最近 5 条用户消息**的拼接——对话本身即是检索信号。

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

**数据流 A：Smart Push 分层注入（默认）**

```
onBeforeGenerate 事件
→ formatSmartContext(vault, chatMessages, budget)
  → 最近用户消息为 query → BM25 预过滤 top-40（分数断崖自适应截断）
  → callMemoryRetrieval() → LLM 叙事合成
  → 分层拼接：
    Layer 0: memory_system_prompt
    Layer 1: 当前局面（formatStateSummary + formatActiveCharacterSummary + formatActiveFactionSummary + formatQuestSummary）
    Layer 2: 事件记忆（LLM 合成叙事段落）
    Layer 3: 工具提示
→ TavernHelper.injectPrompts([{id:'ne_memory_vault', content, position:'in_chat', depth:2}])
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
| 1 | GM Agent（场景分析 + 角色调度 + 知识边界）— 重新评估后降级为 P3。标准 RP 场景中五个职责无真实叙事贡献；唯一独特的"知识边界"仅在群聊/多线分离叙事中生效且场景极窄。AI 跑团生态中目前不存在独立的 GM Agent——所有平台均由主 LLM 同时扮演 DM 和角色，不做分离。该条目可能在重新定位为"离线世界模拟器"后重新激活 | P3-低优 | 待重新设计 | 1.1+ |
| 2 | Agent 重用式多角色状态管理（Character Agent 每人独立 Schema 条目）                                                                                                                                | P1-重要 | 待实现   | 1.1  |
| 3 | 剧情推进引擎（类似 SP 的 Plot Engine，拦截 TH.generate 改写用户消息）                                                                                                                               | P2-一般 | 待实现   | 1.1  |
| 4 | Vault 面板"合并 STM 到 LTM"批量选择 UI                                                                                                                                                   | P2-一般 | 待实现   | 1.1  |
| 5 | 遥测导出"一键复制到剪贴板"功能                                                                                                                                                                | P2-一般 | 待实现   | 1.1  |
| 6 | LLM 输出的 markdown 代码块包装处理 (` ```json `)                                                                                                                                          | P2-一般 | 待实现   | 1.1  |
| 7 | 索引化已整合 STM 老化淘汰（超过 N 轮的已整合 STM 压缩为元数据）                                                                                                                                          | P2-一般 | 待实现   | 1.1  |
| 8 | `vault/store.js` IndexedDB 不可用时静默返回空 vault — 首次安装用户可能不知道记忆未生效                                                                                                                   | P2-一般 | 待修复   | 1.1  |
| 9 | **LTM 灰度激活 — 双池 Top-K 分配**。当前硬阈值 500 STM 后才启用 LTM。未来在 200-500 STM 区间做平滑过渡：ST/LTM 各跑 BM25 Top-K，按 `(stmCount - 200) / 300` 线性分配 slot，避免 500 轮处的检索质量突变。路线 B 实现，不污染 BM25 评分语义 | P3-低优 | 设计完成 | 1.1+ |
| 10 | `engine/consolidate.js` 并行 LLM 调用缺少 `Promise.allSettled` 包装 — 任一个 reject 导致静默失败                                                                                                 | P2-一般 | 待修复   | 1.1  |

### 5.3 活跃条目 — 扩展计划

| # | 标题                                                                                                                                                                                                                                                                                                          | 优先级   | 状态   | 所属版本 |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---- |
| 1 | 多角色群聊记忆分区（每个角色独立 vault）                                                                                                                                                                                                                                                                                     | P1-重要 | 计划中  | 1.1  |
| 2 | 状态 Schema 模板引擎（类似 SP 的 SQL 模板语法）                                                                                                                                                                                                                                                                            | P3-低优 | 计划中  | 1.1  |
| 3 | 消息元数据备份（IndexedDB 数据写入 `msg.TavernDB_NE_*` 字段防止浏览器清除）                                                                                                                                                                                                                                                       | P3-低优 | 计划中  | 1.1  |
| 4 | 倒置 Agent 架构实验模式 — 在 AI 跑团（群聊多角色）场景测试，价值待验证                                                                                                                                                                                                                                                                  | P3-低优 | 计划中  | 实验   |
| 5 | **TRPG Module 外接插件** — 依赖 NE 的跑团规则层：Dice Engine（代码层掷骰）、Combat Tracker（回合/HP/conditions 自动计算）、Rule Adjudicator（SRD 规则查询）、角色数值 Schema 扩展（ability\_scores/AC/spell\_slots）、Combat + Party Schema 区块、预置 D\&D 5e 模板。不内建到 NE，作为独立 TH 脚本分发。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/trpg-module-design.md) | P2-一般 | 设计完成 | 1.1+ |
| 6 | **本地小模型 Retrieval Service** — 用知识蒸馏训练 1-3B 专属记忆模型，替代 gpt-4o-mini 做检索合成。不是为了省钱——是为 0.3s 延迟使每轮 Smart Push 都能做完整 LLM 合成（而非仅 embedding 预过滤）。仅在规模化商业场景或 NE 积累足够 Pipeline 训练数据后值得投入 | P3-低优 | 设想 | 远期 |
| 7 | **对话阶段感知** — 根据 LTM 条目数量 + state.time 推断故事阶段（早期/中期/后期），影响检索偏向 | P3-低优 | 设想 | 远期 |
| 8 | **recall 反馈循环** — 主 LLM 调 recall 后，已消费信息标注为"已使用"，避免 Smart Push 重复注入相同信息 | P3-低优 | 设想 | 远期 |
| 9 | **叙事实体标记** — STM/LTM 条目标注角色+关键物品/势力/概念。查询时按 entity 自动合成事件链（每节点简化为事件描述+msg标记）。Smart Push 输出活跃链概述。完全可选字段，零耦合。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/narrative-entity-tagging-design.md) | P1-重要 | 设计完成 | 0.5 |
| 10 | **ST 标准插件双模式** — NE 当前以 TH 脚本分发（一键直用）。未来提供标准 ST 插件包（放入 extensions 目录），功能完全相同，但可直接访问 ST 内核 API。主要收益：可设置 `chat_truncation` 控制原生上下文滑动窗口，避免主 LLM 被无限历史稀释注意力。玩家在易用性（TH URL）和实际效果（标准插件）中自行选择。源码统一，仅打包方式不同 | P3-低优 | 设想 | 远期 |
| 11 | **深度整合（LLTM）** — 当 LTM 池超过阈值（如 100 条）时触发二次整合，将关联 LTM 合并为更高层级的叙事弧线容器的摘要。BM25 候选池中 LLTM 优先于散落的 LTM 叶子节点，提升超长对话中 Smart Push 的结构化检索精度。原有 LTM 通过 parent 标记从活跃池移除，`access` 嵌套递归定位到叶子层级。仅 1000+ 轮超长对话中体现价值 | P3-低优 | 设想 | 0.6+ |

### 5.4 已解决

#### v0.5 — State Schema 大修 + Smartpush 默认注入 + Tool 日志

| #  | 类型 | 标题 | 解决日期 |
| -- | ---- | ---- | ---------- |
| 68 | 特性 | **State Schema Core/Extension 分层** — CORE_SCHEMA (time/scene/story_date) 从 DEFAULT_GLOBAL_SCHEMA 独立抽取；`ensureStateStructure` 核心字段始终初始化，扩展字段按 Schema 开关门控。Schema OFF 完全跳过 Pipeline 1，时间/场景由 Cursor 管线 `_checkpoints` 维护 | 2026-06-07 |
| 69 | 特性 | **三套专用 State Prompt** — 替代单一 `buildStateChangesPrompt`：`buildStatePrompt_Preset`（预设字段+两段输出+thought 缓冲+HARD GATE）、`buildStatePrompt_Dynamic`（动态字段+字符发现模式）。每个模式独立完整 prompt，不再共用条件分支。`parseSTMResponse` 数组格式兼容（`[{path,value}]` → `{path:value}`） | 2026-06-07 |
| 70 | 特性 | **动态模式角色面板** — `getCharacterSchemaForPanel` 动态模式调用 `buildDynamicCharacterSchema` 使用 `dynamic_state.characters` 字段定义；`getEffectiveSchema` 统一入口；Vault 面板角色渲染按 NPC/PC 分组 | 2026-06-07 |
| 71 | 特性 | **Vault 面板 Core 显示 + Schema OFF 门控** — Schema OFF 时 `formatCoreStateSummary` 渲染 Core 字段；角色/势力/任务面板仅 Schema ON 显示；`getEffectiveSchema` 签名修正（vault vs vault.content crash） | 2026-06-07 |
| 72 | 特性 | **Smartpush 接入 onBeforeGenerate** — `formatVaultForPrompt` → `formatSmartContext`；记忆 LLM 合成事件记忆取代全量表格注入；四层排序：memory_system_prompt → 当前局面 → 事件记忆 → 工具提示；检索方向由最近用户消息自动决定 | 2026-06-07 |
| 73 | 特性 | **Tool 调用日志接入** — `telemetry.js` 的 `addToolCall()` 接入四个工具的 action 回调（access/recall_memory/update_state/rollback_memory），受遥测开关控制 | 2026-06-07 |
| 74 | 特性 | **角色 NPC/PC 自动分类** — Prompt 新增 `npc_names` 字段 + 识别逻辑（step 2）+ HARD GATE 禁止全部标为主控；`getCharacterCardType` 默认值改为 `npc` | 2026-06-07 |
| 75 | 特性 | **present_characters 自动重建** — `rebuildPresentCharacters` 路径修正（state.global→state.present_characters）；每次 `mergeStateChanges` 后自动触发重建 | 2026-06-07 |
| 76 | 修复 | **parseSTMResponse 数组格式兼容** — LLM 输出 `[{path, value}]` 被 `!Array.isArray()` 误判导致全部丢弃 → 增加数组→扁平对象转换 | 2026-06-07 |
| 77 | 修复 | **Thought buffer 防 LLM 提前终止** — Prompt 重构：`<thought>` / `_checkpoints` / `<state_changes>` 三段合为不可分割连续块，首行强调不可在 thought 后停止 | 2026-06-07 |
| 78 | 修复 | **状态路径 `global.*` 前缀修正** — Prompt 示例 `global.time`→`time`，匹配扁平 schema 结构；`formatStateSummary` 跳过空值不再输出 `-` | 2026-06-07 |
| 79 | 修复 | **全局字段 prompt 完整性** — `story_date`/`main_event` 与 `time`/`scene` 同等地位出现；inventory 子字段文档化 (gold/items[].name/qty/equipped/desc)；移除死代码 `state.global.time` 回退 | 2026-06-07 |
| 80 | 修复 | **角色卡渲染去冗余** — 移除冗余 `name` 字段显示；`power_slots` 对象字段序列化为 JSON 字符串而非 `[object Object]` | 2026-06-07 |
| 81 | 修复 | **getEffectiveSchema 签名崩溃** — `getEffectiveSchema(c)` 传 `vault.content` 导致 `c.content.state_schema` → `undefined.state_schema` crash | 2026-06-07 |
| 82 | 特性 | **SmartPush 惰性激活** — STM < 20 且 LTM === 0 时跳过记忆 LLM 合成（窗口尚且兜得住），改为全量 STM/LTM dump 注入。基于实际对话数据分析：单轮 ~804 tokens，8K 上下文约 10 轮 | 2026-06-08 |
| 83 | 特性 | **全量回退注入** — 新增 `formatFullDump` + `buildFullDumpInjection`；BM25 崩溃/零候选/惰性跳过时用原始 STM/LTM dump 替代 LLM 合成摘要，保留 Layer 0→state→dump 的注入顺序 | 2026-06-08 |
| 84 | 修复 | **状态快照修复** — 新增 `buildStateOnlyInjection`，零记忆早退路径不再只输出 scene+time（`formatMinimalState`），而是注入完整 Layer 0 (system_prompt) + Layer 1 (state/characters/factions/quests) + Layer 3 (tool hints) | 2026-06-08 |
| 85 | 修复 | **AI帮答触发拦截** — `onBeforeGenerate(type)` 新增生成类型判断，`impersonate`/`quiet`/`continue` 类型跳过 SmartPush 注入和 pipeline 触发 | 2026-06-08 |
| 86 | 修复 | **已整合 STM 泄漏修复** — `formatSmartContext` 中 `allSTM` 过滤 `stm_entries` 中带 `parent_ltm` 的条目，防止整合后 STM 与 LTM 重复注入 | 2026-06-08 |
| 87 | 修复 | **重入级联斩断** — `generateRaw`/`generateQuietPrompt` 内部调用 `Generate()` 触发 `GENERATION_AFTER_COMMANDS` → `onBeforeGenerate` 重入形成无限级联，每次循环调用 `deactivateSendButtons()` 导致发送按钮周期性卡死在"发送中"状态。新增 `onBeforeGenerateRunning` 重入守卫标志位，拦截所有嵌套重入调用。移除之前的时间阈值假守卫和诊断 MutationObserver | 2026-06-09 |
| 88 | 修复 | **非用户触发 Generate 跳过 SmartPush** — 根因：QR2 dry run 等非用户触发的 `Generate()` 进入 `onBeforeGenerate` → SmartPush → `generateRaw` → ST `Generate()` → `deactivateSendButtons()` 拨动按钮。重入守卫斩断级联但第一次 `generateRaw` 仍然拨动按钮。修复：`flushPendingMessages` 前检测 `pendingMessages.length`，若为空则跳过 SmartPush（不调 `generateRaw`），直接注入 state-only | 2026-06-09 |
| 89 | 修复 | **dryRun 精确检测替代 pendingMessages 启发式** — 真正触发源是 PromptManager 的 `Generate(type, {}, true)` (token 计数 dry run)，而非 QR2。`GENERATION_AFTER_COMMANDS` 事件携带 `(type, options, dryRun)` 三参数，其他扩展（QR2 等）均检测 `dryRun` 跳过。NE 此前只声明 `onBeforeGenerate(type)` 遗漏了 `dryRun`。修复：函数签名改为 `(type, _options, dryRun)`，入口 `if (dryRun) return`，移除 pendingMessages 启发式判断 | 2026-06-09 |
| 90 | 修复 | **`processed_msg_ids` 类型不一致** — `markMessagesProcessed` 写时 `String(id)`、`filterNewMessages` 查时 `String(id)`、`isMessageProcessed` 统一 `String(msgId)`，消除 number vs string 严格相等导致的重复处理 | 2026-06-09 |
| 91 | 修复 | **`flushPendingMessages` fire-and-forget 状态不同步** — `onBeforeGenerate` 改为 `await flushPendingMessages()`，守卫在 pipeline 期间保持，注入用刷新后的 vault | 2026-06-09 |
| 92 | 修复 | **`pendingPartials` 替换导致旧 partial 丢失** — 改为 `pendingPartials.concat(newPartials)` 保留未匹配旧 partials | 2026-06-09 |
| 93 | 修复 | **`chat_id_changed` async handler 无错误处理** — async 函数体包裹 try/catch | 2026-06-09 |
| 94 | 修复 | **`callTavernHelper` timeout 未 abort 底层请求** — 添加注释标注 TH API 固有限制（不支持 AbortController），callCustomAPI 正确使用无影响 | 2026-06-09 |
| 95 | 修复 | **多处 `byId()` 无 null 检查** — `toggleVaultEditMode`/`buildEditForms` 入口守卫，pin/llm/tool/history onclick handler 内部 null 检查 | 2026-06-09 |
| 96 | 修复 | **LTM 编辑保存重复 filter** — 删除被覆盖的无用 forEach 行 | 2026-06-09 |
| 97 | 修复 | **`restorePending` JSON.parse 错误被空 catch 吞掉** — 每个 JSON.parse 独立 try/catch + console.warn | 2026-06-09 |
| 98 | 修复 | **`setupEventListeners` setTimeout 无法取消** — `_retryTimer` 保存 ID，成功/重试时 clearTimeout | 2026-06-09 |
| 99 | 新增 | **Vault 面板 State 字段名 i18n** — 新增 `STATE_FIELD_I18N` 三语映射表（28 个字段名）和 `t_field()` 翻译函数。角色卡、势力卡、任务卡中原本直接显示 `gender_age`、`desc`、`posted_time` 等原始字段名，现根据 ST 语言环境显示自然语言（性别与年龄 / Gender & Age / 性別與年齡 等）。动态字段无翻译时 fallback 到原始 key | 2026-06-09 |
| 100 | 修复 | **`memoryConfig` 死配置** — 设置页 temperature/max_tokens 参数从未被 LLM 调用路径读取。`loadMemoryConfig()` 读取 settings 并传入 `callMemoryPipeline` / `callMemoryRetrieval` | 2026-06-09 |
| 101 | 修复 | **3 个 CONFIG_I18N key 缺失** — `API Key (leave empty for local proxy)` / `Local proxy uses ST server credentials...` / `以上参数将应用于...数值越大消耗越多 token。` 不在 CONFIG_I18N 中导致 fallback 显示原始 key 字符串 | 2026-06-09 |
| 102 | 修复 | **设置保存无反馈** — `saveConfigUI` 成功时无提示。新增 `toastr.success(t_narrative('Settings saved.'))` | 2026-06-09 |
| 103 | 修复 | **NARRATIVE_I18N 中英混编** — `活跃`/`非活跃`/`已退场` 以中文作为 canonical key；`t('活跃')` 误用 `t()` 设置 locale 而非翻译。全部改为英文 canonical key，调用处改为 `t_narrative('Active')` | 2026-06-09 |
| 104 | 修复 | **`confirm()` 阻塞浏览器** — Vault 恢复确认使用原生 `confirm()` 阻塞 UI。改为 toastr 非阻塞通知 + confirm() 保留 fallback | 2026-06-09 |
| 105 | 修复 | **版本来元不一致** — `package.json` 0.3.0、`index.js` 过时 build tag、`th-script-template.json` CDN SHA 过期。统一为 v0.4.0，模板改为 `@main` 动态 CDN | 2026-06-09 |
| 106 | 修复 | **`lastRecallMsgIds` 跨版本残留** — dedup 缓存仅用 chatId 重置，vault 更新后旧缓存可能误伤。新增 `lastRecallVaultVersion`，版本变更时同步清除 | 2026-06-09 |
| 107 | 优化 | **完整 prompt 写入 localStorage** — 每条 LLM 日志存 8KB prompt → 160KB/10条。prompt 截断为 500 字符，response 截断为 4000 字符 | 2026-06-09 |
| 108 | 修复 | **`initPowerSlots` 重复调用** — 每个新角色触发独立 LLM 请求，无去重。新增 `_powerSlotsInited` 每个角色名仅初始化一次 | 2026-06-09 |
| 109 | 修复 | **`_restoredChatIds` 无限增长** — 为每个 chat ID 添加条目但永不清理。新增 50 项上限，溢出时清除最早的 10 项 | 2026-06-09 |
| 110 | 优化 | **`bootNE` 重试原因未区分** — 重试 10 次失败时无 jQuery 已加载时仅跳过无日志。现区分 "jQuery never loaded" 与 "already booted" 两种终止条件 | 2026-06-09 |
| 111 | 修复 | **快照 30 条上限未执行** — `versions.js` 中 `saveSnapshot()` 含 `pruneOldSnapshots` 逻辑但从未被调用。实际快照写入走 `saveVaultWithSnapshot` → `writeWithSnapshot`，只写不剪枝。新增 `pruneSnapshotsForChat()` 导出并在每次快照写入后调用，保留最新 30 条删除最早版本 | 2026-06-09 |
| 112 | 新增 | **Per-chat 轮次归一化遥测** — 所有遥测入口注入 `chat_id`（`recordTelemetry`、`addLLMLog`、`addToolCall`、`addAnomaly`）；新增 `chat-telemetry.js` 模块维护每轮快照（STM/LTM 条目数、LLM/工具调用次数、token、异常、管道耗时）；`flushPendingMessages` 入口触发轮次推进；导出增加 anomalies、token_usage、user_signals、chat_stats 时序数据、derived 衍生指标（per_turn 比值 + 增长率） | 2026-06-09 |

#### v0.4 — 已归档至 v0.4 文档

***

### 5.5 开发中优化 — 架构决策

| # | 日期 | 决策 | 影响 |
|---|------|------|------|
| — | 2026-06-01 | **弃 GM Agent** — 标准 RP 场景无叙事贡献，知识边界场景极窄 | 砍掉 P1 条目，架构瘦身 |
| — | 2026-06-01 | **弃第三层记忆（Mega-LTM）** — Smart Push 嵌入预过滤已解决注入膨胀，第三层为 Push All 补丁 | 保留 STM/LTM 双层 |
| — | 2026-06-01 | **弃 Transformers.js，选 BM25** — 中文模型 470MB 对"粘贴 URL 即用"不可接受 | 零依赖、零延迟 |
| — | 2026-06-01 | **Pipeline 不给 Tool** — 纯请求-响应，Tool 访问仅增加延迟 | 维护管线更简洁 |
| — | 2026-06-01 | **BM25 增强全量注入** — `formatVaultForPrompt` 中加入 BM25 过滤（LTM + 未整合 STM，top-25）。已整合 STM 永不注入 | Retrieval OFF 时注入量从 ~1,850 → ~900 tok |

---

## 6. 版本路线图

| 版本      | 目标           | 核心功能                                                                                                                                          | 判断指标                        |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **0.1** | MVP 可用（已归档）  | Python 后端 + ST Extension 三端架构                                                                                                                 | 已存档于 v0.1 文档                |
| **0.2** | 纯前端 TH 脚本    | ✅ 所有核心逻辑移植到 JS✅ IndexedDB 存储✅ TH 单文件分发✅ Schema 模块✅ Rollup 构建⚠️ GM Agent 待移植⚠️ 消息编辑/删除/滑动事件绑定待补全                                               | 粘贴 URL 到 TH 即用构建通过 (\~45KB) |
| **0.3** | State Schema | ✅ Schema 引擎（校验+摘要+合并）✅ 五大区块（global/characters/factions/quests/power\_slots）✅ 模块化开关（Memory→Schema 门控）✅ 9 Tool 注册（4 核心 + 5 Schema）✅ Rollup 构建通过 | 粘贴 URL 到 TH 即用构建通过 (\~55KB) |
| **0.4** | Smart Push + Memory Retrieval | ✅ Smart Push 智能注入 (Phase B)✅ recall\_memory Tool (Phase C)✅ BM25 预过滤 (Phase D)✅ 架构分离 (Phase A)✅ 鲁棒性增强 (Phase E)✅ 模块化可开关✅ 自适应整合阈值✅ Memory Budget 滑块 | 注入量 ~550 tok；recall tool 可用；Rollup 构建通过 (\~75KB) |
| **1.0** | State Schema 大修 + Smartpush 默认 | ✅ Core/Extension 架构分层✅ 三套专用 State Prompt（预设/动态/Schema OFF）✅ Smartpush 默认注入路径✅ 角色 NPC/PC 自动分类✅ Tool 调用日志✅ Vault 面板 Core 显示方案✅ 动态模式角色面板 | 发布到 ST 社区，获取真实用户数据 |
| **1.1** | 外接插件 + 生态 | TRPG Module（Dice Engine + Combat Tracker + Rule Adjudicator）、规则系统扩展、社区模版库 | 单人 AI DM 体验稳定可用 |
| **1.2** | 稳定发布         | 性能优化文档完善用户 onboarding插件市场提交                                                                                                                   | 1000 轮对话测试零退化               |
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
| **Core Layer** | 始终存在的状态字段层（time/scene/story_date），不受 Schema 开关影响 |
| **Extension Layer** | 可选的状态字段层（characters/factions/quests 等），Schema OFF 时不初始化 |
| **NPC/PC 分类** | LLM 在 state_changes 中通过 npc_names 字段区分非主控角色和主控角色 |
| **Thought Buffer** | Prompt 中的 `<thought>` 前缀块，迫使 LLM 在输出结构化内容前完成推理 |
| **BM25** | 稀疏检索算法，零依赖 5-15ms，用于记忆粗筛 |
| **Pipeline** | 记忆维护管线（STM 提取、Consolidation、State 检测），异步不阻塞 |
| **Retrieval Service** | 记忆检索服务（Smart Push 注入 + recall Tool），同步等待 |

### 8.2 项目结构

```
ne-memory/                              ← 当前（纯前端）
├── src/                                ← 源文件
│   ├── index.js / events.js / tools.js / i18n.js / settings.js / auto-restore.js
│   ├── vault/ (store.js, schema.js, versions.js, retrieval-filter.js)
│   ├── engine/ (update.js, consolidate.js, retrieval.js, cursor.js, validate.js, state-discovery.js, bm25-grouper.js, telemetry.js)
│   ├── api/ (llm.js)
│   └── ui/ (vault-panel.js, config-dialog.js, utils.js)
├── style.css
├── rollup.config.mjs
├── package.json
├── README.md
└── dist/index.js                       ← 发行版（用户粘贴到 TH，~80KB）

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
