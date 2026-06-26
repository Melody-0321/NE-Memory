# 角色卡内联编辑功能 — 实施计划

## 概述

在 Memory Vault 的 State Board 面板中，为每个角色卡添加编辑按钮。点击后整个卡片进入编辑模式——所有字段值原地切换为对应的编辑器（文本输入、数字输入、下拉选择）。Save 按钮一次性保存全部修改到 vault 并刷新面板，Cancel 恢复原始值。

参考：《滨莲市》的分字段填空式编辑 + 现有的 `toggleInlineEdit` 模式。

## 当前状态分析

### 渲染入口

[panel.js L529-613](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L529-L613) — `renderCharacterCard(name, card, schema, cardType)`：
- 遍历 `cardSchema.fields`，按 required/optional 分组输出 `<tr>`
- 每行 `key → displayVal` 渲染为两张 `<td>`
- 显示值为空时输出 `<span class="ne-empty-value">(未填)</span>`

### 持久化模式（可复用）

[panel.js L400-431](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L400-L431) — `saveSingleEntry()` + `_pendingInlineStorage`：
- 闭包持有 `{ vault, getChatId }` 引用
- `write(getChatId(), vault)` 写回

### Schema 字段类型

| 类型 | 编辑器 | 约束来源 |
|------|--------|---------|
| `string` | `<input type="text">` | `fieldDef.max_length` |
| `number` | `<input type="number">` | `fieldDef.min` / `fieldDef.max` |
| `enum` | `<select>` | `fieldDef.values` 数组 |
| `object` | 不做（inventory 等用独立渲染块） | — |

核心枚举值：`status` → `['活跃', '非活跃', '已死亡', '已归隐', '已离去']`

---

## 编写计划

### 第一步：`renderCharacterCard()` — 字段值 `<td>` 加 `data-*` 标记 + 卡片头加编辑按钮

**文件**: `src/adapter/panel.js` — 函数 `renderCharacterCard()`

**改动 A**：渲染字段值时，将原来：

```javascript
'<td>' + escapeHtml(key) + '</td><td>' + displayVal + '</td>'
```

改为带 data 属性的：

```javascript
var dataAttrs = 'data-char="' + escapeHtml(name) + '" data-field="' + escapeHtml(key) + '" data-type="' + (fieldDef.type || 'string') + '"';
if (fieldDef.max_length) dataAttrs += ' data-maxlen="' + fieldDef.max_length + '"';
if (fieldDef.type === 'number') {
    if (fieldDef.min !== undefined) dataAttrs += ' data-min="' + fieldDef.min + '"';
    if (fieldDef.max !== undefined) dataAttrs += ' data-max="' + fieldDef.max + '"';
}
if (fieldDef.values) dataAttrs += ' data-values="' + escapeHtml(fieldDef.values.join(',')) + '"';
row = '<tr><td class="ne-field-label">' + escapeHtml(key) + '</td>' +
      '<td class="ne-char-val" ' + dataAttrs + '><span class="ne-char-val-text">' + displayVal + '</span></td></tr>';
```

注意：值包装在 `<span class="ne-char-val-text">` 内，以便编辑模式替换。

**改动 B**：卡片头部加编辑按钮（以 `✎` 符号），紧挨角色名：

```html
<button class="ne-card-edit-btn" data-char="NAME" data-cardtype="TYPE">✎</button>
```

点击后触发 `enterCardEditMode(button)`。

### 第二步：新增 `enterCardEditMode(editBtn)` — 整卡切换为编辑模式

**文件**: `src/adapter/panel.js` — 新增函数

