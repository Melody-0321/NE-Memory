# Narrative Engine — 开发文档

> **文档版本**: 0.1.1 (审阅修订)  
> **项目版本**: 0.1  
> **状态**: 已审阅  
> **最后更新**: 2026-05-29 (审阅：源码全量审计)  

---

## 1. 游戏概念 — Elevator Pitch

**Narrative Engine 是一个 SillyTavern 扩展，为超长对话（500+ 轮）提供结构化的记忆管理。**

传统 AI 角色扮演中，对话越长，遗忘越严重。现有方案（Summarize / Chat Vectorization）要么将旧摘要堆满上下文造成污染，要么全量重生成浪费大量 Token。Narrative Engine 将"记忆"拆分为三层（STM / LTM / 状态），由独立的 Python 后端通过增量 LLM 调用自动提取、整合、注入，让 AI 在 1000 轮后仍然记得角色关系、关键事件和当前场景状态。

---

## 2. 核心循环 — Core Loop

```
用户发送消息
    │
    ▼
┌─────────────────────────────────────┐
│ 1. 前端插件捕获 MESSAGE_SENT 事件     │
│    将用户消息加入待处理队列            │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 2. MESSAGE_RECEIVED 捕获 AI 回复     │
│    将 AI 回复加入待处理队列            │
│    队列攒够阈值 → 触发 checkAndFlush()│
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. 后端增量记忆更新                   │
│    POST /memory/vault/update         │
│    → 提取新消息中的 STM 条目          │
│    → 必要时整合 LTM（consolidate）    │
│    → 更新开场摘要 / 状态              │
│    → 递增版本号，覆盖旧版本            │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. GENERATE_AFTER_COMMANDS 事件      │
│    读取 vault → 格式化记忆文本        │
│    setExtensionPrompt() 注入上下      │
│    文：LTM 概览 + STM 详情 + 状态    │
│    + Tool-calling 注册供模型按需回溯  │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 5. 主 LLM 生成回复                    │
│    记忆已在 prompt 中                  │
│    需要时调用 lookup_memory_source    │
│    等 Tool 回溯原始对话                │
└─────────────────────────────────────┘
    │
    ▼
    用户看到有上下文记忆的回复
```

---

## 3. 功能规格

### 3.1 模块树

```
Narrative Engine v0.1
├── Python 后端 (sillytavern-narrative/src/, 2,166 LOC)
│   ├── main.py                — FastAPI 入口 (36 行)，CORS + 路由挂载
│   ├── config.py              — 环境变量配置 (14 行)
│   ├── llm_client.py          — LLM 调用封装 (157 行)，支持 25+ API 后端
│   ├── api/routes.py          — 21 条 REST API 路由 (344 行)
│   ├── api/schemas.py         — 30 个 Pydantic 请求/响应模型 (172 行)
│   ├── memory/vault_store.py  — 记忆区核心 (920 行)
│   │   ├── 增量更新引擎（LLM 提取 STM → 队列 → 整合 LTM）
│   │   ├── 版本管理（单调递增 + 30 个历史快照）
│   │   ├── 开场摘要 / 状态提取 / 叙事检查
│   │   └── 手动编辑 + 回滚 + 版本恢复
│   ├── memory/link_lookup.py  — 按 msg_id 回溯原始对话 (66 行)
│   └── agents/               — Agent 系统 (457 LOC)
│       ├── base.py           — Agent 基类 + 生命周期状态机
│       ├── gm_agent.py       — GM Agent (276 行)
│       ├── character_agent.py— Character Agent (94 行)
│       └── parallel_engine.py— 并行生成引擎 (47 行)
│
├── 前端插件 (public/scripts/extensions/narrative/, 2,419 行 JS)
│   ├── index.js              — 初始化 + 事件绑定 + UI 渲染 + Tool 注册 + 遥测
│   ├── config.html           — 单层 inline-drawer + 3 Tab 设置面板
│   ├── style.css             — 自定义样式 (207 行)
│   ├── manifest.json         — 插件元数据 (v0.1.0, 激活钩子: init)
│   └── i18n/                 — zh.json / en.json（已弃用，改用内联 CONFIG_I18N）
│
├── 桥接层 (sillytavern-narrative/bridge/st-narrative-bridge/, 269 行)
│   └── index.js              — 18 条代理路由 + 1 条 LLM 直调端点
│
└── 发行版 (sillytavern-narrative/extension/narrative/)
    └── (通过符号链接与 public/scripts/extensions/narrative/ 同步)
```

