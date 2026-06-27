# State LLM Prompt 整体重构方案

## 目标

State LLM 在角色首次出场时，**始终**从 World Book 中提取 `gender_age`、`occupation`、`personality`、`clothing_build` 四个字段并填充。

## 根因

1. **裸英文字段名对中文 LLM 不透明**：LLM 看到 `gender_age: (empty)`，不理解这字段管性别+年龄+体型，1000+ token 后才读到说明。
2. **World Book 13000 字直灌无提取指引**：LLM 不知道要从中找什么。
3. **字段描述在 4000+ token 后才出现**：Current State 表格最先看到，但含义在 rulesZh 最后。
4. **"必须输出"指令与"零变化示例"信号冲突**：newCharHintZh 在前面说"必须输出"，rulesZh 在后面说 `{"state_changes":{}}`，LLM 锚定到最后的示例。
5. **英文版零变化示例始终出现**：中文版已有条件抑制（`newNames.length===0` 时才输出），英文版缺失此逻辑。

## 改动方案

### 改动 1：`buildStateInjectionTable` — 用 i18n 标签替代裸字段名

**文件**：`src/core/vault/schema.js` (L652-L664)

**当前**（State LLM 看到的表格行）：
```
  gender_age: (empty) (未填)
  occupation: (empty) (未填)
  personality: (empty) (未填)
  clothing_build: (empty) (未填)
```

**改为**（用 `t_field(fk)` 翻译标签 + 裸字段名作为 key）：
```
  性别与年龄 (gender_age): (未填)        ← 静态字段，从世界书提取
  职业 (occupation): (未填)               ← 静态字段，从世界书提取
  性格 (personality): (未填)              ← 静态字段，从世界书提取
  穿着 (clothing_build): (未填)          ← 快照字段，对话优先，世界书推断一套
```

**实现**：在 `buildStateInjectionTable` 中，`parts.push('  ' + fk + ': ' + valStr + suffix)` 改为 `parts.push('  ' + t_field(fk) + ' (' + fk + '): ' + valStr + suffix)`。

同时，对 `(未填)` 标记的必填字段，追加字段用途提示：
- 当 `requiredSet[fk] && isEmpty` 且 `fk` 在 `STATIC_FIELD_HINTS` 中时，suffix 追加提示。

**为什么不是只输出翻译不输出字段名**：因为 LLM 输出的 JSON 中必须写 `gender_age`（裸字段名是 schema key），所以要在表中同时展示翻译标签和裸字段名。

### 改动 2：`buildStatePrompt_Preset` — 调整 prompt 段顺序

**文件**：`src/core/engine/update.js` (L983-L1088)

**当前顺序**：
```
stateTable → CharacterCards → worldBook → newCharHint → rules(含零变化示例)
```

**改为**：
```
stateTable(含字段翻译) → CharacterCards → worldBook → rulesZh(精简版，不含零变化示例) → newCharHint(放最后，含正确示例)
```

**关键变化**：
- `newCharHint` 移到 `rulesZh` 之后，成为 system prompt 的**最后一段** → LLM 最后看到的是"必须输出 state_changes 包含这些字段"而不是 `{}`。
- `rulesZh` 大幅精简：删除「字段参考」段（因为字段用途已经在注入表中内联），只保留字段管理列表 + 禁止项 + 零变化示例（仅无新角色时）。

### 改动 3：`rulesZh` / `rulesEn` 精简

**当前**：~30行，含「字段参考」和「字段规则」两段。

**改为**：~15行，只含：
```
## 字段规则
- 你管理: gender_age, occupation, personality, clothing_build, status, injuries, status_effects, relationship, past_experience。
- 不要管理: affection, current_mood, inner_thoughts。
- 字段已有具体值 → 仅变化时输出。输出路径用上方表格中括号内的字段名（如 gender_age）。
- status: 活跃/非活跃/已死亡/已归隐/已离去。
- 已有 _scheme 的 NPC 不修改，新 NPC 从上方「NPC Schemes Available」中分配。

零变化示例: {"state_changes":{}}
```
（零变化示例仅在 `newNames.length === 0` 时输出）

### 改动 4：`newCharHintZh` / `newCharHintEn` — 移到 rules 之后，加强

