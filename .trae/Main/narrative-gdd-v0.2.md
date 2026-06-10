# Narrative Engine — 开发文档

> **文档版本**: 0.2  
> **项目版本**: 0.2  
> **状态**: 已发布（纯前端 TH 脚本架构）  
> **最后更新**: 2026-05-30  

---

## 1. 游戏概念 — Elevator Pitch

**Narrative Engine 是一个纯前端记忆管理引擎，通过酒馆助手 (Tavern Helper) 的 iframe 沙箱运行，为超长对话（500+ 轮）提供结构化的事件记忆管理。**

传统 AI 角色扮演中，对话越长，遗忘越严重。Narrative Engine 将"记忆"拆分为三层（STM / LTM / 状态），通过增量 LLM 调用自动提取、整合、注入，让 AI 在 1000 轮后仍然记得关键事件和当前场景状态。

与同类方案（SP 记忆库）的区别：**NE 专注于叙事事件记忆**（发生了什么、为什么发生、当时什么感觉），而非结构化事实管理（谁是什么、有什么）。两个方案互补共存。

---

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
│    + 4 Tool 注册供模型按需回溯               │
└─────────────────────────────────────────────┘
    │
    ▼
    主 LLM 生成回复（记忆已在 prompt 中）
```

---

## 3. 功能规格

### 3.1 模块树

```
ne-memory/                              ← 单一仓库
├── src/
│   ├── index.js                        ← TH 入口（初始化编排）
│   ├── events.js                       ← 7 个 ST 事件绑定 + 消息队列
│   ├── tools.js                        ← 4 个 Tool 注册
│   ├── i18n.js                         ← 三语翻译表 (en/zh-cn/zh-tw)
│   ├── vault/
│   │   ├── store.js                    ← IndexedDB CRUD + 去重 + 回滚
│   │   ├── schema.js                   ← 状态 Schema 校验 + 字段级约束
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
    └── index.js                         ← 发行版（~45KB IIFE）
```

### 3.2 各模块职责

| 模块 | 职责 | 替代的旧模块 |
|------|------|-------------|
| **vault/store.js** | IndexedDB 封装，vault 读写、合并、回滚 | `vault_store.py` (Python) |
| **vault/schema.js** | 状态 Schema 定义、校验、摘要格式化 | 新增（替代自由 JSON） |
| **vault/versions.js** | 30 快照版本管理，IndexedDB 独立 store | `versions.py` (Python) |
| **engine/update.js** | 增量更新：去重→构建 prompt→解析 STM→追加 | `update()` in vault_store.py |
| **engine/consolidate.js** | LTM 整合：阈值检查→合并→标记 parent_ltm | `_consolidate_stm_to_ltm()` |
| **api/llm.js** | LLM 调用：前端 fetch（副 API）+ TavernHelper 回退 | `llm_client.py` + `routes.py` |
| **index.js** | TH 入口，初始化、locale 检测、事件监听 | `init()` 前端入口 |
| **events.js** | 7 个 ST 事件绑定、消息队列管理 | 事件部分 + 桥接层 |
| **tools.js** | 4 Tool 注册（lookup_memory_source/lookup_stm/update_opening_summary/update_state） | Tool 部分 |
| **ui/vault-panel.js** | Vault 面板渲染、记忆表格、注入格式化 | 前端 UI 全部 |
| **ui/state-templates.js** | 12 种状态模板渲染 | 原渲染器 |
| **ui/config-dialog.js** | 设置弹窗（副 API + 遥测开关） | `config.html` |
| **style.css** | 自定义样式 | 原 `style.css` |

### 3.3 用户故事

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

---

## 4. 技术架构

### 4.1 系统上下文图

```
┌──────────────────────────────────────────────────────────────┐
│                    TH iframe 环境                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ne-memory/dist/index.js (IIFE ~45KB)               │   │
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

---

## 5. 开发日志

### 5.1 活跃条目 — Bug

