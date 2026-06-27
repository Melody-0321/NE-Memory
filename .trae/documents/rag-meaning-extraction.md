# RAG 检索中的"意义提取"分析

## 一、我们的检索流程

```
用户发送消息 → onBeforeGenerate()
  ├── formatStateTable          — 角色状态卡注入
  ├── formatContextMemory       — 上下文窗口历史摘要
  └── formatSmartContext        — 核心 RAG 检索管线
       ├── estimateComplexityBudget   — 按复杂度分配合成 token 预算
       ├── computeVisibleWindow       — 计算主 LLM 已知的消息范围
       ├── 构建 query                 — 最近 2 轮对话原文拼接(≤1200char)
       ├── resolveAmbiguousReferences — 规则匹配"那个铁匠"→实体名消歧
       ├── extractEntityNames         — 检测 query 中出现的已知角色/势力名
       ├── BM25 候选过滤              — CJK bigram 分词 + BM25 + 断崖截断
       ├── mergePipelines             — BM25+实体链+LTM目录合并
       └── 检索 LLM (带 tool)        — 判断相关性→叙事分组→展开合成→KB 标注
```

## 二、几个代表性 Memory 产品是怎么做的

### Letta (原 MemGPT)

**核心理念**：操作系统虚拟内存分页——Main Context（内存）+ External Context（磁盘）。

**检索方式**：**没有传统意义的 RAG 检索管线**。不依赖 query→BM25/向量→重排这种流水线。取而代之的是一套"自编辑记忆（Self-editing Memory）"机制：
- 系统指令中写入自然语言描述的记忆层次和可用函数
- LLM 主动调用 `archival_memory_search(query)` / `archival_memory_insert` 自己决定何时检索、检索什么、写什么
- 记忆压缩靠递归摘要（Recursive Summary）——新消息从 FIFO 队列移出时与当前摘要合并生成新摘要
- 这是"LLM 自主驱动"模式，不是"后台管线预设"模式

**query 处理**：LLM 自己生成查询字符串——它从对话上下文理解意图后直接产出搜索 query。

### ZEP

**核心理念**：图引擎——三层知识图谱（情境子图 → 语义子图 → 社区子图）。

**检索方式**：三步：
1. **Search**：语义相似度 + BM25 全文 + 广度优先图搜索，三路并行
2. **Reranker**：重排序
3. **Constructor**：将节点+边转为文本上下文

**query 处理**：**不做 query 改写**。直接用 input string 做三路检索，靠重排序和图的上下文关联弥补 query 精度不足。

### Mem0

**核心理念**：轻量级记忆层——生鲜记忆（Semantic Search）。

**检索方式**：向量语义检索 + LLM 判重/合并。

**query 处理**：用当前问答 + 最近 M 条消息 + 会话摘要作为上下文给 LLM 生成记忆；更新时检索语义相似的 N 条记忆给 LLM 判断冲突。**没有独立的 query 改写步骤。**

### 通用 RAG 架构的做法

企业级 RAG 论文/文章中常见的"预检索优化"：

| 技术 | 说明 | 延迟 | 适用场景 |
|---|---|---|---|
| **Query Routing** | 轻量分类器将 query 导向不同检索通道 | <5ms | 意图多样 |
| **同义词/术语表扩展** | 维护词典，检索前自动扩展 | <1ms | 高频专业术语 |
| **轻量改写模型** | T5-small 等小模型改写 | 20-50ms | 语义模糊 |
| **HyDE** | LLM 生成假设文档→embed→向量检索 | 200-500ms | 概念性查询 |
| **Multi-Query** | LLM 生成多个 query 变体并行检索 | 200-500ms | 简短口语化查询 |
| **LLM Query Rewriting** | 完整 LLM 改写 query 后再检索 | 300-800ms | 复杂意图 |

**主流趋势**：避免重型 LLM 改写（延迟太高），优先用轻量规则/小模型/词典扩展 + 重排序兜底。

## 三、我们的定位

| 维度 | 通用 RAG | Letta/MemGPT | ZEP | Mem0 | **NE-Memory** |
|---|---|---|---|---|---|
| 检索方式 | 向量+关键词混合 | LLM 自驱动搜索 | 图+语义+BM25 | 向量语义 | **BM25 纯关键词** |
| query 改写 | 词典/小模型/LLM | LLM 自己写 query | **无** | **无** | **无**（原文拼接） |
| 合成层 | 通常不合成 | LLM 自我管理 | Constructor | LLM 判重 | **检索 LLM(带tool)合成叙事+KB标注** |
| 重排序 | Cross-Encoder | 无 | Reranker | 相似度 | 检索 LLM 本身就是排序+合成 |

**我们的不同点**：
- 没有向量搜索（纯 BM25），没有 query 改写，没有重排序
- 但有一个**检索 LLM** 承担了相关性判断 + 分组 + 合成叙事 + 认知边界标注的全部工作
- 这是把"理解"职责后移——优先用低成本 BM25 召回大量候选，然后让一个 LLM 调用做智能筛选和合成

## 四、"意义提取"在我们这里是否必要

### 当前缺失什么

1. **Query 是原文对话**：BM25 搜索词是对话中所有 CJK bigram。"之前那个红头发的女生" → 搜索词分散在停用词和高频词中
2. **没有显式的关键词权重**：BM25 对所有 bigram 一视同仁，实体名和语气词的权重取决于 IDF 的自动计算
3. **检索 LLM 拿到的是 BM25 排序后的候选**：如果 BM25 排名不准（关键词精度不足），检索 LLM 能补救但范围已被 top-K 限制

### 是否需要"意义提取"

**不需要完整的 LLM query 改写**。原因：
- 增加 300-800ms 延迟（额外 LLM 调用，检索 LLM 已有 1 次调用 + 可能多轮 tool）
- 我们的 BM25 不是纯粹的关键词匹配——CJK bigram 分词天然覆盖了语义信号的广度，对话中的每个双字组合都参与打分
- 检索 LLM 已经承担了"理解 + 合成"的职责，query 改写不会改变它拿到的候选集合的根源（BM25 召回质量）

**值得做的低增量**：在 query 末尾**追加已抽取的实体名**（`resolveAmbiguousReferences` + `extractEntityNames` 的结果）。零额外 LLM 调用，零延迟增加，直接提升 BM25 对关键实体的匹配精度。这是标准的 query expansion 技术。

### 一个更根本的改进方向

如果将来 BM25 召回精度成为瓶颈，真正的升级路径不是加 query 改写，而是：

**BM25 → BM25 + 向量混合检索**（类似 ZEP 的三路并行 + Reranker）。这比 query 改写更直接地提升召回质量，因为：
- 向量检索覆盖语义相似但不共享关键词的记忆
- BM25 覆盖精确关键词匹配
- Reranker 做精排

这需要引入 embedding 模型，成本显著高于 query expansion。

### 结论

**当前状态**：没有独立的"意义提取"步骤。Query 是原文拼接，BM25 直接对它做关键词检索。
**价值评估**：Query 改写（LLM 驱动）成本高、延迟大，不适合我们的场景。
**建议**：追加实体名到 query（成本为零的 query expansion），不改现有架构。长期看向量混合检索是更有效的提升路径。