### 3.2 各模块职责（审阅后修正）

| 模块 | 实际职责 | 代码量 | 当前状态 |
|------|---------|--------|---------|
| **Memory Vault** (vault_store.py) | STM/LTM 结构化记忆的 CRUD + 增量更新 + 版本管理 | 920 行 | ✅ 完整可用 |
| **LLM Client** (llm_client.py) | 从 ST settings.json/secrets.json 读取 API 配置，支持 25+ 后端，返回完整响应（无流式） | 157 行 | ✅ 可用，但不支持流式 |
| **增量更新引擎** | LLM 提取 STM → 追加到 unconsolidated → 达到阈值触发 consolidate | vault_store.py 核心 | ✅ 完整可用 |
| **GM Agent** (gm_agent.py) | 场景分析 + 角色调度 + 知识边界控制 + 一致性检查 | 276 行 | ⚠️ 后端完整，前端未接入 |
| **Character Agent** (character_agent.py) | 按人设 + GM 指令 + 状态生成角色回复 | 94 行 | ⚠️ 后端完整，前端未接入 |
| **并行引擎** (parallel_engine.py) | asyncio.gather 并行执行所有活跃 Agent | 47 行 | ⚠️ 后端完整，前端未接入 |
| **前端插件** (index.js) | 事件钩子、UI 面板、4 Tool 注册、遥测 | 2,419 行 | ✅ 完整可用 |
| **遥测系统** | Tool-call 日志 + Token 消耗 + 异常检测 + 用户信号 + 导出 JSON | index.js 约 200 行 | ✅ 完整可用（需 enableTelemetry 开启） |
| **桥接层** (bridge) | 18 条代理路由 + 1 条 ST LLM 直调端点 + ST 配置读取 | 269 行 | ✅ 可用 |
| **Agent 生命周期管理** | ACTIVE / SLEEPING / TERMINATED 状态机 + CharacterAgentManager | agents/ | ⚠️ 后端完整，前端未接入 |

### 3.3 用户故事（审阅后修正）

```
作为 SillyTavern 用户，我希望能自动保存对话中的重要事件和关系到结构化记忆区，
      以便 AI 在 500 轮对话后仍然记得这些关键剧情。

作为 SillyTavern 用户，我希望记忆区能自动将短期记忆整合到长期记忆，
      以减少上下文占用并保持 AI 回复的连贯性。

作为角色扮演玩家，我希望在 Vault 面板中查看和手动编辑记忆条目，
      以便纠正自动提取的错误。

作为角色扮演玩家，我希望能够一键导出使用日志给开发者，
      以便帮助定位问题并改进记忆质量。

作为使用 GM Agent 的玩家，我希望 GM 为我管理场景氛围和角色调度，
      以便在多角色场景中获得更沉浸的体验。

作为开发者，我希望能通过遥测数据了解 Tool 使用模式、Token 消耗和异常信号，
      以便针对性地优化记忆管线。
```

---

## 4. 技术架构

### 4.1 系统上下文图（审阅后修正）

