# L3: 体验增强 — 实施计划

## Summary

在 L1（视觉毒债清理）和 L2（组件精修 + Shadow DOM 架构）的基础上，L3 聚焦最终用户体验打磨：动画过渡、骨架屏、统一反馈、移动端手势、无障碍收尾。改动范围集中在 CSS 变量系统扩展、面板动画重写、三个新通用组件（skeleton/toast/confirm），约 8 个文件。

## Current State Analysis

### 已有基础（L1/L2 成果）
- CSS 语义色彩变量 5 组（success/warning/danger/info/muted）完整
- 2 个过渡时长变量（`--ne-transition-fast` 0.15s / `--ne-transition-normal` 0.2s）
- transition 覆盖主要交互元素（tab、accordion、button、table row）约 23 处
- Shadow DOM 架构完整，`composedPath()` 事件委托正常工作
- ResizeObserver 驱动 `.ne-mobile` class 响应式切换
- 1 个 `@keyframes ne_spin` 用于 Pipeline 活动指示器
- 全局键盘事件委托（Enter/Space 展开卡片）在 `bootstrap.js`

### 缺失清单（按优先级）

| 缺失项 | UX 分类 | 优先级 | 影响面 |
|--------|---------|--------|--------|
| `prefers-reduced-motion` | Accessibility #1 | CRITICAL | 全部 24 个动效点 |
| 面板开关动画（display→transform）| Animation #7 | HIGH | 打开/关闭体验 |
| 骨架屏 loading | Performance #3 + Animation #7 | HIGH | 所有数据加载等待 |
| 统一 Toast 封装 | Forms & Feedback #8 | MEDIUM | 7 处散落 toastr 调用 |
| 自定义确认对话框 | Forms & Feedback #8 | MEDIUM | 13 处原生 confirm() |
| CSS 变量补充（easing/radius/shadow/z-index）| Typography & Color #6 | MEDIUM | 全局样式一致性 |
| 空状态图标 + 操作引导 | Forms & Feedback #8 | MEDIUM | 6 处空状态 |
| 错误恢复按钮 | Forms & Feedback #8 | MEDIUM | 5 处 alert() / 错误文本 |
| 微交互（ripple/haptic-like feedback）| Touch #2 | LOW | 全部按钮 |
| `touch-action: manipulation` | Touch #2 | LOW | 移动端点击延迟 |

## Proposed Changes

### Phase 1: CSS 基础设施扩展（1 文件）

**文件**: `src/adapter/panel-shared.js` — `injectBottomDrawerCSS()`

**1.1 新增 CSS 变量**（`:host` / `:root` 块）

```
--ne-transition-slow: 0.35s
--ne-easing-standard: cubic-bezier(0.4, 0, 0.2, 1)
--ne-easing-decelerate: cubic-bezier(0, 0, 0.2, 1)
--ne-easing-accelerate: cubic-bezier(0.4, 0, 1, 1)
--ne-radius-sm: 4px
--ne-radius-md: 8px
--ne-radius-lg: 12px
--ne-shadow-sm: 0 1px 3px rgba(0,0,0,.12)
--ne-shadow-md: 0 4px 12px rgba(0,0,0,.15)
--ne-skeleton-base: var(--black30a)
--ne-skeleton-shimmer: var(--black50a)
--ne-z-overlay: 1000
```

**1.2 `prefers-reduced-motion` 全局规则**

在 `injectBottomDrawerCSS()` 末尾追加一个 `@media (prefers-reduced-motion: reduce)` 块，将所有 `transition` 和 `animation` 置为 `none` / `0s`：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Why**: 单条规则覆盖所有现有和未来的动效，零侵入。

### Phase 2: 面板动画重写（2 文件）

**2.1 面板打开/关闭使用 transform 过渡**

**文件**: `src/adapter/panel-shared.js` — `injectBottomDrawerCSS()`

