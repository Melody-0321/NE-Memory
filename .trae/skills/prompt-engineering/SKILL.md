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

This is distinct from banning factual inferences (see CRITICAL FACT CONSTRAINT in retrieval prompts). Commentary is when the LLM evaluates the significance of facts rather than just stating them. Phrases like `"由此可见"`, `"这表明"`, `"标志着"` should be in the prohibition list alongside `"感情升温"`.

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
