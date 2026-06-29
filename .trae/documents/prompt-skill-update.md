# 提示词工程 Skill 更新计划

## 摘要

基于外部滚动总结提示词分析和近期多次提示词迭代的经验教训，更新 `prompt-engineering` skill，新增 4 条通用原则和 3 条专项原则。

---

## 一、原则从何而来 —— 我的观点

提示词工程的原则有两个来源：

### 源 A：LLM 普遍行为规律（通用原则）

这类原则来自 LLM 的底层推理机制，不受具体任务影响。当前 skill 中的原则 1.1（末尾锚定）、1.2（语义共现）、2.1（不并列否定与逆示例）、2.2（单一权威定义）都属于这一类。

**判断标准**：是否换一个完全不同的任务（写诗、翻译、代码生成），这条原则仍然成立？是 → 通用原则。

新增的通用原则：
- **三层结构**：肯定指令 / 否定指令 / 严格禁止 三段独立。LLM 对结构边界敏感，`##` 标题天然形成注意力分隔。末尾放"严格禁止"是利用原则 1.1 让底线规则被最高权重处理。
- **具体短语禁止优于抽象概念禁止**：LLM 做的是 token 匹配，不是语义理解。禁止 `"感情升温"`（精确字符串）比禁止 `"关系性判断"`（抽象概念）有效得多。
- **禁止判定类总结（评论性语言）**：与"禁止推断事实"不同，评论是 LLM 在扮演叙事评论员。

### 源 B：本项目特有失败模式（专项原则）

这类原则来自 NE Memory 的特定架构约束——条件拼接、多消息 KV-Cache、多管线协调。换一个项目这些原则可能不适用或完全不同。

**判断标准**：这条原则是否来自 NE Memory 的特定架构决策（如 `system` 数组、中英双语分支、多 LLM 管线）？是 → 专项原则。

---

## 二、需要新增的通用原则

### 原则 1：三层结构（保留 / 省略 / 禁止）

**来源**：外部滚动总结提示词 + 原则 1.1（末尾锚定）

> 将提示词按功能和权重分为三个独立段：
> 1. **需要提取 / 需要保留** — 肯定指令。告诉 LLM 做什么。
> 2. **请忽略 / 请省略** — 否定指令。告诉 LLM 不做什么，但不属于底线违规。
> 3. **严格禁止** — 底线规则。放在**末尾**，用短语白名单形式。
>
> 三段各自以 `##` 标题开头，形成明确的注意力边界。

**为什么三层比混排好**：
- LLM 处理提示词时有"段级注意力"，段标题是信号放大器
- 混排时否定指令被夹在肯定指令中间，权重被稀释
- 末尾段的最高权重（原则 1.1）分配给底线规则

**该做什么、不该做什么**：NE Memory 中"事件记忆"（STM/LTM）只忠实记录已发生的事，"事实记忆"（State）天然只保留最新状态——所以不需要"删除已被推翻的信息"这种指令。三层结构对 NE Memory 来说只负责：肯定指令段写清该提取什么，否定指令段写清不该存什么，严格禁止段写清底线违规。

### 原则 2：具体短语禁止优于抽象概念禁止

> 禁止时给出精确的、LLM 可能输出的**具体字符串示例**，而非抽象概念名称。
>
> **正例**：`不要写 "感情升温""关系加深""更加信任""产生依赖"`
> **反例**：`不要输出关系性判断或感情分析`

**原因**：LLM 做 next-token prediction。`"关系"` 和 `"感情"` 这两个 token 的出现概率不会被"不要关系性判断"这条指令显著压低——因为指令本身是语义级别的，而 token 预测是字面级别的。但如果提示词中包含 `不要写 "感情升温"`，当 LLM 即将输出 `"感情"` 时，后续 token `"升温"` 的概率分布可能受到这条字面指令的影响。

### 原则 3：增量更新显式化

> 当 prompt 期望 LLM 在已有信息基础上做增量更新（而非从零生成），必须显式说明：
> 1. 保留仍然有效的信息
> 2. 补充新事实
>
> **必须写**：`不要从头重写` / `不要覆盖未变化的信息`

**当前问题**：我们的 LTM consolidation prompt 有 `append` / `close_and_new` / `skip` 三种操作，但 `updated_event` 的规则只说"保留旧摘要核心信息，仅追加增量"。缺少"不要从头重写"这个明确否定。

