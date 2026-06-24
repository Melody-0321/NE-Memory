# 角色卡注入方案（主 LLM + 全局正则管道）

---

## 一、方案决策

```
方案 1: State LLM + ST 世界书查询权限 → ❌ 否决
  致命伤: 名字匹配不可靠、时序问题、即兴 NPC 无数据

方案 2: 主 LLM 负责新角色注入 → ✅ 采纳
  已有基础设施: NE-BANNER 全局正则管道（双向：注入指令 + 提取输出 + 剔除显示）
  优势: 零信息差、世界书已在下文中、主 LLM 即创作者

方案 2a: State LLM 模板填空 → 🟡 退为补充机制
  角色: 主 LLM 漏填的字段，State LLM 后续从对话中逐步补全
```

### 数据流

```
onBeforeGenerate
  └→ ne_state_block 指令注入
       └→ 告知主 LLM: 首次引入角色时输出 NE-CHAR 块
          格式: <!--NE-CHAR:角色名-->{"字段":"值",...}<!--/NE-CHAR-->

主 LLM 生成回复
  └→ 回复开头: <!--NE-BANNER-->...<!--/NE-BANNER-->  (已有)
  └→ 回复任意位置: <!--NE-CHAR:李四-->{"gender_age":"28岁男性",...}<!--/NE-CHAR-->  (新增)

onMessageReceived
  └→ 正则提取 NE-BANNER → __ne_pending_state_block  (已有)
  └→ 正则提取 NE-CHAR  → __ne_pending_char_blocks  (新增)

全局正则
  └→ NE-BANNER → strip + 格式化显示  (已有)
  └→ NE-CHAR   → strip from 用户可见文本  (新增)

update.js (pipeline)
  └→ pendingBlock.present → chars[name] = { status: '活跃' }  (已有)
  └→ pendingCharBlocks → ensureCharacterTemplate + merge fields  (新增)
```

---

## 二、具体修改

### Step 1: 注入指令 — `onBeforeGenerate` 添加 NE-CHAR 格式说明

**文件**: [events.js L626-646](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L626-L646)

在现有 `ne_state_block` 指令后追加 NE-CHAR 格式说明：

```javascript
var charBlockInstr = '\n当你的回复中首次引入新角色（之前未出现过的角色）时，在任意位置输出角色信息块：\n' +
    '格式：<!--NE-CHAR:角色名-->{"gender_age":"描述","occupation":"职业","personality":"性格",' +
    '"affection":50,"relationship":"与主角的关系","current_mood":"心情"}<!--/NE-CHAR-->\n' +
    '字段说明：\n' +
    '- gender_age / occupation / personality / clothing_build: 可从世界书或你的角色设定中获取\n' +
    '- affection: 好感度 0-100，对你的初始态度\n' +
    '- relationship: 与你的关系描述\n' +
    '- current_mood: 当前心情\n' +
    '- 所有字段均为可选——仅输出你能确定的字段。不确定就省略该字段。\n' +
    '- 已有角色（之前对话中已出现过）不需要输出此块。\n' +
    '- 同一角色只输出一次。';

runtime.injectPrompt('ne_char_block', charBlockInstr, 'in_chat', 0, 'system');
```

这段指令放在 `ne_state_block` 之后，优先级相同（`depth=0`）。分开写而不是合在 `ne_state_block` 中，是为了保持指令模块化——如果未来移除 NE-CHAR 功能，只需删除 `ne_char_block` 一行。

### Step 2: 解析 — `onMessageReceived` 提取 NE-CHAR

**文件**: [events.js L199-212](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L199-L212)

在 NE-BANNER 解析代码块之后添加：

```javascript
// 提取 Main LLM 的新角色信息块
var charBlockRegex = /<!--NE-CHAR:([^-]+?)-->(\{[\s\S]*?\})<!--\/NE-CHAR-->/g;
var charBlockMatch;
var newCharBlocks = [];
while ((charBlockMatch = charBlockRegex.exec(message.mes || '')) !== null) {
    var charName = (charBlockMatch[1] || '').trim();
    var charJson = (charBlockMatch[2] || '').trim();
    try {
        var charData = JSON.parse(charJson);
        newCharBlocks.push({ name: charName, fields: charData });
        console.log('[NE-CHAR] new character block detected:', charName, Object.keys(charData).join(', '));
    } catch (e) {
        console.warn('[NE-CHAR] invalid JSON in char block for:', charName, e.message);
    }
}
if (newCharBlocks.length > 0) {
    globalThis.__ne_pending_char_blocks = (globalThis.__ne_pending_char_blocks || []).concat(newCharBlocks);
}
```

用 `while` 而不是单次 `match` —— 一条回复中可能引入多个新角色。

### Step 3: 剔除 — 全局正则 strip NE-CHAR from UI

**文件**: [events.js L438-489](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L438-L489) 区域（`registerGlobalBannerRegex` 附近）

新增一个全局正则注册：`ne-char-block-strip`，匹配 `<!--NE-CHAR:...-->...<!--/NE-CHAR-->` 并替换为空字符串。复用现有的 regex 注册框架，不需要新基础设施。

```javascript
var CHAR_FIND = '<!--NE-CHAR:[^-]+-->\\{[\\s\\S]*?\\}<!--\\/NE-CHAR-->';
var CHAR_ID = 'ne-char-block-strip';

// 注册逻辑同 BANNER_PATTERN，用 replace: ''
```

