# State 系统 Bug 修复计划（方案C：初始化锁定，不做动态扩展）

基于 pipeline-state-01 测试 trace 分析（10 轮、2026-06-24T11:58:11）。

## 修复策略

**方案 C = 初始化一次锁定**：方案发现 LLM 在首轮 State LLM 之前运行一次，同时输出 `npc_schemes` 和 `initial_characters`（含 PC/NPC 区分和方案分配）。之后 State LLM 每轮都看到完整的 Current State 表，PC/NPC 约束自然生效。对话中不新增方案——未匹配的 NPC 用 `default` 兜底。

---

## Bug A 🔴 — `schemaDesc` 字段说明与 PC/NPC 分离矛盾

### 问题

[schemaDesc](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L895-L945) 列出 `characters.*.affection` 作为所有角色的有效路径。LLM 更信任文字描述中的 `*` 通配符，而非 Current State 表的 per-character 字段约束。

### 测试证据

trace 中每轮 prompt 都包含 `characters.*.affection: 好感度 [0,100]`，而 Current State 表正确用 `PC_INJECTION_FIELDS`（不含 affection）。LLM 依赖 schemaDesc 的 `*` 输出 affection 给 PC。

### 修复

**删除 `schemaDesc` 整节。** Rules 已说「可用路径见上方 Current State 表格」。

| 文件 | 行号 | 操作 |
|------|------|------|
| [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L893-L945) | L893-945 | 删除 `schemaDesc` 变量（en + zh 两版，共 ~52 行） |
| [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L982-L983) | L982-983 | `stateTable + schemaDesc + rulesZh` → `stateTable + rulesZh` |
| [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L988-L989) | L988-989 | `stateTable + schemaDesc + rulesEn` → `stateTable + rulesEn` |

---

## Bug B 🔴 + Phase 0 — Round 1 空表 → 方案发现 LLM 初始化

### 问题

首轮 `state.characters` 为空 → `buildStateInjectionTable` 只输出 `[World]` → LLM 看不到任何角色字段约束 → 输出不受控。

### 修复（替代原来的「注入 PC 模板」方案）

**一次方案发现 LLM 调用**，在 State LLM 首轮之前执行。同时输出方案定义 + 初始角色名单。

**管线串行**：

```
extractStateChangesOnly() 入口
    │
    ├── vault.content.npc_schemes 不存在？
    │       │
    │       ├── 否 → 跳过
    │       └── 是 → await runSchemeDiscovery(vault)
    │               │
    │               ├── 收集活跃 world book 的 content 文本
    │               ├── 构建 prompt（见下方）
    │               ├── callMemoryPipeline → LLM 返回 JSON
    │               ├── 存入 vault.content.npc_schemes
    │               ├── 如果返回 initial_characters → 写入 state.characters
    │               └── 持久化 vault
    │
    └── 继续正常 State LLM 流程（此时 state.characters 和 npc_schemes 已就位）
```

**方案发现 LLM 的输入**：
- 所有活跃世界书的 content 文本 → 理解世界观
- 当前对话第一条消息（如有）→ 识别初始角色
- 可用字段列表（从 `DEFAULT_CHARACTER_SCHEMA.npc` 中提取）

**方案发现 LLM 的输出**：

```json
{
  "npc_schemes": {
    "default": {
      "description": "兜底方案",
      "required": ["gender_age", "occupation", "status"],
      "optional": ["personality"]
    }
  },
  "initial_characters": {
    "江岚": { "_role": "protagonist" },
    "安然": { "_role": "npc", "_scheme": "default" }
  }
}
```

- `npc_schemes` 至少必须有一个 `"default"`
- `initial_characters` 可选——如果 world book 为空且无对话消息，可能为空
- `_role` = `"protagonist"` 会覆盖 `protagonist_name` 的推断（如有冲突，以参数为准）
- `_role` = `"npc"` 需要 `_scheme` 指定方案

**兜底逻辑**（world book 为空）：

不调用 LLM。直接写入 DEFAULT_NPC_SCHEME（单方案兜底）。`initial_characters` 留空——State LLM 自行发现角色。

