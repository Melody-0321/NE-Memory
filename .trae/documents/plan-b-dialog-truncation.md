# Plan B — NE 接管对话截断（按轮数）v2

## 摘要

让 NE 在 ST 构建 prompt 之前，按 `dialogWindowRounds`（用户设置，2-20，默认 10，硬地板 6）截断 `chat` 数组，实现对对话历史的精确轮数控制。默认模式下与 ST 的 token-based 截断层叠生效；可选模式下 NE 成为唯一截断权威。

同时删除 `formatContextMemory` / `ne_context_memory` 注入——SmartPush 已覆盖 STM 摘要功能，重复注入浪费 token 预算。

---

## Grill-Me 决策记录

| # | 决策 | 结论 |
|---|------|------|
| 1 | `formatContextMemory` 的去留 | **删除** — SmartPush 已覆盖，重复且浪费 token |
| 2 | `ne_context_memory` 注入 | **删除** — 顺手清理 |
| 3 | `contextWindowRounds` 滑块 | **替换** 为新滑块 `dialogWindowRounds`（2-20，原 2-30） |
| 4 | `computeWindowStartMsgId` | **保留** — `adjustDialogWindow` 和 `computeContextPressure` 复用其轮数算法 |
| 5 | `computeContextPressure` | **迁移** setting key，逻辑不变 |
| 6 | 轮数定义 | 复用现有算法：从尾部向前，以 assistant 消息计数 |
| 7 | 硬地板 | 6 轮 |
| 8 | `adjustDialogWindow` 插入点 | `onBeforeGenerate` 中 L796 之后，SmartPush 注入之前 |
| 9 | `__ne_original_chat_length` | **不需要** — `formatContextMemory` 已删，`computeContextPressure` 在 `onBeforeGenerate` 之前运行 |
| 10 | 模式 2（NE 唯一权威） | **保留**，复选框 + `runtime.maxContext = Number.MAX_SAFE_INTEGER` |
| 11 | UI 文案 | 见下方 |

---

## UI 设计

### 滑块

- **EN label**: `Dialog Round Injection Control`
- **ZH label**: `对话轮数注入控制`
- **范围**: 2–20，默认 10，硬地板 6
- **EN help**: `Controls how many recent dialog rounds are sent to the LLM. As an alternative to the default token-budget truncation (maxContext), this ensures the LLM always sees a fixed number of recent dialog rounds.`
- **ZH help**: `控制发送给大模型的最近对话轮数。作为对默认 token 预算截断（maxContext）的替代方案，确保 LLM 总是看到固定轮数的最近对话上下文。`

### 模式 2 复选框

- **EN label**: `Override ST Context Window Limit`
- **ZH label**: `替代 ST 上下文窗口限制`
- **EN help**: `Disable ST token-budget truncation, using dialog rounds as the sole context control.`
- **ZH help**: `禁用 ST 的 token 预算截断，完全由对话轮数控制上下文大小。`

---

## 具体变更

### 变更 1：精简 context-window.js

**文件**: `src/core/engine/context-window.js`

- **删除** `filterPreWindowEntries` 函数（L28-L53）
- **删除** `formatContextMemory` 导出函数（L55-L94）
- **保留** `computeWindowStartMsgId` 导出（不变）
- **删除** `import { sortStmByMsgOrder }`（不再需要）

### 变更 2：替换 panel-settings.js 滑块

**文件**: `src/adapter/panel-settings.js`

- **删除** 旧 `contextWindowRounds` 滑块（L61-L63）
- **新增** `dialogWindowRounds` 滑块（id: `nes_dialog_window_rounds`，min=2, max=20, default=10）
- **新增** 模式 2 复选框（id: `nes_dialog_override_enabled`，default=false）
- **更新** `saveSettingsTab()`: 读取新 setting key，写 `dialogWindowRounds` + `dialogOverrideEnabled`
- **更新** 事件绑定：新滑块 oninput + 新复选框 onchange → saveSettingsTab()

### 变更 3：更新 i18n.js

**文件**: `src/core/i18n.js`