| # | 标题 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | `tools.js` 中 `rollbackByMsgIds` 已导入但从未注册为 Tool — 前端无一键回滚入口 | P2-一般 | ~~待实现~~ ✅ 已修复 (2026-05-30) |
| 2 | `events.js` 中未绑定 `MESSAGE_DELETED` / `MESSAGE_SWIPED` / `MESSAGE_UPDATED` 事件 — 消息编辑/删除/滑动不会触发 vault 回滚 | P2-一般 | ~~待修复~~ ✅ 已修复 (2026-05-30) |
| 3 | Vault 面板 UI 缺少遥测导出按钮、LLM 操作日志、Tool 调用日志 — 调试能力降低 | P2-一般 | ~~待实现~~ ✅ 已验证原有功能完整 (2026-05-30) |
| 4 | `events.js` 的 `onBeforeGenerate` 缺少 `isContextChanged` 检测 — 跨聊天上下文可能残留旧 vault 注入 | P2-一般 | ~~待修复~~ ✅ 已修复 (2026-05-30) |
| 5 | `update.js` 中 `parseSTMResponse` 的 JSON 回退逻辑不够健壮 — LLM 输出非标准 JSON 时可能解析失败 | P3-低优 | ~~待优化~~ ✅ 已修复 (2026-05-30) |
| 6 | `package.json` 重复 `"type"` 键（先 `"module"` 后 `"commonjs"`）— Node.js 只认后一个值，Rollup ES 构建可能误以 CJS 运行 | P1-重要 | ~~待修复~~ ✅ 已修复 (2026-05-30) |
| 7 | `events.js` `setupEventListeners` 使用 500ms 定时轮询等待 `TavernHelper` 就绪，无上限退避 — TH 加载超慢时永不失败也永不成功 | P3-低优 | ~~待修复~~ ✅ 已修复 (2026-05-30) |
| 8 | `api/llm.js` `callMemoryLLM` 的 `AbortController` timer 在 fetch 成功时只清除当前 timer — 并发请求场景下可能误取消其他请求 | P2-一般 | ~~待修复~~ ✅ 已修复 (2026-05-30) |
| 9 | `tools.js` `lookupMemorySource` / `lookupStmDetails` 仍 fetch 到旧 Python 后端 URL（`/api/plugins/narrative-bridge`）— 纯前端模式下 404 | P1-重要 | ~~待修复~~ ✅ 已验证无此问题 (v0.2 迁移时已修复) |
| 10 | `vault-panel.js` `injectPinCSS()` 每次调用时重新注入 `<style>` 标签，无去重 — 多次打开面板积累重复样式节点 | P3-低优 | ~~待修复~~ ✅ 已修复 (v0.2 已有去重检查) |

> **全部 10 个 Bug 已清除。** 5.1 节可移除。

### 5.2 活跃条目 — TODO

