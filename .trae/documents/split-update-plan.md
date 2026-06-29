# update.js 拆分方案（精确版）

> 1751 行 → 4 个文件 + 1 个 barrel，函数级 import 精确匹配

---

## 当前状态

`src/core/engine/update.js`（1751 行）已备份为 `update.js.bak`。磁盘上存在 4 个 pipeline 文件但 import 有大量错误（缺少依赖导入、导入多余符号），需要废弃重做。

外部消费者（拆分后不能变）：
- `events.js`：`import { executeIncrementalUpdate, extractStateChangesOnly, runLtmDecision, saveVaultWithSnapshot }`
- `panel.js`：`import { executeIncrementalUpdate }`

Barrel 策略：**最小导出**——只导出 events.js + panel.js 实际使用的 4 个函数。

---

## 目标文件结构

```
engine/
├── update.js              ← barrel（4 行 re-export）
├── pipeline-shared.js     ← 7 个函数，5 个 import
├── stm-pipeline.js        ← 11 个函数，11 个 import
├── ltm-pipeline.js        ← 2 个函数 + 1 个辅助函数 + 1 个正则常量，4 个 import
└── state-pipeline.js      ← 16 个函数，6 个 import
```

**关键调整（与旧计划不同）**：`_validateLtmEventText` + `EVENT_CLOSING_PUNCT` 移到 `ltm-pipeline.js`（仅被该文件使用，旧计划放 pipeline-shared.js 是错误的）。

---

## 详细文件规格

### 1. `pipeline-shared.js`

**函数**（从 update.js.bak 行号引用）：
| 函数 | 来源行 | 用途 |
|------|:---:|------|
| `saveVaultWithSnapshot` | L22-L40 | Vault 持久化 + 快照裁剪（**被 events.js 直接引用**） |
| `ensureStateStructure` | L62-L96 | State 结构初始化（**被 state-pipeline 引用**） |
| `initStateFromSchema` | L100-L136 | Schema→State 字段创建 |
| `filterNewMessages` | L138-L144 | 消息去重过滤（**被 stm-pipeline 引用**） |
| `flattenNestedChanges` | L259-L281 | 嵌套 state_changes 扁平化 |

（注意：L141 使用 `const`，需保留）

| `parseSTMResponse` | L283-L335 | LLM 响应解析（**被 stm-pipeline + state-pipeline 引用**） |
| `handleQuestCompletion` | L337-L354 | 任务完成检测（**被 state-pipeline 引用**） |

**精确 import**（每个符号均被上述函数实际使用）：
```js
import { writeWithSnapshot } from '../vault/store.js';              // saveVaultWithSnapshot
import { pruneSnapshotsForChat } from '../vault/versions.js';       // saveVaultWithSnapshot
import { persistVaultToChatFile } from '../auto-restore.js';        // saveVaultWithSnapshot
import { isStateSchemaEnabled, DEFAULT_GLOBAL_SCHEMA } from '../vault/schema.js';  // ensureStateStructure + parseSTMResponse
import { safeJsonParse } from './json-fallback.js';                 // parseSTMResponse
```

共 5 个 import，无多余导入。

---

### 2. `stm-pipeline.js`

**函数**：

| 函数 | 来源行 | 可见性 |
|------|:---:|:---:|
| `buildSTMUpdatePrompt` | L146-L257 | 内部 |
| `buildCursorPrompt` | L358-L461 | 内部 |
| `buildRetrospectiveContext` | L463-L483 | 内部 |
| `buildBatchPrompt` | L486-L561 | 内部（含 LTM 上下文注入逻辑，使用 consolidate 函数） |
| `buildStmOnlyPrompt` | L564-L593 | 内部 |
| `computeTurnBoundarySignals` | L595-L631 | 内部 |
| `classifyBoundary` | L633-L645 | 内部 |
| `askBoundaryJudge` | L647-L683 | 内部 |
| `segmentTurns` | L685-L712 | 内部 |
| `buildStmSummaryPrompt` | L714-L741 | 内部 |
| `executeIncrementalUpdate` | L1161-L1287 | **export** |