### 原则 4：输出空路径显式建模

> 每个 prompt 必须显式告诉 LLM：**当没有有效数据时，输出什么**。
>
> **正例**：`如果无可提取的有效事件，events 设为空数组 []。`
> **正例**：`零变化示例: {"state_changes":{}}`
>
> 这条指令是防御性的，必须存在且不被"你必须输出 X"稀释。

**当前状态**：我们的 STM prompt 有空数组 fallback，State LLM 有零变化示例。这两个做得对，但应该作为一条显式原则记录——未来新增 prompt 时必须检查是否有空路径设计。

### 原则 5：禁止判定类总结（评论性语言）

> LLM 不应输出对叙事内容本身的评价、定性、或元评论。
>
> **禁止的短语类**：`"这段展示了感情的进展""体现了人物的成长""标志着关系的新阶段""由此可见"`
>
> **允许的短语类**：事件描述、对话转述、事实陈述

**为什么这是一条独立原则**：buildRetrievalPrompt 的 CRITICAL FACT CONSTRAINT 禁止的是**推断未知事实**（"不要推断动机、情感、因果"）。但 LLM 还可能输出另一种污染——它不推断新事实，而是**评价已有事实**。"这段对话表明两人关系逐渐升温"不是推断（它确实看到了对话），但这是元叙述——LLM 在扮演叙事评论员，而不是档案员。`"由此可见"`、`"这表明"`、`"标志着"` 这类短语应该和 `"感情升温"` 一样进入禁止列表。

---

## 三、NE Memory 专项原则

### 原则 6：条件分支自检（8 个组合）

> **适用**：buildStatePrompt_Preset（有 2×2×2 = 8 个条件分支）
>
> 每次修改后，必须检查所有分支下的最终拼接 prompt：
> | 变量 | 分支 |
> |------|------|
> | `newNames.length` | >0 / ===0 |
> | `worldBookText` | 有 / 无 |
> | `lang` | 'en' / 'zh' |
>
> 每个分支的 prompt 必须自检：三层结构完整？末尾指令不矛盾？示例和规则不冲突？

### 原则 7：多消息语义自包含

> **适用**：buildStatePrompt_Preset（`system` 是数组）
>
> 如果 `system` 是 `[msg1, msg2]` 的数组形式（为了 KV-Cache 优化），那么：
> - msg2 中的指令**不能**引用 msg1 中的数据源（语义共现断裂）
> - msg2 中 `从上方角色卡中提取` → msg1 中有角色卡 → 断裂
> - 修复：将角色卡移到 msg2
>
> 检查方法：读 msg2 的文本，如果出现"上方""上述""如前所述"等引用词 → 追溯 msg1 确认引用链不断裂。

### 原则 8：跨管线一致性

> **适用**：STM 提取 → State LLM → 检索 LLM 三条管线
>
> 对同一实体的处理规则在三者之间必须一致或明确分工：
> - State LLM：管理 `affection` / `current_mood` / `inner_thoughts`（主 LLM 不输出时 fallback）
> - 检索 LLM：禁止推断动机和情感，禁止评论性总结
> - STM 提取：只记录事实事件
>
> 如果任何时候需要改变分工（如让 State LLM 也处理 faction），必须同步检查其他两个 prompt 是否产生竞争指令。

---

## 四、NE Memory 架构约束的提示词影响

### 不可混淆：事实记忆 vs 事件记忆

NE Memory 与参考的滚动总结系统有一个根本的架构差异：

| 维度 | NE Memory | 滚动总结（参考） |
|------|-----------|-----------------|
| 事实信息 | **状态栏（State）** — 天然只保留当前值，旧值被覆盖 | 滚动文本 — 需要手动"删除过期信息" |
| 事件信息 | **STM/LTM 表格** — 追加式记录，不容篡改 | 滚动文本 — 与事实混在一起 |

**这意味着**：NE Memory 不需要（也不应该）在提示词中加入"删除已被推翻的信息"的指令。状态栏的默认行为就是只保留最新值；事件记忆的职责是忠实记录——被推翻也是一种发生过的事实。

这解释了为什么我们在制定提示词原则时需要区分"通用原则"和"专项原则"——架构设计决定了哪些指令是需要的、哪些是冗余甚至有害的。

