# 滑动窗口上下文注入实装

## 当前状况

`context-window.js` 中三个函数已完整实现：
- `computeWindowStartMsgId` — 从末尾向前数 N 轮，返回窗口起始 msg_id
- `filterPreWindowEntries` — 提取窗口之前的 STM/LTM
- `formatContextMemory` — 格式化为 Markdown 摘要（已 export）

设置 UI 中 Context Window Rounds 滑块已存在（10-100，步长5，默认30），存储在 `localStorage.ne_settings.contextWindowRounds`。

**唯一断点**：`formatContextMemory` 从未在 `onBeforeGenerate` 中被调用。

## 改动

### 文件：`src/adapter/events.js`

**1. 新增 import**（第 4 行附近）：

```js
import { formatContextMemory } from '../core/engine/context-window.js';
```

**2. 在 `onBeforeGenerate` 中接入**（在 state_table 注入之后、formatted memory 之前，约第 819 行之后）：

```js
// 滑动窗口历史摘要 — 窗口前的 LTM/STM 结构化摘要
var cwRounds = neSettings.contextWindowRounds || 30;
var ctxMemory = formatContextMemory(vault, chatMessages, cwRounds);
if (ctxMemory) {
    runtime.injectPrompt('ne_context_memory', ctxMemory, 'in_chat', 2, 'system');
    globalThis.__ne_debug_last_context_memory = ctxMemory;
}
```

**注入深度为 2**（与 state_table 同级，都在 SmartPush 的 depth 3 之前），确保摘要和状态表一起出现在对话上下文的前段。

### 不需要改动的部分

- `context-window.js` — 代码已完成，无需修改
- `panel.js` — 设置滑块已完成，无需修改
- `settings.js` — 设置读取已完成，无需修改

## 验证

1. 启动一个 30+ 轮的长对话
2. 检查 Debug 日志中 `globalThis.__ne_debug_last_context_memory` 是否非空
3. 检查注入的摘要内容：应包含 LTM 的 summary + 窗口前 STM events，格式为 Markdown 列表
4. 确认对话回复质量不退化

## 注意事项

- `contextWindowRounds` 默认 30 可能偏大。实际效果取决于窗口内对话的 token 量，30 轮短消息 vs 30 轮长文差异巨大。后续可考虑改为按 token 预算而非轮数
