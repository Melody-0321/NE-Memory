# 向量-RRF 管线监控方案

## 摘要

在 retrieval-filter.js 中将 `_vectorUsed` 和 `_vectorCandidateCount` 暴露到 `globalThis.__ne_debug_*`，在 monitor.js 和 assertions.js 中新增对应字段和 target，使冒烟测试和模块测试能自动断言向量检索是否被触发。

---

## 当前状态分析

### 现状：无法监控

`_vectorUsed` 的数据流如下：

```
retrieval-filter.js:418 _vectorUsed = true
  → L428 results._vectorUsed = _vectorUsed
  → injection.js:255 useVector = topCandidates._vectorUsed
  → recordTelemetry({ vector_used: ... })  ← 仅到 telemetryBuffer（内存，不持久化）
  → buildRetrievalMessages({ useVectorScore: ... })  ← 仅影响 LLM prompt 文案
  → ❌ 未写入任何 globalThis.__ne_debug_* 变量
```

`monitor.js` 的 `collectRoundData()` 无法触及 `_vectorUsed`，`assertions.js` 的 `resolveTarget()` 无 `vector_used` 相关 target。

**当前 smartpush-15 混合检索测试把"vector index 状态"和"useVectorScore 是否为 true"标为手工验证**（[test-case.md:L59-L62](file:///d:/SillyTavern/xm/ne-memory/test-cases/retrieval/smartpush-15-hybrid-retrieval/test-case.md#L59-L62)），不可自动化。

---

## 提案改动

### 改动 1：[retrieval-filter.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/retrieval-filter.js) — 暴露全局 debug 变量

在 L418 `_vectorUsed = true` 处，并列设置：

```javascript
_vectorUsed = true;
globalThis.__ne_debug_vector_used = true;
```

在 L428 `results._vectorUsed = _vectorUsed` 前，统一兜底（当向量搜索未启用或失败时）：

```javascript
globalThis.__ne_debug_vector_used = _vectorUsed;
```

同时在 L419 `console.log` 行后，暴露候选数量：

```javascript
globalThis.__ne_debug_vector_candidate_count = vecResults.length;
globalThis.__ne_debug_bm25_candidate_count = results.length;
```

### 改动 2：[monitor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/monitor.js) — 采集

在 `collectRoundData()` 的返回对象中新增：

```javascript
vectorUsed: globalThis.__ne_debug_vector_used || false,
vectorCandidateCount: globalThis.__ne_debug_vector_candidate_count || 0,
bm25CandidateCount: globalThis.__ne_debug_bm25_candidate_count || 0,
```

### 改动 3：[assertions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/assertions.js) — 断言 target

在 `resolveTarget()` 的 switch 中新增：

```javascript
case 'vector_used': return collected.vectorUsed;
case 'vector_candidate_count': return collected.vectorCandidateCount;
case 'bm25_candidate_count': return collected.bm25CandidateCount;
```

### 改动 4：测试用例 YAML

#### [smartpush-15/test-case.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/retrieval/smartpush-15-hybrid-retrieval/test-case.md)

structural 断言新增：

```yaml
- { op: equals, target: vector_used, value: true }
- { op: min_length, target: vector_candidate_count, value: 1 }
```

同时删除 markdown 中的"手工验证"段（已自动化）。

#### [smartpush-14-full-chain-smoke/test-case.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/smoke/smartpush-14-full-chain-smoke/test-case.md)

冒烟测试不要求向量搜索启用（它是可选功能），**不新增** vector_used 断言。冒烟测试的前置条件未要求 `enableVectorSearch=true`。

---

## 假设与决策

| 决策 | 理由 |
|------|------|
| 全局变量设在 `retrieval-filter.js` 而非 `injection.js` | retrieval-filter.js 是向量搜索决策的权威源，`_vectorUsed` 在此处赋值，设在此处可捕获所有路径（包括异常路径） |
| 新增 `vector_candidate_count` 和 `bm25_candidate_count` | 丰富的监控数据帮助诊断——如果 vector_used=true 但 vector_candidate_count=0，说明向量搜索跑了但没匹配到任何条目 |
| 冒烟测试不强制 `vector_used=true` | 向量搜索是可选项；冒烟测试验证的是"所有管线在无向量搜索时也不崩溃" |
| smartpush-15 模块测试强制 `vector_used=true` + `vector_candidate_count>=1` | 这是专门的混合检索测试，启用向量搜索是前置条件 |

---

## 验证步骤

1. `npm test` — 24 单元测试 + 3 ratchets 全部通过
2. 手动测试：配置硅基 bge-m3 → 启用向量搜索 → 触发 SmartPush → 确认 `globalThis.__ne_debug_vector_used === true`
3. 运行 smartpush-15 冒烟测试 → 确认报告中出现 `equals: vector_used = true → PASS` 和 `min_length: vector_candidate_count >=1 → PASS`