```javascript
function enterCardEditMode(editBtn) {
    var cardDiv = editBtn.closest('.ne-char-card');
    if (!cardDiv || cardDiv.classList.contains('ne-card-editing')) return;

    cardDiv.classList.add('ne-card-editing');
    var body = cardDiv.querySelector('.ne-char-card-body');
    if (!body) return;

    // 保存原始 table HTML 用于取消
    var table = body.querySelector('table');
    if (table) cardDiv._neOrigTableHTML = table.outerHTML;

    // 遍历所有 .ne-char-val，替换 .ne-char-val-text 为编辑器
    var vals = cardDiv.querySelectorAll('.ne-char-val');
    vals.forEach(function(td) {
        var fieldType = td.getAttribute('data-type') || 'string';
        var span = td.querySelector('.ne-char-val-text');
        var textVal = span ? (span.textContent || '').trim() : '';
        if (textVal === '(未填)' || textVal === '(Not filled)') textVal = '';

        var editor;
        switch (fieldType) {
            case 'enum':
                var values = (td.getAttribute('data-values') || '').split(',');
                editor = '<select class="ne-char-edit">';
                values.forEach(function(v) {
                    var vv = v.trim();
                    var sel = (textVal === vv) ? ' selected' : '';
                    editor += '<option value="' + escapeHtml(vv) + '"' + sel + '>' + escapeHtml(vv) + '</option>';
                });
                editor += '</select>';
                break;
            case 'number':
                var min = td.getAttribute('data-min');
                var max = td.getAttribute('data-max');
                editor = '<input class="ne-char-edit" type="number" value="' + escapeHtml(textVal) + '"' +
                    (min ? ' min="' + min + '"' : '') +
                    (max ? ' max="' + max + '"' : '') + '>';
                break;
            default:
                var maxlen = td.getAttribute('data-maxlen');
                editor = '<input class="ne-char-edit" type="text" value="' + escapeHtml(textVal) + '"' +
                    (maxlen ? ' maxlength="' + maxlen + '"' : '') + '>';
        }
        span.outerHTML = editor;
    });

    // 替换编辑按钮为 Save / Cancel
    editBtn.outerHTML =
        '<button class="ne-card-save-btn">' + t('Save') + '</button>' +
        '<button class="ne-card-cancel-btn">' + t('Cancel') + '</button>';

    // 绑定 Save
    var saveBtn = cardDiv.querySelector('.ne-card-save-btn');
    if (saveBtn) saveBtn.onclick = function() { saveCardFields(cardDiv); };

    // 绑定 Cancel
    var cancelBtn = cardDiv.querySelector('.ne-card-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = function() { exitCardEditMode(cardDiv); };
}
```

### 第三步：新增 `saveCardFields(cardDiv)` — 收集所有字段值并写入 vault

**文件**: `src/adapter/panel.js` — 新增函数

```javascript
function saveCardFields(cardDiv) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var c = vault.content || {};
    var state = c.state || {};
    var chars = state.characters || {};

    var vals = cardDiv.querySelectorAll('.ne-char-val');
    var hasChanges = false;
    vals.forEach(function(td) {
        var charName = td.getAttribute('data-char');
        var fieldName = td.getAttribute('data-field');
        var fieldType = td.getAttribute('data-type') || 'string';
        var input = td.querySelector('.ne-char-edit');
        if (!charName || !fieldName || !input) return;

        var rawVal = input.value.trim();
        var newVal;
        if (fieldType === 'number') {
            newVal = rawVal === '' ? null : Number(rawVal);
        } else {
            newVal = rawVal === '' ? '' : rawVal;
        }

        if (!chars[charName]) chars[charName] = {};
        var old = chars[charName][fieldName];
        if (old !== newVal) { chars[charName][fieldName] = newVal; hasChanges = true; }
    });

    if (!hasChanges) { exitCardEditMode(cardDiv); return; }

    state.characters = chars;
    c.state = state;

    var getChatId = stored.getChatId;
    write(getChatId(), vault).then(function() {
        updateVaultViewerPopout(getChatId);
    });
}
```

### 第四步：新增 `exitCardEditMode(cardDiv)` — 取消编辑

**文件**: `src/adapter/panel.js` — 新增函数

```javascript
function exitCardEditMode(cardDiv) {
    if (!cardDiv) return;

    // 恢复原始 table
    if (cardDiv._neOrigTableHTML) {
        var table = cardDiv.querySelector('.ne-char-card-body table');
        if (table) table.outerHTML = cardDiv._neOrigTableHTML;
        cardDiv._neOrigTableHTML = null;
    }

    // 恢复编辑按钮
    var saveBtn = cardDiv.querySelector('.ne-card-save-btn');
    var cancelBtn = cardDiv.querySelector('.ne-card-cancel-btn');
    if (saveBtn) saveBtn.outerHTML = cardDiv._neOrigEditBtnHTML || '';
    if (cancelBtn && cancelBtn.parentNode) cancelBtn.remove();

    cardDiv.classList.remove('ne-card-editing');
}
```

**需要在 `enterCardEditMode` 中额外存储**按钮原始 HTML：

```javascript
cardDiv._neOrigEditBtnHTML = editBtn.outerHTML;
```

### 第五步：卡片头 HTML 修改（在 `renderCharacterCard` 中）

**原有头部**（L587-592）：
```javascript
html += '<div class="ne-char-card-header" onclick="this.parentElement.classList.toggle(\'open\')">';
html += '<span class="ne-char-toggle">&#9654;</span>';
html += '<b>' + escapeHtml(name) + '</b> ';
// ...
```

**改为**在头部右侧加编辑按钮（不阻止折叠事件冒泡）：

