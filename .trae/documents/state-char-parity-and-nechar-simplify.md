# State LLM 信息差消除 + NE-CHAR 简化

## 摘要

两份计划，顺序执行：

1. **Plan A**：消除 State LLM 信息差 —— 注入角色卡，让 State LLM 能自主填写静态字段
2. **Plan B**：简化 NE-CHAR —— 从"角色卡全量填空"变为"每轮情感/内心状态增量输出"

## 决策

- **顺序**：A → B（B 的简化前提是 A 让 State LLM 能填静态字段）
- **NE-CHAR 触发**：每轮输出（affection 变化和内心活动持续发生）
- **世界书**：激活条目，仅在新角色初始化时注入；每轮维护不注入

---

## Plan A: State LLM 信息差消除

### 当前状态

State LLM 的 system prompt（[update.js L883-L943](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L883-L943)）：

```
stateTable + buildWorldBookSection() + rules
```

缺失：**角色卡信息**（description, personality, scenario）。State LLM 不知道角色是谁、什么性格、什么背景，无法从 (未填) 推断字段值。

### 改动 1：新增 `buildCharacterCardSection()`

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**位置**：L846 之前（`buildWorldBookSection` 之前）

```
function buildCharacterCardSection() {
    var chars = runtime.getCharacters();
    if (!chars || chars.length === 0) return '';
    var lines = [];
    chars.forEach(function(ch) {
        if (!ch.name) return;
        var hasContent = ch.description || ch.personality || ch.scenario;
        if (!hasContent) return;
        lines.push('[' + ch.name + ']');
        if (ch.description) lines.push('Description: ' + ch.description);
        if (ch.personality) lines.push('Personality: ' + ch.personality);
        if (ch.scenario) lines.push('Scenario: ' + ch.scenario);
    });
    if (lines.length === 0) return '';
    return '## Character Cards\n' + lines.join('\n') + '\n';
}
```

同步函数，不涉及异步。角色卡三字段（description/personality/scenario）实际使用中几乎全空，token 成本接近零。

### 改动 2：世界书仅初始化时注入

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**当前**：`buildWorldBookSection()` 每轮都注入全量静态世界书到 State LLM。

**改为**：世界书仅在 `resolveNpcSchemes`（新角色发现）中注入激活条目。`buildStatePrompt_Preset` 中移除世界书注入。

**原因**：世界书是角色初始化工具，不是增量维护工具。State LLM 每轮处理增量变化，不需要每次重新读世界设定。激活条目已通过 ST 的 `getWorldInfoPrompt(dryRun=true)` 在初始化时获取。

`resolveNpcSchemes` 中已有 `collectWorldBookContent()`（[L1127-L1146](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1127-L1146)），改为调用 `ctx.getWorldInfoPrompt(chatArray, maxContext, true, scanData)` 获取激活条目，传入方案发现 LLM。

### 改动 3：`buildStatePrompt_Preset` 注入角色卡 + 移除世界书

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)，L925-L943

```diff
  return {
-     system: stateTable + buildWorldBookSection() + rulesZh,
+     system: stateTable + buildCharacterCardSection() + rulesZh,
      user: '最近的对话消息：\n\n' + msgTexts + '\n\n输出包含 state_changes 的 JSON...'
  };
```

同步改动，无异步化。世界书移除，角色卡加入。

### Plan A 改动清单

| 改动 | 文件 | 行范围 | 类型 |
|------|------|--------|------|
| `buildCharacterCardSection` | update.js | 新增 | 新增函数 |
| 世界书仅初始化注入 | update.js | L1273（resolveNpcSchemes 调用处） | 修改 |
| 移除 `buildWorldBookSection` 调用 | update.js | L925 | 删除 1 行 |
| 注入 `buildCharacterCardSection` | update.js | L925 | 新增 1 行 |

---

## Plan B: NE-CHAR 简化

### 当前状态

NE-CHAR 输出完整角色卡字段集（gender_age, occupation, personality, clothing_build, affection, relationship, current_mood, inner_thoughts），用于新角色首次初始化。

Plan A 后，State LLM 可自主填写静态字段（gender_age, occupation, personality, clothing_build）。NE-CHAR 只需处理 State LLM 做不到的：**affection/relationship 数值增量 + current_mood/inner_thoughts**。

### 改动 1：NE-CHAR 指令 — 从"首次填空"变为"每轮情感增量"