```javascript
// DEFAULT_NPC_SCHEME — 单方案兜底，字段从 DEFAULT_CHARACTER_SCHEMA.npc 派生
var DEFAULT_NPC_SCHEME = {
    default: {
        description: 'Default NPC scheme',
        required: ['status', 'gender_age', 'occupation', 'personality', 'affection', 'relationship', 'current_mood', 'inner_thoughts'],
        optional: ['clothing_build', 'injuries', 'status_effects', 'past_experience']
    }
};
```

**改动清单**：

| # | 文件 | 改动 | 类型 |
|---|------|------|------|
| 1 | [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js) | 新增 `buildSchemeDiscoveryPrompt(worldBookContent, availableFields)` | 新增 |
| 2 | [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js) | 新增 `async function runSchemeDiscovery(vault)` — 构建 prompt → LLM → 解析 → 写入 vault | 新增 |
| 3 | [update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L1174) | `extractStateChangesOnly` 入口：`if (!vault.content.npc_schemes) await runSchemeDiscovery(vault);` | 新增 |
| 4 | [schema.js](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js) | 新增 `DEFAULT_NPC_SCHEME` 兜底方案常量 | 新增 |
| 5 | [schema.js](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L540) | `buildStateInjectionTable` — NPC 字段获取从 `NPC_INJECTION_FIELDS` 改为从 `npc_schemes[char._scheme]` 获取；fallback 到 `npc_schemes.default` | 重构 |
| 6 | [schema.js](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L414] | `ensureCharacterTemplate` — 当有 `npc_schemes` 且 `schemeKey` 不是 null 时，模板字段 = `npc_schemes[schemeKey]` 的 required+optional 合并字段集 | 重构 |

**注意**：方案发现 LLM 的 `initial_characters` 中包含的 `_role: "protagonist"` 会与 `events.js` 中 `ctx.name1 → protagonist_name` 的逻辑产生交互。二者不冲突——如果 `initial_characters` 中已有 `protagonist` 标记，`protagonist_name` 推入后正好匹配（相同的名字）。如果 `protagonist_name` 未被设置但 `initial_characters` 中说「江岚是 protagonist」，则 `protagonist_name` 从 `initial_characters` 中推导。

---

## Bug C 🟡 — `protagonist_name` 可能未命中

### 问题

`ctx.name1` 可能为空。当 `protagonist_name` 为空时，`buildStateInjectionTable` 中无角色被识别为 PC。

### 修复

在 `onBeforeGenerate` 中增加 fallback。

