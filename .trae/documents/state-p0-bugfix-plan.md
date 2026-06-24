# State 系统 P0 Bug 修复计划（方案C 保守型）

## 摘要

修复重构后 pipeline-state-01 测试暴露的 6 个 bug。采用**方案C（保守型）**：NPC 方案发现 LLM 在初始化时运行一次，方案一旦确定即锁定，不动态扩展。Bug B（第一轮空表）与 NPC 多方案系统（Phase 0）合并修复。

## 一、Bug 清单总览

| Bug | 严重度 | 症状 | 根因 | 涉及文件 |
|-----|--------|------|------|----------|
| A | P1 | `characters.*.affection` 暗示所有角色都有好感度 | `schemaDesc` 硬编码字段说明使用通配符 `*`，违反 PC/NPC 分离 | update.js |
| B | P0 | 第一轮 State LLM 看到空表，无法输出 state_changes | `state.characters` 初始为空，无 NPC 方案系统 | schema.js, update.js |
| C | P2 | `protagonist_name` 可能为空 | `ctx.name1` 在某些 ST 配置下为 null | events.js |
| D | P3 | 空值显示时出现双空格 | `'  ' + fk + ': ' + '' + suffix` 多余空格 | schema.js |
| E | P1 | affection 增量 +3/+5 未解析为数字 | `mergeStateChanges` 不处理 `+N`/`-N` 模式 | schema.js |
| F | P2 | 测试不验证 PC/NPC 字段分离 | 结构性断言缺失 PC 专属字段检查 | test-case.md |

## 二、方案C 核心流程

```
extractStateChangesOnly 入口
    │
    ▼
npc_schemes 已存在？
    ├── 是 → 跳过，直接进入 State LLM
    └── 否 → 运行 resolveNpcSchemes()
                  │
                  ▼
             世界书有内容？
                  ├── 是 → buildSchemeDiscoveryPrompt() → LLM 调用
                  │         ↓
                  │     输出：{ schemes: {...}, initial_characters: [...] }
                  │         ↓
                  │     写入 vault.content.npc_schemes
                  │     预填充 state.characters（从 initial_characters）
                  └── 否 → 使用 DEFAULT_NPC_SCHEME 兜底
                              ↓
                         预填充 protagonist + 默认模板
    │
    ▼
State LLM 正常执行（此时 injection table 已有角色卡片）
```

**关键特性：**
- 方案发现 LLM 只在 `npc_schemes` 不存在时执行一次
- 世界书仅作为 discovery 的输入上下文，不写入
- 方案一旦确定即锁定（`mergeStateChanges` 保护 `_scheme` 不可覆盖）
- 无世界书时自动使用 `DEFAULT_NPC_SCHEME` 兜底，对用户透明

## 三、逐 Bug 修复方案

### Bug A：删除 schemaDesc 硬编码字段说明

**文件：** `src/core/engine/update.js`

**问题：** L895-945 的 `schemaDesc` 变量使用 `characters.*.fieldname` 通配符列出所有字段，暗示所有角色（包括 PC）都有 `affection`/`relationship` 等字段，直接违反 `DEFAULT_CHARACTER_SCHEMA` 中 PC 无这些字段的设计。

**修复：**
1. 删除 `schemaDesc` 变量定义（L895-945，约 52 行）
2. 修改返回语句：`stateTable + buildWorldBookSection() + schemaDesc + rules` → `stateTable + buildWorldBookSection() + rules`

```diff
# L893-945: 删除整个 schemaDesc 变量
- var schemaDesc = lang === 'en'
-     ? '\n## Field Reference (paths available in state_changes)\n' + ...
-     : '\n## 字段说明（可在 state_changes 中修改的路径）\n' + ...;

# L975-984: 修改返回语句
- system: stateTable + buildWorldBookSection() + schemaDesc + rulesEn,
+ system: stateTable + buildWorldBookSection() + rulesEn,
- system: stateTable + buildWorldBookSection() + schemaDesc + rulesZh,
+ system: stateTable + buildWorldBookSection() + rulesZh,
```

