# Plan: 迁移 v0.1.0 完整 UI

## 核心问题
之前所有方案都忽略了关键事实：**TH iframe 中的 `$` 指向父窗口（主 ST 页面）的 jQuery**。我们可以直接操作主页面 DOM，不须要 iframe hack。

## 实现步骤

### Step 1: 重写 vault-panel.js
- 将 drawer 挂载到 `$('#top-settings-holder')`（ST 原生顶栏容器）
- 使用 ST 原生 drawer CSS 类体系：
  - `.drawer` / `.drawer-toggle` / `.drawer-icon` / `.drawer-content`
  - `.fillRight` / `.closedDrawer` / `.openDrawer` / `.closedIcon` / `.openIcon`
- toggle 图标使用 Font Awesome `fa-book`（与其他顶栏图标一致）
- 打开/关闭行为遵循 ST 规范（先关闭其他非锁定 drawer）
- 内容包含：版本、State、Opening、LTM 表格、STM 表格、Refresh 按钮
- **核心逻辑不变**（read vault、renderMemoryTable、formatVaultForPrompt 等）
- **移除** `freezeIframeHeight` hack（不再需要）
- **移除** `toggleVaultPanel` 自定义切换逻辑（改用 ST 原生 drawer toggle）

### Step 2: 重写 config-dialog.js
- 挂载到 `$('#extensions_settings')`（ST 扩展设置容器）
- 使用 ST 原生 `inline-drawer` 组件
- 包含：基本设置（API URL/Key/Model）、遥测开关、连接状态

### Step 3: 移除无效代码
- 移除 `index.js` 中残留的 `injectNEcss()` 相关代码（已不在）
- 确认 `style.css` 中无多余 drawer 样式（ST 原生样式已覆盖）

### Step 4: 构建并推送
- `npm run build`
- 更新 `th-script-template.json` 中的 commit hash
- commit + push

## 关键文件修改清单
| 文件 | 改动 |
|------|------|
| `src/ui/vault-panel.js` | 完全重写：ST 原生 drawer + 顶栏挂载 |
| `src/ui/config-dialog.js` | 完全重写：ST inline-drawer + 扩展设置挂载 |
| `th-script-template.json` | 更新 hash |

## 未改动文件
- `src/index.js`（boot 逻辑不变）
- `src/i18n.js`（翻译系统不变）
- `src/vault/store.js`（数据层不变）
- `src/engine/consolidate.js`（业务逻辑不变）
- 其他所有核心逻辑文件
