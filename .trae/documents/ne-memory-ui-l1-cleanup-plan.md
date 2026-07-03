# NE Memory Engine — UI L1 视觉毒债清理计划

## Summary

对 NE Memory Engine 扩展面板进行系统性 UI "毒债"清理，在不改动业务逻辑的前提下，统一视觉语言、替换 Emoji 为 SVG 图标、建立语义色板与间距/字号体系。改动范围集中在 CSS 层和少量 HTML 模板字符串。

---

## Current State Analysis

### 产品定位
- 产品类型：AI 工具 / 记忆管理引擎
- 目标用户：SillyTavern 深度用户
- 推荐风格：Minimalism & Swiss Style（功能优先、清晰、专业）
- 运行环境：SillyTavern iframe 内嵌面板（底部抽屉 + 右侧弹出窗口两种模式）

### 核心问题矩阵

| 规则类别 | 优先级 | 问题数 | 典型表现 |
|----------|--------|--------|----------|
| Style Selection (No Emoji Icons) | CRITICAL | ~20+ 处 | Tab、标题、Usage 统计卡片大量使用 Emoji |
| Accessibility (aria-label, focus) | CRITICAL | ~15 处 | 纯图标按钮无 aria-label |
| Touch & Interaction | CRITICAL | ~8 处 | 按钮 padding 过小，无 hover 过渡 |
| Spacing Scale (4px grid) | HIGH | ~15 种不同值 | 1px~24px 共 13 种间距混用 |
| Font Scale | MEDIUM | ~14 种不同值 | 0.7em~1.3em 过度碎片化 |
| Color (semantic tokens) | MEDIUM | ~30 处硬编码 | #4caf50/#f44336/... 反复出现 |
| Animation | MEDIUM | ~5 处不一致 | 有的用 CSS transition，有的用 JS innerHTML 替换 |

### 关键文件

| 文件 | 角色 | 行数 |
|------|------|------|
| `src/adapter/panel-shared.js` | CSS 主文件 (injectBottomDrawerCSS) | ~270 行 CSS |
| `style.css` | 外部样式表 | 495 行 |
| `src/adapter/panel-init.js` | HTML 模板（含 Emoji） | 534 行 |
| `src/adapter/panel-state-cards.js` | 组件 HTML 渲染 | 684 行 |
| `src/adapter/panel-usage.js` | Usage Tab（含 Emoji + Chart） | 204 行 |
| `src/adapter/panel-settings.js` | Settings Tab（含 Emoji） | 321 行 |
| `src/adapter/panel-drawer.js` | 抽屉逻辑 + Quick Index | 197 行 |

### SillyTavern CSS 变量（已验证可用）

```css
--SmartThemeBlurTintColor  /* 面板背景色 */
--SmartThemeBorderColor    /* 默认边框色 */
--SmartThemeBodyColor      /* 正文字色 */
--SmartThemeEmColor        /* 强调色 */
--SmartThemeQuoteColor     /* 引用色（偏暖棕） */
--text                     /* 通用文本色 */
--grey-50, --grey-60, --grey-70  /* 各级灰色 */
--black10a ~ --black70a    /* 半透明黑色叠层 */
--mainFontSize             /* 主字号 */
--monoFontFamily           /* 等宽字体族 */
```

---

## Proposed Changes

### 决策 0：图标方案选择

**方案**：扩展 SillyTavern 已有的 Font Awesome 6 图标库，不引入新的 CDN 依赖。

**理由**：
- SillyTavern 已加载 FA6 (`fa-solid`)，无需额外 CDN
- 零成本、零加载延迟
- 与宿主 UI 保持图标一致性
- 只需查表替换 Emoji → FA class name

**Emoji → FA 映射表**：

| 当前 Emoji | 含义 | FA 替换 |
|-----------|------|---------|
| 📊 | 图表/统计 | `fa-chart-bar` 或 `fa-table` |
| 📅 | 日期 | `fa-calendar-days` |
| ⚙ | 引擎/设置 | `fa-gears` |
| 🔄 | 刷新/同步 | `fa-rotate` |
| 👤 | 用户 | `fa-user` |
| 🔌 | API 连接 | `fa-plug` |
| 📋 | 列表 | `fa-list-check` |
| 📈 | 趋势图 | `fa-chart-line` |
| ⚡ | API 状态 | `fa-bolt` / `fa-bolt-lightning` |
| 📌 | 固定 | `fa-thumbtack` |
| 🗑️ | 删除 | `fa-trash` |
| ⭐ | 常用设置 | `fa-star` |
| 🔬 | 高级设置 | `fa-flask` |
| ◉ / ● | 状态点 | 保留（非装饰性） |
| ▶ / ▾ / ▷ / ◇ | 展开箭头 | 保留（功能性） |
| ✎ / ✔ / ✖ | 编辑/保存/取消 | 保留或改为 FA `fa-pen`/`fa-check`/`fa-xmark` |
| 角色/任务/势力 标题前图标 | 可考虑 `fa-user-group`/`fa-list-check`/`fa-flag` |