**理由：** State LLM 已经有 `stateTable`（包含完整的字段列表、required/optional 标记、enum 提示）、`rules`（操作规则），以及 `DEFAULT_CHARACTER_SCHEMA` 的 schema 校验链。`schemaDesc` 不仅冗余，还会误导 LLM 认为所有角色共享全部字段。删除后 LLM 的字段边界完全由 injection table 中实际展示的字段决定。

---

### Bug B + Phase 0：第一轮空表修复 + NPC 方案发现

**文件：** `src/core/vault/schema.js`, `src/core/engine/update.js`

这是最核心的修复，合并两个问题：
1. **空表问题：** 第一轮 `state.characters` 为空 → `buildStateInjectionTable` 输出空表 → State LLM 看不到任何角色卡片
2. **NPC 方案缺失：** 当前所有 NPC 使用统一的 12 字段，无法按角色类型精简

#### 3.1 新增 `DEFAULT_NPC_SCHEME` 常量（schema.js）

在 `DEFAULT_CHARACTER_SCHEMA` 之后新增。自动从 `DEFAULT_CHARACTER_SCHEMA.npc` 生成兜底方案。

```javascript
// 位置：schema.js，DEFAULT_CHARACTER_SCHEMA 定义之后
export var DEFAULT_NPC_SCHEME = (function() {
    var npcFields = DEFAULT_CHARACTER_SCHEMA.npc.fields;
    var required = [];
    var optional = [];
    Object.keys(npcFields).forEach(function(k) {
        if (k === 'name' || k === 'inventory') return;
        if (npcFields[k].required) required.push(k);
        else optional.push(k);
    });
    return {
        default: {
            description: 'Default NPC scheme (all standard fields)',
            required: required,
            optional: optional
        }
    };
})();
```

#### 3.2 新增 `getNpcInjectionFields(state, name)` 函数（schema.js）

根据 NPC 的 `_scheme` 从 `npc_schemes` 中获取实际应展示的字段列表。

```javascript
// 位置：schema.js，NPC_INJECTION_FIELDS 之后
export function getNpcInjectionFields(state, name) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var schemeKey = charData._scheme || 'default';
    var npcSchemes = (state && state.npc_schemes) || DEFAULT_NPC_SCHEME;
    var scheme = npcSchemes[schemeKey];
    if (!scheme) {
        scheme = npcSchemes['default'] || DEFAULT_NPC_SCHEME.default;
    }
    var fields = [];
    (scheme.required || []).forEach(function(f) { if (fields.indexOf(f) === -1) fields.push(f); });
    (scheme.optional || []).forEach(function(f) { if (fields.indexOf(f) === -1) fields.push(f); });
    return fields;
}
```

#### 3.3 修改 `buildStateInjectionTable` — 使用 `getNpcInjectionFields`（schema.js L540）

```diff
# L540: NPC 字段获取改为动态
- var fields = isPC ? PC_INJECTION_FIELDS : NPC_INJECTION_FIELDS;
+ var fields = isPC ? PC_INJECTION_FIELDS : getNpcInjectionFields(state, item.name);
```

同时在角色列表之前注入方案摘要块（仅当有多方案时）：

```javascript
// 在 "=== Characters (Active) ===" 之前插入
if (state && state.npc_schemes && Object.keys(state.npc_schemes).length > 1) {
    parts.push('=== NPC Schemes Available ===');
    Object.keys(state.npc_schemes).forEach(function(sk) {
        var s = state.npc_schemes[sk];
        parts.push(sk + ': ' + (s.description || '') + ' (required: ' + (s.required || []).join(', ') + ')');
    });
}
```

#### 3.4 修改 `ensureCharacterTemplate` — 按方案初始化字段（schema.js L406-435）

```diff
# L412-416: 修复 null schemeKey 时的模板选择
- } else if (schemeKey === null && !isPC) {
-     template = DEFAULT_CHARACTER_SCHEMA.protagonist.fields;
+ } else if (schemeKey === null && !isPC) {
+     template = DEFAULT_CHARACTER_SCHEMA.npc.fields;
```

当 `schemeKey` 不为 null 时，从 `npc_schemes` 获取字段集而非完整 NPC schema：

