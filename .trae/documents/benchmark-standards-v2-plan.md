# 基准测试标准 V2 升级计划

**日期**: 2026-06-30
**状态**: 待审核

---

## 一、目标

升级基准测试体系，使指标权重、断言和报告结构匹配当前生产环境的实际消费链路。

### 核心矛盾

Phase 2 的基准设计假设：
- 50/50 narrative/targeted 查询分布 → **实际：100% narrative**
- 全量注入所有条目 → **实际：top-3 有原文预取，top-5 用于降级，其余按命中/未命中分层**
- 所有条目价值均等 → **实际：活跃角色 > 场景外角色 > 未标注 > 未命中（折叠）**

---

## 二、新增指标

### 2.1 WeightedScore（双主指标之一，与 NDCG@10 并列）

```
WeightedScore = 0.35 × Hit@3 + 0.25 × P@5 + 0.20 × NDCG@10 + 0.10 × R@10 + 0.10 × R@20
```

权重设计依据：

| 项 | 权重 | 对应消费路径 | 理由 |
|----|------|-------------|------|
| Hit@3 | 0.35 | 原文预取 (injection.js:279) | 核心窄口 — top 3 带原文进入注入 |
| P@5 | 0.25 | LLM 降级 (injection.js:348) | 降级模式 — 仅 top 5 直接列出 |
| NDCG@10 | 0.20 | 正常注入 — 活跃角色块 | 排序质量，LLM注意力递减 |
| R@10 | 0.10 | 活跃角色 + 场景外 | 召回覆盖，辅助 |
| R@20 | 0.10 | 场景外 + 折叠行 | 低价值但保留信号 |

### 2.2 活跃角色命中指标（新增辅助指标）

在 `queries.js` 中为每条 query 标注 `activeEntities`：

```javascript
{ query: '...', groundTruth: {...}, type: 'narrative', activeEntities: ['江岚', '安然'] }
```

基于此计算：
- **P@5 (active)**：top-5 中活跃角色 GT 条目占活跃角色 GT 总数的比例
- **Hit@5 (active)**：top-5 中至少命中 1 条活跃角色条目的 query 占比

注意：这些指标依赖 fixture 中每条 stm 的 entities 字段标注角色名，已在 fixture 中存在。

---

## 三、断言调整

### 当前断言 → 新断言

| 旧编号 | 旧断言 | 新编号 | 新断言 |
|--------|--------|--------|--------|
| A1 | RRF NDCG@10 ≥ BM25 × 0.9 | A1 | **不变** |
| A2 | RRF MRR ≥ BM25 × 0.9 | A2 | **不变** |
| A3 | RRF vectorUsed=true | A3 | **不变** |
| A4 | RRF Targeted R@10 ≥ BM25 Targeted R@10 × 0.85 | A4 | 阈值 0.85→**0.80**（targeted 无生产价值，仅守护极端退化） |
| — | — | **A5** | RRF Narrative Hit@5 ≥ 0.80 |
| — | — | **A6** | RRK WeightedScore ≥ BM25 WeightedScore × 0.95 |

### 断言语义

- A1-A3：回归守护（与当前相同）
- A4：降低 targeted 守护阈值，反映其实际价值下降
- A5：新增。确保叙事型查询的 top-5 命中率不退化（原文预取 + 降级的核心守护）
- A6：新增。确保 RRF 的综合消费权重不低于 BM25（如果 RRF 退化到不如 BM25，应关掉向量走纯 BM25）

---

## 四、报告结构调整

### 当前报告结构

```
## Configuration
## Overall Results (mean/median for all 9 metrics)
## Per-Query Breakdown
## Diagnostic Notes
```

### 新报告结构

```
## Configuration
## Core Metrics (消费链路关键节点)
  | Round | Hit@3 | P@5 | NDCG@10 (active) | WeightedScore |
## Extended Metrics (辅助参考)
  | Round | P@10 | P@20 | R@5 | R@10 | R@20 | MRR | NDCG@10 |
## By Query Type
  | Type | P@10 | NDCG@10 | P@5 (active) | WeightedScore |
## Per-Query Breakdown
## Diagnostic Notes
```

### 关键变更