---

### 改动 1：建立 CSS 变量体系（新增 `:root` 块）

**文件**：`style.css`（开头插入）

**内容**：

```css
:root {
  /* ── Semantic Color Tokens ── */
  --ne-success: #4caf50;
  --ne-success-bg: rgba(76, 175, 80, 0.12);
  --ne-success-border: rgba(76, 175, 80, 0.25);
  --ne-warning: #ff9800;
  --ne-warning-bg: rgba(255, 152, 0, 0.10);
  --ne-warning-border: rgba(255, 152, 0, 0.22);
  --ne-danger: #f44336;
  --ne-danger-bg: rgba(244, 67, 54, 0.10);
  --ne-danger-border: rgba(244, 67, 54, 0.22);
  --ne-info: #2196f3;
  --ne-info-bg: rgba(33, 150, 243, 0.10);
  --ne-info-border: rgba(33, 150, 243, 0.22);
  --ne-muted: #888;
  --ne-muted-bg: rgba(136, 136, 136, 0.08);

  /* ── Spacing Scale (4px base) ── */
  --ne-space-xs: 4px;
  --ne-space-sm: 8px;
  --ne-space-md: 12px;
  --ne-space-lg: 16px;
  --ne-space-xl: 20px;
  --ne-space-2xl: 24px;
  --ne-space-3xl: 32px;

  /* ── Font Size Scale ── */
  --ne-text-xs: 0.75em;
  --ne-text-sm: 0.82em;
  --ne-text-base: 0.9em;
  --ne-text-lg: 1em;
  --ne-text-xl: 1.1em;

  /* ── Border Radius ── */
  --ne-radius-sm: 4px;
  --ne-radius-md: 6px;
  --ne-radius-lg: 8px;

  /* ── Transition ── */
  --ne-transition-fast: 0.15s ease;
  --ne-transition-normal: 0.2s ease;
}
```

**风险**：🟢 低。仅新增变量，不改已有规则。

---

### 改动 2：替换 injectBottomDrawerCSS() 中的硬编码颜色和间距

**文件**：`src/adapter/panel-shared.js`
**函数**：`injectBottomDrawerCSS()`

**替换规则**：

| 搜索模式 | 替换为 | 影响选择器 |
|----------|--------|-----------|
| `#4caf50` | `var(--ne-success)` | .ne-api-dot.ok, .ne-tr-btn.ok, .ne-inline-save, .ne-tr-pass, .ne-tr-btn.ok:hover |
| `#f44336` | `var(--ne-danger)` | .ne-tr-fail, .ne-card-cancel-btn |
| `#ff9800` | `var(--ne-warning)` | (出现在 render 函数中，CSS 层较少) |
| `#2196f3` | `var(--ne-info)` | .ne-quest-card.status-progress |
| `#888` / `color:var(--grey-50)` | 保留，但确保对比度 | 多处 mute 文本 |
| `rgba(76,175,80,.15)` | `var(--ne-success-bg)` | .ne-state-badge.* |
| `margin:4px 0` 等 | `margin:var(--ne-space-xs) 0` | 全局 |
| `padding:8px 10px` 等 | `padding:var(--ne-space-sm) var(--ne-space-md)` | .ne-*-card |
| `border-radius:6px` | `border-radius:var(--ne-radius-md)` | 卡片、容器 |
| `border-radius:3px` | `border-radius:var(--ne-radius-sm)` | 徽章、按钮 |

**同时新增全局规则**：

```css
/* 统一按钮 hover/active 过渡 */
.ne-vault-btn, .ne-api-btn, .ne-tr-btn, .menu_button {
  transition: background var(--ne-transition-fast), opacity var(--ne-transition-fast);
}

/* 统一表格斑马纹 */
.narrative_memory_table tr:nth-child(even),
.ne-usage-chat-table tr:nth-child(even) {
  background: var(--black10a);
}

/* 统一 accordion chevron 动画 */
.ne-accordion-chevron {
  transition: transform var(--ne-transition-normal);
}
```

**风险**：🟡 中。CSS 改动量大但语义等价，需逐色对比验证。

---

### 改动 3：替换 HTML 模板中的 Emoji

**文件**：`src/adapter/panel-init.js`
**函数**：`renderVaultPanel()`

**具体替换**：