**精确 import**（每个符号均被上述函数实际使用）：
```js
import { read, appendSTMEntries, collectAllMsgIds } from '../vault/store.js';
// executeIncrementalUpdate: read, appendSTMEntries, collectAllMsgIds

import { isStateSchemaEnabled } from '../vault/schema.js';
// buildSTMUpdatePrompt: isStateSchemaEnabled

import { safeJsonParse } from './json-fallback.js';
// executeIncrementalUpdate: safeJsonParse

import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
// askBoundaryJudge: callMemoryPipeline
// executeIncrementalUpdate: callMemoryPipeline, recordTelemetry

import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';
// askBoundaryJudge: formatTurnsText
// buildStmSummaryPrompt: formatTurnsText
// executeIncrementalUpdate: groupMessagesIntoTurns, collectMsgIdsFromTurns

import { isLtmEnabled, findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';
// buildBatchPrompt: isLtmEnabled, findOpenLtm, formatLtmCatalog, computeClosureSignals

import { saveVaultWithSnapshot, filterNewMessages } from './pipeline-shared.js';
// executeIncrementalUpdate: saveVaultWithSnapshot, filterNewMessages

import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
// buildSTMUpdatePrompt: preGroupItems, formatPreGroupHint
// buildCursorPrompt: preGroupItems, formatPreGroupHint

import { validateSTMOutput, postFillSTM } from './validate.js';
// executeIncrementalUpdate: validateSTMOutput, postFillSTM

import { transitionTo } from './pipeline-guard.js';
// executeIncrementalUpdate: transitionTo

import { vocabularyOverlap } from './text-utils.js';
// computeTurnBoundarySignals: vocabularyOverlap
```

共 11 个 import，每个符号都精确追踪到使用函数。

---

### 3. `ltm-pipeline.js`

**函数 + 常量**：

| 名称 | 来源行 | 可见性 |
|------|:---:|:---:|
| `EVENT_CLOSING_PUNCT` | L42 | 内部常量 |
| `_validateLtmEventText` | L44-L54 | 内部 |
| `buildLtmDecisionPrompt` | L743-L811 | 内部 |
| `runLtmDecision` | L813-L852 | **export** |

**精确 import**：
```js
import { findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';
// buildLtmDecisionPrompt: findOpenLtm, formatLtmCatalog, computeClosureSignals

import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
// runLtmDecision: callMemoryPipeline, recordTelemetry

import { safeJsonParse } from './json-fallback.js';
// runLtmDecision: safeJsonParse

import { validateLTMOutput } from './validate.js';
// runLtmDecision: validateLTMOutput
```

共 4 个 import。`_validateLtmEventText` 和 `EVENT_CLOSING_PUNCT` 定义在本文件内。

---

### 4. `state-pipeline.js`

**函数**：

| 函数 | 来源行 | 可见性 |
|------|:---:|:---:|
| `buildCharacterCardSection` | L856-L879 | 内部 |
| `findNewCharacterNames` | L881-L906 | 内部 |
| `_matchEntryKeyToName` | L908-L921 | 内部 |
| `_fetchWorldBookText` | L923-L955 | 内部 |
| `buildWorldBookSection` | L957-L968 | 内部 |
| `buildFactionKeywords` | L970-L981 | 内部 |
| `scanMessageForFactions` | L983-L1002 | 内部 |
| `buildStatePrompt_Preset` | L1004-L1122 | 内部 |
| `autoDecayStaleCharacters` | L1128-L1159 | 内部 |
| `collectWorldBookContent` | L1291-L1354 | 内部 |
| `collectWorldBookContent_raw` | L1356-L1375 | 内部 |
| `buildWorldBookSystemBlock` | L1377-L1383 | 内部 |
| `buildSchemeCharPrompt` | L1385-L1419 | 内部 |
| `buildFactionExtractionPrompt` | L1421-L1440 | 内部 |
| `resolveNpcSchemes` | L1442-L1609 | **export** |
| `extractStateChangesOnly` | L1613-L1751 | **export** |

