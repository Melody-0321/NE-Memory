# NE Memory Engine — Bug 追踪

---

## #37 Embedding API 输入框修改不保存

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | 用户在 Vector Search accordion 中修改 Embedding 的 URL / Key / Model，输入框显示新值，但关闭重开面板后恢复旧值。修改从未保存。副 API 不受影响。 |

### 根因

`panel-settings.js` 中 Embedding 的 channel-group 无条件渲染在 `commonHtml` 中。当 channelsEnabled = false（默认）时，`nes_embedding_url/key/model` ID 在两处同时出现：channels 隐藏区（第 113-115 行）+ Vector Search 可见区（第 132-134 行）。`panelById()` 永远返回 DOM 中第一个匹配元素（隐藏区），`onchange` 绑定和 save 都命中隐藏副本 → 用户在可见区打字不触发事件，save 读取的是 stale 值。

### 修复

Embedding channel-group 改为 `channelsEnabled ? ... : ''` 条件渲染。两个模式下 embedding 输入字段各只有一份，无 ID 冲突。commit: `93a8266`

### 引入者

`c181ccc`（多通道 API 路由）

---

## #36 设置面板副 API 保存崩溃

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | `saveSettingsTab` 中 `secApi` 对象的 `panelById('nes_secondary_url').value.trim()` 无空值保护 → `panelById` 返回 null 时首行 TypeError，整函数静默崩溃。所有设置修改均不保存。副 API 字段本身的 `onchange` 走 `saveSecApiOnly()` 分支，不受影响。 |

### 修复

`secApi` 三字段全部加 `panelById(...) ? panelById(...).value.trim() : ''` 空值安全。commit: `8c4954d`

---

## #35 面板 overlay 与聊天窗口分层：双滚轮 + 下滑翻开面板回归

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | v6.4 修复后面板尺寸对齐后，双滚轮和下滑翻开面板再次出现。关态 overlflow inline `display: flex` 残留（优先级高于 CSS `display: none`），布局盒撑开 `#sheld` 滚动区域。 |

### 根因链

v6.4 的修复依赖 `transitionend` 事件将 `display` 切回 `none`，但 `transitionend` 可能不触发（CSS 变量未定义、快速切换等）。`open` 类移除后，inline `display: flex`（`createVaultPopout` 第 20 行设置）仍覆盖 CSS 的 `display: none`。

### 修复（三段迭代）

1. `5346b9d`：三个关闭路径加 600ms timeout 兜底 + transitionend 正常清。
2. `eff3dd1`：架构层修复——overlay 挂到 `PD.body` 而非 `#sheld` 内 + `position: fixed`。不再参与任何 `#sheld` 滚动计算。
3. `ad9777d`：动态对齐 `#sheld` 尺寸（`getBoundingClientRect`）+ `resize` 同步，面板精确覆盖聊天窗口区域而非占满全屏。

### 最终效果

面板和聊天窗口在同一位置、同一尺寸，但在不同画布（`body` vs `#sheld`）。双滚轮从根本上不存在，下滑永远翻不开面板。

---

## #34 STM 分块默认值过大

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-06 |
| **解决** | 2026-07-07 |
| **严重程度** | Low |
| **影响** | `stmChunkMaxChars` 默认 4000（另有代码兜底 8000）与新的对数滑块 UI（100-10000）不匹配——默认值偏高，且两处默认不一致。 |

### 修复

5 处全部改为 500：`panel-settings.js` ×4（显示值/数字输入/滑块/保存回退）+ `stm-pipeline.js` ×1（管道兜底）。commit: `0f02516`

---

## 汇总

| # | 描述 | 严重度 | 状态 |
|---|---|---|---|
| 37 | Embedding API 输入框修改不保存（ID 双份冲突） | **High** | ✅ 已解决 |
| 36 | 设置面板副 API 保存崩溃（secApi 空值保护缺失） | **High** | ✅ 已解决 |
| 35 | 面板 overlay 分层（body 挂载 + bounds 同步） | **High** | ✅ 已解决 |
| 34 | STM 分块默认值 4000→500 | Low | ✅ 已解决 |
| 33 | STM 时间/场景无 Banner 时永远为 "-" | Medium | ✅ 已解决 |
| 26 | 设置面板全部控件不持久化 | **High** | ✅ 已解决 |
| 27 | 记忆编辑/删除不持久化（双重根因） | **High** | ✅ 已解决 |
| 28 | 处理历史按钮静默无反应（三重根因） | **High** | ✅ 已解决 |
| 29 | 手机端滑动关闭后页面卡死 | **High** | ✅ 已解决 |
| 30 | 面板 CSS 三重 Bug（双滚轮 / 下滑翻开 / 占满全屏） | **High** | ✅ 已解决 |
| 31 | 上下文窗口轮数控制死代码 | Medium | ✅ 已解决 |
| 32 | `getStmBatchSize` 未导出 | Medium | ✅ 已解决 |

---