| 文件 | 行号 | 操作 |
|------|------|------|
| [events.js](file:///d:/SillyTavern\xm/ne-memory/src/adapter/events.js#L666) | L666 | 增加 fallback |

```javascript
var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
var protagonistName = (ctx && ctx.name1) || null;
// Fallback: if name1 is empty, check initial_characters from npc_schemes
if (!protagonistName && vault.content.state && vault.content.state.characters) {
    var chars = vault.content.state.characters;
    for (var key in chars) {
        if (chars[key] && chars[key]._role === 'protagonist') {
            protagonistName = key;
            break;
        }
    }
}
// Fallback 2: group members
if (!protagonistName && ctx && ctx.groupId) {
    var members = ctx.characters || [];
    var aiName = (ctx && ctx.name2) || '';
    for (var mi = 0; mi < members.length; mi++) {
        if (members[mi] && members[mi] !== aiName) {
            protagonistName = members[mi];
            break;
        }
    }
}
```

---

## Bug D 🟡 — 空值导致双空格显示

### 问题

`String('')` = `''`，`'field: ' + '' + suffix` → `field:  (未填)`（双空格）。

### 修复

| 文件 | 行号 | 操作 |
|------|------|------|
| [schema.js](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/schema.js#L551-L563) | L551-563 | 重构空值处理 |

```javascript
// Replace L553-L563:
var fv = item.card[fk];
var isEmpty = (fv === undefined || fv === null || fv === '' || (fk === 'affection' && Number(fv) === 0));
var valStr = (fv !== undefined && fv !== null && fv !== '') ? String(fv) : '';
var suffix = '';
if (fk === 'status') suffix = ' (enum: 活跃/非活跃/已死亡/已归隐/已离去)';
else if (fk === 'affection') suffix = ' (0-100)';
else if (fk === 'past_experience') suffix = ' (增量追加)';
if (requiredSet[fk] && isEmpty) {
    suffix = ' (未填)' + suffix;
}
parts.push('  ' + fk + ': ' + valStr + suffix);
```

---

## Bug E 🟡 — affection 增量值 `+3` / `+5` 未被解析为数字

### 问题

LLM 输出 `"+3"` → 存储为字符串 → 每轮显示 `affection: +3` → 永不累加。

### 修复

在 `mergeStateChanges` 中检测 `+N` / `-N` 格式并累加。

| 文件 | 行号 | 操作 |
|------|------|------|
| [schema.js](file:///d:/SillyTavern\xm\ne-memory/src/core/vault/schema.js#L439-L483) | L439-483 | 在设置值之前增加增量解析 |

在 `mergeStateChanges` 中，设置 leaf value 之前插入：

```javascript
// Before setting the leaf value:
var oldVal = current[parts[lastIdx]];
if (typeof validatedChanges[path] === 'string' && typeof oldVal === 'number') {
    var incMatch = validatedChanges[path].match(/^([+-])(\d+)$/);
    if (incMatch) {
        var dir = incMatch[1] === '+' ? 1 : -1;
        validatedChanges[path] = oldVal + dir * parseInt(incMatch[2], 10);
    }
}
```

---

## Bug F 🟡 — 测试断言未覆盖 PC/NPC 分离

### 修复

| 文件 | 行号 | 操作 |
|------|------|------|
| [test-case.md](file:///d:/SillyTavern\xm\ne-memory/test-cases/pipeline/pipeline-state-01/test-case.md#L10-L15) | structural asserts | 增加 3 条 asserts |
| [test-case.md](file:///d:/SillyTavern\xm\ne-memory/test-cases/pipeline/pipeline-state-01/test-case.md#L29-L30) | goal description | 更新为重构后描述 |

```yaml
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: stm_events }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
  - { op: not_contains, target: pipeline_changes, value: "江岚.affection" }
  - { op: not_contains, target: pipeline_changes, value: "江岚.relationship" }
  - { op: not_contains, target: pipeline_changes, value: "江岚.inner_thoughts" }
```

如果 PC 名字不可预知（取决于角色卡），则改为 `{ op: not_contains, target: pipeline_changes, value: "affection" }`——但这条太宽泛（NPC 也需要 affection）。更精确的方案：在语义断言中增加一条：「PC（主角）是否有 affection/relationship/inner_thoughts 字段被填写？如有，则 FAIL」。

```yaml
semantic:
  - "PC（主角）是否被错误填写了 affection/relationship/inner_thoughts？如有则 FAIL。"
```

---

## 修复顺序

| 顺序 | Bug | 依赖 |
|:--:|-----|:--:|
| 1 | **B (+ Phase 0)** — 方案发现 LLM | 无（新增函数，无现有代码依赖） |
| 2 | **A** — 删除 schemaDesc | 无（独立删除） |
| 3 | **C** — protagonist_name fallback | 无（独立修改） |
| 4 | **D** — 双空格 | 无（独立修改） |
| 5 | **E** — affection 增量 | 无（独立修改） |
| 6 | **F** — 测试断言 | 依赖 A, B, C |

步骤 1-5 之间无代码依赖，可任意顺序执行。步骤 6 在所有代码修改之后。

---

## 验证

1. `npm run build` 通过
2. 22 test cases register
3. dist/index.js 不含 schemaDesc 全字段路径表
4. Round 1 State LLM prompt 包含完整的 Current State 表（方案发现后）
5. `state.characters.江岚` 在首轮 State LLM 调用前已初始化（含 `_role: 'protagonist'`）
6. affection 增量在 mergeStateChanges 后正确累加到数字值
7. pipeline-state-01 新增的 PC 字段断言通过