| 行号 | 当前 | 替换 |
|------|------|------|
| 58 | `<h3>...Memory Vault</h3>` | 无需改标题文字 |
| 71 | `fa-solid fa-brain` | 保留（已是 SVG icon） |
| 72 | `fa-solid fa-wrench` | 保留 |
| 73 | `fa-solid fa-gear` | 保留 |
| 74 | `📊 ` + Usage | `<i class="fa-solid fa-chart-simple"></i> ` (移除 Emoji) |
| 77 | `Loading...` | 无需改 |
| 107 | `📊 This Session...` → Usage tab | 在 panel-usage.js 中 |
| 152 | `⭐ ` + Common Settings | `<i class="fa-solid fa-star"></i> ` |
| 155 | `🔬 ` + Advanced Settings | `<i class="fa-solid fa-flask"></i> ` |
| 134 | `🔌 ` (虽然没有直接出现，在 settings 中) | 替换为 `fa-plug` |

**同时更新 tab 导航图标**：

```js
// 当前
'<div class="ne-vault-tab" data-tab="usage">📊 ' + t('Usage') + '</div>'
// 改为
'<div class="ne-vault-tab" data-tab="usage"><i class="fa-solid fa-chart-simple"></i> ' + t('Usage') + '</div>'
```

**风险**：🟢 低。纯 HTML 字符串替换，不涉及逻辑。

---

### 改动 4：替换 panel-usage.js 中的 Emoji

**文件**：`src/adapter/panel-usage.js`
**函数**：`renderUsageTab()`

**所有卡片标题 Emoji 替换**：

```js
// Section titles
'📊 ' → '<i class="fa-solid fa-chart-bar"></i> '
'📈 ' → '<i class="fa-solid fa-chart-line"></i> '
'📋 ' → '<i class="fa-solid fa-list-check"></i> '

// Card values
'🔄 ' → '<i class="fa-solid fa-arrows-rotate"></i> '
'📅 ' → '<i class="fa-solid fa-calendar-days"></i> '
'📊 ' → '<i class="fa-solid fa-table"></i> '
'⚙ '  → '<i class="fa-solid fa-gears"></i> '
'👤 ' → '<i class="fa-solid fa-user"></i> '
```

**风险**：🟢 低。

---

### 改动 5：替换 panel-state-cards.js 中的 UI 问题

**文件**：`src/adapter/panel-state-cards.js`

**问题项**：

1. **编辑按钮 (✎)**：`&#9998;` → `<i class="fa-solid fa-pen-to-square"></i>`
2. **角色类型徽章 PC/NPC**：给 `<span class="ne-char-type">` 增加统一的 `border-radius`, `padding`, `font-size`
3. **Faction/Quest 卡片** 的 `▶` 展开箭头保持（功能性），但确保 CSS 用 `transform` 而非 JS 替换
4. **状态徽章颜色**：将硬编码 `#4caf50` / `#f44336` 替换为 CSS 变量
5. **好感度条 (Affection bar)**：动画从 `width` 改为仍用 `width`（因为需要百分比填充），但确保父容器有固定 `width`

**风险**：🟡 中。涉及 HTML 生成逻辑，需确保不影响编辑/保存功能。

---

### 改动 6：替换 panel-settings.js 中的 Emoji

**文件**：`src/adapter/panel-settings.js`

**替换项**：

```js
'⭐ ' + t('Common Settings') → '<i class="fa-solid fa-star"></i> '
'🔬 ' + t('Advanced Settings') → '<i class="fa-solid fa-flask"></i> '
```

已经在 panel-init.js 的 HTML 模板中处理，panel-settings.js 中的 `renderSettingsTab()` 只负责填充内容区域，不产生 Emoji 标题（标题在 panel-init.js 中）。确认后可能无需改动。

**风险**：🟢 低。

---

### 改动 7： style.css 清理和增强

**文件**：`style.css`

**操作**：

1. **删除重复的 `.narrative_memory_table` 规则块**（第 41-52 行和第 126-151 行重复定义）
2. **合并表头样式**
3. **添加 CSS 变量引用**到已有硬编码颜色
4. **增加统一的 disabled 状态样式**
5. **修正 focus 样式**：给 `.ne_vault_btn:focus-visible`, `.ne-api-btn:focus-visible` 添加可见 outline

**改动清单**：

```css
/* 新增：统一 focus ring */
.ne_vault_btn:focus-visible,
.ne-api-btn:focus-visible,
.ne-vault-tab:focus-visible,
.ne-accordion-header:focus-visible {
  outline: 2px solid var(--ne-info);
  outline-offset: 1px;
}

/* 新增：统一 disabled 状态 */
.ne_vault_btn:disabled,
.ne-api-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 修正：合并重复的 .narrative_memory_table */
/* 删除第 41-52 行块，保留第 126-151 行块 */
```

**风险**：🟢 低。CSS 清理，不影响功能。

---

### 改动 8：accordion chevron 动画统一

