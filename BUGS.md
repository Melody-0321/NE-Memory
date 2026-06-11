# NE Memory Engine — Bug 追踪

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