```
┌───────────────────────────────────────────────────────────────┐
│                    SillyTavern (Node.js + Vanilla JS)          │
│                                                               │
│  ┌─────────────────────┐   ┌───────────────────────────────┐  │
│  │ 前端 (Browser)       │   │ ST 后端 (Express)              │  │
│  │                      │   │                               │  │
│  │ narrative/index.js   │   │ bridge/index.js               │  │
│  │ (2,419 行)           │   │ 18 条代理路由 + /llm/chat     │  │
│  │                      │   │ ├─ 直读 ST settings.json 获取 │  │
│  │ ├─ 7 事件监听        │   │ │  主 LLM 配置 (modelMap)    │  │
│  │ │  MESSAGE_SENT      │   │ ├─ proxyRequest() → Python   │  │
│  │ │  MESSAGE_RECEIVED  │   │ └─ callSTLLM() 直调主 API    │  │
│  │ │  GENERATE_AFTER_   │   └───────────┬───────────────────┘  │
│  │ │   COMMANDS         │               │ proxy                │
│  │ │  MESSAGE_DELETED   │               │ (19 条路由)          │
│  │ │  MESSAGE_SWIPED    │               │                      │
│  │ │  MESSAGE_UPDATED   │               │                      │
│  │ │  CHAT_CHANGED      │               │                      │
│  │ │                     │               │                      │
│  │ ├─ 4 Tool 注册        │               │                      │
│  │ ├─ 遥测系统 (Phase1-3)│               │                      │
│  │ ├─ 9 状态模板渲染    │               │                      │
│  │ ├─ Vault 面板 UI     │               │                      │
│  │ └─ config.html 3 Tab │               │                      │
│  └──────────┬───────────┘               │                      │
│             │ HTTP fetch                 │                      │
└─────────────┼───────────────────────────┼──────────────────────┘
              │                           │
              ▼                           ▼
     ┌────────────────────────────────────────────────┐
     │       Narrative Engine (Python/FastAPI)          │
     │       http://127.0.0.1:8080                     │
     │                                                  │
     │  ┌────────────────────────────────────────────┐  │
     │  │  API (routes.py + schemas.py)              │  │
     │  │  19 个 POST 端点 + GET /health             │  │
     │  │  模块级全局单例：updater, lookup,          │  │
     │  │    llm_client, secondary_llm_client        │  │
     │  └────────────────────────────────────────────┘  │
     │                                                  │
     │  ┌────────────────────────────────────────────┐  │
     │  │  记忆区 (vault_store.py, 920 LOC)          │  │
     │  │  • 增量更新：LLM 提取 STM →                │  │
     │  │    unconsolidated → 阈值触发 consolidate   │  │
     │  │  • 版本管理：30 个历史快照                  │  │
     │  │  • 去重：跳过已处理的 msg_id               │  │
     │  │  • 8 个 LLM prompt 模板                    │  │
     │  └────────────────────────────────────────────┘  │
     │                                                  │
     │  ┌────────────────────────────────────────────┐  │
     │  │  LLM 客户端 (llm_client.py)                │  │
     │  │  • 从 data/ 扫描 ST settings.json          │  │
     │  │  • 25+ API 后端 (openai/claude/deepseek...)│  │
     │  │  • API Key：secrets.json → env → custom_key│  │
     │  │  • 120s 超时，无流式，无重试               │  │
     │  └────────────────────────────────────────────┘  │
     │                                                  │
     │  ┌────────────────────────────────────────────┐  │
     │  │  Agent 系统                                  │  │
     │  │  GM Agent → 场景分析 + 角色调度             │  │
     │  │  Character Agent → 人设回复(系统指令+状态)  │  │
     │  │  Parallel Engine → asyncio.gather(all)      │  │
     │  └────────────────────────────────────────────┘  │
     └────────────────────────────────────────────────┘
```

### 4.2 关键数据流

**数据流 A：记忆注入（最核心路径）**

```
触发: GENERATE_AFTER_COMMANDS 事件
前端 → POST /memory/vault/read → Python 读取 JSON → 
formatVaultForPrompt() 格式化 →
context.setExtensionPrompt('narrative_memory_vault', formatted, 2, system)
```

**数据流 B：增量记忆更新**

```
触发: 前端队列攒够阈值
前端 → POST /memory/vault/update {chat_id, new_messages} →
Python 对比当前 vault → 调用 LLM 生成增量变更 →
合并到 vault → 版本 +1 → 覆盖保存
```

**数据流 C：Tool-calling 回溯**

