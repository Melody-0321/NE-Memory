# Plan C — 自适应注入预算控制系统（双向调和阀）

## 摘要

当注入量偏离黄金注意力窗口时，系统自动调节——不足时主动扩充，超出时分级压缩。采用轮转摊薄策略：不从固定第一层开始压，而是每轮从"离安全水位最远"的层开始压缩/扩充，防止单层过压。

所有压缩决策由代码层完成，不引入额外 LLM 调用。

---

## 当前状态

### 注入源全景

[实际代码来源](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L881-L960)

`onBeforeGenerate` 中的注入顺序（depth 从低到高）：

```
runtime.injectPrompt('ne_state_block',     stateBlockInstr,    'in_chat', 0, 'system')
runtime.injectPrompt('ne_char_block',      charBlockInstr,     'in_chat', 0, 'system')
runtime.injectPrompt('ne_state_table',     stateTable,         'in_chat', 2, 'system')
runtime.injectPrompt('ne_memory_vault',    formatted,          'in_chat', 3, 'system')
```

| 注入源 | depth | 典型大小 | 有无上限 | 安全水位 |
|:---|---:|---:|:---:|:---|
| **ne_state_block** | 0 | ~300 字符 | — | **不可压缩**（固定指令模板） |
| **ne_char_block** | 0 | ~600 字符 | — | **不可压缩**（固定指令模板） |
| **ne_state_table** | 2 | 800-3000 字符 | ❌ `buildStateInjectionTable` 第二个参数 `maxItems` 传 `undefined` → 内部默认 `{ characters: Infinity, factions: Infinity, quests: Infinity }` | 活跃角色全字段：3-5 人 |
| **ne_memory_vault** | 3 | 1000-3500 字符 | ❌ 无 | 800-2000 字符 |
| `formatSmartContext()` 内部由 `parts` 数组 `join('\n\n')` 组装，各部分用 `\n---\n` 分隔： | | | | |
| ├─ `vault.memory_system_prompt` | 3 | 0-800 字符 | vault 字段 | **不可压缩**（用户/LLM 写入的 vault 级持久文本） |
| ├─ `buildEntityBlock()` 输出（包含 KB 标注段落） | 3 | 600-2000 字符 | — | 3-5 个实体块 |
| ├─ "场景外链"段落（`unreachedChains`） | 3 | 0-300 字符 | 始终包含（有未命中链时） | **不可压缩**（固定信息提示） |
| └─ `compileRetrievalBudget()` 输出 | 3 | 0-500 字符 | 由 `neSettings.retrievalBudgetEnabled` 控制开关 | 二态：展示/隐藏 |
| **注入总量** | | **3000-8000+ 字符** | ❌ 无集中控制 | |

**记忆注入前，`formatted` 字符串如果包含 `[KB:` 或 `## ` 标记，会拼接外层包装头**（`MEMORY_INJECTION_WRAPPER`，约 350 字符的 KB 认知边界使用说明）。

**关键背景（本轮对话结论）**：
- SmartPush 是唯一的注入路径（`onBeforeGenerate` 中只有一个 `formatSmartContext` 调用，失败时回退 `buildStateOnlyInjection`）。`formatContextMemory` 已删除
- `formatSmartContext()` 返回**单一字符串**（`parts.join('\n\n')`），不返回结构化对象。追踪子组件时需要在函数内部注入中间测量点
- `memory_system_prompt` 是 vault 级持久文本字段，由用户或 LLM 写入，不在 Plan C 的控制范围内
- "场景外链"段落由代码自动产生（`unreachedChains`），不受设置控制，始终存在
- DPP 多样性采样（MMR 实体块选择）是 Plan C 的上游——在 `groupCandidatesByEntity` 之后、`buildRetrievalMessages` 之前插入，将实体块数从 N 减至 3-5 个。**diversity 先过滤，Plan C 后压缩，两者互补**

**已有控制**：
- `computeContextPressure` 计算压力，但仅用于 pipeline 触发决策，未用于注入截断
- `retrievalBudgetEnabled` 用户设置开关，控制 `compileRetrievalBudget()` 是否参与注入

**缺失**：无注入总量感知，无按压力分级压缩，无黄金窗口导向的自动调节。

---

## 目标

