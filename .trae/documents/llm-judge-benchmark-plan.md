# LLM-as-Judge 包装前后对比基准测试计划

## 一、目标

对比**两个版本**的检索上下文在帮助 LLM 回答 28 个 query 时的实际效果：

| 版本 | 名称 | 描述 |
|------|------|------|
| **Flat** | 扁平排序（模拟无包装） | 命中条目按 `relevance` 降序排列，每条一行 `[period] scene: event [score:0.xxx]`，无实体分组、无 foldMissRuns、无 KB 标注、无 refs 关联 |
| **Grouped** | 实体分组（当前生产包装） | `buildEntityBlock` 完整输出：实体链标题、period 排序、foldMissRuns 折叠、KB 标注、refs 交叉引用、场景外角色分区 |

**核心问题**：实体分组包装流程对 LLM 的实际信息获取能力是正面还是负面？

---

## 二、当前状态分析

### 2.1 已有设施

- `test/retrieval-benchmark/benchmark-perquery.js` — 纯召回 WS 热力图（已完成）
- `test/retrieval-benchmark/benchmark-packaging.js` — 结构指标对比（可见率、折叠率、位置偏移）（已完成）
- `test/retrieval-benchmark/queries.js` — 28 条带 groundTruth 的 query
- `test/retrieval-benchmark/fixture.js` — 144 条 STM
- `test/retrieval-benchmark/config.json` — SiliconFlow API 配置（`url`、`key`、`model`）

### 2.2 结构对比已揭示的事实

| 指标 | 纯召回 | 包装后 |
|------|--------|--------|
| GT 覆盖率 | 70.7% (193/273) | 86.8% (237/273) |
| GT 折叠损失 | — | 12 条 (4.4%) |
| 中位阅读位置偏移 | ~15 | ~25 (+10) |

包装用注意力（位置推后 10 位）换覆盖率（+16pp）。但**结构指标无法回答**：LLM 在阅读位置第 25 位还能注意到那个条目吗？实体分组的结构化标题能否弥补位置损失？

### 2.3 需要但尚未测试的

- LLM 实际接收信息后的问答能力
- Flat 格式 vs Grouped 格式的对比——到底是包装流程的哪个部分在起作用

---

## 三、方案设计

### 3.1 两个版本的定义

两者共享相同的检索基础：`BM25(TOP_K=40) + Vector(bge-m3, TOP_K=144) → Lin α=0.20`。

**Flat 版本**（扁平排序）：
- 取 `mergePipelines` 结果的 `Map.values()`
- 过滤 `relevance > 0` 且 `sources` 不含 `'ltm_dir'`
- 按 `relevance` 降序排列
- 每行格式：`{N}. [{period}] {scene}: {event} [score:{relevance}]`
  - 如有 `_originalText`：追加 `> {原文缩进}`
- 不折叠 miss-run（因为已过滤 relevance=0）
- 无实体分组标题
- 无 KB 标注

**Grouped 版本**（实体分组）：
- 调用完整 `buildEntityBlock(entityGrouped, {}, activeChars, entityChains)` 
- 即当前生产环境注入的内容
- 包含实体链标题、foldMissRuns、KB 标注、refs、场景外角色

### 3.2 评分标准

DeepSeek-V3 对每个 (query, context) 对评分 1-5：

| 分 | 含义 | 标准 |
|----|------|------|
| 1 | 无法回答 | 记忆中没有任何相关信息，或信息完全矛盾 |
| 2 | 勉强可猜 | 有零星间接线索，但不足以形成可靠答案 |
| 3 | 部分可答 | 能回答 query 的部分内容，但有明显空缺 |
| 4 | 基本完整 | 能回答大部分内容，仅缺少数细节 |
| 5 | 完全可答 | 记忆提供了精确、充分的证据支持完整回答 |

### 3.3 评分 Prompt 结构

```
你是一个记忆检索质量评估器。以下是一组从故事对话中提取的记忆条目，
以及一个关于故事内容的问题。请判断这些记忆能否帮助你回答该问题。

[Flat|Grouped 格式的记忆文本]

问题：{query}

请返回 JSON：
{
  "score": 1-5,
  "reason": "一句话解释为什么给这个分数",
  "key_entries": ["记忆中提供关键信息的条目编号或描述"]
}
```

### 3.4 输出格式

每个 query 输出两行对比：

```
q1 "月票榜事件的起因和过程？"  Flat=4  Grouped=5  Δ=+1  Grouped更优
q2 "两人之间的关系是如何发展的？" Flat=3  Grouped=2  Δ=-1  Flat更优
...
```

聚合统计：
- Flat 平均分 vs Grouped 平均分
- Grouped 优于 Flat 的 query 数 / Flat 优于 Grouped 的 query 数
- 按 query type（narr / targ）分层
- 按 GT 覆盖率和位置偏移交叉分析

### 3.5 成本估算

- 28 queries × 2 formats × ~500 tokens/context × ~100 tokens/response ≈ 33,600 tokens
- DeepSeek-V3 定价 ≈ ¥1/1M tokens → **约 ¥0.03**（极低）