# NE Memory Engine — Bug 追踪 (v6.3 及之前)

---

## #26 设置面板全部控件不持久化

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 所有滑块、复选框、文本域修改后关闭面板重开即恢复原值。 |

### 根因

`saveSettingsTab` 引用了渲染 HTML 中不存在的 DOM ID（`nes_enable_state_schema` / `nes_enable_retrieval`），`.checked` 抛 TypeError 导致整函数静默崩溃，`localStorage.setItem` 永远走不到。

### 修复

所有 `panelById` 访问改为空值安全 + 合理默认值。

---

## #27 记忆编辑/删除不持久化

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-06 |
| **严重程度** | **High** |
| **影响** | UI 中编辑或删除记忆后看起来保存成功，但关闭重开面板即恢复。 |

### 根因（双重）

1. IndexedDB 写入（`write()`）是 fire-and-forget，失败静默丢弃
2. `loadVault` 版本平局时 IndexedDB 与 `chat_metadata` 同版本，错误地用聊天文件旧数据覆盖 IndexedDB

### 修复

- `async/await write` + toast 错误提示
- `loadVault` 版本比较改为严格大于（`>`），平局时 IndexedDB 为真源并向聊天文件反向同步

---

## #28 处理历史按钮静默无反应

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 点击"处理历史"按钮后面板无任何变化，用户无法判断是否在工作。 |

### 根因（三重）

1. `collectAllMsgIds` 未 import → ReferenceError
2. `showConfirm` resolve 后到 `try` 块之间无错误捕获，异常作为未捕获 rejection 静默消失
3. `onProgress` 回调在 `executeIncrementalUpdate` 中从未被调用

### 修复

补齐 import、try/catch 扩展到全链路、stm-pipeline.js 开始/结束时调用 onProgress。

---

## #29 手机端滑动关闭后页面卡死

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 下滑手势关闭面板后页面完全卡死，面板钉在滑动位置。 |

### 根因

手势关闭后 inline `transform: translateY(movedY)` 未被清除，压住 CSS transition。

### 修复

`touchend` 中无条件先清除 `overlay.style.transform`。

---

## #30 面板 CSS 三重 Bug：双滚轮 + 下滑翻开无响应面板 + 面板占满全屏

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 未打开面板时聊天窗口出现双滚动条；下滑聊天会翻出无法交互的面板。 |

### 根因

overlay 默认 `display: flex; position: absolute; inset: 0` 追加到主文档 `#sheld` 中。`#sheld` 有 `overflow: auto`，overlay 的布局盒参与其滚动区域计算导致双滚轮 + 被滚进视口。

### 修复

- 关态 CSS：`display: none`（无布局盒，不参与滚动）
- 开态 `.open`：`display: flex`
- `position: absolute`（保持与 ST 窗口对齐）

---

## #31 上下文窗口轮数控制死代码

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | Medium |
| **影响** | Dialog Window Rounds 设置从未生效，上下文窗口始终使用默认值。 |

### 根因

`computeWindowStartMsgId` 使用了不存在的 `mes_id` 字段名。

### 修复

字段名修正为实际属性名。

---

## #32 `getStmBatchSize` 未导出

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | Medium |

### 修复

从 `events.js` 补充导出。

---

## 汇总

| # | 描述 | 严重度 | 状态 |
|---|---|---|---|
| 26 | 设置面板全部控件不持久化 | **High** | ✅ 已解决 |
| 27 | 记忆编辑/删除不持久化（双重根因） | **High** | ✅ 已解决 |
| 28 | 处理历史按钮静默无反应（三重根因） | **High** | ✅ 已解决 |
| 29 | 手机端滑动关闭后页面卡死 | **High** | ✅ 已解决 |
| 30 | 面板 CSS 三重 Bug（双滚轮 / 下滑翻开 / 占满全屏） | **High** | ✅ 已解决 |
| 31 | 上下文窗口轮数控制死代码 | Medium | ✅ 已解决 |
| 32 | `getStmBatchSize` 未导出 | Medium | ✅ 已解决 |

---

# NE Memory Engine — Bug 追踪 (v6.3 及之前)

---

## #1 副 API URL placeholder 误导 `http://127.0.0.1:8000/llm/chat`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | **High** |
| **影响** | 用户照抄 `http://127.0.0.1:8000/llm/chat` 改域名后拿到 404 或 CORS 错误 |

### 根因

Placeholder 格式是 ST 本地代理专用路径，不是标准 OpenAI 兼容 API 格式。用户不知道需要 `/v1/chat/completions` 后缀。

### 修复

- Placeholder 改为 `https://api.deepseek.com/v1/chat/completions`（标准 OpenAI 格式）
- 添加 URL 自动纠正逻辑 `normalizeApiUrl()`：用户填 `https://api.deepseek.com` 自动补 `/v1/chat/completions`
- 添加 CORS-proxy 自动回退：直连失败时自动通过 `http://127.0.0.1:8000/proxy/<url>` 重试
- 所有副 API 保存路径统一通过 `saveSecondaryApiConfig()`