在每次 `onBeforeGenerate` 中：
1. **追踪**所有注入源的 token 数（state_table + memory_vault 子组件）
2. **计算**总注入量与目标窗口的比例
3. **决策**：压缩 / 维持 / 扩充
4. **执行**：按轮转摊薄策略逐层调节

---

## 与 Diversity Gate 的交互

```
onBeforeGenerate()
    │
    ├─ stateTable → runtime.injectPrompt('ne_state_table', ...)
    │
    ├─ await formatSmartContext()
    │     ├─ BM25 → 可选RRF → 实体链 → mergePipelines
    │     ├─ groupCandidatesByEntity() → entity groups
    │     ├─ ←←← Diversity Gate (MMR) ←←←
    │     │   选出 3-5 个实体块，其余交由 availableChains 隐式发现
    │     ├─ buildRetrievalMessages → LLM KB 标注
    │     ├─ parseEntityAnnotations + buildEntityBlock
    │     └─ 返回 parts.join('\n\n') 单一字符串
    │
    ├─ 包装 MEMORY_INJECTION_WRAPPER（如有 KB 标记）
    ├─ runtime.injectPrompt('ne_memory_vault', formatted, ...)
    ├─ runtime.injectPrompt('ne_state_block', ...)
    ├─ runtime.injectPrompt('ne_char_block', ...)
    │
    └─ ←←← Plan C adaptInjectionBudget ←←←
         在完成所有注入后做二次压缩/扩充
```

**协同规则**：
- diversity gate 是「源端控制」——减少实体块数量
- Plan C 是「注入端控制」——在注入完成后按压力等级裁剪
- 如果 diversity gate 已生效（实体块≤5），Plan C 在低中压力等级下不碰 memoryVault，转向优先压缩 state_table
- 空闲压力下扩充时：Plan C 优先通知 diversity gate 恢复一个实体块

---

## 轮转摊薄策略

### 概念

不是固定顺序（"先压 A → 再压 B → 最后压 C"），而是每轮从**离安全水位最远的层**开始操作。

### 每层的安全水位

| 层 | 调节参数 | 安全区间 | 硬地板 | 硬天花板 |
|:---|:---|:---|:---:|:---:|
| **对话窗口** | 保留轮数 | 8-16 轮 | 6 轮 | 24 轮 |
| **ne_state_table** | 活跃角色全字段数 | 3-5 人 | 1 人 | — |
| **ne_state_table** | 非活跃角色展示 | 仅名字行 | 隐藏 | 全字段 |
| **ne_memory_vault entityBlock** | 实体块内 KB 等级段落 | 全部显示 | 仅直接知晓 | 全部显示 |
| **ne_memory_vault retrievalBudget** | 显示/隐藏 | 显示 | 隐藏 | 显示 |

**不可压缩（始终含在 `formatSmartContext` 输出中）**：
- `vault.memory_system_prompt`（0-800 字符，vault 级持久字段）
- "场景外链"段落（0-300 字符，代码自动注入，无开关）

**不可压缩（独立注入，不在 memoryVault 中）**：
- `ne_state_block`（~300 字符，固定指令模板）
- `ne_char_block`（~600 字符，固定指令模板）

### 压缩时

```
while (totalTokens > targetBudget && anyLayerAboveFloor):
    deviation = 每个层的 (当前值 - 安全区间上限) / (硬地板 - 安全区间上限)
    pick = deviation 最大的层（= 相对安全水位偏离最远）
    压缩 pick 层一档
    recalculate totalTokens
```

### 扩充时

```
while (totalTokens < targetBudget * 0.7 && anyLayerBelowCeiling):
    deviation = 每个层的 (安全区间下限 - 当前值) / (安全区间下限 - 硬天花板)
    pick = deviation 最大的层（= 最远离安全区间下限）
    扩充 pick 层一档
    recalculate totalTokens
```

### 为什么不用固定顺序

固定顺序的极端场景：`ne_state_table` 只有 2 个角色（恰好安全），但 `entityBlocks` 有大量 KB=间接 段落（超过安全上限）。按固定顺序先压 state_table → 误伤了安全的值，却没压到真正臃肿的 entityBlocks。

轮转摊薄：entityBlock KB 段落的 deviation 最大 → 先裁 kB=间接 → 压力消除后停止，state_table 完全没被碰。

