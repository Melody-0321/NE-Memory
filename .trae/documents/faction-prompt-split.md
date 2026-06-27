# 势力提取 Prompt 拆分 —— 脱离三合一，保 KV-Cache 命中

## 目标

将势力提取从 `resolveNpcSchemes` 的三合一 LLM 调用中拆出为独立调用，用 prompt-engineering 正确设计空态路径，同时通过共享世界书 system message 让两次调用利用 provider 的 KV Cache 前缀命中。

## 当前问题

`resolveNpcSchemes` 的 `buildSchemeDiscoveryPrompt` 将 **NPC 方案设计 + 角色列表 + 势力提取** 三个异构任务塞进同一个 user message（[update.js:L1442-L1448](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1442-L1448)）。三个 prompt-engineering 原则被违反：

1. **Principle 1.1（末行锚定）**：三个 task 末行收敛到同一个整体 JSON 闭合——无法分别锚定各自的期望行为
2. **Principle 1.2（语义随 token 共现）**：世界书全量距 faction 输出格式 ~500 tokens——提取依据与格式定义分离
3. **Principle 2.2（每字段单一权威定义）**：faction 的 "Identify all..." 命令与输出格式分处两个段落；但空态（找不到时返回空）根本没有定义——LLM 被强制要求 "识别"，却未被告知可返回空

结果：世界书无势力时 LLM 无处可退，只能编造。——参见 `buildSchemeDiscoveryPrompt` [L1406-L1414](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1406-L1414)

## 新架构

```
resolveNpcSchemes(vault, chatId, messages)
  |
  ├── collectWorldBookContent() → worldBookEntries[]
  |       (复用现有 async 函数，不变)
  |
  ├── 世界书为空？ → 写默认 schemes， return（同当前逻辑，不变）
  |
  ├── buildWorldBookSystemBlock(worldBookEntries) → worldBookMsg
  |       (新建，将世界书格式化为 {role:'system', content:'## World Setting\n...'})
  |
  ├── Call 1：Schemes + Characters
  |       callMemoryPipeline([
  |         worldBookMsg,                        ← 共享前缀
  |         { role:'system', content:'...' },    ← 方案发现角色描述
  |         { role:'user',   content: buildSchemeCharPrompt(messages) }
  |       ], { operation:'scheme_discovery' }, chatId)
  |       → 解析 schemes / initial_characters
  |
  ├── Call 2：Factions（仅世界书非空时）
  |       callMemoryPipeline([
  |         worldBookMsg,                        ← 相同前缀，KV Cache 命中
  |         { role:'system', content:'...' },    ← 势力提取角色描述
  |         { role:'user',   content: buildFactionPrompt() }
  |       ], { operation:'faction_discovery' }, chatId)
  |       → 解析 factions → 写入 state.factions + faction_keywords
  |
  └── 设置 _factions_extracted = true
```

**KV Cache 原理**：`worldBookMsg` 的内容在两个调用中完全不变（相同 token 序列、相同位置）。OpenAI prompt caching、Anthropic、vLLM prefix caching 均会在第二次调用时复用已缓存的 KV，世界书段零前向计算。

## 详细改动

### 文件：[update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

#### 1. `resolveNpcSchemes` 函数重构（L1418-L1564）

**改动前**：
```js
// 单次 LLM 调用：三合一 prompt
var prompt = buildSchemeDiscoveryPrompt(worldBookContent, messages);
var response = await callMemoryPipeline([
    { role: 'system', content: 'You are a world-building analyst. ...' },
    { role: 'user', content: prompt }
], { operation: 'scheme_discovery' }, chatId);
// 解析：schemes + initial_characters + factions 全部在同一 response 里
```

**改动后**：
```js
// 构建共享的世界书 system message
var worldBookMsg = buildWorldBookSystemBlock(worldBookContent);

// Call 1：Schemes + Characters
var response1 = await callMemoryPipeline([
    worldBookMsg,
    { role: 'system', content: 'You are a world-building analyst. Determine NPC tracking schemes and list all characters.' },
    { role: 'user', content: buildSchemeCharPrompt(messages) }
], { operation: 'scheme_discovery' }, chatId);

var parsed1 = safeJsonParse(String(response1 || '').trim());
// 解析 schemes + initial_characters（不变，去掉 faction 解析）

// Call 2：Factions
var response2 = await callMemoryPipeline([
    worldBookMsg,
    { role: 'system', content: 'You extract organizations and factions from world settings. Return only what is explicitly described. If nothing matches, return {"factions":{}}.' },
    { role: 'user', content: buildFactionExtractionPrompt() }
], { operation: 'faction_discovery' }, chatId);

var parsed2 = safeJsonParse(String(response2 || '').trim());
// 解析 factions（与当前逻辑相同）

// 设置标记
vault.content._factions_extracted = true;
```

