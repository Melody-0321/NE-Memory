# 对话轮次滑动窗口方案

---

## 一、方案修正

> 你指出的问题完全正确——提取最近 N 轮再注入会导致 LLM 看到同一段对话两次（ST 原生 chat stream 一份 + 我们注入的一份），且顺序紊乱。修正如下：

**不碰聊天流本身。** ST 的 chat stream 保持原样、原顺序、原格式。我们只在 ST 的 chat stream **之外**，为超出窗口的消息提供记忆摘要补充。

```
LLM 收到的 prompt 结构:

[ST 角色卡 + 世界书 + 系统提示]
[depth=0: ne_state_block / ne_char_block — 指令]
[depth=1: ne_context_memory — 历史记忆摘要]          ← 仅此一处新增
[ST 的 raw chat history — 原样、原顺序、不修改]
[depth=2: ne_memory_vault — formatSmartContext]
```

**核心逻辑**：

```
配置 contextWindowRounds = N（默认 30）

ST 的 chat history:
  [msg_1] [msg_2] ... [msg_old] ... [msg_recent]
                                          ←── 最近 N 轮 ──→
                      ←─ N 轮之前 ──→

LLM 同时看到:
  A. ST 原生 chat stream（完整、原顺序）—— 因为最近 N 轮必然在 maxContext 内
  B. ne_context_memory（depth=1）—— N 轮之前的事件摘要（来自 STM/LTM）
```

**为什么只需要补充 N 轮之前的摘要**：

- 最近 N 轮原文 → ST 的 chat stream 自然包含（这些消息最新，maxContext 裁剪总是从最旧的开始，最近 N 轮不可能被裁掉）
- N 轮之前的消息 → 被 ST 的 token 裁剪裁掉 → 我们注入 STM/LTM 摘要弥补
- 不需要提取/解析/重排 chat → 不破坏顺序、不重复注入

---

## 二、具体修改

### Step 1: i18n — 新增翻译

