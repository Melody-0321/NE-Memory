# 三大问题备忘录

---

## 问题 1：角色状态卡（字段缺失 / 主角误判为 NPC）

### 原因分析

**a) 主角/NPC 分类函数双重标准**

代码中有两个 `getCharacterCardType`：

| 位置 | 默认 fallback |
|------|---------------|
| [panel.js:L528-L532](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L528-L532) | `return 'npc'` |
| [schema.js:L773-L777](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js#L773-L777) | `return 'protagonist'` |

panel.js 版本无条件 fallback 到 `'npc'`，所有角色都被归类为 NPC。「江岚」是当前 role（ST 的 `name2`），但系统不知道谁是主角——因为 `state.protagonist_name` 从未被设置。`state.npc_names` 也从未被 pipeline LLM 填充过（prompt 没要求），所以永远是 `undefined`。

**b) 新角色字段只填了 status**

`ensureCharacterTemplate()` ([schema.js:L423-L440](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js#L423-L440)) 创建空模板（所有字段 `''` / `0` / `false`）。Pipeline LLM 的 prompt ([update.js:L973-L979](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L973-L979)) 说：

> "New character: write characters.Name.status:活跃 — system auto-creates the full template."
> "仅本轮实际变化的字段"

LLM 收到 Current State 表格（满是空值）→ 无法区分「从未被填过」和「本轮没变化」→ 只填了 `status`。

**c) 有时活跃角色不出卡**

`autoDecayStaleCharacters` ([update.js:L1082-L1100](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1082-L1100)) 在消息文本里用 `indexOf(name)` 检查角色是否在场。名字变体/简称匹配不上 → 立即削为「非活跃」→ 卡片消失。没有缓冲轮次。

### 方案

#### A. 主角识别（代码层）— 最小改动

1. **vault 初始化/每轮对话前**：从 ST 的 `ctx.name2` 或 `ctx.characters` 取当前 role 的角色名 → 写入 `state.protagonist_name`
2. **panel.js 的 `getCharacterCardType`**：`name === state.protagonist_name → 'protagonist'`，否则 `'npc'`
3. **统一 schema.js 的同名函数**：同样逻辑，不再 `return 'protagonist'` 做 fallback

#### B. 新角色字段补全（Prompt 层）

扩展 `rulesZh` 的新角色规则（[update.js:L976](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L976)）：

```
旧：- 新角色: 写 "characters.名字.status":"活跃" — 系统自动创建完整模板。
新：- 新角色（Current State 表格中该角色所有字段均为空）：
      必须输出所有能从对话中明确推断的字段，至少包含
      status、current_mood、relationship。系统提供空模板，不填即留空。
```

#### C. 衰减加固（代码层）

`autoDecayStaleCharacters` 不在单轮内做决议。引入 `_decay_pending` 字典：首轮不在 present → 记入待决；连续两轮不在 → 削为「非活跃」。一轮缓冲消除名字变体误判。

#### 损益

| | 收益 | 代价 |
|---|---|---|
| A. protagonist_name | 主角不再被误标记为 NPC；角色卡字段正确区分 | 依赖 ST 上下文正确返回 `name2`（通常可靠） |
| B. Prompt 补全 | 新角色首轮即获得 mood/relationship 等关键字段 | LLM 猜错（低概率；即使错了下轮可修正） |
| C. 衰减缓冲 | 不再因名字变体误判丢失卡片 | 离场角色延迟 1 轮清理（可接受的延迟） |

---

## 问题 2：对话自动隐藏 / 轮次滑动窗口

### 用户需求

- 长对话中早期消息占据大量上下文窗口
- 用户希望「定期把早期对话从 UI 和 LLM 上下文中隐藏」
- 或者「按轮次而非 token 参数做滑动窗口上下文注入」

### 当前 ST 已有的机制

ST 的上下文裁剪完全基于 **token 预算**：

| 路径 | 机制 |
|------|------|
| OpenAI API | `tokenBudget = context - response`，旧消息逐个 `canAfford()` 检查，预算耗尽时 break |
| 非 OpenAI | `tokenCount` 累加，超出 `this_max_context` 时 break |

ST 的 `is_system` 隐藏机制（[chats.js:L147-L169](file:///d:/SillyTavern/public/scripts/chats.js#L147-L169)）通过 `hideChatMessageRange(start, end)` 将消息的 `is_system` 设为 `true`，然后 `generate()` 在 [script.js:L4437](file:///d:/SillyTavern/public/script.js#L4437) 过滤掉。

**ST 没有按轮次的裁剪机制。**

### 用户提议的两条路

#### 选项 A：定期自动隐藏早期消息

调用 ST 的 `hideChatMessageRange(0, N)` 将前 N 条消息设为 `is_system=true`。UI 上消失，generate() 自动过滤。

**损益：**

| 收益 | 代价 |
|------|------|
| 简单——直接复用 ST API | 早期消息 UI 完全不可见（除非手动取消隐藏） |
| LLM 上下文不受影响（ST 已有过滤逻辑） | 隐藏粒度粗（按消息索引，不是轮次） |
| 减少 DOM 渲染压力 | 用户可能想回顾早期对话时需要手动恢复 |
| 可配置隐藏频率（每 N 轮触发） | `is_system` 消息仍占用 chat 数组内存 |

#### 选项 B：按轮次滑动窗口上下文注入（优雅方案）

**不在 ST 层裁剪**，而是在 ne-memory 的 `onBeforeGenerate` 注入阶段做：

1. 用户设置 `contextWindowRounds = N`（例如 20 轮）
2. `onBeforeGenerate` 时：遍历 `chat` 数组，取最近 N 轮 user/assistant 消息对
3. 将 N 轮内未被 ST 自动裁剪的消息原文提取出来，注入到 system prompt 的「最近对话」段
4. N 轮之前的消息：不注入原文，但注入**摘要**（ne-memory 已有 STM/LTM 记忆管线可提供摘要）

**损益：**

| 收益 | 代价 |
|------|------|
| UI 完整——所有历史消息可见，不修改 `is_system` | 实现复杂度更高（需要分割 chat、提取原文、组织注入格式） |
| LLM 看到「最近 N 轮原文 + 之前所有记忆摘要」——信息密度远高于纯令牌裁剪 | 摘要质量依赖 STM/LTM 管线（已有基础） |
| 按轮次参数精确控制，不依赖 ST 的 token 估算 | 需要新的 UI 设置项（contextWindowRounds） |
| 与 ST 的 token 裁剪互补而非冲突 | N 轮原文的总 token 数仍受 ST maxcontext 限制——如果 N 轮原文超出，ST 仍会裁剪 |

### 建议

**选项 B 长期更优。** 它不与 ST 的 token 裁剪冲突——ST 的 `maxContext` 是硬件约束，无论如何都会生效。选项 B 的价值在于**在硬件约束内提高信息密度**：LLM 看到最近 N 轮原文（不失真），N 轮之前的记忆以摘要形式呈现（比原始对话更精炼）。这是「结构化上下文」而非「隐藏」——本质上是 ne-memory 本来就该做的 core value。

**实施路径：**
1. 在 settings 中加 `contextWindowRounds`（默认 30），UI 滑块 10-100
2. `onBeforeGenerate` 中，取最近 N 轮消息原文，格式化为「最近对话记录」段
3. 取 ne-memory 的 STM/LTM 摘要作为「历史记忆摘要」段
4. 两个段都注入 system prompt（取代当前的全量依赖 ST 裁剪）

---

## 问题 3：Token 计数器无法运行

### 根因

**无论对话多少轮，token 消耗永远显示 0。** 两条数据通路都没接上。

#### 通路 1：主对话 token（events.js）— 字段名不匹配

[events.js:L650-L654](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L650-L654)：

```js
var charEstimate = formatted ? Math.round(formatted.length / 3.5) : 0;
trackMemoryInjection(charEstimate);
recordChatStat(chatId, 'tok', charEstimate);   // ← 写入 turn.tok
```

但 `rebuildAggregates` (chat-telemetry.js) 读取 `turn.tok_chat`，由 `recordChatToken(chatId, 'tok_chat', ...)` 写入：

```js
// chat-telemetry.js L149
var tc = (turn.tok_chat || 0) + ...
```

**`recordChatToken(chatId, 'tok_chat', ...)` 在主对话路径从未被调用。** `recordChatStat` 写入的 `tok` 和 `rebuildAggregates` 读取的 `tok_chat` 是两个不同的 key。chat token 数据被写入但永不被读取。

#### 通路 2：Pipeline token（llm.js）— usage 为 null 或 0

[llm.js:L534-L536](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L534-L536)：

```js
var usage = data.choices?.[0]?.usage || data.usage || null;
```

然后 [llm.js:L79-L91](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L79-L91)：

```js
var totalTokens = usage ? (usage.total_tokens || 0) : 0;
if (totalTokens > 0) {
    recordChatToken(chatId, tokenOp, totalTokens);
    recordDailyToken(tokenOp, totalTokens);
}
```

- **TH 路径**（`callTavernHelper`，[llm.js:L592](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L592)）通过 `runtime.generateQuiet()` 调用，返回纯字符串，无 `usage` 字段
- **二级 API 路径**（`callCustomAPI`），某些 proxy 不返回 `usage` → `usage = null`
- 即使 `usage` 存在，`total_tokens = 0` 也会被 `if (totalTokens > 0)` 守卫跳过

**两条路径都可能走到 totalTokens = 0，从而导致 token 数据永不记录。**

#### 第三层：没有真实 Tokenizer（次要）

`package.json` 中无 tokenizer 依赖。所有本地估算都用 `text.length / 3.5`（中文字符 ≈ 0.29 token，实际 ≈ 2-3 token，误差 7-10 倍）。但这只是**精度问题**，不是计数器完全无法运行的根因。

### 方案

**两个一行修复：**

#### Fix 1：主对话 token — 对齐 key

[events.js:L654](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L654)：

```
旧：recordChatStat(chatId, 'tok', charEstimate);
新：recordChatToken(chatId, 'tok_chat', charEstimate);
```

`recordChatToken` 内部同时写 `turn.tok_chat` 和调用 `recordDailyToken`。一行改动，主对话 token 立即出现在统计面板中。

#### Fix 2：Pipeline token 兜底

[llm.js](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js) 中 `_recordPipelineUsage` 函数（L76-L93）：

```
旧：if (totalTokens > 0) { record... }
新：totalTokens 为 0 时用 countTokens(text) 做估算回退，确保 TH 路径和无 usage API 都能记录
```

#### Fix 3（可选推进）：上真实 Tokenizer

```bash
npm install gpt-tokenizer
```

全局替换 `text.length / 3.5` → `countTokens(text)`。消除估算误差，不影响 Fix 1/2 的急迫性——先让计数器工作，再优化精度。

### 损益

| | 收益 | 代价 |
|---|---|---|
| Fix 1（key 对齐） | 主对话 token 立即出现在 UI | 一行改动 |
| Fix 2（兜底） | TH 路径 token 不再为 0 | ~5 行改动，引入估算（误差 <5%，远优于完全 0） |
| Fix 3（Tokenizer） | 所有估算误差从 7-10 倍降到 <1% | npm 依赖 ~30KB gzip；Fix 1/2 不依赖此项，可单独推进 |