```
主 LLM 生成中调用 lookup_memory_source(chat_id, msg_ids)
前端 → POST /memory/lookup {chat_id, msg_ids} →
Python 读取 JSONL 聊天文件 → 返回指定消息
```

### 4.3 状态模型 & API（审阅后修正）

**Vault JSON 完整 Schema**

```json
{
  "chat_id": "string",
  "version": "number (单调递增，每次 update +1)",
  "tokens": "number (估计值)",
  "updated_at": "ISO datetime",
  "content": {
    "summary": "string (顶层摘要，当前未使用)",
    "opening_summary": {
      "text": "string",
      "source_msg_ids": ["number"],
      "updated_at": "ISO datetime"
    },
    "state": { "任意 JSON 键值对，支持点路径更新" },
    "state_template": "auto | dating | rpg | slice_of_life | cultivation | academy | mystery | survBival | political | combat | scifi | workplace",
    "state_css": "string (自定义渲染 CSS，当前未使用)",
    "ltm_entries": [{
      "id": "ltm_N", "period": "max 15 chars",
      "scene": "max 20 chars", "event": "max 100 chars (lltm_max_chars)",
      "stm_refs": ["stm_id"]
    }],
    "stm_entries": [{ "id": "stm_N", "period", "time_label", "scene", "event", "msg_ids", "parent_ltm", "timestamp" }],
    "unconsolidated_stm": [/* 同上结构，待整合 */],
    "current_scene": "string",
    "character_states": { /* 预留，Python 后端未写入 */},
    "relationships": [{ "from", "to", "status", "links": [] }],
    "consolidate_threshold": 5,
    "memory_config": {},
    "language": "zh | en"
  },
  "link_index": { "msg_id": { "chat_id", "role", "summary" } },
  "stm_index": { "stm_id": { "ltm_id", "summary", "msg_ids" } },
  "memory_system_prompt": "string",
  "history": [{ "version", "updated_at", "snapshot": "完整快照副本" }]
}
```

**API 完整清单（桥接层暴露 19 条路由）**

| 路由 | 后端端点 | 用途 | 前端调用方 |
|------|---------|------|-----------|
| `/health` | POST→GET `/health` | 健康检查 | `updateEngineStatus` (30s 轮询) |
| `/memory/vault/read` | POST `…/read` | 读取 vault | `updateVaultViewerPopout`, `recallMemories` |
| `/memory/vault/update` | POST `…/update` | 增量更新（核心） | `saveToShortTermMemory`, consolidate 按钮 |
| `/memory/vault/rollback` | POST `…/rollback` | 按 msg_id 回滚 | debounced rollback |
| `/memory/vault/update-opening` | POST `…/update-opening` | 更新开场摘要 | `saveToShortTermMemory`(auto), `saveVaultEdits`, `update_opening_summary` tool |
| `/memory/vault/update-state` | POST `…/update-state` | 更新状态（点路径） | `saveVaultEdits`, `update_state` tool, clear state, template change |
| `/memory/vault/extract-state` | POST `…/extract-state` | 从角色卡提取状态 | Extract State 按钮, auto path |
| `/memory/vault/init-state` | POST `…/init-state` | 首轮状态初始化 | auto first-turn when no template |
| `/memory/vault/check-narrative` | POST `…/check-narrative` | 叙事价值检查 | (已注册路由但前端未调用) |
| `/memory/vault/history` | POST `…/history` | 历史版本列表 | history toggle |
| `/memory/vault/restore` | POST `…/restore` | 恢复版本 | history restore button |
| `/memory/vault/history-delete` | POST `…/history-delete` | 删除版本快照 | history confirm-delete button |
| `/memory/vault/edit-entries` | POST `…/edit-entries` | 手动编辑条目 | `saveVaultEdits` |
| `/memory/vault/config` | POST `…/config` | 同步记忆参数 | `syncMemoryConfigToBackend` |
| `/memory/lookup` | POST `…/lookup` | 按 msg_id 回溯 | `lookupMemorySource` (Tool) |
| `/memory/stm/lookup` | POST `…/stm/lookup` | 按 stm_id 查详情 | `lookupStmDetails` (Tool) |
| `/gm/analyze` | POST `…/analyze` | GM 场景分析 | `requestGmAnalysis` |
| `/gm/generate` | POST `…/generate` | GM 生成 + 并行角色响应 | (路由已注册，前端未调用) |
| `/gm/consistency` | POST `…/consistency` | 一致性检查 | (路由已注册，前端未调用) |
| `/config/secondary` | POST `…/config/secondary` | 运行时配置副 API | `syncSecondaryApiToBackend` |

