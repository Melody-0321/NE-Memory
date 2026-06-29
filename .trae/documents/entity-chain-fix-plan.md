# 实体链系统完善计划

## 摘要

实体链系统的检索端代码完整且设计合理，但 STM 生产端在 5 条 prompt 路径中只有 1 条路径（`buildSTMUpdatePrompt`）产生了实体的 `entities` 字段——且该项被标注为 optional。另外 4 个 STM prompt 路径完全没有 entities 指令，validation 层也不校验/后处理 entities。结果是 `lookupEntityChains` 大部分时候因 STM 缺少数据结构化实体标记而返回空对象，`mergePipelines` Step 2 形同虚设。

**目标**：让所有 STM 提取 prompt 路径稳定产出结构化实体标记，validation 层校验并后处理 entities，使检索端的 entity chain 查找能力可正常工作。

---

## 当前状态分析

### 1. 定义层（State）— ✅ 完成

状态中的 `characters` 和 `factions` 是已知实体登记册，由 `state-pipeline.js` 维护。检索端 `extractEntityNames` 依赖这些字典作为一级来源。

### 2. 生产层（STM 提取）— ❌ 严重不足

STM 提取有 **5 条 prompt 路径**，实体标记能力参差不齐：

| 路径 | 函数 | entities 字段 | 格式 | optional? | 已知实体注入 |
|------|------|:---:|------|:---:|:---:|
| 增量更新 | `buildSTMUpdatePrompt` (L13) | ✅ | `[{name,type}]` | ⚠️ 是 | 仅活跃角色 |
| Cursor (历史处理) | `buildCursorPrompt` (L126) | ❌ 旧格式 | `"entity": "Alice"` 字符串 | — | 仅角色全名列表 |
| Batch (批量处理) | `buildBatchPrompt` (L252) | ❌ 无 | — | — | 无 |
| STM Only | `buildStmOnlyPrompt` (L330) | ❌ 无 | — | — | 无 |
| Segment Summary | `buildStmSummaryPrompt` (L480) | ❌ 无 | — | — | 无 |

**具体问题**：

