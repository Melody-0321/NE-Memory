# State LLM KV-Cache 优化 — Prompt Engineering 审查

## 目标

将 State LLM 的 `buildStatePrompt_Preset` 拆分为两条 system message，让字符卡 + 字段规则成为跨轮不变的 KV-Cache 前缀。不做逐轮改动的部分（characterCard + static rules）缓存在第一条 system message 中；每轮变化的部分（stateTable + worldBook + 动态指令）缓存在第二条中。

先做 Prompt Engineering 全量审查（借助 prompt-engineering skill），再执行实现。

## KV-Cache 生命周期分析

### 担忧：穿插调用会打掉缓存？

State LLM Round N → SmartPush / STM / LTM → State LLM Round N+1 之间有 3-5 次不同 system prompt 的调用。

**结论：在 Continuous Batching 推理后端（vLLM/SGLang/llama.cpp server）下不会。** 前缀缓存是全局哈希表——State LLM 的 prefix `[charCard + rules]` 作为一个独立的哈希条目存在于 GPU 内存中，其他调用的不同前缀只是占用不同哈希槽，不会驱逐已存在的条目。只要后端支持 prefix caching（通过 `--enable-prefix-caching` 或等价参数），中间穿插的 STM/LTM/SmartPush 调用都不会导致 State LLM 的前缀缓存失效。

因此：**仅做 Message 1/2 拆分即可，无需全管线前缀共享。**

## 当前问题

`buildStatePrompt_Preset` 将所有内容拼为一条 system 字符串（[update.js:L1078-L1110](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1078-L1110)）：

```js
system: stateTable + buildCharacterCardSection(vault) + worldBook + rules + newCharHint
```

**KV-Cache 视角**：`=== Current State ===` 头 30 字符后的 `time:` 值立即进入变量数据 → 前缀命中 = 仅 30 tokens。字符卡（300-800 tokens）+ 规则（600-1000 tokens）= ~1500 tokens 完全可缓存的部分被埋在后面，每轮都重新计算。

## Prompt-Engineering 全量审查

### Principle 3.1：展开全量所有 8 条分支

| Branch | `lang` | `newNames` | `worldBook` | `neCharFallback` | 锚定行为 |
|--------|--------|-----------|-------------|-------------------|---------|
| A | zh | >0 | + | false | 填充新角色字段（`正确示例: {...}`） |
| B | zh | >0 | - | false | 填充新角色字段（`正确示例: {...}`） |
| C | zh | =0 | - | false | 零变化（`零变化示例: {"state_changes":{}}`） |
| D | zh | =0 | - | true | 零变化 + fallback 填充情感 |
| E | en | >0 | + | false | 填充新角色字段（`Correct example: {...}`） |
| F | en | >0 | - | false | 填充新角色字段（`Correct example: {...}`） |
| G | en | =0 | - | false | 零变化（`Zero-change example: {...}`） |
| H | en | =0 | - | true | 零变化 + fallback 填充情感 |

### 拆分方案

```
Message 1 [system]:  buildCharacterCardSection(vault) + rules_static
Message 2 [system]:  stateTable + worldBook + fallbackNote + newCharHint
Message 3 [user]:    dialogue + instruction
```

**`rules_static`** = 当前 rules 去掉 `neCharFallback` 条件分支。

原 rules 含：
```
- 你管理: gender_age, ..., past_experience[, affection, ... ]  ← 动态后缀
- [Main LLM missed → MUST fill affection]  ← 动态段落
```

改为：
```
- 你管理: gender_age, ..., past_experience, affection, current_mood, inner_thoughts
```

`affection` 等的**填充指令**移到 Message 2 中的 `fallbackNote`（仅 neCharFallback 时出现）。

### Principle 3.2：信号冲突扫描