覆盖层 CSS 改动：
- 始终 `display: flex`（移除 `display: none` 默认值）
- 默认 `transform: translateY(100%)` → 隐藏
- `.open` 时 `transform: translateY(0)` → 显示
- `transition: transform var(--ne-transition-normal) var(--ne-easing-decelerate)`
- 关闭时使用 `var(--ne-easing-accelerate)`（退出快于进入）

`#chat` 隐藏/显示：改为 `opacity` 过渡（`transition: opacity var(--ne-transition-normal)`）

**文件**: `src/adapter/panel-popout.js` — `createVaultPopout()`

```javascript
// 打开时
overlay.style.display = 'flex';
requestAnimationFrame(function() {
    overlay.classList.add('open');
});
// 关闭时
overlay.classList.remove('open');
overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    overlay.style.display = 'none';
});
```

**Why**: 遵循 ui-ux-pro-max 规则 `transform-performance`（只动画 transform/opacity），`exit-faster-than-enter`（退出快于进入）。

**2.2 面板滚动到顶部**

面板展开后自动 `scrollTop = 0`，避免保留上次滚动位置造成的视觉跳跃。

### Phase 3: 骨架屏组件（1 文件）

**文件**: `src/adapter/panel-shared.js` — 新增 CSS class + 工具函数

**3.1 CSS 骨架屏样式**

```css
.ne-skeleton {
  background: var(--ne-skeleton-base);
  border-radius: var(--ne-radius-sm);
  animation: ne-shimmer 1.5s ease-in-out infinite;
  background-size: 200% 100%;
}
@keyframes ne-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.ne-skeleton-text { height: 1em; margin-bottom: 0.5em; }
.ne-skeleton-text:last-child { width: 60%; }
.ne-skeleton-card { height: 80px; }
.ne-skeleton-row { height: 2em; margin-bottom: 0.3em; }
```

**3.2 工具函数**（`panel-shared.js`）

```javascript
export function showSkeleton(container, type) {
    // type: 'cards' | 'rows' | 'text' | 'chart'
    // 注入对应骨架 HTML
}
```

**3.3 接入点**

| 页面 | 替换 | 骨架类型 |
|------|------|---------|
| Vault panel 初始 loading | `Loading...` 文字 | cards (3 张卡片骨架) |
| Content Tab | 首次空白等待 | rows |
| Usage Tab | `Loading...` / spinner | chart(1) + cards(3) |
| Settings Tab 初次渲染 | 无 loading（同步） | 不适用 |

**Why**: 遵循 `progressive-loading`（骨架屏 > 长 spinner），`lazy-load-below-fold` 精神。

### Phase 4: Toast 封装（1 文件，新建）

**文件**: `src/adapter/panel-shared.js` — 新增 `showToast()` 函数

```javascript
var _toastTimer = null;
export function showToast(message, type, duration) {
    // type: 'success' | 'error' | 'warning' | 'info'
    // 创建 toast DOM，插到 overlay 内
    // slideInUp 进入动画，duration 后 slideOutDown + remove
    // 同一时间只显示一条（替换而非堆叠）
}
```

同时替换现有 7 处 `toastr` 调用为 `showToast()`。

**Why**: 统一 Shadow DOM 内部管理，不依赖外部 toastr；遵循 `toast-accessibility`（aria-live="polite"），`toast-dismiss`（3-5s 自动消失）。

### Phase 5: 自定义确认对话框（1 文件）

**文件**: `src/adapter/panel-shared.js` — 新增 `showConfirm()` 函数

```javascript
export function showConfirm(title, message, confirmLabel, cancelLabel, isDanger) {
    return new Promise(function(resolve) {
        // 创建遮罩 + 对话框 DOM
        // 对话框从 scale(0.9) → scale(1) 弹入
        // 危险操作按钮使用 var(--ne-danger) 色
        // Escape 键 = 取消
        // 焦点自动捕获在对话框内
        // 关闭后 resolve(true/false)
    });
}
```

替换全部 13 处 `window.confirm()` 为 `showConfirm()`。

**Why**: 遵循 `confirmation-dialogs`（确认前阻止），`destructive-emphasis`（危险操作用红色），`escape-routes`（Esc 取消），`modal-escape`（有清晰关闭方式）。

