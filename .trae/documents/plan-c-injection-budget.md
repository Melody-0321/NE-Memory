# Plan C — 自适应注入预算控制系统（双向调和阀）

## 摘要

当注入量偏离黄金注意力窗口时，系统自动调节——不足时主动扩充，超出时分级压缩。采用轮转摊薄策略：不从固定第一层开始压，而是每轮从"离安全水位最远"的层开始压缩/扩充，防止单层过压。

所有压缩决策由代码层完成，不引入额外 LLM 调用。

---

## 当前状态

注入源全景：

| 注入源 | depth | 典型大小 | 有无上限 | 安全水位 |
|:---|---:|---:|:---:|:---|
| ne_state_block | 0 | ~300 字符 | — | 不可压缩 |
| ne_char_block | 0 | ~600 字符 | — | 不可压缩 |
| ne_state_table | 2 | 800-3000 字符 | ❌ `maxItems=Infinity` | 活跃角色全字段：3-5 人 |
| ne_context_memory | 2 | 500-3000 字符 | STM 20 条上限，LTM 无上限 | LTM 5-15 条，STM 10-20 条 |
| ne_memory_vault | 3 | 1000-3000 字符 | ❌ 无 | 800-2000 字符 |
| **总计** | | **3500-10000+ 字符** | ❌ 无集中控制 | |

**已有控制**：
- `computeContextPressure` 计算压力，但仅用于 pipeline 触发决策，未用于注入截断
- `contextWindowRounds` 控制 contextMemory 的窗口边界，不控制对话历史（那是 Plan B 的事）
- `compileRetrievalBudget` 默认 300 tokens，仅用作信息性标注

**缺失**：无注入总量感知，无按压力分级压缩，无黄金窗口导向的自动调节。

---

## 目标

在每次 `onBeforeGenerate` 中：
1. **追踪**所有注入源的实际 token 数
2. **计算**总注入量与目标窗口的比例
3. **决策**：压缩 / 维持 / 扩充
4. **执行**：按轮转摊薄策略逐层调节

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
| **ne_contextMemory LTM** | 条目数 | 5-15 条 | 2 条 | 25 条 |
| **ne_contextMemory STM** | 条目数 | 10-20 条 | 5 条 | 20 条（已上限） |
| **ne_memory_vault** | 注入字符数 | 800-2000 | 400 | 3000 |

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

固定顺序的极端场景：`contextMemory LTM` 只有 6 条（恰好安全），但 `ne_state_table` 有 8 个角色全字段（超过安全上限）。按固定顺序先压 contextMemory → 误伤了安全的值，却没压到真正臃肿的 state_table。

轮转摊薄：state_table 的 deviation 最大 → 先压 state_table → 压力消除后停止，contextMemory 完全没被碰。

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
| 空闲 (< 0.3) | 75%+ 可用 | 扩充——扩大窗口、增加 LTM 展示 |
| 正常 (0.3-0.55) | 45-70% 可用 | 维持——不操作 |
| 轻度压力 (0.55-0.7) | 30-45% 可用 | Stage 1——仅压非活跃 state_table + 低 KB SmartPush |
| 中度压力 (0.7-0.85) | 15-30% 可用 | Stage 2——压 state_table 活跃 + contextMemory LTM + SmartPush KB=线索 |
| 高度压力 (0.85-0.95) | 5-15% 可用 | Stage 3——仅保留直接知晓 KB + 活跃角色核心字段 |
| 临界 (> 0.95) | < 5% 可用 | Stage 4——仅指令层 + 对话，所有记忆注入移除 |

---

## 具体变更

### 变更 1：新增注入量追踪

**文件**: [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)

**变更**: 在每个 `injectPrompt` 调用前后，用 `countTokens()` 记录每个注入源的 token 数：

```javascript
var injectionSizes = {
    stateBlock: 0,      // ne_state_block
    charBlock: 0,       // ne_char_block
    stateTable: 0,      // ne_state_table
    contextMemory: 0,   // ne_context_memory
    memoryVault: 0,     // ne_memory_vault
    contradictionFix: 0,// ne_contradiction_fix（条件触发）
    total: 0
};

// each injection point:
var before = injectionSizes.stateTable;
stateTable = buildStateInjectionTable(state, chatMessages, maxItems, content);
injectionSizes.stateTable = countTokens(stateTable);
injectionSizes.total += injectionSizes.stateTable - before;
```

### 变更 2：新增 `adaptInjectionBudget` 函数

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**核心算法**：

```javascript
function adaptInjectionBudget(injectionSizes, state, targetBudget) {
    var pressure = computeContextPressure(/* ... */);
    var totalTokens = injectionSizes.total;
    
    // 各层当前值与安全区间的偏离度
    var deviations = [
        {
            name: 'stateTable',
            current: injectionSizes.stateTable,
            safe: { min: 400, max: 1500 },
            floor: 200,
            ceiling: 3000
        },
        {
            name: 'contextMemory',
            current: injectionSizes.contextMemory,
            safe: { min: 300, max: 1200 },
            floor: 150,
            ceiling: 2500
        },
        {
            name: 'memoryVault',
            current: injectionSizes.memoryVault,
            safe: { min: 300, max: 1500 }, // Plan A 重构后 maxTokens=1024
            floor: 150,
            ceiling: 2500
        }
    ];
    
    if (pressure > 0.55) {
        // 压缩
        while (totalTokens > targetBudget && deviations.some(function(d) { return d.current > d.floor; })) {
            // 找偏离度最大的层
            var maxDev = null;
            var maxDeviation = -Infinity;
            deviations.forEach(function(d) {
                if (d.current <= d.floor) return;
                var dev = (d.current - d.safe.max) / (d.safe.max - d.floor);
                if (dev > maxDeviation) {
                    maxDeviation = dev;
                    maxDev = d;
                }
            });
            if (!maxDev) break;
            // 压缩一档（~25%）
            var reduction = Math.ceil(maxDev.current * 0.25);
            // ... 应用压缩到对应注入源
            totalTokens -= reduction;
        }
    } else if (pressure < 0.3 && totalTokens < targetBudget * 0.7) {
        // 扩充：找偏离度最小（最远离安全下限）的层
        // ... 镜像逻辑
    }
}
```