**改为**（在 rules 之后，system prompt 最后一段）：
```
## 新角色（必须填充）
以下角色首次出场，字段为空：江岚、安然。
你必须输出 state_changes.characters.<name> 包含：
- 性别与年龄 (gender_age)：从上方 World Book 的角色外貌描述中提取性别/年龄/体型
- 职业 (occupation)：从上方 World Book 中提取职业/身份
- 性格 (personality)：从上方 World Book 中提取 2-4 个性格特质
- 穿着 (clothing_build)：根据当前场景从 World Book 穿着设定中推断一套最匹配的穿着

正确示例：
{"state_changes":{"characters":{"安然":{"gender_age":"女,26岁,假小子风格","occupation":"网络小说作者","personality":"自信、毒舌","clothing_build":"运动背心、短款运动裤"}}}}
```

**关键**：用**正确示例**替代"禁止 `{}`"的负面指令 + 明确告诉 LLM 从 World Book 的具体位置找（外貌描述→gender_age，穿着设定→clothing_build）。

### 改动 5：`buildWorldBookSection` — 加提取引导句

**文件**：`src/core/engine/update.js` (L972-L981)

**当前**：
```
## World Book — new character profiles
[WB] （13000 字直灌）
```

**改为**：
```
## World Book — new character profiles
（上方是世界书原文。请重点关注：角色外貌描述 → 用于 gender_age、角色身份 → 用于 occupation、性格描述 → 用于 personality、穿着设定 → 用于 clothing_build）

[WB] （13000 字直灌）
```

### 改动 6：英文版零变化示例条件化

**文件**：`src/core/engine/update.js` (L1012-L1017)

英文版 `rulesEn` 中 `Zero-change example: {"state_changes":{}}` 改为与中文版一致的条件输出：`(newNames.length > 0 ? '' : '\nZero-change example: {"state_changes":{}}\n\n')`。

### 最终 prompt 结构（有新角色时）

```
=== Current State ===
[World]
time: 21:35
scene: 阳台
story_date: 第1天
main_event: ...

=== Characters (Active) ===
[PC] [江岚]
  性别与年龄 (gender_age): (未填)        ← 静态字段，从世界书提取
  职业 (occupation): (未填)               ← 静态字段，从世界书提取
  性格 (personality): (未填)              ← 静态字段，从世界书提取
  穿着 (clothing_build): (未填)          ← 快照字段，对话优先，世界书推断
  status: 活跃 (enum: 活跃/非活跃/已死亡/已归隐/已离去)
  ...

[NPC] [安然]
  性别与年龄 (gender_age): (未填)
  职业 (occupation): (未填)
  好感度 (affection): (未填) (0-100)
  关系 (relationship): (未填)
  ...

=== Factions ===
...

=== Quests ===
...

## Character Cards
（通常为空）

## World Book — new character profiles
（上方是世界书原文。请重点关注：角色外貌描述 → 用于 gender_age...）

[WB] （13000 字世界书）

## 字段规则
- 你管理: gender_age, occupation, personality, clothing_build...
- 不要管理: affection, current_mood, inner_thoughts...
- 字段已有具体值 → 仅变化时输出。
- status: 活跃/非活跃/已死亡/已归隐/已离去。
- 已有 _scheme 的 NPC 不修改。

## 新角色（必须填充）
以下角色首次出场，字段为空：江岚、安然。
你必须输出 state_changes.characters.<name> 包含：
- 性别与年龄 (gender_age)：从上方 World Book 的角色外貌描述中提取
- 职业 (occupation)：从上方 World Book 中提取
- 性格 (personality)：从上方 World Book 中提取 2-4 个性格特质
- 穿着 (clothing_build)：根据当前场景从 World Book 穿着设定中推断

正确示例：
{"state_changes":{"characters":{"安然":{"gender_age":"女,26岁,假小子风格","occupation":"网络小说作者","personality":"自信、毒舌","clothing_build":"运动背心、短款运动裤"}}}}
```

## 不变的部分

- `findNewCharacterNames` 逻辑不变
- `_fetchWorldBookText` 不变
- `mergeStateChanges` / `validateStateChanges` 不变
- `ensureCharacterTemplate` 不变

## 验证步骤

1. 刷新页面，开启新对话，让角色首次出场
2. 检查 State LLM 日志 `[NE-DEBUG] buildStatePrompt_Preset` 中的 prompt 结构是否符合上述顺序
3. 检查角色卡面板中 gender_age、occupation、personality、clothing_build 是否被正确填充
4. 检查值是否来源于世界书（而非凭空编造）
5. 第二轮对话（字段已填）确认 State LLM 不再覆盖已有值
