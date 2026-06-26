# Plan: 单主角强制 + World Book 按条目级过滤（修复延续行丢失）

## 摘要

本次测试暴露两个问题：(1) scheme_discovery LLM 返回双 protagonist → 两个 PC；(2) State LLM 输出的字段值不来自 World Book（如 `occupation="作家"` 而非 `"大学二年级学生 / 网络小说作者"`）。

根因重新诊断：**不是"质量过滤"问题。是逐行内容匹配时，延续行被丢弃。** `collectWorldBookContent()` 返回逐行数组，缓存时只保留包含角色名的行 → `性别: 男`、`身份: 大学二年级学生 / 网络小说作者` 等缩进延续行被丢弃 → State LLM 根本没看到关键数据 → 只能从对话推断。

修复策略：(1) protagonist_name 为唯一判据；(2) 换 `collectWorldBookContent_raw()` 风格的条目级过滤——按条目整块 content 匹配角色名，保留完整 entry.content，不拆行。

---

## 根因诊断

### 问题 1：双 protagonist（同前）

### 问题 2：延续行被丢弃

scheme_discovery LLM 看到的（trace L138-151）：
```
[47] <character_overview>
[48] 角色总览:
[49]   - 姓名: '江岚'
[50]     性别: 男                      ← 不包含 "江岚"
[51]     身份: 大学二年级学生 / 网络小说作者    ← 不包含 "江岚"
[52]   - 姓名: "[江岚的姓]安然"
[53]     性别: 女                       ← 不包含 "江岚" 或 "安然"
[54]     身份: 大学二年级学生 / 网络小说作者    ← 不包含 "江岚" 或 "安然"
```

State LLM 看到的（trace L847-850）：
```
[]   - 姓名: '江岚'                    ← 匹配 "江岚" → 保留
[]   - 姓名: "[江岚的姓]安然"           ← 匹配 "江岚" → 保留
[]     备注: 江岚的异性同位体            ← 匹配 "江岚" → 保留
```

**L50、L51、L53、L54 不包含任何角色名或 `{{user}}` → 被丢弃。**

损失的链条：
```
collectWorldBookContent() 输出:  [{key:'',content:'[49]   - 姓名: \'江岚\''},
                                  {key:'',content:'[50]     性别: 男'},    ← 丢
                                  {key:'',content:'[51]     身份: ...'},   ← 丢
                                  ...]

wbCache 过滤:                    逐行检查 content.indexOf('江岚') → 只保留命中行

State LLM 看到的:                只有姓名和备注行，没有性别和身份
```

这是 `collectWorldBookContent()` 的设计缺陷：它把条目级的格式化文本拆成了孤立的行，丢弃了条目边界信息。缓存构建在此之上进一步损失。

---

## 修改方案

### 文件: `src/core/engine/update.js`（仅此一文件）

#### 修改 1: 单主角强制（两处，同前）

L1384-1393 和 L1401-1411 的 `isProtagonist` 判断：
- 移除 `ch._role === 'protagonist'` 条件
- 仅用 `ch.name === state.protagonist_name`

#### 修改 2: 缓存构建改为条目级过滤

**替换 L1414-1434 的整个 wbCache 代码块**：

当前：拿 `worldBookContent`（逐行数组）→ `filter(line.content.indexOf(nameLower))` → 延续行丢失。

改为：遍历 `ctx.worldInfo.entries`（条目级对象）→ 判断 `entry.content`（整块）是否包含角色名 → 保留完整 `entry.content`。

```javascript
if (parsed.initial_characters) {
    var wbCache = {};
    var protagonistName = state.protagonist_name || '';

    // 条目级过滤：使用 ctx.worldInfo.entries 的整块 content
    try {
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var allEntries = (ctx && ctx.worldInfo && ctx.worldInfo.entries) ? ctx.worldInfo.entries : {};
        var entryList = [];

        Object.keys(allEntries).forEach(function(uid) {
            var entry = allEntries[uid];
            if (!entry || entry.disable || !entry.content) return;
            if (entry.constant) return;
            entryList.push(entry);
        });

        if (entryList.length > 0) {
            parsed.initial_characters.forEach(function(ch) {
                if (!ch.name) return;
                var nameLower = ch.name.toLowerCase();
                var isProtagonist = ch.name === protagonistName;

                var matched = entryList.filter(function(entry) {
                    var contentLower = (entry.content || '').toLowerCase();
                    if (contentLower.indexOf(nameLower) !== -1) return true;
                    if (isProtagonist && contentLower.indexOf('{{user}}') !== -1) return true;
                    return false;
                }).map(function(entry) {
                    var label = (entry.key && entry.key.length > 0) ? entry.key[0] : '';
                    return label ? ('[' + label + '] ' + entry.content) : entry.content;
                });

                wbCache[ch.name] = matched;
            });
        }
    } catch (e) {
        console.warn('[NE] WB cache build from entries failed:', e && e.message);
    }

    if (Object.keys(wbCache).length > 0) {
        state._world_book_cache = wbCache;
    }
}
```

**关键差异**：

| | 修复前 | 修复后 |
|---|---|---|
| 数据源 | `collectWorldBookContent()` 逐行数组 | `ctx.worldInfo.entries` 条目对象 |
| 匹配单位 | 单行 `content` | 整块 `entry.content` |
| 匹配逻辑 | `content.indexOf('江岚')` | `entry.content.indexOf('江岚')` |
| 保留内容 | 仅匹配行 | 完整 `entry.content`（含延续行） |
| 标签 | 丢失（全 `[]`） | `entry.key[0]`（如 `character_male`） |

**`{{user}}` 处理**：与之前相同——主角的条目额外检查 `entry.content` 是否包含 `{{user}}` 字面量。

**`collectWorldBookContent()` 不受影响**：仍用于 scheme_discovery LLM prompt。

**`buildWorldBookSection` 不变**：仍从 `state._world_book_cache` 读取，但现在缓存中是完整条目块。

---

## 状态对比：修复前后 State LLM 看到的 World Book

| | 修复前 | 修复后 |
|---|---|---|
| 内容示例 | `[]   - 姓名: '江岚'` | `[character_overview] 角色总览:\n  - 姓名: '江岚'\n    性别: 男\n    身份: 大学二年级学生 / 网络小说作者` |
| 标签 | `[]` | `[character_overview]`, `[guide_female]`, `[character_male]` 等 |
| 延续行 | 丢失 | 保留 |
| 噪声 | 低（行少）但关键行丢 | 略高（整块注入）但 LLM 能区分 |

---

## 假设与决策

| 决策 | 理由 |
|---|---|
| protagonist_name 唯一判据 | 用户明确：一次判定 |
| 条目级过滤替代逐行过滤 | 消除延续行丢失——这是真正的根因 |
| entry.key[0] 作标签保留 | 帮助 LLM 区分条目类型 |
| ctx.worldInfo.entries 直接遍历 | 跳过 getWorldInfoPrompt 的格式化文本输出，不拆行 |
| constant 条目跳过 | constant 在 NE pipeline 上下文中活跃，但属于自有规则，与角色档案无关 |
| {{user}} 匹配保留 | 主角条目可能使用宏 |

---

## 验证步骤

1. `npm run build`
2. 运行 `pipeline-state-01` 测试
3. 检查 State LLM prompt：
   - `[PC]` 仅江岚、安然 `[NPC]`
   - `## World Book` 行包含 `[character_overview] 角色总览:...性别: 男...身份: 大学二年级学生 / 网络小说作者`
4. State LLM 输出：`occupation` 应为 `"大学二年级学生 / 网络小说作者"` 而非 `"作家"`