---

## 5. 开发日志

### 5.1 活跃条目 — Bug

| # | 标题 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | `addLLMLog` 未受 `enableTelemetry` 开关控制，LLM 日志总是被记录 | P0-紧急 | 待修复 |
| 2 | `formatVaultForPrompt` 章节标题硬编码为中文，不尊重用户 locale | P1-重要 | 待修复 |
| 3 | `applyConfigTranslations` 使用 `localStorage.getItem('language')` 而非 `getContext().getCurrentLocale()`，Vault 面板和设置页可能显示不同语言 | P1-重要 | 待修复 |
| 4 | `loadSettings` 不深合并 `memoryConfig`，partial config 缺失字段不补全默认值 | P1-重要 | 待修复 |
| 5 | `inMemoryUpdate` 守卫阻止并发更新，长时间运行不重试积压消息，静默丢数据 | P1-重要 | 待修复 |
| 6 | EN CONFIG_I18N 缺少 8 个键（3 个开关标签 + 副 API 标题 + 4 个字段标签 + 说明文字） | P2-一般 | 待修复 |
| 7 | `narrativeMemoryStats` 在 `updateVaultViewerPopout` 中更新，telemetry 关闭时不调用 `saveVaultLogs` | P2-一般 | 待修复 |
| 8 | Python 后端 `save_vault` 无原子写入保护（应先写临时文件再 rename） | P2-一般 | 待修复 |
| 9 | Python 后端 CORS `allow_origins=["*"]` + `allow_credentials=True` 不安全 | P3-低优 | 待修复 |
| 10 | Python 后端 `/api/health` 和 `app.get("/health")` 双重定义重复 | P3-低优 | 待修复 |
| 11 | `dragElement` 导入但从未调用，Vault 面板拖拽功能未激活 | P3-低优 | 待修复 |
| 12 | LLM 日志折叠后展开时不自动滚动到底部 | P3-低优 | 待修复 |
| 13 | Python 端 Anthropic URL 检测依赖字符串匹配，自定义 URL 代理时误判 | P3-低优 | 待修复 |
| 14 | `setup-symlinks.ps1` 的 `ErrorActionPreference` 可能阻塞非管理员用户 | P3-低优 | 待修复 |

### 5.2 活跃条目 — TODO

| # | 标题 | 优先级 | 状态 | 所属版本 |
|---|------|--------|------|---------|
| 1 | `getActiveCharacterNames` 已定义从未调用 — 死代码 | P2-一般 | 待移除 | 0.2 |
| 2 | `testVaultToolCall` 已定义未接入任何 UI — 死调试代码 | P2-一般 | 待移除 | 0.2 |
| 3 | `checkAndSummarizeMemory` 是空操作存根，调用但无实际功能 | P2-一般 | 待实现 | 0.2 |
| 4 | `vaultEditData` 声明为 `let` 全局但从未被赋值 — 死变量 | P3-低优 | 待移除 | 0.2 |
| 5 | Python 端 `ChatMessageRequest` / `ChatMessageResponse` Schema 定义但未使用 | P3-低优 | 待移除 | 0.2 |
| 6 | Python 端 `VaultReadResponse` 已定义但端点返回裸 dict，未用 FastAPI 自动校验 | P3-低优 | 待重构 | 0.2 |
| 7 | GM Agent 的场景分析结果未在前端 UI 中展示 | P1-重要 | 待实现 | 0.2 |
| 8 | `parallel_engine.py` 的并行 Agent 执行尚未接入前端事件 | P1-重要 | 待实现 | 0.2 |
| 9 | `character_agent.py` 的 Agent 回复尚未通过桥接层暴露给插件 | P1-重要 | 待实现 | 0.2 |
| 10 | Vault 面板"合并 STM 到 LTM"缺少批量选择条目的 UI | P2-一般 | 待实现 | 0.2 |
| 11 | 前端遥测导出缺少"一键复制到剪贴板"功能 | P2-一般 | 待实现 | 0.2 |
| 12 | Python 端 `llm_client.py` 不支持流式生成 | P2-一般 | 待实现 | 0.2 |
| 13 | Python 端 JSON 解析 LLM 输出时无 markdown 代码块包装处理 | P2-一般 | 待实现 | 0.2 |

