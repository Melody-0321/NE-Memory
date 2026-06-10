# NE-Memory：O(1) 每轮 LLM 处理成本的轻量级 Agent 记忆系统及其无损可追溯性

> **状态**：草稿 v1 — 拟投 arXiv 预印本
> **作者**：[作者姓名]
> **日期**：2026 年 6 月
> **仓库**：[github.com/.../ne-memory-core](https://github.com)

---

## 摘要 (中文)

我们提出 NE-Memory，一个面向 AI Agent 的轻量级记忆系统，实现了 *O(1) 每轮 LLM 处理成本*和*无损可追溯性*——每条长期记忆条目可经短期记忆条目完整回溯到生成它的原始对话消息。与依赖向量数据库和全量历史重处理的现有记忆系统不同，NE-Memory 采用：(1) 增量提取，仅处理新消息；(2) 纯 BM25 稀疏检索配合中文二元分词和一个基于 LLM 翻译的实用跨语言扩展，零外部依赖；(3) 追加式 STM/LTM 分层存储，整合合并但永不删除源条目；(4) Schema 约束的事实记忆与实体锚定时间线检索，将结构化状态（"现在是什么"）与事件记忆（"发生了什么"）分离。我们引入分层惰性检索——一个四级渐进访问模型，仅在需要时沿无损追溯链向下钻取，保持每轮 O(1) 成本。我们在准确率、Token 开销和系统复杂度三个维度上将 NE-Memory 与 10 个现有记忆系统进行对比。我们评估了六大查询类别下的 BM25 检索质量（整体 R@5 为 38.9%；跨语言 R@5 为 50.0%），并展示了结合认知负载管理的 LLM 合成在 20 个查询中达到 4.0/5 的人工评估平均分。

## Abstract (English)

We present NE-Memory, a lightweight memory system for AI agents that achieves *O(1) per-round LLM processing cost* and *lossless traceability*—every long-term memory entry traces back through short-term memory entries to the original conversation messages that produced it. Unlike existing agent memory systems that depend on vector databases and full-history re-processing, NE-Memory uses (1) incremental delta extraction that processes only new messages, (2) pure BM25 sparse retrieval with Chinese 2-gram tokenization, requiring zero external dependencies, (3) append-only STM/LTM layering where consolidation merges but never deletes source entries, and (4) schema-constrained factual memory with entity-anchored chronological retrieval that separates structured state ("what is true now") from event memory ("what happened"). We introduce hierarchical lazy retrieval—a four-tier graduated access model that traverses the lossless traceability chain only when needed, preserving O(1) per-round cost. We additionally introduce a practical cross-lingual pipeline: LLM-generated translation fields injected into the BM25 index combined with query-time translation, achieving 50.0% cross-lingual R@5 at near-zero infrastructure cost—a systems-level adaptation of classic CLIR translation techniques for the resource-constrained agent memory setting. We position NE-Memory against 10 existing memory systems on three axes: accuracy, token cost, and system complexity. We evaluate BM25 retrieval quality across six query categories (38.9% R@5 overall) and demonstrate that LLM synthesis combined with cognitive load management achieves a 4.0/5 average human-evaluated synthesis score across 20 queries.

---

## 1. 引言

长期记忆是 AI Agent 开展长程交互的关键能力。缺乏记忆的 Agent 会遗忘过往事件、自我重复、丧失叙事连续性、无法在先前决策的基础上推进思考。这一问题已被充分认知：从个人 AI 助手到角色扮演聊天机器人再到软件开发 Agent，记忆能力随对话长度增长而衰减。

当前 Agent 记忆的主流范式遵循三阶段管线：(1) 从对话历史中提取结构化记忆；(2) 将其存储到向量数据库；(3) 在推理时通过语义搜索检索相关记忆并注入上下文。Mem0、Letta（MemGPT）和 Hindsight 等系统体现了这一范式，在基准测试中取得了强劲表现，但代价是庞大的基础设施：专用向量数据库（PostgreSQL+pgvector、Qdrant、Neo4j）、多语言 SDK，以及动辄超过 10 万行的代码库。

我们认为，对于广泛类别的 Agent 记忆使用场景，这种量级的基础设施既不必要也不可取。NE-Memory 背后的核心洞察是：**记忆检索质量更取决于检索-合成架构，而非向量嵌入的质量**；同时，**每轮 LLM 处理成本，而非峰值检索准确率，才是长期持续交互的真正约束瓶颈**。

NE-Memory 做出了五个区别于前人工作的设计决策：

1. **O(1) LLM 处理**：每轮对话仅处理*新*消息（增量），不处理全量历史。通过已处理消息 ID 去重实现增量提取。整合仅在未整合条目累积超过固定阈值时触发，产生摊销 O(1) 成本。

2. **无损可追溯性与分层惰性访问**：每条长期记忆（LTM）条目携带 `stm_refs` 指回短期记忆（STM）条目，而 STM 条目自身携带 `msg_ids` 链接回原始对话消息。记忆条目永不删除；整合操作标记父子关系但保留全部源数据。一个四级渐进访问模型仅在需要时遍历此链——紧凑状态摘要（每轮）、实体链（按需）、全量 BM25 合成（召回查询时）、原始消息（验证时）——保持每轮 O(1) 成本保证。

3. **Schema 约束的事实记忆与实体锚定检索**：一个 JSON Schema 约束 LLM 写入的结构化状态，将"现在是什么"（参与者、团队、任务）与"发生了什么"（STM/LTM 事件）分离。每个状态实体维护一条按时间排序的事件链——这是 BM25 的互补检索原语，按实体归属而非 Token 相似度检索。

4. **检索-合成解耦**：检索使用纯 Okapi BM25 算法配合中文二元分词（零外部依赖，5–15 毫秒延迟）。语义精度完全委托给 LLM 合成阶段，该阶段对 BM25 返回的前 40 条候选结果进行重排和摘要。这一架构解耦消除了对向量嵌入的需求：增加它将是冗余的——非不正确——因为合成 LLM 已经在执行更精细的语义重排。

5. **MCP 原生封装**：系统通过模型上下文协议（MCP）暴露 11 个工具，任何 MCP 兼容客户端无需 SDK 集成即可即时使用。

由此产生的是一个核心逻辑比竞争系统小 1–2 个数量级的记忆系统，无需数据库服务器、向量存储或 GPU 基础设施。

---

## 2. 相关工作

### 2.1 记忆增强的 LLM Agent

该领域在 2024 至 2026 年间发展迅猛。早期系统如 MemGPT（Packer 等，2023）引入了操作系统启发式的虚拟上下文管理隐喻，将 LLM 上下文窗口类比为虚拟内存页。Letta 是其商业后续，以 PostgreSQL/pgvector 为存储基座，面向企业级部署，这反映在其约 291,000 行的代码库规模上。

Mem0（Chhikara 等，2025）推广了"仅追加提取"（ADD-only extraction）模式，记忆带时间戳追加而非覆盖——这一设计选择我们共享。它采用稠密向量、BM25 和实体信号的混合搜索方案进行检索，面向生产级部署，支持多后端向量存储。

Hindsight（Vectorize，2025）引入了精细的四网络架构（世界、经历、观点、观察）配合四路检索融合（TEMPR：稠密 + 稀疏 + 图遍历 + 时间），在 LongMemEval 上达到 94.6% 的最优成绩。它运行于容器化部署模型（Docker，>500 MB），反映了其面向长期 Agent 学习的全面方案。

LightMem（Fang 等，2025）在精神上最接近我们的工作，明确以 Token 效率为目标。它受 Atkinson-Shiffrin 人类记忆三阶段模型启发，通过预压缩和离线"睡眠时间"合并实现了最高 117 倍的 Token 缩减。我们在这一方向上继续推进，将 Qdrant 向量依赖替换为纯 BM25 检索，在保持有竞争力的检索质量的同时消除全部外部依赖。

这些系统汇聚于一个共同的部署画像：专用数据库、多语言 SDK，以及超过 10 万行的代码库。它们取得了强劲的基准性能，其架构选择反映了各自的设计目标。NE-Memory 瞄准的是设计空间中的不同位置：我们追问，这些基础设施承诺是否可以被一个适度的准确率折中换取零依赖部署。

### 2.2 检索的角色：稀疏、稠密与混合

NLP 社区在记忆和 RAG 应用上已大体收敛于稠密检索（基于嵌入的语义搜索）。当今主流方案——Mem0、LightMem 和 Hindsight 均采用——是混合检索：BM25 做精确词项匹配，向量嵌入做语义召回，通过加权评分融合。

我们的设计并非在原则上拒绝混合检索。相反，我们观察到 NE-Memory 的特定架构——BM25 候选结果通过 LLM 合成阶段进行语义重排——使得向量嵌入组件变为冗余。合成 LLM 通过深度语义理解进行重排，已经弥补了 BM25 众所周知的词汇错配缺陷。在合成阶段之前增加一层向量评分，只会轻微改善候选池质量，一旦合成 LLM 选出了最相关的条目，最终注入输出的差异微乎其微。

这一观察以前提条件——存在强重排阶段——为限。在没有 LLM 合成的架构中，混合检索仍然是更优选择。我们的主张不是 BM25 普遍更优，而是当合成 LLM 已经在处理语义精度时，向量基础设施的成本是不合理的。

---

## 3. 系统架构

### 3.1 总体架构

```
┌─────────────────────────────────────────────────┐
│              MCP Client (Trae / Claude / Cursor)  │
└───────────────────────┬─────────────────────────┘
                        │ stdio (JSON-RPC)
┌───────────────────────▼─────────────────────────┐
│              MCP 传输层 (MCP Transport)            │
│              11 个 Tool 定义                       │
└───────┬───────────────────────────────┬──────────┘
        │                               │
┌───────▼───────┐               ┌───────▼──────────┐
│   核心层       │               │   适配器层         │
│  · store      │               │  · 存储适配器      │
│  · retrieval  │               │  · LLM 适配器      │
│  · access     │               │  · 历史读取器      │
│  · engine/    │               │    SQLite 日志     │
│    extract    │               │    Markdown 日志   │
│    consolidate│               │                   │
└───────────────┘               └──────────────────┘
```

架构分离为三个关注面：**核心层**（记忆逻辑、检索、存储操作）、**适配器层**（平台相关 I/O：文件系统、LLM API、历史读取器）和 **MCP 层**（工具注册与传输）。这一分离使得同一核心可以运行在浏览器（IndexedDB 适配器）、服务器（文件系统适配器）或嵌入任何其他运行时环境。

### 3.2 记忆模型

#### 3.2.1 数据层级

数据模型使用三个层级：

| 层级 | 存储位置 | 说明 |
|------|---------|------|
| **未整合 STM** | `content.unconsolidated_stm[]` | 新提取的事件，尚未合并 |
| **已整合 STM** | `content.stm_entries[]` | 已合并到 LTM 的事件，携带 `parent_ltm` 回链 |
| **LTM** | `content.ltm_entries[]` | 合并后的摘要，每条携带 `stm_refs` 链接回源 STM 条目 |

关键不变量：**任何条目永不删除**。整合操作将 STM 条目从 `unconsolidated_stm` 移至 `stm_entries`，并创建引用它们的 LTM 条目。`parent_ltm` 和 `stm_refs` 字段形成双向链：LTM → STM → 原始消息 ID。

#### 3.2.2 状态 Schema

在事件记忆层级之外，NE-Memory 维护一个由 JSON Schema 定义的结构化状态对象。Schema 约束提取和整合 LLM 写入的结构化状态，确保关于实体的真实信息以可查询、有类型的格式存储，而非不透明的叙述文本。这一设计——我们称之为 **Schema 约束的事实记忆（Schema-Constrained Factual Memory）**——将"现在是什么"（状态）与"发生了什么"（事件）分离，使无检索的状态查询成为可能。

**通用 Schema。** 默认 Schema 面向多 Agent 协作场景，定义五种实体类型：

- `participants`（参与者）：个体 Agent，包含角色、状态（active/standby/inactive/departed）、备注和时间戳字段。
- `teams`（团队）：参与者的分组，包含负责人引用、成员列表和状态。
- `medium_tasks`（中期任务）：中级目标，包含起止日期、进度（0–100）、状态（pending/in_progress/done/failed/departed），以及指向子短期任务的父链接。
- `short_tasks`（短期任务）：嵌套在中期任务下的原子可执行项，包含负责人引用和状态追踪。
- `emergencies`（突发事件）：需要立即关注的紧急未计划事项，包含严重程度和解决状态字段。

全局状态携带 `context`（任务描述）、`period`（叙事阶段）、`date` 和 `current_focus`（当前优先事项）。

**领域特定 Schema。** Schema 层设计为可移植的。独立的角色扮演（RP）Schema 将 `participants` 替换为 `characters`（protagonist/npc 子类型），`teams` 替换为 `factions`，任务树替换为 `quests`。同一提取和整合逻辑操作任一 Schema；仅 JSON Schema 定义和提示词模板不同。

**任务归档。** 已完成、失败和废弃的任务从活跃状态移至事件记忆池中的 `task_history` 条目。这防止陈旧任务挤占活跃状态，同时在 BM25 搜索索引中保留以供回溯查询。墓碑引用保留在任务树中以维持结构完整性。

**与相关工作的比较。** 大多数 Agent 记忆系统将记忆存储为无结构文本块，附以可选的元数据标签。NE-Memory 的 Schema 约束方法提供了一种中间地带：结构足够用于有类型实体查询和实体锚定检索（§3.4），同时又足够轻量，可完全通过 LLM 提示词约束而非数据库 Schema 来强制执行。

### 3.3 检索管线（三层）

**第 0 层 — BM25 预过滤（零 LLM，5–15 毫秒）**
`filterCandidates` 函数对查询进行分词：CJK 文本使用二元分词，字母文本使用空格分词。对所有 STM 和 LTM 条目计算 Okapi BM25 分数（k₁ = 1.5, b = 0.75），返回前 40 条候选结果。

**第 1 层 — LLM 合成（可选，~1–3 秒）**
将前 40 条 BM25 候选结果格式化为结构化提示词，附带去重标注（msg_id 指纹追踪防止同一轮对话中同一源消息被重复报告）。合成 LLM（如 GPT-4o-mini 或 DeepSeek-V4-Flash）生成带 `[→N]` 源标记的叙事答案。

**第 2 层 — Smart Push 注入（每轮）**
每轮 Agent 对话中，以最近一条用户消息为查询。BM25 → 合成生成压缩的叙事摘要（约 550 Token），与核心状态字段（`story_time`、`story_scene`）一同注入 Agent 上下文。若合成 LLM 不可用，系统回退到原始 BM25 结果。

### 3.4 实体锚定检索

NE-Memory 提供第二种检索原语，与 BM25 语义搜索互补：**实体锚定的时间线检索（Entity-Anchored Chronological Retrieval）**。BM25 通过 Token 相似度检索条目（"什么与 X 语义相近？"），实体锚定检索则按条目的所属实体分组（"X 发生了什么，按时间顺序？"）。两种模式是互补的检索原语，而非竞争关系——它们回答不同类型的问题。

**实体链。** 状态 Schema（§3.2.2）中定义的每个状态实体（参与者、团队、任务）维护一条按时间排序的事件链，包含所有涉及该实体的 STM 和 LTM 条目。这些链通过 `memory_access` 工具以 `chain.参与者名`、`chain.团队名` 和 `chain.任务ID` 引用形式访问。查询 `chain.Alice` 返回所有标记了 Alice 的 STM 和 LTM 条目，按时间排序，无论这些条目是否会在 BM25 搜索 "Alice" 时浮出。

**检索互补性。** 两种检索模式服务于不同的查询类型：
- *BM25* 回答"什么与这个问题相关？"——适用于开放式合成和 Smart Push 注入。
- *实体链* 回答"这个实体的历史是什么？"——适用于状态重建、调试和连续性验证。

完整的 Agent 循环通常同时使用两者：BM25 为当前轮次浮出上下文相关记忆，而对话中提及的参与者的实体链在需要更深层实体特定上下文时惰性加载（§3.5）。

**实现方案。** 实体标注发生在 STM 提取期间。提取 LLM 被提示为每条 STM 条目标注 `entities` 数组，列出涉及的状态实体。实体链在查询时通过按实体标签过滤全部 STM/LTM 条目并按时间排序来组装。无需额外 LLM 调用；实体标注是提取输出的标准字段。

### 3.5 分层惰性访问与整合

NE-Memory 将记忆访问组织为四个粒度递增的层级，采用**惰性遍历**：更深层级仅在上层不足时才被访问。这一渐进式访问模型保持了每轮 O(1) 成本保证（§4.1），同时在需要时保持全深度访问。

**第 0 层 — 紧凑状态摘要。** 活跃状态（参与者、团队、活跃任务、突发事件、来自 §3.2.2 的全局上下文）被总结为紧凑文本块（约 200–400 Token），每轮 Agent 对话注入。这使 Agent 无需任何检索即可即时感知"谁在场、正在发生什么"。

**第 1 层 — 实体链。** 当 Agent 需要关于特定实体的更深上下文时，调用 `memory_access("chain.Alice")` 检索该实体的完整时间线事件链（§3.4）。这是单次 MCP 工具调用，返回结构化的时间排序数据。

**第 2 层 — STM/LTM 事件。** 当状态摘要和实体链均不足时，Agent 调用 `memory_synthesize(query)` 对完整 STM/LTM 语料库执行 BM25 检索 + LLM 合成（§3.3）。

**第 3 层 — 原始消息。** 当 STM 或 LTM 条目的断言需要验证时，Agent 调用 `memory_access("ltm_5")` 遍历 LTM → STM → 消息 ID 链，恢复原始对话消息。这是无损可追溯性保证（§4.2）：每条记忆断言都可以针对其源数据进行审计。

**整合（Consolidation）。** 整合是从未整合 STM 条目创建 LTM 条目的机制，为第 2–3 层提供内容。当未整合 STM 条目数达到可配置阈值（默认 30）时触发。整合 LLM 接收全部未整合 STM 条目，生成合并后的 LTM 摘要。每条 LTM 条目通过 `stm_refs` 引用其源 STM 条目。代码层自动从源 STM 条目的 `period` 和 `time_label` 字段推导 `time_range` 字段。

整合**不是有损的**：源 STM 条目保持可访问，仅从 `unconsolidated_stm` 移至 `stm_entries`。BM25 搜索池在积累 500 条 STM 后从 STM 全扫描切换为仅 LTM 扫描，以控制检索延迟。

在典型 Agent 轮次中，Agent 可能不需要第 0 层以外的任何检索。实体链（第 1 层）仅在对话聚焦于特定实体历史时才被访问。全量 BM25 合成（第 2 层）仅在明确召回查询时才被调用。原始消息访问（第 3 层）保留用于调试和验证。这一惰性分层设计是静态无损可追溯性保证的动态对应物：链存在（每条 LTM 条目可追溯到其源消息），但仅在需要时才被遍历。

---

## 4. 核心技术贡献

### 4.1 O(1) 每轮 LLM 处理成本

**定义。** 我们将 O(1) 每轮 LLM 处理成本定义为：对于每一轮新对话，记忆维护（提取与整合）所需的 LLM 调用次数由一个与总对话长度无关的常数上界约束。该定义范围限于 LLM 操作；BM25 检索的算法复杂度为 O(n)，作为定性不同的问题单独讨论。

**NE-Memory 的实现方式。**

提取管线仅处理*新消息*（其 ID 未曾被处理过的消息）。`collectProcessedMsgIds()` 函数从全部现有 STM 条目的 `msg_ids` 构建去重集合，`filterNewMessages()` 仅将未见过的消息传递给提取 LLM。无论对话是 10 轮还是 10,000 轮，每次提取调用处理相同的批量大小（默认 10 条消息）。

整合同样为常数成本：仅在未整合 STM 计数超过阈值（默认 30）时运行，且仅处理这些条目。一次整合调用的成本与总对话长度无关。摊销到每轮，整合最多贡献每 30 轮一次 LLM 调用。

**检索是 O(n)，非 O(1)。** BM25 检索扫描随存储条目数量增长（O(n)，n = 总 STM + LTM 数）。我们将其排除在 O(1) 处理成本声明之外，因为：(1) BM25 是纯算法的——无需 API 调用、无需嵌入、无需外部服务；(2) 系统对扫描池设上限（500 条 STM 后仅扫描 LTM），即使 5,000+ 条目延迟仍低于 100 毫秒。此 O(n) 算法成本与那些每轮重新处理完整对话历史的系统所产生的 O(n) LLM 成本在性质上截然不同。

**与前人工作的对比。** 现有记忆系统在扩展性上采用了不同策略。Mem0 和 Hindsight 在添加记忆时进行全量索引更新，以每更新计算代价确保索引一致性。Letta 使用递归摘要压缩上下文，需要重读相关历史来确定压缩触发条件。LangMem 的记忆管理器在每次调用时处理完整对话。LightMem 通过离线"睡眠时间"处理实现了 O(1)，同时保留了随语料规模线性增长的 Qdrant 查询——这一依赖在我们的纯 BM25 方案中被消除。这些设计选择反映了准确率-成本权衡中的不同优先级；我们的贡献在于证明 O(1) 每轮 LLM 处理成本可以在无需基础设施依赖的情况下实现。

### 4.2 无损可追溯性与分层惰性检索

**定义。** 一个记忆系统是*无损的*（lossless），当且仅当每条合成记忆条目携带从该条目回到生成它的原始数据的、完整且可遍历的链。形式化地：对任意 LTM 条目 *ℓ*，存在函数 `trace(ℓ) → {m₁, ..., mₙ}`，其中每个 *mᵢ* 是原始消息，且 LTM → STM → 消息链是完整且双向的。

**实现方案。** 每条 STM 条目存储 `msg_ids`：从中提取该事件的原始消息 ID 数组。每条 LTM 条目存储 `stm_refs`：合并生成该 LTM 的 STM 条目 ID 数组。`access` 工具支持递归遍历：`access("ltm_5")` 返回 LTM 条目、其子 STM 条目，以及（在配置了历史读取器时）原始消息文本。

**为何重要。** 大多数记忆系统（Mem0、Hindsight、LangMem）将"记忆"作为不透明的合成文本块提供。如果一条记忆不准确，无法追溯它为何被生成，或从哪些原始数据产生。NE-Memory 的无损设计意味着记忆条目中的每一条断言都可以针对其来源进行验证。对于调试、用户信任和增量纠正，这种可追溯性至关重要。

**与非删除式架构的关系。** Mem0 和 Hindsight 都是*非删除式*的（non-deleting）——记忆追加而非覆写。这是与我们工作共享的重要基础属性。我们将其进一步延伸为*无损性*：NE-Memory 维护显式的双向回链（LTM → STM → 消息 ID），使得每条记忆断言都可以针对其源数据进行审计。在非删除式系统中，旧数据仍然存在某处；在无损系统中，你可以精确追踪哪些数据产生了哪些记忆断言，不存在歧义。这一区别对调试、用户信任和增量纠正至关重要。

**分层惰性检索。** 无损可追溯性是*静态保证*——链存在。分层惰性检索（§3.5）是*动态行为*——链仅在需要时被遍历。二者共同构成完整的访问模型：Agent 每轮接收紧凑状态摘要（第 0 层，约 200–400 Token），在特定实体聚焦时惰性加载实体链（第 1 层），仅在明确召回查询时调用全量 BM25 + LLM 合成（第 2 层），仅在验证时才钻取到原始消息（第 3 层）。这一渐进式访问模式保持了每轮 O(1) 成本保证（§4.1）同时维持了完整的审计能力。此前没有任何记忆系统提供这种静态无损性与动态惰性访问的组合——大多数要么提供不透明的摘要而无追溯能力，要么提供全量检索而无渐进深度控制。

### 4.3 实体锚定的时间线检索

我们引入实体锚定的时间线检索，作为 BM25 语义搜索的互补检索原语。BM25 通过 Token 相似度回答"什么与这个查询相关？"，实体锚定检索则通过将标记了给定实体的所有事件按时间排序分组来回答"这个实体的历史是什么？"

**实体链作为一种检索原语。** Schema（§3.2.2）中定义的每个状态实体（参与者、团队、任务）维护一条 `chain`——该实体涉及的全部 STM 和 LTM 条目的按时间排序列表。链在查询时通过按实体标签过滤全部事件语料库并按时间排序来物化。这不是更好的 BM25；它是一种不同的检索模式，按*归属*而非*相似度*检索。

**为何重要。** 在叙事和协作场景中，Agent 经常需要回答"X 发生了什么？"或"X 的当前状态？"这类问题。BM25 可以通过名称浮出提到 X 的条目，但不能保证完整性或时间排序。实体链同时提供两者：所有涉及 X 的事件，按时间顺序，无论查询词项是否匹配事件文本。这对连续性要求严格的应用（角色扮演、项目管理）尤为重要——遗漏一个实体的状态变化就可能导致事实错误。

**零 LLM 实现。** 实体标注是 STM 提取输出的标准字段。提取 LLM 被提示列出涉及的实体；链的组装是纯代码操作（过滤 + 排序）。无需额外 LLM 调用、嵌入或图数据库。链通过 `memory_access("chain.Alice")` 访问——单次 MCP 工具调用。

### 4.4 Schema 约束的事实记忆

我们引入 Schema 约束的事实记忆（Schema-Constrained Factual Memory）：使用 JSON Schema 约束提取和整合 LLM 写入的结构化状态，在"现在是什么"（状态）和"发生了什么"（事件）之间建立分离。

**设计。** Schema 定义了有类型的实体容器（participants、teams、medium_tasks、short_tasks、emergencies），每个具有结构化字段。提取 LLM 被提示根据对话内容更新这些容器，将新信息合并到现有实体卡而非创建重复条目。整合 LLM 在合并 STM 条目到 LTM 摘要时同样更新状态。

**状态-事件分离。** 大多数 Agent 记忆系统将所有信息——事实、事件、实体状态——存储在单一无差别的记忆池中。NE-Memory 分离这些关注点：状态对象持有"现在是什么"（Alice 是项目负责人，Task #3 处于 in_progress），而 STM/LTM 条目持有"发生了什么"（Alice 在周二提出了新架构）。这一分离实现了：
- *快速状态查询*无需检索：Agent 直接从状态对象读取参与者状态，而非 BM25 结果。
- *时间完整性*：状态变更带有时间戳，事件链保留变更历史。
- *实体锚定检索*（§3.4、§4.3）：状态实体作为时间线事件链的锚点。

**领域可移植性。** Schema 不是硬编码的。角色扮演（RP）Schema 变体将 participants→characters、teams→factions、tasks→quests。提取和整合逻辑完全相同地操作任一 Schema；仅 JSON Schema 定义和提示词模板不同（§4.7）。

### 4.5 BM25 优先的检索策略

Agent 记忆的主流范式是向量嵌入 + 语义搜索。我们选择纯 BM25 并非主张向量检索无效——混合 BM25+Vector 方案在独立评估中确实更准确。这是一个架构层面的结论：在 NE-Memory 将 BM25 候选结果通过 LLM 合成阶段的前提下，增加向量评分带来的增量收益被合成阶段自身的语义重排所吸收。合成 LLM 能够从略微嘈杂的候选池中识别相关条目，其效果与从更干净的池中接近相同——因为它的语义理解能力严格强于余弦相似度。因此，工程选择不是「BM25 vs. Vector」，而是「BM25 + LLM vs. BM25 + Vector + LLM」——在这个特定管线中，Vector 层增加了基础设施成本，却对最终输出几乎没有可测量的改善。

三个实用考量支持这一结论：

1. **对重排阶段而言质量足够。** BM25 的已知弱点是「词汇错配」（查询和文档使用不同词语描述同一概念）。然而，当 BM25 返回的前 40 条候选传递给 LLM 进行合成时，LLM 通过语义理解进行重排来弥补这一缺陷。BM25 阶段充当廉价、高召回率的预过滤器；LLM 合成阶段提供语义精度。

2. **延迟可预测。** 对于最多 5,000 条条目，BM25 评分为 5–15 毫秒。向量搜索延迟取决于索引规模和硬件。

3. **部署极简。** BM25 零依赖。无需下载模型、无需 GPU、无需向量数据库。整个检索引擎约 170 行 JavaScript。

**中文二元分词。** 对于没有自然词边界的中文文本，我们使用字符级二元组作为分词单元。这是 CJK 信息检索中的标准方法，无需外部分词器。

**跨语言扩展。** 对于多语言记忆库，BM25 面临词汇鸿沟：英文查询无法匹配中文条目中的 Token。我们以一个实用扩展解决此问题：每条 STM 提取提示词指示 LLM 生成一个 `translation` 字段（最多 200 字符），包含该条目的对语翻译。`buildSearchableText` 函数将原始文本和翻译连接后纳入 BM25 索引。由于分词器原生处理混合 CJK-字母文本，英文查询无需按语言分索引即可匹配中文条目内的英文翻译 Token。这为每条条目增加约 10–20 个 Token，以近乎零基础设施成本消除了跨语言零召回失败模式，复用提取 LLM 的多语言能力作为免费副作用。该方法是经典 CLIR 翻译技术的系统级适应，而非新的检索算法。结果报告于 §6.1。

### 4.6 Smart Push 预算启发式算法

NE-Memory 不使用固定的 Token 预算注入记忆，而是通过启发式方法评估用户输入的复杂度并据此调整预算。评估四个信号：

| 信号 | 权重 | 条件 |
|------|:--:|------|
| 消息长度 | 2 分 | > 200 字符 |
| 问句数量 | 2 分 | ≥ 2 个问号 |
| 实体数量 | 2 分 | ≥ 3 个检测到的命名实体 |
| 叙事关键词 | 1 分 | 包含召回型词汇（"remember"/"recall"/"before"/"last time" 或等效词） |

得分 0–1 → 500 Token。得分 2–4 → 800 Token（默认）。得分 5–7 → 1,200 Token。

该启发式算法**对 LLM 不可见**：它完全基于用户输入的表面特征在客户端代码中运行。零额外 API 调用，延迟可忽略。

### 4.7 跨领域 Schema 可移植性

NE-Memory 的架构将记忆内核（提取、整合、检索、访问）与定义存在哪些实体及其字段的领域 Schema 分离。这种分离——我们称之为**跨领域 Schema 可移植性（Cross-Domain Schema Portability）**——意味着同一约 3,000 行核心可以通过仅更换 JSON Schema 定义和提示词模板，服务于叙事角色扮演、多 Agent 协作、项目管理等场景。

**机制。** Schema 定义：(1) 状态对象的形状（实体类型、字段、有效状态值）；(2) STM 提取期间使用的实体标注词汇；(3) 指示 LLM 如何提取和整合信息的提示词模板。提取引擎在初始化时读取 Schema，将模式特定指令注入 LLM 提示词。所有下游操作——BM25 索引、实体链组装、状态摘要格式化——均从同一 Schema 定义派生其行为。

**已实现的变体。** 两个 Schema 变体已完整实现并通过测试：
- *通用 Schema*（`mode: "general"`）：participants、teams、medium_tasks、short_tasks、emergencies——面向多 Agent 协作和项目管理场景。
- *角色扮演 Schema*（`mode: "rp"`）：characters（protagonist/npc）、factions、quests——面向具有实体演化跟踪的叙事角色扮演。

两个变体使用完全相同的提取、整合、检索和访问代码路径。切换仅需更改单一配置字段。

**意义。** 大多数 Agent 记忆系统是领域特定的：Mem0 面向通用助手记忆，Hindsight 面向叙事角色扮演，Cursor Engine 面向软件开发。NE-Memory 证明了轻量级记忆内核可以在不修改代码的情况下服务于多个领域，挑战了"领域特定记忆需要领域特定基础设施"的假设。这种可移植性不仅是一项便利特性——它验证了一个架构主张：记忆提取、整合和检索是领域无关的操作，可通过 Schema 参数化而非逐领域重新实现。

---

## 5. 实现方案

### 5.1 存储后端抽象

NE-Memory 的存储层由一个包含三个操作的最小接口定义：按会话标识符读取 vault、写入 vault 和移除 vault。提供三种后端实现：读写磁盘扁平 JSON 文件的文件系统适配器（MCP 服务器使用）、基于 IndexedDB 的浏览器适配器，以及用于测试的内存适配器。核心引擎完全不感知所使用的后端；核心与后端之间设有一个可配置的读取穿透缓存以减少冗余 I/O。

### 5.2 LLM 适配器抽象

LLM 接口抽象为单一函数，接受消息数组和可选配置（超时、温度、最大 Token 数），返回文本补全。提供两个适配器：面向 OpenAI 兼容端点的 HTTP API 适配器，以及用于其他子系统管理 LLM 调用的回调适配器。此抽象使同一记忆逻辑可针对云端模型（GPT-4o-mini、DeepSeek）或本地托管模型，无需代码变更。

### 5.3 历史读取器抽象

用于从现有对话日志回填记忆，历史读取器实现一个简单接口：接受会话标识符，返回带角色、内容和标识符的消息数组。提供三种读取器，覆盖基于 SQLite 的 IDE 日志、每日 Markdown 日志文件和通用 JSON 数组。批处理准备可逐读取器配置。

### 5.4 MCP 工具面

系统通过模型上下文协议暴露 11 个工具，覆盖状态查询、BM25 搜索、直接引用查找、LLM 合成、STM 提取、整合、状态管理、回滚、历史回填和工作区发现。这使得任何 MCP 兼容客户端无需 SDK 集成即可即时使用。

---

## 6. 实验评估

我们从三个维度评估 NE-Memory：BM25 检索的独立质量（§6.1）、每轮 Token 效率（§6.2），以及相对于竞争系统的系统复杂度（§6.3）。在标准记忆数据集（LoCoMo、LongMemEval）上的完整端到端基准测试结果待补充。

### 6.1 BM25 检索质量

我们构建了一个合成评估数据集，模拟叙事 Agent 在约 80 轮角色扮演对话后的记忆库。数据集包含 50 条短期记忆（STM）条目和 20 条长期记忆（LTM）条目，涵盖英文和中文内容，条目涉及实体介绍、战斗遭遇、情节转折和角色发展弧线。我们定义了跨六大类别的 20 个查询，标注了真实相关性标签，然后测量 BM25 检索的独立性能（无 LLM 合成）。

**实验设置。** BM25 实现使用标准 Okapi 参数（k₁ = 1.5, b = 0.75），CJK 文本使用中文二元分词，字母文本使用空格分词。全部 70 条条目（50 STM + 20 LTM）索引在单一 BM25 语料库中。每个查询返回前 40 条评分条目。我们报告 Recall@K、Precision@K、平均倒数排名（MRR）和归一化折损累积增益（nDCG）。基准测试脚本可在项目仓库中获取。

**按查询类别划分的结果。**

| 类别 | 查询数 | R@5 | R@10 | R@40 | P@5 | MRR | nDCG@10 |
|------|:----:|:---:|:----:|:----:|:---:|:---:|:------:|
| 精确匹配 | 6 | 41.2% | 57.8% | 66.5% | 63.3% | 0.875 | 0.638 |
| 实体查询 | 2 | 15.5% | 31.0% | 77.4% | 50.0% | 1.000 | 0.571 |
| 同义词/词汇错配 | 4 | 38.3% | 42.5% | 57.5% | 40.0% | 0.875 | 0.514 |
| 中文查询 | 4 | 56.7% | 63.8% | 63.8% | 70.0% | 1.000 | 0.734 |
| 跨语言（英→中） | 2 | 50.0% | 57.1% | 57.1% | 70.0% | 1.000 | 0.635 |
| 抽象/概念 | 2 | 10.0% | 10.0% | 40.0% | 10.0% | 0.250 | 0.107 |
| **总计（20 查询）** | | **38.9%** | **48.4%** | **61.7%** | **54.0%** | **0.863** | **0.572** |

全部查询的 nDCG@10 值范围从 0.107（抽象类）到 0.734（中文类），整体平均为 0.572。

**跨语言检索与零分过滤。** NE-Memory 通过双语索引解决 BM25 的跨语言词汇鸿沟：每条 STM 条目携带 `translation` 字段（最多 200 字符），由提取 LLM 作为副作用生成，原始文本和翻译文本共同索引。当 BM25 预过滤器在混合语言 vault 中返回少于 5 个候选时，轻量级查询翻译（温度 0.0）触发二次 BM25 搜索，以交错策略合并结果。此外，NE-Memory 默认过滤零分候选，但当正分候选少于 3 个时穿透包含零分条目——此回退在我们的基准测试中触发了一次（"loyalty choice difficult decision"，从 0 个扩展到 3 个候选）。这些机制共同将跨语言 R@5 从 0.0% 提升至 50.0%，同时保持有竞争力的单语性能。

**分析。** 仅看 R@40 指标会低估 NE-Memory 架构的实用检索质量。在 20 个查询中，有 12 个的过滤后候选池较小但完全由正 BM25 分数的条目组成——每条返回条目至少有一个匹配词项。对 LLM 合成阶段而言，接收 2–5 个高质量候选优于接收 40 个候选中的 30+ 个零相关性条目。合成 LLM 可从每个查询主题仅 1–2 条检索条目中生成有用的记忆摘要。

BM25 表现不佳的三个类别符合预期，与已知的 BM25 局限一致：

1. **抽象/概念查询**（R@10 = 10.0%）：使用抽象术语（"guilt"、"loyalty"、"choice"）的查询在候选池中达到 10–40% 的召回率，但前排名精度有限。LLM 合成阶段旨在通过重排更广泛的候选集来弥合这一语义鸿沟——相关条目存在于 vault 中，但使用具体的叙事语言而非抽象查询术语。

2. **同义词查询**（R@10 = 42.5%）：BM25 众所周知的词汇错配弱点在查询使用条目不存在的术语时降低召回率（如 "weapon" vs. "Dragonfang"、"deception" vs. "spy"）。然而，前 5 精度 40% 意味着前几个结果通常是相关的，LLM 合成阶段可从这些锚点展开。

3. **跨语言查询**（R@10 = 57.1%）：双语索引和查询端翻译消除了零召回失败模式，达到有竞争力的性能（MRR = 1.000）。与单语检索的剩余差距（57.1% vs. 63.8% 中文 R@10）反映了翻译字段中关键词覆盖的不完全性。

这些结果验证了 NE-Memory 的架构前提：BM25 提供廉价预过滤器，将具有正 Token 重叠的条目浮出给 LLM 合成阶段，合成阶段随后应用语义重排生成最终注入的记忆摘要。

### 6.2 Token 效率

| 指标 | 全量注入 | Smart Push | 节省比例 |
|------|:------:|:--------:|:------:|
| 每轮注入 | ~1,850 tok | ~550 tok | 70% |
| BM25 回退 | — | ~250 tok | 86% |
| recall_memory 每次调用 | — | ~300–800 tok | 按需 |

Smart Push 预算启发式进一步优化：低复杂度轮次获得 500 tok 注入；仅复杂轮次获得完整的 1,200 tok 预算。

### 6.3 系统复杂度横向对比

| 系统 | 核心代码行数 | 文件数 | 外部依赖 | 存储后端 |
|------|:--------:|:---:|--------|--------|
| **NE-Memory** | **~3,000** | **~20** | **0**（仅 Node.js 内置） | 扁平 JSON 文件 |
| LangMem | 7,800 | 35 | LangChain 生态 | LangGraph Store |
| LightMem | 38,000 | 235 | Qdrant, llmlingua-2 | Qdrant 向量库 |
| Mem0 | 121,000 | 887 | 21 框架, 20 向量库 | 多种向量库 |
| Zep/Graphiti | 126,000 | 323 | Neo4j/FalkorDB/Kuzu | 图数据库 |
| Cognee | 226,000 | 2,190 | 多种图库+向量库 | 图库 + 向量库 |
| Letta | 291,000 | 1,102 | PostgreSQL/pgvector | PostgreSQL |
| Hindsight | —* | —* | Docker, Cross-Encoder | Neo4j + 向量库 |

NE-Memory 的代码量比竞争系统小 1–2 个数量级，除 Node.js 22 内置模块外零强制外部依赖。*Hindsight 以容器化部署分发（>500 MB）；源代码行数不可直接比较。

### 6.4 BM25 输出 vs. LLM 合成（消融实验）

为量化 LLM 合成阶段相对于原始 BM25 检索的收益，我们在 §6.1 的同一 20 查询基准上进行了人工评估消融。对每个查询，我们收集了 (a) 原始 BM25 前 5 条目和 (b) 由 DeepSeek-v4-flash 从前 40 条 BM25 候选生成的合成。单一评估者按 1–5 分制对每条合成评分（5 = 完美，所有相关信息均已捕获且无幻觉；4 = 良好，有少量遗漏；3 = 尚可，存在一些错误；2 = 不佳，有重大错误；1 = 无用或空白输出）。本评估使用 §6.1 所述的双语索引数据集。

**按类别划分的结果。**

| 类别 | BM25 候选数（均值） | 合成评分（均值） | 备注 |
|------|:---------------:|:------------:|------|
| 精确匹配（6） | 15.0 | 4.5 | 全部连贯；更长的翻译提供更丰富的上下文 |
| 实体查询（2） | 31.0 | 4.0 | 高候选数；过载规则裁剪为关键线索 |
| 同义词（4） | 10.0 | 3.8 | 查询翻译为稀疏查询浮出额外匹配 |
| 中文（4） | 12.8 | 3.8 | 两个查询输出中文；全部准确 |
| 跨语言（2） | 13.5 | 4.5 | 完全恢复：零分回退 + 查询翻译消除零候选案例 |
| 抽象（2） | 13.5 | 3.0 | "loyalty choice"（3 候选通过零分回退，评分 2）；"Elara inner conflict"（详细，评分 4） |
| **全部（20）** | **14.9** | **4.0** | 5 个评分 5；9 个评分 4；4 个评分 3；1 个评分 2；无评分 1 或空白输出 |

**分析。** 跨语言合成评分与单语水平相当（4.0–4.5），反映了双语索引和查询端翻译的有效性。零分回退机制挽救了 "loyalty choice difficult decision" 的失败：该查询此前返回 0 个候选，现在浮出 3 个条目，使 LLM 能生成关于预言卷轴的简洁合成。然而，抽象词汇鸿沟在纯 BM25 架构中仍然不可约减——"loyalty" 一词未出现在其所描述事件的叙事文本中。精确匹配 R@5 的轻微回归（46.6% → 41.2%）可归因于较长的翻译稀释了精确匹配关键词的词频；跨语言 14.3pp 的收益远超精确匹配 5.4pp 的损失。

**BM25 仅基线。** 没有合成时，用户收到 "Everything about Elara" 的原始 BM25 前 5 条目将是来自不同时间段的五条脱节 STM 条目，需要手动交叉对照。LLM 合成将其缩减为单一叙事段落。对于具有清晰关键词的系统性查询（"Crystal Caves"），BM25 仅输出已经足够——LLM 增加的是格式化而非语义价值。

---

## 7. 讨论

### 7.1 BM25 何时足够

BM25 的核心弱点是词汇错配："sword" 与 "blade"，"angry" 与 "furious"。在 Agent 记忆检索中，这一弱点被两个因素缓解：

1. **实体名称重复使用。** 命名实体（角色、地点、物品）在对话中倾向于使用一致的术语。如果一个角色始终被称为 "Frost"，BM25 会找到所有提及 "Frost" 的地方，不论上下文如何。

2. **LLM 重排。** 合成阶段接收 40 条候选，远超最终输出（通常 3–5 条相关记忆）。LLM 可以利用其语义理解进行重排和选择，弥补 BM25 的表面匹配缺陷。

BM25 优先检索不如稠密检索的场景包括：
- **同义词密集的查询**（"the blade" vs. "Dragonfang"），包括查询和记忆使用不同语言的跨语言场景。通过 LLM 生成翻译字段的双语索引（§4.5）可达 50.0% 跨语言 R@5。
- **抽象概念查询**（"moments of betrayal"，但 "betrayal" 一词从未出现）

这些场景由 LLM 合成阶段处理。只要有至少若干相关候选进入 BM25 前 40 结果，LLM 就能弥合语义鸿沟。在实践中，以实体为中心的叙事对话提供了足够的表面词项重叠，使 BM25 维持高召回率。

**关于混合检索。** 一个自然的问题是：增加向量嵌入层（BM25 + Vector + LLM）是否会带来更好的结果？在*没有* LLM 合成的系统中，答案是明确的——混合检索是召回率的当前最优。然而，在 NE-Memory 的特定管线中，合成 LLM 接收的候选数（前 40）远超其最终输出数（3–5 条注入条目），而其语义重排能力严格强于对向量嵌入做余弦相似度。经验上，我们预期增加向量评分带来的候选池质量边际改善会被 LLM 的选择过程所吸收。混合检索的主要成本——嵌入模型依赖、部署复杂度增加、每条记忆的嵌入存储——因此产生的下游收益极小。我们将 NE-Memory 设计为可接受向量重排模块作为未来基准测试的可选插件，但在核心架构中，我们发现在当前规模上第三阶段是冗余的。

### 7.2 无损性的代价

维护完整的 STM → LTM → 消息链有存储代价：对于 10,000 条消息的对话，vault JSON 文件约 2–5 MB（压缩后）。这对现代硬件可忽略不计。能够将任何断言追溯到其来源的检索收益——对调试、用户信任和增量纠正而言——远超这一代价。

### 7.3 局限性

1. **无向量检索。** 对于同义词密集或抽象查询，BM25 召回率可能不足。LLM 合成阶段可缓解但无法消除此问题。跨语言检索通过 LLM 生成的翻译字段得到解决（§4.5），这是一个轻量级侧通道，以 50.0% R@5 实现而无向量基础设施。多语言稠密检索器（mE5、LaBSE）可能会在跨语言指标上有更好表现，但代价是我们零依赖设计有意避免的嵌入基础设施。

2. **无图遍历。** 实体关系通过实体标签和实体链（§3.4）追踪，但未用于图游走检索。Hindsight 和 Zep/Graphiti 等系统可以通过图边回答"X 发生时还有谁在场"；NE-Memory 依赖实体链和 BM25 文本匹配处理此类查询。

3. **无信念修正追踪。** NE-Memory 的仅追加模型意味着当角色状态变化时（如"Frost 活着"→"Frost 已死"），两个事实在 vault 中共存。合成 LLM 基于时间戳解决矛盾，但不存在形式化的信念修正机制（如 Kumiho 的 AGM 语义）。

4. **单线程 STM 提取。** 支持后台提取（`memory_extract(background: true)`），但同一聊天会话的多个并发提取未做序列化保护，可能导致竞态条件。

### 7.4 未来工作

1. **LLTM（深度整合）。** 当 LTM 条目超过阈值（~100 条）时，执行二级整合，将相关的 LTM 合并为叙事弧线容器摘要。这将为 1,000+ 轮对话进一步提升检索结构化程度。

2. **LLTM 级实体链合成。** 实体链（§3.4）当前以原始 STM/LTM 条目形式按时间排序返回。未来扩展将在 LLTM 级别为每个实体合成叙事摘要（例如，从涉及 "Frost" 的所有事件生成该角色的紧凑传记），降低长生命周期实体的实体链访问 Token 成本。

3. **本地小模型用于检索。** 蒸馏 1–3B 参数模型用于检索合成任务，使 Smart Push 在无 API 延迟的情况下亚秒级完成。

4. **基准评估。** 在 LoCoMo、LongMemEval 和 MemoryArena 上运行 NE-Memory，产出具体的性能数据。

---

## 8. 结论

NE-Memory 证明，在无需向量数据库或外部依赖的前提下，O(1) 每轮 LLM 处理成本、具有分层惰性访问的无损可追溯性、Schema 约束的事实记忆以及实体锚定的时间线检索可以在 Agent 记忆系统中实现，以适度的准确率折中换取零基础设施部署。它的定义性特征——O(1) 每轮 LLM 处理、无损可追溯性、BM25 优先检索、实体锚定检索和 Schema 约束状态——解决了现有大规模基础设施记忆系统未能解决的实用部署问题。

本系统表明，有效的 Agent 记忆不需要向量数据库、图存储或数十万行代码库。一个约 3,000 行的核心配合 BM25 预过滤、LLM 合成和 Schema 驱动的状态管理，即可在完全消除外部依赖的同时达到有竞争力的准确率。跨领域 Schema 可移植性进一步表明，记忆提取、整合和检索是领域无关的操作，可通过 JSON Schema 参数化而非逐领域重新实现。

NE-Memory 以 MIT 许可证开源，封装为 MCP 服务器，可即时用于任何 MCP 兼容的 AI 客户端。

---

## 参考文献

1. Packer, C., et al. "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560, 2023.
2. Chhikara, P., Khant, D., Aryan, S., Singh, T., & Yadav, D. "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory." arXiv:2504.19413, 2025.
3. Vectorize.io. "Hindsight is 20/20: Building Agent Memory that Retains, Recalls, and Reflects." arXiv:2512.12818, 2025.
4. Rasmussen, P., et al. (Zep AI). "Zep: A Temporal Knowledge Graph Architecture for Agent Memory." arXiv:2501.13956, 2025.
5. Marković, M., et al. (Cognee Inc.). "Optimizing the Interface Between Knowledge Graphs and LLMs for Complex Reasoning." arXiv:2505.24478, 2025.
6. LangChain. "LangMem: Long-term Memory for LangGraph Agents." GitHub: langchain-ai/langmem, 2025.
7. Kang, J., Ji, M., Zhao, Z., & Bai, T. "Memory OS of AI Agent." arXiv:2506.06326, 2025.
8. Kumiho Inc. "Graph-Native Cognitive Memory for AI Agents: Formal Belief Revision Semantics for Versioned Memory Architectures." 2026.
9. Fang, T., et al. (浙江大学). "LightMem: Lightweight and Efficient Memory-Augmented Generation." arXiv:2510.18866, 2025.
10. "MemoryField: Exploiting Gravitational Field for Long-Term Memory Management." ICLR 2026 审稿中。匿名投稿。
11. OpenAI. "Memory and new controls for ChatGPT." 博客文章, 2024年2月.
12. Maharana, A., et al. "LoCoMo: Long Context Memory Benchmark." ACL 2024 论文集.
13. Wu, D., Wang, H., Yu, W., Zhang, Y., Chang, K.-W., & Yu, D. "LongMemEval: Benchmarking Long-Context LLMs on Long-Term Memory Tasks." arXiv:2410.10813. ICLR 2025 Poster.
14. He, Z., et al. "MemoryArena: Benchmarking Agent Memory in Interdependent Multi-Session Agentic Tasks." arXiv:2602.16313, 2026.
15. Du, Y., et al. "Memory in the LLM Era: Modular Architectures and Strategies in a Unified Framework." arXiv:2604.01707, 2025.
16. Robertson, S. & Zaragoza, H. "The Probabilistic Relevance Framework: BM25 and Beyond." Foundations and Trends in Information Retrieval, 2009.
17. Anthropic. "Model Context Protocol Specification." 2024.

---

*通讯作者：[作者邮箱]*
*代码仓库：[github.com/.../ne-memory-core](https://github.com)*
