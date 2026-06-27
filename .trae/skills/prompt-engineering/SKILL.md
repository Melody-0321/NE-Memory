---
name: "prompt-engineering"
description: "LLM prompt design and modification principles. Invoke when writing, refactoring, or modifying any LLM system prompt — especially when the prompt involves multiple concatenated sections, conditional branches, or mixed signals (examples, negative instructions, field descriptions)."
---

# Prompt Engineering Principles

This skill enforces a set of principles for writing and modifying LLM system prompts in this project. It is based on patterns of failure observed across multiple iterations of the State LLM prompt in `src/core/engine/update.js`.

---

## 1. Structure Principles

### 1.1 The last line governs behavior

LLMs anchor to the signal that appears **last** in the system prompt. The most important output instruction must be the final section. The relative ordering of examples, negative instructions, and positive instructions is not optional — it is a core design decision.

**Rule**: Put the most behaviorally critical instruction (what the LLM should output) as the last section in the system prompt.

**Anti-pattern**: Writing "You MUST output X" in section 2, then showing `{"state_changes":{}}` as the "zero-change example" in section 5 (the last section). The LLM will anchor to the example, not the rule.

### 1.2 Meaning must co-occur with the token it describes

If a field name appears at position N in the prompt and its semantic description appears at position N+4000 tokens, the LLM has effectively lost the connection. Field names and their descriptions must appear together (inline).

**Rule**: Inline field descriptions alongside their keys. Use format: `语义翻译 (field_key): value` instead of `field_key: value` with a separate glossary 4000 tokens later.

**Anti-pattern**: A table of 15 fields with bare English keys, followed 4000 tokens later by a "Field Reference" section that explains what each key means.

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

If `clothing_build` is described in three different places (injection table, field reference, user message), the descriptions will inevitably diverge. The LLM receives mixed signals.

**Rule**: Define each field's semantics in exactly one place. If a field appears in multiple contexts (table + rules), the table carries the label and the rules reference it — never re-describe.

---

## 3. Modification Principles

### 3.1 No local modifications — always expand the full prompt first

Changing one line of `rulesZh` without reading the entire string concatenation that produces the final system prompt will inevitably introduce new signal conflicts.

**Rule**: Before any prompt modification, build and read the complete final prompt output. Check all conditional branches (`newNames.length > 0`, `lang === 'en'`, etc.). Only then decide what to change.

**Checklist before any prompt change**:
1. Print the full system prompt for the target scenario (new characters present, World Book present, Chinese)
2. Print for the opposite scenario (no new characters, English)
3. Check: any "must" vs "may" conflict? any example contradicting an instruction? any field described twice with different wording?

### 3.2 Use signal conflict detection checklist

After every change, scan:

| Check | What to look for |
|---|---|
| Must/May conflict | "You must output X" + "If nothing changed, output `{}`" |
| Example contradiction | A positive example that contradicts a negative rule (or vice versa) |
| Empty vs. filled state | Instructions assuming empty fields vs. instructions assuming filled fields |
| Source ambiguity | "From World Book" + "From Character Card" + "From dialogue" all pointing to the same field |
| Last-line anchor | The final sentence of system prompt — does it match the desired behavior? |

---

## 4. Design Principles

### 4.1 Field names are self-documenting

An LLM seeing `gender_age` does not know it includes physique. An LLM seeing `性别与年龄 (gender_age)` immediately understands the scope. Never assume cross-paragraph semantic understanding.

**Rule**: In all table/list displays of field names, use translated labels with the raw key in parentheses. The raw key is needed for JSON output; the label is needed for semantic understanding.

### 4.2 Clarify the LLM's role boundaries

If the LLM is expected to (a) extract structured info from World Book, (b) infer current state from dialogue, and (c) output JSON — it needs clear role separation signals in the prompt.

**Rule**: Use explicit section headers that denote role transitions: `## Field Rules` vs `## New Characters (MUST fill)`. The former sets general policy; the latter triggers action.

---

## 5. Verification Principles

### 5.1 Human-read the full prompt

After any prompt change, print and read the complete concatenated system prompt with human eyes. If a human finds it logically consistent and unambiguous, the LLM has a chance. If a human finds a contradiction, the LLM will certainly find it too.

### 5.2 Test all conditional branches

Every prompt in this project has at minimum these branches:

| Branch | Condition | What changes |
|---|---|---|
| New characters present | `newNames.length > 0` | newCharHint block appears; zero-change example disappears |
| No new characters | `newNames.length === 0` | newCharHint absent; zero-change example present |
| World Book present | `worldBookText` non-empty | World Book section injected |
| World Book absent | `worldBookText` empty | World Book section absent |
| Chinese | `lang === 'zh'` | rulesZh + newCharHintZh |
| English | `lang === 'en'` | rulesEn + newCharHintEn |

Verify all 2×2×2 = 8 combinations. Each produces a different signal arrangement in the final prompt.

### 5.3 Check for signal conflicts between system and user messages

The `system` and `user` fields in the final `{ role, content }` object are processed together. A correct example in `system` + a conflicting instruction in `user` = conflict. Verify the full `{system, user}` pair.

---

## Summary: The Golden Rule

> If a human reader can find a contradiction in the concatenated prompt, the LLM will exploit it. If a human has to scroll 4000 tokens to understand a field name, the LLM has already forgotten the connection. Design prompts for a **single-pass** reader.
