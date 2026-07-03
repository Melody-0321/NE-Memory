# NE Memory Engine UI 架构改进 — 三方案实施计划

## 概要

按风险递增顺序，分三个阶段实施三个架构改进：
1. **阶段一**：pub/sub 状态驱动渲染（低风险，纯调用模式替换）
2. **阶段二**：ResizeObserver 移动端响应式（中风险，新增 JS+少量 CSS）
3. **阶段三**：Shadow DOM 样式隔离（高风险，DOM 查询/CSS/事件委托全部变更）

---

## 核心架构事实（贯穿全计划）

| 事实 | 影响 |
|------|------|
| 插件运行在 iframe 中，UI 操作 parent.document | Shadow DOM 迁移时 shadow host 仍在父文档中，`byId('ne_vault_bottom_overlay')` 不变 |
| 面板挂载于 `#sheld` 末尾 | Shadow Root 附加在 `#ne_vault_bottom_overlay` 上 |
| CSS (~250行) 注入 `parent.document.head`，全局作用域 | 移入 Shadow Root 后与 ST 完全隔离 |
| 事件委托挂 `pdAddEventListener('click')`，使用 `e.target.closest()` | Shadow DOM retargeting 后需改为 `e.composedPath()[0]` |
| `updateVaultViewerPopout` 为单一渲染中枢 | pub/sub 可直接在此埋订阅 |
| CSS 变量 (var(--SmartTheme*)) 被 Shadow DOM 默认继承 | 利好，无需额外处理 |

---

## 阶段一：pub/sub 状态驱动渲染

**风险：低** | **修改量：~60 行**

### 目标
引入 ~30 行的 `stateBus.js`，替换 8 个跨模块的 `updateVaultViewerPopout(getChatId)` 直接调用为 `busEmit('vault:updated', { getChatId })`，解耦数据变更与 UI 刷新。

### 变更文件

#### 1.1 新建 `src/adapter/stateBus.js`

~30 行 EventEmitter：`on(event, fn)` / `off(event, fn)` / `emit(event, payload)`。模块级闭包，无 class，兼容 Rollup IIFE。单 handler crash 不终止其他 handler。

#### 1.2 修改 `panel-shared.js`

文件末尾新增 bridge：
```javascript
import { on as busOn, off as busOff, emit as busEmit } from './stateBus.js';
export { busOn, busOff, busEmit };
```

#### 1.3 修改 `panel-init.js`

| 位置 | 改动 |
|------|------|
| L11 import | 添加 `busOn, busEmit` |
| L46+ 新增 | 两个订阅者：`busOn('vault:updated', ...)` 分别处理 Memory Tab 全量刷新和 Usage Tab 自动刷新 |
| L37-43 | `ne:vault-changed` 防抖回调改为 `busEmit('vault:updated', ...)` |
| L192 | Refresh 按钮 → `busEmit` |
| L204 | Consolidate 完成 → `busEmit` |
| L329 | Process History 完成 → `busEmit` |
| L373 | Import JSON 完成 → `busEmit` |

#### 1.4 修改 `panel-popout.js`

| 位置 | 改动 |
|------|------|
| L7-12 import | 添加 `busEmit`，移除 `updateVaultViewerPopout` import |
| L22 | `createVaultPopout` → `busEmit` |
| L60 | Restore Snapshot → `busEmit` |

#### 1.5 `panel-content.js` — 不变

L245 和 L256 是在 `updateVaultViewerPopout` 函数内部的异步回调中自调用，受 `_updatingPopout` 互斥锁保护。不属于跨模块调用，不纳入 pub/sub。

#### 1.6 修改 `panel-state-cards.js`

| 位置 | 改动 |
|------|------|
| L5 import | 添加 `busEmit` |
| L451 | saveCardFields → `busEmit` |

### 验证

- 打开面板、Refresh、Consolidate、Import JSON 后自动刷新
- 编辑 Character Card 保存后面板刷新
- Pipeline 完成后 300ms 防抖触发刷新
- Usage Tab 在 vault 变更时自动刷新

---

