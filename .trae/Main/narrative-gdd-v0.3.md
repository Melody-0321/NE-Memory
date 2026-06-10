# Narrative Engine — 开发文档

> **文档版本**: 0.3\
> **项目版本**: 0.3\
> **状态**: 已发布（纯前端 TH 脚本架构）\
> **最后更新**: 2026-05-30

***

## 1. 游戏概念 — Elevator Pitch

**Narrative Engine 是一个纯前端记忆管理引擎，通过酒馆助手 (Tavern Helper) 的 iframe 沙箱运行，为超长对话（500+ 轮）提供结构化的事件记忆管理。**

传统 AI 角色扮演中，对话越长，遗忘越严重。Narrative Engine 将"记忆"拆分为三层（STM / LTM / 状态），通过增量 LLM 调用自动提取、整合、注入，让 AI 在 1000 轮后仍然记得关键事件和当前场景状态。

与同类方案（SP 记忆库）的区别：**NE 专注于叙事事件记忆**（发生了什么、为什么发生、当时什么感觉），而非结构化事实管理（谁是什么、有什么）。两个方案互补共存。

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
│    ⇒ 仅在 unconsolidated_stm 达到阈值时触发  │
│    → LLM 生成合并后 LTM 条目                 │
│    → 标记 STM parent_ltm，不删除原始 STM    │
│    → 新 LTM 注入上下文，被整合的 STM         │
│      不再注入但可通过 Tool 回溯              │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 4. GENERATION_AFTER_COMMANDS 事件           │
│    → formatVaultForPrompt(vault)            │
│    → TavernHelper.injectPrompts()           │
│      注入：LTM 概览 + 未整合 STM + 状态      │
│    + 9 Tool 注册供模型按需回溯              │
└─────────────────────────────────────────────┘
    │
    ▼
    主 LLM 生成回复（记忆已在 prompt 中）
```

***

## 3. 功能规格

### 3.1 模块树

```
ne-memory/                              ← 单一仓库
├── src/
│   ├── index.js                        ← TH 入口（初始化编排）
│   ├── events.js                       ← 7 个 ST 事件绑定 + 消息队列
│   ├── tools.js                        ← 9 Tool 注册（4 核心 + 5 Schema）
│   ├── i18n.js                         ← 三语翻译表 (en/zh-cn/zh-tw)
│   ├── vault/
│   │   ├── store.js                    ← IndexedDB CRUD + 去重 + 回滚
│   │   ├── schema.js                   ← 状态 Schema 引擎 + 5 区块 Schema 定义 + 摘要格式化 + modularity toggle
│   │   └── versions.js                 ← 30 版本快照管理
│   ├── engine/
│   │   ├── update.js                   ← 增量更新引擎（新增 delta → STM）
│   │   └── consolidate.js              ← LTM 整合引擎（标记 parent_ltm）
│   ├── api/
│   │   └── llm.js                      ← LLM 调用（副 API 优先，TH 回退）
│   └── ui/
│       ├── vault-panel.js              ← Vault 面板 + 记忆表格渲染
│       ├── state-templates.js          ← 12 状态模板渲染
│       ├── config-dialog.js            ← 设置弹窗 UI
│       └── utils.js                    ← escapeHtml + formatLocalTime
├── style.css                           ← 自定义样式
├── rollup.config.mjs                   ← Rollup IIFE 构建
├── jsconfig.json                       ← IDE 类型配置
├── package.json                        ← 依赖声明
├── README.md                           ← 安装说明
└── dist/
    └── index.js                         ← 发行版（~55KB IIFE）