```javascript
html += '<div class="ne-char-card-header" onclick="this.parentElement.classList.toggle(\'open\')">';
html += '<span class="ne-char-toggle">&#9654;</span>';
html += '<b>' + escapeHtml(name) + '</b> ';
html += '<span class="ne-char-status">' + escapeHtml(card.status || '') + '</span> ';
html += '<span class="ne-char-type">' + (cardType === 'protagonist' ? 'PC' : 'NPC') + '</span>';
html += '<button class="ne-card-edit-btn" data-char="' + escapeHtml(name) + '" data-cardtype="' + escapeHtml(cardType) + '" onclick="event.stopPropagation()" title="Edit character">\u270E</button>';
html += '</div>';
```

`onclick="event.stopPropagation()"` 阻止点击按钮时触发卡片的折叠/展开。

### 第六步：在面板渲染后绑定编辑按钮事件

**文件**: `src/adapter/panel.js` — `updateVaultViewerPopout()` 函数中

在 `ne_character_block_container` 的 innerHTML 赋值后追加：

```javascript
setTimeout(function() {
    var block = getDoc().querySelector('#ne_character_block_container');
    if (!block) return;
    var buttons = block.querySelectorAll('.ne-card-edit-btn');
    buttons.forEach(function(btn) {
        btn.onclick = function(e) {
            e.stopPropagation();
            enterCardEditMode(this);
        };
    });
}, 50);
```

### 第七步：CSS 样式追加

**文件**: `src/adapter/panel.js` — 在现有 `<style>` 块中追加

```css
.ne-card-edit-btn{font-size:0.85em;padding:0 4px;cursor:pointer;opacity:0.6;border:none;background:none;color:var(--SmartThemeBodyColor);margin-left:auto;}
.ne-card-edit-btn:hover{opacity:1;}
.ne-card-save-btn{font-size:0.82em;padding:1px 8px;cursor:pointer;margin-left:auto;background:#4caf50;color:#fff;border:none;border-radius:3px;}
.ne-card-cancel-btn{font-size:0.82em;padding:1px 8px;cursor:pointer;margin-left:4px;background:#f44336;color:#fff;border:none;border-radius:3px;}
.ne-char-edit{width:100%;padding:2px 4px;border:1px solid var(--SmartThemeBorderColor);border-radius:3px;background:var(--black20a);color:var(--SmartThemeBodyColor);font-size:0.82em;}
.ne-char-edit:focus{outline:1px solid var(--SmartThemeEmColor);border-color:var(--SmartThemeEmColor);}
.ne-card-editing .ne-field-label{vertical-align:middle;}
```

保存按钮放在头部的 `margin-left: auto` 位置（和编辑按钮同一行右侧），取消按钮紧随其后。

---

## 影响范围

| 文件 | 改动 | 行数 |
|------|------|------|
| `panel.js` — `renderCharacterCard()` | `<td>` 加 data 属性 + 头部加编辑按钮 | ~15 行 |
| `panel.js` — 新增 `enterCardEditMode()` | 完整函数 | ~55 行 |
| `panel.js` — 新增 `saveCardFields()` | 完整函数 | ~35 行 |
| `panel.js` — 新增 `exitCardEditMode()` | 完整函数 | ~20 行 |
| `panel.js` — `updateVaultViewerPopout()` | 追加编辑按钮事件绑定 | ~10 行 |
| `panel.js` — CSS | 追加样式 | ~8 行 |

**总改动量**: ~145 行，**仅 `panel.js` 一个文件**。

---

## 设计决策

| 决策 | 答案 |
|------|------|
| 编辑粒度？ | **整卡级别**。一个角色卡一个 ✎ 按钮，点击后该卡所有字段都变编辑器。 |
| Save/Cancel 按钮位置？ | **卡片头部**，替换 ✎ 按钮的位置（头部右侧），`margin-left: auto` 推至最右。 |
| 编辑后刷新方式？ | **整板刷新**（`updateVaultViewerPopout`）。status 改变可能影响分组的排序。 |
| Cancel 实现？ | 存储原始 table HTML 字符串，取消时恢复。值从未写入 vault。 |
| 空值 `(未填)` 编辑？ | 编辑器获取空字符串（`''`），用户填入后不再空。 |
| 折叠/展开冲突？ | 编辑按钮用 `event.stopPropagation()` 阻止事件冒泡，不触发展开折叠。 |
| object 类型（inventory）？ | 不在表中渲染，不受影响。 |

---

## 验证

1. 构建 `npm run build` 成功
2. 每个角色卡片头部右侧有 ✎ 按钮
3. 点击 ✎ → 卡片进入编辑模式：所有字段值变为输入框/下拉框，按钮变为 Save + Cancel
4. 修改 1-N 个字段 → 点击 Save → 面板刷新，屏幕显示新值
5. 点击 Cancel → 所有字段恢复原始值，卡面退出编辑模式
6. status enum 字段为 `<select>` 下拉框，列出所有状态选项
7. affection number 字段为 `<input type="number">`，最小 0 最大 100
8. 编辑模式中点击卡片头不触发展开/折叠