## 阶段二：ResizeObserver 移动端响应式

**风险：中** | **修改量：~50 行**

### 目标
用 JS `ResizeObserver` 监听 `#sheld` 宽度，动态添加/移除 `.ne-mobile` class 到 `#ne_vault_bottom_overlay`（shadow host），CSS 规则据此调整移动端布局。

### 为什么用 JS 而非纯 CSS media query
- CSS `@media` 监听视口宽度，但 `#sheld` 的实际可用宽度可能小于视口（ST 有侧边栏）
- 面板挂载在 `#sheld` 内，`#sheld` 宽度才是面板可用的水平空间
- 移动端按钮遮挡输入框的问题无法通过 media query 解决——需要 JS 动态检测并调整

### 变更文件

#### 2.1 修改 `panel-shared.js` — CSS 规则

在 `injectBottomDrawerCSS` 末尾追加 `.ne-mobile` 规则：
- 移除毛玻璃效果
- 减少 padding（6px 紧凑布局）
- 缩小 accordion header 字号和 padding
- **底部 padding-bottom: 60px** 为输入区域预留空间

#### 2.2 修改 `panel-init.js` — ResizeObserver

在 `renderVaultPanel` 尾部插入 `setupMobileObserver()`：
- 创建 `ResizeObserver` 监听 `#sheld`
- 宽度 ≤ 600px → overlay (`#ne_vault_bottom_overlay`) 添加 `.ne-mobile` class
- 宽度 > 600px → 移除 `.ne-mobile` class
- 浏览器不支持时 catch 异常，静默 fallback
- Observer 引用存储在 `overlay._neResizeObserver` 上

### 验证

- 桌面端 (>600px)：`.ne-mobile` class 不存在
- 缩窄窗口至 ≤600px：class 自动添加，毛玻璃消失，底部留白
- 展开窗口：class 自动移除
- 移动端：底部输入框不被按钮遮挡

---

## 阶段三：Shadow DOM 样式隔离

**风险：高** | **修改量：~170 行**

### 架构变更

```
改造前                          改造后
PD (parent.document)            PD (parent.document)
├── #sheld                      ├── #sheld
│   └── #ne_vault_bottom_       │   └── #ne_vault_bottom_
│       overlay (普通DIV)       │       overlay (SHADOW HOST)
│       ├── collapse-bar        │       └── #shadow-root
│       ├── tab-bar             │           ├── <style> (隔离)
│       └── scroll-area         │           ├── collapse-bar
│           └── ...             │           ├── tab-bar
└── <head>                      │           └── scroll-area
    └── <style> (~250行全局)    │               └── ...
                                └── <head>
                                    (不再有 ne_vault_bottom_style)
```

### 四大挑战与解决方案

| 挑战 | 问题 | 解决方案 |
|------|------|----------|
| DOM 查询 | `byId` 查询 parent document，找不到 shadow root 内的元素 | 新增 `panelById`/`panelQS`/`panelQSA` 三函数，有 shadow root 时查 shadow root，否则 fallback 到 `byId`/`qs` |
| 事件委托 | `pdAddEventListener('click')` 中 `e.target` 被 retarget 为 shadow host，`closest()` 全部失效 | 改用 `e.composedPath()[0]` 获取 shadow DOM 内部真实 target |
| CSS 注入 | 当前 CSS 注入 `parent.document.head`，全局作用域 | CSS 注入目标改为 shadow root，CSS 变量自动继承 |
| 跨边界操作 | 部分 DOM 操作仍需访问父文档（如 `#chat`、`#leftSendForm`） | 保留 `byId`/`qs`/`qsa` 用于父文档查询；新增 `panelXxx` 用于面板内部查询 |

### 变更文件

#### 3.1 修改 `panel-shared.js` — 添加 Shadow DOM 感知层

在 L14 后新增：
- `_panelRoot` 变量（null = 未激活 Shadow DOM）
- `setPanelRoot(root)` / `getPanelRoot()`
- `panelById(id)` / `panelQS(sel)` / `panelQSA(sel)` — 自动路由到 shadow root 或父文档

