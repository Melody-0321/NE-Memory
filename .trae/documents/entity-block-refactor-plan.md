# 实体块渲染重构计划

**日期**: 2026-06-30
**状态**: 待审核

---

## 一、目标

重构 `buildEntityBlock()` 的输出格式，使最终注入到对话 LLM 的实体记忆块符合以下设计意图：

1. **命中/未命中区分**：检索命中的事件显示完整摘要+评分；链中未命中事件折叠为时间范畴
2. **场景活跃过滤**：仅当前场景活跃角色独立出块；场景外角色归入"场景外角色"区块，格式一致
3. **评分标记**：命中事件附 `[score:0.XXX]` 标记
4. **未标注条目保留**：无实体归属的命中条目单独成块

### 目标输出示例

```markdown
## 实体记忆链

### 江岚 (7 events in chain, 3 hits) [KB: 直接知晓(主角)]
1. [Day 1] 阳台初见: 江岚与安然在阳台相遇 [score:0.834]
2. [Day 2] 写作瓶颈: 江岚对着空白文档发愁 [score:0.721]
3. [Day 3] D3-D5（3条事件未展开）
4. [Day 6] 编辑讨论: 江岚与编辑讨论新书大纲 [score:0.456]

   关联: 见「林晚」stm_08, stm_18

### 安然 (4 events in chain, 2 hits) [KB: 直接知晓(活跃)]
1. [Day 1] 阳台初见: 江岚与安然在阳台相遇 [score:0.834]
2. [Day 4] D4-D6（2条事件未展开）

   关联: 见「林晚」stm_11

### 未标注条目 (1 entry)
1. [Day 3] 编辑部下午茶 [score:0.234]

### 场景外角色

#### 林晚 (5 events in chain, 2 hits)
1. [Day 3] D3-D5（3条事件未展开）
2. [Day 3] 咖啡馆偶遇: 林晚与江岚在咖啡馆闲聊 [score:0.567]
3. [Day 5] 线下活动: 林晚参加签售会 [score:0.412]

#### 苏茉 (3 events in chain, 1 hit)
1. [Day 4] 试读反馈: 苏茉给出试读意见 [score:0.389]
2. [Day 6] D6-D7（2条事件未展开）
```

---

## 二、当前状态分析

### 2.1 现有数据流

```
formatSmartContext()
  ├─ state.characters → aliasesMap (所有角色)
  ├─ lookupEntityChains() → entityChains { name: [full chain entries] }
  ├─ filterCandidates() → topCandidates (BM25/向量命中 + 可选 RRF 融合)
  ├─ mergePipelines(topCandidates, entityChains, ...) → { map, threadIndex }
  │    ├─ Step 1: BM25 命中 → map.set(id, { sources: ['bm25'], bm25Score })
  │    └─ Step 2: chain 遍历 → 重叠条目追加 threads/sources; 新条目 → map.set(id, { sources: ['chain:name'], bm25Score:0 })
  ├─ groupCandidatesByEntity(map, threadIndex) → entityGrouped { groups: { name: { entries[], refs[] } }, unassigned[] }
  │    entry = { entry: stm, type, bm25Score, threads, sources, ... }
  └─ buildEntityBlock(entityGrouped, entityAnnotations)
       └─ 当前：所有 group.entries 全量渲染 → 无命中/未命中区分
```

### 2.2 命中判定方法

`mergePipelines` 输出中：
- **命中条目**：`sources.indexOf('bm25') !== -1` 且 `bm25Score > 0`
- **链未命中条目**：`sources.indexOf('bm25') === -1`（仅有 `'chain:name'`），`bm25Score === 0`

该标记已存在于 Map 的每个 value 中，可直接用于渲染区分。

### 2.3 活跃角色判定方法

`state.characters[name].status === '活跃' || 'active'`，已在 `buildRetrievalPrefix()` 中使用，可直接复用。

---

## 三、需修改的文件

### 文件 1: `src/core/engine/injection.js`（主要改动）

#### 3.1 新增：活跃角色提取函数

在文件顶部（`buildRetrievalPrefix` 附近）新增：

```javascript
function getActiveCharacters(state) {
    var chars = state.characters || {};
    return Object.keys(chars).filter(function(n) {
        var c = chars[n];
        return c && (c.status === '活跃' || c.status === 'active');
    });
}
```

#### 3.2 重构：`buildEntityBlock(entityGrouped, entityAnnotations, activeChars, entityChains)`

**新增参数**：
- `activeChars: string[]` — scene 内活跃角色名列表
- `entityChains: object` — `{ name: [full chain entries] }`，用于获取未命中条目的时间范围

**新增逻辑**：

