# NE-Memory L3 终稿 UI/UX 润色计划

## 概述

基于 ui-ux-pro-max 技能指南，对 NE-Memory 插件进行最后一轮 UI/UX 润色。L3 核心功能已全部实现（Toast、Confirm、Skeleton、Empty/Error 状态、手势关闭、动画、Reduced Motion），本轮聚焦于一致性、可访问性和交互细节的精修。

**ui-ux-pro-max 优先级映射：Accessibility (CRITICAL) > Touch & Interaction (CRITICAL) > Performance (HIGH)**

---

## 当前状态分析

### 已完成的 L3 特性
- CSS Design Tokens、Toast 通知、Confirm 对话框、Skeleton 骨架屏
- Empty/Error 状态、移动端手势关闭、面板动画 (transform-based)
- Reduced Motion 支持、Shadow DOM 隔离、微交互 (scale-feedback)
- 移动端 ResizeObserver 响应式

### 待修复问题
1. Design Token 在两处定义且值不一致（style.css vs panel-shared.js）
2. 部分按钮缺少 `:active` 按压反馈
3. 存在硬编码中文字符串，未走 i18n
4. Memory Tab 无搜索/过滤功能
5. 键盘导航不完整（Esc 关闭面板、Accordion Enter/Space 支持）
6. Toast 颜色硬编码，未引用 Design Token

---

## 修复项详情

### 修复 1：Design Token 一致性

**涉及文件：** `style.css`、`src/adapter/panel-shared.js`

**冲突对照及采纳值：**

| Token | style.css (当前) | panel-shared.js (当前) | 采纳值 | 理由 |
|-------|---------|---------|--------|------|
| `--ne-warning` | `#ff9800` | `#f0ad4e` | `#f0ad4e` | 更柔和，暗色主题下更可读 |
| `--ne-warning-bg` | `rgba(255,152,0,0.10)` | `rgba(240,173,78,0.12)` | `rgba(240,173,78,0.12)` | 与主色匹配 |
| `--ne-warning-border` | `rgba(255,152,0,0.22)` | `rgba(240,173,78,0.3)` | `rgba(240,173,78,0.3)` | 与主色匹配 |
| `--ne-danger` | `#f44336` | `#e53935` | `#e53935` | Material Design error red |
| `--ne-danger-bg` | `rgba(244,67,54,0.10)` | `rgba(229,57,53,0.12)` | `rgba(229,57,53,0.12)` | 与主色匹配 |
| `--ne-danger-border` | `rgba(244,67,54,0.22)` | `rgba(229,57,53,0.3)` | `rgba(229,57,53,0.3)` | 与主色匹配 |
| `--ne-radius-md` | `6px` | `8px` | `8px` | ui-ux-pro-max 推荐现代 UI |
| `--ne-radius-lg` | `8px` | `12px` | `12px` | 层级区分更明显 |
| `--ne-transition-fast` | `0.15s ease` | `0.15s` | `0.15s` | 不内置 ease，由使用处指定 |
| `--ne-transition-normal` | `0.2s ease` | `0.2s` | `0.2s` | 同上 |

**style.css 改动：**
- 统一上述 token 值为面板侧版本
- 新增 `--ne-easing-standard`、`--ne-easing-decelerate`、`--ne-easing-accelerate`、`--ne-transition-slow`、`--ne-shadow-sm`、`--ne-shadow-md`、`--ne-skeleton-base`、`--ne-skeleton-shimmer`、`--ne-z-overlay`（从 panel-shared.js 抽取到全局）
- `--ne-info-bg` 从 `rgba(33,150,243,0.10)` 改为 `rgba(33,150,243,0.12)`

**panel-shared.js 改动：**
- 从 `injectBottomDrawerCSS()` 的 `:host` 块中移除可继承的 token 定义（CSS 自定义属性穿透 Shadow DOM boundary）
- 仅保留 `--ne-skeleton-base` / `--ne-skeleton-shimmer`（引用 ST 主题变量，Shadow DOM 内需重新绑定）

---

### 修复 2：Touch/Press 反馈增强

**涉及文件：** `src/adapter/panel-shared.js`

**问题：** 仅有 `.ne-vault-btn`、`.ne-api-btn`、`.menu_button` 有 `:active` 缩放反馈，大量交互元素缺失。

**方案：** 在 `injectBottomDrawerCSS()` 现有 `:active` 规则后追加组合选择器：

```css
.ne_vault_btn_small:active,.ne_vault_btn_tiny:active,
.ne-confirm-btn:active,.ne-inline-save:active,.ne-inline-cancel:active,.ne-inline-delete:active,
.ne-settings-save-btn:active,.ne-tr-btn:active,
.ne-card-edit-btn:active,.ne-card-save-btn:active,.ne-card-cancel-btn:active,
.ne-inline-edit-btn:active,.ne-error-retry:active,
.ne-index-item:active,.ne-vault-tab:active,.ne-vault-collapse-bar:active{
  transform:scale(.97);
  transition:transform .1s var(--ne-easing-standard);
}
```

**符合 ui-ux-pro-max 规则：** `scale-feedback` (0.95-1.05 范围)，`tap-feedback-speed` (100ms 内反馈)

