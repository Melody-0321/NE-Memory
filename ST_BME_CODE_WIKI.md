# ST-BME (Bionic Memory Ecology) — Code Wiki

> **项目名称**: `ST-BME Memory Graph`
> **版本**: `7.7.5`
> **描述**: SillyTavern 第三方前端扩展，基于知识图谱的仿生记忆生态——自动提取、图谱组织、混合召回、认知过滤
> **许可**: AGPL-3.0
> **语言**: JavaScript (ES Module)
> **平台**: 浏览器端 (SillyTavern 扩展)
> **作者**: Youzini
> **仓库**: <https://github.com/Youzini-afk/ST-Bionic-Memory-Ecology>

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [核心模块详解](#4-核心模块详解)
   - [4.1 图数据层 (Graph)](#41-图数据层-graph)
   - [4.2 写入管线 (Maintenance)](#42-写入管线-maintenance)
   - [4.3 读取管线 (Retrieval)](#43-读取管线-retrieval)
   - [4.4 向量层 (Vector)](#44-向量层-vector)
   - [4.5 持久化层 (Sync)](#45-持久化层-sync)
   - [4.6 Prompt 工程 (Prompting)](#46-prompt-工程-prompting)
   - [4.7 LLM 层 (LLM)](#47-llm-层-llm)
   - [4.8 运行时层 (Runtime)](#48-运行时层-runtime)
   - [4.9 宿主层 (Host)](#49-宿主层-host)
   - [4.10 UI 层 (UI)](#410-ui-层-ui)
   - [4.11 ENA Planner 子系统](#411-ena-planner-子系统)
   - [4.12 原生加速层 (Native)](#412-原生加速层-native)
5. [关键类与函数说明](#5-关键类与函数说明)
6. [数据流与核心流程](#6-数据流与核心流程)
7. [关键数据结构](#7-关键数据结构)
8. [依赖关系图](#8-依赖关系图)
9. [构建与运行](#9-构建与运行)
10. [差异化对比：ST-BME vs NE-Memory](#10-差异化对比st-bme-vs-ne-memory)

---

## 1. 项目概述

**ST-BME (Bionic Memory Ecology)** 是一个 SillyTavern 第三方前端扩展，将长期对话组织为一张**知识图谱**。它从对话中自动提取结构化节点和关系（角色、事件、地点、规则、主线、反思、主观记忆），并在下一轮生成前通过多层混合召回将相关记忆注入 prompt。

### 核心能力

| 能力 | 说明 |
|------|------|
| **自动记忆提取** | AI 回复后从对话中提取结构化节点与关系，默认走客观 + 主观/POV 双阶段提交管线 |
| **多层混合召回** | 向量预筛 + 图扩散 (PEDSA) + 词法增强 + DPP 多样性采样 + 可选 LLM 精排 |
| **认知架构 (RoleRAG)** | 每个角色独立维护知识状态，角色不知道的内容不会注入 |
| **记忆作用域** | 客观/主观/角色POV/用户POV 六桶体系 + 空间区域权重 |
| **故事时间线** | 剧情时间维度（过去/进行中/未来/闪回/假设）+ 6 个时间桶 |
| **层级压缩与总结** | 超阈值节点自动压缩、小总结/折叠总结两级体系 |
| **PEDSA 扩散激活** | 从 PeroCore Rust 移植的图能量传播排序算法 |
| **图谱可视化** | Canvas 力导向图谱，分区神经布局，支持实时/认知/总结视图 |
| **任务预设系统** | 所有 LLM 任务统一走 TaskProfile，支持正则/世界书/EJS 渲染 |
| **历史安全** | 消息 hash 检测，优先回滚重放，必要时全量重建 |
| **持久化与同步** | 本地优先 (IndexedDB/OPFS)，云端镜像，前后兼容快照 |

---

## 2. 整体架构

ST-BME 采用 **控制平面 / 数据平面分离** 的架构，以 `index.js` 为组合根 (Composition Root) 将依赖显式注入各模块。

```
┌──────────────────────────────────────────────────────────────────┐
│                   SillyTavern (Host Runtime)                     │
│   事件系统: CHAT_CHANGED / MESSAGE_SENT / BEFORE_COMBINE / ...  │
├──────────────────────────────────────────────────────────────────┤
│                       index.js (Composition Root)                │
│    事件绑定 · 设置管理 · 流程调度 · 依赖注入 · 持久化协调       │
├──────────────────────────────────────────────────────────────────┤
│  Control Plane (纯逻辑/策略，可独立测试)                         │
│  identity-resolver · persistence-reducer · graph-mutation-gate  │
│  vector-gate · generation-context · concurrency                 │
├──────────────────────────────────────────────────────────────────┤
│  Data Plane (执行 IO 副作用)                                     │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │  Graph   │Maintenance│Retrieval │  Vector  │   Sync   │      │
│  │   Models  │  Write   │   Read   │  Embed   │   IO     │      │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┤      │
│  │Prompting │   LLM    │   Host   │    UI    │  ENA     │      │
│  │  Tasks   │  Calls   │  Adapter │  Canvas  │ Planner  │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘      │
├──────────────────────────────────────────────────────────────────┤
│  Storage: IndexedDB / OPFS / Luker ChatState / Authority Server │
└──────────────────────────────────────────────────────────────────┘
```

### 三条数据链路

```
Write Path (对话 → 图谱)
  AI回复 → 智能触发 → 提取计划 → 结构化预处理
  → LLM 客观+主观提取 → 规范化操作 → 写入图谱
  → 后处理(整合/压缩/总结/反思/遗忘) → 向量同步 → 持久化

Read Path (图谱 → 注入)
  用户准备生成 → 召回输入解析 → 向量预筛 → 图扩散(PEDSA)
  → 认知边界过滤 → 混合评分 → DPP多样性 → LLM精排
  → 注入格式化(分桶) → 写入 LLM 上下文

Safe Path (历史变 → 恢复)
  历史变动检测 → 消息hash比对 → 定位受影响批次
  → 日志回滚优先 → 退化为全量重建 → 从变动点重提取
```

### 事件挂载

| SillyTavern 事件 | ST-BME 行为 |
|---|---|
| `CHAT_CHANGED` | 加载当前聊天图谱，恢复持久状态，应用隐藏/渲染限制 |
| `GENERATION_AFTER_COMMANDS` | 助手回复后触发自动提取 |
| `GENERATE_BEFORE_COMBINE_PROMPTS` | 生成前召回并注入记忆 |
| `MESSAGE_SENT` | 捕获发送意图和用户输入 |
| `MESSAGE_RECEIVED` | 更新自动提取队列和持久化状态 |
| 编辑 / 删除 / Swipe | 检测历史变化并恢复 |

---

## 3. 目录结构

```
ST-BME/
├── index.js                           # 主入口：Composition Root，事件绑定与流程调度
├── manifest.json                      # ST 扩展清单 (loading_order=150)
├── style.css                          # 扩展样式
├── package.json                       # 测试与开发脚本
├── package-lock.json                  # 依赖锁定
│
├── graph/                             # 图数据模型与领域状态
│   ├── graph.js                       # 节点/边 CRUD、序列化、时间链表
│   ├── graph-persistence.js           # 持久化常量、加载状态、身份别名
│   ├── schema.js                      # 节点类型 Schema (7种类型)
│   ├── memory-scope.js                # 主客观作用域与空间区域
│   ├── knowledge-state.js             # 认知归属、可见性、区域状态 (RoleRAG)
│   ├── story-timeline.js              # 故事时间线 (6个时间桶)
│   ├── summary-state.js               # 活跃总结状态 (small/rollup)
│   └── node-labels.js                 # 节点显示名与截断工具
│
├── maintenance/                       # 写入链路
│   ├── extractor.js                   # LLM 提取管线 (客观+主观双阶段)
│   ├── extraction-controller.js       # 自动/手动提取编排
│   ├── extraction-success-controller.js # 提取成功后处理编排
│   ├── extraction-context.js          # 结构化消息和边界过滤
│   ├── reroll-recovery-controller.js  # reroll 回滚 + 历史恢复编排
│   ├── chat-history.js                # 楼层判断、hash 比对、恢复工具
│   ├── consolidator.js                # 记忆整合 (Mem0精确对照 + 进化)
│   ├── compressor.js                  # 层级压缩与遗忘
│   ├── hierarchical-summary.js        # 小总结/折叠总结
│   ├── smart-trigger.js               # 智能触发 (关键词+正则)
│   └── task-graph-stats.js            # 任务图谱统计
│
├── retrieval/                         # 读取链路
│   ├── retriever.js                   # 三层混合检索编排
│   ├── shared-ranking.js              # 共享排序核心
│   ├── recall-controller.js           # 召回输入和注入控制
│   ├── recall-persistence.js          # 消息级召回持久化
│   ├── retrieval-enhancer.js          # 多意图/DPP/残差召回/锚点共现
│   ├── diffusion.js                   # PEDSA 图扩散激活
│   ├── dynamics.js                    # 混合评分与访问强化
│   └── injector.js                    # 注入格式化 (分区分桶)
│
├── vector/                            # 向量嵌入与检索
│   ├── vector-index.js                # 向量模式选择/后端/直连/权威服务
│   ├── vector-gate.js                 # 向量就绪门禁策略
│   ├── vector-sync-controller.js      # 向量同步编排
│   ├── vector-space.js                # 向量空间标识与管理
│   ├── authority-vector-primary-adapter.js # 权威向量服务适配
│   └── embedding.js                   # 批量 Embedding 编码 + cosine 搜索
│
├── sync/                              # 持久化与同步
│   ├── bme-db.js                      # IndexedDB 核心 (BmeDatabase 类)
│   ├── bme-opfs-store.js              # OPFS/sidecar 存储
│   ├── bme-sync.js                    # 云端镜像与备份恢复
│   ├── bme-chat-manager.js            # chatId → 数据库生命周期管理
│   ├── persistence-reducer.js         # 持久化 accepted/queued/pending 状态机
│   ├── graph-persistence-io.js        # 图谱 save/load/queue/retry IO
│   ├── graph-load-persist.js          # 图谱加载/持久化/authority 编排
│   ├── graph-mutation-gate.js         # 图谱可写性门禁
│   ├── authority-browser-state.js     # 权威服务浏览器状态
│   ├── authority-graph-store.js       # 权威服务中心图谱存储
│   ├── graph-snapshot-schema.js       # 耐久快照契约 (冻结+宽容解析)
│   ├── graph-snapshot-upgrade.js      # 快照 upgrade-on-read 链
│   └── legacy-persistence-repair.js   # 旧状态安全修复
│
├── prompting/                         # Prompt 工程
│   ├── prompt-builder.js              # 统一 TaskPrompt 构建器
│   ├── prompt-profiles.js             # 9种任务预设管理
│   ├── default-task-profile-templates.js # 内置模板
│   ├── prompt-node-references.js      # 节点引用格式化
│   ├── task-regex.js                  # 正则任务模式
│   ├── task-worldinfo.js              # 世界书任务模式
│   ├── task-ejs.js                    # EJS 模板任务模式
│   ├── injection-sanitizer.js         # 注入文本净化
│   └── mvu-compat.js                  # MVU 向后兼容
│
├── llm/                               # LLM 请求
│   ├── llm.js                         # callLLMForJSON + 重试 + 超时
│   └── llm-preset-utils.js            # LLM 预设工具
│
├── runtime/                           # 运行时状态
│   ├── identity-resolver.js           # 四类身份解析 (active/graph/queued/marker)
│   ├── runtime-state.js               # 图运行时状态规范化
│   ├── generation-context.js          # 宿主生成 type 跟踪
│   ├── generation-recall-transactions.js # 生成召回事务
│   ├── recall-input-state.js          # 召回输入状态工厂
│   ├── reroll-recall-input.js         # reroll/continue 召回输入
│   ├── final-recall-injection.js      # 最终召回注入解析
│   ├── auto-extraction-defer.js       # 自动提取 defer/resume
│   ├── planner-recall-controller.js   # ENA planner 召回管线
│   ├── settings-defaults.js           # 默认设置
│   ├── concurrency.js                 # 并发控制
│   ├── generation-options.js          # 生成选项
│   ├── vector-sync-coalescer.js       # 向量同步合并
│   ├── authority-capabilities.js      # 权威服务能力探测
│   ├── authority-upgrade-state.js     # 权威服务升级状态
│   ├── authority-http-client.js       # 权威服务 HTTP 客户端
│   ├── user-alias-utils.js            # 用户别名工具
│   ├── request-timeout.js             # 请求超时
│   ├── debug-logging.js               # 调试日志
│   └── runtime-debug.js               # 运行时调试
│
├── host/                              # 宿主编排
│   ├── event-binding.js               # 事件绑定控制器
│   ├── runtime-host-adapter.js        # 宿主导航器 (ST/Luker)
│   ├── st-context.js                  # ST 上下文工具
│   ├── st-native-render.js            # ST 原生渲染
│   └── adapter/                       # 宿主适配器
│       ├── index.js                   # 宿主适配器入口
│       ├── capabilities.js            # 宿主能力探测
│       ├── context.js                 # 上下文适配
│       ├── injection.js               # 注入适配
│       ├── regex.js                   # 正则适配
│       └── worldbook.js               # 世界书适配
│
├── ui/                                # UI 层
│   ├── panel.html                     # 面板 HTML
│   ├── panel.js                       # 面板交互逻辑 (集成图谱/预设/配置)
│   ├── panel-bridge.js                # 面板桥接 (live state 刷新)
│   ├── panel-ena-sections.js          # ENA Planner 面板区域
│   ├── panel-graph-refresh-utils.js   # 图谱刷新工具
│   ├── graph-renderer.js              # Canvas 图谱渲染器
│   ├── graph-layout-solver.js         # 布局求解器
│   ├── graph-layout-worker.js         # Web Worker 布局
│   ├── graph-native-bridge.js         # Native/WASM 桥接
│   ├── graph-renderer-utils.js        # 渲染工具
│   ├── recall-message-ui.js           # 召回卡片 UI
│   ├── recall-message-ui-controller.js # 召回卡片挂载/刷新
│   ├── hide-engine.js                 # 楼层隐藏引擎
│   ├── message-render-limit.js        # 渲染楼层限制
│   ├── history-notice.js              # 历史变更通知
│   ├── notice.js                      # 通知组件
│   ├── themes.js                      # 主题管理
│   ├── ui-actions-controller.js       # 操作按钮控制器
│   ├── ui-label-formatter.js          # 标签格式化
│   └── ui-status.js                   # UI 状态管理
│
├── ena-planner/                       # ENA Planner
│   ├── ena-planner.js                 # Planner 主入口
│   ├── ena-planner-presets.js         # Planner 预设
│   ├── ena-planner-runtime-utils.js   # 运行时工具
│   ├── ena-planner-storage.js         # 存储
│   ├── ena-planner-worldbook-utils.js # 世界书工具
│   └── planner-plot-history.js        # 剧情历史记录
│
├── native/                            # Native/WASM 加速
│   └── stbme-core/                    # Rust 源码 (Cargo.toml + lib.rs)
│
├── vendor/                            # Bundled 依赖
│   ├── wasm/                          # WASM 构建产物
│   │   ├── pkg/                       # wasm-pack 输出
│   │   └── stbme_core.js              # WASM 入口
│   ├── ejs.js                         # EJS 模板引擎
│   └── js-yaml.mjs                    # YAML 解析器
│
├── lib/
│   └── dexie.min.js                   # 浏览器端 Dexie
│
├── tests/                             # 回归测试 (约 80 个)
│   ├── e2e/                           # 端到端测试
│   ├── helpers/                       # 测试辅助
│   └── perf/                          # 性能基准测试
│
├── docs/                              # 项目文档
│   ├── architecture/                  # 架构 (控制平面、存储格式)
│   ├── algorithms/                    # 算法 (提取/检索/扩散/压缩)
│   ├── features/                      # 功能 (记忆模型/历史安全/ENA)
│   ├── usage/                         # 使用 (配置/面板/排障/存储)
│   └── contributing/                  # 贡献 (开发/测试/约定)
│
└── scripts/                           # 构建脚本
    ├── build-native-wasm.mjs
    ├── bump-manifest-version.mjs
    ├── check-syntax.mjs
    └── run-test-suite.mjs
```

---

## 4. 核心模块详解

### 4.1 图数据层 (Graph)

知识图谱是 ST-BME 的中心数据结构，由 **节点 + 关系(边)** 组成。

#### [graph/graph.js](file:///d:/SillyTavern/xm/st-bme/graph/graph.js)

**职责**: 图谱 CRUD、序列化、版本迁移（当前版本 9）。

| 导出函数 | 说明 |
|------|------|
| `createEmptyGraph()` | 创建空图谱 (nodes/edges/各类子状态) |
| `createNode({ type, fields, seq, importance, scope })` | 创建节点 (UUID、时间链表 prevId/nextId、scope、storyTime) |
| `addNode(graph, node)` | 添加节点，维护同类型同 scope 的时间链表 |
| `removeNode(graph, nodeId)` | 归档节点 (archived=true，物理不删除) |
| `updateNode(graph, nodeId, fields)` | 更新节点字段 |
| `addEdge(graph, edge)` | 添加关系边 |
| `invalidateEdge(graph, edgeId)` | 标记边失效 |
| `getNode(graph, nodeId)` / `getActiveNodes(graph)` | 节点查询 |
| `deserializeGraph(raw)` / `serializeGraph(graph)` | 序列化/反序列化 |
| `exportGraph(graph)` / `importGraph(raw)` | 导出/导入 |

#### [graph/schema.js](file:///d:/SillyTavern/xm/st-bme/graph/schema.js)

**职责**: 定义 7 种核心节点类型的 Schema。

| 类型 | label | alwaysInject | latestOnly | 压缩模式 | 压缩阈值 | 压缩扇入 |
|------|-------|:---:|:---:|:---:|:---:|:---:|
| `event` | 事件 | ✅ | ❌ | HIERARCHICAL | 9 | 3 |
| `character` | 角色 | ❌ | ✅ | NONE | 0 | 0 |
| `location` | 地点 | ❌ | ✅ | NONE | 0 | 0 |
| `rule` | 规则/设定 | ✅ | ✅ | HIERARCHICAL | 6 | 3 |
| `thread` | 线索/主线 | ✅ | ❌ | HIERARCHICAL | 6 | 3 |
| `synopsis` | 概要/总结 | ✅ | ❌ | HIERARCHICAL | 5 | 3 |
| `reflection` | 反思/洞察 | ❌ | ❌ | HIERARCHICAL | 5 | 3 |

每种类型定义 `columns` (字段列表含 name/hint/required)、`compression` (压缩配置)、`injection` (注入权重) 等元数据。

#### [graph/memory-scope.js](file:///d:/SillyTavern/xm/st-bme/graph/memory-scope.js)

**职责**: 记忆作用域系统——将记忆按"谁的视角"分为 6 个桶。

| 作用域桶 | 权重 | 说明 |
|------|:---:|------|
| `characterPov` | 1.25 | 角色POV记忆 |
| `userPov` | 1.10 | 用户POV记忆 |
| `objectiveCurrentRegion` | 1.15 | 当前区域客观记忆 |
| `objectiveAdjacentRegion` | 0.80 | 相邻区域客观记忆 |
| `objectiveGlobal` | 0.95 | 全局客观记忆 |
| `otherPov` | 0.40 | 其他角色POV |

#### [graph/knowledge-state.js](file:///d:/SillyTavern/xm/st-bme/graph/knowledge-state.js)

**职责**: 认知边界状态 (RoleRAG)——为每个"认知主体"(角色/用户)维护独立的知识边界。

| 导出 | 说明 |
|------|------|
| `createDefaultKnowledgeOwnerState()` | 创建知识主体状态 (knownNodeIds / mistakenNodeIds / visibilityScores) |
| `pruneKnowledgeOwnerNodeRefs()` | 清理无效节点引用 |
| `resolveKnowledgeOwner()` | 根据 scope 解析知识主体身份 |
| `applyManualKnowledgeOverride()` | 手动标记节点为已知/未知 |
| `mergeKnowledgeOwners()` / `renameKnowledgeOwner()` / `deleteKnowledgeOwner()` | 主体管理 |

**核心机制**: 每个角色维护 `knownNodeIds` (已知节点列表)、`mistakenNodeIds` (误解)、`visibilityScores` (可见度评分)，召回时通过 `computeKnowledgeGateForNode` 判断节点是否对当前视角可见。

#### [graph/story-timeline.js](file:///d:/SillyTavern/xm/st-bme/graph/story-timeline.js)

**职责**: 故事时间线——将记忆标注剧情时间，按 6 个时间桶分类。

| 时间桶 | 说明 |
|------|------|
| `current` | 当前进行中的事件 |
| `adjacentPast` | 近期过去 |
| `distantPast` | 久远过去 |
| `flashback` | 闪回/回忆 |
| `future` | 未来的计划/预言 |
| `undated` | 未经标注 |

- `STORY_TENSE_VALUES`: past / ongoing / future / flashback / hypothetical / unknown
- `resolveActiveStoryContext()`: 解析当前活跃剧情时间上下文
- `classifyStoryTemporalBucket()`: 将节点按 storyTime 归类到时间桶

#### [graph/summary-state.js](file:///d:/SillyTavern/xm/st-bme/graph/summary-state.js)

**职责**: 分级总结状态——管理 small/rollup/legacy-import 三种摘要类型。

- `createDefaultSummaryState()`: 创建默认摘要状态
- `normalizeGraphSummaryState()`: 规范化整图摘要
- 每条摘要含 level / kind / text / extractionRange / messageRange / storyTimeSpan 等属性

---

### 4.2 写入管线 (Maintenance)

#### [maintenance/extractor.js](file:///d:/SillyTavern/xm/st-bme/maintenance/extractor.js)

**职责**: LLM 记忆提取管线——分析对话→提取结构化图操作→更新图谱。

**核心流程:**
1. 构建提取 prompt (含活跃摘要/剧情时间/知识边界上下文)
2. 调用 `callLLMForJSON` 获取结构化提取结果
3. 应用 create/update/delete/link 操作到图谱
4. 更新认知边界 (`applyCognitionUpdates`) 和区域 (`applyRegionUpdates`)
5. 更新故事时间线 (`applyBatchStoryTime` / `upsertTimelineSegment`)
6. 批量 embedding 新节点
7. 建立时序合成边 (temporalLinkStrength=0.2)

**关键导出:**
- `extractMemories(graph, messages, options)`: 主提取函数 (双阶段: 客观 + 主观/POV)
- `generateReflection(graph, options)`: 反思生成

#### [maintenance/consolidator.js](file:///d:/SillyTavern/xm/st-bme/maintenance/consolidator.js)

**职责**: 统一记忆整合引擎——合并 Mem0 精确对照 + A-MEM 记忆进化。

| 冲突判定 | 行为 |
|------|------|
| `skip` | 新记忆与已有记忆完全重复，丢弃 |
| `merge` | 新记忆部分重叠，合并后覆盖旧节点 |
| `keep` | 新旧不同但需进化——分析是否揭示旧记忆的新信息，建立关联或反向更新 |

技术路线: 批量 embed → 批量查近邻 → 单次 LLM 调用完成冲突检测+进化分析。

#### [maintenance/compressor.js](file:///d:/SillyTavern/xm/st-bme/maintenance/compressor.js)

**职责**: 层级压缩引擎——超阈值同类型节点被 LLM 总结为更高层级的压缩节点。

- `compressAll(graph, schema)`: 主压缩入口
- `inspectAutoCompressionCandidates()`: 自动压缩候选检测
- `sleepCycle()`: 遗忘周期 (归档/降权低价值节点)

关键参数: `fanIn`(每次合并叶子数)、`keepRecentLeaves`(保留最近N个不压缩)、`maxDepth`(最大层级深度)

#### [maintenance/hierarchical-summary.js](file:///d:/SillyTavern/xm/st-bme/maintenance/hierarchical-summary.js)

**职责**: 分级总结执行器——小总结 (synopsis) 和总结折叠 (summary_rollup)。

- `generateSmallSummary()`: 为近期对话生成阶段性小总结
- `rollupSummaryFrontier()`: 将多条活跃总结折叠成更高层总结
- `rebuildHierarchicalSummaryState()`: 从提取批次重建 summaryState
- `runHierarchicalSummaryPostProcess()`: 总结后处理

#### [maintenance/smart-trigger.js](file:///d:/SillyTavern/xm/st-bme/maintenance/smart-trigger.js)

**职责**: 智能触发引擎——扫描未处理消息，匹配 20 个中文触发关键词 + 用户自定义正则。

| 触发关键词示例 | 突然、没想到、背叛、死亡、复活、告白、秘密、真相、反转... |
|------|------|
| `getSmartTriggerDecision(chat, lastProcessed, settings)` | 返回 `{ triggered, score, reasons }` |

#### [maintenance/chat-history.js](file:///d:/SillyTavern/xm/st-bme/maintenance/chat-history.js)

**职责**: 聊天历史工具函数——消息类型判断、楼层映射、hash 检测。

- `buildDialogueFloorMap(chat)`: 楼层到索引双向映射
- `isSystemMessageForExtraction()`: 提取时应跳过的消息类型
- `isAssistantChatMessage()` / `isDialogueAssistantMessage()`: 助手消息判断
- `resolveDirtyFloorFromMutationMeta()`: 定位历史变动的起始楼层
- `pruneProcessedMessageHashesFromFloor()`: 清理已处理消息 hash

---

### 4.3 读取管线 (Retrieval)

#### [retrieval/retriever.js](file:///d:/SillyTavern/xm/st-bme/retrieval/retriever.js)

**职责**: 三层混合检索编排——融合向量预筛 + PEDSA 图扩散 + 可选 LLM 精排。

**检索流程 (v2):**

```
解析召回输入 → 向量预筛 → 认知边界过滤
  → 记忆作用域分桶 → 时间桶过滤
  → PEDSA 扩散排序 → 混合评分
  → DPP 多样性采样 → 可选 LLM 精排
```

**关键函数:**
- `retrieve(graph, query, options)`: 主检索入口
- 内部调用链: `searchSimilar` → `diffuseAndRank` → `computeKnowledgeGateForNode` → `classifyNodeScopeBucket` → `classifyStoryTemporalBucket` → `hybridScore` → `applyDiversitySampling`

#### [retrieval/diffusion.js](file:///d:/SillyTavern/xm/st-bme/retrieval/diffusion.js)

**职责**: PEDSA 扩散激活引擎——在有向加权图上执行能量传播。

| PEDSA (Parallel Energy-Decay Spreading Activation) |
|------|
| 核心公式: `E_{t+1}(j) = Σ E_t(i) × W_ij × D_decay` |
| 每步 Top-K 剪枝，支持抑制边 (反向传播负能量) |
| 从 PeroCore Rust 移植到 JS |

- `propagateActivation(adjacencyMap, seedNodes, options)`: 扩散主函数

#### [retrieval/dynamics.js](file:///d:/SillyTavern/xm/st-bme/retrieval/dynamics.js)

**职责**: 记忆动力学——访问强化、时间衰减、混合评分。

| 函数 | 说明 |
|------|------|
| `reinforceAccess(node)` | 节点被召回后 accessCount+1、importance+0.1 (上限10)、更新 lastAccessTime |
| `timeDecayFactor(createdTime)` | 对数衰减因子 (1天≈0.93, 365天≈0.83) |
| `hybridScore({ graphScore, vectorScore, lexicalScore, importance, createdTime })` | `(normGraph×α + normVec×β + normLex×δ + normImportance×γ) × TimeDecay` |

#### [retrieval/injector.js](file:///d:/SillyTavern/xm/st-bme/retrieval/injector.js)

**职责**: 注入格式化——将检索结果格式化为分区分桶的表格注入 LLM 上下文。

- `formatInjection(retrievalResult, schema)`: 按 scopeBuckets 分区
  - Character POV → User POV → Objective Current Region → Objective Global → Core
- 每分区有特定描述 (如 User POV 注明"不等于角色已知事实")
- `estimateTokens(text)`: Token 估算

#### [retrieval/retrieval-enhancer.js](file:///d:/SillyTavern/xm/st-bme/retrieval/retrieval-enhancer.js)

**职责**: 检索增强——多意图拆分、向量结果合并、锚点共现增强、DPP 多样性采样。

| 函数 | 说明 |
|------|------|
| `splitIntentSegments(text)` | 将用户输入按标点/连接词拆分为多个意图片段分别搜索 |
| `mergeVectorResults(resultGroups)` | 合并多个向量搜索结果 |
| `applyCooccurrenceBoost()` | 锚点共现增强 |
| `applyDiversitySampling()` | DPP 多样性采样 |
| `isEligibleAnchorNode(node)` | 判断是否可作为共现锚点 |

#### [retrieval/recall-controller.js](file:///d:/SillyTavern/xm/st-bme/retrieval/recall-controller.js)

**职责**: 召回控制器——管理召回的触发时机、输入构建、持久化复用。

- `runRecallController()`: 完整召回流程
- `buildRecallRecentMessagesController()`: 构建最近消息上下文
- `buildPersistedRecallReuseResult()`: 复用已持久化召回结果

---

### 4.4 向量层 (Vector)

#### [vector/embedding.js](file:///d:/SillyTavern/xm/st-bme/vector/embedding.js)

**职责**: 外部 Embedding API 封装——调用 OpenAI 兼容 `/v1/embeddings` 接口。

- `embedText(config, text)`: 单条文本编码
- `embedBatch(config, texts)`: 批量编码 (默认 10 条/批, 最大 100)
- `searchSimilar(config, queryVector, nodeVectors)`: 暴力 cosine 相似度搜索 (JS 端)

#### [vector/vector-index.js](file:///d:/SillyTavern/xm/st-bme/vector/vector-index.js)

**职责**: 向量索引总入口——模式选择 (后端/直连/权威服务)、向量同步、状态查询。

| 导出 | 说明 |
|------|------|
| `BACKEND_VECTOR_SOURCES` | 支持向量后端: openai/openrouter/cohere/mistral/ollama/vllm 等 |
| `findSimilarNodesByText()` | 根据文本搜索相似节点 |
| `syncGraphVectorIndex()` | 同步图谱到向量索引 |
| `getVectorIndexStats()` | 获取向量索引统计 |
| `getVectorConfigFromSettings()` | 从设置中提取向量配置 |

#### [vector/vector-space.js](file:///d:/SillyTavern/xm/st-bme/vector/vector-space.js)

**职责**: 向量空间标识——确定空间的唯一性指纹。

- `deriveVectorSpace(config, observedDim)`: 计算 (provider/source/model/apiUrl) 唯一标识
- `isVectorManifestCompatible()`: 判断两个清单是否兼容
- `createVectorManifest()`: 创建向量清单

#### [vector/vector-gate.js](file:///d:/SillyTavern/xm/st-bme/vector/vector-gate.js)

**职责**: 向量就绪门禁——纯规划辅助，不执行实际向量操作。

- `planVectorReadyCheck({ hasGraph, metadataWriteAllowed, repairAttempted, dirty, configValid })`: 返回 `{ action, reason }` — skip/repair-identity/block/sync

---

### 4.5 持久化层 (Sync)

#### [sync/bme-db.js](file:///d:/SillyTavern/xm/st-bme/sync/bme-db.js)

**职责**: BmeDatabase 类——基于 Dexie.js 的 IndexedDB 封装 (Schema 版本 v1)。

| 表 | 说明 |
|------|------|
| `nodes` | 节点表 |
| `edges` | 边表 |
| `meta` | 元数据表 (historyState/vectorIndex/batchJournal/knowledgeState/regionState/timelineState/commitMarker...共 18 种 key) |
| `tombstones` | 墓碑表 (已删除节点追踪) |

- `buildPersistDelta(graph)` / `buildPersistDeltaFromGraphDirtyState()`: 构建增量持久化数据
- `buildGraphFromSnapshot(snapshot)`: 从快照还原图谱
- `buildSnapshotFromGraph(graph)`: 从图谱构建快照
- `ensureDexieLoaded()`: 确保 Dexie 加载

#### [sync/bme-chat-manager.js](file:///d:/SillyTavern/xm/st-bme/sync/bme-chat-manager.js)

**职责**: BmeChatManager 类——按 `chatId` 管理多个聊天对应的数据库实例。

- `switchChat(chatId)`: selectorKey 变化时自动关闭旧数据库，按需创建新数据库实例
- 构造函数接收 `databaseFactory` 和 `selectorKeyResolver`

#### [sync/persistence-reducer.js](file:///d:/SillyTavern/xm/st-bme/sync/persistence-reducer.js)

**职责**: 持久化确认状态机——纯函数，无 IO、无图谱变更。

**核心不变量:**
```
已确认版本 >= 排队版本 且 同一身份 且 规范 tier
⟹ pendingPersist 必须为 false
```

- `reducePersistenceStatePatch()`: 处理 ACCEPTED/QUEUED 事件
- `buildBatchPersistenceRecordFromPersistResult()`: 从持久化结果构建记录
- `planAcceptedPendingClear()`: 陈旧 pending 自动清除规划

#### [sync/graph-mutation-gate.js](file:///d:/SillyTavern/xm/st-bme/sync/graph-mutation-gate.js)

**职责**: 图谱可写性门禁——决定"现在能不能改图谱"。

- `ensureGraphMutationReady()`: 操作前总门禁
- `getGraphMutationBlockReason()`: 暂停原因文案
- `assertRecoveryChatStillActive()`: 异步恢复中校验聊天未被切换

#### [sync/graph-snapshot-schema.js](file:///d:/SillyTavern/xm/st-bme/sync/graph-snapshot-schema.js)

**职责**: 耐久快照契约——冻结顶层键 + 宽容解析，保证向前兼容。

#### [sync/graph-snapshot-upgrade.js](file:///d:/SillyTavern/xm/st-bme/sync/graph-snapshot-upgrade.js)

**职责**: 快照 upgrade-on-read 就地升级链——数据结构是"加字段"，不做大迁移。

---

### 4.6 Prompt 工程 (Prompting)

#### [prompting/prompt-builder.js](file:///d:/SillyTavern/xm/st-bme/prompting/prompt-builder.js)

**职责**: 统一 TaskPrompt 构建器——根据 TaskProfile 构建完整 prompt。

- `buildTaskPrompt(profile, context)`: 核心函数——block 排序与渲染
- `buildTaskLlmPayload()`: 构建 LLM 请求 payload (支持 system/user/assistant 多角色块编排)
- 支持 26 种 INPUT_REGEX_STAGE_BY_FIELD 变量注入
- 世界书/EJS 上下文接入

#### [prompting/prompt-profiles.js](file:///d:/SillyTavern/xm/st-bme/prompting/prompt-profiles.js)

**职责**: 任务预设管理——9 种任务类型的 CRUD。

| 任务类型 | 说明 |
|------|------|
| `extract_objective` | 客观事实提取 |
| `extract_subjective` | 主观/POV 提取 |
| `recall` | 召回上下文构建 |
| `compress` | 层级压缩 |
| `synopsis` | 小总结 |
| `summary_rollup` | 总结折叠 |
| `reflection` | 反思生成 |
| `consolidation` | 记忆整合 |
| `planner` | ENA 剧情规划 |

- `getActiveTaskProfile(type)`: 获取当前激活预设
- `upsertTaskProfile(type, profile)`: 更新/创建预设
- `BUILTIN_BLOCK_DEFINITIONS`: 内置 prompt 块定义

---

### 4.7 LLM 层 (LLM)

#### [llm/llm.js](file:///d:/SillyTavern/xm/st-bme/llm/llm.js)

**职责**: LLM 调用封装——包装 ST 的 `sendOpenAIRequest`。

| 函数 | 说明 |
|------|------|
| `callLLMForJSON(config, options)` | 核心调用：发送→解析JSON→重试→返回结构化结果 |
| `testLLMConnection(config)` | 测试连接 |
| `fetchMemoryLLMModels(config)` | 获取可用模型列表 |

**特性**: 密钥脱敏 (`redactSensitiveValue`)、超时控制 (300s)、流式空闲超时 (90s)、调试快照

---

### 4.8 运行时层 (Runtime)

#### [runtime/identity-resolver.js](file:///d:/SillyTavern/xm/st-bme/runtime/identity-resolver.js)

**职责**: 身份解析——将聊天身份按四类语义区分。

| 类别 | 含义 | 来源 | 用途 |
|------|------|------|------|
| `active/current` | 当前宿主活动聊天 | 宿主上下文 | **唯一可产出"当前聊天"的通道** |
| `graph-owner` | 图谱自带的所属身份 | 图谱 meta | 仅校验/恢复 |
| `queued` | 排队持久化的身份 | 持久化状态 | 仅校验/恢复 |
| `marker` | commit marker 的身份 | commit marker | 仅校验/恢复 |

**核心不变量**: active identity 只能来自宿主上下文。其余三类绝不能升格为活动身份。

- `resolveCurrentChatIdentityCore()`: 解析活动身份
- `resolveGraphOwnerIdentityCore()`: 解析图谱所有者身份
- `resolveRuntimeGraphFallbackIdentityCore()`: 恢复/兜底聚合

#### [runtime/runtime-state.js](file:///d:/SillyTavern/xm/st-bme/runtime/runtime-state.js)

**职责**: 图谱运行时状态规范化——含 processedMessageHashes、extractionCount、batchJournal、persistDirtyState 等。

- `createDefaultHistoryState()`: 默认历史状态
- `createDefaultVectorIndexState()`: 默认向量索引状态
- `createBatchJournalEntry()`: 批处理日志
- `detectHistoryMutation()`: 历史变动检测
- `buildReverseJournalRecoveryPlan()`: 日志回滚方案

#### [runtime/concurrency.js](file:///d:/SillyTavern/xm/st-bme/runtime/concurrency.js)

**职责**: 并发控制——strict/balanced/fast 三种执行模式。

| 模式 | 行为 |
|------|------|
| `strict` | 全串行 (最安全) |
| `balanced` | 适量并发 (推荐) |
| `fast` | 最大并发 |

- `resolveConcurrencyConfig(settings)`: 解析并发配置
- `runLimited(tasks, limit)`: 受控并发执行

#### _其他 Runtime 模块:_

| 模块 | 职责 |
|------|------|
| `generation-context.js` | 宿主生成 type 跟踪 + 父 user 楼层解析 |
| `generation-recall-transactions.js` | 生成召回事务生命周期 |
| `recall-input-state.js` | 召回 input/intent/trivial-skip 状态工厂 |
| `final-recall-injection.js` | 最终召回注入解析 |
| `auto-extraction-defer.js` | 自动提取 defer/resume |
| `settings-defaults.js` | 默认设置与持久化合并 |
| `authority-capabilities.js` | 权威服务能力探测 |
| `user-alias-utils.js` | 用户别名规范化 |

---

### 4.9 宿主层 (Host)

#### [host/event-binding.js](file:///d:/SillyTavern/xm/st-bme/host/event-binding.js)

**职责**: 在 SillyTavern 事件系统上注册 ST-BME 的钩子。

| 控制器 | 绑定事件 | 职责 |
|------|------|------|
| `registerCoreEventHooksController` | CHAT_CHANGED/LOADED/DELETED/EDITED/SWIPED/UPDATED | 核心事件生命周期 |
| `registerBeforeCombinePromptsController` | GENERATE_BEFORE_COMBINE_PROMPTS | 记忆注入入口 |
| `registerGenerationAfterCommandsController` | GENERATION_AFTER_COMMANDS | 记忆提取入口 |
| `installSendIntentHooksController` | MESSAGE_SENT/SEND | 发送意图捕获 |

#### [host/runtime-host-adapter.js](file:///d:/SillyTavern/xm/st-bme/host/runtime-host-adapter.js)

**职责**: 宿主导航器——抽象 ST/Luker 运行时差异。

- `BME_HOST_PROFILE_GENERIC_ST`: 标准 ST 宿主
- `BME_HOST_PROFILE_LUKER`: Luker 宿主
- `getBmeHostAdapter()`: 获取宿主适配器
- `normalizeBmeChatStateTarget()`: 规范化聊天目标 (单角色/群组)

---

### 4.10 UI 层 (UI)

#### [ui/panel.js](file:///d:/SillyTavern/xm/st-bme/ui/panel.js)

**职责**: 控制面板交互逻辑——集成图谱渲染、任务预设配置、向量管理、认知状态展示。

- 集成 `GraphRenderer` 可视化图谱
- 管理 9 种任务预设的 CRUD UI
- 向量配置管理 + 连接测试
- 认知状态展示 (`listKnowledgeOwners`)
- 多语言支持

#### [ui/graph-renderer.js](file:///d:/SillyTavern/xm/st-bme/ui/graph-renderer.js)

**职责**: Canvas 图谱渲染器——分区神经布局，零依赖。

| 特性 | 说明 |
|------|------|
| **分区布局** | 客观层 (左 62%) + 角色POV/用户POV (右列) |
| **类神经布局** | Vogel 初值 + 有限预算力引导动画 |
| **自适应降级** | 节点/边超阈值自动减少迭代 (220/360/520 分档) |
| **动画预算** | layoutAnimationMaxNodes=520，超过跳过动画 |
| **主题** | LIGHT_PANEL_THEMES / THEMES 切换 |

#### _其他 UI 模块:_

| 模块 | 职责 |
|------|------|
| `graph-layout-solver.js` | 布局求解；支持 Native/WASM/Worker 桥接并回退 JS |
| `graph-native-bridge.js` | Web Worker + WASM 布局桥接 |
| `recall-message-ui.js` | 用户消息下的召回卡片 UI |
| `recall-message-ui-controller.js` | 召回卡片挂载/刷新 (封装定时器/observer 状态) |
| `hide-engine.js` | 旧楼层隐藏引擎 |
| `message-render-limit.js` | 渲染楼层数量限制策略 |
| `ui-actions-controller.js` | 所有操作按钮控制器 (提取/压缩/总结/重建/导出/导入等) |
| `ui-status.js` | UI 状态管理 (批处理状态/召回记录/通知) |
| `panel-bridge.js` | 面板桥接 (live state 刷新通知) |

---

### 4.11 ENA Planner 子系统

#### [ena-planner/](file:///d:/SillyTavern/xm/st-bme/ena-planner/)

**职责**: 独立的发送前剧情规划子系统，集成到配置页和 `planner` 任务预设。

| 模块 | 职责 |
|------|------|
| `ena-planner.js` | Planner 主入口 |
| `ena-planner-presets.js` | 预设管理 |
| `ena-planner-runtime-utils.js` | 运行时工具 |
| `ena-planner-storage.js` | 存储逻辑 |
| `ena-planner-worldbook-utils.js` | 世界书工具 |
| `planner-plot-history.js` | 剧情历史记录 (`writeStructuredPlotRecordToMessage`) |

---

### 4.12 原生加速层 (Native)

#### [native/stbme-core/](file:///d:/SillyTavern/xm/st-bme/native/stbme-core/)

**职责**: Rust → WASM 加速，灰度能力。

- `src/lib.rs`: Rust 核心实现 (图操作、布局计算、向量运算)
- `Cargo.toml`: Rust 项目配置
- WASM 构建产物在 `vendor/wasm/pkg/`
- **Fail-open**: 默认失败回退 JS，可在面板强制关闭

---

## 5. 关键类与函数说明

### 5.1 BmeDatabase (数据库核心)

[sync/bme-db.js](file:///d:/SillyTavern/xm/st-bme/sync/bme-db.js)

```javascript
class BmeDatabase {
  // 基于 Dexie.js
  // 表: nodes, edges, meta, tombstones (v1)
  constructor(dbName) { ... }
  
  // 图谱操作
  async loadGraph()           → { nodes, edges, meta }
  async saveGraph(graph)      → void
  async applyDelta(delta)     → void (增量写入)
  
  // 元数据
  async getMeta(key)          → any
  async setMeta(key, value)   → void
  
  // 快照
  buildSnapshot(graph)        → Snapshot
  buildGraphFromSnapshot(s)   → Graph
}
```

### 5.2 PEDSA 扩散激活

[retrieval/diffusion.js](file:///d:/SillyTavern/xm/st-bme/retrieval/diffusion.js)

```javascript
function propagateActivation(adjacencyMap, seedNodes, options) {
  // adjacencyMap: Map<nodeId, [{ neighborId, weight, edgeType }]>
  // seedNodes: [{ nodeId, energy }]
  // options: { steps, topK, decay, inhibitoryWeight }
  
  // E_{t+1}(j) = Σ E_t(i) × W_ij × D_decay
  // 抑制边 (edgeType=255): 反向传播负能量
  // 返回: Map<nodeId, finalEnergy>
}
```

### 5.3 三层检索编排

[retrieval/retriever.js](file:///d:/SillyTavern/xm/st-bme/retrieval/retriever.js)

```javascript
async function retrieve(graph, query, options) {
  // Step 1: 向量预筛
  const candidates = await searchSimilar(queryVector, nodeVectors, topK);
  
  // Step 2: 认知边界过滤
  const visible = candidates.filter(c => computeKnowledgeGateForNode(c, currentOwner));
  
  // Step 3: 作用域分桶 + 时间桶过滤
  const scored = visible.map(c => ({
    ...c,
    scopeBucket: classifyNodeScopeBucket(c),
    timeBucket: classifyStoryTemporalBucket(c),
  }));
  
  // Step 4: PEDSA 扩散
  const diffused = propagateActivation(adjacency, scored, { steps: 3, topK: 20, decay: 0.85 });
  
  // Step 5: 混合评分
  const ranked = diffused.map(d => ({ ...d, hybridScore: hybridScore(d) }));
  
  // Step 6: DPP 多样性 + 共现增强
  const diverse = applyDiversitySampling(ranked, options.maxResults);
  
  // Step 7: 可选 LLM 精排
  return options.llmRerank ? await llmReRank(diverse, query) : diverse;
}
```

### 5.4 控制平面身份解析

[runtime/identity-resolver.js](file:///d:/SillyTavern/xm/st-bme/runtime/identity-resolver.js)

```javascript
// 四类身份通道，只 active/current 能产出"当前聊天"
resolveCurrentChatIdentityCore(context)    → active identity
resolveGraphOwnerIdentityCore(graphMeta)    → graph owner
resolveRuntimeGraphFallbackIdentityCore()   → recovery/fallback aggregation
resolvePersistenceChatIdCore(persistenceState) → persistence identity
  
// 身份等值校验
areChatIdsEquivalentForIdentityCore(a, b) → boolean
doesChatIdMatchIdentityCore(chatId, identityCore) → boolean
```

### 5.5 持久化确认状态机

[sync/persistence-reducer.js](file:///d:/SillyTavern/xm/st-bme/sync/persistence-reducer.js)

```javascript
// 纯函数状态机
reducePersistenceStatePatch(state, event) → newState

// 事件类型
PERSISTENCE_EVENT_TYPES = {
  ACCEPTED: 'accepted',   // 数据已安全落地
  QUEUED: 'queued',       // 正在写入中
  PENDING_CLEARED: 'pending_cleared', // 陈旧 pending 已清除
}

// 核心不变量: 规范 tier 已确认 → pendingPersist 必须为 false
```

---

## 6. 数据流与核心流程

### 6.1 写入流程 (对话 → 知识图谱)

```
AI Assistant 回复落地
  │
  ├── GENERATION_AFTER_COMMANDS 事件触发
  │
  ├── getSmartTriggerDecision → 智能触发判断
  │     └── 扫描未处理消息 → 关键词匹配 → 自定义正则匹配
  │
  ├── [若触发] runExtractionController
  │     │
  │     ├── 构建结构化提取输入 (排除 think/analysis/reasoning 标签)
  │     │
  │     ├── 客观提取 (extract_objective)
  │     │     └── callLLMForJSON → 返回 create/update/delete/link 操作列表
  │     │
  │     ├── 主观/POV 提取 (extract_subjective)
  │     │     └── 按角色视角分别提取
  │     │
  │     ├── applyCognitionUpdates → 更新认知边界
  │     ├── applyRegionUpdates → 更新区域状态
  │     ├── applyBatchStoryTime → 更新故事时间线
  │     │
  │     └── syncGraphVectorIndex → 新节点批量 embedding
  │
  ├── [后处理] 整合 / 压缩 / 总结 / 反思
  │     ├── consolidateMemories → 去重整合 (Mem0对照 + 进化)
  │     ├── compressAll → 层级压缩 (超阈值节点合并)
  │     ├── generateSmallSummary → 小总结
  │     └── generateReflection → 反思生成
  │
  └── 持久化 → saveGraphToChat + atomic commit marker
```

### 6.2 读取流程 (图谱 → LLM 上下文注入)

```
GENERATE_BEFORE_COMBINE_PROMPTS 事件触发
  │
  ├── resolveRecallInputController → 解析召回输入
  │     ├── 是否为 override 模式?
  │     ├── 是否有持久召回记录可复用?
  │     └── 构建用户输入文本 (发送意图 / 聊天尾部用户楼层)
  │
  ├── [非复用] 执行新检索
  │     │
  │     ├── splitIntentSegments → 多意图拆分 (并行分片检索)
  │     │
  │     ├── 向量预筛 (每片)
  │     │     └── searchSimilar → cosine 相似度 top-K
  │     │
  │     ├── mergeVectorResults → 合并多片结果
  │     │
  │     ├── 认知边界过滤
  │     │     └── computeKnowledgeGateForNode → 角色不知道的跳过
  │     │
  │     ├── 作用域分桶
  │     │     └── classifyNodeScopeBucket → 6 桶加权
  │     │
  │     ├── PEDSA 扩散排序
  │     │     └── propagateActivation → 图能量传播再排序
  │     │
  │     ├── 混合评分
  │     │     └── hybridScore = (图分×α + 向量分×β + 词法分×δ + 重要度×γ) × 时间衰减
  │     │
  │     ├── DPP 多样性采样 + 锚点共现增强
  │     │
  │     └── [可选] LLM 精排
  │
  ├── 访问强化 → reinforceAccess (召回节点 accessCount++)
  │
  ├── formatInjection → 分区分桶注入格式化
  │     └── [Character POV] → [User POV] → [Objective Region] → [Global] → [Core]
  │
  ├── injectPrompts → 注入 LLM 上下文
  │
  └── writePersistedRecallToUserMessage → 写入持久召回卡片
```

### 6.3 安全流程 (历史变动 → 恢复)

```
MESSAGE_DELETED / MESSAGE_EDITED / MESSAGE_SWIPED 事件触发
  │
  ├── detectHistoryMutation → 消息 hash 比对
  │     └── 已处理消息 hash 列表 vs 当前消息 hash
  │
  ├── resolveDirtyFloorFromMutationMeta → 定位受影响起始楼层
  │
  ├── buildReverseJournalRecoveryPlan → 优先日志回滚
  │     ├── 有足够日志 → 逆向回放 (精确恢复)
  │     └── 日志不足 → 退化为全量重建 (从变动点重提取)
  │
  ├── applyGraphLoadState → 应用恢复状态
  │     └── Restore Lock → 恢复期间阻断图谱变更
  │
  └── 恢复完成 → 清除 dirty 标记 → 开放图谱操作
```

---

## 7. 关键数据结构

### 7.1 Graph (图谱)
```javascript
{
  version: 9,
  nodes: [
    {
      id: "uuid",                    // UUID 唯一标识
      type: "event",                 // 节点类型 (event/character/location/rule/thread/synopsis/reflection)
      fields: {                      // 类型相关字段 (由 Schema 定义)
        title: "矿洞探秘",
        summary: "阿明在矿洞中发现...",
        participants: "阿明, 老张",
        status: "ongoing"
      },
      seq: 42,                        // 创建序号
      importance: 7.5,                // 重要度 (0-10)
      accessCount: 3,                 // 被召回次数
      createdTime: "ISO8601",         // 真实创建时间
      storyTime: {                    // 故事时间点 / 时间段
        segmentId: 5,
        label: "Day 1·下午",
        tense: "past",
        confidence: 0.9
      },
      scope: {                        // 记忆作用域
        layer: "character_pov",       // objective / character_pov / user_pov
        owner: "character:阿明",
        region: "北山矿洞"
      },
      prevId: null,                   // 时间链表前驱
      nextId: "uuid_of_next",         // 时间链表后继
      archived: false,                // 归档标记 (物理不删除)
      extra: {}                       // 扩展字段
    }
  ],
  edges: [
    {
      id: "edge_uuid",
      source: "node_uuid_1",
      target: "node_uuid_2",
      relation: "related",            // 关系类型
      edgeType: 0,                    // 0=普通 255=抑制
      strength: 0.25,                 // 关系强度 (0-1)
      scope: { ... }                  // 边作用域
    }
  ],
  // 子状态 (通过 graph meta 持久化)
  knowledgeState: {                   // 认知状态
    owners: {
      "character:阿明": {            // 知识主体
        knownNodeIds: ["n1", "n2"],  // 已知节点
        mistakenNodeIds: [],         // 误解节点
        visibilityScores: { "n1": 0.9 },  // 可见度评分
      }
    },
    activeRegions: { ... }           // 活跃区域
  },
  timelineState: {                    // 时间线状态
    segments: [...],                  // 时间段
  },
  summaryState: {                     // 总结状态
    entries: [...],                   // 摘要条目
    activeEntryIds: [...]
  }
}
```

### 7.2 Recall Result (检索结果)
```javascript
{
  results: [
    {
      node: { ... },                  // 匹配的图谱节点
      graphScore: 0.72,               // 图扩散分
      vectorScore: 0.85,              // 向量相似度分
      lexicalScore: 0.60,             // 词法匹配分
      hybridScore: 0.74,              // 混合总分
      scopeBucket: "characterPov",    // 作用域桶
      timeBucket: "adjacentPast",     // 时间桶
      stripe: { ... }                 // 认知门禁条带
    }
  ],
  injectionText: "...",               // 格式化注入文本
  sourceLabel: "user_message",        // 召回来源标签
  timings: { ... }                    // 各阶段耗时
}
```

### 7.3 TaskProfile (任务预设)
```javascript
{
  type: "extract_objective",
  label: "客观提取",
  enabled: true,
  llmPreset: { model: "...", temperature: 0.1, maxTokens: 4096 },
  blocks: [
    { role: "system", content: "你是一个记忆提取引擎..." },
    { role: "user", content: "{{#each recentMessages}}{{role}}: {{content}}\n{{/each}}" },
  ],
  regex: { patterns: [...], global: true },
  worldbook: { key: "...", allowWildcard: false },
  ejs: { template: "...", enabled: false }
}
```

---

## 8. 依赖关系图

### 8.1 模块间依赖

```
index.js (Composition Root)
  ├── graph/
  │     ├── graph.js             (最底层，无内部依赖)
  │     ├── schema.js            (无内部 graph 依赖)
  │     ├── graph-persistence.js (依赖 graph.js)
  │     │     └── 被 sync/ 全部模块依赖
  │     ├── memory-scope.js      (无内部 graph 依赖)
  │     ├── knowledge-state.js   (依赖 memory-scope.js, user-alias-utils.js)
  │     ├── story-timeline.js    (无内部 graph 依赖)
  │     ├── summary-state.js     (无内部 graph 依赖)
  │     └── node-labels.js       (依赖 schema.js)
  │
  ├── maintenance/
  │     ├── extractor.js         (依赖 graph/*, llm/llm.js, vector/*, prompting/*)
  │     ├── consolidator.js      (依赖 graph/*, llm/llm.js, vector/*)
  │     ├── compressor.js        (依赖 graph/*, llm/llm.js)
  │     ├── hierarchical-summary.js (依赖 graph/*, llm/llm.js)
  │     ├── extraction-controller.js (依赖 extractor.js, smart-trigger.js, chat-history.js)
  │     ├── smart-trigger.js     (无内部 maintenance 依赖)
  │     └── chat-history.js      (无内部 maintenance 依赖)
  │
  ├── retrieval/
  │     ├── retriever.js         (依赖 graph/*, vector/*, diffusion.js, dynamics.js, enhancer.js)
  │     ├── diffusion.js         (无内部 retrieval 依赖)
  │     ├── dynamics.js          (无内部 retrieval 依赖)
  │     ├── injector.js          (依赖 graph/schema.js, memory-scope.js)
  │     ├── recall-controller.js (依赖 retriever.js, recall-persistence.js)
  │     ├── retrieval-enhancer.js (依赖 retriever.js, vector/*)
  │     └── recall-persistence.js (无内部 retrieval 依赖)
  │
  ├── vector/
  │     ├── embedding.js         (无内部 vector 依赖)
  │     ├── vector-index.js      (依赖 embedding.js, vector-space.js)
  │     └── vector-space.js      (无内部 vector 依赖)
  │
  ├── sync/
  │     ├── bme-db.js            (依赖 Dexie, graph/*)
  │     ├── bme-chat-manager.js  (依赖 bme-db.js)
  │     ├── bme-sync.js          (依赖 bme-chat-manager.js, bme-opfs-store.js)
  │     ├── persistence-reducer.js (纯函数，无内部 sync 依赖)
  │     ├── graph-mutation-gate.js (依赖 graph-persistence.js)
  │     └── graph-persistence-io.js (依赖 bme-db.js, bme-opfs-store.js)
  │
  ├── prompting/
  │     ├── prompt-builder.js    (依赖 prompt-profiles.js)
  │     ├── prompt-profiles.js   (依赖 default-task-profile-templates.js)
  │     └── task-regex/worldinfo/ejs.js (独立模块)
  │
  ├── runtime/
  │     ├── identity-resolver.js (纯逻辑，无内部 runtime 依赖)
  │     ├── runtime-state.js     (依赖 graph/*)
  │     ├── concurrency.js       (纯逻辑)
  │     └── settings-defaults.js (纯数据)
  │
  ├── host/
  │     ├── event-binding.js     (依赖 runtime/*)
  │     └── runtime-host-adapter.js (依赖 host/adapter/*)
  │
  └── ui/
        ├── panel.js             (依赖 graph/*, prompting/*, ui/*, i18n/*)
        ├── graph-renderer.js    (依赖 graph/*, graph-layout-solver.js)
        └── ui-actions-controller.js (集成所有操作入口)
```

### 8.2 外部依赖

| 依赖 | 用途 | 必需 |
|------|------|------|
| `SillyTavern` (全局) | 宿主运行时 API (上下文、事件、生成) | 是 |
| `Dexie.js` (vendor) | IndexedDB 封装 | 是 |
| `EJS` (vendor) | 模板引擎 (任务预设 EJS 模式) | 否 |
| `js-yaml` (vendor) | YAML 解析 (配置/测试用例) | 否 |
| `triviumdb` (npm) | 权威服务客户端 | 否 (可选) |
| `WASM (stbme_core_pkg)` | 原生加速 | 否 (fail-open) |

---

## 9. 构建与运行

### 安装方式

**方法一: ST 扩展市场**
```
SillyTavern → 扩展管理 → 安装第三方扩展
仓库地址: https://github.com/Youzini-afk/ST-Bionic-Memory-Ecology
```

**方法二: 手动安装**
```bash
cd SillyTavern/data/default-user/extensions/third-party
git clone https://github.com/Youzini-afk/ST-Bionic-Memory-Ecology.git st-bme
```

### 构建

Native/WASM 加速是可选的灰度能力：

```bash
npm run build:native:wasm     # 构建 Rust → WASM
```

### 测试

```bash
npm run test:stable            # 运行稳定回归测试套件
npm run test:p0                # P0 关键路径测试
npm run test:persistence-matrix # 持久化矩阵测试
npm run test:authority:e2e:all # 端到端权威服务测试
npm run check                  # 语法检查
```

### 运行环境要求

- SillyTavern (>= 1.12.x)
- 现代浏览器 (支持 IndexedDB / OPFS / Canvas 2D)
- LLM API (OpenAI 兼容)
- Embedding API (可选但强烈推荐，用于向量召回)
- 可选: Native WASM 需 `vendor/wasm/pkg/stbme_core_pkg_bg.wasm`

### 存储

| 存储 | 用途 |
|------|------|
| IndexedDB `STBME_{chatId}` | 主图谱存储 (nodes/edges/meta 表) |
| OPFS (Origin Private File System) | Luker sidecar / 高性能替代存储 |
| SillyTavern ChatState | ST 原生聊天状态 (Luker checkpoint) |
| SillyTavern 文件 API | 云端镜像备份 (`st-bme-settings.json`) |
| Authority Server | 可选权威图谱服务 |

### 最小可用配置

1. 启用插件主开关
2. 保证当前聊天模型可用 (记忆 LLM 留空时复用)
3. [推荐] 配置 Embedding (否则召回质量明显下降)

---

## 10. 差异化对比：ST-BME vs NE-Memory

| 维度 | ST-BME (Bionic Memory Ecology) | NE-Memory Engine |
|------|------|------|
| **运行载体** | ST 第三方扩展 (manifest.json) | Tavern Helper 脚本 (CDN IIFE) |
| **记忆模型** | 知识图谱 (节点+边+多维度状态) | 扁平结构化 Vault (STM/LTM 列表) |
| **认知架构** | RoleRAG: 每角色独立知识状态 + 作用域分桶 + 区域权重 | 无独立角色知识边界 |
| **时间线** | 6 个时间桶 (current/past/flashback/future...) + 时间衰减 | 简单的 story_time/story_scene/story_date |
| **检索排序** | PEDSA 扩散激活 + 混合评分 + DPP 多样性 + LLM 精排 | BM25 全文检索 (浏览器内嵌) |
| **向量检索** | 外部 Embedding API (多种后端) | 无向量能力 |
| **注入格式化** | 分区分桶表格 (按 POV/区域/全局) | 扁平列表 + 检索合成文本 |
| **图谱可视化** | Canvas 力导向图谱 (分区神经布局) | 无内置图谱 |
| **任务系统** | TaskProfile 9种类型 (正则/世界书/EJS) | 固定 Pipeline (无预设系统) |
| **历史安全** | 消息 hash + 日志回滚 + 全量重建 | 游标增量 + 崩溃恢复 |
| **存档策略** | IndexedDB/OPFS 双层 + 云端镜像 + 权威服务 | 单一 IndexedDB |
| **提示词注入** | SmartPush (分区分桶注入) + 持久召回卡片 | SmartPush (格式化摘要注入) |
| **分布式/权威服务** | Authority Server/TriviumDB (多客户端同步) | 无 |
| **原生加速** | Rust→WASM 灰度加速 (fail-open) | 无 |
| **并发控制** | strict/balanced/fast 三种模式 | 简单并发守卫 |
| **扩展方式** | ST 原生扩展 API | TH iframe 沙箱 |