- **删除** 旧 key: `context_window_rounds` + help text（EN/ZH/TW）
- **新增** 以下 key（EN/ZH/TW）:
  - `dialog_round_injection_control` → `对话轮数注入控制` / `對話輪數注入控制`
  - help text for slider
  - `override_st_context_window_limit` → `替代 ST 上下文窗口限制` / `替代 ST 上下文視窗限制`
  - help text for checkbox

### 变更 4：重构 events.js

**文件**: `src/adapter/events.js`

**4a. 删除 `ne_context_memory` 注入（L830-L835）**

**4b. 更新 import（L11）**
- `import { formatContextMemory, computeWindowStartMsgId }` → `import { computeWindowStartMsgId }`

**4c. 迁移 `computeContextPressure` setting key（L113-L114）**
- `s.contextWindowRounds` → `s.dialogWindowRounds`
- 默认值保持 10

**4d. 新增 `adjustDialogWindow` 函数**
```javascript
function adjustDialogWindow() {
    var cwRounds = 10;
    try { var raw = localStorage.getItem('ne_settings'); if (raw) { var s = JSON.parse(raw); cwRounds = Number(s.dialogWindowRounds) || 10; } } catch (e) {}
    var minRounds = 6;
    if (cwRounds < minRounds) cwRounds = minRounds;

    var chat = runtime.getChat ? runtime.getChat() : [];
    if (!chat || chat.length === 0) return;

    // 模式 2：禁用 ST token 截断
    var overrideEnabled = false;
    try { var raw2 = localStorage.getItem('ne_settings'); if (raw2) { var s2 = JSON.parse(raw2); overrideEnabled = !!s2.dialogOverrideEnabled; } } catch (e) {}
    if (overrideEnabled) {
        runtime.maxContext = Number.MAX_SAFE_INTEGER;
    }

    var windowStartId = computeWindowStartMsgId(chat, cwRounds);
    if (windowStartId <= 0) return; // 实际轮数 ≤ cwRounds，无需截断

    // 找到 windowStartId 对应的数组索引
    for (var i = 0; i < chat.length; i++) {
        var m = chat[i];
        if ((m.mes_id || 0) >= windowStartId) {
            if (i > 0) chat.splice(0, i);
            return;
        }
    }
}
```

**4e. 在 `onBeforeGenerate` 中调用**
- 在 L796 `chatMessages = runtime.getChat()` 之后
- 在 SmartPush 注入逻辑之前

### 变更 5：更新测试

**文件**: `test/context-window.test.js`
- **删除** `formatContextMemory` 导入和所有相关测试（L94-L209）
- **保留** `computeWindowStartMsgId` 导入和所有相关测试（不变）

**文件**: `test/dialog-window.test.js`（新增）
- `adjustDialogWindow` 逻辑测试（mock localStorage + runtime）

**文件**: `test/run.mjs`
- 新增 `'dialog-window': 'dialog-window.test.js'` 到 testMap

---

## 文件变更清单

| 文件 | 变更 | 影响 |
|------|------|------|
| `src/core/engine/context-window.js` | 删除 `filterPreWindowEntries` + `formatContextMemory` | 🔴 |
| `src/adapter/events.js` | 删除 `ne_context_memory` 注入，新增 `adjustDialogWindow`，迁 setting key | 🔴 |
| `src/adapter/panel-settings.js` | 替换滑块 UI + 新增复选框 | 🟡 |
| `src/core/i18n.js` | 替换 i18n keys | 🟡 |
| `test/context-window.test.js` | 删除 `formatContextMemory` 测试 | 🟢 |
| `test/dialog-window.test.js` | 新增 | 🟢 |
| `test/run.mjs` | 注册新测试 | 🟢 |
| `src/core/test-runner/test-data.generated.js` | 构建时自动再生 | 🟢 |
| `src/core/test-runner/monitor.js` | 删除 `__ne_debug_last_context_memory` 引用 | 🟡 |

---

## 验证步骤

1. `npm test` — 全部单元测试 + ratchets
2. `npm run build` — test-data 再生 + Rollup 构建