### 5.3 活跃条目 — 扩展计划

| # | 标题 | 优先级 | 状态 | 所属版本 |
|---|------|--------|------|---------|
| 1 | 多角色群聊支持（后端已有 `parallel_engine.py`，前端未接入） | P1-重要 | 计划中 | 0.3 |
| 2 | Memory Vault 历史版本对比视图（diff 模式） | P3-低优 | 计划中 | 0.4 |
| 3 | `link_lookup.py` 支持按相似度检索而非仅按 msg_id | P3-低优 | 计划中 | 0.4 |
| 4 | `state_css` 自定义渲染功能（已定义字段但未使用） | P3-低优 | 计划中 | 0.4 |

### 5.4 已解决

#### v0.1 — MVP

| # | 类型 | 标题 | 解决日期 |
|---|------|------|---------|
| 1 | Bug | `narrative.bak/` 目录导致记忆区查看器图标重复 | 2026-05-28 |
| 2 | Bug | `vaultLLMLog` 切换对话不重置（全局残留） | 2026-05-29 |
| 3 | TODO | 实现 per-chat 日志存储（`vaultLogs` + `saveVaultLogs`/`loadVaultLogs`） | 2026-05-29 |
| 4 | TODO | Tool-call 穿透日志（`addToolCall` + 4 Tool 记录点） | 2026-05-29 |
| 5 | TODO | Token 消耗追踪（`recordTokenUsage` 按操作 + 按 API 来源） | 2026-05-29 |
| 6 | TODO | 遥测导出 JSON（`exportTelemetryLogs`） | 2026-05-29 |
| 7 | TODO | 异常信号检测（`addAnomaly`: tool_timeout, rapid_fail_chain） | 2026-05-29 |
| 8 | TODO | 用户干预信号计数（`incSignal`: panel_open, manual_refresh, edit_save, rollback, export） | 2026-05-29 |
| 9 | TODO | LLM 操作日志 API 来源标记（`api_source` 字段） | 2026-05-29 |
| 10 | TODO | 扩展设置面板重构（单层 inline-drawer + 3 Tab） | 2026-05-29 |
| 11 | TODO | 新增 `enableTelemetry` 开关（默认关闭） | 2026-05-29 |
| 12 | TODO | 副 API 环境变量支持（`NARRATIVE_SECONDARY_API_*`） | 2026-05-29 |

---

## 6. 版本路线图（审阅后修正）

| 版本 | 目标 | 核心功能 | 判断指标 |
|------|------|---------|---------|
| **0.1** | MVP 可用 | ✅ 记忆区 CRUD + 增量更新 + 版本管理<br>✅ 4 Tool-calling 工具注册并接入遥测<br>✅ Vault 面板（查看/编辑/历史/版本恢复）<br>✅ 9 种状态模板渲染<br>✅ 遥测 Phase 1-3（Tool-call + Token + 异常 + 用户信号）<br>✅ 3 Tab 设置面板 + `enableTelemetry` 开关<br>⚠️ Agent 系统后端完成，前端未接入 | 记忆可存储/查看/编辑<br>JSON 导出完整 |
| **0.2** | Bug 修复 + Agent 接入 | 🔧 修复 P0-P1 已知 Bug（#1-5）<br>🧹 移除死代码（#15-20）<br>🔌 GM Agent 分析结果前端展示<br>🔌 Character Agent 回复接入事件链<br>🔌 并行引擎接入多角色生成<br>📋 一键复制遥测导出<br>🌊 Python 端 LLM 流式支持 | 15/31 活跃条目解决<br>Agent 回复可见 |
| **0.3** | 多角色群聊 | 群聊模式下多角色记忆分区<br>Agent 知识边界前端展示<br>STM→LTM 批量合并 UI<br>`formatVaultForPrompt` 国际化 | 群聊角色切换不丢失状态 |
| **1.0** | 稳定发布 | 性能优化<br>文档完善<br>用户 onboarding 引导<br>插件市场提交 | 1000 轮对话测试零退化 |

