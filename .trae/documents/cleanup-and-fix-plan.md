# NE-Memory 代码清理与修复计划

---

## 一、问题总览

经过四层逐层挖掘，共发现问题分布在三个层级：

```
代码层 ─────────── Token 计数器 Bug     (7 项)
                  Dead Code 清理       (5 个死函数)
                  注入模块越界          (~800 行需搬迁)

运行时层 ───────  世界书同步未激活      (syncStateToWorldBook 从未调用)
                  状态注入静默失败      (buildStateOnlyInjection 说谎)
                  tok_chat 永远为 0    (SillyTavern 不填充 token_count)

架构层 ───────   panel.js 3207 行     (15 个 section，4 个非 UI)
                  injection 逻辑散落    (无独立模块)
```

---

## 二、执行顺序与依赖关系

```
Step 1: 删除 v1 死代码         ← 依赖：无
    │
Step 2: 提取 injection.js      ← 依赖：Step 1 完成（死代码已删，不污染新模块）
    │
Step 3: 修复 Token 计数器      ← 依赖：Step 2 完成（renderUsageTab 路径稳定）
    │
Step 4: 修复状态注入路径       ← 依赖：Step 2 完成（injection.js 可用）
```

依赖链逻辑：
- Step 1 → Step 2：先删再搬，避免把死代码搬进新文件
- Step 2 → Step 3：Token 面板渲染函数 `renderUsageTab` 在 panel.js 中，它的数据源 `getUsageOverview` 在 token-stats.js 中，与 injection 无关。但 Step 2 会改 events.js 的 import 路径，需要先稳定
- Step 2 → Step 4：状态注入的修复可能涉及 `buildStateOnlyInjection`（会被搬进 injection.js）和 worldbook-sync，依赖 injection.js 的模块边界明确

---

## 三、Step 1: 删除 v1 死代码

### 目标
删除 `src/adapter/panel.js` 中已不再被任何路径调用的 v1 注入逻辑。

### 具体删除清单

| 行号范围 | 函数 | 原因 |
|----------|------|------|
| L773-800 | `formatActiveFactionSummary` | 仅被 `formatVaultForPrompt`(L1392) 内部调用，死链 |
| L1367-1465 | `formatVaultForPrompt` | v1 主注入器，全项目无调用方（`export` 但 0 imports） |
| L1467-1499 | `estimateComplexityBudget` | 仅被 `formatSmartContext`(L1532) 内部调用，将随 Step 2 搬走而非删除 |
| L2062-2081 | `buildFullDumpInjection` | v1 全量 dump fallback，0 调用方 |
| L2083-2095 | `formatMinimalState` | 仅被 `buildFullDumpInjection`(L2077) 内部调用，死链 |
| L2023-2051 | `formatFullDump` | 仅被 `buildFullDumpInjection`(L2070) 内部调用，死链 |

> **注意**：`estimateComplexityBudget` 虽然也是 v1 残留，但它被 v2 的 `formatSmartContext` 使用。**不删除**，将随 Step 2 一同搬入 injection.js。

### 连带清理

- [panel.js L5](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L13) 删除不再需要的 import：确认 `formatStateSummary`, `formatActiveCharacterSummary`, `formatQuestSummary` 的 `formatActiveFactionSummary` 引用是否还需要（`formatActiveFactionSummary` 死后，`formatVaultForPrompt` 也跟着死，而这些 import 主要是 `formatVaultForPrompt` 用的）
- 实际上这些 import 在 injection 模块搬走后还需重新评估——这放在 Step 2 处理

### 验证
- `grep -rn "formatVaultForPrompt\|buildFullDumpInjection" src/` 返回 0 结果（除了定义行本身）
- `grep -rn "formatActiveFactionSummary" src/` 返回 0 结果
- 构建不报错

---

## 四、Step 2: 提取 injection.js

### 目标
将 `src/adapter/panel.js` 中的注入格式化逻辑搬到 `src/core/engine/injection.js`。

### 搬出清单（按保留顺序）