```javascript
if (isPC) {
    template = DEFAULT_CHARACTER_SCHEMA.protagonist.fields;
} else if (schemeKey && state.npc_schemes && state.npc_schemes[schemeKey]) {
    // 从方案中提取字段定义
    var scheme = state.npc_schemes[schemeKey];
    var fieldNames = [];
    (scheme.required || []).forEach(function(f) { if (fieldNames.indexOf(f) === -1) fieldNames.push(f); });
    (scheme.optional || []).forEach(function(f) { if (fieldNames.indexOf(f) === -1) fieldNames.push(f); });
    template = {};
    fieldNames.forEach(function(fn) {
        if (DEFAULT_CHARACTER_SCHEMA.npc.fields[fn]) {
            template[fn] = DEFAULT_CHARACTER_SCHEMA.npc.fields[fn];
        }
    });
} else {
    template = DEFAULT_CHARACTER_SCHEMA.npc.fields;
}
```

#### 3.5 新增 `_scheme` 保护（schema.js `mergeStateChanges` L439-478）

```javascript
// 在 Object.keys(validatedChanges).forEach 的开头添加：
// 保护 _scheme：一旦设置，不可覆盖
if (path.endsWith('._scheme')) {
    var charName = parts[1];
    var existingScheme = (newState.characters && newState.characters[charName] && newState.characters[charName]._scheme) || null;
    if (existingScheme && existingScheme !== validatedChanges[path]) {
        console.warn('[NE] _scheme protected: ' + charName + ' already has _scheme=' + existingScheme + ', ignoring change to ' + validatedChanges[path]);
        return; // skip this change
    }
}
```

#### 3.6 新增方案发现函数（update.js）

**`buildSchemeDiscoveryPrompt(worldBookEntries, messages)`：**

```javascript
function buildSchemeDiscoveryPrompt(worldBookEntries, messages) {
    var wbText = '';
    if (worldBookEntries && worldBookEntries.length > 0) {
        wbText = '## World Setting\n';
        worldBookEntries.forEach(function(entry, i) {
            wbText += '[' + (i + 1) + '] ' + (entry.content || entry.key || '') + '\n';
        });
    }
    
    var msgText = '';
    if (messages && messages.length > 0) {
        msgText = '\n## Current Dialogue\n';
        messages.forEach(function(m) {
            msgText += (m.name || m.role || '') + ': ' + (m.content || '') + '\n';
        });
    }
    
    return '' +
        wbText +
        msgText +
        '\n## Task\n' +
        'Based on the world setting and dialogue above, determine:\n' +
        '1. What NPC character tracking schemes are needed (1-3 schemes)\n' +
        '2. Identify all characters mentioned (protagonist + NPCs)\n' +
        '\nAvailable field names for schemes:\n' +
        '  status, gender_age, occupation, personality, clothing_build,\n' +
        '  injuries, status_effects, past_experience, inner_thoughts,\n' +
        '  affection, relationship, current_mood\n' +
        '\nRules:\n' +
        '- Every scheme MUST include "status"\n' +
        '- "default" scheme is mandatory (catch-all)\n' +
        '- Field names MUST be from the available list\n' +
        '- required: fields always tracked; optional: tracked when relevant\n' +
        '\nOutput ONLY valid JSON:\n' +
        '{\n' +
        '  "schemes": {\n' +
        '    "default": { "description": "...", "required": [...], "optional": [...] },\n' +
        '    "scheme_name": { ... }\n' +
        '  },\n' +
        '  "initial_characters": [\n' +
        '    { "name": "角色名", "_role": "protagonist|npc", "_scheme": "scheme_name|null" }\n' +
        '  ]\n' +
        '}';
}
```

**`resolveNpcSchemes(vault, messages)`：**