---

## 7. 遥测与迭代

### 7.1 收集的数据

用户开启"测试模式"后，插件记录：

| 类别 | 内容 | 用途 |
|------|------|------|
| **Tool-call 日志** | 每次 Tool 调用（工具名、耗时、成功/失败、结果摘要） | 分析模型是否真的在使用记忆工具 |
| **Token 消耗** | 按操作类型拆分的 Token 用量（extract/consolidate/init），区分主/副 API | 判断插件的 API 消耗是否合理 |
| **异常信号** | 超时调用（>5s）、连续失败链（3 次） | 定位性能瓶颈和检索失败模式 |
| **用户干预** | 面板打开次数、手动编辑/刷新/回滚/导出次数 | 判断用户对自动提取结果的信任度 |
| **系统环境** | 插件版本、ST 版本、模型名、语言 | 跨版本兼容性分析 |

### 7.2 判断标准

| 指标 | 目标值 | 低于目标说明 |
|------|--------|-------------|
| 检索成功率 | > 90% | 记忆区设计有问题 |
| 空结果率 | < 10% | 检索参数或模型输出格式不对 |
| 用户手动编辑率 | < 5% 的 vault 操作 | 自动提取质量够好 |
| Token 开销占比 | < 15% 总 API 消耗 | 插件比记忆带来的价值更贵 |

### 7.3 反馈回路

```
Raw telemetry (JSON) → 开发者人工分析 → 发现模式 →
调整默认参数 / 修改检索策略 / 优化注入格式 →
发布新版本 → 用户更新 → 新 telemetry 对比旧数据
```

---

## 8. 附录

### 8.1 术语表

| 术语 | 说明 |
|------|------|
| **STM** | Short-term Memory，短期记忆，未整合的近期事件 |
| **LTM** | Long-term Memory，长期记忆，已整合的关键事件流 |
| **Vault** | 记忆区，独立 JSON 文件存储的结构化记忆 |
| **GM Agent** | 导演智能体，负责场景分析和角色调度 |
| **Consolidate** | 整合，将 STM 合并到 LTM 的过程 |
| **Tool-calling** | 主 LLM 通过注册的工具函数查询记忆 |
| **Telemetry** | 遥测系统，收集使用数据用于分析 |

### 8.2 项目结构

```
sillytavern-narrative/
├── src/                    — Python 后端 (2,166 LOC)
│   ├── main.py            — FastAPI 入口
│   ├── config.py          — 配置常量
│   ├── llm_client.py      — LLM 调用封装
│   ├── api/routes.py      — 11 条 REST API
│   ├── api/schemas.py     — Pydantic 模型
│   ├── memory/vault_store.py — 记忆区核心 (920 LOC)
│   ├── memory/link_lookup.py — 超链接回溯
│   └── agents/*           — Agent 系统
├── bridge/                — Node.js 桥接插件
├── extension/narrative/   — 前端发行版（符号链接同步）
├── pyproject.toml         — Python 项目配置
└── README.md
```

### 8.3 技术栈

| 层 | 技术 | 版本 |
|---|------|------|
| 后端框架 | FastAPI | >=0.100 |
| 运行时 | Python | >=3.11 |
| LLM 调用 | httpx | >=0.25 |
| 前端 | Vanilla JS (jQuery) | — |
| 桥接 | Node.js (Express) | — |
| 持久化 | JSON 文件 | — |
