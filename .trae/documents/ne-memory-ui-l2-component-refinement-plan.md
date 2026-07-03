# NE Memory Engine — UI L2 组件精修计划

## Summary

在 L1 视觉毒债清理（Emoji→FA 图标、语义色板、间距体系）基础上，进一步优化组件的视觉层次、交互一致性和无障碍可访问性。重点：aria-label 全覆盖、卡片布局精修、键盘导航支持、表单一致性。

---

## Current State (L1 完成后的 baseline)

| 维度 | 状态 |
|------|------|
| Emoji | 全部替换为 FA6 图标 |
| 语义色板 | `--ne-success/danger/warning/info/muted` 五种 token |
| 硬编码颜色 | 源文件中已清除（仅在 `:root` 定义处存在） |
| 表格斑马纹 | LTM/STM/Usage 表格已有 |
| 按钮过渡 | `.ne-vault-btn`, `.ne-api-btn`, `.ne-tr-btn`, `.menu_button` 已添加 |
| Focus ring | `.ne_vault_btn:focus-visible` 等已添加 |
| Disabled 状态 | 按钮 disabled 样式已添加 |

### L2 需解决的剩余问题

| # | 问题 | 严重度 | 文件 |
|---|------|--------|------|
| 1 | 纯图标按钮缺少 `aria-label`（编辑 ✎、chevron ▶、关闭 ✕） | 🔴 A11y | panel-state-cards.js, panel-init.js |
| 2 | Character/Faction/Quest 卡片视觉层次不够清晰 | 🟡 视觉 | panel-state-cards.js, panel-shared.js |
| 3 | 卡片展开/折叠 chevron 仍用 JS `innerText` 替换 `▶`↔`▾`，非 CSS class toggle | 🟡 交互 | panel-state-cards.js |
| 4 | Quest card toggle 用内联 `onclick` + `style.display` 而非 class toggle | 🟡 交互 | panel-state-cards.js |
| 5 | 按钮 padding 碎片化（1px-10px 不等） | 🟡 视觉 | panel-shared.js, panel-state-cards.js |
| 6 | 键盘无导航（card toggle 只能 click） | 🟡 A11y | panel-state-cards.js |
| 7 | Global State Block 卡片信息密度过高 | 🟡 UX | panel-state-cards.js |
| 8 | 内联编辑行样式与正常行差异过大 | 🟡 视觉 | panel-state-cards.js, panel-shared.js |
| 9 | PC/NPC 角色类型徽章缺乏视觉区分 | 🟢 视觉 | panel-state-cards.js, panel-shared.js |
| 10 | Settings 表单元素风格不统一 | 🟢 视觉 | panel-shared.js |

---

## Proposed Changes

### 改动 1：无障碍 — aria-label 全覆盖

**原则**：所有纯图标交互元素（无文本 label）必须添加 `aria-label`。

**文件**：`panel-state-cards.js`

| 元素 | 当前 | 改为 |
|------|------|------|
| 编辑按钮 | `<button class="ne-card-edit-btn"...>✎</button>` | `<button class="ne-card-edit-btn"... aria-label="${t('Edit')}"><i class="fa-solid fa-pen-to-square"></i></button>` |
| Chevron toggle | `<span class="ne-char-toggle">▶</span>` | `<span class="ne-char-toggle" role="button" tabindex="0" aria-label="${t('Toggle details')}">▶</span>` |
| Faction toggle | `<span class="ne-faction-toggle">▶</span>` | 同上 |
| Quest toggle | `<span class="ne-quest-toggle">▶</span>` | 同上 |
| 内联 Save | `<button...>✔</button>` | `<button... aria-label="${t('Save')}"><i class="fa-solid fa-check"></i></button>` |
| 内联 Cancel | `<button...><i class="fa-solid fa-xmark"></i></button>` | `<button... aria-label="${t('Cancel')}"><i class="fa-solid fa-xmark"></i></button>` |
| 内联 Delete | `<button...><i class="fa-solid fa-trash"></i></button>` | `<button... aria-label="${t('Delete')}"><i class="fa-solid fa-trash"></i></button>` |
| LTM edit btn | `<span class="ne-inline-edit-btn"...>✎</span>` | `<button class="ne-inline-edit-btn"... aria-label="${t('Edit')}"><i class="fa-solid fa-pen-to-square"></i></button>` |
| Drawer close | 已有 FA icon，检查 aria-label | 添加 `aria-label="${t('Close')}"` |

**文件**：`panel-init.js`

| 元素 | 当前 | 改为 |
|------|------|------|
| Close 按钮 | 已有 `✕` | 改为 `<i class="fa-solid fa-xmark"></i>` + `aria-label` |
| Collapse bar | 已有 `title` 属性 | 添加 `role="button" aria-label` |
| Pin toggle | 已有 `title` | 确认 label 关联 |

**文件**：`panel-shared.js` (CSS)