```

### 3.2 各模块职责

| 模块                        | 职责                                                                                                                                            | 替代的旧模块                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **vault/store.js**        | IndexedDB 封装，vault 读写、合并、回滚                                                                                                                   | `vault_store.py` (Python)     |
| **vault/schema.js**       | 状态 Schema 引擎 + 5 区块 Schema 定义 + 摘要格式化 + modularity toggle                                                                                     | 新增（替代自由 JSON）                 |
| **vault/versions.js**     | 30 快照版本管理，IndexedDB 独立 store                                                                                                                  | `versions.py` (Python)        |
| **engine/update.js**      | 增量更新：去重→构建 prompt→解析 STM+state\_changes→追加                                                                                                    | `update()` in vault\_store.py |
| **engine/consolidate.js** | LTM 整合：阈值检查→合并→标记 parent\_ltm                                                                                                                 | `_consolidate_stm_to_ltm()`   |
| **api/llm.js**            | LLM 调用：前端 fetch（副 API）+ power\_slots 初始化 + TavernHelper 回退                                                                                    | `llm_client.py` + `routes.py` |
| **index.js**              | TH 入口，初始化、locale 检测、事件监听 + Schema 开关桥接                                                                                                        | `init()` 前端入口                 |
| **events.js**             | 7 个 ST 事件绑定、消息队列管理                                                                                                                            | 事件部分 + 桥接层                    |
| **tools.js**              | 9 Tool 注册（4 核心：lookup\_memory\_source / lookup\_stm / update\_opening\_summary / rollback\_memory + 5 Schema：vault\_lookup / update\_state 等） | Tool 部分                       |
| **ui/vault-panel.js**     | Vault 面板渲染、记忆表格、注入格式化、角色/势力/任务面板                                                                                                              | 前端 UI 全部                      |
| **ui/state-templates.js** | 12 种状态模板渲染（自由 JSON 回退路径）                                                                                                                      | 原渲染器                          |
| **ui/config-dialog.js**   | 设置弹窗（副 API + 遥测开关 + 记忆处理 + Schema）                                                                                                            | `config.html`                 |
| **style.css**             | 自定义样式                                                                                                                                         | 原 `style.css`                 |

### 3.3 State Schema 模块（可选）

#### 3.3.1 概述

State Schema 是 NE v0.3 的主要新功能——可在记忆提取的同时维护结构化状态（角色卡、势力、任务等）。基于 [State Schema 设计文档](file:///d:/SillyTavern/.trae/documents/Designs/state-schema-design.md) 的完整设计实现。

#### 3.3.2 模块化开关

```
Enable Memory System (基础开关)
  └── Enable State Schema (子开关，依赖记忆系统)
```

| 开关状态                   | 行为                                             |
| ---------------------- | ---------------------------------------------- |
| Memory OFF             | Schema 开关完全隐藏。系统纯记忆优化，零状态管理                    |
| Memory ON + Schema OFF | LLM 不输出 state\_changes。系统回退到自由 JSON state（旧行为） |
| Memory ON + Schema ON  | 完整 Schema 系统激活：字段校验、摘要注入、9 Tool 注册             |

#### 3.3.3 五大区块

| 区块                                                     |           资格          | Tool           |
| ------------------------------------------------------ | :-------------------: | -------------- |
| **global**（场景/时间/在场角色/氛围）                              |          始终启用         | —              |
| **characters**（主角/NPC 详情卡 + 活跃/非活跃/已退场三态）              |       Schema ON       | `vault_lookup` |
| **factions**（势力名称/对主角态度/势力间关系/备注）                      |    Schema ON + 可选开启   | `vault_lookup` |
| **quests**（任务/目标/世界事件，双层暴露）                            |    Schema ON + 可选开启   | `vault_lookup` |
| **power\_slots**（vitality/energy/realm 模板驱动，副 API 初始化） | Schema ON + 世界书/角色卡触发 | —              |

#### 3.3.4 设计特性

- **虚拟字段**：`present_characters` 由代码从活跃角色重建，装备从 inventory 的 `equipped=true` 过滤。LLM 不接触这两个字段
- **双层暴露**：quests 注入时仅含 name+deadline/status；detail 字段通过 Tool 查询
- **模板引导**：power\_slots 不硬编码命名——副 API 阅读世界书后用世界书中的术语填充
- **永不删除**：角色详情卡/任务/事件标记为终态但保留，通过 Tool 仍可查询

### 3.4 用户故事

```
作为 SillyTavern 用户，我希望粘贴一行 URL 到酒馆助手就能安装好记忆系统，
      不需要安装 Python、不需要配置后端、不需要复制文件。

作为角色扮演玩家，我希望记忆被整合后仍然可以回溯到原始细节，
      以便需要时能查到"当时具体说了什么话"。

作为长篇剧情的创作者，我希望记忆维护不占用主 API 的 Token 预算，
      以便省钱的同时不影响生成质量。

作为多角色 RP 玩家，我希望每个角色都有完整的状态记录，
      而不是只有主角才有完善的属性追踪。

作为 SP 记忆库的用户，我希望 NE 与我已安装的 SP 互补共存，
      不需要选择"二选一"。