### Step 4: 写入 — `update.js` 合并角色字段

**文件**: [update.js L1284-1311](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L1284-L1311)

在 `pendingBlock` 处理之后（L1310 附近）添加：

```javascript
var pendingCharBlocks = globalThis.__ne_pending_char_blocks;
if (pendingCharBlocks && pendingCharBlocks.length > 0) {
    var state = vault.content.state || {};
    var chars = state.characters || {};
    pendingCharBlocks.forEach(function(cb) {
        if (!cb.name || !cb.fields) return;
        ensureCharacterTemplate(state, cb.name);
        chars = state.characters;
        if (!chars[cb.name]) chars[cb.name] = {};
        Object.keys(cb.fields).forEach(function(fk) {
            // 不覆盖已有非空值（主 LLM 可能在多轮中重复输出同一角色）
            var existing = chars[cb.name][fk];
            if (existing === undefined || existing === '' || existing === 0 || existing === false) {
                chars[cb.name][fk] = cb.fields[fk];
            }
        });
        chars[cb.name].status = '活跃';  // ensure active
        console.log('[NE-CHAR] merged character:', cb.name, Object.keys(cb.fields).join(', '));
    });
    state.characters = chars;
    vault.content.state = state;
    globalThis.__ne_pending_char_blocks = null;
}
```

关键设计：
- **不覆盖已有值**：如果 role 卡中已有 `personality: "暴躁但正直"`，主 LLM 再次输出空值不会覆盖
- **确保活跃**：写入时同时设 `status = '活跃'`
- **调用 `ensureCharacterTemplate`**：补全空字段模板（本次没被 LLM 填的字段保留空值）

### Step 5: State LLM 模板填空（补充机制）

保留当前计划中的 State LLM 模板展开，但降低其定位：**从"主要路径"降为"补充路径"**。

State LLM 的角色是：
- 主 LLM 引入角色但漏填了某些字段 → State LLM 在后续轮次从对话中补全
- 主 LLM 没有输出 NE-CHAR 块的即兴 NPC → State LLM 从对话中推断

这意味着 Step 1-2 的改动**仍需执行**（展开字段 + 分层规则），但目标从「让 State LLM 首次输出全部字段」变为「让 State LLM 看到哪些字段还是空的，并有机会补全」。

---

## 三、字段映射

主 LLM 输出的 JSON 字段名 → vault state 路径：

| NE-CHAR JSON key | vault 路径 | 类型 |
|------------------|-----------|------|
| gender_age | characters.名.gender_age | string |
| occupation | characters.名.occupation | string |
| personality | characters.名.personality | string |
| clothing_build | characters.名.clothing_build | string |
| affection | characters.名.affection | number 0-100 |
| relationship | characters.名.relationship | string |
| current_mood | characters.名.current_mood | string |
| inner_thoughts | characters.名.inner_thoughts | string |

字段是 LLM 输出的子集——主 LLM 只输出能确定的字段。不确定的字段由 State LLM 后续补全。

---

## 四、修改文件清单

| 文件 | 改动 | 行数 |
|------|------|------|
| events.js (onBeforeGenerate) | 新增 `ne_char_block` 指令注入 | +15 |
| events.js (onMessageReceived) | 新增 NE-CHAR 正则提取 | +15 |
| events.js (registerGlobalBannerRegex) | 新增 strip 正则 | +5 |
| update.js | 新增 pendingCharBlocks 合并逻辑 | +20 |
| schema.js (buildStateInjectionTable) | 展开字段 + [NEW] 标记 | ~30 |
| update.js (buildStatePrompt rules) | 分层规则 | ~15 |

**合计 ~100 行改动**，不含测试。

---

## 五、对比原方案

| 维度 | 模板填空方案（旧） | 主 LLM 管道（新） |
|------|-------------------|-------------------|
| 首次新角色字段 | State LLM 从对话推断 | 主 LLM 直接从世界书/上下文输出 |
| 信息完整性 | 依赖对话中有提及 | 主 LLM 已知世界书条目，零信息差 |
| 时机 | 可能在 pipeline 触发后（1-2轮延迟） | 角色引入即登记（0延迟） |
| 即兴 NPC | State LLM 猜属性 | 主 LLM 定义属性（一致性高） |
| 可行性 | 需要 LLM 理解三层标记 | 已有 NE-BANNER 管道，直接复用 |
| State LLM 模板 | 主要路径 | 补充路径（补全漏填字段） |

---

## 六、验证清单

- [ ] Step 1: `ne_char_block` 指令出现在主 LLM 的 system prompt 中
- [ ] Step 2: 主 LLM 引入新角色时输出 `<!--NE-CHAR:...-->` 块
- [ ] Step 2: onMessageReceived 正确解析 JSON
- [ ] Step 2: 非法 JSON 被 warn 但不会阻断管道
- [ ] Step 3: 用户可见聊天中不出现 `<!--NE-CHAR:...-->` 块
- [ ] Step 4: vault state 中该角色字段正确填充
- [ ] Step 4: 已有值不被覆盖（主 LLM 再次输出同一角色时）
- [ ] Step 5: State LLM 后续轮次补全了主 LLM 漏填的字段
- [ ] 构建通过
- [ ] 实际运行对话：回合一引入新角色 → 面板角色卡字段可见