- **双层指标**：Core 层只展示消费链路相关的关键指标（Hit@3, P@5, NDCG@10, WeightedScore），Extended 层展示传统 9 指标作为参考
- **NDCG@10 (active) 只在 narrative 查询上有意义**（targeted 查询的活跃角色定义不明）
- **WeightedScore 与 NDCG@10 并列**为主决策指标
- **k-sweep 表格新增 WeightedScore 列**

---

## 五、需修改的文件

| 文件 | 改动内容 |
|------|----------|
| `test/retrieval-benchmark/queries.js` | 新增 `activeEntities` 字段（每条 query） |
| `test/retrieval-benchmark/fixture.js` | 确认每条 stm 已有 entities 字段，输出 `entityToStmIds` 映射 |
| `test/retrieval-benchmark/metrics.js` | 新增 `hitAtK_active(ids, gt, activeEntities, entityToStmIds, k)` |
|  | 新增 `precisionAtK_active(ids, gt, activeEntities, entityToStmIds, k)` |
|  | 新增 `weightedScore(scores)` |
| `test/retrieval-benchmark/benchmark-runner.js` | `runBM25Round/runVectorOnlyRound/runRRFRound` 中调用新指标 |
|  | 聚合函数 `aggregateMetrics` 包含新指标 |
|  | K_SCAN_VALUES 恢复为粗扫数组 [20,30,40,50,60,80,100,110,120,130,150,200] |
| `test/retrieval-benchmark/benchmark.test.js` | 报告结构调整（双层指标 + 活跃角色命中展示） |
|  | 断言 A4 阈值改为 0.80 |
|  | 新增断言 A5 (Narrative Hit@5 ≥ 0.80) |
|  | 新增断言 A6 (RRF WeightedScore ≥ BM25 WeightedScore × 0.95) |
|  | k-sweep 表新增 WeightedScore 列 |
| `test/retrieval-benchmark/fixture.js` | 新增导出 `entityToStmIds` 映射（entity名→stm_id[]） |

---

## 六、不影响的部分

- 检索源码（injection.js / retrieval-filter.js / retrieval-fusion.js）— 不变
- 实体块渲染 — 不变
- 基准测试的查询构造和评估流程 — 不变（仅新增指标）
- k=110 默认值 — 不变

---

## 七、活跃角色判定逻辑（benchmark 内）

fixture 中每条 stm 有 `entities` 字段，queries 中标注 `activeEntities`。benchmark 内交叉比对：

```javascript
// 伪代码
function hitAtK_active(ids, gt, activeEntities, entityToStmIds, k) {
    var activeStmIds = {};
    activeEntities.forEach(function(name) {
        var stmIds = entityToStmIds[name] || [];
        stmIds.forEach(function(id) { activeStmIds[id] = true; });
    });
    var relevantActive = {};
    Object.keys(gt).forEach(function(id) {
        if (gt[id] >= 1 && activeStmIds[id]) relevantActive[id] = true;
    });
    var total = Object.keys(relevantActive).length;
    if (total === 0) return 1.0;
    var hits = 0;
    for (var i = 0; i < Math.min(k, ids.length); i++) {
        if (relevantActive[ids[i]]) hits++;
    }
    return hits / total;
}
```

---

## 八、假设与决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 双主指标（WeightedScore + NDCG@10） | WeightedScore 贴近消费链，NDCG@10 保留学术参考点 |
| 2 | WeightedScore 权重 (35/25/20/10/10) | 模拟消费链路实际价值梯度 |
| 3 | Hit@3 最高权重 (0.35) | 原文预取是最核心的消费窄口 |
| 4 | P@5 次高权重 (0.25) | 降级路径的唯一依赖 |
| 5 | activeEntities 标注在 queries.js | 每条 query 的"场景上下文"已知，可以手工标注活跃角色 |
| 6 | 活跃角色命中仅用于 narrative 查询 | targeted 查询的活跃角色定义不明（查询可能跨越多个场景） |
| 7 | 一次全改 | 构建+单元测试+基准验证一次性验证 |

---

## 九、验证步骤

1. `npm run build` — 编译通过
2. `npm test` — 24 单元测试 + 3 ratchets 通过
3. 运行 full 三轮基准：`NE_BENCHMARK_MODE=all node test/retrieval-benchmark/benchmark.test.js` — 检查新报告格式和断言
4. 运行 k-sweep：`NE_BENCHMARK_MODE=ksweep node test/retrieval-benchmark/benchmark.test.js` — 检查 WeightedScore 列