```javascript
export async function resolveNpcSchemes(vault, chatId, messages) {
    if (!vault || !vault.content) return;
    
    if (vault.content.npc_schemes) return; // 已存在，跳过
    
    var worldBookContent = collectWorldBookContent(vault);
    
    if (!worldBookContent || worldBookContent.length === 0) {
        // 无世界书，使用 DEFAULT_NPC_SCHEME
        vault.content.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        
        // 预填充 protagonist
        var state = vault.content.state || {};
        if (state.protagonist_name) {
            ensureCharacterTemplate(state, state.protagonist_name);
            if (state.characters && state.characters[state.protagonist_name]) {
                state.characters[state.protagonist_name]._role = 'protagonist';
            }
        }
        vault.content.state = state;
        return;
    }
    
    var prompt = buildSchemeDiscoveryPrompt(worldBookContent, messages);
    
    try {
        var response = await callMemoryPipeline([
            { role: 'system', content: 'You are a world-building analyst. Analyze the world setting and determine NPC tracking schemes.' },
            { role: 'user', content: prompt }
        ], { operation: 'scheme_discovery' }, chatId);
        
        var parsed = safeJsonParse(String(response || '').trim());
        
        if (parsed && parsed.schemes) {
            vault.content.npc_schemes = parsed.schemes;
        } else {
            vault.content.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        }
        
        // 预填充 initial_characters
        if (parsed && parsed.initial_characters && Array.isArray(parsed.initial_characters)) {
            var state = vault.content.state || {};
            parsed.initial_characters.forEach(function(ch) {
                if (ch.name) {
                    ensureCharacterTemplate(state, ch.name, ch._role === 'npc' ? (ch._scheme || 'default') : null);
                    if (state.characters && state.characters[ch.name]) {
                        state.characters[ch.name]._role = ch._role || (ch.name === state.protagonist_name ? 'protagonist' : 'npc');
                        if (ch._scheme) state.characters[ch.name]._scheme = ch._scheme;
                    }
                }
            });
            vault.content.state = state;
        }
    } catch (e) {
        console.warn('[NE] Scheme discovery failed, using default:', e);
        vault.content.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
    }
}
```

**`collectWorldBookContent(vault)`：**

```javascript
function collectWorldBookContent(vault) {
    var entries = [];
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            var worldInfo = ctx && ctx.worldInfo;
            if (worldInfo && worldInfo.entries) {
                Object.keys(worldInfo.entries).forEach(function(uid) {
                    var entry = worldInfo.entries[uid];
                    if (entry && !entry.disable && entry.content) {
                        entries.push({ key: entry.key || '', content: entry.content });
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[NE] Failed to collect world book content:', e);
    }
    return entries;
}
```

#### 3.7 修改 `extractStateChangesOnly` — 插入方案发现步骤（update.js L1169）

```diff
# L1173-1174: ensureStateStructure 之后插入方案发现
  ensureStateStructure(vault);
+
+ // 首次初始化：运行 NPC 方案发现（仅一次）
+ if (!vault.content.npc_schemes) {
+     await resolveNpcSchemes(vault, chatId, messages);
+ }
```

#### 3.8 修改 `buildStatePrompt_Preset` — rules 增加方案分配规则（update.js L947+）

在 `rulesEn`/`rulesZh` 中增加 NPC 方案分配规则：

```
## NPC Scheme Assignment
- NPCs already have a _scheme field — do NOT change it
- New NPCs without _scheme: infer the appropriate scheme from the NPC's traits
  (see "NPC Schemes Available" above for options)
- To assign a scheme to a new NPC, include `characters.<name>._scheme` in state_changes
- Use "default" scheme if unsure
```

---

### Bug C：protagonist_name 空值兜底

**文件：** `src/adapter/events.js` L666-669

**问题：** `ctx.name1` 在某些 ST 配置下为 null/undefined，导致 `protagonist_name` 未被写入。

**修复：** 增加 fallback 链：`ctx.name1` → `vault.content.state.protagonist_name` 已有值保持不变 → 不写 null

```diff
# L666-669
  var protagonistName = (ctx && ctx.name1) || null;
- if (protagonistName && vault.content.state) {
+ if (vault.content.state) {
+     var currentName = vault.content.state.protagonist_name || '';
+     if (protagonistName && protagonistName !== currentName) {
          vault.content.state.protagonist_name = protagonistName;
+     } else if (!currentName && !protagonistName) {
+         console.warn('[NE] protagonist_name not set: ctx.name1 is null');
+     }
  }
```

**理由：** 如果 `state.protagonist_name` 已有值且 ctx.name1 为 null，保持已有值不变（而非覆盖为 null）。只在首次发现有效 name1 时写入。如果两者都为空，记录 warning 但不崩溃。

---

### Bug D：空值双空格

**文件：** `src/core/vault/schema.js` L563

**问题：** `'  ' + fk + ': ' + valStr + suffix` — 当 `valStr` 为空字符串时，`: ` 后没有内容紧接着 `suffix`，看起来像双空格（实际上是 `: ` + 空 + suffix 的自然结果，但从 LLM 视角可能引起困惑）。