1. 分割 groups 为 active blocks 和 external blocks
2. 每个 block 内区分 hit（`sources.indexOf('bm25') !== -1`）和 chain-only（`bm25Score === 0`）
3. Hit 条目：完整摘要 + `[score:X.XXX]`
4. Chain-only 条目：连续时间范畴折叠（如 `D3-D5（3条事件未展开）`）
5. 活跃角色 + 场景外角色各自输出，格式一致
6. 未标注条目保持不变

**时间折叠算法**：
- 遍历 entries（已按 period 排序）
- 连续非命中条目归并为一个时间范畴折叠行
- 单个非命中条目：`D4（未展开）`
- 多个连续非命中：`D3-D5（3条事件未展开）`

**为什么 entityChains 作为参数传入**：
- 判定未命中条目的时间范围需要完整链条信息
- 非命中条目可能只有部分在 entityGrouped 中（取决于 mergePipelines 的 chain 注入范围）
- entityChains 提供权威的完整链数据

#### 3.3 更新调用点

`formatSmartContext()` 中调用 `buildEntityBlock` 处：

```javascript
// 原: var entityBlock = buildEntityBlock(entityGrouped, parseResult.entityAnnotations);
var activeChars = getActiveCharacters(state);
var entityBlock = buildEntityBlock(entityGrouped, parseResult.entityAnnotations, activeChars, entityChains);
```

#### 3.4 调整缺口标记逻辑

**现状**（L398-413）：缺口标记遍历 entityChains，对每个有链的实体输出"X 另有 N 条事件未展开"。

**调整**：未命中事件现在已折叠在实体块内（时间范畴显示），缺口标记改为**仅提示场景外角色中完全未被任何检索命中的实体链**，例如：

```markdown
---
场景外链: 苏晴 (3条事件，均未在本次检索中命中)
```

实现：遍历 entityChains，找出链中**没有任何条目**出现在 merged map 中的实体名，仅对这些输出提示。

如果没有这样的实体链，则完全省略缺口标记段。

---

## 四、改动范围总结

| 文件 | 改动类型 | 内容 |
|------|----------|------|
| `src/core/engine/injection.js` | 新增函数 | `getActiveCharacters(state)` |
| `src/core/engine/injection.js` | 重构函数 | `buildEntityBlock()` — 新增参数 + 命中/未命中折叠 + 活跃/场景外分层 |
| `src/core/engine/injection.js` | 修改调用 | `formatSmartContext()` 传入 activeChars 和 entityChains |
| `src/core/engine/injection.js` | 调整逻辑 | 缺口标记段改为仅提示"完全未命中"的实体链 |
| 其他文件 | **无改动** | retrieval.js / retrieval-filter.js / retrieval-fusion.js 不变 |

---

## 五、不影响的部分

- `filterCandidates()` 检索逻辑 — 不变
- `mergePipelines()` 融合逻辑 — 不变
- `groupCandidatesByEntity()` 分组逻辑 — 不变
- `formatEntityGroupedText()`（检索 LLM prompt 格式） — 不变
- `buildRetrievalPrefix()` — 不变
- `buildMemoryUsageGuide()` — 不变
- 缺口检测 `parseEntityAnnotations().gaps` — 不变

---

## 六、假设与决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 命中判定用 `sources.indexOf('bm25')` | 语义准确，mergePipelines Step 1 已设置 |
| 2 | 活跃角色判定用 `state.characters.status` | 结构化数据，可靠，已在 buildRetrievalPrefix 中验证过 |
| 3 | entityChains 作为权威链数据源传入 | 非命中条目信息在 entityChains 中比 merged map 更完整 |
| 4 | 场景外角色用 `####` 四级标题 | 区别于活跃角色的 `###` 三级标题，视觉层级分明 |
| 5 | 时间折叠按 period 连续归并 | period 类似 "Day 3" 格式，字符串可排序和片断化 |
| 6 | 缺口标记仅提示"完全未命中"链 | 避免与块内折叠的时间范畴重复 |
| 7 | 不修改检索 LLM prompt (`formatEntityGroupedText`) | 用户未要求；检索 LLM 需要全量信息做 KB 标注 |
| 8 | 评分显示为 `[score:0.XXX]` 格式 | 保持简洁，提醒但不渲染为技术细节 |

---

## 七、验证步骤

1. `npm run build` — 编译通过
2. `npm test` — 24 单元测试 + 3 ratchets 通过
3. 手动运行基准测试确认报告正常：`NE_BENCHMARK_MODE=all node test/retrieval-benchmark/benchmark.test.js`
4. 手工构建测试场景验证输出格式：
   - 创建含活跃+非活跃角色命中 + 链未命中条目的测试 STM 数据
   - 调用 `formatSmartContext` 后检查输出 Markdown 结构
   - 确认命中/未命中折叠、活跃/场景外分层正确