| 行号 | 函数 | 可见性 |
|------|------|--------|
| L1467 | `estimateComplexityBudget` | 内部（被 formatSmartContext 用） |
| L1500 | `computeVisibleWindow` | 内部 |
| L1530 | `formatSmartContext` | **export**（events.js 用） |
| L1872-1955 | `parseKBAnnotations` + 3 子函数 | 内部 |
| L1957 | `compileRetrievalBudget` | 内部 |
| L2023 | `formatFullDump` | ❌ 已在 Step 1 删除 |
| L2053 | `buildStateOnlyInjection` | **export**（events.js 用） |
| L2062-2164 | `buildFullDumpInjection` 等 | ❌ 已在 Step 1 删除 |
| L2097 | `formatBM25Results` | 内部 |
| L2118 | `prefetchOriginalTexts` | 内部 |

### 不搬的

| 函数 | 原因 |
|------|------|
| L773 `formatActiveFactionSummary` | 已在 Step 1 删除 |
| `buildKBInstructionBlock` | 被 `formatSmartContext` 内部调用，一起搬 |
| `sortLtmByMsgOrder` (L40) | 属于 LTM 排序工具，非 injection 专属，可留在 panel 或单独放 |

### injection.js 最终结构

```
src/core/engine/injection.js
├── estimateComplexityBudget()
├── computeVisibleWindow()
├── formatSmartContext()          ← export
│   └── 内部调用: 上述两个 + parseKBAnnotations + compileRetrievalBudget
│                + formatBM25Results + prefetchOriginalTexts + buildKBInstructionBlock
├── buildStateOnlyInjection()     ← export
├── parseKBAnnotations()          ← 内部
├── buildKBInstructionBlock()     ← 内部
├── compileRetrievalBudget()      ← 内部
├── formatBM25Results()           ← 内部
└── prefetchOriginalTexts()       ← 内部
```

### 需要修改的外部引用

**events.js L10**：
```javascript
// 改前
import { closeVaultOverlay, formatSmartContext, buildStateOnlyInjection } from './panel.js';
// 改后
import { closeVaultOverlay } from './panel.js';
import { formatSmartContext, buildStateOnlyInjection } from '../core/engine/injection.js';
```

**panel.js**：删除搬走的函数定义体，更新 top import（这些函数本身只在 panel.js 内部被 formatSmartContext 调用，搬迁后 panel.js 无需再 import 它们）。

### injection.js 需要的 import（从 panel.js 已有 import 推导）

```javascript
import { t_narrative } from '../i18n.js';
import { sortStmByMsgOrder } from '../vault/store.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { extractEntityNames, lookupEntityChains, mergePipelines } from './retrieval.js';
import { resolveAmbiguousReferences, resolveWithLM } from './ambiguity.js';
import { RetrievalNotebook } from '../vault/retrieval-notebook.js';
import { isAuto, computeStmBatch } from '../params.js';
import { buildRetrievalMessages } from './retrieval.js';
import { callMemoryRetrievalWithTools } from '../api/llm.js';
import { recordTelemetry } from '../api/llm.js';
import { executeAccess } from '../tools.js';
```

### 验证
- `events.js` import 路径正确
- `formatSmartContext` 正常工作（运行一次 SmartPush）
- panel.js 无 import 错误
- 构建不报错

---

## 五、Step 3: 修复 Token 计数器

### 3.1 会话计数器独立

