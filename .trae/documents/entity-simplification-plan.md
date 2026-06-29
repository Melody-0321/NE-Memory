# Entity Simplification Plan — entities 纯角色名 + 散列实体移除

## 摘要

将 `entities` 从 `[{name, type}]` 对象数组简化为纯字符串数组 `["name"]`，砍掉所有非角色实体类型。
实体标记来源从"STM LLM 标注"切换为两条确定性路径：NE-BANNER 在场角色 seed + postFillSTM 文本匹配兜底。
同时移除散列叙事线 (note_thread / dispersed thread / D: 前缀)，因其"跨实体类型"的原始设计意图已失效。

## 当前状态分析

### 当前 entity 数据流

```
STM LLM 输出 entities[{name,type}]  (6种type: character/item/faction/location/concept/event)
    ↓
parseSTMResponse()  字符串/兼容格式 → 对象数组标准化
    ↓
validateSTMOutput() 二次防御性标准化
    ↓
postFillSTM()       类型推断(st.characters→character, st.factions→faction) + 文本匹配兜底
    ↓
IndexedDB 存储      entities[{name,type}]
    ↓
下游消费: extractEntityNames / lookupEntityChains / groupCandidatesByEntity
          (全部只读 name，不关心 type —— 除 ambiguity.js 一个排序条件)
```

### 关键发现

- **非角色实体类型 (item/location/concept/event) 无独立 state 存储**，仅存在于条目 entities 标注中，无下游消费者
- **type 字段只在 ambiguity.js:211 被消费**（排序优先级 `type==='character'`），其余所有下游只读 `name`
- **实体链从未发布过正式版本**，不存在旧格式数据需要迁移
- **NE-BANNER 在场角色已由 state pipeline 处理**（更新 character status），但未作为 entity seed 使用
- **散列叙事线 (dispersed thread)** 仅被 note_thread 工具创建，用于 Memory Analyst LLM 注册跨实体类型的叙事线

## 提案变更

### 变更 0：State Pipeline 存储在场角色 (state-pipeline.js)

**文件**: `src/core/engine/state-pipeline.js`
**位置**: 在 `pendingBlock.present` 处理块中（约 L695-L716）

```javascript
// 新增：在更新角色 status 后
if (pendingBlock.present && pendingBlock.present.length > 0) {
    vault.content._active_characters = pendingBlock.present.map(function(n) { return n.trim(); });
}
```

与 `story_time` / `story_scene` / `story_date` 并列写入，统一由 NE-BANNER 产出。

### 变更 1：postFillSTM — 重写实体后处理 (validate.js)

**文件**: `src/core/engine/validate.js`
**位置**: `postFillSTM()` 函数 (L29-L80)

```javascript
// 旧逻辑（将被替换）：
//   1. 类型推断 (characters/factions 反查 type)
//   2. 文本匹配兜底 (event 文本中出现的已知名)
//
// 新逻辑：
//   1. 从 vault.content._active_characters 读取 NE-BANNER 在场角色 seed
//   2. 遍历所有已知名 (state.characters + state.factions 的 keys)
//      在 event 文本中匹配 → 补标
//   3. 去重合并 seed ∪ 文本匹配结果 → entities 字符串数组
//   4. 每个条目默认 entities = []，有匹配则填充

var entities = [];

// NE-BANNER seed
if (content._active_characters && content._active_characters.length > 0) {
    content._active_characters.forEach(function(name) {
        if (entities.indexOf(name) === -1) entities.push(name);
    });
}

// 文本匹配兜底
var eventText = (e.event || '') + (e.scene || '') + (e.summary || '');
var allNames = Object.keys(characters).concat(Object.keys(factions));
allNames.forEach(function(name) {
    if (entities.indexOf(name) === -1 && eventText.indexOf(name) !== -1) {
        entities.push(name);
    }
});

e.entities = entities;
```

**注意**: 不再需要传入 vault，因为 `_active_characters` 已在 `vault.content` 中，而 `characters`/`factions` 也在 `vault.content.state` 中，postFillSTM 已有 `vault` 参数。

### 变更 2：移除 STM LLM 的 entities 输出 (stm-pipeline.js)

**文件**: `src/core/engine/stm-pipeline.js`

移除 content（所有 5 处）：
1. `buildSTMUpdatePrompt` EN/ZH: 删除 `"entities": REQUIRED — involved entity names with types...` 整段
2. `buildCursorPrompt` EN/ZH: 删除 `"entities": optional — involved entity names with types.`
3. `buildStmAndLtmPrompt`: 删除 JSON schema 示例中的 `"entities": [...]`
4. `buildStmOnlyPrompt`: 同上
5. Segment-based prompt: 同上

### 变更 3：移除 buildKnownEntityCatalog (stm-pipeline.js)

**文件**: `src/core/engine/stm-pipeline.js`

- 删除 `buildKnownEntityCatalog()` 函数 (L13-L51)
- 删除所有调用点（4 处 `+= buildKnownEntityCatalog(vault)` 和 `var knownEntityCatalog = buildKnownEntityCatalog(vault)`）

### 变更 4：移除 parseSTMResponse 中的 entity 规范化 (pipeline-shared.js)