**文件**：[src/adapter/events.js](file:///d:/SillyTavern\xm/ne-memory/src/adapter/events.js)，L748-L772

**新指令**：

```
在本轮回复末尾输出活跃角色（本轮有台词或互动的角色）的好感度变化和内心状态：

- PC 可用字段: current_mood, inner_thoughts
- NPC 可用字段: affection_delta, relationship, current_mood, inner_thoughts

格式：
  <!--NE-CHAR:角色名-->{"affection_delta":5,"relationship":"...","current_mood":"...","inner_thoughts":"..."}<!--/NE-CHAR-->

规则：
- 只有本轮实际发生了变化的角色才输出 NE-CHAR 块。无变化的角色跳过。
- affection_delta: 数值变化量（+5 表示好感上升5，-10 表示下降10）。可为空（仅当前心情变化时）。
- relationship: 关系描述。有变化时输出最新描述。
- current_mood: 角色当前心情/情绪。
- inner_thoughts: 角色内心想法。
- PC 不输出 affection_delta 和 relationship。
- 每个角色一个独立 NE-CHAR 块。
- 放在回复末尾。
```

**关键变化**：

| | 旧 | 新 |
|---|-----|-----|
| 触发 | 仅新角色首次填入 | 每轮，有变化就输出 |
| 字段 | 全量（8-12 字段） | 精简（2-4 字段） |
| affection | 绝对值（初始化） | delta（增减量） |
| _role/_scheme | 必填 | 不需要（State LLM 管理） |

### 改动 2：NE-CHAR 消费端适配 delta 格式

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)，L1349-L1391

**改动**：

```javascript
pendingCharBlocks.forEach(function(cb) {
    if (!cb.name || !cb.fields) return;

    // 角色已在 state 中 → 增量模式；不存在 → 跳过（State LLM 负责新建）
    var chars = charState.characters;
    if (!chars[cb.name]) {
        ensureCharacterTemplate(charState, cb.name, 'default');
        chars = charState.characters;
    }

    // affection_delta: 增量叠加
    if (cb.fields.affection_delta !== undefined) {
        var current = chars[cb.name].affection;
        if (typeof current !== 'number') current = 0;
        chars[cb.name].affection = Math.max(0, Math.min(100, current + Number(cb.fields.affection_delta)));
    }

    // relationship / current_mood / inner_thoughts: 覆盖
    ['relationship', 'current_mood', 'inner_thoughts'].forEach(function(fk) {
        if (cb.fields[fk] !== undefined && cb.fields[fk] !== '') {
            chars[cb.name][fk] = cb.fields[fk];
        }
    });

    chars[cb.name].status = chars[cb.name].status || '活跃';
    console.log('[NE-CHAR] delta merged:', cb.name, JSON.stringify(cb.fields));
});
```

**简化点**：
- 不再需要 `_role` / `_scheme` 提取和判断
- 不再需要 `pcAllowed` / `npcOnly` 过滤（NE-CHAR 指令已分 PC/NPC 字段）
- 不再需要 `keysToSkip`（所有字段都是有效数据字段）
- affection 从绝对值变为增量

### 改动 3：`ne_char_block` 不再使用 `npcFieldsList` / `pcFieldsList`

**文件**：[src/adapter/events.js](file:///d:/SillyTavern\xm/ne-memory/src/adapter/events.js)，L750-L751

删除 `npcFieldsList` 和 `pcFieldsList` 变量声明（新指令中不再引用这些字段列表）。

### Plan B 改动清单

| 改动 | 文件 | 说明 |
|------|------|------|
| 重写 `ne_char_block` 指令 | events.js: L748-L772 | 从首次填空变为每轮情感增量 |
| 删除 `npcFieldsList` / `pcFieldsList` | events.js: L750-L751 | 不再需要 |
| 简化 NE-CHAR 消费端 | update.js: L1349-L1391 | delta 叠加 + 覆盖，移除 _role/_scheme/字段过滤 |

---

## 最终 System Prompt 结构

### State LLM（Plan A 后）

```
=== Current State ===
▶ 江岚 · 活跃 · PC · gender_age: 男，20岁 · occupation: 网络小说作者 ...

## Character Cards
[江岚]
Description: 表面沉稳寡言，实则内里拧巴...
Personality: 胜负心强，习惯用行动和陈述句解决问题...
Scenario: 702公寓的同居生活...

[安然]
Description: 江岚的异性同位体...
Personality: 外在帅气直率，内在有女性的柔软与欲望...
Scenario: 世界融合后成为江岚的同居室友...

## Rules
- state_changes: flat object, dot-path → 新值...
- 【禁止编造】...
```

### Main LLM 注入（Plan B 后）

| key | 内容 |
|-----|------|
| `ne_char_block` | "在本轮回复末尾输出活跃角色的好感度变化和内心状态。affection_delta 是变化量..." |
| `ne_state_block` | BANNER 指令（不变） |
| `ne_state_table` | Current State 表格（不变） |
| `ne_memory_vault` | SmartPush 检索（不变） |

---

## 验证

1. `npm run build` — 编译无错误
2. `pipeline-state-01` — State LLM 首轮可填满静态字段（不再全 (未填)）
3. NE-CHAR 监测 — `[NE-CHAR-MONITOR]` 日志显示每轮有变化时输出，格式为精简增量
4. trace 检查 — State LLM system prompt 包含 Character Cards，不含 World Book（日常轮次）