---

## #2 `alert()` 阻塞弹窗 → toastr 通知

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | Medium |

### 根因

Connect / Test Message 的结果用 `alert()` 弹窗，阻塞 UI，用户体验差。

### 修复

改用 ST 自带的 `toastr.success()` / `toastr.error()` 显示非阻塞通知。

---

## #3 "保存设置"按钮 → 改动即保存

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | Medium |

### 修复

- 删除 Settings Tab 底部的"Save Settings"按钮
- 所有控件绑定实时保存事件（滑块 oninput、checkbox onchange、输入框 onchange/blur）
- 副 API 字段走 `saveSecApiOnly()` 轻量保存，避免重复写完整 settings

---

## #4 ST 启动时未自动连接副 API

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | Medium |

### 修复

`init()` 中加入 `autoConnectSecondaryApi()`，页面加载时自动检测已保存的副 API 配置并静默连接。

---

## #5 emoji `\U0001F52C` 显示为文本 "U0001F52C"

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | Low |

### 根因

JavaScript 不支持大写 `\U` Unicode 转义，只支持小写 `\u`。`\U0001F52C` 被当作字面文本输出。

### 修复

替换为有效的代理对 `\uD83D\uDD2C`（🔬）。

---

## #6 "启用任务/目标/事件追踪" checkbox — 无任何引擎效果

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | Low |

### 根因

`enableQuests` 字段仅保存到 localStorage，引擎和侧栏均不读取。无论勾不勾选，引擎都追踪任务/目标，面板也始终显示。

### 修复

从 vault-panel.js 和 config-dialog.js 中彻底删除该选项的 HTML、事件绑定和保存/加载逻辑。

---

## #7 `generateRaw` 优先 → 记忆内容泄露到聊天

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | **High** |
| **影响** | 未配副 API 时，引擎 LLM 调用通过 `generateRaw` 执行，STM 提取的原始 JSON 和状态更新内容直接出现在角色对话框 |

### 根因

[llm.js](src/api/llm.js) 的 `callTavernHelper` 将 `generateRaw` 设为第 1 优先，`generateQuietPrompt` 为备选。但 `generateRaw` 在部分 ST 版本会把输出注入聊天流。`generateQuietPrompt` 才是专为后台静默处理设计的 API。

### 修复

交换优先级：`generateQuietPrompt` 为第 1 优先，`generateRaw` 降为备选（仅当 `generateQuietPrompt` 不可用时）。

### 已知局限

`consolidate.js` 的 LTM 验证重试分支使用 4 条消息（超过 `generateQuietPrompt` 的 2 消息签名），重试时会丢失中间上下文。极少触发（仅 LLM 输出格式错误时进入），待后续优化。

---

## #8 CDN 加载方式 `import()` → `<script>` 注入

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | **High** |
| **影响** | iOS Safari 用户 100% 失败（"Load Failed"）；但**不是**副 API "Load Failed" 的原因（副 API 问题见 #9） |

### 根因

> **事后更正**：此修复与副 API 的 "Load Failed" 无关——插件本身能运行说明 CDN 加载无问题。真正的副 API "Load Failed" 是 fetch() CORS 拦截，见 #9。

原始 `import()` 加载 IIFE 格式的 dist 文件，iOS Safari 对模块格式校验严格。改为 `<script>` 标签注入后彻底解决。

### 修复

模板 `content` 从 `import()` 改为 `<script>` 标签注入 + gcore CDN 主路径 + jsDelivr 标准 CDN 回退。

---

## #9 副 API "Load Failed" / CORS 问题

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | **High** |
| **影响** | iOS Safari + 个人反代（无 CORS 头）用户 100% 失败；错误信息 "Load Failed" 毫无诊断价值 |

### 根因

1. iOS Safari 的 `fetch()` 遇到 CORS 拦截/网络错误时报原生 "Load Failed"，无诊断信息
2. 公开反代（如 `gcli.ggchan.dev`）通常未配置 `Access-Control-Allow-Origin` 头
3. 错误信息直接显示在状态栏，用户完全不知道原因

### 修复

1. **CORS-proxy 自动回退**：直连失败（网络错误类）→ 自动通过 `http://127.0.0.1:8000/proxy/<url>` 重试
2. **proxy 未启用时的清晰指引**：proxy 也失败时显示 `"请在 config.yaml 中开启 enableCorsProxy: true"` 的完整操作指引
3. **错误信息转译**：原生 "Load Failed" → 诊断提示 "Mixed content / CORS / URL unreachable / firewall"

### 修复文件

- [llm.js](src/api/llm.js) — `callCustomAPI()` 重写为两阶段自动回退 + 错误转译

---

## #10 🟡 `更新Vault失败: n is not a function`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-10 |
| **解决** | 2026-06-10 |
| **严重程度** | **Medium** |
| **复现步骤** | 1. 点击"处理历史"按钮处理历史消息 2. 或在历史记录 Tab 中恢复某个历史版本快照 |
| **错误信息** | `加载 Vault 失败: n is not a function` |

