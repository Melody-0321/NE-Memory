# ne-memory 横向对比分析与改进建议

> 基于对 5 个 SIL (AIRP) 记忆插件项目的 CODE_WIKI 对比分析
>
> 分析对象：ne-memory | st-bme | shujuku | anima | st-memory-enhancement
> 分析日期：2026-06-28

---

## 目录

1. [五项目概览](#1-五项目概览)
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

## 1. 五项目概览

| # | 项目 | 核心范式 | 记忆表示 | 运行环境 |
|---|------|---------|---------|---------|
| 1 | **ne-memory** | 叙事弧线引擎 | STM→LTM 分层事件 + State Schema 状态 | 浏览器 (TH + ST) |
| 2 | **st-bme** | 记忆图谱生态 | 图数据库 (8种节点 + 8种关系) | 浏览器 (ST扩展) |
| 3 | **shujuku** | 结构化数据库 | SQL/JSON 表格 | 浏览器 (油猴/ST扩展) |
| 4 | **anima** | 记忆系统扩展 | 向量化切片 + Echo 回响 | 浏览器 + Node.js 后端 |
| 5 | **st-memory-enhancement** | 增强表格插件 | 电子表格 (hashSheet + Cell) | 浏览器 (ST扩展) |

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

### 2.2 对比总结

| 比较维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh |
|----------|-----------|--------|---------|-------|-------------|
| 记忆单元 | 事件条目+状态字段 | 图谱节点+边关系 | 数据库行/列 | 向量化切片 | 电子表格单元格 |
| 结构维度 | 2维(事件+状态) | 多维(图谱拓扑) | N维(N张表) | 1维(时间线) | 2维(行列矩阵) |
| 演化支持 | STM→LTM弧线聚合 | 节点版本链+时序边 | 增量日志+Checkpoint | Echo生命周期 | cellHistory不可变追加 |
| 关系建模 | parent_ltm引用链 | 8种显式关系类型 | 无关系建模 | 标签关联 | 行列位置隐含关系 |
| Schema约束 | 字段级enum/max_length | 8种节点类型定义 | 表格模板定义 | 无Schema | CellType枚举 |
| 压缩/遗忘 | LTM闭合+批量整合 | 层级压缩+睡眠遗忘 | 存储帧快照 | Echo生命衰减 | cellHistory只增不减 |

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

### 3.2 重复处理防护

| 项目 | 防护机制 |
|------|---------|
| ne-memory | `filterNewMessages(messages, processedIds)` — msg_id去重，每条消息最多处理一次 |
| st-bme | 批次追踪：楼层 hash + `chat-history.js` |
| shujuku | `table-update-commit.ts` 维护更新提交状态 |
| anima | 未在 CODE_WIKI 中明确说明 |
| st-memo-enh | `isTableEditStrChanged()` 去重检查 |

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

### 4.2 对比总结

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh |
|------|-----------|--------|---------|-------|-------------|
| 检索技术 | BM25 + LLM合成 | 向量+图扩散+DPP+LLM精排 | 世界书触发 | 向量+BM25双轨 | 格式化注入 |
| 管线复杂度 | 5阶段 | 13阶段 | 2层面 | 后端合并 | 1阶段 |
| 语义搜索 | 通过LLM工具调用 | ✅ 向量预筛 | 部分(交火索引) | ✅ 向量检索 | ❌ |
| 图/关系探索 | 实体链查询 | ✅ PEDSA扩散 | ❌ | ❌ | ❌ |
| 多样性保障 | ❌ | ✅ DPP采样 | ❌ | ✅ 分步策略 | ❌ |
| 记忆遗忘 | ❌ | ✅ 层级压缩+睡眠 | ❌ | ✅ Echo生命衰减 | ❌ |

---

## 5. 维度四：架构设计与分层质量

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh |
|------|-----------|--------|---------|-------|-------------|
| 核心范式 | 适配器+DI | 控制面/数据面分离 | 严格三层 | 前后端分离 | Proxy响应式 |
| 分层约束 | 适配层↔核心层 | 控制面↔数据面 | 4层+合规检查 | 前后端 | 6命名空间 |
| 平台解耦 | runtime接口+external | runtime注入 | gateway模式 | 后端独立 | 紧密耦合 |
| 架构检查 | 无 | 无 | 自动化检查(构建时) | 无 | 无 |
| 重构记录 | 无 | 无 | 三轮重构 | 无 | 无 |
| 类型系统 | JSDoc部分 | 无 | TypeScript完整 | 部分d.ts | 无 |

---

## 6. 维度五：持久化与存储策略

| 项目 | 存储介质 | 特点 |
|------|---------|------|
| ne-memory | IndexedDB(`ne_memory_vaults` v3) + localStorage(设置/遥测) + chat_metadata(冗余) + localStorage(崩溃恢复暂存) | 多层冗余，快照≤30个自动裁剪 |
| st-bme | Authority SQL / Luker / IndexedDB / OPFS / Blob / Trivium 六层 | 最复杂分层；快照顶层六键冻结契约 |
| shujuku | 聊天消息JSON字段(`TavernDB_ACU_*`) + SQLite WASM | 双模式互备；V2存储帧(Mutation Log+Checkpoint) |
| anima | Vectra文件(`vectors/`) + BM25 JSON(`data/bm25_indexes/`) + Echo会话(`data/sessions/`) | 后端本地文件，无冗余 |
| st-memo-enh | `power_user.muyoo_dataTable` + `chatMetadata.sheets` + `chat[i].hash_sheets` | 完全依赖酒馆原生存储 |

---

## 7. 维度六：上下文注入策略

| 项目 | 注入内容 | 注入方式 | 注入位置 |
|------|---------|---------|---------|
| ne-memory | LLM合成的叙事文本 | SmartPush(LLM合成) + ContextWindow(窗口前摘要) | 双模式可切换 |
| st-bme | 按POV/区域分桶的结构化表格 | `injector.js` 分桶：Summary/Core/Recalled/POV/Objective | prompt 注入 |
| shujuku | 世界书条目 + 深度注入提示词 | 世界书条目机制 + 表格推送 | system/user/chat |
| anima | 世界书容器注入 | `[ANIMA_RAG_Container]` + `[ANIMA_Knowledge_Container]` | 世界书 |
| st-memo-enh | 表格文本(纯数据/含规则) | `{{macro::tablePrompt}}` / `{{macro::tableData}}` | 3位置(system/user/assistant) |

---

## 8. 维度七：特色创新/独特能力

每个项目至少有一个在另外四个中找不到对等物的独特机制：

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

---

## 9. 维度八：测试与质量保证

| 指标 | shujuku | st-bme | ne-memory | anima | st-memo-enh |
|------|:---:|:---:|:---:|:---:|:---:|
| 测试文件数 | 176 | 70+ | ~7(单元) + 30+(LLM集成) | 基本 | 调试工具 |
| 测试用例数 | 538 | ~70+ | ~37 | 未公开 | 无 |
| 测试框架 | Vitest 3.2.4 | 自建(裸Node子进程) | 自建+LLM断言 | 无公开 | 无 |
| 模拟环境 | jsdom 29 | fake-indexeddb 6.2 | mock-runtime.js | 无公开 | 无 |
| CI/CD | 无 | ✅ GitHub Actions | 无 | 无 | 无 |

ne-memory 的 LLM 驱动语义性断言（三态：passed=true/false/null）是独特创新，但依赖实时 LLM 资源无法在 CI 中自动化。

---

## 10. 维度九：技术栈与构建体系

| 维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh |
|------|-----------|--------|---------|-------|-------------|
| 主语言 | JavaScript | JavaScript | TypeScript 5.7 | JavaScript | JavaScript |
| 类型覆盖 | JSDoc部分 | 无 | 100% | 部分d.ts | 极少量 |
| 构建工具 | Rollup 4.60 + Babel | 无构建 | Rollup 4.28 + tsc/Vue | 无构建 | 无构建 |
| 输出格式 | IIFE (`NEMemoryEngine`) | ES Module 直出 | 多目标(IIFE/ESM) | ES Module 直出 | ES Module 直出 |
| 运行时依赖(数量) | 1 | 1 | 3(sql.js+pinia+vue) | 7(后端) | 0 |

---

## 11. 维度十：用户界面与交互体验

| 项目 | UI 技术 | 主要界面 | 复杂度 |
|------|---------|---------|:---:|
| st-bme | 自绘 Canvas 2D + jQuery | 力导向图谱 + 设置面板 | ★★★★★ |
| shujuku | Vue 3 SFC + jQuery 双轨 | 13 页面仪表板 + 可视化编辑器 | ★★★★★ |
| ne-memory | jQuery | Memory Vault 面板 + 设置弹窗 | ★★★ |
| anima | jQuery | 7 标签页面板 + 正则 UI | ★★★ |
| st-memo-enh | jQuery + HTML 模板 | 表格编辑器 + 设置面板 | ★★☆ |

独特 UI 能力：
- **st-bme**：零依赖 Canvas 力导向布局 + Web Worker，自适应策略（<220节点→120次迭代，>520→静态）
- **shujuku**：自建 Acu* 组件库（24个组件）+ 自定义 Vue 渲染器（iframe 兼容）

---

## 12. 综合总结与横向洞察

### 12.1 设计谱系

```
st-memo-enh ─── anima ─── ne-memory ─── shujuku ─── st-bme
  (极简表)     (向量系统)  (叙事引擎)   (数据库)    (知识图谱)
```

### 12.2 成本结构

| 成本维度 | ne-memory | st-bme | shujuku | anima | st-memo-enh |
|----------|:---:|:---:|:---:|:---:|:---:|
| LLM Token 成本 | 高(提取+合成+检索) | 极高(双阶段+后处理链) | 高(填表+剧情) | 中(状态更新+总结) | 低(仅格式化) |
| Embedding 成本 | 可选 | ✅ 必选 | 可选 | ✅ 必选 | ❌ |
| 存储成本 | 中(IndexedDB) | 极高(6层存储) | 中(SQLite/JSON) | 高(向量+BM25+Echo) | 低(酒馆原生) |
| 用户配置成本 | 高(多API+参数) | 极高(10种任务预设) | 高(模板+规则) | 高(4套API) | 低(6张表) |

### 12.3 模块间借鉴痕迹

- **st-bme** 明确标注了学术论文启发链：Graphiti（时序边）、PeroCore（PEDSA扩散）、Mem0（冲突检测）、A-MEM（记忆进化）、RoleRAG（认知边界）、AriGraph（残差召回）
- **ne-memory** 的 BM25 参数 `K1=1.2, B=0.75` 为标准信息检索参数

### 12.4 已知局限记录

| 项目 | 局限记录数 | 关键局限 |
|------|:---:|------|
| st-bme | 8条 | 记忆质量依赖LLM、Embedding决定召回下限、历史恢复优先正确性可能慢 |
| ne-memory | 0条 | — |
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

### P2 — 中长期投入

#### 13.7 TypeScript 渐进迁移

- **来源**：shujuku（TypeScript 全量，tsc 0 ERROR）
- **现状**：纯 JavaScript + JSDoc，缺乏编译时类型检查
- **改进**：扩展 `globals.d.ts` → 从 `vault/schema.js` 和 `vault/store.js` 开始迁移 → 使用 `allowJs + checkJs` 逐步收紧
- **预估工作量**：大

#### 13.8 Zod 替换自建校验

- **来源**：anima（`status_zod.js`）
- **现状**：`validate.js`（自建 STM/LTM 校验）+ `schema.js`（自建 State 字段校验）
- **改进**：用 Zod Schema 表达式替换自建校验逻辑；减少自维护代码；提升 LLM 输出验证可靠性
- **预估工作量**：中

#### 13.9 Agent 决策增强

- **来源**：shujuku（`agent-decision-engine.ts`）
- **现状**：pipeline 触发完全依赖 `stmBatch` 硬编码阈值
- **改进**：保留 stmBatch 作为硬上限，在批次内让 LLM 判断"这段对话中有值得提取的事件吗？"；可看作 `bm25-grouper.js`（BM25 预分组）的自然延伸
- **预估工作量**：中

### P3 — 长期愿景

#### 13.10 图扩散启发的关系检索

- **来源**：st-bme（PEDSA 扩散算法）
- **现状**：已有 `lookupEntityChains` 但未充分集成到 SmartPush
- **改进**：BM25 top-3 结果中发现高频实体时，自动触发链查询，将链上条目纳入 LLM 合成候选池
- **预估工作量**：大

#### 13.11 gpt-tokenizer 去依赖化

- **来源**：st-memory-enhancement（零 npm 运行时依赖的设计哲学）
- **现状**：唯一运行时依赖是 `gpt-tokenizer ^3.4.0`
- **改进**：评估 CJK-aware Token 估算的自研替代可行性（±10% 误差是否可接受）
- **预估工作量**：小

---

## 14. 对比分析对 ne-memory 的深层启发

### 启发一：「事件 + 状态」双轨是未被充分利用的核心优势

纵观五项目：
- st-bme 有图谱（关系强，但不知"故事进行到哪了"）
- shujuku 有表格（数据强，但不理解叙事弧线）
- anima 有向量（语义强，但无结构）
- st-memo-enh 有单元格（操作强，但无上下文理解）

**ne-memory 是唯一同时拥有"叙事事件流"（STM→LTM）和"结构化世界状态"（State Schema）的项目。**

但目前两轨交互有限：State 提取和 STM 提取在 pipeline 中是两个独立阶段，仅在 `buildStateOnlyInjection` 中作回退合并。

→ **应深耕双轨协同**：让事件检索感知状态变化（如"角色受伤"状态提升相关事件检索权重），让状态更新参考事件上下文（如"任务完成"事件自动更新 quests 状态）。

### 启发二：矛盾检测应从「防御」转为「进攻」

ne-memory 的矛盾检测是五项目中独一无二的能力。但目前定位是"检测到矛盾就触发 LLM 重新生成"——纯防御。

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

→ **应明确边界**：
- **不做**：全图谱建模（叙事弧线模型已够用）
- **不做**：前后端分离（保持纯浏览器部署的简洁性）
- **能做但选择不优先做**：向量为主检索（BM25+LLM 合成在大多数场景下已足够好）

### 启发五：LTM 整合模型有向「层级压缩」演化的潜力

ne-memory 的 LTM 目前只有两层（STM→LTM），LTM 闭合后即是最终形态。

但 `consolidate.js` 已区分 `open/closed` 弧线，`computeClosureSignals` 检测闭合条件（时间跨度、角色重合度、场景切换）。

st-bme 的分层压缩（synopsis → summary_rollup）提示了方向：闭合 LTM 达到 N 条后可触发更高层"LTM 总结"，将多条闭合弧线压缩为叙事概要。不需要引入完整压缩金字塔，但可让 Vault 在超长对话中更可控。

---

> **后续讨论条目**：
>
> P0 — 13.1 认知边界过滤 ｜ 13.2 已知局限文档
>
> P1 — 13.3 多样性采样 ｜ 13.4 记忆生命周期 ｜ 13.5 Echo检索连贯性 ｜ 13.6 架构合规检查
>
> P2 — 13.7 TypeScript迁移 ｜ 13.8 Zod校验 ｜ 13.9 Agent决策
>
> P3 — 13.10 图扩散 ｜ 13.11 去依赖化
>
> 深层启发 — 双轨协同 ｜ 矛盾进攻化 ｜ 确定性测试 ｜ 复杂度边界 ｜ 层级压缩演化