---

## 目标预算计算

```
targetBudget = maxContext * 0.15  ~  0.25
```

对于 32K 模型：`targetBudget = 4800 ~ 8000 tokens`

**不是硬上限**——超出时触发压缩但不强制。硬上限场景（> 85% 压力）使用分级激进压缩。

---

## 分级压缩表

| 压力等级 | `computeContextPressure` | 动作 |
|:---|:---|:---|
| 空闲 (< 0.3) | 75%+ 可用 | 扩充——优先通知 diversity gate 恢复一个实体块；state_table 恢复非活跃角色全字段 |
| 正常 (0.3-0.55) | 45-70% 可用 | 维持——不操作 |
| 轻度压力 (0.55-0.7) | 30-45% 可用 | Stage 1——压缩非活跃 state_table（仅名字行）；entityBlock 内的 KB=未知 / KB=线索 段落省略 |
| 中度压力 (0.7-0.85) | 15-30% 可用 | Stage 2——压缩活跃 state_table 至 3 角色；entityBlock 内的 KB=间接 段落省略；隐藏 retrievalBudget |
| 高度压力 (0.85-0.95) | 5-15% 可用 | Stage 3——entityBlock 仅保留 KB=直接知晓 段落；state_table 仅活跃角色核心字段（3 字段）；对话窗口缩至 8 轮 |
| 临界 (> 0.95) | < 5% 可用 | Stage 4——仅指令层 + 对话，所有记忆注入移除 |

**entityBlock KB 等级裁剪顺序（按省略代价从低到高）**：
1. `[KB=未知]` 段落 → 省略（认知为空，标注本身无信息量）
2. `[KB=线索]` 段落 → 省略（只有间接关联）
3. `[KB=间接知晓]` 段落 → 省略（可通过转述知晓，损失较小）
4. 保留 `[KB=直接知晓]` 段落（角色在场、核心记忆）

**裁剪实现方式**：`buildEntityBlock()` 内部按 KB 等级分段组装。裁剪时修改传入的 `maxKBLevel` 参数，重新调用 `buildEntityBlock()` 生成裁剪版。

---

## 具体变更

### 变更 1：新增注入量追踪

**文件**: [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)

**变更**: 在每个 `injectPrompt` 调用之后，用 `countTokens()` 记录每个注入源的 token 数。

`formatSmartContext` 返回单一字符串，内部的子组件大小通过注入中间测量点获得。

```javascript
var injectionSizes = {
    stateBlock: 0,
    charBlock: 0,
    stateTable: 0,
    memoryVault: {
        wrapper: 0,           // MEMORY_INJECTION_WRAPPER（~350 字符）
        entityBlock: 0,       // buildEntityBlock() 输出
        budget: 0,            // compileRetrievalBudget() 输出
        unreachedChains: 0,   // "场景外链"段落
        systemPrompt: 0,      // vault.memory_system_prompt
        total: 0
    },
    total: 0
};
```

追踪点 1 — `formatSmartContext` 内部分段测量：

```javascript
// 在 injection.js 的 formatSmartContext() 中 (parts.join 之前):
// 注入中间测量结果到全局，供 events.js 读取
globalThis.__ne_debug_memory_vault_parts = {
    systemPrompt: parts.length > 0 && vault.memory_system_prompt ? countTokens(parts[0]) : 0,
    entityBlock: entityBlock ? countTokens(entityBlock) : 0,
    unreachedChains: unreachedChainsText ? countTokens(unreachedChainsText) : 0,
    budget: budgetText ? countTokens(budgetText) : 0
};
```

追踪点 2 — events.js 中各个 `injectPrompt` 调用后：