### 根本原因

在 [vault-panel.js](src/ui/vault-panel.js) 中，有 **6 处** `updateVaultViewerPopout` 调用写了多余的括号：

```javascript
// ❌ 错误 — 把 getChatId() 的返回值（字符串）传给了 updateVaultViewerPopout
updateVaultViewerPopout(getChatId());   // 传入字符串 "abc123"

// ✅ 正确 — 把 getChatId 函数引用本身传入
updateVaultViewerPopout(getChatId);     // 传入函数引用
```

`updateVaultViewerPopout` 内部会将参数 `getChatId` 当作函数调用（`read(getChatId())`），如果传入的是字符串而非函数，`"abc123"()` 就会抛出 `TypeError: n is not a function`。

**为什么"正常页面加载"不受影响？** `renderVaultPanel(getChatId)` → `createVaultPopout(getChatId)` → `updateVaultViewerPopout(getChatId)` 这条初始路径写的是 `getChatId` 不带括号，正确传入了函数引用。只有 6 处事件处理器（按钮点击后刷新面板）误写了多余的 `()`。

### 修复

修改了 [vault-panel.js](src/ui/vault-panel.js) 中 **6 处**代码，去掉多余的括号：

| 行号 | 位置 | 修改 |
|------|------|------|
| L880 | 主面板——清除状态按钮 | `getChatId()` → `getChatId` |
| L892 | 主面板——清除状态按钮（备用） | `getChatId()` → `getChatId` |
| L1716 | 合并按钮 | `getChatId()` → `getChatId` |
| L1796 | 处理历史按钮 | `getChatId()` → `getChatId` |
| L1840 | 导入按钮 | `getChatId()` → `getChatId` |
| L2097 | 历史记录 Tab——恢复快照按钮 | `getChatId()` → `getChatId` |

### 影响范围

| 流程 | 之前 | 修复后 |
|---|---|---|
| **处理历史** (Process History) | ❌ 处理后渲染崩溃 | ✅ 正常 |
| **恢复历史快照** | ❌ 恢复后渲染崩溃 | ✅ 正常 |
| **正常页面加载** | ✅ 正常（未受影响） | ✅ 正常 |
| **正常聊天轮次** | ✅ 正常（未受影响） | ✅ 正常 |
| **记忆存储** | ✅ 正常（渲染崩溃不影响存储） | ✅ 正常 |

### 为什么正常页面加载未受影响