**修复：** 空值时显示 `(empty)` 占位符，确保格式一致：

```diff
# L553-563
  var fv = item.card[fk] !== undefined ? item.card[fk] : '';
- var valStr = String(fv);
+ var valStr = (fv === undefined || fv === null || fv === '') ? '(empty)' : String(fv);
  var isEmpty = (fv === undefined || fv === '' || (fk === 'affection' && Number(fv) === 0));
  ...
  parts.push('  ' + fk + ': ' + valStr + suffix);
```

---

### Bug E：affection 增量解析

**文件：** `src/core/vault/schema.js` `mergeStateChanges` L439-478

**问题：** 当 State LLM 输出 `"characters.艾莉丝.affection": "+5"` 时，`validateField` 尝试 `Number("+5")`→5（成功），但因为 `mergeStateChanges` 直接覆盖写入，而非增量叠加。当前表现为：如果 `affection` 已有值 30，LLM 输出 `"+5"`，结果变成 5（覆盖）而非 35（增量）。

**修复：** 在 `mergeStateChanges` 中检测 `+N`/`-N` 模式并叠加到现有值：

```javascript
// 在 mergeStateChanges 的 forEach 循环中，current[lastKey] 赋值之前：
// 位置：L468-469 之间
var isIncrement = false;
if (lastKey === 'affection' && typeof validatedChanges[path] === 'string') {
    var strVal = validatedChanges[path].trim();
    var incMatch = strVal.match(/^([+-])\s*(\d+)$/);
    if (incMatch) {
        var sign = incMatch[1] === '+' ? 1 : -1;
        var delta = parseInt(incMatch[2], 10);
        var currentAffection = Number(current[lastKey]) || 0;
        validatedChanges[path] = Math.max(0, Math.min(100, currentAffection + sign * delta));
        isIncrement = true;
    }
}

current[lastKey] = validatedChanges[path];
```

**注意：** 增量模式的解析必须在 `validateField` 之后做——因为 `validateField` 会把 string 转 number，`"+5"` 在 `validateField` 中已经变成数字 5，丢失了增量语义。因此需要在 `validateStateChanges` 阶段保留原始字符串，或改用新的检测位置。

**修正方案：** 在 `mergeStateChanges` 中直接处理原始 `validatedChanges`，但 `validateField` 已经在前面把 `"+5"` 转成了 `5`。需要在 `validateField` 中保留增量语义：

```javascript
// schema.js validateField 函数 L294-330
// 在 number 类型处理中添加增量检测：
} else if (type === 'number') {
    if (typeof value !== 'number') {
        var strVal = String(value).trim();
        var incMatch = strVal.match(/^([+-])\s*(\d+)$/);
        if (incMatch) {
            // 保留原始字符串给 mergeStateChanges 处理
            return { ok: true, value: value, _increment: true };
        }
        var n = Number(value);
        if (isNaN(n)) return { ok: false, value: value, error: 'Expected number, got: ' + typeof value };
        value = n;
    }
```

然后在 `mergeStateChanges` 中检查 `validatedChanges[path]` 的 `_increment` 标记：

```javascript
// mergeStateChanges 中 L459-469 之间：
if (lastKey === 'affection' && typeof validatedChanges[path] === 'object' && validatedChanges[path]._increment) {
    var incStr = String(validatedChanges[path].value || '').trim();
    var incMatch = incStr.match(/^([+-])\s*(\d+)$/);
    if (incMatch) {
        var sign = incMatch[1] === '+' ? 1 : -1;
        var delta = parseInt(incMatch[2], 10);
        var currentAffection = Number(current[lastKey]) || 0;
        current[lastKey] = Math.max(0, Math.min(100, currentAffection + sign * delta));
        hasChanges = true;
        return; // 跳过正常的 current[lastKey] = validatedChanges[path]
    }
}
```

**更简洁的方案：** 直接在 `mergeStateChanges` 中检查原始 `validatedChanges` 的 key，在 validation 之前保留原始值。但考虑到 architecture，最干净的方案是新增一个增量处理函数：