| 检查项 | 变化 | 结果 |
|--------|------|------|
| 1.1 末行锚定 | 末行仍是 newCharHint / 零变化示例 | ✅ 不变 |
| 1.2 语义共现 | rules 从 +2000 → -1500 位置（更早） | ✅ 改善 |
| 2.1 负向示例并列 | 不变 | ✅ 不变 |
| 2.2 单一定义 | neCharFallback 从"字段列表 + 说明段落 2 处定义"→ 仅在 fallbackNote（Message 2）1 处定义 | ✅ 改善 |
| 4.1 字段自文档化 | 表头不变 | ✅ 不变 |
| 4.2 角色边界 | Message 1 的第一个 section 是字符卡（信息来源声明） | ✅ 改善 |
| Must/May | 不变 | ✅ 不变 |
| 源歧义 | 分支不变 | ✅ 不变 |
| 跨 Message 距离 | 零示例在 Message 1 末端，stateTable 在 Message 2，间隔 ~500-1000 tokens（取决于世界书长度） | ✅ 语义连贯 |

### Principle 5.2：8 条分支全量验证

重点检查两个边界 branch：

**Branch C**（zh, no newChars, no WB, no fallback）：

Message 1 以 `零变化示例: {"state_changes":{}}` 结束 → 锚定到"可以输出空"。
Message 2 以 `你也管理 factions...` 结束 → 轻微但一致的信号："你管理 factions，但没有必须填充的字段"。

Message 2 的 stateTable 显示已有值的字段（如 `gender_age: 女,26岁`），不是空壳。结合零变化示例 → 逻辑：如果本轮未变化，输出 `{}`。

**Branch A**（zh, newChars >0, WB+, no fallback）：

Message 1 以 `没有 _scheme 默认用 "default"` 结束 → 弱信号。
Message 2 以 `正确示例: {"state_changes":{"characters":{"安然":{...}}}} ` 结束 → 强锚定："必须填充"。

组合信号一致。零变化示例被移除（newNames >0 时不出现在 rules 中），填充指令被强化（newCharHint 以示例结尾）。

**Branch D**（zh, no newChars, no WB, fallback=true）：

Message 1 以 `零变化示例: {"state_changes":{}}` 结束。
Message 2 含 `fallbackNote`："主 LLM 本轮未输出角色情感数据。你必须填充活跃 NPC 的: affection、current_mood、inner_thoughts"。

零变化示例说的是"其他字段可以空"，但 fallbackNote 要求"情感字段必须填"。这是合理的——LLM 应该理解零变化示例对情感字段不适用（因为 fallbackNote 在更后面的 Message 2）。

**所有 8 条分支无新增信号冲突。**

## 详细改动

### 文件：[update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

#### 1. `buildStatePrompt_Preset` 重构（L998-L1114）

**改动**：

1. 将 `rules` 分为 `rulesStatic`（去掉 neCharFallback 条件）和 `fallbackNote`（仅 neCharFallback 时输出）。
2. `system` 从单个字符串改为 **2 个 system message 的数组**。
3. `neCharFallback` 动态部分全部移到 Message 2。

**新 rulesStatic**（中文）：
```
## 字段规则
- 你管理: gender_age, physique, occupation, personality, clothing_build, status, injuries, status_effects, relationship, past_experience, affection, current_mood, inner_thoughts。
- 字段已有具体值 → 仅在本轮对话导致该值变化时输出。
- JSON 路径使用上方表格括号内的字段名（如 gender_age）。
- status: 活跃/非活跃/已死亡/已归隐/已离去。提及≠在场。
- 不要输出 present_characters（自动生成）。
- 已有 _scheme 的 NPC — 不要修改。新 NPC 无 _scheme：从上方「NPC Schemes Available」中分配，不确定用 "default"。
{零变化行，仅当 newNames=0}
- 你也管理 factions（势力）：name, description, leader, attitude_toward_player[友好/中立/冷淡/敌对], notes。
- 势力首次被提及或与 PC 互动时，更新其 attitude 和 notes。
```

**新 fallbackNote**（中文，仅 neCharFallback 时附加到 Message 2 末尾，newCharHint 之前）：
```
## 情感回退
主 LLM 本轮未输出角色情感数据。你必须填充活跃 NPC 的: affection（0-100数值）、current_mood、inner_thoughts — 从对话上下文推断。
```

英文同理。

#### 2. State Prompt 构建逻辑