```css
/* 为 span 模拟 button 行为 */
.ne-char-toggle,
.ne-faction-toggle,
.ne-quest-toggle {
  cursor: pointer;
  user-select: none;
}
.ne-char-toggle:focus-visible,
.ne-faction-toggle:focus-visible,
.ne-quest-toggle:focus-visible {
  outline: 2px solid var(--ne-info);
  outline-offset: 2px;
}
```

**风险**：🟡 中。涉及多处 HTML 模板修改，需确保 onclick 绑定不受影响。

---

### 改动 2：卡片组件视觉层次精修

**目标**：让 Character / Faction / Quest 三类卡片在视觉上更清晰地区分，信息层次更分明。

#### 2a. Character Card 改进

**文件**：`panel-state-cards.js` + `panel-shared.js`

**改进项**：
1. PC/NPC 徽章样式统一为 `.ne-char-type-pc` / `.ne-char-type-npc`
2. 卡片 header 左侧状态色条（3px border-left 已有）保持
3. 卡片 body 改为 padding 8px 12px
4. 好感度条添加数值 tooltip

```css
/* panel-shared.js 新增 */
.ne-char-type {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 0.75em;
  font-weight: bold;
  margin-left: 6px;
}
.ne-char-type-pc {
  background: var(--ne-info-bg);
  color: var(--ne-info);
  border: 1px solid var(--ne-info-border);
}
.ne-char-type-npc {
  background: var(--ne-muted-bg);
  color: var(--ne-muted);
  border: 1px solid rgba(136,136,136,0.25);
}

/* Affection bar tooltip */
.ne-affection-bar {
  display: inline-block;
  width: 80px;
  height: 8px;
  background: var(--black50a);
  border-radius: 4px;
  overflow: hidden;
  vertical-align: middle;
  margin-right: 4px;
  cursor: help;
}
```

```js
// panel-state-cards.js: PC/NPC 徽章改为 class 驱动
var typeCls = cardType === 'protagonist' ? 'ne-char-type-pc' : 'ne-char-type-npc';
html += '<span class="ne-char-type ' + typeCls + '">' + (cardType === 'protagonist' ? 'PC' : 'NPC') + '</span>';
```

#### 2b. Faction Card 改进

**改进项**：
1. 隐藏势力用更明确的视觉提示（当前 `opacity: 0.55` 保留）
2. 添加上下文提示 "(从未接触过)"

```css
/* panel-shared.js */
.ne-faction-card.ne-faction-hidden {
  opacity: 0.55;
  border-left-color: var(--ne-muted);
  border-left-style: dashed;
}
.ne-faction-card.ne-faction-hidden:hover {
  opacity: 0.8;
}
```

#### 2c. Quest Card 改进

**改进项**：
1. Done/Failed/Expired 状态的 chevron 和 icon 保持
2. 详细信息区域添加浅色背景区分

```css
.ne-quest-detail {
  background: var(--black10a);
  border-radius: 4px;
  padding: 6px 8px;
}
```

**风险**：🟢 低。主要是 CSS 增强和少量 HTML 模板调整。

---

### 改动 3：卡片展开/折叠 — 统一 CSS class toggle

**问题**：当前 Character/Faction/Quest 卡片 toggle 行为不一致：

| 卡片类型 | 当前方式 | 问题 |
|----------|----------|------|
| Character | `onclick="this.parentElement.classList.toggle('open')"` | ✅ 已用 class |
| Faction | `onclick="this.parentElement.classList.toggle('open')"` | ✅ 已用 class |
| Quest | `onclick="var p=this.parentElement;...d.style.display=..."` | ❌ 用 inline style.display |
| Chevron ▶ | JS 替换 `innerText` | ❌ 不用 CSS transform |

**策略**：统一所有卡片 toggle 为 class-based。

**文件**：`panel-state-cards.js`

```js
// Quest card header: 简化为 class toggle（与 char/faction 一致）
// 当前：
onclick="var p=this.parentElement;p.classList.toggle('open');var d=p.querySelector('.ne-quest-detail');if(d)d.style.display=d.style.display==='block'?'none':'block';"

// 改为：
onclick="this.parentElement.classList.toggle('open')"
```

```css
/* panel-shared.js — quest card 已有 .open 规则，需确保完整 */
.ne-quest-card.open > .ne-quest-detail {
  display: block;
}
.ne-quest-card.open .ne-quest-toggle {
  transform: rotate(90deg);
}
```

**所有 chevron 动画统一**：

```css
/* 确保已有规则覆盖所有 toggle */
.ne-char-toggle,
.ne-faction-toggle,
.ne-quest-toggle {
  display: inline-block;
  transition: transform var(--ne-transition-normal);
  font-size: 10px;
  margin-right: 4px;
}
.ne-char-card.open .ne-char-toggle,
.ne-faction-card.open > .ne-faction-card-header .ne-faction-toggle,
.ne-quest-card.open .ne-quest-toggle {
  transform: rotate(90deg);
}
```

**风险**：🟡 中。Card toggle 逻辑改动需验证展开/折叠行为。

---

### 改动 4：键盘导航支持

**文件**：`panel-shared.js` + `panel-state-cards.js`

**4a. Card header 键盘支持**