**文件**: [i18n.js](file:///d:/SillyTavern/xm/ne-memory/src/core/i18n.js)

在 `NARRATIVE_I18N` 的三个语言块中新增：

```
'Context Window Rounds': '上下文窗口轮数',
'Context Window Rounds': '上下文視窗輪數',
```

### Step 2: Settings UI — 滑块

**文件**: [panel.js — renderSettingsTab()](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2231)

在 Engine 区 `stmMaxUnconsolidated` 滑块之后（L2275 `</div></div>` 之前）插入：

```javascript
'<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Context Window Rounds') + '</span><span class="range-val" id="nes_context_window_val">' + (settings.contextWindowRounds || 30) + '</span></div>' +
'<input type="range" id="nes_context_window_rounds" min="10" max="100" step="5" value="' + (settings.contextWindowRounds || 30) + '" style="width:100%;">' +
'<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Recent rounds appear as full text in chat. Earlier events are supplemented with memory summaries.') + '</div>' +
```

事件绑定（在 L2380-2387 区域其他滑块绑定处新增）：

```javascript
var cwEl = byId('nes_context_window_rounds');
if (cwEl) { cwEl.oninput = function () { var v = byId('nes_context_window_val'); if (v) v.textContent = cwEl.value; saveSettingsTab(); }; }
```

### Step 3: 保存 — `saveSettingsTab()`

**文件**: [panel.js — saveSettingsTab()](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2638)

在 `settings` 对象中新增：

```javascript
contextWindowRounds: Number(byId('nes_context_window_rounds').value),
```

### Step 4: 核心函数 — `formatContextMemory`

**文件**: 新建 `src/core/engine/context-window.js`

```javascript
import { sortStmByMsgOrder } from '../vault/store.js';

/**
 * 计算 ST chat 中最近 N 轮的起始 msg_id，
 * 用于判断哪些 STM 条目属于"N 轮之前"（需要摘要补充）。
 *
 * 返回: 最近 N 轮的第一条消息的 msg_id，或 0（对话 < N 轮时）
 */
function computeWindowStartMsgId(chatMessages, contextWindowRounds) {
    if (!chatMessages || chatMessages.length === 0) return 0;

    var rounds = 0;
    var prevRole = null;
    var firstMsgId = 0;

    // 从最新消息倒推 N 轮
    for (var i = chatMessages.length - 1; i >= 0; i--) {
        var m = chatMessages[i];
        if (!m || m.is_system) continue;
        var role = (m.role === 'user' || m.is_user) ? 'user' : 'assistant';

        if (prevRole === 'user' && role === 'assistant') {
            rounds++;
            if (rounds >= contextWindowRounds) {
                firstMsgId = m.id || 0;
                break;
            }
        }
        prevRole = role;
    }

    return firstMsgId;
}

/**
 * 筛选 N 轮之前的 STM/LTM 条目。
 * 返回 { stm: [...], ltm: [...] }
 */
function filterPreWindowEntries(vault, chatMessages, contextWindowRounds) {
    var content = vault && vault.content ? vault.content : {};
    var ltm = content.ltm_entries || [];
    var allStm = [].concat(content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allStm = sortStmByMsgOrder(allStm);

    var windowStartMsgId = computeWindowStartMsgId(chatMessages, contextWindowRounds);

    if (windowStartMsgId <= 0) {
        // 对话 < N 轮，所有 STM 都在窗口内 → 只返回 LTM
        return { stm: [], ltm: ltm };
    }

    // 筛选: msg_id 或 absMsgStart < windowStartMsgId 的 STM 条目
    var preWindowStm = allStm.filter(function(entry) {
        var refMsgIds = entry.msg_ids || [];
        var latestRef = 0;
        for (var j = 0; j < refMsgIds.length; j++) {
            var mid = Number(refMsgIds[j]);
            if (mid > latestRef) latestRef = mid;
        }
        if (latestRef > 0) return latestRef < windowStartMsgId;
        // fallback: 使用 absMsgStart 估算
        var absStart = entry.absMsgStart || 0;
        return absStart > 0 && absStart < windowStartMsgId;
    });

    return { stm: preWindowStm, ltm: ltm };
}

/**
 * 主函数: 为 N 轮之前的对话构造记忆摘要注入文本。
 * 不提取、不重排、不重复注入原文——仅补充 ST chat stream 之外的记忆。
 */
export function formatContextMemory(vault, chatMessages, contextWindowRounds) {
    if (!chatMessages || chatMessages.length === 0) return '';
    if (!vault || !vault.content) return '';

    var filtered = filterPreWindowEntries(vault, chatMessages, contextWindowRounds);
    if (filtered.ltm.length === 0 && filtered.stm.length === 0) return '';

    var lines = [];
    lines.push('## 历史记忆摘要');
    lines.push('');

    // LTM: 已整合的叙事线
    if (filtered.ltm.length > 0) {
        lines.push('以下为更早对话中已整合的关键记忆：');
        lines.push('');
        filtered.ltm.forEach(function(e) {
            var timePart = (e.time_range || e.period || '');
            lines.push('- [' + timePart + '] ' + (e.scene || '') + ': ' + (e.title || e.event || e.summary || ''));
        });
        lines.push('');
    }

    // STM: N 轮之前的碎片
    if (filtered.stm.length > 0) {
        lines.push('以下为更早对话中的事件片段：');
        lines.push('');
        var MAX = 20;
        var shown = 0;
        filtered.stm.forEach(function(e) {
            if (shown >= MAX) return;
            var timePart = (e.time_range || e.period || '');
            var text = (e.event || e.summary || '');
            if (text) {
                lines.push('- [' + timePart + '] ' + (e.scene || '') + ': ' + text);
                shown++;
            }
        });
        lines.push('');
    }

    return lines.join('\n');
}
```

**不需要** `parseChatRounds` 和 `formatRecentConversation` —— 不提取/重排原文。

### Step 5: 集成 — `onBeforeGenerate`

**文件**: [events.js onBeforeGenerate()](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L627)

新增 import：

```javascript
import { formatContextMemory } from '../core/engine/context-window.js';
```

在 `read(vault)` 之后、`formatSmartContext` 之前注入：

```javascript
var neSettings = {};
try { var raw = localStorage.getItem('ne_settings'); if (raw) neSettings = JSON.parse(raw); } catch (e) {}
var contextWindowRounds = neSettings.contextWindowRounds || 30;
var contextMemory = formatContextMemory(vault, chatMessages, contextWindowRounds);
if (contextMemory) {
    runtime.injectPrompt('ne_context_memory', contextMemory, 'in_chat', 1, 'system');
    var cmCharEstimate = Math.round(contextMemory.length / 3.5);
    if (chatId && cmCharEstimate > 0) {
        recordChatToken(chatId, 'tok_chat', cmCharEstimate);
    }
}
```

`depth=1` —— 在 state_block 指令 (depth=0) 之后、chat history 之前。

---

## 三、不修改的部分

| 项目 | 原因 |
|------|------|
| ST 的 chat stream | 原样保留——不 mark is_system、不隐藏、不重排 |
| `formatSmartContext` | 不改——记忆检索独立于上下文窗口 |
| `parseChatRounds` | 不需要——不提取原文 |
| `formatRecentConversation` | 不需要——ST chat stream 自然地包含最近消息 |
| vault 读写路径 | 不改——STM/LTM 数据源不变 |

---

## 四、Token 预算估算

| 组件 | 估算 token |
|------|-----------|
| LTM 记忆（~15 条，80 chars/条） | ~350 |
| pre-window STM（~10 条，60 chars/条） | ~200 |
| 格式开销 | ~80 |
| **合计** | **~630** |

对比之前方案（~3150 tokens），减少 80%。且不重复 chat stream 中已存在的内容。

---

## 五、边界情况

| 场景 | 行为 |
|------|------|
| 对话 < N 轮 | `computeWindowStartMsgId` 返回 0 → 所有 STM 视为窗口内 → 仅注入 LTM |
| vault 中无 STM/LTM | `formatContextMemory` 返回 `''` → 不注入 |
| 单条 STM 跨窗口边界 | 已由 `realConsolidate` 整合为 LTM，不会产生边界问题 |
| 用户改变 N 值 | 下轮对话立即生效（每次 onBeforeGenerate 读取最新设置） |
| dryRun (PromptManager) | `onBeforeGenerate` 第一行 skip，不影响 |

---

## 六、修改文件清单

| 文件 | 改动 | 行数 |
|------|------|------|
| i18n.js | 新增三语翻译 | +3 |
| panel.js (renderSettingsTab) | 新增滑块 HTML | +5 |
| panel.js (saveSettingsTab) | 新增字段保存 | +1 |
| panel.js (事件绑定) | 新增滑块 oninput | +2 |
| context-window.js（新文件） | 核心逻辑 | ~90 |
| events.js (onBeforeGenerate) | import + 注入调用 | +12 |

**合计 ~115 行**。

---

## 七、验证清单

- [ ] Step 1: Settings 面板出现「上下文窗口轮数」滑块（10-100, 默认 30）
- [ ] Step 2: 滑块拖动实时更新，刷新后持久化
- [ ] Step 3: 对话 < N 轮时，仅注入 LTM（无 pre-window STM）
- [ ] Step 4: 对话 > N 轮时，pre-window STM 出现在注入中
- [ ] Step 5: chat stream 中原顺序不变（不重复、不重排）
- [ ] Step 6: `formatSmartContext` 不受影响（仍正常注入 memory vault）
- [ ] Step 7: vault 为空时不注入上下文记忆
- [ ] Step 8: 构建通过