```javascript
// 在 ne_state_table 注入后 (L888):
injectionSizes.stateTable = countTokens(stateTable);
injectionSizes.total += injectionSizes.stateTable;

// 在 ne_memory_vault 注入后 (L916):
var mvParts = globalThis.__ne_debug_memory_vault_parts || {};
injectionSizes.memoryVault.wrapper = formatted.indexOf('[以下是') === 0 ? countTokens(MEMORY_INJECTION_WRAPPER) : 0;
injectionSizes.memoryVault.systemPrompt = mvParts.systemPrompt || 0;
injectionSizes.memoryVault.entityBlock = mvParts.entityBlock || 0;
injectionSizes.memoryVault.unreachedChains = mvParts.unreachedChains || 0;
injectionSizes.memoryVault.budget = mvParts.budget || 0;
injectionSizes.memoryVault.total = injectionSizes.memoryVault.wrapper +
    injectionSizes.memoryVault.systemPrompt +
    injectionSizes.memoryVault.entityBlock +
    injectionSizes.memoryVault.unreachedChains +
    injectionSizes.memoryVault.budget;
injectionSizes.total += injectionSizes.memoryVault.total;

// 在 ne_state_block / ne_char_block 注入后 (L938, L958):
injectionSizes.stateBlock = countTokens(stateBlockInstr);
injectionSizes.charBlock = countTokens(charBlockInstr);
injectionSizes.total += injectionSizes.stateBlock + injectionSizes.charBlock;
```

### 变更 2：新增 `adaptInjectionBudget` 函数

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**核心算法**：

```javascript
export function adaptInjectionBudget(injectionSizes, state, targetBudget) {
    var pressure = computeContextPressure(/* ... */);
    var totalTokens = injectionSizes.total;

    // 线性可调层
    var layers = [
        {
            name: 'stateTable',
            current: injectionSizes.stateTable,
            safe: { min: 400, max: 1500 },
            floor: 200,
            ceiling: 3000
        },
        {
            name: 'entityBlockKB',      // 仅 entityBlock 内的 KB 段落（不含系统提示词和场景外链）
            current: injectionSizes.memoryVault.entityBlock,
            safe: { min: 300, max: 1500 },
            floor: 100,
            ceiling: 2500
        }
    ];

    // 二态层 —— 存在/隐藏
    var budgetCost = injectionSizes.memoryVault.budget;  // 0 表示已隐藏
    var budgetVisible = budgetCost > 0;

    if (pressure > 0.55) {
        // Step 1: 先尝试隐藏 retrievalBudget（免伤其它层）
        if (budgetVisible && totalTokens > targetBudget) {
            totalTokens -= budgetCost;
            budgetVisible = false;
        }

        // Step 2: 轮转摊薄压缩线性层
        while (totalTokens > targetBudget && layers.some(function(d) { return d.current > d.floor; })) {
            var maxDev = null;
            var maxDeviation = -Infinity;
            layers.forEach(function(d) {
                if (d.current <= d.floor) return;
                var dev = (d.current - d.safe.max) / (d.safe.max - d.floor);
                if (dev > maxDeviation) {
                    maxDeviation = dev;
                    maxDev = d;
                }
            });
            if (!maxDev) break;
            // 压缩一档：stateTable → 减 25% 字符；entityBlock → 提 KB 等级裁剪参数
            var reduction = Math.ceil(maxDev.current * 0.25);
            maxDev.current -= reduction;
            totalTokens -= reduction;
        }
    } else if (pressure < 0.3 && totalTokens < targetBudget * 0.7) {
        // 扩充——优先通知 diversity gate 恢复一个实体块
        // 其次恢复 state_table 非活跃角色
        // 最后恢复 retrievalBudget
    }

    return {
        stateTableCompressionRatio: injectionSizes.stateTable > 0 ? (layers[0].current / injectionSizes.stateTable) : 1,
        entityBlockKBLevel: /* 当前 KB 保留等级 */,
        budgetHidden: !budgetVisible
    };
}
```

### 变更 3：各层的压缩/扩充操作

| 层 | 压缩一档 | 扩充一档 |
|:---|:---|:---|
| **stateTable** | 非活跃角色从全字段 → 仅名字行 → 隐藏。活跃角色字段数 -25%。 | 恢复一个非活跃角色的字段。扩展活跃角色字段。 |
| **entityBlock (KB 段落)** | 按 KB 等级裁剪参数提一档：`全部→仅直接+间接` → `仅直接+间接→仅直接+间接+部分线索` ...（实际用参数 `maxKBLevel` 控制）。 | 降一档 KB 等级裁剪参数。 |
| **retrievalBudget** | **二态**：显示 → 隐藏。 | 恢复（需缓存原预算文本）。 |
| **entityBlock 数量** | 通知 diversity gate 减少预算。 | 通知 diversity gate 增加预算（压缩时先裁 KB 等级，最后才动数量）。 |
| **对话窗口** | 保留轮数 -2 轮。 | 保留轮数 +2 轮。 |