- **(P1) Cursor 路径** [stm-pipeline.js:L199-L213](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js#L199-L213)：使用旧格式 `"entity": "爱丽丝, 魔教"`（逗号分隔字符串），而 `lookupEntityChains` [retrieval.js:L22-L25](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js#L22-L25) 只匹配 `e.entities.some(en => en.name === name)` 结构化格式。**旧格式完全不可被检索消费。**

- **(P2) Batch / STM Only / Summary 路径**：完全没有 entities 字段。`Process History` 触发的历史消息处理走 `buildBatchPrompt` → `buildStmSummaryPrompt`，这些路径产生的 STM entries 永远不会有实体标记。

- **(P3) 增量更新路径虽然格式正确，但 entities 标记为可选** [stm-pipeline.js:L101](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js#L101)。从 prompt-engineering 原则 3.1 角度：optional 字段 + 无上下文引导 = LLM 倾向于省略。

- **(P4) 没有路径向 LLM 提供完整已知实体清单**。`buildSTMUpdatePrompt` [stm-pipeline.js:L32-L42](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js#L32-L42) 只在 `currentStateSnapshot` 中输出 "Active characters: 爱丽丝, 鲍勃"，但没有注入 factions 列表，也没有声明"这些是已知实体名称，请标记时复用"。LLM 不知道哪些名字已存在于 state 中，可能造出新名字导致后续检索时实体名（mispelling/同义不同名）不匹配。

### 3. 校验层（validate.js）— ❌ 缺失

| 函数 | entities 校验 | entities 后处理 |
|------|:---:|:---:|
| `validateSTMOutput` [validate.js:L3-L21](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js#L3-L21) | ❌ 不检查 | ❌ 不处理 |
| `postFillSTM` [validate.js:L23-L47](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js#L23-L47) | — | ❌ 不处理 entities |
| `validateLTMOutput` [validate.js:L56-L81](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js#L56-L81) | ❌ 不检查 | — |
| `postFillLTM` [validate.js:L83-L159](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js#L83-L159) | — | ❌ 不从 STM 继承 entities |

### 4. 消费层（检索端）— ✅ 完成

检索端消费代码完整：

```
injection.js:formatSmartContext
  ↓ extractEntityNames(query, content)       ← 来源: state.characters/factions + STM entities[].name
  ↓ lookupEntityChains(content, entityNames) ← 匹配: e.entities.some(en.name === name)
  ↓ mergePipelines(bm25, entityChains, ...)  ← 融合到 Map + threadIndex
  ↓ buildRetrievalPrompt(notebook, ...)      ← 渲染 {L:entityName#pos/total} 标注
  ↓ callMemoryRetrievalWithTools → LLM       ← LLM 消费线程标注
```

`buildSearchableText` [retrieval-text.js:L6-L25](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval-text.js#L6-L25) 也将实体名写入向量搜索文本。

结论：消费端设计正确，仅仅是吃不到数据（因为 STM 生产端没有稳定产出 entities）。

---

## 拟议变更

### Phase 1：统一所有 STM prompt 路径的 entities 指令

#### 1A. `buildCursorPrompt` — 废弃旧格式，改用结构化 entities

**文件**: [stm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js)

**变更**：
- L199 `"entity": optional string — characters/factions involved` → 替换为与 `buildSTMUpdatePrompt` L101 一致的结构化 entities 指令
- L210 同步更新中文版本
- L225-L226 的 user prompt 示例中 `"entity": "..."` 替换为 `"entities": [{...}]`

**prompt-engineering 注意事项**：
- 原则 1.2（语义共现）：entities 的字段描述与格式示例放在同一 prompt 段，不分离
- 原则 2.2（单一定义）：entities 的格式定义与 `buildSTMUpdatePrompt` 保持一字不差的一致

#### 1B. `buildBatchPrompt` — 新增 entities 字段

**文件**: [stm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js)

**变更**：
- events 数组中每个 entry 的 schema 增加 `"entities": [{"name":"Alice","type":"character"}]` 字段
- 中文和英文两个分支都需要加
- 格式描述与 1A 保持一致

**prompt-engineering 注意事项**：
- 原则 1.1（最后一行权重）：entities 指令放在 schema 示例之后、规则之前，不与 "## 判断标准" 或 LTM decision 指令竞争注意力
- 不为 entities 单独创建新的 `## 规则` header，因为这会与 LTM 判断标准产生注意力竞争——复用现有字段描述段落末尾

#### 1C. `buildStmOnlyPrompt` — 新增 entities 字段

**变更**：与 1B 相同，在 events 数组 schema 中增加 entities 字段。

#### 1D. `buildStmSummaryPrompt` — 新增 entities 字段

**变更**：与 1B 相同，在 events 数组 schema 中增加 entities 字段。

#### 1E. `buildSTMUpdatePrompt` — entities 从 optional 改为 required（带降级）

**变更**：
- L101/L118：`"entities": optional` → `"entities": required` 但增加降级路径："如果事件中无明确实体参与者，设为空数组 []"
- 从 prompt-engineering 原则 3.1：必须显式建模空输出路径

### Phase 2：在 STM prompt 中注入已知实体清单

**文件**: [stm-pipeline.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/stm-pipeline.js)

**新增函数**: `buildKnownEntityCatalog(vault)` — 从 `content.state.characters[].key` + `content.state.factions[].key` 构建已知实体名称列表，含别名（取自 `state.characters[name].aliases` 字段）。

**注入位置**: 所有 5 条 prompt 路径的 system 指令中

**格式**（prompt-engineering 原则 5.1：字段自说明）：
```
## 已知实体（标记 entities 时请复用这些名称）
- 角色：爱丽丝（活跃）| 鲍勃（活跃）| 查理（非活跃）
- 势力：魔教 | 光明会
请注意：标记实体时，名称必须与上述列表精确匹配，不要使用缩写、昵称或变体。
```

**prompt-engineering 注意事项**：
- 原则 1.2（语义共现）：实体清单放在 entities 字段格式描述之前或同一段内，确保 LLM 在看到 "entities" 字段名时，前文 1000 token 内就有实体名称参考
- 原则 3.2（增量更新）：额外说明"如有新角色在对话中首次被命名，也标记为 character 类型"
- **不要** 放在 `## 严格禁止` 段内，而是放在 `## 需要提取` 段或字段规则段

### Phase 3：validate.js 增加 entities 校验与后处理

#### 3A. `validateSTMOutput` — 增加 entities 检查

**文件**: [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js)

**变更**：
```javascript
// 在 for 循环内，event 检查之后增加：
if (e.entities && Array.isArray(e.entities)) {
    // 格式规范化：字符串数组 → 结构化
    e.entities = e.entities.map(function(en) {
        if (typeof en === 'string') return { name: en, type: 'character' };
        return en;
    });
}
// 未标记实体的条目不报错，仅记录 warning（因为可能存在"无角色参与的系统事件"）
if (!e.entities || e.entities.length === 0) {
    // 不报错——空数组是合法的
}
```

#### 3B. `postFillSTM` — 增加 entities 后处理

**文件**: [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js)

**变更**：在 `postFillSTM` 末尾增加：
```javascript
// entities 后处理：从 state 推断正确 type
var state = content.state || {};
var characters = state.characters || {};
var factions = state.factions || {};
stmEntries.forEach(function(e) {
    if (!e.entities || e.entities.length === 0) return;
    e.entities = e.entities.map(function(en) {
        if (typeof en === 'string') en = { name: en, type: 'character' };
        if (characters[en.name]) en.type = 'character';
        else if (factions[en.name]) en.type = 'faction';
        return en;
    });
});
```

#### 3C. `postFillLTM` — 从源 STM 继承 entities

**文件**: [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js)

**变更**：在 `postFillLTM` 末尾增加 entities 聚合逻辑：
```javascript
// 从 stm_refs 聚合 entities
e.entities = e.entities || [];
var stmEntityNames = {};
e.entities.forEach(function(en) { stmEntityNames[en.name] = true; });
(e.stm_refs || []).forEach(function(refId) {
    var stm = sourceSTMList.find(function(s) { return s.id === refId; });
    if (stm && stm.entities) {
        stm.entities.forEach(function(en) {
            if (!stmEntityNames[en.name]) {
                stmEntityNames[en.name] = true;
                e.entities.push({ name: en.name, type: en.type || 'character' });
            }
        });
    }
});
```

#### 3D. `validateLTMOutput` — entities 字段容错

**文件**: [validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js)

**变更**：在 for 循环中增加 LTM entity 格式矫正（与 3A 相同的字符串→结构化转换逻辑），但不强制要求 LTM 有 entities（LTM 的 entities 主要由 3C 的聚合逻辑提供）。

### Phase 4：Craft 模式增加 entities 自动提取

**文件**: [stm-pipeline.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-pipeline.js) 或新建 `engine/entity-extractor.js`

**背景**: Craft 模式（纯工具调用路径）的注入点在实际调用过程中传递 tool 结果，不走 STM pipeline。这些消息的 entities 无法通过 prompt 产生。

**变更**: 当 STM events 返回后（`executeIncrementalUpdate` L596-L603），在 `postFillSTM` 之前，调用一个新函数 `enrichEntitiesFromText`：
- 对每个 STM entry，从其 `event` 文本中，用 state 中的角色/势力名做子串匹配
- 如果事件文本包含 "爱丽丝"，且 entities 中没有，添加 `{name:"爱丽丝", type:"character"}`
- 如果事件文本包含 "魔教"，且 entities 中没有，添加 `{name:"魔教", type:"faction"}`
- 这是在 LLM prompt 之外的代码层兜底——不会产生假阳性因为 state 中的名字都是实体注册名

**这个函数放在 `postFillSTM` 中调用**（Phase 3B 位置）更合适，因为 state 可以直接作为参数。

---

## 假设与决策

1. **Craft 模式不需要 prompt 修改**：Craft 模式的检索走 `callMemoryRetrievalWithTools`，entities 通过 Phase 4 的文本匹配兜底。不需要为 Craft 模式单独建 entities prompt。
2. **旧格式 `"entity": "string"` 完全废弃**：不保持向后兼容，因为旧格式本质上是死代码——消费端（`lookupEntityChains`）不会解析它。validate 层会做格式矫正，旧数据自然迁移。
3. **不修改 `retrieval.js` / `retrieval-fusion.js` / `retrieval-text.js`**：消费端已完整，不需要改动。
4. **entities 缺失不报错**：空数组 `[]` 是合法的降级状态——不是所有事件都有关联的角色或势力实体。仅记录 warning 日志用于监控。
5. **不修改 `buildLtmDecisionPrompt`**：该 prompt 在 `ltm-pipeline.js` 中，当前版本不要求 LLM 输出 entities——而是通过 `postFillLTM` 从源 STM 聚合 entities（Phase 3C）。这是合理的设计，不需要改变。
6. **已知实体清单不包含别名扩展**：Phase 2 的 `buildKnownEntityCatalog` 仅列出 state.characters/factions 的 key 名称。别名由 `buildSearchableText` 在检索时从 `aliasesMap` 扩展，不需要在 STM prompt 中暴露。

---

## 验证方案

### 1. 单元测试

新增测试文件 `test/entity-chain.test.js`：

```javascript
// 测试 postFillSTM entities 后处理
// 测试 postFillLTM entities 聚合
// 测试 enrichEntitiesFromText 文本匹配
// 测试 validateSTMOutput entities 格式矫正
```

### 2. 烟雾测试

```bash
# 运行 14 号烟雾测试验证完整链路
npm run test:unit
```

### 3. 监控点

在 `executeIncrementalUpdate` 完成后（L596-L603 之后），新增遥测字段：

```javascript
recordTelemetry({
    pipeline_task: 'stm_extract',
    stm_count: events.length,
    stm_with_entities: events.filter(function(e) { return e.entities && e.entities.length > 0; }).length,
    entity_names: [...new Set(events.flatMap(e => (e.entities||[]).map(en=>en.name)))]
}, chatId);
```

### 4. 棘轮测试更新

更新 `test/ratchet-empty-catch.test.js` 的基线（如果新增代码引入了 try/catch）。当前基线 3 个。

---

## 实施顺序

1. **Phase 1A** — 修复 `buildCursorPrompt`（影响历史处理路径）
2. **Phase 1B-D** — 统一 `buildBatchPrompt` / `buildStmOnlyPrompt` / `buildStmSummaryPrompt`
3. **Phase 1E** — entities 从 optional → required+降级
4. **Phase 2** — 注入已知实体清单到所有 prompt
5. **Phase 3A-D** — validation/pfill entities 处理
6. **Phase 4** — Craft 模式文本匹配兜底
7. 单元测试 + 烟雾测试验证
