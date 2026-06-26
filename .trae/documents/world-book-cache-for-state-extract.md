# Plan: World Book 内容供 State LLM 提取角色信息（含 {{user}} 处理）

## 摘要

`resolveNpcSchemes` 已通过 `collectWorldBookContent()` 拿到了 World Book 激活内容但随后丢弃。`buildStatePrompt_Preset` 调用 `runtime.getWorldInfo().entries` 走另一条数据路径，结果为空——State LLM 缺失角色信息来源，凭空编造错误数据。

修复策略：`resolveNpcSchemes` 中拿到 World Book 内容后，按 scheme_discovery LLM 返回的 `initial_characters` 角色名筛选并缓存到 state，`buildWorldBookSection` 从缓存读取。

**关键新增需求**：World Book 条目中的主角信息可能使用 `{{user}}` 宏（未被 ST 解析），筛选时需额外匹配 `{{user}}` 字面量。

---

## 当前状态分析

### 两条数据路径的分岔

| | scheme_discovery (✅) | state_extract (❌) |
|---|---|---|
| 数据源 | `collectWorldBookContent()` → `getWorldInfoPrompt()` → 激活的条目文本 | `runtime.getWorldInfo()` → `ctx.worldInfo.entries` 原始对象 |
| 内容 | 格式化后的 World Book 文本 | 原始 entry 对象 |
| 过滤 | 无（全量送 LLM） | 内容子串匹配角色名 → 结果为空 |
| {{user}} 状态 | 未解析（保持字面 `{{user}}`） | 未解析（保持字面 `{{user}}`） |

### `{{user}}` 宏解析机制

| 调用路径 | {{user}} 是否被解析 | 原因 |
|---|---|---|
| `collectWorldBookContent()` → `getWorldInfoPrompt(dryRun)` | ❌ 不解析 | `getRegexedString` 只做正则脚本替换，不做宏替换 |
| `collectWorldBookContent_raw()` → `ctx.worldInfo.entries` | ❌ 不解析 | 直接读原始数据 |
| `runtime.getWorldInfo().entries` | ❌ 不解析 | 同 raw 路径 |
| ST 生成对话时 | ✅ 解析 | `substituteParams` / `baseChatReplace` 在发送前替换 |

**结论**：我们拿到的 World Book 内容中 `{{user}}` 永远是未解析的字面量。

### 实际测试数据

当前测试的 `<character_male>` 条目使用硬编码名 "江岚"（trace L640），不使用 `{{user}}`。但用户实际场景中会使用 `{{user}}`（如 `<character_male>` 中 `姓名: {{user}}`），系统必须兼容。

### 时序确认

```
extractStateChangesOnly
├─ resolveNpcSchemes (L1456-1458, 首次)
│   ├─ collectWorldBookContent() → worldBookContent (变量存在)
│   └─ scheme_discovery LLM → initial_characters (已知所有角色名)
│
└─ buildStatePrompt_Preset (L1462)
    └─ buildWorldBookSection
```

两者在同一 async 函数内顺序执行，无竞态。`buildStatePrompt_Preset` 一定在 `resolveNpcSchemes` 之后。

---

## 修改方案

### 文件: `src/core/engine/update.js`（仅此一文件）

#### 修改 1: `resolveNpcSchemes` — 缓存筛选后的 World Book 内容

**插入位置**: L1405 之后（`parsed.initial_characters` 的 `ensureCharacterTemplate` 循环完成后，`vault.content.state = state` 之前）