当前 card header 用 `<div onclick="...">`，需改为支持 Enter/Space 键：

```js
// 在初始化时（injectBottomDrawerCSS 之后，或在 bootstrap.js 事件绑定阶段）
// 添加全局键盘事件委托
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var target = e.target.closest('.ne-accordion-header, .ne-char-card-header, .ne-faction-card-header, .ne-quest-header');
  if (target && target.getAttribute('role') !== 'button') return; // 如果 tabindex 已设置
  if (target) {
    e.preventDefault();
    target.click();
  }
});
```

**4b. 给可聚焦的交互元素添加 `tabindex`**

| 元素 | 添加 |
|------|------|
| `.ne-char-card-header` | `tabindex="0" role="button"` |
| `.ne-faction-card-header` | `tabindex="0" role="button"` |
| `.ne-quest-header` | `tabindex="0" role="button"` |
| `.ne-accordion-header` | `tabindex="0" role="button"`（当前无 tabindex） |

**风险**：🟡 中。全局键盘事件需放在正确的初始化位置，避免事件冲突。

---

### 改动 5：表单单元素一致性

**文件**：`panel-shared.js` (CSS)

**问题**：
- Settings 输入框用 `background:#fff !important` 硬编码
- 内联编辑行背景色突变
- 多处 `select` 下拉框样式不统一

**改进**：

```css
/* 统一 settings 表单元素 */
#tab-settings input[type=text],
#tab-settings input[type=password],
#tab-settings input[type=number],
#tab-settings textarea,
#tab-settings select {
  background: var(--black20a) !important;
  border: 1px solid var(--SmartThemeBorderColor);
  color: var(--text) !important;
  border-radius: var(--ne-radius-sm);
  padding: 6px 10px;
  font-size: 0.9em;
}
#tab-settings input[type=text]:focus,
#tab-settings input[type=password]:focus,
#tab-settings input[type=number]:focus,
#tab-settings textarea:focus {
  outline: none;
  border-color: var(--ne-info);
  box-shadow: 0 0 0 1px var(--ne-info-border);
}

/* 内联编辑行样式 */
.ne-inline-row input,
.ne-inline-row textarea {
  background: var(--black20a) !important;
  border: 1px solid var(--ne-info-border);
  color: var(--text) !important;
}
```

**风险**：🟢 低。纯 CSS 调整。

---

### 改动 6：Global State Block 信息密度优化

**文件**：`panel-state-cards.js` + `panel-shared.js`

**问题**：Global State 使用紧凑 table 布局，信息量大时不易阅读。

**改进**：
1. 将 label 列宽度从 80px 增加到 90px
2. 长文本自动换行（当前可能被截断）
3. 添加 section 之间的分隔线

```css
.ne-state-global-block .ne-state-global-table td:first-child {
  color: var(--grey-50);
  width: 90px;
  text-align: right;
  white-space: nowrap;
}
.ne-state-global-block + .ne-state-global-block {
  margin-top: 6px;
}
```

**风险**：🟢 低。

---

## Implementation Order

1. **panel-shared.js** — 新增 aria-label 相关 CSS（chevron focus ring 等）+ 统一 toggle 动画 CSS + 表单样式统一 + PC/NPC 徽章 CSS（改动 2a + 3 + 5 + 6）
2. **panel-state-cards.js** — aria-label 全覆盖 + PC/NPC 徽章 HTML + quest toggle 统一 + 键盘 tabindex 添加（改动 1 + 2a + 3 + 4b）
3. **panel-init.js** — Drawer 关闭按钮 aria-label + 内联编辑按钮 label（改动 1）
4. **bootstrap.js** — 全局键盘事件委托注册（改动 4a）
5. **全量验证**

---

## Assumptions & Decisions

| # | 决策 | 理由 |
|---|------|------|
| 1 | 键盘事件用全局委托而非每个元素绑定 | 减少性能开销，统一管理 |
| 2 | PC/NPC 使用 info/muted 色系 | 与已有 5 色语义体系一致 |
| 3 | Settings 输入框背景改为 `--black20a` | 在深色/浅色主题下均可用 |
| 4 | ❌ 不修改 Chevr 的 `▶` 字符本身 | 已在 L1 决策保留功能性字符 |
| 5 | ❌ 不引入 skeleton screen | 属 L3 范畴 |
| 6 | ❌ 不修改 Chart.js 配置 | 已在 L1 决策中排除 |

---

## Verification

- [ ] 所有纯图标按钮有 `aria-label` 或等效 title
- [ ] Card 展开/折叠（char/faction/quest）统一使用 class toggle + CSS transform
- [ ] Tab 键可在 card headers 间导航，Enter/Space 可展开/折叠
- [ ] PC/NPC 徽章有视觉区分
- [ ] Settings 表单元素风格统一
- [ ] Chevron ▶ 在所有卡片类型中旋转动画一致（200ms）
- [ ] 三种卡片（char/faction/quest）在折叠/展开状态下视觉层次清晰
- [ ] 无 console error（aria-label 引用 t() 函数无空值）