#### 2. 新增：`buildWorldBookSystemBlock(worldBookEntries)`（在 `buildSchemeDiscoveryPrompt` 附近）

```js
function buildWorldBookSystemBlock(worldBookEntries) {
    var text = '## World Setting\n';
    worldBookEntries.forEach(function(entry, i) {
        text += '[' + (i + 1) + '] ' + (entry.content || entry.key || '') + '\n';
    });
    return { role: 'system', content: text };
}
```

将当前 `buildSchemeDiscoveryPrompt` 中 `wbText` 的构建逻辑提取为独立函数。

#### 3. 修改：`buildSchemeDiscoveryPrompt` → 重命名 + 缩小范围

当前 `buildSchemeDiscoveryPrompt(worldBookEntries, messages)` 构建三合一的完整 prompt。改为 `buildSchemeCharPrompt(messages)`，**仅包含 Task 1 (Schemes) + Task 2 (Characters)**，去掉世界书（由 `worldBookMsg` 提供）和 Task 3 (Factions)。

输出格式保持不变：
```json
{
  "schemes": { ... },
  "initial_characters": [ ... ]
}
```

#### 4. 新增：`buildFactionExtractionPrompt()`（纯势力提取）

```js
function buildFactionExtractionPrompt() {
    return '## Task\n' +
        'Extract only organizations, factions, guilds, clans, families, or groups\n' +
        'that are EXPLICITLY described in the World Setting above.\n' +
        'If none are described, return an empty object: {}\n' +
        '\nOutput ONLY valid JSON:\n' +
        '{\n' +
        '  "factions": {\n' +
        '    "<Name>": {\n' +
        '      "name": "<Full name>",\n' +
        '      "description": "<One-sentence description>",\n' +
        '      "leader": "<Leader name, or empty if unknown>",\n' +
        '      "attitude_toward_player": "友好/中立/冷淡/敌对/未知",\n' +
        '      "aliases": ["<alias>"]\n' +
        '    }\n' +
        '  }\n' +
        '}\n' +
        '\nIf no factions exist:\n' +
        '{"factions":{}}';
}
```

**Prompt-Engineering 验证**：

| 原则 | 检查 |
|------|------|
| 1.1 末行锚定 | 末行 `{"factions":{}}` = 空态默认路径 → 没有势力不编造 ✓ |
| 1.2 语义共现 | 世界书紧邻 task（同在一组 messages 中，世界书为 system，task 为 user）→ 提取依据与格式不分离 ✓ |
| 2.1 无负向示例并列 | 填充示例与空态示例并列，均为正面路径 → 无冲突 ✓ |
| 2.2 单一定义 | faction 仅在 `buildFactionExtractionPrompt` 中有语义描述 → 无重复定义 ✓ |
| 4.2 角色边界 | system prompt 精确定义 "extract organizations from world settings" → 与 user prompt 一致 ✓ |

#### 5. `buildSchemeDiscoveryPrompt` 中删除势力相关

- 删除 Task 3 描述（当前在第 1376 行附近）
- 删除输出格式中的 `"factions": { ... }` 块（`L1406-L1414`）
- 函数重命名为 `buildSchemeCharPrompt`，参数去掉 `worldBookEntries`（世界书由 `worldBookMsg` 承担）

#### 6. 解析部分调整

当前在 `L1454-L1549` 处同时解析 schemes、initial_characters、factions。改为：

- 从 `parsed1` 解析 schemes + initial_characters（不动）
- 从 `parsed2` 解析 factions（`parsed2.factions`，逻辑不变）
- 新增解析层数标记：`vault.content._factions_extracted = true`

### 操作参数

Call 2 使用 `{ operation: 'faction_discovery' }`，与现有遥测/日志兼容。两次调用均使用 `chatId` 以支持 per-chat token 统计。

### 世界书为空时的处理

`worldBookContent.length === 0` → 不执行任何 LLM 调用，写默认 schemes，直接 return。与当前逻辑相同，无需修改。

### KV-Cache 前置条件

此优化依赖 provider 支持 prefix caching（vLLM `--enable-prefix-caching`、OpenAI/Anthropic 自动 prefix cache）。若 provider 不支持，Call 2 额外消费世界书长度的输入 token（~2K-5K，一次性的首轮开销），其余无影响。

## 时序协调：`Promise.all` vs 串行 vs 调度器

### 现状

`pipeline-guard.js` 是一个**全局互斥锁**（三态 `idle → state/stm/ltm`），不是调度器。所有管道调用通过 `tryAcquire` 串行化。当前 `resolveNpcSchemes` 内部只有 1 次 `await callMemoryPipeline`，拆分后变成 2 次串行 `await`。