**逻辑**:
```javascript
// 筛选 World Book 内容，按角色名缓存，供 state_extract 使用
if (worldBookContent && worldBookContent.length > 0 && parsed.initial_characters) {
    var wbCache = {};
    var protagonistName = state.protagonist_name || '';
    var stUserName = (messages.length > 0 && messages[0].name) || '';
    
    parsed.initial_characters.forEach(function(ch) {
        if (!ch.name) return;
        var isProtagonist = (ch._role === 'protagonist') || (ch.name === protagonistName);
        var nameLower = ch.name.toLowerCase();
        
        wbCache[ch.name] = worldBookContent.filter(function(entry) {
            var contentLower = (entry.content || '').toLowerCase();
            // 匹配 1: 包含角色名（NPC 和硬编码名的主角）
            if (contentLower.indexOf(nameLower) !== -1) return true;
            // 匹配 2: 主角条目使用 {{user}} 宏（未解析）
            if (isProtagonist && contentLower.indexOf('{{user}}') !== -1) return true;
            // 匹配 3: 主角条目在 ST 用户名为 User 时被解析为 "User"
            if (isProtagonist && stUserName && contentLower.indexOf(stUserName.toLowerCase()) !== -1) return true;
            return false;
        }).map(function(entry) { return entry.content; });
    });
    state._world_book_cache = wbCache;
}
```

**三重匹配策略**:

| 匹配条件 | 适用场景 | 示例 |
|---|---|---|
| 内容包含角色名 | NPC + 硬编码名的主角 | `姓名: 江岚` → 匹配 "江岚" |
| 内容包含 `{{user}}` | 主角条目使用宏且未解析 | `姓名: {{user}}` → 匹配 `{{user}}` 字面量 |
| 内容包含 ST 用户名 | 万一宏被上层解析（防御性） | `姓名: User` → 匹配 "User" |

**关键变量来源**:
- `worldBookContent`: L1347 已赋值，函数级作用域可直接使用
- `parsed.initial_characters`: L1379-1387 已解析
- `state.protagonist_name`: L1443-1444 已设置（可能已被 scheme_discovery 修正为 "江岚"）
- `messages`: 函数参数，`messages[0]` 为 `latestUserMsg`，其 `.name` 是 ST 用户显示名

#### 修改 2: `buildWorldBookSection` — 从缓存读取

**完全替换现有函数**（L923-L951）:

```javascript
function buildWorldBookSection(vault, names) {
    try {
        if (!names || names.length === 0) return '';
        var state = (vault && vault.content && vault.content.state) || {};
        var cache = state._world_book_cache;
        if (!cache || Object.keys(cache).length === 0) return '';

        var lines = [];
        names.forEach(function(name) {
            var entries = cache[name];
            if (!entries || entries.length === 0) return;
            entries.forEach(function(content) {
                lines.push('[WB] ' + content);
            });
        });
        if (lines.length === 0) return '';
        return '\n## World Book — new character profiles\n' + lines.join('\n') + '\n';
    } catch (e) {
        console.warn('[NE] buildWorldBookSection failed:', e && e.message);
    }
    return '';
}
```

**变更要点**:
- 移除对 `runtime.getWorldInfo()` 的调用 — 数据来源唯一化
- 从 `state._world_book_cache` 读取，与 scheme_discovery 同一份 World Book 内容
- `names` 来自 `findNewCharacterNames` — 仅字段全空的新角色触发
- 无缓存时静默返回 `''`

---

## 假设与决策

| 决策 | 理由 |
|---|---|
| 缓存存 `state._world_book_cache` | 自动随 vault write/snapshot 持久化 |
| 缓存建在 `resolveNpcSchemes` 而非 `buildWorldBookSection` | 复用已有 World Book 查询结果；与 scheme_discovery 同时序 |
| `buildWorldBookSection` 不保留回退路径 | 数据源应唯一，避免两条路径看到不同内容 |
| `{{user}}` 匹配用字面量字符串 | `collectWorldBookContent` 返回的内容中 `{{user}}` 未解析 |
| 也匹配 ST 用户名 | 防御：万一调用链中某处解析了宏 |
| 按 `initial_characters` 全量角色建缓存 | 后续 state_extract 可能查询任意角色（不只是 "新" 角色） |

---

## 验证步骤

1. `npm run build` — 构建通过
2. 运行 `pipeline-state-01` 测试
3. 检查 trace 中 State LLM 的 system prompt 应包含：
   - `## World Book — new character profiles` 区段
   - `[WB] 姓名: 江岚` 等条目（硬编码名场景）
   - 或 `[WB] 姓名: {{user}}` 等条目（宏场景）
4. 检查 State LLM 输出的字段值应与 World Book 内容一致