**文件**: `src/core/engine/pipeline-shared.js`

```javascript
// 旧 (L168-L181)：
if (e.entities && Array.isArray(e.entities)) {
    e.entities = e.entities.map(...).filter(...);
} else if (e.entity && typeof e.entity === 'string') { ... }
else if (!e.entities) { e.entities = []; }

// 新：
// STM LLM 不再输出 entities，统一初始化为空数组
e.entities = [];
```

### 变更 5：简化 validateSTMOutput 中的 entity 验证 (validate.js)

**文件**: `src/core/engine/validate.js` L3-L27

```javascript
// 旧 (L16-L21)：防御性标准化
if (e.entities && Array.isArray(e.entities)) {
    e.entities = e.entities.map(function(en) {
        if (typeof en === 'string') return { name: en, type: 'character' };
        return en;
    });
}

// 新：
// entities 由 postFillSTM 确定性产出，验证阶段只确保它是数组
if (!Array.isArray(e.entities)) e.entities = [];
```

### 变更 6：移除 note_thread / 散列叙事线

| 文件 | 移除内容 |
|------|----------|
| `injection.js` | `noteThreadTool` 定义 (L294-L308)、`noteThreadExecutor` (L337-L344)、`noteThreadTool` 从 tools 数组中移除 |
| `retrieval-notebook.js` | `addDispersedThread()` 函数 (L117-L151) |
| `retrieval.js` | `D:` 前缀渲染 (L531)、Prompt 中 `{D:label#pos/total}` 说明 (L614)、EN `note_thread` 工具说明 (L622)、ZH 对应说明 (L629, L637) |

### 变更 7：简化 ambiguity.js 排序 (ambiguity.js)

**文件**: `src/core/engine/ambiguity.js` L210-L215

```javascript
// 旧：
var typeScoreA = a.type === 'character' ? 0 : 1;
var typeScoreB = b.type === 'character' ? 0 : 1;
if (typeScoreA !== typeScoreB) return typeScoreA - typeScoreB;

// 新：移除 type 排序，仅按 name 长度排序（保留后续逻辑）
```

同时更新 `collectKnownEntities` 中 entity 收集逻辑——不再读取 `type` 字段。

### 变更 8：下游适配 — entities 字符串数组读兼容

| 文件 | 位置 | 变更 |
|------|------|------|
| `retrieval.js:extractEntityNames` | L99 | 已有 `typeof en === 'string'` 处理，但默认 `type: 'character'` → 改为无 type |
| `retrieval.js:lookupEntityChains` | L25 | `en.name === name` → 改为 `(typeof en === 'string' ? en : en.name) === name`，向后兼容 |
| `retrieval.js:groupCandidatesByEntity` | L192 | 读取 `entities[0].name` → 改为 `typeof entities[0] === 'string' ? entities[0] : entities[0].name`，向后兼容 |

虽然用户说无需向后兼容（未发布），但加一个条件判断成本极低，防止测试数据中的旧格式引发异常。

### 变更 9：测试更新

| 文件 | 变更 |
|------|------|
| `test/entity-grouping.test.js` | entities 测试数据从 `[{name:'张三'}]` 改为 `['张三']` |
| `test/kb-annotations.test.js` | 测试数据中的 entity 引用更新为字符串格式 |
| `test/consolidate-core.test.js` | entities 测试数据更新为字符串数组 |
| `test/entity-seed.test.js` | **新增** — 测试 NE-BANNER seed + 文本匹配兜底逻辑 |
| `test/run.mjs` | 注册 `entity-seed` 测试 |

### 不修改的文件

| 文件 | 原因 |
|------|------|
| `src/core/engine/retrieval-filter.js` | 不涉及 entity type |
| `src/core/engine/bm25-grouper.js` | 不涉及 entity type |
| `src/core/vault/store.js` | Schema 无 entity type 约束 |
| `test-cases/retrieval/*` | 测试用例不直接测试 STM entity 标注 |

## 假设与决定

| # | 决定 | 理由 |
|---|------|------|
| 1 | 势力名仅通过文本匹配兜底（不依赖 LLM） | LLM 无法可靠判断宏观势力参与 |
| 2 | NE-BANNER chars → vault.content._active_characters | 与 story_time/story_scene 同路径 |
| 3 | STM LLM 完全不输出 entities | 确定性路径更可靠 |
| 4 | 移除 buildKnownEntityCatalog | 失去用途，节省 token |
| 5 | 移除散列叙事线 | 跨实体类型原始意图失效 |
| 6 | 不做向后数据迁移 | 实体链未发布正式版 |
| 7 | 下游读取做最小兼容 | 成本极低，避免测试数据异常 |

## 验证步骤

1. `npm test` — 全部单元测试 + ratchet 通过
2. `npm run build` — Rollup 构建成功，test-data.generated.js 重新生成
3. 手动验证 postFillSTM 逻辑：
   - NE-BANNER 在场角色正确转为 entities seed
   - 文本匹配兜底正确补标
   - 去重正确
4. 烟雾测试（需要 ST 运行时）：
   - STM 提取正常（无 entities 字段报错）
   - SmartPush 注入包含实体链分块
   - 无 note_thread / dispersed 相关报错