### 变更 4：`buildEntityBlock` 支持 KB 等级裁剪参数

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**变更**: `buildEntityBlock` 增加第四个参数 `maxKBLevel`，控制 KB 段落保留等级。

```javascript
function buildEntityBlock(entityGrouped, entityAnnotations, activeChars, entityChains, maxKBLevel) {
    maxKBLevel = maxKBLevel || 4; // 4=全部, 3=不包含未知, 2=仅直接+间接, 1=仅直接

    var KB_LEVELS = [
        { key: 'unknown',       label: '未知',       minLevel: 1 },
        { key: 'clue',          label: '线索',       minLevel: 2 },
        { key: 'indirect',      label: '间接知晓',   minLevel: 3 },
        { key: 'direct',        label: '直接知晓',   minLevel: 4 }
    ];

    // 生成 KB 段落时检查 maxKBLevel，跳过 minLevel > maxKBLevel 的段落
}
```

当 `adaptInjectionBudget` 决定压缩 entityBlock 时，用新的 `maxKBLevel` 参数重新调用 `buildEntityBlock`，替换 `formatted` 中的对应部分。

### 变更 5：接入 onBeforeGenerate

**文件**: [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)

**变更**: 在所有 `injectPrompt` 调用之后，调用 `adaptInjectionBudget`。如果决定压缩，重新构建对应注入源并重新 `injectPrompt`（覆盖前一次）。

```javascript
// 在最后一个 injectPrompt 之后 (L958 附近):
var targetBudget = estimateTargetBudget(/* maxContext */);
var compressionResult = adaptInjectionBudget(injectionSizes, vault.content.state, targetBudget);

// 如果 stateTable 被压缩，重新 injectPrompt
if (compressionResult.stateTableCompressionRatio < 1) {
    var newStateTable = buildStateInjectionTable(state, chatMessages, {
        characters: 3,
        factions: 2,
        quests: 2
    }, vault.content);
    runtime.injectPrompt('ne_state_table', newStateTable, 'in_chat', 2, 'system');
}

// 如果 entityBlock KB 等级被裁剪
if (compressionResult.entityBlockKBLevel < 4) {
    // 需要从 formatSmartContext 内部重新获取关键状态并重新组装
    var entityGrouped = globalThis.__ne_debug_last_entity_grouped;
    var entityChains = globalThis.__ne_debug_last_entity_chains;
    var activeChars = getActiveCharacters(vault.content.state);
    if (entityGrouped) {
        var croppedEntityBlock = buildEntityBlock(entityGrouped, {}, activeChars, entityChains, compressionResult.entityBlockKBLevel);
        var newFormatted = replaceEntityBlock(formatted, croppedEntityBlock);
        runtime.injectPrompt('ne_memory_vault', newFormatted, 'in_chat', 3, 'system');
    }
}

// 如果 retrievalBudget 被隐藏，重新组装 ne_memory_vault
if (compressionResult.budgetHidden && formatted.includes(budgetText)) {
    var newFormatted = formatted.replace(/(?:\n---\n)*.*?compileRetrievalBudget.*?(?:\n---\n|$)/, '');
    runtime.injectPrompt('ne_memory_vault', newFormatted, 'in_chat', 3, 'system');
}
```

### 变更 6：maxItems 参数化

**文件**: [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js)

**变更**: `buildStateInjectionTable` 当前由 events.js 传入 `undefined` 作为 `maxItems`（L885），内部默认 `{ characters: Infinity, factions: Infinity, quests: Infinity }`。改为接收压缩策略传入的实际值。

```javascript
// events.js L885 原：
var stateTable = buildStateInjectionTable(state, chatMessages, undefined, content);

// 改为：
var stateMaxItems = { characters: 5, factions: 2, quests: 3 };
var stateTable = buildStateInjectionTable(state, chatMessages, stateMaxItems, content);
// 压缩时传递更小的值
```

---

## 文件变更清单