```

***

## 4. 技术架构

### 4.1 系统上下文图

```
┌──────────────────────────────────────────────────────────────┐
│                    TH iframe 环境                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ne-memory/dist/index.js (IIFE ~55KB)               │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │   │
│  │  │ vault/   │ │ engine/  │ │ api/llm.js         │   │   │
│  │  │ ·store.js│ │ ·update  │ │ fetch() → 副 API   │   │   │
│  │  │ ·schema  │ │ ·consol. │ │ generateRaw() → TH │   │   │
│  │  │ ·version │ └──────────┘ └────────────────────┘   │   │
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

**数据流 A：记忆注入**

```
GENERATION_AFTER_COMMANDS 事件
→ formatVaultForPrompt(vault) 格式化
→ TavernHelper.injectPrompts([{id:'ne_memory_vault', content, ...}])
→ 注入到 LLM 上下文（LTM 摘要 + 未整合 STM + 状态 + 开场）
```

**数据流 B：增量记忆更新**

```
MESSAGE_SENT / MESSAGE_RECEIVED 事件
→ 消息加入 pendingMessages 队列
→ 队列满或字数达标 → flushPendingMessages()
→ collectProcessedMsgIds() 去重
→ filterNewMessages() 只留新消息
→ callMemoryLLM() 提取 STM 条目
→ appendSTMEntries() 追加到 IndexedDB vault
→ saveSnapshot() 保存版本快照
→ checkConsolidateThreshold() 检查是否需要整合
```

**数据流 C：Tool-calling 回溯**

```
主 LLM 调用 lookup_memory_source(chat_id, msg_ids)
→ Tool action 在前端执行
→ 读 SillyTavern.getContext().chat 消息数组
→ 返回匹配的原始消息文本
```

### 4.3 数据模型

**Vault JSON 结构（IndexedDB 存储）**

```json
{
  "chat_id": "string",
  "version": "number",
  "tokens": "number",
  "updated_at": "ISO datetime",
  "content": {
    "summary": "string",
    "opening_summary": { "text": "string", "source_msg_ids": [] },
    "state": {},
    "state_template": "auto|dating|rpg|slice_of_life|cultivation|...",
    "state_schema": { /* 可选，Schema 定义 */ },
    "ltm_entries": [{ "id", "period", "scene", "event", "stm_refs" }],
    "stm_entries": [{ "id", "period", "scene", "event", "msg_ids", "parent_ltm", "timestamp" }],
    "unconsolidated_stm": [{ /* 同上结构 */ }],
    "current_scene": "string",
    "consolidate_threshold": 5,
    "language": "zh|en"
  },
  "stm_index": { "stm_id": { "ltm_id", "summary", "msg_ids" } },
  "memory_system_prompt": "string"
}
```

**Schema 定义格式（可选，激活后强校验）**

```json
{
  "characters": {
    "type": "object",
    "schema": {
      "*": {
        "type": "object",
        "fields": {
          "mood": { "type": "string", "max_length": 20 },
          "location": { "type": "string", "max_length": 30 },
          "health": { "type": "enum", "values": ["健康", "轻伤", "重伤", "濒死"] }
        }
      }
    }
  },
  "scene": { "type": "string", "max_length": 50 },
  "time": { "type": "string", "max_length": 30 }
}
```

***

## 5. 开发日志

### 5.1 活跃条目 — Bug

> 全部 Bug 已移至 5.4 已解决。

### 5.2 活跃条目 — TODO