---

## 五、更新后的 Skill 文档

以下是更新后的 `prompt-engineering/SKILL.md` 完整内容：

```markdown
---
name: "prompt-engineering"
description: "LLM prompt design and modification principles. Invoke when writing, refactoring, or modifying any LLM system prompt — especially when the prompt involves multiple concatenated sections, conditional branches, or mixed signals (examples, negative instructions, field descriptions)."
---

# Prompt Engineering Principles

This skill enforces a set of principles for writing and modifying LLM system prompts in this project. It is based on patterns of failure observed across multiple iterations of prompts in `src/core/engine/update.js` and `src/core/engine/retrieval.js`.

---

## 1. Structure Principles

### 1.1 The last line governs behavior

LLMs anchor to the signal that appears **last** in the system prompt. The most important output instruction must be the final section.

**Rule**: Put the most behaviorally critical instruction (what the LLM should output) as the last section in the system prompt.

**Anti-pattern**: Writing "You MUST output X" in section 2, then showing `{"state_changes":{}}` as the "zero-change example" in section 5 (the last section). The LLM will anchor to the example, not the rule.

### 1.2 Meaning must co-occur with the token it describes

If a field name appears at position N in the prompt and its semantic description appears at position N+4000 tokens, the LLM has effectively lost the connection.

**Rule**: Inline field descriptions alongside their keys. Use format: `语义翻译 (field_key): value` instead of `field_key: value` with a separate glossary 4000 tokens later.

**Anti-pattern**: A table of 15 fields with bare English keys, followed 4000 tokens later by a "Field Reference" section.

### 1.3 Three-layer structure (retain / omit / strictly forbid)

Prompts should be organized into three distinct sections with explicit `##` headers, creating clear attention boundaries for the LLM.

**Rule**:
```
## 需要提取 (or: ## 合成规则 / ## 字段规则)
  ... affirmative instructions — what the LLM SHOULD do ...

## 请忽略 (or: ## 请勿修改 / ## 请勿包含)
  ... negative instructions — what the LLM should SKIP ...

## 严格禁止
  ... hard prohibitions — placed LAST for maximum weight ...
```

**Why**:
- `##` headers act as attention amplifiers between sections
- Mixed positive/negative instructions dilute the negative ones
- The LAST section gets the highest weight (principle 1.1) → assign it to the hard prohibitions

**Anti-pattern**: A flat list of rules where "do NOT output X" is rule 3 of 8, surrounded by affirmative rules.

**Scope awareness**: In NE Memory, event memory (STM/LTM) records what happened faithfully; factual memory (State) naturally retains only the latest value. Do NOT add instructions like "删除已被推翻的信息" — the architecture handles that. The three-layer structure is for: affirmative (what to extract), negative (what not to store), and hard prohibitions (red lines).

---

## 2. Signal Principles

### 2.1 Never juxtapose a negative instruction and its inverse example

"Don't output `{}`" + an example of `{}` → the LLM receives two competing anchors. It will follow whichever is closer.

**Rule**: Replace "do NOT output X" with "here is the correct output format" (a positive example). Show what to do, not what to avoid.

**Anti-pattern**:
```
You MUST output state_changes with filled fields. {"state_changes":{}} is NOT allowed.
... (1000 tokens later) ...
Zero-change example: {"state_changes":{}}
```

### 2.2 Each field has exactly ONE authoritative definition

If `clothing_build` is described in three different places, the descriptions will inevitably diverge.

**Rule**: Define each field's semantics in exactly one place. If a field appears in multiple contexts (table + rules), the table carries the label and the rules reference it — never re-describe.

### 2.3 Concrete phrase prohibition over abstract concept prohibition

LLMs pattern-match on literal tokens, not on semantic concepts. Banning specific output strings is dramatically more effective than banning abstract categories.

**Rule**: When prohibiting output, give concrete phrase examples in quotes:
```
✅ 不要写 "感情升温""关系加深""更加信任""产生依赖""逐渐靠近"
❌ 不要输出关系性判断或感情分析
```

**Why**: During next-token prediction, `"感情"` as a literal token is more readily suppressed by a literal prohibition than by an abstract instruction about "relationship judgments."

### 2.4 Ban evaluative/commentary language

LLMs should not output meta-commentary about the narrative content itself.

