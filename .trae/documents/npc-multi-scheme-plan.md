# NPC 多方案系统 — 独立实施计划

## 摘要

让 State 系统支持多套 NPC 追踪方案：LLM 在初始化时读取世界书、理解世界观、决定 1-3 套 NPC 方案（如 humanoid_npc / monster_npc / default），方案锁定后贯穿全程不变。每个 NPC 角色在首次出现时被分配到其中一套方案，按该方案的字段集展示和追踪。PC 不受影响（始终使用固定 protagonist 字段集）。

## 一、现状确认

当前是**单方案**：

| 组件 | 状态 |
|------|------|
| `ensureCharacterTemplate(state, name, schemeKey)` | ✅ 已预留参数，`_scheme` 可写入 |
| `NPC_INJECTION_FIELDS` (12 字段) | ✅ 所有 NPC 统一使用 |
| `npc_schemes` 在 vault | ❌ 不存在 |
| `resolveNpcSchemes()` | ❌ 不存在 |
| `buildSchemeDiscoveryPrompt()` | ❌ 不存在 |
| `buildStateInjectionTable` 按方案选择字段 | ❌ 未实现——始终用 `NPC_INJECTION_FIELDS` |

## 二、目标架构

### 2.1 方案数据结构

```json
// vault.content.npc_schemes — 由 LLM 生成（或兜底）
{
  "default": {
    "description": "兜底方案，用于无法归类的 NPC",
    "required": ["gender_age", "occupation", "status"],
    "optional": ["personality"]
  },
  "humanoid_npc": {
    "description": "人类/精灵/矮人等类人 NPC",
    "required": ["gender_age", "occupation", "personality", "affection", "relationship", "current_mood"],
    "optional": ["inner_thoughts", "clothing_build", "past_experience"]
  },
  "monster_npc": {
    "description": "怪物/野兽/龙等非人 NPC",
    "required": ["species", "threat_level", "status"],
    "optional": ["weakness", "territory", "behavior"]
  }
}
```

**方案名（key）规则**：
- 英文标识符：`snake_case`，如 `humanoid_npc`、`monster_npc`
- 必须有一个 `"default"` 方案（兜底）
- 可选 1-2 个额外方案，最多 3 个

**字段名规则**：
- 所有方案中的字段名必须是 `DEFAULT_CHARACTER_SCHEMA.npc` 中已定义的字段名
- LLM 不能凭空造字段名（这保证了 `ensureCharacterTemplate` 能正确初始化）
- `status` 字段必须出现在每个方案中

### 2.2 角色携带方案引用

```json
// state.characters.<name>
{
  "江岚":   { "_scheme": null, "gender_age": "25岁女性", ... },       // PC
  "艾莉丝": { "_scheme": "humanoid_npc", "gender_age": "18岁", ... },  // NPC
  "哥布林": { "_scheme": "monster_npc", "species": "哥布林", ... }     // NPC
}
```

- PC：`_scheme` = null 或缺失 → `buildStateInjectionTable` 使用 `PC_INJECTION_FIELDS`
- NPC：`_scheme` = 方案名 → 使用对应方案的字段集
- NPC 首次出现时 `_scheme` 为 null → fallback 到 `"default"`

### 2.3 LLM 方案发现流程

```
初始化时（vault version === 0 且 State Schema 开启）
    │
    ▼
Step A: vault.content.npc_schemes 已存在？
    ├── 是 → 跳过，直接使用
    └── 否 → 继续
    │
    ▼
Step B: world book 为空？
    ├── 是 → 使用 DEFAULT_NPC_SCHEME（单方案兜底）
    │      存入 vault.content.npc_schemes = { "default": {...} }
    └── 否 → 继续
    │
    ▼
Step C: 构建 scheme discovery prompt + 调用 LLM
    → 收集所有活跃世界书的 content 文本作为上下文
    → 构建 prompt（见下方）
    → callMemoryPipeline(prompt)
    → 解析 LLM 返回的 JSON → 存入 vault.content.npc_schemes
    │
    ▼
Step D: 持久化
    → vault.content.npc_schemes 随 vault 一同通过 IndexedDB + 聊天文件持久化
```

### 2.4 方案发现 Prompt 设计

