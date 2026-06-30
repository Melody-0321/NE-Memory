# ne-memory 横向对比分析与改进建议

> 基于对 6 个 SIL (AIRP) 记忆插件项目的 CODE_WIKI 对比分析
>
> 分析对象：ne-memory | st-bme | shujuku | anima | st-memory-enhancement | ST-BaiBai-Book
> 分析日期：2026-06-28（初版），2026-06-30（增补 ST-BaiBai-Book v0.7）

---

## 目录

1. [六项目概览](#1-六项目概览)
2. [维度一：记忆模型与数据结构](#2-维度一记忆模型与数据结构)
3. [维度二：记忆写入/提取机制](#3-维度二记忆写入提取机制)
4. [维度三：检索/召回机制](#4-维度三检索召回机制)
5. [维度四：架构设计与分层质量](#5-维度四架构设计与分层质量)
6. [维度五：持久化与存储策略](#6-维度五持久化与存储策略)
7. [维度六：上下文注入策略](#7-维度六上下文注入策略)
8. [维度七：特色创新/独特能力](#8-维度七特色创新独特能力)
9. [维度八：测试与质量保证](#9-维度八测试与质量保证)
10. [维度九：技术栈与构建体系](#10-维度九技术栈与构建体系)
11. [维度十：用户界面与交互体验](#11-维度十用户界面与交互体验)
12. [综合总结与横向洞察](#12-综合总结与横向洞察)
13. [ne-memory 可借鉴项（按优先级）](#13-ne-memory-可借鉴项按优先级)
14. [对比分析对 ne-memory 的深层启发](#14-对比分析对-ne-memory-的深层启发)

---

## 1. 六项目概览

| # | 项目 | 核心范式 | 记忆表示 | 运行环境 |
|---|------|---------|---------|---------|
| 1 | **ne-memory** | 叙事弧线引擎 | STM→LTM 分层事件 + State Schema 状态 | 浏览器 (TH + ST) |
| 2 | **st-bme** | 记忆图谱生态 | 图数据库 (8种节点 + 8种关系) | 浏览器 (ST扩展) |
| 3 | **shujuku** | 结构化数据库 | SQL/JSON 表格 | 浏览器 (油猴/ST扩展) |
| 4 | **anima** | 记忆系统扩展 | 向量化切片 + Echo 回响 | 浏览器 + Node.js 后端 |
| 5 | **st-memory-enhancement** | 增强表格插件 | 电子表格 (hashSheet + Cell) | 浏览器 (ST扩展) |
| 6 | **ST-BaiBai-Book (柏宝书)** | 混合记忆归档 | 叶子摘要 + 压缩森林 + 派生结构化状态 | 浏览器 (ST扩展) |

---

## 2. 维度一：记忆模型与数据结构

### 2.1 各项目数据模型

**ne-memory**：STM Entry（短期事件条目）→ LTM Entry（长期叙事弧线），配合嵌套 State Schema。

- STM：`{ id, event(20-80字), period, scene, status(closed|partial), entity, entities[{name,type}], parent_ltm }`
- LTM：`{ id, title, event, scene, time_range, status(open|closed), stm_refs }`
- State：字段级 `max_length` / `enum` 约束的嵌套对象（characters, factions, quests），dot-path 深度合并

**st-bme**：知识图谱，8 种节点类型 + 8 种关系类型。

- 节点类型：`event, character, location, rule, thread, synopsis, reflection, pov_memory`
- 关系类型：`related, involved_in, occurred_at, advances, updates, contradicts(抑制边), evolves, temporal_update`
- 边不物理删除，标记 `validAt / invalidAt / expiredAt`（Graphiti 时序边模型）
- 同类型节点维护 `prevId/nextId` 版本演化链
- POV 归属系统：角色主观 / 用户视角 / 客观世界

**shujuku**：数据库行/列，由用户通过模板定义表格结构，支持原生 JSON 和 SQLite WASM 双存储模式。

- 8 张默认表格模板（角色属性、背包、任务等）
- V2 存储帧：Mutation Log + Checkpoint + Write Transaction
- 支持按隔离码分组的数据隔离

**anima**：带标签的向量化文本切片（`Float32Array(4096)`），Echo 生命周期管理。

- 向量条目：`{ id, vector, metadata: { text, tags, index, batch_id, timestamp } }`
- BM25 索引：并行维护独立 JSON 索引
- Echo 会话：`{ memories: { id: { life, maxLife, item, score } } }`

**st-memory-enhancement**：hashSheet 二维 UID 数组索引下的 Cell 实例。

- CellType：`sheet_origin, column_header, row_header, cell`
- CellAction：`editCell, insertLeftColumn, insertRightColumn, insertUpRow, insertDownRow, deleteSelfColumn, deleteSelfRow, clearSheet`
- 不可变设计：编辑通过追加新 Cell 到 `cellHistory` 实现

**ST-BaiBai-Book**：混合两层存储——叶子摘要挂在消息 `extra.bbs_leaf` 上，压缩节点存在 `chat_metadata.baibai_book.summaries` 森林中。结构化状态（物品/场景/NPC/计划）**完全是派生产物**，从叶子 delta 按楼层顺序重放（fold）计算得出。

- 叶子（LeafExtra）：`{ id, text, delta(StoredDelta), timeStart, timeEnd, swipe, createdAt }` — 随消息 swipe 自动跟随、随 chat 文件持久化
- 压缩节点（MemSummary）：`{ id, text, level(1/2/3…), childIds, createdAt, auto }` — 扁平数组 + childIds 表达森林
- 派生状态（不持久化）：
  - `MemState`：`{ time, location, locationPath }` — 覆盖型当前时间/地点
  - `MemItem`：`{ id, name, desc, qty, carried, location }` — 物品清单，确定性 id
  - `MemScene`：`{ id, name, path[], parentId, desc }` — 地点嵌套树，确定性 id
  - `MemNpc`：`{ id, name, title, desc, personality, outfit, condition, important, follow, location }` — 档案层 + 即时层双字段设计
  - `MemPlan`：`{ id, kind(plan|suspense), content, status(open|resolved) }` — 计划/悬念
- 增量 delta（StoredDelta）：add/update/remove 在 items/scenes/npcs 上 + plans 的 add/resolve/reopen/remove + 覆盖型 time/location

### 2.2 对比总结

| 比较维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh | ST-BaiBai-Book |
|----------|-----------|--------|---------|-------|-------------|----------------|
| 记忆单元 | 事件条目+状态字段 | 图谱节点+边关系 | 数据库行/列 | 向量化切片 | 电子表格单元格 | 叶子摘要+压缩森林 |
| 结构维度 | 2维(事件+状态) | 多维(图谱拓扑) | N维(N张表) | 1维(时间线) | 2维(行列矩阵) | 2维(叙事+结构化) |
| 演化支持 | STM→LTM弧线聚合 | 节点版本链+时序边 | 增量日志+Checkpoint | Echo生命周期 | cellHistory不可变追加 | 层级压缩(L0→L1→L2…) |
| 关系建模 | parent_ltm引用链 | 8种显式关系类型 | 无关系建模 | 标签关联 | 行列位置隐含关系 | 派生重放(确定性id隐式关联) |
| Schema约束 | 字段级enum/max_length | 8种节点类型定义 | 表格模板定义 | 无Schema | CellType枚举 | TypeScript接口强类型 |
| 压缩/遗忘 | LTM闭合+批量整合 | 层级压缩+睡眠遗忘 | 存储帧快照 | Echo生命衰减 | cellHistory只增不减 | 坏链剪枝+压缩森林 |

---

## 3. 维度二：记忆写入/提取机制

### 3.1 触发策略

| 项目 | 触发方式 | 粒度 | 特点 |
|------|---------|------|------|
| ne-memory | 阈值触发(stmBatch) | 多轮批量 | 缓冲区积累 → Pipeline三阶段串行；非阈值轮轻量State提取；stmBatch自动调参 |
| st-bme | 逐轮自动 + 智能触发 | 逐轮全量 | `GENERATION_AFTER_COMMANDS` → 提取计划判定 → 双阶段(客观+主观)提交 |
| shujuku | 阈值 + Agent决策 | 可配置 | AI消息数达autoUpdateThreshold → 填表；Agent决定剧情推进触发 |
| anima | 逐轮 + 间隔批量 | 逐轮/间隔 | `generation_ended` → 状态更新；总结按间隔触发；开场白切换匹配 |
| st-memo-enh | 逐轮标签解析 | 逐轮 | `CHARACTER_MESSAGE_RENDERED` → 解析 `<tableEdit>` XML 标签 |
| ST-BaiBai-Book | 逐轮自动 + 生成前拦截 | 逐轮 | 用户发消息 → 摘上一条AI；生成前检查积压洞，拦截旧楼层无摘要的生成 |

### 3.2 重复处理防护

| 项目 | 防护机制 |
|------|---------|
| ne-memory | `filterNewMessages(messages, processedIds)` — msg_id去重，每条消息最多处理一次 |
| st-bme | 批次追踪：楼层 hash + `chat-history.js` |
| shujuku | `table-update-commit.ts` 维护更新提交状态 |
| anima | 未在 CODE_WIKI 中明确说明 |
| st-memo-enh | `isTableEditStrChanged()` 去重检查 |
| ST-BaiBai-Book | 叶子 swipe 归属检查：`leaf.swipe !== message.swipe_id` 识别翻页串页 → 标记陈旧；逐层守护「除最后一条AI外其余都必须有摘要」不变式 |

---

## 4. 维度三：检索/召回机制

### 4.1 检索管线对比

**ne-memory — SmartPush**（5 阶段）：

```
BM25 检索 → 实体链查询 → 模糊引用解析 → 管道合并 → LLM 合成
```

- `mergePipelines` 将 BM25 结果与实体链融合，短链（≤5条）内联处理
- 备选：未启用 SmartPush 时用 `formatContextMemory()` 按 `contextWindowRounds` 构建摘要

**st-bme — 混合检索**（13 阶段）：

```
控制器门禁 → 持久召回检查 → 权威候选预筛 → 向量预筛(多意图) → PEDSA图扩散
→ 混合评分(图+向量+词法+重要度×时间衰减) → 认知边界过滤 → 残差召回
→ DPP多样性采样 → LLM精排(可选) → 访问强化 → 注入格式化
```

- 关键参数：`topK=20, maxRecallNodes=8, diffusionTopK=100, diffusionSteps=2, decayFactor=0.6`
- 混合评分公式：`(normGraph×0.6 + normVec×0.3 + normLexical×0.18 + normImportance×0.1) / total × TimeDecay`

**shujuku**：世界书注入（利用 ST 原生世界书触发机制）+ 交火索引（BM25 + RRF 混合检索）

**anima**：双轨检索（向量语义 + BM25 关键词并发，后端合并排序）+ 分布式策略（基础→重要→状态→周期→节日→多样性共 6 步分步检索）

**st-memory-enhancement**：格式化注入（`sheet.getTableText()` → 纯文本 → prompt 拼接）

**ST-BaiBai-Book — 注入即召回**：不设独立检索阶段。记忆通过 `setExtensionPrompt` 三个槽位（历史摘要 + 当前状态 + 时间标签提示词）常驻主对话上下文。历史摘要由森林节点选择算法（`selectViewNodes`）自动选最高完好层级的压缩节点代表。向量召回是可选附加，在生成前触发：`embedding → vecSearch → rerank(可选) → 分档(全文/摘要) → 注入Recall槽位`。

### 4.2 对比总结

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh | ST-BaiBai-Book |
|------|-----------|--------|---------|-------|-------------|----------------|
| 检索技术 | BM25 + LLM合成 | 向量+图扩散+DPP+LLM精排 | 世界书触发 | 向量+BM25双轨 | 格式化注入 | 注入即召回(常驻) + 可选向量 |
| 管线复杂度 | 5阶段 | 13阶段 | 2层面 | 后端合并 | 1阶段 | 1阶段(常驻注入) / 5-6阶段(向量) |
| 语义搜索 | 通过LLM工具调用 | ✅ 向量预筛 | 部分(交火索引) | ✅ 向量检索 | ❌ | ✅ 可选向量(embedding+rerank) |
| 图/关系探索 | 实体链查询 | ✅ PEDSA扩散 | ❌ | ❌ | ❌ | 确定性id隐式关联 |
| 多样性保障 | ❌ | ✅ DPP采样 | ❌ | ✅ 分步策略 | ❌ | ❌ |
| 记忆遗忘 | ❌ | ✅ 层级压缩+睡眠 | ❌ | ✅ Echo生命衰减 | ❌ | ✅ 坏链剪枝+压缩层级降级 |

---

## 5. 维度四：架构设计与分层质量

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh | ST-BaiBai-Book |
|------|-----------|--------|---------|-------|-------------|----------------|
| 核心范式 | 适配器+DI | 控制面/数据面分离 | 严格三层 | 前后端分离 | Proxy响应式 | 派生式(纯函数fold) |
| 分层约束 | 适配层↔核心层 | 控制面↔数据面 | 4层+合规检查 | 前后端 | 6命名空间 | 清晰(src/memory → src/api → src/st) |
| 平台解耦 | runtime接口+external | runtime注入 | gateway模式 | 后端独立 | 紧密耦合 | 桥接层(src/st/),依赖最少 |
| 架构检查 | 无 | 无 | 自动化检查(构建时) | 无 | 无 | 无 |
| 重构记录 | 无 | 无 | 三轮重构 | 无 | 无 | v1→v2→v3三次记忆版本迁移 |
| 类型系统 | JSDoc部分 | 无 | TypeScript完整 | 部分d.ts | 无 | ✅ TypeScript完整 |

---

## 6. 维度五：持久化与存储策略

| 项目 | 存储介质 | 特点 |
|------|---------|------|
| ne-memory | IndexedDB(`ne_memory_vaults` v3) + localStorage(设置/遥测) + chat_metadata(冗余) + localStorage(崩溃恢复暂存) | 多层冗余，快照≤30个自动裁剪 |
| st-bme | Authority SQL / Luker / IndexedDB / OPFS / Blob / Trivium 六层 | 最复杂分层；快照顶层六键冻结契约 |
| shujuku | 聊天消息JSON字段(`TavernDB_ACU_*`) + SQLite WASM | 双模式互备；V2存储帧(Mutation Log+Checkpoint) |
| anima | Vectra文件(`vectors/`) + BM25 JSON(`data/bm25_indexes/`) + Echo会话(`data/sessions/`) | 后端本地文件，无冗余 |
| st-memo-enh | `power_user.muyoo_dataTable` + `chatMetadata.sheets` + `chat[i].hash_sheets` | 完全依赖酒馆原生存储 |
| ST-BaiBai-Book | 消息 `extra.bbs_leaf`（叶子摘要，随chat文件持久化）+ `chat_metadata.baibai_book.summaries`（压缩森林）+ `extension_settings`（配置跨设备同步） | 叶子随swipe自动跟随/在消息上「自然」出没；压缩节点手动持久化；配置跨设备同步；向量库可选（需后端柏宝库） |

---

## 7. 维度六：上下文注入策略

| 项目 | 注入内容 | 注入方式 | 注入位置 |
|------|---------|---------|---------|
| ne-memory | LLM合成的叙事文本 | SmartPush(LLM合成) + ContextWindow(窗口前摘要) | 双模式可切换 |
| st-bme | 按POV/区域分桶的结构化表格 | `injector.js` 分桶：Summary/Core/Recalled/POV/Objective | prompt 注入 |
| shujuku | 世界书条目 + 深度注入提示词 | 世界书条目机制 + 表格推送 | system/user/chat |
| anima | 世界书容器注入 | `[ANIMA_RAG_Container]` + `[ANIMA_Knowledge_Container]` | 世界书 |
| st-memo-enh | 表格文本(纯数据/含规则) | `{{macro::tablePrompt}}` / `{{macro::tableData}}` | 3位置(system/user/assistant) |
| ST-BaiBai-Book | 历史叙事摘要 + 当前结构化状态 + 时间标签提示词 | `setExtensionPrompt` 三个槽位（HISTORY/STATE/TIMETAG），持久化常驻 | 全部 inChat=1, position='before'；摘要深度9999(聊天顶部)，状态D1/D2(贴近最近对话)，时间标签D0(最底) |

**关键设计差异**：ST-BaiBai-Book 的注入是**持久化常驻**的——`setExtensionPrompt` 一次设置后每次生成自动带上，记忆变了才刷新。ne-memory 的 SmartPush 每次生成前按需检索合成，是**响应式按需**注入。两种哲学各有优劣。

---

## 8. 维度七：特色创新/独特能力

每个项目至少有一个在另外五个中找不到对等物的独特机制：

| 项目 | 独特能力 | 说明 |
|------|---------|------|
| ne-memory | **事实矛盾检测** | AI回复后 LLM 提取主张 → BM25 验证 → confidence≥0.6 触发重新生成 |
| ne-memory | **自动调参系统** | `computeStmBatch/TopK/ChainDepth` 基于遥测数据动态调整 |
| st-bme | **PEDSA图扩散 + 抑制边** | 种子节点沿边传播激活能量；`contradicts`(edgeType=255)反向传播负能量 |
| st-bme | **层级压缩金字塔** | synopsis(80-220字) → summary_rollup(120-260字)多级折叠 |
| st-bme | **Native/WASM加速** | Rust→WASM用于图谱布局和持久化，fail-open 回退 JS |
| shujuku | **模板变量引擎** | `{random}`, `{calc}`, `{[db]}`, `{[sql]}`, `{if}` 微型 DSL |
| shujuku | **Loop自动续写** | AI 自动循环续写，不等待用户输入 |
| shujuku | **Agent决策引擎** | LLM 决定何时触发填表/剧情推进 |
| anima | **Echo记忆回响** | 命中满血复活 → 未命中递减 → 脱离遗忘（缓存淘汰风格的生命周期） |
| anima | **分布式检索策略** | 6步分步检索（基础→重要→状态→周期→节日→多样性），每步独立配比 |
| anima | **Zod Schema校验** | 成熟库替代自建校验，支持 UI 配置+Script 双通道 |
| st-memo-enh | **tableEdit XML标签协议** | AI 通过 `<tableEdit>editRow(...)</tableEdit>` 表达编辑意图，兼容任何 LLM |
| st-memo-enh | **Cell不可变追加设计** | 编辑不修改原 Cell，追加到 cellHistory，天然支持撤销/重做 |
| **ST-BaiBai-Book** | **派生状态重放** | 物品/场景/NPC/计划全部从叶子delta按楼层顺序fold算出，不持久化。删叶子/陈旧→派生自动回退，无需维护最终一致性 |
| **ST-BaiBai-Book** | **故事内时间标签协议** | AI 通过 `<bbs_start>`/`<bbs_end>` 在正文中自主标注故事内时间轴；插件解析→注入，让主模型感知时间流逝 |
| **ST-BaiBai-Book** | **生成拦截 + 积压保护** | 每次生成前检查「除最后一条AI外其余都必须有摘要」的不变式，有洞则 abort 生成 + 插提示楼 |
| **ST-BaiBai-Book** | **副 API 渠道系统** | 摘要/总结/向量可用独立于主聊天 API 的专用渠道，每个独立配置 url/key/model/temperature |
| **ST-BaiBai-Book** | **确定性 id 系统** | 物品=`item:${规范化名}`，NPC=`npc:${规范化名}`，场景=`scene:${规范化路径}`，重放幂等、手动操作可稳定引用 |
| **ST-BaiBai-Book** | **NPC 档案+即时状态双字段** | 身份/外貌/性格（档案层，高门槛、几乎不变）与着装/状态（即时层，覆盖型、鼓励跟着剧情刷新）分离设计 |
| **ST-BaiBai-Book** | **森林节点选择算法** | 为每条已启用的叶子选最高完好压缩节点代表它，不完好则降级递归到叶子。确保注入时既省 token 又不丢失叙事连贯性 |
| **ST-BaiBai-Book** | **Shadow DOM UI 隔离** | Vue 3 应用完全活在 shadow root 内，样式与 ST 全局样式完全隔离 |

---

## 9. 维度八：测试与质量保证

| 指标 | shujuku | st-bme | ne-memory | anima | st-memo-enh | ST-BaiBai-Book |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 测试文件数 | 176 | 70+ | ~7(单元) + 30+(LLM集成) | 基本 | 调试工具 | 0 |
| 测试用例数 | 538 | ~70+ | ~37 | 未公开 | 无 | 0 |
| 测试框架 | Vitest 3.2.4 | 自建(裸Node子进程) | 自建+LLM断言 | 无公开 | 无 | 无 |
| 模拟环境 | jsdom 29 | fake-indexeddb 6.2 | mock-runtime.js | 无公开 | 无 | 无 |
| CI/CD | 无 | ✅ GitHub Actions | 无 | 无 | 无 | 无 |

ne-memory 的 LLM 驱动语义性断言（三态：passed=true/false/null）是独特创新，但依赖实时 LLM 资源无法在 CI 中自动化。

ST-BaiBai-Book 当前无单元测试，但依赖 TypeScript 编译时类型检查来保障基础安全性——这在六项目中是唯一仅靠类型系统保质量的路径。

---

## 10. 维度九：技术栈与构建体系

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh | ST-BaiBai-Book |
|------|-----------|--------|---------|-------|-------------|----------------|
| 主语言 | JavaScript | JavaScript | TypeScript 5.7 | JavaScript | JavaScript | **TypeScript 5.7** |
| 类型覆盖 | JSDoc部分 | 无 | 100% | 部分d.ts | 极少量 | **100%** |
| 构建工具 | Rollup 4.60 + Babel | 无构建 | Rollup 4.28 + tsc/Vue | 无构建 | 无构建 | **Vite 7.3 + vue-tsc** |
| 输出格式 | IIFE (`NEMemoryEngine`) | ES Module 直出 | 多目标(IIFE/ESM) | ES Module 直出 | ES Module 直出 | ES Module |
| 运行时依赖(数量) | 1 | 1 | 3(sql.js+pinia+vue) | 7(后端) | 0 | **1 (Vue 3)** |

---

## 11. 维度十：用户界面与交互体验

| 项目 | UI 技术 | 主要界面 | 复杂度 |
|------|---------|---------|:---:|
| st-bme | 自绘 Canvas 2D + jQuery | 力导向图谱 + 设置面板 | ★★★★★ |
| shujuku | Vue 3 SFC + jQuery 双轨 | 13 页面仪表板 + 可视化编辑器 | ★★★★★ |
| ne-memory | jQuery | Memory Vault 面板 + 设置弹窗 | ★★★ |
| anima | jQuery | 7 标签页面板 + 正则 UI | ★★★ |
| st-memo-enh | jQuery + HTML 模板 | 表格编辑器 + 设置面板 | ★★☆ |
| **ST-BaiBai-Book** | **Vue 3 SFC + Shadow DOM** | **5 标签页 + 悬浮球 + 顶栏/快速回复按钮** | ★★★★ |

独特 UI 能力：
- **st-bme**：零依赖 Canvas 力导向布局 + Web Worker，自适应策略（<220节点→120次迭代，>520→静态）
- **shujuku**：自建 Acu* 组件库（24个组件）+ 自定义 Vue 渲染器（iframe 兼容）
- **ST-BaiBai-Book**：Shadow DOM 样式完全隔离（不依赖 ST 全局样式、也不污染 ST）；内联 SVG 图标库（`Icon.vue`）不依赖字体；悬浮球（FloatingOrb）自由拖动+贴边吸附+自定义图片；5 页面系统含响应式移动端适配

---

## 12. 综合总结与横向洞察

### 12.1 设计谱系

```
st-memo-enh ─── anima ─── ne-memory ─── shujuku ─── st-bme
  (极简表)     (向量系统)  (叙事引擎)   (数据库)    (知识图谱)

                             ST-BaiBai-Book
                          (混合记忆归档)
                         ↑ 接近 ne-memory 的叙事线,
                         但有自己独特的「派生式」哲学
```

### 12.2 成本结构

| 成本维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh | ST-BaiBai-Book |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| LLM Token 成本 | 高(提取+合成+检索) | 极高(双阶段+后处理链) | 高(填表+剧情) | 中(状态更新+总结) | 低(仅格式化) | 中(摘要每楼+总结按阈值) |
| Embedding 成本 | 可选 | ✅ 必选 | 可选 | ✅ 必选 | ❌ | 可选(需后端柏宝库) |
| 存储成本 | 中(IndexedDB) | 极高(6层存储) | 中(SQLite/JSON) | 高(向量+BM25+Echo) | 低(酒馆原生) | 低(消息extra+metadata) |
| 用户配置成本 | 高(多API+参数) | 极高(10种任务预设) | 高(模板+规则) | 高(4套API) | 低(6张表) | 中(副API渠道+向量参数) |

### 12.3 模块间借鉴痕迹

- **st-bme** 明确标注了学术论文启发链：Graphiti（时序边）、PeroCore（PEDSA扩散）、Mem0（冲突检测）、A-MEM（记忆进化）、RoleRAG（认知边界）、AriGraph（残差召回）
- **ne-memory** 的 BM25 参数 `K1=1.2, B=0.75` 为标准信息检索参数
- **ST-BaiBai-Book** 的重放派生模型（fold over chat）接近函数式编程中的「状态归约器」(reducer)，其叶子陈旧判定（swipe 页码不匹配）和 ne-memory 的 msg_id 去重属同源设计思路

### 12.4 已知局限记录

| 项目 | 局限记录数 | 关键局限 |
|------|:---:|------|
| st-bme | 8条 | 记忆质量依赖LLM、Embedding决定召回下限、历史恢复优先正确性可能慢 |
| ne-memory | 0条 | — |
| ST-BaiBai-Book | 0条 | — |
| 其余三项 | 0条 | — |

---

## 13. ne-memory 可借鉴项（按优先级）

### P0 — 应立即考虑

#### 13.1 认知边界过滤 (POV)

- **来源**：st-bme（`memory-scope.js` / `knowledge-state.js`，RoleRAG 启发）
- **现状**：ne-memory 检索时所有记忆一视同仁，不区分角色的可见性
- **改进**：扩展 STM/LTM Entry 增加 `pov` 字段；State Schema 增加 `known_facts`；SmartPush 检索时加过滤层
- **可行性**：Schema 扩展 + 现有 pipeline 不变 + 已有 `entities[{name,type}]` 基础设施
- **预估工作量**：小

#### 13.2 已知局限文档

- **来源**：st-bme（CODE_WIKI §11）
- **现状**：ne-memory 的 CODE_WIKI 中没有显式列出 known limitations
- **改进**：编写 LIMITATIONS.md 或 CODE_WIKI 补充章节
- **预估工作量**：极小

### P1 — 高价值中等投入

#### 13.3 多样性采样 (DPP 简化版)

- **来源**：st-bme（DPP Determinantal Point Process + 残差召回）
- **现状**：SmartPush 检索无显式多样性保障，可能出现结果同质化
- **改进**：在 `mergePipelines` 后、LLM 合成前插入多样性采样；利用已有 `entities[].type` 字段作为多样性维度标签
- **预估工作量**：中

#### 13.4 记忆生命周期/遗忘

- **来源**：st-bme（`sleepCycle` / 层级压缩）+ anima（Echo 回响）
- **现状**：STM/LTM 条目只增不减（除手动回滚）；LTM 可闭合但不会遗忘；超长对话 vault 持续膨胀
- **改进**：为 LTM 增加 `retention_score` + `last_accessed_at`；SmartPush 命中后增加 score；总量超阈值时归档低分条目
- **预估工作量**：中

#### 13.5 Echo 式检索连贯性

- **来源**：anima（Echo 回响系统）
- **现状**：每次 SmartPush 检索独立，不记忆上一轮召回结果
- **改进**：在 `RetrievalNotebook` 类中增加 `echoMap`；命中条目获得 `recent_boost` 权重；连续未命中衰减
- **可行性**：`RetrievalNotebook` 设计天然适合承载——已维护跨轮次状态（`map`, `threadIndex`, `diff()`）
- **预估工作量**：小

#### 13.6 架构合规检查自动化

- **来源**：shujuku（`scripts/check-arch.mjs`，构建时自动执行）
- **现状**：核心不变量 `adapter/ → core/` 单向依赖完全靠手工维护
- **改进**：写检查脚本，扫描 `core/` 下所有 import，确保无 `adapter/` 或 `ui/` 引用；集成到 `npm run build`
- **预估工作量**：小

#### 13.7 派生状态重放 (Derive/Replay)

- **来源**：**ST-BaiBai-Book**（`apply.ts` — `deriveMemory()` 重放引擎）
- **现状**：ne-memory 的 State Schema 是「直接持久化再读取」模式——pipeline 阶段写入、注入时读取，不存在二次计算路径
- **改进**：探索将 State Schema 的部分字段（如 quests 状态）改为派生计算——从 STM/LTM 事件链重放得出，而非直接存储值。例如「任务完成」事件自动更新 quests.status，而不是由 LLM 写入最终值
- **可行性**：已有 STM→LTM 事件链基础设施；重放顺序即楼层物理顺序；但需要区分「事件的顺序依赖」和「状态的覆盖语义」
- **预估工作量**：中到大（架构性变化，需谨慎设计）

#### 13.8 生成拦截 + 积压保护

- **来源**：**ST-BaiBai-Book**（`engine.ts` — `handleGenerationIntercept()`）
- **现状**：ne-memory 的 pipeline 在生成后触发（`GENERATION_AFTER_COMMANDS`/`MESSAGE_SWIPED`），不干预生成本身。如果 pipeline 积压（正在处理上一批），新生成继续产生更多消息，pipeline 永远追不上
- **改进**：增加轻量生成前检查——检测 pipeline 是否处于 `busy` 状态且有未处理消息积压，如果积压超过阈值则暂缓生成
- **可行性**：Pipeline Guard 已有状态机（`idle/stm/state/ltm`），可暴露 `isBusy()` 接口。但需要处理 abort 的 UX（用户需要看到提示）
- **预估工作量**：小

#### 13.9 副 API 渠道系统

- **来源**：**ST-BaiBai-Book**（`api/settings.ts` — `ApiChannel` + `TaskType` 指派）
- **现状**：ne-memory 的所有 LLM 调用（事件提取、State 提取、SmartPush 合成）走同一个主聊天 API，无法分流
- **改进**：允许用户为「摘要提取」「SmartPush 合成」「矛盾检测」分别指定不同的 API 端点/模型，支持低成本模型做提取、高质量模型做合成
- **可行性**：ne-memory 的 `llm.js` 已有 `callAPI()` 封装，只需扩展路由层
- **预估工作量**：小到中

### P2 — 中长期投入

#### 13.10 TypeScript 渐进迁移

- **来源**：shujuku（TypeScript 全量，tsc 0 ERROR）+ **ST-BaiBai-Book**（TypeScript 全量，vue-tsc 模板检查）
- **现状**：纯 JavaScript + JSDoc，缺乏编译时类型检查
- **改进**：扩展 `globals.d.ts` → 从 `vault/schema.js` 和 `vault/store.js` 开始迁移 → 使用 `allowJs + checkJs` 逐步收紧
- **预估工作量**：大

#### 13.11 Zod 替换自建校验

- **来源**：anima（`status_zod.js`）
- **现状**：`validate.js`（自建 STM/LTM 校验）+ `schema.js`（自建 State 字段校验）
- **改进**：用 Zod Schema 表达式替换自建校验逻辑；减少自维护代码；提升 LLM 输出验证可靠性
- **预估工作量**：中

#### 13.12 Agent 决策增强

- **来源**：shujuku（`agent-decision-engine.ts`）
- **现状**：pipeline 触发完全依赖 `stmBatch` 硬编码阈值
- **改进**：保留 stmBatch 作为硬上限，在批次内让 LLM 判断"这段对话中有值得提取的事件吗？"；可看作 `bm25-grouper.js`（BM25 预分组）的自然延伸
- **预估工作量**：中

#### 13.13 故事内时间轴标签

- **来源**：**ST-BaiBai-Book**（`timeTag.ts` — `<bbs_start>`/`<bbs_end>` 协议）
- **现状**：ne-memory 的 STM Entry 有 `period` 字段，但这个值由 LLM 在提取时推断，没有主模型在正文中的时间标注作为依据
- **改进**：设计一个轻量时间标签方案（不一定是 HTML 标签，也可以是 prompt 指令），让主模型在 AI 回复中嵌入故事内时间信息。ne-memory 的 pipeline 可在提取时解析这些标签，取代 LLM 对 `period` 的猜测
- **可行性**：协议层简单（一个 ST 隐藏正则 + 一个解析函数即可），但需要确保 prompt 中指令的清晰度和模型的遵循率
- **预估工作量**：小

#### 13.14 NPC 档案/即时状态双字段

- **来源**：**ST-BaiBai-Book**（`types.ts` — MemNpc 的 desc/personality 档案层与 outfit/condition 即时层分离）
- **现状**：ne-memory 的 State Schema 中 characters 没有区分「固定特征」和「当前状态」，LLM 每次可能重写整个角色块
- **改进**：在 State Schema 的 character 对象中增加 `outfit`, `condition` 等即时字段，和 `appearance`, `personality` 等档案字段分离。注入时档案层只发一次，即时层每次刷新
- **可行性**：Schema 扩展即可，不改变 pipeline 流程
- **预估工作量**：小

### P3 — 长期愿景

#### 13.15 图扩散启发的关系检索

- **来源**：st-bme（PEDSA 扩散算法）
- **现状**：已有 `lookupEntityChains` 但未充分集成到 SmartPush
- **改进**：BM25 top-3 结果中发现高频实体时，自动触发链查询，将链上条目纳入 LLM 合成候选池
- **预估工作量**：大

#### 13.16 gpt-tokenizer 去依赖化

- **来源**：st-memory-enhancement（零 npm 运行时依赖的设计哲学）
- **现状**：唯一运行时依赖是 `gpt-tokenizer ^3.4.0`
- **改进**：评估 CJK-aware Token 估算的自研替代可行性（±10% 误差是否可接受）
- **预估工作量**：小

#### 13.17 Shadow DOM UI 隔离

- **来源**：**ST-BaiBai-Book**（`index.ts` — Shadow DOM + `<link>` CSS 注入）
- **现状**：ne-memory 的 UI（panel.js）直接操作 ST 的 DOM 元素，使用 ST 的全局 CSS 类名（`.menu_button`, `.list-group`），样式受 ST 主题影响
- **改进**：将 Vault Panel 迁移到 Shadow DOM 或 `style scoped` 方案，减少与 ST 的样式耦合
- **预估工作量**：大（涉及所有 panel-*.js 文件）

---

## 14. 对比分析对 ne-memory 的深层启发

### 启发一：「事件 + 状态」双轨是未被充分利用的核心优势

纵观六项目：
- st-bme 有图谱（关系强，但不知"故事进行到哪了"）
- shujuku 有表格（数据强，但不理解叙事弧线）
- anima 有向量（语义强，但无结构）
- st-memo-enh 有单元格（操作强，但无上下文理解）
- ST-BaiBai-Book 有叙事摘要 + 派生状态（摘要强，但事件与状态是因果关系——事件产生状态，而非两个独立轨道）

**ne-memory 是唯一同时拥有"叙事事件流"（STM→LTM）和"结构化世界状态"（State Schema）的项目，并且这两者是作为两条独立的、并行的轨道存在于同一 pipeline 中的。**

但目前两轨交互有限：State 提取和 STM 提取在 pipeline 中是两个独立阶段，仅在 `buildStateOnlyInjection` 中作回退合并。

→ **应深耕双轨协同**：让事件检索感知状态变化（如"角色受伤"状态提升相关事件检索权重），让状态更新参考事件上下文（如"任务完成"事件自动更新 quests 状态）。

### 启发二：矛盾检测应从「防御」转为「进攻」

ne-memory 的矛盾检测是六项目中独一无二的能力。但目前定位是"检测到矛盾就触发 LLM 重新生成"——纯防御。

st-bme 的 `contradicts` 抑制边设计（在扩散中反向传播负能量）提示了一个方向：
- 将矛盾纳入记忆演化：新事件与旧 LTM 矛盾时，标记旧 LTM 为"可能过时"而非直接覆盖
- 矛盾检测结果可反馈给 SmartPush 检索排序：被标记为"当前上下文冲突"的记忆条目应降权

### 启发三：需要确定性测试层补充 LLM 测试

ne-memory 的语义性断言是独到创新，但不能替代确定性单元测试。

shujuku 的 538 个单元测试可在 CI 中 15 秒内跑完——不需要 LLM API 调用。

→ **应建立确定性测试层**（像已有的 `consolidate.test.js` 和 `pipeline-guard.test.js`），覆盖：
- Vault 数据操作 CRUD
- State Schema 校验逻辑
- BM25 检索排序正确性
- Pipeline Guard 状态机全状态转移

确定性测试每次提交前跑，LLM 测试发版前跑。

### 启发四：需要明确的「复杂度上限」

st-bme 知道自己追求什么（极致精度和覆盖），也知道代价是什么（8 条已知局限）。

ne-memory 的设计显得"什么都能做"，但缺少"不做什么"的边界声明。

ST-BaiBai-Book 的 `deriveMemory`（纯函数重放）提示了一个有趣的分界线：ne-memory 的 State Schema 是读写模式，ST-BaiBai-Book 的状态是只读派生。这意味着：

- 读模式的缓存一致性由重放保证（删事件 → 状态自动回退）
- 写模式的最终一致性由 pipeline 顺序保证（写入时序的仲裁）

→ **应明确边界**：
- **不做**：全图谱建模（叙事弧线模型已够用）
- **不做**：前后端分离（保持纯浏览器部署的简洁性）
- **能做但选择不优先做**：向量为主检索（BM25+LLM 合成在大多数场景下已足够好）
- **可以引入但需谨慎**：派生状态重放（可能是 State Schema 的下一阶段演化方向）

### 启发五：LTM 整合模型有向「层级压缩」演化的潜力

ne-memory 的 LTM 目前只有两层（STM→LTM），LTM 闭合后即是最终形态。

但 `consolidate.js` 已区分 `open/closed` 弧线，`computeClosureSignals` 检测闭合条件（时间跨度、角色重合度、场景切换）。

st-bme 的分层压缩和 ST-BaiBai-Book 的压缩森林（L0→L1→L2…）提示了方向：闭合 LTM 达到 N 条后可触发更高层"LTM 总结"，将多条闭合弧线压缩为叙事概要。不需要引入完整压缩金字塔，但可让 Vault 在超长对话中更可控。

### 启发六：「派生即一致性」——ST-BaiBai-Book 最深刻的架构启示

ST-BaiBai-Book 的 `deriveMemory()` 模式是六项目中最独特的架构选择：

- 其他五个项目（含 ne-memory）都是「写入时计算 → 持久化 → 读取时直接返回」
- ST-BaiBai-Book 是「写入时只存增量 → 读取时从头重放 → 保证最终一致性」

这个模式的核心优势在于**永远不会出现数据不一致**——没有写入时序问题、没有部分更新问题、没有冗余同步问题。代价是每次读取需要 O(n) 顺序扫描。

ne-memory 的 State Schema 采用写入模式，有标准的一致性挑战（如在 pipeline 中 state 在 stm 阶段更新、在 state 阶段重新读取，如果 pipelin 中断，state 可能处于半更新状态）。ST-BaiBai-Book 的纯函数重放模式不会有这个问题。

→ **值得探索**：将 State Schema 中「可由事件链推导」的部分拆出来改为派生模式。例如 quests 的 `status` 完全可由关联的 STM/LTM 事件链推导：如果有 `task_complete` 事件 → 任务完成。这样既保留了 State Schema 的结构化查询便利，又获得了派生模式的一致性保证。

---

> **后续讨论条目**：
>
> P0 — 13.1 认知边界过滤 ｜ 13.2 已知局限文档
>
> P1 — 13.3 多样性采样 ｜ 13.4 记忆生命周期 ｜ 13.5 Echo检索连贯性 ｜ 13.6 架构合规检查
>       13.7 派生状态重放 ｜ 13.8 生成拦截 ｜ 13.9 副API渠道
>
> P2 — 13.10 TypeScript迁移 ｜ 13.11 Zod校验 ｜ 13.12 Agent决策
>       13.13 时间轴标签 ｜ 13.14 NPC双字段
>
> P3 — 13.15 图扩散 ｜ 13.16 去依赖化 ｜ 13.17 Shadow DOM隔离
>
> 深层启发 — 双轨协同 ｜ 矛盾进攻化 ｜ 确定性测试 ｜ 复杂度边界 ｜ 层级压缩演化 ｜ 派生式一致性