**Rule**: Explicitly list prohibited commentary patterns:
```
不要写 "这段展示了感情的进展""体现了人物的成长""标志着关系的新阶段""由此可见"
```

This is distinct from banning factual inferences (see 2.5 CRITICAL FACT CONSTRAINT in retrieval prompts). Commentary is when the LLM evaluates the significance of facts rather than just stating them. Phrases like `"由此可见"`, `"这表明"`, `"标志着"` should be in the prohibition list alongside `"感情升温"`.

---

## 3. Output Path Principles

### 3.1 Explicitly model the empty/null output path

Every prompt must tell the LLM exactly what to output when there is no valid data.

**Rule**:
```
✅ 如果无可提取的有效事件，events 设为空数组 []。
✅ 零变化示例: {"state_changes":{}}
```

This instruction must be present and not diluted by nearby "you MUST output X" language. The empty path and the affirmative path must have equal clarity.

### 3.2 Explicit incremental update instructions

When a prompt expects the LLM to update existing data rather than generate from scratch, it must explicitly state:
1. Keep what's still valid
2. Add what's new

**Rule**: Always include: `不要从头重写` / `不要覆盖未变化的信息`

**Current gap**: Our LTM consolidation prompt uses `append` / `close_and_new` / `skip` operations, but the `updated_event` rule only says "保留旧摘要核心信息，仅追加增量" without an explicit "不要从头重写" negation.

**Architecture note**: NE Memory's State bar naturally retains only the latest value for factual fields, so "删除已被推翻的信息" is unnecessary and should NOT be added to prompts. The architecture handles staleness differently from a rolling-summary system.

---

## 4. Modification Principles

### 4.1 No local modifications — always expand the full prompt first

Changing one line of a string concatenation without reading the complete assembled prompt will inevitably introduce new signal conflicts.

**Rule**: Before any prompt modification, build and read the complete final prompt output. Check all conditional branches. Only then decide what to change.

**Checklist before any prompt change**:
1. Print the full system prompt for the target scenario
2. Print for the opposite scenario (no data, different language, etc.)
3. Check: any "must" vs "may" conflict? any example contradicting an instruction? any field described twice?

### 4.2 Use signal conflict detection checklist

After every change, scan:

| Check | What to look for |
|---|---|
| Must/May conflict | "You must output X" + "If nothing changed, output `{}`" |
| Example contradiction | A positive example that contradicts a negative rule (or vice versa) |
| Empty vs. filled state | Instructions assuming empty fields vs. instructions assuming filled fields |
| Source ambiguity | "From World Book" + "From Character Card" + "From dialogue" all pointing to the same field |
| Last-line anchor | The final sentence of system prompt — does it match the desired behavior? |
| Three-layer check | Are ## Strictly Forbid / ## 严格禁止 the last section? Are positive/negative/prohibition separated? |
| Inter-message reference | If system is an array [msg1, msg2], does msg2 contain "see above" / "从上方" that references msg1? |

### 4.3 Instruction redundancy is more dangerous than instruction scarcity

When the LLM misbehaves, the instinct is to add another instruction. But each new instruction competes with existing ones for attention weight. Often the better fix is merging two existing instructions into one more precise one, rather than adding a third.

**Rule**: Before adding a new instruction, check whether it can be expressed by tightening an existing one. State LLM's `rulesStatic` is an example — it accumulated 12+ rules over iterations, many of which are information-theoretically redundant.

---

## 5. Design Principles

### 5.1 Field names are self-documenting

An LLM seeing `gender_age` does not know it includes physique. An LLM seeing `性别与年龄 (gender_age)` immediately understands the scope.

**Rule**: Use translated labels with the raw key in parentheses. The raw key is needed for JSON output; the label is needed for semantic understanding.

### 5.2 Clarify the LLM's role boundaries

If the LLM is expected to (a) extract structured info from World Book, (b) infer current state from dialogue, and (c) output JSON — it needs clear role separation signals in the prompt.

**Rule**: Use explicit section headers that denote role transitions: `## Field Rules` vs `## New Characters (MUST fill)`. The former sets general policy; the latter triggers action.

---

## 6. NE Memory Specific Principles

### 6.1 Conditional branch self-check (8 combinations)

**Applies to**: `buildStatePrompt_Preset` (2×2×2 = 8 conditional branches)