```
## World Setting
[世界书条目 1 content 文本]
[世界书条目 2 content 文本]
...

## Task
Based on the world setting above, determine what character state fields should be
tracked for NPCs in this world. You may define 1-3 schemes.

Available field names (from character schema):
  status, gender_age, occupation, personality, clothing_build,
  injuries, status_effects, past_experience, inner_thoughts,
  affection, relationship, current_mood

Rules:
- Every scheme MUST include "status"
- "default" is mandatory (catch-all for unclassified NPCs)
- field names MUST be from the available list above
- required: fields that should always be tracked
- optional: fields tracked only when explicitly relevant

Output ONLY valid JSON:
{
  "schemes": {
    "default": { "description": "...", "required": [...], "optional": [...] },
    "scheme_name_2": { ... },
    ...
  }
}
```

### 2.5 NPC 方案分配（per-character，State LLM 在首次遇到时）

在 `buildStateInjectionTable` 中，将可用方案摘要注入 State LLM prompt（NPC 角色区域上方）：

```
=== NPC Schemes Available ===
humanoid_npc — 人类/精灵等类人NPC (required: gender_age, occupation, personality, affection, relationship, current_mood)
monster_npc  — 怪物/野兽/龙 (required: species, threat_level, status)

=== Characters (Active) ===
[PC] [江岚]
  status: 活跃
  ...

[艾莉丝] (_scheme: humanoid_npc)
  gender_age: 18岁女性
  ...

[哥布林] (_scheme: null → unassigned)
  status: 活跃
  ...
```

当 LLM 遇到 `_scheme: null` 的 NPC 时，在 `state_changes` 中指定方案：

```json
{
  "state_changes": {
    "characters.哥布林._scheme": "monster_npc",
    "characters.哥布林.species": "哥布林",
    "characters.哥布林.threat_level": "低"
  }
}
```

`mergeStateChanges` 需要特殊处理 `_scheme`：一旦设置，不可更改。

### 2.6 兜底：DEFAULT_NPC_SCHEME

当无世界书时使用，从 `DEFAULT_CHARACTER_SCHEMA.npc` 自动生成：