| # | 标题                                                                                                                                                                              | 优先级   | 状态    | 所属版本 |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | ---- |
| 1 | GM Agent（场景分析 + 角色调度 + 知识边界）— 重新评估后降级为 P3。标准 RP 场景中五个职责无真实叙事贡献；唯一独特的"知识边界"仅在群聊/多线分离叙事中生效且场景极窄。AI 跑团生态中目前不存在独立的 GM Agent——所有平台均由主 LLM 同时扮演 DM 和角色，不做分离。该条目可能在重新定位为"离线世界模拟器"后重新激活 | P3-低优 | 待重新设计 | 0.6+ |
| 2 | Agent 重用式多角色状态管理（Character Agent 每人独立 Schema 条目）                                                                                                                                | P1-重要 | 待实现   | 0.4  |
| 3 | 剧情推进引擎（类似 SP 的 Plot Engine，拦截 TH.generate 改写用户消息）                                                                                                                               | P2-一般 | 待实现   | 0.4  |
| 4 | Vault 面板"合并 STM 到 LTM"批量选择 UI                                                                                                                                                   | P2-一般 | 待实现   | 0.4  |
| 5 | 遥测导出"一键复制到剪贴板"功能                                                                                                                                                                | P2-一般 | 待实现   | 0.4  |
| 6 | LLM 输出的 markdown 代码块包装处理 (` ```json `)                                                                                                                                          | P2-一般 | 待实现   | 0.4  |
| 7 | 索引化已整合 STM 老化淘汰（超过 N 轮的已整合 STM 压缩为元数据）                                                                                                                                          | P2-一般 | 待实现   | 0.4  |
| 8 | `vault/store.js` IndexedDB 不可用时静默返回空 vault — 首次安装用户可能不知道记忆未生效                                                                                                                   | P2-一般 | 待修复   | 0.4  |
| 9 | `engine/consolidate.js` 并行 LLM 调用缺少 `Promise.allSettled` 包装 — 任一个 reject 导致静默失败                                                                                                 | P2-一般 | 待修复   | 0.4  |

### 5.3 活跃条目 — 扩展计划

| # | 标题                                                                                                                                                                                                                                                                                                          | 优先级   | 状态   | 所属版本 |
| - | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- | ---- |
| 1 | 多角色群聊记忆分区（每个角色独立 vault）                                                                                                                                                                                                                                                                                     | P1-重要 | 计划中  | 0.4  |
| 2 | 状态 Schema 模板引擎（类似 SP 的 SQL 模板语法）                                                                                                                                                                                                                                                                            | P3-低优 | 计划中  | 0.5  |
| 3 | 消息元数据备份（IndexedDB 数据写入 `msg.TavernDB_NE_*` 字段防止浏览器清除）                                                                                                                                                                                                                                                       | P3-低优 | 计划中  | 0.5  |
| 4 | 倒置 Agent 架构实验模式 — 在 AI 跑团（群聊多角色）场景测试，价值待验证                                                                                                                                                                                                                                                                  | P3-低优 | 计划中  | 实验   |
| 5 | **Memory Retrieval Service + Smart Push** — 记忆 LLM 架构分离（Pipeline 维护 + Service 检索）、Smart Push 智能注入替代全量注入、recall\_memory Tool、State 注入最小化。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/memory-retrieval-design.md)                                                                               | P1-重要 | 设计完成 | 0.5+ |
| 6 | **TRPG Module 外接插件** — 依赖 NE 的跑团规则层：Dice Engine（代码层掷骰）、Combat Tracker（回合/HP/conditions 自动计算）、Rule Adjudicator（SRD 规则查询）、角色数值 Schema 扩展（ability\_scores/AC/spell\_slots）、Combat + Party Schema 区块、预置 D\&D 5e 模板。不内建到 NE，作为独立 TH 脚本分发。详见 [设计文档](file:///d:/SillyTavern/.trae/documents/Designs/trpg-module-design.md) | P2-一般 | 设计完成 | 0.6+ |
| 7 | **本地小模型 Retrieval Service** — 用知识蒸馏训练 1-3B 专属记忆模型，替代 gpt-4o-mini 做检索合成。不是为了省钱——是为 0.3s 延迟使每轮 Smart Push 都能做完整 LLM 合成（而非仅 embedding 预过滤）。仅在规模化商业场景或 NE 积累足够 Pipeline 训练数据后值得投入。依赖 v0.5 Retieval Service 架构分离完成 | P3-低优 | 设想 | 远期 |
| 8 | **BM25 预过滤** — 默认使用 BM25 纯算法做 memory 粗筛：零依赖、零延迟、5-15ms/轮。LLM 精排兜底语义盲区。未来可选增强：检测到副 API `/embeddings` 端点后自动升级为 embedding 缓存。详见 [设计文档 §Phase D](file:///d:/SillyTavern/.trae/documents/Designs/memory-retrieval-design.md) | P1-重要 | 设计完成 | 0.5 |

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

***

### 5.5 开发中优化 — 未预见的改进

在 v0.3 开发期间和 Smart Push 实施后，出现了若干在原始设计文档中未计划但经讨论后决定立即执行的改进：

| # | 日期 | 内容 | 影响 |
|---|------|------|------|
| 1 | 2026-05-30 | **LTM `time_range` 字段** — 整合时代码层自动从源 STM 条目推导时间范围，不再依赖 LLM 自由输出的 `period`。同步修改 `period` prompt 约束：从 `state.time` 继承，禁止编造 | 所有记忆条目共享同一时钟源，Smart Push 时间锚点统一 |
| 2 | 2026-05-30 | **记忆 LLM 身份持久化（Vault Identity 头部）** — Retrieval Service 每次调用时注入 `opening_summary` + `stm_count` + `ltm_count` + `last_pipeline_task`，让记忆 LLM 知道自己已经跟踪了这个故事多久 | 跨调用推理连贯性提升 |
| 3 | 2026-05-31 | **BM25 预过滤（替代 Transformers.js 方案）** — 零依赖、5-15ms 纯算法检索，LLM 精排兜底语义盲区 | 零成本、零延迟的检索粗筛 |
| 4 | 2026-05-31 | **检索结果自验证** — Retrieval 返回前检查内部矛盾，自动标注时间线冲突 | 防止记忆 LLM 合成错误传递到主 LLM |
| 5 | 2026-05-31 | **Smart Retrieval 模块化开关** — Memory→Smart Retrieval 子开关，与 State Schema 同级。关闭/删除模块后自动回退 v0.3 全量注入 | 零风险退回，模块自包含 |
| 6 | 2026-05-31 | **记忆 LLM 注入 state 摘要** — `buildSTMUpdatePrompt` 中追加当前状态 snapshot（summary 层字段的 dot.path=value 格式），让记忆 LLM 在决策 state_changes 时知道字段的当前值 | 降低计数/基事件字段的盲写错误率 |
| 7 | 2026-05-31 | **LTM 分级暴露策略** — 500 STM 条目前 LTM 不进入 BM25 搜索池（纯 STM 检索 + 已整合 STM 保留）；500 条后 LTM 替换其下 STM。硬阈值方案。渐变方案（双池 Top-K 分配）分析完成，推迟到有基准数据后评估 | 短对话检索精度 ↑20-30%，长对话多样性不退化 |

***

## 6. 版本路线图

| 版本      | 目标           | 核心功能                                                                                                                                          | 判断指标                        |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **0.1** | MVP 可用（已归档）  | Python 后端 + ST Extension 三端架构                                                                                                                 | 已存档于 v0.1 文档                |
| **0.2** | 纯前端 TH 脚本    | ✅ 所有核心逻辑移植到 JS✅ IndexedDB 存储✅ TH 单文件分发✅ Schema 模块✅ Rollup 构建⚠️ GM Agent 待移植⚠️ 消息编辑/删除/滑动事件绑定待补全                                               | 粘贴 URL 到 TH 即用构建通过 (\~45KB) |
| **0.3** | State Schema | ✅ Schema 引擎（校验+摘要+合并）✅ 五大区块（global/characters/factions/quests/power\_slots）✅ 模块化开关（Memory→Schema 门控）✅ 9 Tool 注册（4 核心 + 5 Schema）✅ Rollup 构建通过 | 粘贴 URL 到 TH 即用构建通过 (\~55KB) |
| **0.4** | Smart Push + 基础修复 | Smart Push 注入（Phase B）、recall\_memory Tool（Phase C）、State 注入最小化、TODO #4-9 修复、用户反馈收集、暴露 Public API 供外接插件对接 | 注入量从 ~1,850 降到 ~600 tok；recall tool 可用 |
| **0.5** | 全链路记忆检索 | Memory Retrieval Service 架构分离（Phase A）、BM25 预过滤 + embedding 自动升级（Phase D）、Pipeline vs Service 正式拆分、检索质效评估 | 检索延迟 <2s；有效记忆回忆率 >70% |
| **0.6** | 外接插件 + 生态 | TRPG Module（Dice Engine + Combat Tracker + Rule Adjudicator）、规则系统扩展、社区模版库 | 单人 AI DM 体验稳定可用 |
| **1.0** | 稳定发布         | 性能优化文档完善用户 onboarding插件市场提交                                                                                                                   | 1000 轮对话测试零退化               |
| **远期** | 本地小模型加速 | 知识蒸馏 1-3B 专属记忆模型：Pipeline 级蒸馏（替代 mini 做提取）→ Retrieval 级蒸馏（0.3s 合成替代 2s API 调用）→ 每轮 Smart Push 完整 LLM 合成无需 API | 本地推理 <0.5s；Retieval 质量 ≥ mini 的 95% |
| **远期** | LTM 渐变暴露 | 200-500 区间双池 Top-K 分配（STM+LTM 独立排序然后合并），替代当前硬阈值。需 LoCoMo/LongMemEval 基准数据确定最佳分界点 | 检索质量曲线平滑，无突变感知 |

***

## 7. 遥测与迭代

### 7.1 收集的数据

用户开启"测试模式"后，插件记录（通过 localStorage 的 telemetry callback）：

| 类别           | 内容                           | 用途           |
| ------------ | ---------------------------- | ------------ |
| **LLM 调用**   | 操作类型、API 来源、耗时、响应长度          | 分析记忆提取效率     |
| **Token 消耗** | 按操作类型拆分（extract/consolidate） | 判断 API 消耗合理性 |
| **异常信号**     | 超时调用（>5s）、连续失败链              | 定位性能瓶颈       |
| **用户干预**     | 面板打开次数、手动刷新次数                | 判断用户信任度      |
| **系统环境**     | 副 API 配置状态、语言                | 跨版本兼容性分析     |

### 7.2 判断标准

| 指标        | 目标值   | 低于目标说明                 |
| --------- | ----- | ---------------------- |
| STM 提取成功率 | > 90% | LLM prompt 或 API 配置有问题 |
| 空结果率      | < 10% | 模型输出格式不匹配              |
| 用户手动编辑率   | < 5%  | 自动提取质量够好               |

***

## 8. 附录

### 8.1 术语表

| 术语               | 说明                                                                     |
| ---------------- | ---------------------------------------------------------------------- |
| **STM**          | Short-term Memory，短期记忆，未整合的近期事件                                        |
| **LTM**          | Long-term Memory，长期记忆，已整合的关键事件流                                        |
| **Vault**        | 记忆区，IndexedDB 存储的结构化记忆                                                 |
| **Consolidate**  | 整合，将 STM 合并到 LTM 的过程（不删除原始 STM）                                        |
| **Schema**       | 状态字段定义，声明 LLM 可修改的字段及其类型/约束                                            |
| **Tool-calling** | 主 LLM 通过注册的工具函数查询记忆                                                    |
| **TH**           | 酒馆助手 (Tavern Helper / JS-Slash-Runner)                                 |
| **IIFE**         | Immediately Invoked Function Expression，单文件脚本打包格式                      |
| **State Schema** | v0.3 新增的结构化状态管理系统，五大区块（global/characters/factions/quests/power\_slots） |

### 8.2 项目结构

```
ne-memory/                              ← 当前（纯前端）
├── src/                                ← 源文件
│   ├── index.js / events.js / tools.js / i18n.js
│   ├── vault/ (store.js, schema.js, versions.js)
│   ├── engine/ (update.js, consolidate.js)
│   ├── api/ (llm.js)
│   └── ui/ (vault-panel.js, state-templates.js, config-dialog.js, utils.js)
├── style.css
├── rollup.config.mjs
├── package.json
├── README.md
└── dist/index.js                       ← 发行版（用户粘贴到 TH）

sillytavern-narrative/                  ← 旧架构（已归档，不维护）
├── src/ (Python 2,166 行)
├── bridge/ (Node.js 269 行)
└── extension/ (JS 2,419 行)
```

### 8.3 技术栈

| 层      | 技术                                               |
| ------ | ------------------------------------------------ |
| 运行时    | Tavern Helper (JS-Slash-Runner) iframe           |
| 语言     | Vanilla JavaScript (ES modules → Rollup IIFE)    |
| 存储     | IndexedDB 浏览器内置数据库                               |
| LLM 调用 | 前端 fetch (副 API) + TavernHelper.generateRaw (回退) |
| 构建     | Rollup 4 + Babel + Terser                        |
| UI     | jQuery (TH 注入) + 模板字符串                           |
| 翻译     | 内联三语表 (en/zh-cn/zh-tw)                           |

### 8.4 SP 与 NE 对比速查

| 维度   | SP 记忆库 v3.7              | NE Memory Engine v0.3              |
| ---- | ------------------------ | ---------------------------------- |
| 记忆模型 | 表格覆盖写（DDL/SQL 驱动）        | 事件增量追加（STM/LTM 分层）                 |
| 擅长   | 结构化事实（角色属性/物品/时间/NPC）    | 叙事事件（剧情/情感/因果关系）                   |
| 注入方式 | 世界书条目 (constant/keyword) | setExtensionPrompt / injectPrompts |
| 安装方式 | 粘贴 URL 到 TH              | 粘贴 URL 到 TH                        |
| 运行环境 | TH iframe                | TH iframe                          |
| 数据存储 | IndexedDB + 消息元数据        | IndexedDB                          |
| 共同点  | 纯前端，零后端，零成本分发            | <br />                             |

