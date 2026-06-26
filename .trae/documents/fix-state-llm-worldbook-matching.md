# 修复 State LLM 世界书匹配逻辑

## 1. 背景与问题总结

State LLM 的职责是管理角色的结构化字段（`gender_age`, `occupation`, `personality`, `clothing_build` 等）。当新角色首次出现时，需要从 ST 世界书的条目中提取这些字段的值。

现有代码对世界书的使用存在以下问题：

### P0 — 匹配方向反了（核心错误）
[resolveNpcSchemes](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1429-L1433) 构建 `_world_book_cache` 时，用角色名去搜索 `entry.content`：
```javascript
var contentLower = (entry.content || '').toLowerCase();
if (contentLower.indexOf(nameLower) !== -1) return true;
```
ST 世界书的核心语义是：**`entry.key` 定义该条目对聊天中的哪些词敏感**。应该用角色名匹配 `entry.key` 数组，而非 `entry.content`。

### P1 — constant 条目被排除
[L1419](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1419)：
```javascript
if (entry.constant) return;
```
用户可能用 constant 条目定义角色设定（key 中包含角色名），排除它们导致这些条目无法被匹配到。

### P2 — collectWorldBookContent 的 globalScanData 为空
[L1237-L1245](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1237-L1245)：`personaDescription`、`characterDescription` 等字段全部传空字符串，导致启用了 `matchCharacterDescription` 等选项的条目无法激活。

### P3 — 缓存不刷新
`_world_book_cache` 只在首次 `resolveNpcSchemes` 时构建一次，之后用户新增/启用的世界书条目在缓存中不可见。

---

## 2. 不改的部分（明确边界）

- **不改变 State LLM 的"仅新角色使用世界书"策略**：世界书只用于填充新角色的 `gender_age`、`occupation`、`personality`、`clothing_build`。一旦字段填好就不再需要世界书。
- **不把世界书注入到 State Table**：World/Faction/Quest 段的填充继续由对话推断，不引入世界书噪音。
- **不改变 scheme discovery 的整体流程**：只修复其中匹配逻辑和 globalScanData 传参。

---

## 3. 修改方案

### 3.1 修改 `collectWorldBookContent` — 传入真实 globalScanData

**文件**: `src/core/engine/update.js`，`collectWorldBookContent()` 函数（约 L1219-L1265）

**当前**：`scanData` 的所有非 trigger 字段全为空字符串。

**目标**：从 ST 上下文获取真实的 persona 描述、角色卡描述/性格/场景/创作者笔记，构建正确的 `scanData`。

**实现方式**：
```javascript
var scanData = {
    personaDescription: getPersonaDescription(),
    characterDescription: getCharacterDescription(),
    characterPersonality: getCharacterPersonality(),
    characterDepthPrompt: getCharacterDepthPrompt(),
    scenario: getScenario(),
    creatorNotes: getCreatorNotes(),
    trigger: 'normal'
};
```

**数据来源**（通过 `SillyTavern.getContext()` 获取）：
- `personaDescription`：`ctx.powerUserSettings.persona_description` 或 `power_user.persona_description`
- `characterDescription`：当前角色卡 `ctx.characters[this_chid].description`
- `characterPersonality`：当前角色卡 `ctx.characters[this_chid].personality`
- `characterDepthPrompt`：当前角色卡 `ctx.characters[this_chid].data.extensions.depth_prompt.prompt`
- `scenario`：当前角色卡 `ctx.characters[this_chid].scenario`
- `creatorNotes`：当前角色卡 `ctx.characters[this_chid].data.creator_notes`

**注意**：`collectWorldBookContent` 在 `update.js` 中，位于 core 层。为了获取这些数据，需要通过 `SillyTavern.getContext()` 直接访问（`update.js` 中已有这样的先例，如 `resolveNpcSchemes` 中直接访问 `SillyTavern.getContext()`）。

---

### 3.2 修复 `_world_book_cache` 匹配逻辑 — 用 key 替代 content

**文件**: `src/core/engine/update.js`，`resolveNpcSchemes()` 函数中构建缓存的代码（约 L1407-L1448）

**当前匹配逻辑**：
```javascript
var matched = entryList.filter(function(entry) {
    var contentLower = (entry.content || '').toLowerCase();
    if (contentLower.indexOf(nameLower) !== -1) return true;          // ← 错误
    if (isProtagonist && contentLower.indexOf('{{user}}') !== -1) return true; // ← 错误
    return false;
}).map(function(entry) {
    var label = (entry.key && entry.key.length > 0) ? entry.key[0] : '';
    return label ? ('[' + label + '] ' + entry.content) : entry.content;
});
```

**目标匹配逻辑**：
```javascript
var matched = entryList.filter(function(entry) {
    var keys = entry.key || [];
    // 检查该条目的 key 数组中是否有任意 key 匹配此角色名
    for (var ki = 0; ki < keys.length; ki++) {
        var keyLower = (keys[ki] || '').toLowerCase();
        if (keyLower === nameLower) return true;
        if (keyLower.indexOf(nameLower) !== -1) return true;  // 子串匹配
        if (nameLower.indexOf(keyLower) !== -1) return true;  // 反向子串
    }
    // 主角额外检查 {{user}} 宏
    if (isProtagonist) {
        for (var kj = 0; kj < keys.length; kj++) {
            var k = (keys[kj] || '').toLowerCase();
            if (k === '{{user}}' || k.indexOf('{{user}}') !== -1) return true;
        }
    }
    return false;
}).map(function(entry) {
    // 格式化输出不变
    var label = (entry.key && entry.key.length > 0) ? entry.key[0] : '';
    return label ? ('[' + label + '] ' + entry.content) : entry.content;
});
```