**问题**：[token-stats.js L56-58](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js#L56-L58)
```javascript
sessionChat = allChat;   // ← 直接复制总计
sessionNE = allNE;
sessionTurns = allTurns;
```

**修复方案**：

在 `token-stats.js` 中新增一个 `_sessionSnapshot` 内存变量，在 `getUsageOverview` 首次调用时快照当时的 `allChat`/`allNE`/`allTurns` 值作为"会话起点"，后续调用中"本次会话" = 当前值 - 起点值。

```javascript
var _sessionSnapshot = null;

export function getUsageOverview(getChatStatsFn) {
    // ... 先计算所有 allChat/allNE/allTurns（总计）...
    
    // Session: 首次调用建立快照
    if (!_sessionSnapshot) {
        _sessionSnapshot = { chat: allChat, ne: allNE, turns: allTurns };
    }
    
    var sessionChat = allChat - _sessionSnapshot.chat;
    var sessionNE = allNE - _sessionSnapshot.ne;
    var sessionTurns = allTurns - _sessionSnapshot.turns;
    // ...
}
```

因为 `getUsageOverview` 被 `panel.js` → `renderUsageTab` + `vault-changed` 事件调用，这个快照逻辑自然支持增量计算。

> **替代方案**：完全删除"本次会话"卡片，因为每次刷新页面 localStorage 都在，用户无法感知"会话"边界。但这需要 UI 决策。

### 3.2 管线分解用真实数据

**问题**：[panel.js L3018](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L3018)
```javascript
data: [
    Math.round(overview.allNE * 0.45),  // 硬编码百分比
    Math.round(overview.allNE * 0.22),
    ...
]
```

**修复方案**：

`getUsageOverview` 需要额外返回四个分类 token 的累计值（`stmTok`/`ltmTok`/`spTok`/`toolTok`）。当前 `getUsageOverview` 只遍历 `chat-telemetry` 中的 `aggregates`，已经有 `total_tok_stm`/`total_tok_ltm`/`total_tok_sp`/`total_tok_tool`。

修改 `getUsageOverview` 返回值：
```javascript
return {
    sessionChat, sessionNE, sessionTotal, sessionAvgPerTurn,
    monthChat, monthNE, monthTotal, monthAvgPerDay,
    allChat, allNE, allTotal, allAvgPerDay,
    breakdown: {            // 新增
        stm: stmTok,
        ltm: ltmTok,
        sp: spTok, 
        tool: toolTok
    }
};
```

panel.js 的 bar chart 数据改为：
```javascript
data: [
    overview.breakdown.stm,
    overview.breakdown.ltm,
    overview.breakdown.sp,
    overview.breakdown.tool
]
```

### 3.3 卡片信息层级修正

**问题**：三张卡片顶部大号数值显示 `💬 0` (sessionChat=0), `🗓 0` (monthChat=0), `📦 0` (allChat=0)，因为 `tok_chat` 始终为 0。真正有价值的数据（NE 管线 37.1k）被压在第三行 sub-label。

**修复方案 A（保守）**：
- 三张卡片的大号数值改为显示**总计 token**（`sessionTotal`/`monthTotal`/`allTotal`），这个是可靠且非零的
- 将 `👤 用户对话: 0` 保留在 sub-label，将 `⚙ NE管线: 37.1k` 提升显示层级

**修复方案 B（激进）**：
- 删除 `👤 用户对话` 行（因为 tok_chat 取不到）
- 大号值显示 `⚙ NE管线: 37.1k`，sub-label 显示 Total + 轮均/日均

**推荐方案 A**，因为更保守且不丢失信息。

### 3.4 总计日均天数修正

**问题**：[token-stats.js L72](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js#L72)
```javascript
allAvgPerDay: monthDays > 0 ? (allChat + allNE) / max(1, monthDays) : 0
```

**修复**：总计的日均应该用**有数据的总天数**（`daily` 中所有 key 的数量），而不是本月天数：
```javascript
var totalDays = Object.keys(daily).length;
allAvgPerDay: totalDays > 0 ? (allChat + allNE) / totalDays : 0
```

### 3.5 `recordChatToken` 0 值优化

**问题**：[chat-telemetry.js L110](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/chat-telemetry.js#L110) `!value` 短路。

这不是 bug（加 0 无意义），但在调试不友好。保持现状即可，不改。

### 3.6 卡片 emoji 修正

| 卡片 | 当前 emoji | 修正为 |
|------|-----------|--------|
| 本次会话 | `💬` | `📊` (统计) 或 `🔄` (会话) |
| 本月 | `🗓` | `📅` (日历/月度) |
| 总计 | `📦` | `📊` (累积) 或 `∑` |

### 验证
- Usage 标签页渲染三张卡片：数值不再是 0
- 管线分解柱状图：非固定比例，数据变化时柱形变化
- 总计日均：合理数值（非 (37.1k/1=37.1k)）

---

## 六、Step 4: 修复状态注入路径

### 问题回顾

| 路径 | 状态 | 说明 |
|------|------|------|
| 世界书 `NE_Memory_State` | 🔴 从未写入 | `syncStateToWorldBook` 被 import 但从未调用 |
| `formatSmartContext` 注入 | 🟡 仅含叙事记忆 | 无结构化 state（角色/阵营/任务） |
| `ne_state_block` 指令 | 🟡 仅含时间/场景 | 无角色详情 |
| `buildStateOnlyInjection` | 🔴 错误提示 | "Current state is in World Book" 但世界书为空 |

### 方案分析

有两个方向：

**方向 A：激活世界书路径**（修改 update.js）
- 在 `executeIncrementalUpdate` 管道完成后调用 `syncStateToWorldBook(vault)`
- 优点：世界书由 ST 自动按 key 触发（角色名即 key），零 token 开销
- 缺点：世界书是个外部系统，调试困难；ST 世界书的触发时机不可控

**方向 B：dump 给主 LLM**（修改 injection.js）
- 在 `formatSmartContext` 的 parts 中追加一段 state 摘要
- 或修改 `buildStateOnlyInjection` 降级时不撒谎，真实 dump state
- 优点：可控、可见、可调试
- 缺点：永久性消耗上下文 token

**方向 C：双轨制**（A + B 的 fallback）
- 正常路径：激活世界书同步（方向 A）
- 降级路径：`buildStateOnlyInjection` 不再说谎，改为输出真实的 state 摘要
- 世界书是否成功激活 → 通过检查 `syncStateToWorldBook` 是否抛异常判断

### 推荐：方向 C

理由：
1. 世界书路径一旦工作就是"免费"的（不占上下文）
2. fallback 不再说谎，至少主 LLM 能看到真实状态
3. 兼容当前架构，改动量小

### 具体修改

**4.1 update.js：激活世界书同步**

在 `executeIncrementalUpdate` 的管道完成点调用：
```javascript
// 在 executeIncrementalUpdate 的末尾（write 之后）
try {
    await syncStateToWorldBook(vault);
} catch (e) {
    console.warn('[NE] World book sync failed:', e.message);
}
```

**4.2 injection.js：降级兜底**

修改 `buildStateOnlyInjection`：
```javascript
export function buildStateOnlyInjection(vault) {
    var parts = [];
    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }
    
    var state = vault.content && vault.content.state;
    if (state) {
        var stateLines = [];
        if (vault.content.story_time) stateLines.push('Time: ' + vault.content.story_time);
        if (vault.content.story_scene) stateLines.push('Scene: ' + vault.content.story_scene);
        
        var chars = state.characters || {};
        var activeChars = Object.keys(chars).filter(function(n) {
            return chars[n].status === '活跃';
        });
        if (activeChars.length > 0) {
            stateLines.push('Active characters: ' + activeChars.join(', '));
        }
        
        if (stateLines.length > 0) {
            parts.push('## Current State\n' + stateLines.join('\n'));
        }
    }
    
    return parts.join('\n\n');
}
```

### 验证
- 启动后确认 `NE_Memory_State` 世界书包含角色/阵营/任务条目
- `formatSmartContext` 异常时降级到 `buildStateOnlyInjection`，内容不再是谎言
- 运行一次对话，观察主 LLM 的行为是否改善

---

## 七、不在本次范围内的已知问题

| 问题 | 原因 | 暂不修复理由 |
|------|------|-------------|
| `tok_chat` 始终为 0 | SillyTavern 不填充 `message.extra.token_count` | 外部依赖，需调研 ST 版本/配置 |
| 本月 vs 总计数据源不一致 | 本月从 `ne_token_daily` 读，总计从 `ne_chat_stats` 读 | 低优先级，数据量小时差异不显著 |
| `ne_state_block` 缺少角色/阵营状态 | 设计如此（仅时间/场景） | 不属于修复，属于功能增强 |

---

## 八、验证总清单

- [ ] Step 1: `grep` 确认死代码完全删除
- [ ] Step 2: events.js import 路径正确，SmartPush 正常工作
- [ ] Step 3: Usage 面板数据正确（会话≠总计，管线分解非固定比例）
- [ ] Step 4: 世界书有内容，降级注入不再说谎
- [ ] 整体: 无 import 错误，无 console.error