| # | 标题 | 优先级 | 状态 | 所属版本 |
|---|------|--------|------|---------|
| 1 | 状态 Schema 的内置预设（从 12 个状态模板提取字段定义） | P1-重要 | 待实现 | 0.2 |
| 2 | Inject 注入时携带 Schema 摘要而非全量 JSON（空 Schema 时回退旧逻辑） | P1-重要 | 待实现 | 0.2 |
| 3 | GM Agent（场景分析 + 角色调度 + 知识边界）— 已确定走纯前端 TH API 路径，待重新实现 | P1-重要 | 待实现 | 0.3 |
| 4 | Agent 重用式多角色状态管理（Character Agent 每人独立 Schema 条目） | P1-重要 | 待实现 | 0.3 |
| 5 | 剧情推进引擎（类似 SP 的 Plot Engine，拦截 TH.generate 改写用户消息） | P2-一般 | 待实现 | 0.3 |
| 6 | Vault 面板"合并 STM 到 LTM"批量选择 UI | P2-一般 | 待实现 | 0.3 |
| 7 | 遥测导出"一键复制到剪贴板"功能 | P2-一般 | 待实现 | 0.2 |
| 8 | LLM 输出的 markdown 代码块包装处理 (` ```json `) | P2-一般 | 待实现 | 0.2 |
| 9 | 索引化已整合 STM 老化淘汰（超过 N 轮的已整合 STM 压缩为元数据） | P2-一般 | 待实现 | 0.3 |
| 10 | `vault/store.js` IndexedDB 不可用时静默返回空 vault — 首次安装用户可能不知道记忆未生效 | P2-一般 | 待修复 | 0.2 |
| 11 | `engine/consolidate.js` 并行 LLM 调用缺少 `Promise.allSettled` 包装 — 任一个 reject 导致静默失败 | P2-一般 | 待修复 | 0.2 |

### 5.3 活跃条目 — 扩展计划

| # | 标题 | 优先级 | 状态 | 所属版本 |
|---|------|--------|------|---------|
| 1 | 多角色群聊记忆分区（每个角色独立 vault） | P1-重要 | 计划中 | 0.3 |
| 2 | 状态 Schema 模板引擎（类似 SP 的 SQL 模板语法） | P3-低优 | 计划中 | 0.4 |
| 3 | 消息元数据备份（IndexedDB 数据写入 `msg.TavernDB_NE_*` 字段防止浏览器清除） | P3-低优 | 计划中 | 0.4 |
| 4 | 倒置 Agent 架构实验模式 — GM Agent 作为主 Agent 运行，调度对话 LLM 输出多角色回复，实现全景叙事与实时行动选项生成 | P3-低优 | 计划中 | 实验 |

### 5.4 已解决

#### v0.2 — 纯前端重构

| # | 类型 | 标题 | 解决日期 |
|---|------|------|---------|
| 1 | 架构 | 剔除 Python 后端（2,166 行）+ Node.js 桥接层（269 行），全部移植到前端 JS | 2026-05-30 |
| 2 | 架构 | 从 ST Extension 改为 TH 单文件 IIFE 分发（粘贴 URL 即用） | 2026-05-30 |
| 3 | 架构 | 文件存储从 JSON 文件改为 IndexedDB | 2026-05-30 |
| 4 | 架构 | LLM 调用从 Python 后端发起改为前端 TH API / fetch | 2026-05-30 |
| 5 | TODO | 创建 `ne-memory/` 项目（13 个源文件 + Rollup 构建） | 2026-05-30 |
| 6 | TODO | Rollup IIFE 构建管道配置（构建通过，~45KB） | 2026-05-30 |
| 7 | TODO | 状态 Schema 模块（字段级校验 + 摘要格式化 + 通配符支持） | 2026-05-30 |
| 8 | TODO | 增量更新引擎 JS 移植（msg_id 去重、prompt 构建、STM 解析、追加） | 2026-05-30 |
| 9 | TODO | LTM 整合引擎 JS 移植（阈值检查、标记 parent_ltm、不删除 STM） | 2026-05-30 |
| 10 | TODO | 版本快照管理（IndexedDB 独立 store，上限 30） | 2026-05-30 |
| 11 | TODO | 12 状态模板渲染器移植（dating/rpg/cultivation/slice_of_life + 7 generic） | 2026-05-30 |
| 12 | TODO | 三语翻译表移植（NARRATIVE_I18N 49 键 + CONFIG_I18N） | 2026-05-30 |
| 13 | TODO | 设置弹窗 UI（副 API 配置 + 遥测开关） | 2026-05-30 |
| 14 | 🔵 | SP 深度源码审计（52,765 行源码分析 + 架构总览 + 默认表解析） | 2026-05-30 |
| 15 | 🔵 | AI风月/SP/NE 三方消耗模型对比分析 | 2026-05-30 |
| 16 | 🔵 | NE vs SP 完整战略对比文档 (v2) | 2026-05-30 |
| 17 | Bug | `formatVaultForPrompt` 标题硬编码中文 → 使用 t_narrative() | 2026-05-30 |
| 18 | Bug | `getLocale()` 使用 localStorage → 优先 getContext().getCurrentLocale() | 2026-05-30 |
| 19 | Bug | EN CONFIG_I18N 缺少 8 个键 → 补全完整 | 2026-05-30 |
| 20 | Bug | `rollbackByMsgIds` LTM 只检查第一个 msg_id → 改为 `.some()` 遍历全部 | 2026-05-30 |
| 21 | Bug | `stmIndexMap` 遗漏已整合的 unconsolidated_stm → 补全遍历 | 2026-05-30 |
| 22 | 清理 | 移除 index.js 中 16 个死 import + 7 个死全局变量 | 2026-05-30 |
| 23 | 清理 | 移除 tools.js/events.js/vault-panel.js 中 6 个死 import | 2026-05-30 |
| 24 | 清理 | 移除 `manifest.json` / `setup-symlinks.ps1` / `ne-install.ps1` | 2026-05-30 |
| 25 | TODO | 遥测 Issue 上报：设置弹窗「Export Logs / Report」按钮，收集数据后打开 GitHub Issue 预填 JSON | 2026-05-30 |
| 26 | TODO | 消除 `llm.js` 与 `config-dialog.js` 之间的循环依赖 | 2026-05-30 |
| 27 | 配置 | CDN 域名从 `cdn.jsdelivr.net` 改为 `gcore.jsdelivr.net`（国内无障碍加载） | 2026-05-30 |
| 28 | Bug | `tools.js` 导入不存在的函数名 `validateChanges` / `applyStateChanges`（实际为 `validateStateChanges` / `mergeStateChanges`）— 旧 `type: commonjs` 掩盖了导入错误 | 2026-05-30 |
| 29 | Bug | `tools.js` 访问 `result.rejected`（不存在），应为 `result.warnings` — `update_state` Tool 的 Schema 校验错误消息永远不显示 | 2026-05-30 |
| 30 | 兼容 | `schema.js` JSDoc `/** */` 块触发 `@rollup/plugin-commonjs` 解析器 unterminated comment 崩溃 → 改为 `//` 注释 | 2026-05-30 |
| 31 | Bug | `llm.js` `callCustomAPI` 中引用父级 `startTime` 变量（跨作用域访问失败）— 移除重复遥测记录 | 2026-05-30 |
| 32 | Bug | `events.js` 绑定 `MESSAGE_DELETED/SWIPED/UPDATED` 事件 → 自动回滚相关记忆条目 | 2026-05-30 |
| 33 | Bug | `events.js` `onBeforeGenerate` 增加 `lastKnownChatId` 跨聊天检测 → 切换对话时跳过残留注入 | 2026-05-30 |
| 34 | Bug | `index.js` `setupEventListeners` 轮询改为指数退避 (500→1k→2k→4k→…→30k ms, 上限 60 次) | 2026-05-30 |
| 35 | Bug | `tools.js` 注册 `rollback_memory` Tool → LLM 可按需回滚错误记忆 | 2026-05-30 |
| 36 | Bug | `update.js` `parseSTMResponse` 增加 markdown 代码块剥离 (` ```json ... ``` `) | 2026-05-30 |
| 37 | 验证 | Bug #3/10 审计确认：LLM/Tool 日志、导出按钮、injectPinCSS 去重均已存在 | 2026-05-30 |

🔵 = 分析研究成果（非代码改动，但为架构决策提供依据）

---


## 6. 版本路线图

| 版本 | 目标 | 核心功能 | 判断指标 |
|------|------|---------|---------|
| **0.1** | MVP 可用（已归档） | Python 后端 + ST Extension 三端架构 | 已存档于 v0.1 文档 |
| **0.2** | 纯前端 TH 脚本 | ✅ 所有核心逻辑移植到 JS<br>✅ IndexedDB 存储<br>✅ TH 单文件分发<br>✅ Schema 模块<br>✅ Rollup 构建<br>⚠️ GM Agent 待移植<br>⚠️ 消息编辑/删除/滑动事件绑定待补全 | 粘贴 URL 到 TH 即用<br>构建通过 (~45KB) |
| **0.3** | Agent 就绪 + 群聊 | GM Agent 前端实现<br>多角色记忆分区<br>剧情推进引擎<br>消息三级事件完整绑定<br>Vault 面板功能完善 | Agent 回复接入事件链<br>群聊角色切换不丢失状态 |
| **1.0** | 稳定发布 | 性能优化<br>文档完善<br>用户 onboarding<br>插件市场提交 | 1000 轮对话测试零退化 |

---

## 7. 遥测与迭代

### 7.1 收集的数据

用户开启"测试模式"后，插件记录（通过 localStorage 的 telemetry callback）：

| 类别 | 内容 | 用途 |
|------|------|------|
| **LLM 调用** | 操作类型、API 来源、耗时、响应长度 | 分析记忆提取效率 |
| **Token 消耗** | 按操作类型拆分（extract/consolidate） | 判断 API 消耗合理性 |
| **异常信号** | 超时调用（>5s）、连续失败链 | 定位性能瓶颈 |
| **用户干预** | 面板打开次数、手动刷新次数 | 判断用户信任度 |
| **系统环境** | 副 API 配置状态、语言 | 跨版本兼容性分析 |

### 7.2 判断标准

| 指标 | 目标值 | 低于目标说明 |
|------|--------|-------------|
| STM 提取成功率 | > 90% | LLM prompt 或 API 配置有问题 |
| 空结果率 | < 10% | 模型输出格式不匹配 |
| 用户手动编辑率 | < 5% | 自动提取质量够好 |

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

| 层 | 技术 |
|---|------|
| 运行时 | Tavern Helper (JS-Slash-Runner) iframe |
| 语言 | Vanilla JavaScript (ES modules → Rollup IIFE) |
| 存储 | IndexedDB 浏览器内置数据库 |
| LLM 调用 | 前端 fetch (副 API) + TavernHelper.generateRaw (回退) |
| 构建 | Rollup 4 + Babel + Terser |
| UI | jQuery (TH 注入) + 模板字符串 |
| 翻译 | 内联三语表 (en/zh-cn/zh-tw) |

### 8.4 SP 与 NE 对比速查

| 维度 | SP 记忆库 v3.7 | NE Memory Engine v0.2 |
|------|---------------|----------------------|
| 记忆模型 | 表格覆盖写（DDL/SQL 驱动） | 事件增量追加（STM/LTM 分层） |
| 擅长 | 结构化事实（角色属性/物品/时间/NPC） | 叙事事件（剧情/情感/因果关系） |
| 注入方式 | 世界书条目 (constant/keyword) | setExtensionPrompt / injectPrompts |
| 安装方式 | 粘贴 URL 到 TH | 粘贴 URL 到 TH |
| 运行环境 | TH iframe | TH iframe |
| 数据存储 | IndexedDB + 消息元数据 | IndexedDB |
| 共同点 | 纯前端，零后端，零成本分发 | |