**影响文件**：
- `src/adapter/panel-shared.js` CSS 层（`.ne-accordion-chevron` 已有 transform，需确保生效）
- `src/adapter/panel-drawer.js` 及 `panel-state-cards.js` 中通过 JS 手动替换 `▶`/`▾` 的逻辑

**策略**：
- 所有属于 `.ne-accordion` 体系的 chevron 统一用 CSS transform
- 对于不在 accordion 体系中的卡片 toggle（如 `.ne-char-card`、`.ne-faction-card`、`.ne-quest-card`），确保 CSS 规则存在
- 检查 `panel-state-cards.js` 中的 `renderFactionCard` / `renderQuestCard`：它们当前用 JS 替换 innerText，需改为 CSS class toggle

**风险**：🟡 中。涉及 JS 交互逻辑微调。

---

### 改动 9：表格可读性增强

**影响文件**：`src/adapter/panel-shared.js` (injectBottomDrawerCSS)

**新增规则**：

```css
/* 所有表格斑马纹 */
.narrative_memory_table tr:nth-child(even),
.narrative_ltm_sub_table tr:nth-child(even),
.ne-usage-chat-table tr:nth-child(even) {
  background: var(--black10a);
}

/* 统一行 hover 效果 */
.narrative_memory_table tbody tr:hover,
.narrative_ltm_sub_table tbody tr:hover,
.ne-usage-chat-table tr:hover {
  background: var(--black20a) !important;
  transition: background var(--ne-transition-fast);
}

/* STM 子表统一样式 */
.narrative_ltm_sub_table {
  border-radius: var(--ne-radius-sm);
  overflow: hidden;
}
```

**风险**：🟢 低。

---

### 改动 10：按钮样式统一

**影响文件**：`src/adapter/panel-shared.js`

**统一标准**：
- 最小点击区域：`padding: 6px 14px`（约 28x32px 视觉区域，满足桌面端）
- 统一 `border-radius: var(--ne-radius-sm)`
- 统一 `font-size: var(--ne-text-sm)`
- 统一 `cursor: pointer`（已有）
- 新增 `transition` 到所有按钮类

**风险**：🟢 低。

---

## Assumptions & Decisions

| # | 决策 | 理由 |
|---|------|------|
| 1 | 不引入新 CDN，使用 FA6 | SillyTavern 已加载，零成本 |
| 2 | 不改业务逻辑，只改 CSS + HTML 字符串 | 降低回归风险 |
| 3 | 色板沿用 Material Design 的 success/warning/danger/info 四色语义 | 行业惯例，用户无可学习成本 |
| 4 | 间距基准 4px（而非 8px）| 面板空间有限，4px 更灵活 |
| 5 | 字号保留 em 单位 | 尊重 SillyTavern 的缩放体系 |
| 6 | L1 不改 Chart.js 配置 | chart 颜色保留硬编码（Chart.js 不方便用 CSS 变量） |
| 7 | 不在此次计划中引入 aria-label | 属于 L2 层改动（需改动 JS 逻辑生成属性），留待后续 |

---

## Implementation Order

按依赖关系和风险从低到高排序：

1. **style.css** — 新增 CSS 变量 (`:root` 块) + 合并重复规则 + focus ring (改动 1 + 7)
2. **panel-shared.js** — injectBottomDrawerCSS 中替换颜色/间距为 CSS 变量 + 表格+按钮增强 (改动 2 + 9 + 10)
3. **panel-init.js** — HTML 模板 Emoji 替换 (改动 3)
4. **panel-usage.js** — Usage Tab Emoji 替换 (改动 4)
5. **panel-state-cards.js** — 状态卡片 Emoji/颜色替换 + accordion 动画统一 (改动 5 + 8)
6. **panel-settings.js** — 确认无遗漏 (改动 6)
7. **全量验证** — 检查所有 CSS 变量引用有效、Emoji 已清除、无布局破坏

---

## Verification

- [ ] 所有 Emoji 已替换为 FA icon（grep `📊|📅|📈|📋|🔄|👤|⚙|🔬|⭐|🔌|🗑️` 无残留，状态点 `◉●▶▾` 除外）
- [ ] CSS 变量 `:root` 块正常渲染（DevTools 检查 computed styles）
- [ ] 色板一致性：所有 success/warning/danger/info 颜色统一使用 CSS 变量
- [ ] 间距一致性：主要 padding/margin 使用 `var(--ne-space-*)`
- [ ] 表格斑马纹在 STM/LTM/Usage 表中均可见
- [ ] Accordion chevron 动画流畅（200ms ease transform）
- [ ] 按钮 hover/active 过渡正常
- [ ] 非 Emoji 功能字符（▶ ▾ ◉ ● ✎ ✔ ✖）保留正常
- [ ] 面板在底部抽屉和弹出窗口两种模式下均正常
- [ ] SillyTavern 深色/浅色主题均兼容