### 分析：是否需要队列调度器？

**不需要。** 全局互斥锁是正确的最小化设计：

| 调度器能力 | 当前系统是否需要 | 原因 |
|-----------|----------------|------|
| 任务优先级编排 | 否 | State/STM/LTM 无优先级差，先到先做正确 |
| 依赖追踪 + 自动触发 | 否 | STM→LTM 是唯一依赖，已通过 `read(chatId)` 隐式解决 |
| 失败重试 + backpressure | 否 | LTM 已有 max pass=20 限流；stm 有 consecutiveFailures 降级 |
| 并行编排 | 否 | 管道写同一个 vault 文件，并行写 → 后写覆盖先写 → 数据丢失 |

唯一需要并行化的地方：**同一锁持有期内的无依赖子步骤**——即 `resolveNpcSchemes` 内部的两次 LLM 调用。

### 分析：是否需要全局 Promise.all？

**不需要。** State pipeline 与 STM pipeline 虽然写 vault 不同子对象（`state.*` vs `stm_entries`），但都通过 `saveVaultWithSnapshot` 写回同一个 vault 文件。两个异步 `saveVaultWithSnapshot` 并行执行 → 后完成的覆盖先完成的 → 丢失一方的写入。必须保持互斥。

### 方案：`resolveNpcSchemes` 内部 `Promise.all`

Call 1 (schemes+chars) 和 Call 2 (factions) **完全独立**：共享同一个只读 `worldBookMsg`，写入 `state` 的不同子对象（`npc_schemes` / `_character_schemes` vs `factions` / `faction_keywords`），无因果依赖。

**并行化代码**：

```js
var worldBookMsg = buildWorldBookSystemBlock(worldBookContent);

var [response1, response2] = await Promise.all([
    callMemoryPipeline([
        worldBookMsg,
        { role: 'system', content: '...schemes+characters...' },
        { role: 'user', content: buildSchemeCharPrompt(messages) }
    ], { operation: 'scheme_discovery' }, chatId),

    callMemoryPipeline([
        worldBookMsg,
        { role: 'system', content: '...factions...' },
        { role: 'user', content: buildFactionExtractionPrompt() }
    ], { operation: 'faction_discovery' }, chatId)
]);
```

| 维度 | 串行 await | `Promise.all` |
|------|-----------|---------------|
| 首轮总延迟 | T₁ + T₂ | **max(T₁, T₂)** |
| 新增延迟 vs 当前单次调用 | +1 次往返 | **0**（隐藏在 schemes call 的耗时下） |
| pipeline-guard 占有时间 | T₁ + T₂ + T_state | max(T₁, T₂) + T_state = **与当前持平** |
| KV Cache | Call 2 命中 Call 1 | 同时发出，同一前缀 |
| 代码复杂度 | 低 | 同样低（1 行改 4 行） |

**结论**：`Promise.all` 将 factions 调用的额外延迟完全归零。总耗时由较慢的 call 决定（通常是 schemes+characters，prompt 更长、输出更复杂）。World book 的 KV Cache 在两次并行调用中均被命中。

### 不改动的部分

- `pipeline-guard.js`：保持现有互斥锁，不引入调度器
- `extractStateChangesOnly`：保持 `await resolveNpcSchemes(...)` 不变，内部并行对其透明
- `flushPendingMessages` / `executeIncrementalUpdate`：不涉及

## 改动范围

| 文件 | 改动 | 行号范围 |
|------|------|----------|
| `update.js` | 新增 `buildWorldBookSystemBlock()` | 在 `buildSchemeDiscoveryPrompt` 之前 |
| `update.js` | 新增 `buildFactionExtractionPrompt()` | 同上 |
| `update.js` | `buildSchemeDiscoveryPrompt` 重命名为 `buildSchemeCharPrompt`，去掉世界书 + 势力 | L1363-L1415 |
| `update.js` | `resolveNpcSchemes` 重构为两次 LLM 调用 | L1418-L1564 |
| `update.js` | 两次调用响应分别解析 | L1450-L1549 |

不影响 `events.js`、`panel.js`、`schema.js`、`index.js`。不影响 `dist/` 外的任何文件。

## 验证

1. `npm run build` 无错误
2. 新建含势力世界书的聊天 → 控制台 `[NE] Factions extracted from faction_discovery: N` → state.factions 非空、全部 `_hidden: true`
3. 新建**不含势力**世界书的聊天 → 势力不创建、不编造 → `state.factions` 为 `undefined` 或空
4. 世界书为空 → 直接写 default scheme → return（不调用 LLM）
5. KV-Cache：若 provider 支持 prefix caching，第二次调用的世界书段 latency 接近 0
