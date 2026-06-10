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
| **状态** | 🔴 未解决 |
| **发现** | 2026-06-10 |
| **解决** | — |
| **严重程度** | **Medium** |
| **复现步骤** | 1. 点击"处理历史"按钮处理历史消息 2. 或在历史记录 Tab 中恢复某个历史版本快照 |
| **错误信息** | `加载 Vault 失败: n is not a function` |
| **错误位置** | [vault-panel.js:L900](src/ui/vault-panel.js#L900) — `updateVaultViewerPopout()` 的 catch 块 |

### 流程图

```
处理历史 / 恢复快照
        │
        ▼
updateVaultViewerPopout(getChatId)  ← 渲染失败，catch 捕获 "n is not a function"
        │
        ▼
[L900] errDiv.textContent = '加载 Vault 失败: n is not a function'
```

### 影响范围分析

| 流程 | 是否受影响 | 说明 |
|---|---|---|
| **处理历史** (Process History) | ❌ 受影响 | `executeIncrementalUpdate` → `executeConsolidation` → `updateVaultViewerPopout` 渲染失败 |
| **恢复历史快照** | ❌ 受影响 | `restoreSnapshot` → `write` → `updateVaultViewerPopout` 渲染失败 |
| **正常页面加载** | ✅ 正常 | 初始 `renderVaultPanel` → `updateVaultViewerPopout` 正常工作 |
| **正常聊天轮次** | ✅ 正常 | 增量更新后的渲染正常（空 vault 或少量条目时不触发） |
| **ST 生成流程** | ✅ 正常 | `onBeforeGenerate` 中的 prompt 注入走独立路径，不依赖 vault 面板渲染 |
| **记忆存储** | ✅ 正常 | 处理历史时数据已通过 `saveVaultWithSnapshot` 写入 IndexedDB，渲染失败不影响存储 |

### 诊断困难点

项目使用 **Rollup + Terser** 构建，所有函数名被压缩成单字母（`a`, `b`, `n`, ...）：

- `n` 不是源代码中的变量名，是 terser 在 minification 阶段分配的单字母标识符
- 原始错误可能来自 `formatStateSummary()`、`renderCharacterPanelHTML()`、`buildDynamicCharacterSchema()` 等任一函数
- 错误消息中**没有调用栈**（terser 默认 production 模式不保留堆栈映射）

### 根因推测

错误仅出现在 vault 包含**大量数据**（处理历史后几百条 STM/LTM + 复杂 state）的渲染路径中。最可能的触发场景：

1. **格式遗漏**：处理历史时 LLM 输出的 STM 条目格式不规范，`postFillSTM` 未覆盖该边缘情况，写入后渲染时某函数收到意外类型
2. **schema 版本不匹配**：恢复旧快照时 state 结构与当前 schema 不兼容，`formatStateSummary` / `renderCharacterPanelHTML` 中某函数调用非函数值
3. **terser bug**：极少数情况下 terser 对特定代码模式（如内联函数 + 立即调用）产生错误的变量重命名

### 建议修复方向

1. **保留调用栈**：在 `updateVaultViewerPopout` 的 catch 块中打印完整错误堆栈
   ```javascript
   } catch (e) {
       console.error('[NE] updateVaultViewerPopout error:', e);
       if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
   }
   ```
   用户下次触发时 F12 Console 会有完整堆栈，可以看到是哪个源函数出问题。

2. **防御性渲染**：核心渲染函数（`renderCharacterCard`, `replace` → `formatStateSummary`）增加入参类型守卫

3. **考虑 sourcemap**：开发/调试阶段保留 sourcemap 映射，但会增大分发体积

### 需用户提供

请在触发此 bug 时打开浏览器 Console (F12)，截图或复制完整的红色错误堆栈信息，以定位准确的源函数。

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
| 10 | `n is not a function` | Medium | 🔴 未解决 |