**同时移除 constant 排除**：删除 `if (entry.constant) return;`（L1419），让 constant 条目也参与 key 匹配。

---

### 3.3 `buildWorldBookSection` 增加按需查补逻辑

**文件**: `src/core/engine/update.js`，`buildWorldBookSection()` 函数（约 L923-L944）

**当前**：只从 `state._world_book_cache` 读取，如果 cache 中没有某个角色名，就跳过。

**目标**：当 `cache[name]` 不存在时，实时扫描 `ctx.worldInfo.entries`（按 key 匹配），找到就给 State LLM 用，同时写入缓存。

**实现方式**：在 `buildWorldBookSection` 内部增加一个 fallback 函数 `_lookupWbForName(name, protagonistName)`：

```javascript
function buildWorldBookSection(vault, names) {
    try {
        if (!names || names.length === 0) return '';
        var state = (vault && vault.content && vault.content.state) || {};
        var cache = state._world_book_cache;
        if (!cache) {
            cache = {};
            state._world_book_cache = cache;
        }

        var protagonistName = state.protagonist_name || '';
        var lines = [];
        names.forEach(function(name) {
            var entries = cache[name];
            
            // 缓存未命中 → 实时查补
            if (!entries || entries.length === 0) {
                entries = _lookupWbByName(name, protagonistName);
                if (entries && entries.length > 0) {
                    cache[name] = entries;
                }
            }
            
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

// 新增辅助函数：按角色名查找世界书条目（匹配 entry.key）
function _lookupWbByName(name, protagonistName) {
    try {
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var allEntries = (ctx && ctx.worldInfo && ctx.worldInfo.entries) ? ctx.worldInfo.entries : {};
        if (Object.keys(allEntries).length === 0) return [];
        
        var nameLower = name.toLowerCase();
        var isProtagonist = name === protagonistName;
        var matched = [];
        
        Object.keys(allEntries).forEach(function(uid) {
            var entry = allEntries[uid];
            if (!entry || entry.disable || !entry.content) return;
            
            var keys = entry.key || [];
            var keyMatched = false;
            for (var i = 0; i < keys.length; i++) {
                var keyLower = (keys[i] || '').toLowerCase();
                if (keyLower === nameLower || keyLower.indexOf(nameLower) !== -1 || nameLower.indexOf(keyLower) !== -1) {
                    keyMatched = true;
                    break;
                }
                if (isProtagonist && (keyLower === '{{user}}' || keyLower.indexOf('{{user}}') !== -1)) {
                    keyMatched = true;
                    break;
                }
            }
            if (!keyMatched) return;
            
            var label = (entry.key && entry.key.length > 0) ? entry.key[0] : '';
            matched.push(label ? ('[' + label + '] ' + entry.content) : entry.content);
        });
        return matched;
    } catch (e) {
        return [];
    }
}
```

---

### 3.4 重构：抽取公共的"按 key 匹配角色名"逻辑

**文件**: `src/core/engine/update.js`

上述 3.2 和 3.3 都做了 key↔name 的匹配，应抽取为公共函数 `_matchEntryKeyToName(entry, name, protagonistName)`：

```javascript
function _matchEntryKeyToName(entry, name, protagonistName) {
    var keys = entry.key || [];
    if (keys.length === 0) return false;
    var nameLower = name.toLowerCase();
    var isProtagonist = (name === protagonistName);
    for (var i = 0; i < keys.length; i++) {
        var keyLower = (keys[i] || '').toLowerCase();
        if (keyLower === nameLower) return true;
        if (keyLower.indexOf(nameLower) !== -1) return true;
        if (nameLower.indexOf(keyLower) !== -1) return true;
        if (isProtagonist && (keyLower === '{{user}}' || keyLower.indexOf('{{user}}') !== -1)) return true;
    }
    return false;
}
```

然后在 3.2 和 3.3 两处复用此函数。

---

## 4. 修改涉及的文件

| 文件 | 改动范围 | 说明 |
|------|---------|------|
| `src/core/engine/update.js` | `collectWorldBookContent` (L1219-L1265) | 传入真实 globalScanData |
| `src/core/engine/update.js` | `resolveNpcSchemes` 缓存构建段 (L1407-L1448) | 匹配逻辑从 content→key，移除 constant 排除 |
| `src/core/engine/update.js` | `buildWorldBookSection` (L923-L944) | 增加 `_lookupWbByName` 按需查补 |
| `src/core/engine/update.js` | 新增公共函数 | `_matchEntryKeyToName` 统一 key↔name 匹配 |

全部修改仅在 `update.js` 一个文件内，不涉及接口变更。

---

## 5. 验证方式

1. **单元验证**：准备一个测试世界书，其中某条目 key=["张三"], content="张三，25岁男性矿工，性格豪爽"，禁用该条目。启动对话提及"张三"→ State LLM 应该能看到 `[WB] [张三] 张三，25岁男性矿工，性格豪爽`，并填充对应字段。

2. **constant 条目验证**：准备一个 constant 条目 key=["李四"], content="李四是青云宗弟子"。对话提及"李四"→ State LLM 应该能看到该条目。

3. **缓存刷新验证**：对话进行中，添加新世界书条目 key=["王五"]，下一轮对话提及"王五"→ `_lookupWbByName` 应实时命中。

4. **主角宏验证**：主角名="小明"，有世界书条目 key=["{{user}}"], content="主角是青云镇居民"。小明首次出现→ 应匹配到该条目。

---

## 6. 不涉及的内容

- 不改动 `buildStatePrompt_Preset` 的整体结构
- 不改动 `rulesZh/En` 的指令文字
- 不改动 State Table（`buildStateInjectionTable`）
- 不改动 `worldbook-sync.js`
- 不改动 `buildSchemeDiscoveryPrompt` 的内容
