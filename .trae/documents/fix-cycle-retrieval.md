# 解环：retrieval-filter.js ⇄ retrieval-fusion.js

> 问题 B：循环依赖 — 提取共享函数 `buildSearchableText` 到独立文件

---

## 现状分析

### 循环路径

```
engine/retrieval-fusion.js ──import──→ vault/retrieval-filter.js  (buildSearchableText)
       ↑                                      │
       └──────import──────────────────────────┘
              (ensureVectorIndex, vectorSearch, rrfFuse, getVectorIndex)
```

### 具体引用

| 文件 | 从对方导入 | 用途 |
|------|------|------|
| `retrieval-fusion.js` | `buildSearchableText` | `ensureVectorIndex` 中为每个 STM 构建文本后计算 embedding |
| `retrieval-filter.js` | `ensureVectorIndex, vectorSearch, rrfFuse, getVectorIndex` | `filterCandidates` 末尾的可选向量搜索+RRF融合步骤 (L412-L452) |

### `buildSearchableText` 使用者

| 位置 | 行 | 场景 |
|------|---|------|
| `retrieval-filter.js` | L306 | `filterCandidates` 内部 BM25 分词前构建文本 |
| `retrieval-fusion.js` | L39 | `ensureVectorIndex` 构建向量索引文本 |
| `test/bm25-scoring.test.js` | L1 | 单元测试（从 `retrieval-filter.js` 导入） |

---

## 解环方案

**核心思路**：`buildSearchableText` 是纯数据变换函数（零外部依赖），被两个文件共享使用。将其提取到独立文件，切断交叉 import。

**选择位置**：`engine/retrieval-text.js`（engine 层）

理由：
- `retrieval-filter.js`（vault 层）已经大量从 engine 层导入（`text-utils.js`、`embedding.js`），方向一致
- 该函数无 vault 依赖，是检索域的纯文本工具

```
engine/retrieval-text.js  ← 新建，含 buildSearchableText
       ↙              ↘
retrieval-fusion.js    retrieval-filter.js
(engine层)              (vault层)
```

### 实施步骤

#### Step 1：创建 `src/core/engine/retrieval-text.js`

从 `retrieval-filter.js` L22-L42 复制 `buildSearchableText` 函数体。内容：

```js
/**
 * @param {import('../types.js').STMEvent} entry
 * @param {Object} [aliasesMap]
 * @returns {string}
 */
export function buildSearchableText(entry, aliasesMap) {
    var parts = [];
    if (entry.period) parts.push(entry.period);
    if (entry.time_range) parts.push(entry.time_range);
    if (entry.time_label) parts.push(entry.time_label);
    if (entry.scene) parts.push(entry.scene);
    if (entry.event) parts.push(entry.event);
    if (entry.translation) parts.push(entry.translation);
    if (entry.entities && Array.isArray(entry.entities)) {
        entry.entities.forEach(function(en) {
            if (en.name) {
                parts.push(en.name);
                var aliases = aliasesMap ? aliasesMap[en.name] : null;
                if (aliases && Array.isArray(aliases)) {
                    aliases.forEach(function(a) { if (a) parts.push(a); });
                }
            }
        });
    }
    return parts.join(' ');
}
```

#### Step 2：修改 `src/core/engine/retrieval-fusion.js`

- 删除 L2：`import { buildSearchableText } from '../vault/retrieval-filter.js';`
- 添加：`import { buildSearchableText } from './retrieval-text.js';`

#### Step 3：修改 `src/core/vault/retrieval-filter.js`

- 删除 L22-L42：`buildSearchableText` 函数定义
- 添加：`import { buildSearchableText } from '../engine/retrieval-text.js';`
- 添加：`export { buildSearchableText };`（向后兼容 re-export）

#### Step 4：验证

1. `npm run build` — exit 0，Rollup 不再报循环依赖
2. `npm test` — 22 个单元测试 + 3 个 ratchet 全部通过
3. 确认 `dist/index.js` 中 `buildSearchableText` 正确解析

---

## 循环依赖是否真的消除？

**修复前**：
```
retrieval-fusion.js → retrieval-filter.js → retrieval-fusion.js  (环)
```

**修复后**：
```
retrieval-filter.js → retrieval-fusion.js  (单向)
retrieval-filter.js → retrieval-text.js    (单向)
retrieval-fusion.js → retrieval-text.js    (单向)
```

三个文件之间不存在任何环路。✅

---

## 风险评估

| 风险 | 等级 | 说明 |
|------|:---:|------|
| 函数字节级完全一致 | 低 | 逐字节复制，零逻辑变更 |
| JSDoc typedef 路径 | 低 | 新文件在 `engine/` 下，路径应为 `../types.js`；原文件在 `vault/` 下，路径为 `../../types.js` |
| 测试兼容 | 低 | `retrieval-filter.js` 保留 re-export，`test/bm25-scoring.test.js` 的 import 无需修改 |
| 其他消费者 | 无 | `buildSearchableText` 仅被 `retrieval-fusion.js` 和 `retrieval-filter.js` 内部使用，无其他 import |
