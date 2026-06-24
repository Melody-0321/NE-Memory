# State Schema 预分配重构 —— 从"按需创建"到"结构预置 + LLM填值"

## 摘要

将 state 系统从"LLM 按需创建字段"改为"代码预分配全部字段模板，LLM 只填值"。同时在代码层处理新角色出现时的自动模板创建（不用 tool/function calling）。

---

## 一、当前问题

### 1.1 Schema 不完整

`DEFAULT_GLOBAL_SCHEMA`（[schema.js:L84-L182](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js#L84-L182)）包含：
```
✅ scene, time, story_date, main_event, present_characters
❌ characters — 完全缺失
❌ factions — disabled: true（从不初始化）
❌ quests — disabled: true（从不初始化）
```

`DEFAULT_CHARACTER_SCHEMA`（[schema.js:L204-L244](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js#L204-L244)）定义了完整的 protagonist/npc 模板，但**没有被任何初始化逻辑消费**。

### 1.2 初始化不覆盖角色

`ensureStateStructure`（[update.js:L86-L136](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L86-L136)）：
- 预分配 `CORE_STATE_FIELDS`（scene/time/date/event/present）→ ✅
- 扩展字段从 schema 提取 → `initStateFromSchema` 递归展开 ✅
- 但 schema 中没有 `characters` → **characters 从不预分配** ❌

### 1.3 LLM 自由度过高

当前 prompt 中的角色字段说明（[update.js:L243-L275](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L243-L275)）是"百科全书式"列举所有可能字段，LLM 被要求自己判断哪些字段该输出。这导致：
- LLM 可能创造不存在的字段名
- LLM 可能忘记初始化某些字段
- LLM 在不同轮次对同一角色的字段输出不一致

---

## 二、目标

| 当前 | 目标 |
|------|------|
| LLM 决定创建哪些角色字段 | 代码预分配所有角色字段模板，LLM 只填值 |
| LLM 决定何时创建新角色 | 代码检测新角色名 → 自动套用模板 |
| `factions`/`quests` 默认关闭 | 默认开启，预分配空结构 |
| Characters 不在 schema 中 | Characters 纳入 schema |
| Prompt 百科全书式字段说明 | 精简的"待填字段表" |

---

## 三、改动方案

### 3.1 DEFAULT_GLOBAL_SCHEMA 扩展（schema.js）

在 `DEFAULT_GLOBAL_SCHEMA.fields` 中新增 `characters` 条目：

```javascript
characters: {
    type: 'object',
    schema: {
        type: 'object',
        fields: {
            '*': DEFAULT_CHARACTER_SCHEMA.npc  // 引用现有模板
        }
    }
}
```

同时将 `factions` 和 `quests` 的 `enabled: false` 改为 `enabled: true`。

### 3.2 `initStateFromSchema` 支持 `*` wildcard 预分配（update.js）

当前 `initStateFromSchema`（[update.js:L141-L157](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L141-L157)）：

```javascript
// 当前逻辑
if (key === '*' || !field) return;  // ← 跳过 wildcard
```

问题：`*` wildcard 代表"此对象下的任意键应该套用此模板"，但初始化时 wildcard 无法展开——因为不知道有哪些具体键。

**修改方案**：`initStateFromSchema` 增加一个可选参数 `knownKeys`（已知角色名列表）。当遇到 `*` 且 `knownKeys` 非空时，为每个已知键复制模板字段。

```javascript
if (key === '*') {
    if (knownKeys && knownKeys.length > 0 && field.fields) {
        state[key] = {};
        knownKeys.forEach(function (name) {
            state[key][name] = {};
            Object.keys(field.fields).forEach(function (fk) {
                if (fk !== '*') state[key][name][fk] = '';
            });
        });
    }
    return;
}
```

### 3.3 `ensureStateStructure` 传入已知角色名（update.js）

`ensureStateStructure` 在初始化 characters 时，需要已知角色名列表。来源：

1. **角色卡主角名**：从 `vault.content.character_name` 或运行时上下文获取
2. **动态字段发现中的角色**：从 `vault.content.dynamic_state.characters`（如果已启用）
3. **世界书中的核心角色**：预留接口（当前可暂不实现）

修改 `ensureStateStructure` 签名（或内部获取已知角色名）：

```javascript
// 获取已知角色名
var knownCharacterNames = [];
if (vault.content.character_name) {
    knownCharacterNames.push(vault.content.character_name);
}
if (vault.content.dynamic_state && vault.content.dynamic_state.characters) {
    Object.keys(vault.content.dynamic_state.characters).forEach(function (n) {
        if (knownCharacterNames.indexOf(n) === -1) knownCharacterNames.push(n);
    });
}

// 传给 initStateFromSchema
var extState = initStateFromSchema(schema, knownCharacterNames);
```

### 3.4 新角色自动模板创建（schema.js 新增函数）

当 LLM 输出 `characters.新名字.任意字段` 时，如果 `characters.新名字` 对象不存在，代码自动创建完整角色模板：

```javascript
// schema.js 新增
export function ensureCharacterTemplate(state, name) {
    if (!state.characters) state.characters = {};
    if (state.characters[name] && typeof state.characters[name] === 'object') return; // 已存在

    var template = DEFAULT_CHARACTER_SCHEMA.npc.fields;
    state.characters[name] = {};
    Object.keys(template).forEach(function (fk) {
        if (fk === '*') return;
        var field = template[fk];
        if (field.type === 'boolean') {
            state.characters[name][fk] = false;
        } else if (field.type === 'number') {
            state.characters[name][fk] = 0;
        } else {
            state.characters[name][fk] = '';
        }
    });
    console.log('[NE] Auto-created character template for: ' + name);
}
```

在 `mergeStateChanges` 中增加调用：

```javascript
// mergeStateChanges 中，在处理 path 前
var parts = path.split('.');
if (parts[0] === 'characters' && parts.length >= 2) {
    var charName = parts[1];
    ensureCharacterTemplate(newState, charName);
}
```

**这与我们讨论的方式 B+A 对应**：
- LLM 输出 `characters.露娜玛丽亚.gender_age: "19岁"` → 代码检测到 `露娜玛丽亚` 不存在 → 自动创建完整模板 → 合并 LLM 提供的值
- LLM 零感知，零额外 token
- 后续轮次中，LLM 可以继续填模板中其他字段

### 3.5 Prompt 精简 — State LLM 篇（`buildStatePrompt_Preset`/`buildStatePrompt_Dynamic`）

**当前**（~30 行 hard gate + schema 示例）：

```
Output JSON with this exact schema:
{
  "analysis": "Step-by-step reasoning... (free text, will be ignored)",
  "_checkpoints": { "time": "Evening", "scene": "Mansion Living Room", "story_date": "Day 1" },
  "state_changes": [
    {"path": "time", "value": "Evening"},
    {"path": "scene", "value": "Mansion Living Room"},
    {"path": "characters.Alice.status", "value": "活跃"},
    {"path": "characters.Alice.personality", "value": "..."}
  ]
}

Always include: _checkpoints with time/scene/story_date, state_changes for time/scene/story_date/main_event/npc_names and all character changes.
If no changes detected, set state_changes to empty array [].
```

**改为**（简化为填空题 + flat object + 只有 time/scene）：

```
Output JSON:
{
  "_checkpoints": { "time": "Evening (REQUIRED, even if unchanged)", "scene": "Mansion Living Room (REQUIRED)" },
  "state_changes": {}
}

Rules:
- _checkpoints MUST ALWAYS be present — even when nothing changed. time and scene are REQUIRED.
- state_changes: only output fields that ACTUALLY changed this round. Use dot-path keys to new values.
  e.g. {"main_event": "Arriving at the mansion", "characters.Alice.status": "活跃", "story_date": "Day 2"}
- If nothing changed, output state_changes: {}
- Character fields are pre-allocated by the system. You only need to output the field values.
  To flag a new character in the scene, just write: "characters.NewName.status": "活跃"
  The system will automatically create a full character template. No need to add name/gender_age/occupation etc.
- present_characters is auto-generated. Do NOT output it.
- power_slots is a flat JSON object of key→value pairs. Only update values — slot definitions are managed by the system.
- Never invent field names. Only use paths that match what the system has allocated.

Example (no changes):
{"_checkpoints": {"time": "傍晚", "scene": "酒馆"}, "state_changes": {}}

Example (with changes):
{"_checkpoints": {"time": "黎明", "scene": "山路"}, "state_changes": {"story_date": "Day 3", "main_event": "出发前往京城", "characters.张三.status": "非活跃", "characters.酒馆老板.status": "活跃"}}
```

**改动要点**：
- `analysis` 字段 → 移除（省 50-100 token/轮，prompt 中有 "REQUIRED" 和规则说明已足够驱动）
- `story_date` 从 `_checkpoints` 移除 → 统一走 `state_changes.story_date`
- array 格式 → flat object 格式
- 新增 "never invent field names" + "新角色只需 status:活跃"
- 零变化完整 JSON 示例

### 3.6 Prompt 精简 — STM 篇（`stateChangesEn`/`stateChangesZh`）

**当前**：236 行（L239-L375），包含完整的角色字段枚举、势力 schema、任务 schema、power_slots 详解。

**改为**（~30 行，精简为仅规则，不枚举字段）：

```javascript
const stateChangesEn = `${dynamicState ? buildDynamicStatePrompt(dynamicState, 'en') : ''}
Optionally, output a <state_changes> block with state field updates (dot-path to new values), e.g.:
<state_changes>{"scene":"Forest","time":"Dusk","main_event":"Entering the forest"}</state_changes>

State fields are pre-allocated. Just output dot-path→value pairs. Path examples:
- time, scene, story_date, main_event — world state
- characters.<Name>.<field> — e.g. characters.Alice.status / characters.Bob.current_mood
- factions.<Name>.<field> / quests.tasks.<Name>.<field> — structured data

Status rules (characters.*.status):
- Speaking or physically present → "活跃"
- Left the scene or absent from latest messages → "非活跃"
- Dead/retired → "已死亡"/"已归隐"/"已离去"
- Mention≠presence: "听说张三去了京城" → do NOT mark 张三 as 活跃
- present_characters is auto-generated — do NOT output it.

New characters: just output characters.NewName.status → the system creates the full template.
Never invent field names — use only pre-allocated paths.`;

const stateChangesZh = `${dynamicState ? buildDynamicStatePrompt(dynamicState, 'zh') : ''}
可选：输出 <state_changes> 块，包含状态字段更新（dot-path→新值），如：
<state_changes>{"scene":"森林","time":"黄昏","main_event":"进入森林"}</state_changes>

状态字段已由系统预分配。只需输出 dot-path→value 对。路径示例：
- time, scene, story_date, main_event — 世界状态
- characters.<角色名>.<字段> — 如 characters.爱丽丝.status / characters.张三.current_mood
- factions.<势力名>.<字段> / quests.tasks.<任务名>.<字段> — 结构化数据

状态规则（characters.*.status）:
- 说话或实际在场 → "活跃"
- 已离开场景或未在最新消息中出现 → "非活跃"
- 已死亡/隐退 → "已死亡"/"已归隐"/"已离去"
- 提及≠在场："听说张三去了京城" → 不标活跃
- present_characters 由系统自动生成 — 不要输出。

新角色：只需输出 characters.新名字.status → 系统自动创建完整模板。
请勿创造新字段名 — 仅使用系统已分配的路径。`;
```

**对比**：

| 维度 | 当前 | 改为 |
|------|------|------|
| EN 字数 | ~1200 | ~200 |
| ZH 字数 | ~1200 | ~200 |
| 角色字段枚举 | 15 行（含 power_slots 等） | 0 行（说明"已预分配"） |
| 势力/任务枚举 | 30 行（含完整子字段） | 1 行（路径示例） |
| 新角色指令 | "add name, gender_age..." | "系统自动创建" |
| 防创造字段 | 无 | "Never invent field names" |

### 3.7 `formatStateSummary` 精简（update.js / schema.js）

当前 `formatStateSummary` 输出完整 state 摘要（所有角色所有字段）。改为：
- 仅输出摘要级字段（`expose_level: 'summary'`）
- 消息中未出现的角色：折叠为一行的 `角色名(status)` 摘要
- 消息中出现的角色：展开所有 summary 级字段

---

## 四、改动文件清单

| 文件 | 改动 | 行数估计 |
|------|------|---------|
| [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) | `DEFAULT_GLOBAL_SCHEMA.fields.characters` 新增 + factions/quests enabled:true | +15 |
| [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) | `ensureCharacterTemplate()` 新函数 | +25 |
| [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) | `mergeStateChanges` 中调用 `ensureCharacterTemplate` | +4 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `initStateFromSchema` 支持 `*` + `knownKeys` | +12 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `ensureStateStructure` 提取 knownCharacterNames | +10 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `buildStatePrompt_Preset`/`_Dynamic` prompt 重写（State LLM 篇） | 重构 ~40行→~25行 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `stateChangesEn`/`stateChangesZh` 重写（STM 篇） | 重构 ~140行→~35行 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `parseSTMResponse` 删除 array→object 转换 | -8 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) | `formatStateSummary` 按 expose_level 筛选 | +15 |

**总计：~70 行新增/修改代码，~150 行 prompt 文本删除。**

---

## 五、迁移兼容

- **已有 vault**：当前 vault 的 `state` 对象可能已有 LLM 手动创建的 characters。`ensureCharacterTemplate` 仅在不存在的角色名时才创建模板，不会覆盖已有数据。
- **已有 state_changes 输出**：LLM 仍可按现有格式输出 `characters.名字.字段` path，`mergeStateChanges` 仍能正确合并。
- **向后兼容**：行为是**增强**而非破坏——LLM 不做新格式也能工作，prompt 精简后 LLM 负担减轻但输出兼容。

---

## 六、验证

1. **单元测试**：100 现有测试保持通过
2. **新增测试**：
   - `state char template` — 验证 `ensureCharacterTemplate` 生成完整默认值
   - `state schema characters` — 验证 `DEFAULT_GLOBAL_SCHEMA.characters` 可被 `resolveSchemaPath` 正确解析
   - `state init known chars` — 验证已知角色名在初始化时展开
3. **冒烟测试**：smartpush-14 全链路测试保持通过
4. **手动验证**：开启 state schema → 开始新对话 → 检查 vault 中 `state.characters.<主角名>` 是否预分配了所有字段