### Phase 6: 空状态 + 错误状态增强（2 文件）

**文件**: `src/adapter/panel-shared.js` — CSS + HTML 模板

```css
.ne-empty-state {
  text-align: center;
  padding: 24px 16px;
  color: var(--ne-muted);
}
.ne-empty-state-icon {
  font-size: 2em;
  margin-bottom: 8px;
  opacity: .5;
}
.ne-empty-state-action {
  margin-top: 12px;
}
.ne-error-state {
  text-align: center;
  padding: 16px;
  color: var(--ne-danger);
}
.ne-error-retry {
  margin-top: 8px;
  cursor: pointer;
}
```

**文件**: `src/adapter/panel-state-cards.js`, `src/adapter/panel-content.js`, `src/adapter/panel-popout.js`

- 空状态添加图标（fa-inbox / fa-folder-open / fa-chart-bar）+ 引导文字
- 错误状态添加"重试"按钮
- Storage 警告区域样式更新

### Phase 7: 微交互增强（1 文件）

**文件**: `src/adapter/panel-shared.js` — CSS 追加

**7.1 全局 touch-action**

```css
.ne-vault-bottom-overlay {
  touch-action: manipulation;
}
```

**7.2 按钮按下反馈**

```css
.ne-vault-btn:active,
.ne-api-btn:active,
.menu_button:active {
  transform: scale(0.97);
  transition: transform 0.1s var(--ne-easing-standard);
}
```

**7.3 输入框 focus 增强**

```css
#tab-settings input:focus-visible,
#tab-settings select:focus-visible {
  outline: 2px solid var(--ne-info);
  outline-offset: -1px;
}
```

### Phase 8: 移动端手势关闭（1 文件）

**文件**: `src/adapter/panel-drawer.js`

在 collapse bar 上添加 `touchstart/touchmove/touchend` 事件：
- 下滑超过 60px → 关闭面板
- 使用 `transform: translateY()` 跟手
- 松手时若未超阈值则弹簧回弹

```javascript
// 仅 .ne-mobile 时绑定
if (document.body.classList.contains('ne-mobile')) {
    // 绑定触摸事件
}
```

---

## Assumptions & Decisions

1. **骨架屏不替换所有 loading** — 仅替换主面板初次加载和 Usage Tab。Tab 之内的小数据加载（切换角色/阵营/任务卡片内的展开细节）保持即时渲染，因为数据已在内存。
2. **Toast 同一时间仅一条** — 不堆叠，新的替换旧的。插件场景下 toast 触发频率低（API 测试、导出、Consolidate），堆叠是过度设计。
3. **confirm 保留异步 Promise 接口** — `showConfirm()` 返回 `Promise<boolean>`，调用方可 `await`，与 `window.confirm()` 的同步阻塞不同。所有调用点改为 `await showConfirm(...)` 模式。
4. **不引入第三方库** — Toast、Confirm、Skeleton 全部用原生 DOM + CSS 实现，零额外依赖，包体增量 < 3KB。
5. **面板动画仅针对覆盖层** — 不修改 `panel-drawer.js` 的 accordion 动画（L2 已做好）。
6. **不引入 haptic feedback** — ST 是 Web 应用，非 PWA/native，Navigator.vibrate 支持不一致。

## Verification Steps

1. `npm run build` 通过，无 JS 错误
2. 打开/关闭面板有 200ms slide-up/slide-down 动画
3. 系统开启"减少动态效果"后，面板切换无动画（瞬间到位）
4. 主面板首次打开时看到 3 张骨架卡片而非 "Loading..."
5. Usage Tab 有骨架图表 + 卡片
6. API 测试按钮点击后，成功/失败用统一 toast 弹窗（而非 toastr）
7. 删除记忆时看到自定义红色确认对话框
8. 无记忆时 Content Tab 显示空状态图标 + 引导文案
9. 移动端 collapse bar 下滑可关闭面板
10. 所有按钮按下时有 0.97 scale 微反馈