---

## 四、实现步骤

### Step 1：创建 `test/retrieval-benchmark/benchmark-llm-judge.js`

**复用已有模块**：
- 从 `benchmark-perquery.js` 复用：向量索引构建、BM25 检索、Lin 融合
- 从 `benchmark-packaging.js` 复用：mergePipelines 调用、entityChains 构建
- 新增：`buildFlatContext()` — 生成扁平排序版本文本
- 新增：`buildGroupedContext()` — 调用 `buildEntityBlock` 生成分组版本文本
- 新增：`judgeQuery()` — 调用 DeepSeek-V3 评分
- 新增：汇总统计和 Markdown 报告

**主流程**：
```
for each query:
  1. 构建 entityChains（同 benchmark-packaging.js）
  2. BM25 检索 → Lin 融合 → 得到 topCandidates
  3. mergePipelines → Map
  4. prefetchOriginalTexts（按 relevance 降序取 top-3）
  5. flatContext = buildFlatContext(Map)       ← 新增
  6. groupedContext = buildGroupedContext(Map)  ← 调用生产代码
  7. flatScore = await judgeQuery(query, flatContext)
  8. groupedScore = await judgeQuery(query, groupedContext)
  9. 记录对比
```

### Step 2：buildFlatContext 实现

```javascript
function buildFlatContext(mergedMap) {
    var entries = [];
    mergedMap.forEach(function(e) {
        if (e.relevance > 0 && e.sources.indexOf('ltm_dir') === -1) {
            entries.push(e);
        }
    });
    entries.sort(function(a, b) { return b.relevance - a.relevance; });
    
    var lines = [];
    entries.forEach(function(e, i) {
        var period = e.entry.period || '?';
        var scene = e.entry.scene || '';
        var event = e.entry.event || e.entry.summary || '';
        var score = e.relevance.toFixed(3);
        var line = (i+1) + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event + ' [score:' + score + ']';
        if (e._originalText) {
            line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
        }
        lines.push(line);
    });
    return lines.join('\n');
}
```

### Step 3：buildGroupedContext 实现

```javascript
function buildGroupedContext(entityGrouped, activeChars, entityChains) {
    // 直接调用生产代码
    return buildEntityBlock(entityGrouped, {}, activeChars, entityChains);
}
```

注意：`buildEntityBlock` 内部会调用 `foldMissRuns`、`renderGroup`、`formatEntry`，生成完整的 Markdown 文本。但**不会**附加外部包裹文本（如"以下是你在故事中积累的记忆..."），因为那是 events.js 加的，不属于包装本身。

### Step 4：judgeQuery 实现

- 调用 `config.url` 的 chat completions 端点（SiliconFlow 兼容 OpenAI API）
- 模型：`deepseek-ai/DeepSeek-V3`
- System prompt：评分标准和 JSON 输出格式
- User prompt：context + query
- 使用 `json-fallback.js` 或简单的 `JSON.parse` 解析返回
- 失败重试 1 次

### Step 5：汇总报告

输出 Markdown 报告包含：
1. 总览：Flat/Grped 平均分、优劣势 query 数
2. 完整评分表（28 行 × 3 列：Flat、Grouped、Δ）
3. Grouped 优势 query 列表（含 Δ 和原因分析）
4. Grouped 劣势 query 列表（重点关注——这是包装流程的问题）
5. 按 query type 分层分析
6. 与结构指标的交叉分析（高偏移 query 是否对应 Grouped 低分？）

---

## 五、需要新增/修改的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `test/retrieval-benchmark/benchmark-llm-judge.js` | **新建** | 主测试脚本 |
| `test/retrieval-benchmark/benchmark-packaging.js` | 不改 | 仅复用其模式参考 |

---

## 六、风险与注意事项

1. **LLM 评分主观性**：同一个 query 可能在不同轮次得到不同评分。缓解：固定 temperature=0，必要时跑 2 次取平均。
2. **Flat 和 Grouped 信息量不等**：Flat 只有 relevance>0 的条目，Grouped 会多出 chain 链路中 relevance=0 的折叠条目和 KB 标注。这是**有意为之**——我们要对比的就是"纯命中条目"vs"带结构标注的全部条目"。
3. **评分 prompt 偏差**：LLM 可能倾向于给更长/更结构化的文本更高分（长度偏差）。需要在报告中明确讨论此局限性。缓解：要求 score 基于"能否找到答案"而非"文本看起来是否专业"。
4. **DeepSeek-V3 的 JSON 输出稳定性**：可能返回非标准 JSON。需要 fallback 解析（正则提取 score 字段）。

---

## 七、验证方法

1. **构建通过**：`npm run build` 无错误
2. **单元测试不变**：`npm test` 422 tests 全过（本计划不改任何 src/ 代码）
3. **手动抽样验证**：挑 3 个 query，人工阅读 Flat/Grped 文本，判断预期分数，与 LLM 评分对比
4. **一致性检查**：同 query 跑 2 次，检查 score 是否一致（差异 ≤ 1 分算一致）