---

### 修复 3：i18n 硬编码中文字符串

**涉及文件：** `src/core/i18n.js`、`src/adapter/panel-state-cards.js`、`src/adapter/panel-drawer.js`、`src/adapter/panel-init.js`

**新增 i18n key（i18n.js 三语）：**

```
'count_label'       → en: ' entries', zh-cn: '条', zh-tw: '條'
'in_progress_label' → en: ' [In Progress]', zh-cn: ' [进行中]', zh-tw: ' [進行中]'
'turns_suffix'      → en: ' turns', zh-cn: '轮', zh-tw: '輪'
'status_unknown'    → en: 'Unknown', zh-cn: '未知', zh-tw: '未知'
'empty_value'       → en: '(Not filled)', zh-cn: '(未填)', zh-tw: '(未填)'
'hidden_faction'    → en: 'Not contacted', zh-cn: '未接触', zh-tw: '未接觸'
```

**panel-state-cards.js 改动：**
- 角色状态比较（`'活跃'`、`'已退场'`）：改为同时匹配各语言翻译值
- 显示文本（`'(未填)'`、`'条'`、`'[进行中]'`）：替换为 `t()` 调用
- 势力态度比较（`'友好'`、`'敌对'`）：改为标准化 key 比较

**panel-drawer.js 改动：**
- 快速索引标签：`'角色'` → `t('Characters')`、`'任务'` → `t('Tasks')`、`'势力'` → `t('Factions')`

**panel-init.js 改动：**
- 轮次后缀：`'\u8f6e'` → `t('turns_suffix')`

---

### 修复 4：Memory Tab 搜索/过滤

**涉及文件：** `src/adapter/panel-init.js`、`src/adapter/panel-shared.js`

**方案：**
- 在 `#ne_quick_index` 之前添加搜索输入框（带 `aria-label="Search memory entries"`）
- `panel-shared.js` 中添加 `.ne-search-hidden { display:none!important }` 样式
- `panel-init.js` 中绑定 `oninput` 事件，按 `textContent` 实时过滤 STM/LTM 行和角色/势力/任务卡片

**符合 ui-ux-pro-max 规则：** `search-accessible`（搜索必须易于触达）

---

### 修复 5：键盘导航增强

**涉及文件：** `src/adapter/panel-init.js`、`src/adapter/panel-drawer.js`

**A. Esc 关闭面板**
在 `renderVaultPanel()` 末尾注册全局 `keydown` 监听：
- 仅当 `#ne_vault_bottom_overlay` 存在且 `.open` 时触发
- 注意与 `showConfirm()` 内部 Esc 处理器不冲突（确认弹窗 Esc 在自己的 overlay 上注册）

**B. Accordion Enter/Space**
在 overlay 上委托 `keydown` 事件：
- 检测 Enter/Space 键
- 通过 `composedPath()` 找到最近的 `.ne-accordion-header`
- 执行 `.click()`

**符合 ui-ux-pro-max 规则：** `escape-routes` (CRITICAL)、`keyboard-nav`

---

### 修复 6：Toast Shadow DOM 颜色 Token 化

**涉及文件：** `src/adapter/panel-shared.js`

**方案：** `_ensureToastCss()` 中 toast 类型颜色从硬编码改为 CSS 变量引用：

```css
.ne-toast.success{background:var(--ne-success);}
.ne-toast.error{background:var(--ne-danger);}
.ne-toast.warning{background:var(--ne-warning);color:#333;}
.ne-toast.info{background:var(--ne-info);}
```

配合修复 1 的 Token 统一，Toast 颜色与面板内语义色完全一致。

---

## 实施顺序

```
Phase 1（独立，可并行）：
  ├── 修复 1: Design Token 一致性
  ├── 修复 4: 搜索/过滤功能
  └── 修复 5: 键盘导航增强

Phase 2（依赖 Phase 1）：
  ├── 修复 2: Touch 反馈增强
  └── 修复 6: Toast 颜色 Token 化

Phase 3（独立）：
  └── 修复 3: i18n 硬编码替换
```

---

## 假设与决策

- CSS 自定义属性可穿透 Shadow DOM boundary — 已在实际使用中验证
- LLM 输出中文状态值的角色在英文界面仍可通过 fallback 机制正确分组
- 搜索过滤使用简单的 `textContent.indexOf` 足够（记忆数据量通常 < 500 条）
- Esc 全局监听不会与 ST 内置快捷键冲突（仅在 overlay 可见时生效）

---

## 验证步骤

1. `npm run build` 构建通过，无报错
2. 切换 ST 语言设置，确认面板中所有标签正确切换
3. 打开面板按 Esc → 面板关闭；Tab 遍历所有交互元素 → 顺序合理
4. Accordion header 聚焦后按 Enter/Space → 正常展开/折叠
5. 搜索框输入关键词 → STM/LTM/卡片实时过滤，清空恢复
6. 逐一点击各类型按钮 → 均有 scale(0.97) 按压反馈
7. API 测试触发 toast → 颜色与面板内 warning/danger/success 色一致
8. Reduced Motion 开启时动画降级正常