```javascript
// schema.js 新增
function resolveAffectionValue(currentValue, newValue) {
    if (typeof newValue === 'string') {
        var match = String(newValue).trim().match(/^([+-])\s*(\d+)$/);
        if (match) {
            var sign = match[1] === '+' ? 1 : -1;
            var delta = parseInt(match[2], 10);
            return Math.max(0, Math.min(100, (Number(currentValue) || 0) + sign * delta));
        }
    }
    return Number(newValue) || 0;
}
```

在 `mergeStateChanges` 中：

```javascript
if (lastKey === 'affection') {
    current[lastKey] = resolveAffectionValue(current[lastKey], validatedChanges[path]);
} else {
    current[lastKey] = validatedChanges[path];
}
```

---

### Bug F：测试缺失 PC/NPC 分离断言

**文件：** `test-cases/pipeline/pipeline-state-01/test-case.md`

**问题：** 当前结构性断言只检查 pipeline_changes 存在性和无报错，不验证 PC/NPC 字段分离的核心设计目标。

**修复：** 在 `structural` 区块增加断言：

```yaml
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: stm_events }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
  # 新增 PC/NPC 字段分离断言
  - { op: field_not_exists, target: "pipeline_changes.*.protagonist*.affection", desc: "PC must NOT have affection field" }
  - { op: field_not_exists, target: "pipeline_changes.*.protagonist*.relationship", desc: "PC must NOT have relationship field" }
  - { op: field_not_exists, target: "pipeline_changes.*.protagonist*.inner_thoughts", desc: "PC must NOT have inner_thoughts field" }
  - { op: field_not_exists, target: "pipeline_changes.*.protagonist*.current_mood", desc: "PC must NOT have current_mood field" }
```

**注意：** 具体断言语法取决于测试框架的 checker 能力。如果 `field_not_exists` 操作符不可用，至少更新语义性断言部分：

```yaml
semantic:
  - "State 管线是否提取了对话中出现的角色的状态变化？"
  - "主角（PC）的状态变更中是否不包含 affection/relationship/inner_thoughts/current_mood 等 NPC 专属字段？"
  - "NPC 的状态变更中是否正确包含了 affection/relationship/current_mood 等 NPC 专属字段？"
  - "state_changes 的 value 是否与对话中实际发生的情况一致？"
```

---

## 四、执行顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | Bug B+Phase 0：schema.js 新增 `DEFAULT_NPC_SCHEME`、`getNpcInjectionFields` | 无 |
| 2 | Bug B+Phase 0：schema.js 修改 `buildStateInjectionTable`、`ensureCharacterTemplate`、`mergeStateChanges` | 步骤 1 |
| 3 | Bug B+Phase 0：update.js 新增 `resolveNpcSchemes`、`buildSchemeDiscoveryPrompt`、`collectWorldBookContent` | 无 |
| 4 | Bug B+Phase 0：update.js 修改 `extractStateChangesOnly`、`buildStatePrompt_Preset` | 步骤 3 |
| 5 | Bug A：删除 `schemaDesc`、修改返回语句 | 无 |
| 6 | Bug C：events.js protagonist_name fallback | 无 |
| 7 | Bug D：schema.js 空值显示修复 | 无 |
| 8 | Bug E：schema.js affection 增量解析 | 无 |
| 9 | Bug F：测试用例断言更新 | 步骤 1-8 |
| 10 | `npm run build` 验证 | 步骤 1-9 |

步骤 1-8 之间无代码依赖，可任意顺序执行。步骤 9 在所有代码修改之后。步骤 10 在全部完成后。

## 五、验证标准

1. `npm run build` 零错误通过
2. State pipeline 第一轮不再出现空表（Bug B）
3. PC 角色卡片的 injection table 不包含 affection/relationship/inner_thoughts/current_mood（Bug A）
4. protagonist_name 在所有 ST 配置下不为 null（Bug C）
5. 空值显示格式统一，无双空格（Bug D）
6. affection 增量 `+N`/`-N` 正确叠加到现有值（Bug E）
7. 测试用例断言覆盖 PC/NPC 分离（Bug F）
8. 世界书驱动的 NPC 方案发现正常执行（有世界书时 LLM 调用，无世界书时 DEFAULT 兜底）
9. `_scheme` 一旦设置不可被 LLM 覆盖