**精确 import**：
```js
import { read } from '../vault/store.js';
// extractStateChangesOnly: read

import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled, ensureCharacterTemplate, rebuildPresentCharacters, buildStateInjectionTable, DEFAULT_NPC_SCHEME } from '../vault/schema.js';
// autoDecayStaleCharacters: rebuildPresentCharacters
// buildStatePrompt_Preset: buildStateInjectionTable
// extractStateChangesOnly: validateStateChanges, mergeStateChanges, isStateSchemaEnabled
// resolveNpcSchemes: ensureCharacterTemplate, DEFAULT_NPC_SCHEME

import { saveVaultWithSnapshot, ensureStateStructure, parseSTMResponse, handleQuestCompletion } from './pipeline-shared.js';
// extractStateChangesOnly: saveVaultWithSnapshot, ensureStateStructure, parseSTMResponse, handleQuestCompletion
// resolveNpcSchemes: (无 — 不直接使用 pipeline-shared)

import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
// resolveNpcSchemes: callMemoryPipeline
// extractStateChangesOnly: callMemoryPipeline, recordTelemetry

import { safeJsonParse } from './json-fallback.js';
// resolveNpcSchemes: safeJsonParse

import { runtime } from '../runtime.js';
// buildCharacterCardSection: runtime.getCharacters()
// collectWorldBookContent: runtime.maxContext
```

共 6 个 import，每个符号都精确追踪。

---

### 5. `update.js`（barrel）

```js
export { saveVaultWithSnapshot } from './pipeline-shared.js';
export { executeIncrementalUpdate } from './stm-pipeline.js';
export { runLtmDecision } from './ltm-pipeline.js';
export { extractStateChangesOnly } from './state-pipeline.js';
```

仅导出 events.js + panel.js 实际使用的 4 个函数。外部 import 零变更。

---

## 依赖关系图（无循环）

```
          pipeline-shared.js
          (store, versions, auto-restore, schema, json-fallback)
           /                    \
          /                      \
   stm-pipeline.js         state-pipeline.js
   (store, schema, json,    (store, schema, llm,
    llm, turn-seg,              json, runtime)
    consolidate, bm25,
    validate, pipeline-guard,
    text-utils)

   ltm-pipeline.js
   (consolidate, llm, json, validate)
   — 不依赖 pipeline-shared.js
```

三个 pipeline 文件之间 mutual import 为零，无循环依赖。

---

## 实施步骤

### Step 0：清理旧文件

删除磁盘上旧的拆分产物：
```
del src\core\engine\pipeline-shared.js
del src\core\engine\stm-pipeline.js
del src\core\engine\ltm-pipeline.js
del src\core\engine\state-pipeline.js
```

### Step 1：创建 `pipeline-shared.js`

从 `update.js.bak` 复制以下函数（保持顺序，先 import 后代码）：
1. L22-L40：`saveVaultWithSnapshot`
2. L62-L96：`ensureStateStructure`
3. L100-L136：`initStateFromSchema`
4. L138-L144：`filterNewMessages`
5. L259-L281：`flattenNestedChanges`
6. L283-L335：`parseSTMResponse`
7. L337-L354：`handleQuestCompletion`

使用上文「精确 import」列表。不包含任何注释（保持代码简洁）。

### Step 2：创建 `stm-pipeline.js`