修改 `injectBottomDrawerCSS` 和 `injectPinCSS` 的最后一行：`pdHead().appendChild(style)` → 如果 `_panelRoot` 存在则注入 shadow root，否则注入父文档 head。

#### 3.2 修改 `panel-init.js` — 创建 Shadow Root

L166-171 注入逻辑改为：
1. 解析 drawerHtml → 提取 `#ne_vault_bottom_overlay`
2. `overlay.attachShadow({ mode: 'open' })` 创建 shadow root
3. 将所有子元素移入 shadow root
4. `setPanelRoot(shadowRoot)` 激活 Shadow DOM 模式
5. `sheld.appendChild(overlay)` 将 shadow host 插入 DOM
6. 浏览器不支持时 catch → fallback 传统模式

事件委托修复（L474-536）：
```javascript
pdAddEventListener('click', function(e) {
    var target = (e.composedPath && e.composedPath()[0]) || e.target;
    var header = target.closest('.ne_log_header');
    // ...
});
```

#### 3.3-3.9 修改所有面板文件：`byId`/`qsa`/`qs` → `panelXxx`

核心原则：**仅面板内部元素的查询**改用 `panelXxx`；ST 页面元素查询保持 `byId`/`qs`/`qsa`。

| 文件 | 面板内部查询 | 父文档查询（不变） |
|------|-------------|-------------------|
| `panel-content.js` | ~20 处 `byId`/`qsa` | — |
| `panel-drawer.js` | ~6 处 | `byId('ne_vault_bottom_overlay')` (shadow host) |
| `panel-popout.js` | ~3 处 | `byId('ne_vault_bottom_overlay')`, `byId('chat')` |
| `panel-state-cards.js` | ~8 处 | — |
| `panel-usage.js` | ~4 处 | — |
| `panel-settings.js` | ~4 处 | — |
| `panel-tools.js` | ~4 处 | — |

### 不受影响的部分

- `events.js` — Banner CSS 注入 iframe 自身 head，`notifyVaultChanged` dispatch 父文档事件
- `style.css` — 设计 tokens，iframe 内部
- Chart.js — iframe 内 `<canvas>`，不受影响
- `renderMemoryButton` — 操作 ST 页面元素，全在父文档

### 验证（14 项）

1. 面板打开/关闭正常
2. 四个 Tab 切换正常
3. Accordion 展开/收起正常，localStorage 持久化
4. STM/LTM 表格渲染正确
5. Character Card 编辑正常
6. Quick Index 导航平滑滚动
7. 5 种卡片 header toggle (LLM log/Char/Faction/Quest/Group) 全部正常
8. Refresh/Consolidate/Process History 按钮正常
9. Pipeline 完成后 300ms 防抖刷新正常
10. DevTools 确认 `.ne-*` CSS 在 shadow root 的 `<style>` 中，不在父文档 `<head>` 中
11. `var(--SmartTheme*)` CSS 变量正确生效
12. Banner CSS 不受影响
13. `.ne-mobile` class 正确工作
14. 移动端按钮不遮挡输入框

---

## 依赖顺序

```
阶段一 (stateBus) → 验证
    ↓
阶段二 (ResizeObserver) → 验证
    ↓
阶段三 (Shadow DOM) → 验证
```

阶段一完成后模块间通过 `stateBus` 通信；阶段二在 shadow host 上建立 `.ne-mobile` class 控制；阶段三在此基础上做 Shadow DOM 隔离，CSS 规则和 class 控制逻辑无缝衔接。

## 假设与决策

1. **不引入框架**：Vue/React 不在此方案中。pub/sub (~30 行) 已足够解耦
2. **不重构渲染函数**：`renderCharacterPanelHTML` 等函数内部逻辑不变，只改查询 API
3. **Shadow DOM 降级策略**：浏览器不支持时 fallback 传统模式，不报错
4. **`#sheld` 作为响应式基准**：而非 `window.innerWidth`，因为面板可用空间由 `#sheld` 决定
5. **bottom padding 60px**：估算值，测试后可调整
