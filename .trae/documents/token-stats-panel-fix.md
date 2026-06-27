# Token 统计面板修复与改造

## 问题诊断

| # | 症状 | 位置 | 直接原因 |
|---|------|------|----------|
| 1 | 三张卡「👤 User Chat」无数值 | [panel.js:L2260-L2262](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2260-L2262) | 模板写了 label 漏了值 |
| 2 | 三张卡「📦 Total」与主数值冗余 | [panel.js:L2260-L2262](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2260-L2262) | 主值已是 Total |
| 3 | **Per-Chat 表格永远是 0**（核心 bug） | [events.js:L381](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L381) | `chatId` 变量未声明 → ReferenceError → 空 catch 吞掉。`tok_chat` 写入永久失败 |
| 4 | 首轮注入 token 丢失 | [events.js:L888](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L888) → [chat-telemetry.js:L75](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/chat-telemetry.js#L75) | `incrementChatTurn` 在 pipeline flush 中才调用，晚于 `onBeforeGenerate`。首轮无 turn → `recordChatStat` 因 `turns.length===0` 提前 return |
| 5 | 折线图不渲染 | [panel.js:L2322](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2322) | `daily.length > 0` 守卫：无数据跳过 Chart |
| 6 | 折线图 Chat 线恒为 0 | [events.js:L382](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L382) | Bug 3 连带吞掉 `recordDailyToken('tok_chat', ...)` |
| 7 | 柱状图全零时空白 | [panel.js:L2295-L2318](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2295-L2318) | 数据零时 bar 无高度 |

### 直接原因链路

```
tok_chat 写入 → onMessageReceived:L381 → chatId undefined → ReferenceError → catch{}吞掉
                                                                    ↘ L382 同被吞（daily）
tok_chat 写入 → onBeforeGenerate:L888 → turns.length===0 → recordChatStat return（首轮）
NE tokens  → llm.js:L90 → recordChatStat → ✓ 正常（pipeline flush 中 incrementChatTurn 先执行）
```

**Bug 3 是 Per-Chat 表格为 0 的直接原因**：`chatId` 在 `onMessageReceived` 中从未声明。ES 模块 strict mode 下访问未声明变量抛 `ReferenceError`，被内层 `try {} catch (e) {}` 空捕获块无声吞掉。`tok_chat` 永远无法写入 `ne_chat_stats`。

Bug 4 是次要原因：即使 Bug 3 修了，首轮的 `tok_chat` 也因 `incrementChatTurn` 时序靠后而被丢弃。

---

## 修复方案

分两步执行：
- **Step A**：排 Bug（修复数据记录链路 + 卡片字段）
- **Step B**：图表改造（饼图 + 柱状图 + 下拉选项）

---

## Step A：排 Bug

### A1. [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) — 声明 `chatId`（Bug 3 + 6）

在 `onMessageReceived` 中，`recordChatToken` / `recordDailyToken` 所在的 try 块（L372-L386）之前，该函数作用域内没有任何 `chatId` 声明。在函数顶部已有 `getChatIdFn` / `getChatMessagesFn`，但未获取 chatId。

**改法**：在 `onMessageReceived` 函数开头（约 L258 之后），添加：

```js
var chatId = getChatIdFn ? getChatIdFn() : 'default';
```

确保 L381 的 `recordChatToken(chatId, ...)` 和 L382 的 `recordDailyToken(...)` 能拿到有效的 chatId。

### A2. [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) — `incrementChatTurn` 前移到 `onBeforeGenerate`（Bug 4）

**当前**：`incrementChatTurn(chatId)` 仅在 `flushPendingMessages` 中调用（L419）。`onBeforeGenerate` 在此之前就试图记录 `tok_chat`。

**改法**：

1. L6 导入增加 `getChatTurnNumber`：
```js
import { incrementChatTurn, recordChatStat, recordChatToken, getChatTurnNumber } from '../core/engine/chat-telemetry.js';
```

2. 在 `onBeforeGenerate` 中（vault 读取之后、注入之前，约 L789）：
```js
incrementChatTurn(chatId);
```

3. 在 `flushPendingMessages` 中，删除原 L419 的 `incrementChatTurn(chatId)`，改为 fallback：
```js
if (getChatTurnNumber(chatId) === 0) incrementChatTurn(chatId);
```

### A3. [panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js) — 卡片字段补值 + 去冗余（Bug 1 + 2）

当前每张卡模板（L2260-L2262）：
```
主值: Total
  ⚙ NE Pipeline: xxx
  👤 User Chat               ← Bug: 缺值
  📦 Total: xxx | Avg: xxx   ← Bug: 冗余
```

改为：
```
主值: Total
  ⚙ NE Pipeline: xxx  |  👤 User Chat: xxx
  N 轮次  |  均/轮: xxx
```

三张卡字段映射：
| 卡 | 主值 | NE | Chat | 粒度 | Avg |
|----|------|-----|------|------|-----|
| 本Session | `sessionTotal` | `sessionNE` | `sessionChat` | `sessionTurns`轮 | `sessionAvgPerTurn` |
| 本月 | `monthTotal` | `monthNE` | `monthChat` | `monthDays`天 | `monthAvgPerDay` |
| 总计 | `allTotal` | `allNE` | `allChat` | `totalDays`天 | `allAvgPerDay` |

但 `getUsageOverview` 未返回 `sessionTurns/monthDays/totalDays`。在 [token-stats.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js) 的返回值中增加这些已有内部变量：

```js
sessionTurns: sessionTurns,
monthDays: monthDays,
totalDays: totalDays,
```

### A4. [panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js) — 图表空态（Bug 5 + 7）

- 柱状图：去掉 `daily.length > 0` 级别的条件守卫；若 `breakdown` 全零，canvas 下方显示"暂无数据"。
- 折线图/柱状图：始终渲染 canvas；数据为空时显示覆盖提示。

---

## Step B：图表改造

### B1. Pipeline Breakdown → 饼图 + 统计范围下拉

#### 新增数据查询（[token-stats.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/token-stats.js)）

三个新导出：

```js
// 按月份聚合 breakdown
export function getMonthlyBreakdown(month) {
    var data = loadDaily();
    var stm = 0, ltm = 0, sp = 0, tool = 0, chat = 0;
    Object.keys(data).forEach(function(date) {
        if (date.substring(0, 7) === month) {
            var d = data[date];
            stm += (d.tok_stm || 0);
            ltm += (d.tok_ltm || 0);
            sp += (d.tok_sp || 0);
            tool += (d.tok_tool || 0);
            chat += (d.tok_chat || 0);
        }
    });
    return { stm: stm, ltm: ltm, sp: sp, tool: tool, chat: chat };
}

// 按单一对话聚合 breakdown
export function getChatBreakdown(getChatStatsFn, chatId) {
    var stats = getChatStatsFn() || {};
    var chat = stats[chatId];
    if (!chat || !chat.aggregates) return { stm: 0, ltm: 0, sp: 0, tool: 0, chat: 0 };
    var agg = chat.aggregates;
    return {
        stm: agg.total_tok_stm || 0,
        ltm: agg.total_tok_ltm || 0,
        sp: agg.total_tok_sp || 0,
        tool: agg.total_tok_tool || 0,
        chat: agg.total_tok_chat || 0
    };
}

// 可用月份列表（最新在前）
export function getAvailableMonths() {
    var data = loadDaily();
    var months = {};
    Object.keys(data).forEach(function(date) {
        months[date.substring(0, 7)] = true;
    });
    var list = Object.keys(months).sort().reverse();
    // 如果没有历史数据，至少包含当前月
    if (list.length === 0) list.push(new Date().toISOString().substring(0, 7));
    return list;
}
```

#### Bridge 注入（[index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js)）

导入新函数：
```js
import { getUsageOverview, getDailyStats, getAllChatUsage, getMonthlyBreakdown, getChatBreakdown, getAvailableMonths } from '../core/engine/token-stats.js';
```

在 `_buildDebugApi` 中注册：
```js
getMonthlyBreakdown: function(month) { return getMonthlyBreakdown(month); },
getChatBreakdown: function(chatId) { return getChatBreakdown(getAllChatStats, chatId); },
getAvailableMonths: function() { return getAvailableMonths(); },
```

#### UI（[panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js)）

替换 Pipeline Breakdown 区块（Section B）为：

```html
<!-- 统计范围下拉 -->
<select id="ne-breakdown-scope">
  <option value="chat">当前对话</option>
  <option value="month">本月</option>
  <option value="all">总计</option>
</select>
<!-- 月份下拉（仅 scope=month 时显示） -->
<select id="ne-breakdown-month" style="display:none"></select>
<!-- 饼图 canvas -->
<canvas id="ne-breakdown-pie-canvas"></canvas>
```

JS 逻辑：
- `onchange` 在 scope dropdown → 重新获取数据 → 渲染饼图
- 若 scope=`month`，显示 month dropdown（从 `getAvailableMonths()` 填充，默认选第一项 = 最新月）
- 饼图：`type: 'pie'`，labels = ['STM', 'LTM', 'SmartPush', 'Tool', 'Chat']，每扇区标注数值
- 全零时覆盖"暂无数据"

### B2. Daily Trend → 柱状图 + 月份下拉

替换 Daily Trend 区块（Section C）为：

```html
<!-- 月份下拉 -->
<select id="ne-daily-month"></select>
<!-- 柱状图 canvas -->
<canvas id="ne-daily-bar-canvas"></canvas>
```

- month dropdown 从 `getAvailableMonths()` 填充，默认选最新月
- `onchange` → 调用 `getMonthlyStats(month)` → 渲染柱状图
- 柱状图：`type: 'bar'`，X轴=日期（`MM-DD`），Y轴=token，分 5 组（STM/LTM/SP/Tool/Chat），`indexAxis: 'x'`（竖直柱）
- 数据为空时覆盖"暂无数据"

### B3. `getMonthlyStats` 函数（替代现有 `getDailyStats`）

现有 `getDailyStats(days)` 取最近 N 天。新增：

```js
export function getMonthlyStats(month) {
    var data = loadDaily();
    var keys = Object.keys(data).sort();
    var result = [];
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].substring(0, 7) === month) {
            var d = data[keys[i]];
            result.push({
                date: keys[i],
                stm: d.tok_stm || 0,
                ltm: d.tok_ltm || 0,
                sp: d.tok_sp || 0,
                tool: d.tok_tool || 0,
                chat: d.tok_chat || 0
            });
        }
    }
    return result;
}
```

Bridge 注册 + panel 中使用替代原来 `getDailyStats(30)` 的折线图调用。

---

## 改动汇总

### Step A（排 Bug）

| 文件 | 改动 | 关键行 |
|------|------|--------|
| `events.js` | L6 导入增加 `getChatTurnNumber` | L6 |
| `events.js` | `onMessageReceived` 开头声明 `var chatId = ...` | ~L258 |
| `events.js` | `onBeforeGenerate` 中调用 `incrementChatTurn(chatId)` | ~L789 |
| `events.js` | `flushPendingMessages` 删 `incrementChatTurn`，改 fallback | L419 |
| `token-stats.js` | `getUsageOverview` 返回值加 `sessionTurns/monthDays/totalDays` | L75-94 |
| `panel.js` | 三张卡模板重写：补值 + 去冗余 + 粒度信息 | L2260-L2262 |
| `panel.js` | 图表空态处理（全零/无数据时显示"暂无数据"） | L2295-2346 |

### Step B（图表改造）

| 文件 | 改动 |
|------|------|
| `token-stats.js` | 新增 `getMonthlyBreakdown`、`getChatBreakdown`、`getAvailableMonths`、`getMonthlyStats` |
| `index.js` | 导入 + bridge 注册 4 个新函数 |
| `panel.js` | Pipeline Breakdown：饼图 + 范围下拉 + 月份下拉 |
| `panel.js` | Daily Trend：柱状图 + 月份下拉 |

---

## 验证

1. 新对话 → 发消息 → Usage Tab → 三张卡数值正确（User Chat 有值，无冗余）
2. Per-Chat 表格当前 chat 的 Token 数不为 0
3. Pipeline Breakdown 饼图正确渲染，切换范围后数据更新
4. Daily Trend 柱状图正确渲染，切换月份后数据更新
5. 所有图表空态：无数据时显示"暂无数据"而非空白

---

## 不涉及

- 月度筛选在原始备忘录中已有提及，本次一并实现
- 饼图 vs 柱状图：按用户反馈，明确为饼图 + 柱状图
- `tok_chat` 语义拆分：不在范围