### 变更 3：各层的压缩/扩充操作

| 层 | 压缩一档 | 扩充一档 |
|:---|:---|:---|
| **stateTable** | 非活跃角色从全字段 → 仅名字行 → 隐藏。活跃角色字段数 -25%。 | 恢复一个非活跃角色的字段。扩展活跃角色字段。 |
| **contextMemory** | LTM 条目数 -25%，STM 条目数 -25%。 | LTM +25%，STM +25%（不超 20 上限）。 |
| **memoryVault** | 按 KB 等级裁剪：[KB=线索] 段 → 省略 → [KB=间接] 段 → 省略。 | 恢复一级 KB 段的展示。 |
| **对话窗口** | 保留轮数 -2 轮。 | 保留轮数 +2 轮。 |

### 变更 4：接入 onBeforeGenerate

**文件**: [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)

**变更**: 在所有 `injectPrompt` 调用**之后**（即所有注入已确定大小），调用 `adaptInjectionBudget`。如果决定压缩，重新构建对应注入源并重新 `injectPrompt`（覆盖前一次注入）。

```javascript
// 在所有 injectPrompt 之后：
adaptInjectionBudget(injectionSizes, state, targetBudget);

// 如果 stateTable 被压缩，重新 injectPrompt
if (stateTableRecompressed) {
    runtime.injectPrompt('ne_state_table', newStateTable, 2);
}

// 如果 memoryVault 被压缩，重新拼装 parts
if (memoryVaultRecompressed) {
    memoryParts = reassembleParts(/* 压缩后的 parts */);
    runtime.injectPrompt('ne_memory_vault', memoryParts.join('\n\n'), 3);
}
```

### 变更 5：maxItems 参数化

**文件**: [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js)

**变更**: `buildStateInjectionTable` 当前 `maxItems` 参数为 `undefined`（→ Infinity）。改为接收压缩策略传入的实际值：

```javascript
var stateMaxItems = {
    characters: 5,    // 默认最多展示 5 个角色全字段
    factions: 2,
    quests: 3
};
// 压缩时降低这些值
```

---

## 文件变更清单

| 文件 | 变更 | 影响 |
|------|------|------|
| `events.js` | 新增注入量追踪 + `adaptInjectionBudget` 调用 + 重新注入逻辑 | 🔴 核心 |
| `injection.js` | 新增 `adaptInjectionBudget` 函数 | 🔴 核心 |
| `schema.js` | `buildStateInjectionTable` maxItems 参数化 | 🟡 连锁 |
| `context-window.js` | LTM/STM 数量按压缩策略动态调整 | 🟡 连锁 |

**不修改**：
- `stm-pipeline.js` / `state-pipeline.js` / `ltm-pipeline.js` — 管线逻辑不变
- `retrieval.js` — 检索逻辑不变（Plan A 重构后的新版本）
- `llm.js` — LLM 调用逻辑不变

---

## 假设与决策

1. **所有压缩由代码层执行**：不引入额外 LLM 调用。State 压缩不涉及 State LLM。
2. **轮转摊薄替代固定顺序**：防止单层过压，各层公平分担压力。
3. **扩充时有选择性**：只在 `pressure < 0.3` 且总注入量低于目标 70% 时扩充。不盲目填满所有空隙。
4. **重新注入可能有性能影响**：压缩后需要重新 `injectPrompt` 一次。injectPrompt 本身是轻量操作（向数组 push 一条），开销极小。
5. **与 Plan A/B 的解耦**：Plan C 的 memoryVault 压缩面向 Plan A 重构后的新格式（实体块）。如果 Plan A 未实施，memoryVault 压缩路径使用旧格式的 KB 分段裁剪。
6. **追踪粒度先用字符数（`countTokens`）**：已经可用。后续可考虑直接用 `gpt-tokenizer` token 精确计数。

---

## 验证方案

### 单元测试

新增 `test/injection-budget.test.js`：
- `adaptInjectionBudget` 在低压时扩充 contextMemory LTM
- `adaptInjectionBudget` 在高压时优先压 stateTable 非活跃角色
- 多轮压缩/扩充循环验证轮转摊薄——无单层触底
- 硬地板不可突破：对话 6 轮、contextMemory LTM 2 条

### 集成测试

```bash
npm run test:unit
npm run test:ratchet
```

### 手动验证

```javascript
// 浏览器控制台
// 1. 设置 contextWindowRounds = 6, 加载长对话
// 2. 检查 __ne_debug_injection_sizes —— 各注入源大小
// 3. 检查 __ne_debug_compression_log —— 哪层被压缩/扩充了几档
```

---

## 实施顺序

1. 新增注入量追踪（变更 1）
2. 新增 `adaptInjectionBudget` 函数（变更 2）
3. 实现各层压缩/扩充操作（变更 3）
4. 接入 onBeforeGenerate（变更 4）
5. maxItems 参数化（变更 5）
6. 单元测试 + 集成测试