Every modification must verify ALL branches produce self-consistent prompts:

| Variable | Branches |
|----------|----------|
| `newNames.length` | > 0 / === 0 |
| `worldBookText` | present / absent |
| `lang` | 'en' / 'zh' |

**Check**: three-layer structure intact? final instruction consistent? examples don't contradict rules?

### 6.2 Multi-message semantic self-containment

**Applies to**: All prompts where `system` is an array `[msg1, msg2]` (KV-Cache optimization)

If system messages are split for KV-Cache prefix sharing:
- msg2's instructions MUST NOT reference data sources in msg1
- "从上方角色卡中提取" when charCard is in msg1 → broken
- Fix: move the referenced data source into the same message as the instruction

**Check**: Read msg2 text. If it contains "上方""上述""如前所述" → trace the reference chain to msg1 and verify it's complete.

### 6.3 Cross-pipeline consistency

**Applies to**: STM extraction → State LLM → Retrieval LLM (three pipelines)

Rules about the same entity across different pipeline prompts must be consistent or explicitly delegated:
- State LLM: manages `affection` / `current_mood` / `inner_thoughts`
- Retrieval LLM: no inference of motives/emotions, no commentary
- STM extraction: facts only

If a change affects one pipeline's treatment of an entity, check the other two for competing instructions.

### 6.4 Know your architecture — don't fight it with prompts

NE Memory has a dual-memory architecture. Event memory (STM/LTM) is append-only and should faithfully record what happened. Factual memory (State) naturally retains only the latest value — old values are updated in place.

**Rule**: Before adding a prompt instruction to handle staleness, deduplication, or contradiction resolution, first check whether the architecture already handles it. Adding instructions that duplicate architectural guarantees creates unnecessary prompt weight and potential signal conflicts.

**Example**: "删除已被推翻的信息" belongs in a rolling-summary system, not in NE Memory. The State bar handles staleness natively; STM records the act of something being overturned as a fact in itself.

---

## 7. Verification Principles

### 7.1 Human-read the full prompt

After any prompt change, print and read the complete concatenated system prompt with human eyes. If a human finds it logically consistent and unambiguous, the LLM has a chance.

### 7.2 Test all conditional branches

Verify every combination of conditional variables. See section 6.1 for the standard 8-combination matrix.

### 7.3 Check for signal conflicts between system and user messages

The `system` and `user` fields in the final `{ role, content }` object are processed together. Verify the full `{system, user}` pair.

### 7.4 Verify via test trace

After any prompt change, run a smoke test and inspect the trace file. The trace captures the full assembled system prompt for every pipeline call. Read it with human eyes.

```javascript
await __ne_debug.runTestByName('smartpush-14')
```

---

## Summary: The Golden Rule

> If a human reader can find a contradiction in the concatenated prompt, the LLM will exploit it. If a human has to scroll 4000 tokens to understand a field name, the LLM has already forgotten the connection. Design prompts for a **single-pass** reader.
```

---

## 六、变更清单

| # | 变更项 | 位置 | 类型 |
|---|--------|------|------|
| 1 | 新增原则 1.3：三层结构 | Section 1 | 通用 |
| 2 | 新增原则 2.3：具体短语禁止 | Section 2 | 通用 |
| 3 | 新增原则 2.4：禁止评论性语言 | Section 2 | 通用 |
| 4 | 新增原则 3.1：空路径显式建模 | Section 3 | 通用 |
| 5 | 新增原则 3.2：增量更新显式化（明确不含"删除被推翻信息"——架构已处理） | Section 3 | 通用 |
| 6 | 新增原则 4.3：指令冗余比缺失更危险 | Section 4 | 通用 |
| 7 | 新增原则 6.1：条件分支自检 | Section 6 | 专项 |
| 8 | 新增原则 6.2：多消息语义自包含 | Section 6 | 专项 |
| 9 | 新增原则 6.3：跨管线一致性 | Section 6 | 专项 |
| 10 | 新增原则 6.4：了解你的架构——不要用提示词对抗它 | Section 6 | 专项 |
| 11 | 更新原则 4.2 检查清单：新增 2 项（三层检查 + 跨消息引用） | Section 4 | 通用+专项 |
| 12 | 新增原则 7.4：通过 test trace 验证 | Section 7 | 专项 |