```javascript
var DEFAULT_NPC_SCHEME = (function() {
    var npcFields = DEFAULT_CHARACTER_SCHEMA.npc.fields;
    var required = [];
    var optional = [];
    Object.keys(npcFields).forEach(function(k) {
        if (k === 'name' || k === 'inventory' || k === 'inventory_mode' || k === 'clothing_mode') return;
        if (npcFields[k].required) required.push(k); else optional.push(k);
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

## 三、改动清单

### 3.1 schema.js — 核心新增

| # | 改动 | 类型 |
|---|------|------|
| 1 | 新增 `DEFAULT_NPC_SCHEME` 计算常量（IIFE） | 新增 |
| 2 | 新增 `export function getNpcInjectionFields(state, name)` — 从 `vault.content.npc_schemes` 获取指定 NPC 的字段列表。逻辑：检查 `char._scheme` → 找到对应方案的 required+optional → 返回字段数组；`_scheme` 为 null 或找不到方案 → 返回 default 方案的字段 | 新增 |
| 3 | `buildStateInjectionTable` 中 NPC 字段获取改为调用 `getNpcInjectionFields(state, name)` 替代 `NPC_INJECTION_FIELDS` | 重构 |
| 4 | `buildStateInjectionTable` 新增方案摘要块：在角色列表之前插入 `=== NPC Schemes Available ===`（仅当 `npc_schemes` 存在且 >1 个方案时） | 新增 |
| 5 | `ensureCharacterTemplate` — 当 `schemeKey` 不为 null 时，模板字段 = 从 `npc_schemes[schemeKey]` 取 required+optional 合并的字段集（而非完整的 `DEFAULT_CHARACTER_SCHEMA.npc.fields`） | 重构 |
| 6 | `mergeStateChanges` — 特殊处理 `_scheme` 路径：一旦有值，后续 merge 不覆盖 | 新增 |
| 7 | `validateStateChanges` — 校验 `_scheme` 的值必须在 `npc_schemes` 的 key 集合中 | 新增 |

### 3.2 update.js — 方案发现逻辑

| # | 改动 | 类型 |
|---|------|------|
| 8 | 新增 `buildSchemeDiscoveryPrompt(worldBookContent)` — 构建 LLM prompt（见 2.4） | 新增 |
| 9 | 新增 `export async function resolveNpcSchemes(vault)` — 入口函数：检查 → world book 检查 → LLM 调用 → 写入 vault | 新增 |
| 10 | `extractStateChangesOnly` 开头检查 `npc_schemes` 是否存在，不存在则 await `resolveNpcSchemes(vault)`（仅在首次初始化时触发一次） | 新增 |
| 11 | `buildStatePrompt_Preset` rules 中增加「NPC 方案分配规则」：新 NPC 首次出现且 `_scheme` 未被分配时，根据 NPC 特征从可用方案中选择 | 新增 |

### 3.3 bootstrap.js — 初始化集成

| # | 改动 | 类型 |
|---|------|------|
| 12 | `bootstrapVault` → 如果 version === 0 且 State Schema 开启 → 调用 `resolveNpcSchemes(vault)` 但不 await（异步初始化，State LLM 首次调用时再阻塞等待） | 新增 |

### 3.4 panel.js — UI 显示方案名

| # | 改动 | 类型 |
|---|------|------|
| 13 | `renderCharacterCard` → header 中 NPC 卡片显示方案名（如 `NPC · humanoid_npc`），从 `npc_schemes[char._scheme].description` 取中文描述 | 新增 |

### 3.5 worldbook-sync.js — 无改动

方案存储在 vault，不涉及世界书写入。

### 3.6 测试用例

| # | 改动 | 类型 |
|---|------|------|
| 14 | 新增 `pipeline-state-06` — NPC 多方案发现 + 分配测试 | 新增 |

## 四、方案生命周期

```
┌─────────┐    LLM 调用    ┌──────────────┐
│ 初始化   │ ────────────→ │ npc_schemes   │
│ (空)     │               │ (锁定，不变)   │
└─────────┘               └──────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
               humanoid_npc  monster_npc   default
                    │            │            │
                    ▼            ▼            ▼
               [艾莉丝]      [哥布林]      [路人甲]
              _scheme=       _scheme=      _scheme=
             humanoid_npc   monster_npc     default
```

**方案一旦锁定，不会改变。** 不会新增方案、不会修改已有方案的字段、不会删除方案。如果用户更新了世界书之后需要重新生成方案，需手动删除 vault 或重置（后续可加 UI 按钮）。

## 五、边界情况

| 情况 | 处理 |
|------|------|
| LLM 方案发现失败（API 不可用） | fallback 到 `DEFAULT_NPC_SCHEME` |
| LLM 返回的字段名不在可用列表中 | `validateStateChanges` 过滤掉非法字段 |
| NPC 的 `_scheme` 对应的方案已被删除 | fallback 到 `"default"`（理论上不会发生，方案不删除） |
| NPC 从未被分配方案（`_scheme` = null） | 使用 `"default"` 方案的字段 |
| `npc_schemes` 只有一个 `"default"` | 不显示方案摘要块，行为等同于当前单方案 |

## 六、Token 影响

| 场景 | 额外 token 消耗 |
|------|----------------|
| 方案发现 LLM 调用 | 一次性：world book 文本 + prompt ≈ 500-1500 tokens |
| 每轮 State LLM prompt | 方案摘要块 ~50-150 tokens（仅 >1 方案时） |
| 每 NPC 字段展示 | 可能更少——如果 NPC 被分配到精简方案（如 monster 只有 3 个 required 字段 vs 当前 12），反而省 token |

## 七、验证

1. `npm run build` 通过
2. 23 测试用例（+1 新增 pipeline-state-06）
3. `buildStateInjectionTable` 对不同 `_scheme` 的 NPC 展示不同字段集
4. PC 不受影响（始终 `PC_INJECTION_FIELDS`）
5. 无方案时行为等同于当前（使用 `DEFAULT_NPC_SCHEME.default`）

## 八、与单方案的兼容性

旧 vault 无 `npc_schemes` → `resolveNpcSchemes` 在首次 State LLM 调用时执行（如果没有 world book，使用 DEFAULT_NPC_SCHEME 兜底，无需 LLM）。对用户完全透明，无感知变化。