从 `update.js.bak` 复制：
1. L146-L257：`buildSTMUpdatePrompt`
2. L358-L461：`buildCursorPrompt`
3. L463-L483：`buildRetrospectiveContext`
4. L486-L561：`buildBatchPrompt`
5. L564-L593：`buildStmOnlyPrompt`
6. L595-L631：`computeTurnBoundarySignals`
7. L633-L645：`classifyBoundary`（含 `L1_CUT`/`L2_CUT`/`L2_KEEP`/`L3_ASK` 常量）
8. L647-L683：`askBoundaryJudge`
9. L685-L712：`segmentTurns`
10. L714-L741：`buildStmSummaryPrompt`
11. L1161-L1287：`executeIncrementalUpdate`

`L1_CUT`/`L2_CUT`/`L2_KEEP`/`L3_ASK` 在 `classifyBoundary` 之前定义（L633-L636 原始顺序）。

使用上文「精确 import」列表。

### Step 3：创建 `ltm-pipeline.js`

从 `update.js.bak` 复制：
1. L42：`EVENT_CLOSING_PUNCT` 正则常量
2. L44-L54：`_validateLtmEventText`
3. L743-L811：`buildLtmDecisionPrompt`
4. L813-L852：`runLtmDecision`

使用上文「精确 import」列表。

### Step 4：创建 `state-pipeline.js`

从 `update.js.bak` 复制（按出现顺序）：
1. L856-L879：`buildCharacterCardSection`
2. L881-L906：`findNewCharacterNames`
3. L908-L921：`_matchEntryKeyToName`
4. L923-L955：`_fetchWorldBookText`
5. L957-L968：`buildWorldBookSection`
6. L970-L981：`buildFactionKeywords`
7. L983-L1002：`scanMessageForFactions`
8. L1004-L1122：`buildStatePrompt_Preset`
9. L1128-L1159：`autoDecayStaleCharacters`
10. L1291-L1354：`collectWorldBookContent`
11. L1356-L1375：`collectWorldBookContent_raw`
12. L1377-L1383：`buildWorldBookSystemBlock`
13. L1385-L1419：`buildSchemeCharPrompt`
14. L1421-L1440：`buildFactionExtractionPrompt`
15. L1442-L1609：`resolveNpcSchemes`
16. L1613-L1751：`extractStateChangesOnly`

使用上文「精确 import」列表。

### Step 5：用 barrel 替换 `update.js`

将 `update.js` 替换为 4 行 re-export（见上文）。

### Step 6：验证

1. `npm run build` — 必须 exit 0，无警告
2. `npm test` — 22 个单元测试 + 3 个 ratchet 全部通过
3. 手动确认 `dist/index.js` 中 `executeIncrementalUpdate`、`extractStateChangesOnly`、`runLtmDecision`、`saveVaultWithSnapshot` 四个函数均存在

### Step 7：清理

- 删除 `scripts/extract-functions.cjs`（被本精确方案取代）
- 删除 `scripts/split-update.cjs`（更早的手动方案）
- 保留 `update.js.bak` 作为回滚保险（后续手动删除）

---

## 拒绝的错误设计

| 错误 | 说明 |
|------|------|
| ~~`_validateLtmEventText` 放 pipeline-shared.js~~ | 它只被 `runLtmDecision` 使用，放 ltm-pipeline.js 更合理 |
| ~~pipeline-shared.js 导入 `rebootGarbageCollector` 等~~ | 这些符号与 shared 函数完全无关 |
| ~~stm-pipeline.js 导入 `ensureCharacterTemplate`、`validateStateChanges` 等~~ | stm-pipeline 不使用任何 schema 状态管理函数 |
| ~~barrel 导出大量未使用函数~~ | 用户选择最小导出策略，仅导出 4 个实际使用函数 |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `persistVaultToChatFile` 在 `auto-restore.js` | 确认磁盘路径 `../auto-restore.js` 存在（已通过 Phase 1 验证） |
| Rollup commonjs 插件误解析 ESM 文件 | 已配置 `commonjs({ include: 'node_modules/**' })` |
| `runtime` 模块导入（依赖 SillyTavern 全局） | 它与原 update.js 的导入方式完全一致，不引入新风险 |