`renderVaultPanel` 在 [L1706](src/ui/vault-panel.js#L1706) 写的是正确的 `updateVaultViewerPopout(getChatId)`（无括号）。只有事件处理器内部的 6 处调用误加了 `()`。由于事件处理器在用户点击按钮后才运行，正常加载时不会触发。

### commit

`e859b04` — fix: remove extra () from updateVaultViewerPopout(getChatId) calls

### 后续加固

`c02bb55` — 分段 try-catch + 类型守卫 + Array.isArray 护盾，彻底防止同类错误。

---

## #11 内联编辑保存无效 / 取消后无法再编辑 / 无删除按钮

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-11 |
| **解决** | 2026-06-11 |
| **严重程度** | **High** |

### 根因

1. `_pendingInlineStorage` 仅在声明时赋 `null`，从未被赋值为 vault，`saveSingleEntry` 首行 `if (!vault) return` 直接跳过
2. 取消/保存后 `row.innerHTML = row._neOrigHTML` 还原了 HTML，但新 DOM 元素的 onclick 未重新绑定，✏️ 按钮失效
3. 从未实现删除功能

### 修复

- `updateVaultViewerPopout` 读 vault 后赋值 `_pendingInlineStorage = { vault, getChatId }`
- 还原后调用 `rebindEditBtn(row)` 重新绑定编辑按钮
- 新增 `deleteSingleEntry()` + 🗑 红色删除按钮 + `confirm()` 确认弹窗
- 修正 `saveSingleEntry` 参数签名

### commit

`c38da69` — fix: inline edit save broken, cancel broke re-edit, add delete button with confirmation

---

## #12 Process History `force=true` 导致消息全部重复处理

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-11 |
| **解决** | 2026-06-11 |
| **严重程度** | **High** |

### 根因

1. Process History 调用 `executeIncrementalUpdate(getChatId(), batch, true)`，传入 `force=true` 跳过 `collectProcessedMsgIds` + `filterNewMessages` 去重，所有消息全部重新送入 STM 提取
2. 去掉 `force` 后，`collectProcessedMsgIds` 的回退逻辑扫描了 `stm_entries`（已合入 LTM 的归档条目），一旦聊天有过处理历史，所有 msg_id 永久锁死，导致 Process History 什么都不做
3. 上轮加的 checkpoint guard 误把断点恢复标记当成"已完成"标记，`alert + return` 直接阻塞

### 修复

- 去掉 Process History 的 `force=true`
- 去掉 `collectProcessedMsgIds` 的 STM 条目回退扫描，只信任 `processed_msg_ids`
- 在 `executeIncrementalUpdate` 中加一次性迁移：`processed_msg_ids` 为空时从现有 STM 条目重建并持久化
- 过期 checkpoint 改为静默清除而非阻塞

### commit

`08b89f9` — 去掉 force；`b50aed9` — 修复 checkpoint guard；`1ee283d` — 修复回退逻辑

---

## #13 cursor 窗口 2+ msg_ids 全部丢失

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-11 |
| **解决** | 2026-06-11 |
| **严重程度** | **High** |
| **影响** | 一次性收录 ≥ 8 条消息时，窗口 2+（msg index 4+）的 STM 条目的 `msg_ids` 几乎全部丢失，`processed_msg_ids` 记录不完整，后续去重失效 |

### 根因

[cursor.js](src/engine/cursor.js) 的 `msgRange → msg_ids` 映射中，`msgRange` 是 LLM 输出的**全局偏移**（对应 prompt 中 `[position + i]` 标记），但 `ws2.items` 是**窗口局部切片**。原代码直接拿 `msgRange` 值作为 `ws2.items` 的局部索引，未减去 `ws2.position`：

| 窗口 | msgRange | 旧代码 `ws2.items[msgRange]` | 实际取到 |
|------|----------|---------------------------|---------|
| 1 (pos=0) | [0, 2] | ws2.items[0..2] ✅ | msg[0..2] |
| 2 (pos=4) | [5, 6] | Math.min(5,3)=3 → ws2.items[3] ❌ | msg[7]（仅 1 条） |
| 2 (pos=4) | [4, 7] | Math.min(7,3)=3 → ws2.items[3] ❌ | msg[7]（仅 1 条，丢了 3 条） |

同时 `validateOutput` 传入了 `ws2.items.length`（局部），导致窗口 2+ 产生虚假的「msgRange 越界」告警。

### 修复

```diff
- var r0 = Math.max(0, Math.min(range[0], ws2.items.length - 1));
- var r1 = Math.max(r0, Math.min(range[1], ws2.items.length - 1));
+ var r0 = rawRange[0] - ws2.position;
+ var r1 = rawRange[1] - ws2.position;
+ r0 = Math.max(0, Math.min(r0, ws2.items.length - 1));
+ r1 = Math.max(r0, Math.min(r1, ws2.items.length - 1));
```

同时 validate 调用 `ws2.items.length` → `messages.length`（全局）。

### commit

`ccf670b` — fix: cursor msgRange global→local index offset bug

---

## #14 🟡 Pipeline 零产出死循环：`return []` 合约破坏 + `added>0` 跳过保存

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-16（用户报告）→ 2026-06-17（根因定位） |
| **严重程度** | **P0** |
| **影响** | 用户 152 条消息（76 轮对话），面板始终空白。Process History 显示"Completed (10 轮)"，但记忆仍为空。Pipeline 每 12 条消息触发一次，共 ~6 次，每次 LLM 调用成功（或返回空事件），每次零产出，每次 vault 不保存，每次下轮重新扫描——死循环。 |

### 用户报告实录

- 导入 test4.0，副 API 已连 → 聊了 76 轮，记忆从未更新
- 点击「处理历史」→ 显示 "10 轮" → 仍空白
- maxContext 开满

### 完整根因链

**第 1 环：`runStmExtractorCore` 5 处 `return []` 违反下游合约**

[stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/stm-extractor.js) 有 5 个退出点直接 `return []`：

| 行号 | 触发条件 | 类型 |
|------|---------|------|
| L45 | LLM 调用抛异常 | 异常 |
| L50 | LLM 返回空响应 | 异常 |
| L78 | JSON 解析失败 | 常规（不同模型） |
| **L107** | **JSON 解析成功但 `turns` 正则不匹配** | **常规** |
| L132 | 所有事件 msg_ids 为空 | 边缘 |

下游 `processTurnsInBatches` 期望返回 `{ vault, totalAdded }` 对象。`[]` 没有 `.totalAdded` → `undefined` → `0`。

**第 2 环：`added > 0` 才保存 vault → 消息永不被标记**

[update.js L1000](file:///d:/SillyTavern/xm/ne-memory/src/engine/update.js#L1000)：

```javascript
if (cursorResult.totalAdded > 0) {
    vault._meta.last_pipeline_task = 'stm_extract';
    vault._meta.last_pipeline_time = new Date().toISOString();
    try { await saveVaultWithSnapshot(chatId, vault); } catch (e) {...}
}
```

`added === 0` 跳过保存 → `collectAllMsgIds` 下次返回空 Set → `filterNewMessages` 认为所有消息"未处理" → 重新送入 LLM → 再次零产出 → 永不保存。

**第 3 环：pendingMessages 已消费，无法回退**

`flushPendingMessages` L199 `pendingMessages.splice(0)` 消费了消息。如果 pipeline 返回时抛异常，inflight 备份可以恢复；但 pipeline "成功"返回了（只是 added=0），inflight 被 `finally` 清除 → 消息永久从 pending 中消失，又不在 vault 中。

**引入者：`a0088af`**（6 月 14 日），将旧版 fallback 占位条目改为直接 `return []`。

### Process History "10 轮"之谜

152 条消息 → `collectAllMsgIds` 命中 132 条 → 过滤后剩 20 条（10 轮）。
`collectAllMsgIds` 只读 `unconsolidated_stm` + `stm_entries`。面板空白 ≠ vault 空——旧 vault 的 STM 条目可能在 `stm_entries` 中（已 consolidate），但 `unconsolidated_stm` 和 `ltm_entries` 为空 → 面板两表皆空，但 msg_ids 仍有效。

### 修复方案

1. **stm-extractor.js**：5 处 `return []` → `return { vault, totalAdded: 0 }`
2. **stm-extractor.js**：`processTurnsInBatches` 多 batch 路径加 `(batchResult && batchResult.totalAdded) || 0` 判空
3. **update.js L1000**：移除 `if (added > 0)` 条件，零产出时也保存 vault（至少写 `_meta`）

---

## #15 ❌ Gemini 中转站副 API 401（用户侧配置错误，非 Bug）

| 属性 | 值 |
|---|---|
| **状态** | ❌ 已关闭（非 Bug） |
| **发现** | 2026-06-16 |
| **关闭** | 2026-06-17 |
| **严重程度** | — |
| **结论** | 401 = 用户填入的模型名 / URL / Key 不匹配中转站要求，属用户侧配置错误。 `callCustomAPI` 行为正常。 |

---

## #16 ✅ `processed_msg_ids` 毒化 vault —— pipeline 消息全部被过滤，STM 永久为 0

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-11 |
| **解决** | 2026-06-14 |
| **严重程度** | **High** |
| **影响** | vault 的 STM/LTM 被清空后 `processed_msg_ids` 残留。`filterNewMessages` 认为所有消息"已处理" → 全部过滤 → STM 永远不提取。 |

### 根因

`processed_msg_ids` 是独立于 STM 条目的缓存。删除条目清空了 STM 数组但缓存未同步清理 → 僵死状态。

### 修复（三阶段）

**阶段 1 — 自愈合** ([`3721091`](file:///))：
`executeIncrementalUpdate` 检测死信（filteredMessages 为 0 但 vault 无任何 STM/LTM 且 processedIds > 0）→ 自动清除 `processed_msg_ids` 并重试过滤。

**阶段 2 — 对账** ([`31b7cfd`](file:///))：
入口处与 `collectAllMsgIds` 对账，已删条目的 msg_id 踢出；`deleteSingleEntry` 同步清理 `stm_entries` 防止残留。

**阶段 3 — 彻底删除缓存** ([`14001d0`](file:///))：
删除 `processed_msg_ids` 及其 5 个维护函数。统一以 STM 条目自身的 `msg_ids` 为唯一事实源 —— `collectAllMsgIds` 在每次 pipeline 入口实时扫描。

### commit

`3721091` `31b7cfd` `14001d0`

---

## #17 ✅ `||` 运算符吞 `msg_id=0` —— 消息 0 永远穿透去重

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-14 |
| **严重程度** | **High** |
| **影响** | ST 消息 id 从 0 开始。`id || mes_id` 将 `id=0` 判为 falsy 跳到 `mes_id`。两侧（写入/过滤）产生不同的 fallback 键值，互不认识 → msg 0 永远无法被去重。 |

### 根因

JavaScript `||` 把 `0` 当 falsy。`collectMsgIdsFromTurns` 写入 `'msg_user_0'`，但 `filterNewMessages` 过滤侧返回 `undefined` → 永远放行。

### 修复

- [`e693bcd`](file:///)：`id != null ? id : mes_id` 替代 `id || mes_id`
- [`1f22acd`](file:///)：全系统 7 处 `id || mes_id` → `id != null ? id : mes_id`（vault-panel.js `visibleWindow` / `saveSingleEntry`、tools.js `access()`、index.js 指纹、retrieval.js 标签）

### commit

`e693bcd` `1f22acd`

---

## #18 ✅ ST chatId 始终为 `'default'` —— 对话切换不识别

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-13 |
| **严重程度** | **High** |
| **影响** | ST 的"新建聊天"不生成唯一 chatId → 所有对话共享 `'default'` vault。`neSyncChatId` 因 `default === default` 跳过重置，新旧对话数据串在一起。 |

### 修复

- `getChatId()`：chatId 为 `'default'` 时用 `getChatFingerprint(ctx)` 生成稳定指纹（`ne_<characterId>_<firstMsgId>`）
- 空对话回退 localStorage 缓存
- `migrateVaultIfNeeded`：自动将旧的 `'default'` vault 迁移到新指纹
- `chat_id_changed` / `CHAT_CHANGED` 事件中加迁移调用

### commit

`d54b893`

---

## #19 ✅ SmartPush 四项修复

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-15 |
| **解决** | 2026-06-15 |
| **严重程度** | **High** |
| **影响** | 四项独立 bug 共同导致 SmartPush 注入质量差、用户感知不到记忆。 |

### Bug 1：Consolidation 延迟

STM 提取后 LTM 不立刻整合 —— 需等下一轮 pipeline 才触发。修复：`flushPendingMessages` 提取后加 post-extraction consolidation check，同轮完成整合。

### Bug 2：stmCount 误报 0

`retrieval.js` 两处计数只看 `stm_entries`，忽略了 `unconsolidated_stm`。修复：改为 `unconsolidated_stm.concat(stm_entries).length` 全量统计。

### Bug 3：合成内容截断

中英文 prompt 中含"回复控制在 X tokens 以内"自估 soft budget 指令，LLM 自估不准导致内容被截。修复：删除 soft budget 指令。

### Bug 4：`stm_` 前缀泄漏

检索 prompt 中 STM 条目带有内部 ID（`stm_42`），被复制进合成注入文本。修复：规则 5 加"不要包含内部 ID"；`formatSmartContext` 输出加 `replace(/(stm_|ltm_)\d+/g, '')`。

### commit

`504a0a6`

---

## #20 ✅ 格式化标签泄漏 —— driver 输入 / chat 消息被污染

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-13 |
| **严重程度** | Medium |
| **影响** | AI 回复中的 `<content>`、`<Time>`、`[思考过程]` 等格式标签被 driver 模仿并发送到 chat 作为玩家消息，污染测试数据。 |

### 修复

两层过滤：
- **入口**：`buildDriverUser` 传给 driver 的 AI 回复先过 `cleanAiReply()` 去除格式标签和思考链
- **出口**：`extractUserMessage` 发送到 chat 的消息先过 `stripFormatTags()` 二次过滤

### commit

`5e289dd`

---

## #21 ✅ Settings 面板无法滚轮滚动

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-15 |
| **解决** | 2026-06-15 |
| **严重程度** | Medium |
| **影响** | Settings tab 内容多时无法鼠标滚轮滚动，只能拖滚动条。 |

### 根因

`.ne-settings-scroll` 有 `overflow-y:auto` 但无 `height` 约束 → 内容不溢出 → 无法滚内部；同时截获 wheel 事件阻止传到父级 `.ne-vault-scroll-area`。

### 修复

删除 `overflow-y:auto`，让父级 `.flex:1 + overflow-y:auto` 的 scroll-area 统一处理所有 tab 滚动。

### commit

`18bc38d`

---

## #22 ✅ 消息去重击穿 —— 三联动缺陷导致跨 run 重复处理

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-13 |
| **严重程度** | **High** |
| **影响** | 同一批消息跨 run 被反复送入 pipeline，产生重复 STM。 |

### 三个根因

**（A）fallback ID 不一致** ([`3e153c8`](file:///))：
消息缺 `id`/`mes_id` 时，`filterNewMessages`（过滤侧）永远 `return true`（放行），而 `collectMsgIdsFromTurns`（写入侧）用 batch-relative `turnIndex` 生成 `'msg_user_0'`。两端互不认识 → 已标记的消息无法被过滤。

**（B）`_absIdx` 跨 run 重叠** ([`265a2fc`](file:///))：
Process History 预过滤后传入 `executeIncrementalUpdate` 的消息已不是原始 batch，`_absIdx` 用 for 循环 `mi` 重新从 0 计数 → 与之前 run 的 `_absIdx` 值重叠。修复：改用 `m.id`（原始 chat 数组下标 / ST messageIndex），跨 run 不变的真正绝对位置。

**（C）`force=true` 时 prompt 矛盾** ([`a85e031`](file:///))：
system prompt 说"覆盖全部消息不得跳过"，user prompt 说"如果没有重要事件返回 `[]`"。LLM 取中 → 跳过 Turn 0。修复：force 时 user ending 改为"所有消息均须覆盖禁止跳过"。

### commit

`3e153c8` `265a2fc` `a85e031`

---

## #23 ✅ STM 条目排序错误 + msgRange 位置显示误导

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-12 |
| **严重程度** | Medium |
| **影响** | Memory tab 中 STM 条目按 LLM 调用顺序排列（生成顺序）而非对话顺序；entry 的 `msgRange` 显示 batch-relative 位置，跨 run 误导。 |

### 修复

- [`f079ad8`](file:///)：新增 `sortStmByMsgOrder()`，六处渲染点接入（vault panel、retrieval、notebook 等）
- [`2905959`](file:///)：`msgRange` 从 batch-relative → 绝对消息位置

### commit

`f079ad8` `2905959`

---

## #24 ✅ test-runner 全面审计 —— 6 类缺陷

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-14 |
| **严重程度** | Medium |
| **影响** | 测试结果不可靠：断言误报通过、长测试提前终止、语义评估永远 false、Blob URL 泄漏。 |

### 修复

| 缺陷 | 修复 |
|------|------|
| `exists` 断言逻辑反转 → 永远 false | 修正比较语义 |
| `forced_max_rounds` 时 `semanticResults` 为 null → 崩溃 | 加 `\|\| []` 空数组保护 |
| 语义评估提前结束（TC-05 来不及二次触发） | 要求 `round >= minRounds + 3` 才允许 `natural_done` |
| 策略提示不适应长测试 | 分轮次给出第二次提问引导 |
| 结构断言失败提前终止 → 一条失败后面全跳过 | 改为继续跑 |
| Blob URL 泄漏 | 5 秒后 revoke |

### commit

`9fa09bd` `cc7e23d` `50692ba`

---

## #25 ✅ test-runner "No textarea" —— `hostDoc` 指向 iframe 文档而非主页面

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | script 模式（IIFE 构建）下 test-runner 无法发送消息，报 `Error: No textarea`。Extension 模式不受影响。 |

### 根因

`_buildDebugApi()` 中 `hostDoc = document`。script 模式下代码通过 `<script>` 标签注入 iframe，`document` 指向 iframe 的文档，而 `send_textarea` 在 `window.parent.document`（ST 主页面文档）中。

项目中 `panel-shared.js` 等其他模块已正确通过 `window.__NE_EXTENSION_MODE ? document : window.parent.document` 解析，但 `_buildDebugApi` 遗漏了此逻辑。

### 修复

```diff
- var hostDoc = document;
+ var hostDoc = window.__NE_EXTENSION_MODE ? document : (window.parent && window.parent !== window ? window.parent.document : document);
```

### 影响范围

| 流程 | 之前 | 修复后 |
|---|---|---|
| **test-runner（script 模式）** | ❌ `No textarea` 崩溃 | ✅ 正常 |
| **test-runner（extension 模式）** | ✅ 正常（未受影响） | ✅ 正常 |
| **seedAndWait / runQuery（script 模式）** | ❌ 同样有 bug | ✅ 正常 |

---

## 汇总

| # | 描述 | 严重度 | 状态 |
|---|---|---|---|
| 1 | URL placeholder 误导 | High | ✅ 已解决 |
| 2 | alert() → toastr | Medium | ✅ 已解决 |
| 3 | 保存按钮 → 改动即保存 | Medium | ✅ 已解决 |
| 4 | 自动连接副 API | Medium | ✅ 已解决 |
| 5 | `\U` emoji 显示异常 | Low | ✅ 已解决 |
| 6 | "启用任务追踪"无效果 | Low | ✅ 已解决 |
| 7 | `generateRaw` 泄露记忆 | **High** | ✅ 已解决 |
| 8 | CDN `import()` → `<script>` | High | ✅ 已解决 |
| 9 | 副 API CORS / Load Failed | **High** | ✅ 已解决 |
| 10 | `n is not a function` | Medium | ✅ 已解决 |
| 11 | 内联编辑保存无效 / 取消后无法再编辑 / 无删除 | **High** | ✅ 已解决 |
| 12 | Process History `force=true` 导致消息全部重复处理 | **High** | ✅ 已解决 |
| 13 | cursor 窗口 2+ msg_ids 全部丢失（msgRange 全局偏移未减 position） | **High** | ✅ 已解决 |
| 14 | Pipeline 零产出死循环：`return []` 合约破坏 + `added > 0` 跳过保存 | **P0** | ✅ 已解决 |
| 15 | Gemini 中转站副 API 401（用户侧配置错误） | — | ❌ 非 Bug |
| 16 | `processed_msg_ids` 毒化 vault → pipeline 消息全部被过滤 | **High** | ✅ 已解决 |
| 17 | `\|\|` 吞 `msg_id=0` → 消息 0 永远穿透去重 | **High** | ✅ 已解决 |
| 18 | ST chatId 始终为 `'default'` → 对话切换不识别 | **High** | ✅ 已解决 |
| 19 | SmartPush 四项修复（Consolidation 延迟 / stmCount / 合成截断 / stm_ 泄漏） | **High** | ✅ 已解决 |
| 20 | 格式化标签泄漏（driver 输入 / chat 消息） | Medium | ✅ 已解决 |
| 21 | Settings 面板无法滚轮滚动 | Medium | ✅ 已解决 |
| 22 | 消息去重击穿（fallback ID 不一致 + `_absIdx` 重叠 + force prompt 矛盾） | **High** | ✅ 已解决 |
| 23 | STM 条目排序错误 + msgRange 位置误导 | Medium | ✅ 已解决 |
| 24 | test-runner 6 类缺陷（exists 断言反转 / null 崩溃 / 提前终止 / Blob 泄漏） | Medium | ✅ 已解决 |
| 25 | test-runner "No textarea" — `hostDoc` 指向 iframe 文档而非主页面 | **High** | ✅ 已解决 |