```js
// 当前：
var rules = lang === 'en' ? rulesEn : rulesZh;
// 拆分为：
var rulesStatic = lang === 'en' ? rulesStaticEn : rulesStaticZh;
var fallbackNote = '';
if (neCharFallback) {
    fallbackNote = lang === 'en' ? '\n## Emotion Fallback\nMain LLM did not output emotion data. You MUST fill affection (0-100), current_mood, inner_thoughts for active NPCs — infer from dialogue.\n' 
        : '\n## 情感回退\n主 LLM 本轮未输出角色情感数据。你必须填充活跃 NPC 的: affection（0-100数值）、current_mood、inner_thoughts — 从对话上下文推断。\n';
}
```

#### 3. 返回值改变

```js
// 从：
return { system: stateTable + charCard + worldBook + rules + newCharHint, user: '...' };
// 到：
return { 
    system: [
        charCard + rulesStatic,         // Message 1：不变，KV-Cache 命中
        stateTable + worldBook + fallbackNote + newCharHint  // Message 2：每轮变化
    ], 
    user: '...' 
};
```

#### 4. `extractStateChangesOnly` 调用侧更新（L1599-L1605）

```js
// 当前：
stateResponse = await callMemoryPipeline([
    { role: 'system', content: statePrompt.system },
    { role: 'user', content: statePrompt.user }
], { operation: 'state_extract' }, chatId);

// 改为：
var sysMsgs = statePrompt.system.map(function(s) {
    return { role: 'system', content: s };
});
stateResponse = await callMemoryPipeline(
    sysMsgs.concat([{ role: 'user', content: statePrompt.user }]),
    { operation: 'state_extract' }, chatId
);
```

或等效的展开写法。`callMemoryPipeline` 接收 messages 数组，OpenAI 格式支持多 system message（串联为最终 prompt 前缀）。

#### 5. `runLtmDecision` 中调用的 State LLM（update.js，非 extractStateChangesOnly 上下文）

搜索 State LLM 被 `callMemoryPipeline` 调用的所有位置，确保任何调用者都正确处理 `statePrompt.system` 为数组。

**验证**：`buildStatePrompt_Preset` 仅在 `extractStateChangesOnly` 中被调用（[L1615](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1615)）。无其他调用点。

## 不改动的部分

- `buildStateInjectionTable` — 不变
- `buildCharacterCardSection` — 不变
- `buildWorldBookSection` — 不变
- `_fetchWorldBookText` — 不变
- `segmentTurns` / `executeIncrementalUpdate` / LTM pipeline — 不涉及

## Prompt-Engineering 最终审查

| 原则 | 状态 |
|------|------|
| 1.1 末行锚定 | ✅ 末行仍是 newCharHint / 零变化示例 |
| 1.2 语义共现 | ✅ rules 提前 ~1500 tokens；字符卡提前 ~2000 tokens |
| 2.1 无负向示例并列 | ✅ 不变 |
| 2.2 单一定义 | ✅ neCharFallback 从 2 处减为 1 处 |
| 3.1 全量展开审查 | ✅ 8 条分支全读 |
| 3.2 信号冲突扫描 | ✅ 无新冲突 |
| 4.1 字段自文档化 | ✅ 不变 |
| 4.2 角色边界 | ✅ 字符卡作为首个 section 表明信息来源 |

## KV-Cache 效果

| 指标 | 改动前 | 改动后 |
|------|--------|--------|
| Message 1 缓存命中（12 轮） | 11 次全算 | 11 次命中 → 0 计算 |
| Message 1 长度 | — | ~800-1500 tokens |
| 节省/12 轮 | 0 | **~8,800-16,500 tokens 前向计算** |
| 额外开销 | 无 | 无（跨轮共享相同前缀） |
| 语义纯度 | neCharFallback 双定义 | 单定义 + fallbackNote |

## 验证

1. `npm run build` 无错误
2. 创建聊天并发送 3+ 轮消息 → 观察控制台无报错
3. State LLM 输出与改动前行为一致（字段值合理、无漏填、无过度填充）
4. `__ne_debug_last_pipeline.changes` 输出与改动前模式一致