| 文件 | 变更 | 影响 |
|------|------|------|
| `events.js` | 新增注入量追踪（L881-L958 各注入点后）+ `adaptInjectionBudget` 调用 + 重新注入逻辑 | 🔴 核心 |
| `injection.js` | 新增 `adaptInjectionBudget` 函数 + `buildEntityBlock` 增加 `maxKBLevel` 参数 + `formatSmartContext` 注入中间测量点 | 🔴 核心 |
| `schema.js` | `buildStateInjectionTable` 调用处 `maxItems` 从 `undefined` 改为实际对象（events.js L885） | 🟡 连锁 |

**不修改**：
- `stm-pipeline.js` / `state-pipeline.js` / `ltm-pipeline.js` — 管线逻辑不变
- `llm.js` — LLM 调用逻辑不变
- `retrieval-filter.js` / `retrieval-fusion.js` / `retrieval.js` — 检索逻辑不变
- `context-window.js` — 仅用于可见窗口边界计算（`computeWindowStartMsgId`），不参与注入，不动
- `buildMemoryUsageGuide` — 固定模板文件，不动（位于 `MEMORY_INJECTION_WRAPPER` 中，不单独追踪）

---

## 假设与决策

1. **所有压缩由代码层执行**：不引入额外 LLM 调用。State 压缩不涉及 State LLM。
2. **轮转摊薄替代固定顺序**：防止单层过压，各层公平分担压力。
3. **扩充时有选择性**：只在 `pressure < 0.3` 且总注入量低于目标 70% 时扩充。不盲目填满所有空隙。
4. **重新注入可能有性能影响**：压缩后需要重新 `injectPrompt` 一次。injectPrompt 本身是轻量操作（向数组 push 一条），开销极小。
5. **Diversity Gate 优先于 Plan C 执行**——entity block 数量由 diversity gate 先控，Plan C 只在 block 内做 KB 等级裁剪。两者是源端控制 + 注入端控制的互补关系。
6. **`formatSmartContext` 返回单一字符串**，子组件追踪通过函数内 `globalThis.__ne_debug_memory_vault_parts` 中间测量来实现，不改变 `formatSmartContext` 的返回值签名。
7. **`memory_system_prompt` 和"场景外链"不可压缩**，它们不属于 Plan C 的调节范围。
8. **`ne_state_block` 和 `ne_char_block` 为固定指令模板**，不参与压缩/扩充。
9. **追踪粒度先用字符数（`countTokens`）**：已可在 `events.js` 和 `injection.js` 中使用（已导入 `from '../core/engine/text-utils.js'`）。
10. **`injectPrompt` 实际签名为 `(name, content, mode, depth, role)`**，当前代码全部使用 `'in_chat'` mode、`'system'` role。重新注入时保持一致。

---

## 验证方案

### 单元测试

新增 `test/injection-budget.test.js`：
- `adaptInjectionBudget` 在低压时优先通知 diversity gate 扩充实体块
- `adaptInjectionBudget` 在高压时先隐藏 retrievalBudget，再轮转摊薄线性层
- `buildEntityBlock` 的 `maxKBLevel` 参数正确裁切 KB 段落
- `adaptInjectionBudget` 在空闲时恢复 retrievalBudget
- 多轮压缩/扩充循环验证轮转摊薄——无单层触底
- 硬地板不可突破：对话 6 轮、entityBlock KB 等级不低于 `direct`、`state_table` 至少 1 个活跃角色

### 集成测试

```bash
npm run test:unit
npm run test:ratchet
```

### 手动验证

```javascript
// 浏览器控制台
// 1. 设置 contextWindowRounds = 6, 加载长对话
// 2. 检查 __ne_debug_injection_sizes —— 各注入源大小（含子组件）
// 3. 检查 __ne_debug_compression_log —— 哪层被压缩/扩充了几档
```

---

## 实施顺序

1. 新增注入量追踪（变更 1，events.js + injection.js 中间测量点）
2. 新增 `adaptInjectionBudget` 函数（变更 2，injection.js）
3. `buildEntityBlock` 增加 `maxKBLevel` 参数（变更 4，injection.js）
4. 接入 onBeforeGenerate 并实现重新注入逻辑（变更 5，events.js）
5. maxItems 参数化（变更 6，events.js L885 + schema.js）
6. 单元测试 + 集成测试
