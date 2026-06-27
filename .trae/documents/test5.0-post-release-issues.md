# test5.0 发布后遗留问题备忘录

---

## 问题一：Token 消耗统计面板完善

### 当前状况

**已有的**（正常工作的）：
- 三张统计卡片：本 Session / 本月 / 总计 —— 数据正确显示
- 数据收集层完整：`chat-telemetry.js`（per-chat 逐轮计数）、`token-stats.js`（每日分类 token）、`llm.js`（LLM 调用时记 token）、`events.js`（chat token + pipeline 耗时）
- `__ne_debug` 桥接：`getUsageOverview`、`getDailyStats`、`getAllChatUsage` 均注入
- Chart.js v4.4.0 动态加载代码已写好（[panel.js:L2227-L2241](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2227-L2241)）
- 柱状图和折线图的 `<canvas>` DOM 已写好（[panel.js:L2260-L2270](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2260-L2270)）
- 柱状图渲染代码已写好（[panel.js:L2291-L2312](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2291-L2312)）：4 类横向 bar（STM 绿/LTM 橙/SmartPush 蓝/Tool 紫）
- 折线图渲染代码已写好（[panel.js:L2315-L2340](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2315-L2340)）：5 条线（STM/LTM/SmartPush/Tool/Chat 右Y轴虚线）
- Per Chat 表格代码已写好（[panel.js:L2272-L2285](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L2272-L2285)）

**缺失/不工作的**：
1. 图表区域显示为空白——需要排查是 `renderUsageTab()` 未被调用、数据未到达、还是 Chart.js 初始化失败
2. 缺少月度选择下拉框（Daily Trend 应可按月筛选）——`getDailyStats(days)` 目前仅支持按天数查询，需要新增按月查询接口
3. 缺少饼图——Pipeline Breakdown 当前是柱状图，需改为饼图（或新增饼图）

### 改动方向

1. **Debug 图表为何空白**：检查 `renderUsageTab()` 被调用时 `__ne_debug.getUsageOverview()` 是否返回数据 → 如果数据正确但 canvas 空白 → 检查 Chart.js CDN 加载时机 → 可能 CDN 未加载完成就尝试渲染
2. **饼图**：将 `#ne-usage-bar-canvas` 从横向 bar 改为 pie chart，同时保留数值标签
3. **月度筛选**：
   - 新增 `getMonthlyStats(month)` 函数到 `token-stats.js`
   - 新增 `getAvailableMonths()` 返回有数据的月份列表
   - UI 新增 `<select>` 下拉框，切换月份时重绘折线图
4. **Verify**：打开 Usage Tab → 饼图正确渲染管线分解 → 折线图默认显示当前月 → 切换月份后图表更新

---

## 问题二：滑动窗口上下文注入实装 ✅ 已完成

- `f44d43c` — `formatContextMemory` 接入 `onBeforeGenerate`，注入为 `ne_context_memory`（depth 2）
- `ff4187f` — 范围改为 2-30、默认 10、i18n 三语标签 `context_window_rounds`
- `5896d74` — 三重压力判定：token 密度（主）+ maxContext 溢出 + **轮次窗口溢出**保底
- `computeContextPressure` 读取 `contextWindowRounds`，窗口外待处理消息占比 ≥50% 时触发 pipeline

---

## 问题三：State 系统中的 Quests 和 Factions

### 当前状况

**Characters 的完整度**（参考基线）：

| 特性 | Characters |
|---|---|
| Schema | 完整（protagonist + npc，15 字段） |
| State LLM prompt 指令 | Field Rules 明确列出所有管理字段 |
| 自动初始化模板 | `ensureCharacterTemplate` + `ensureStateStructure` |
| 自动发现 | `findNewCharacterNames`（4 字段全空→新角色）+ `resolveNpcSchemes`（LLM 从世界书发现方案） |
| mergeStateChanges 特殊处理 | `ensureCharacterTemplate` + `_scheme`/`_role` 保护 + affection `__inc` 增量 |
| 自动衰减 | `autoDecayStaleCharacters`（两轮缓冲） |
| Main LLM 交互 | present 块 → 自动创建 + 设活跃 |
| 世界书驱动发现 | `_fetchWorldBookText` + newCharHint 指令 |
| UI | 完整可编辑卡片 + 分组 + progress bar |

**Quests/Factions 的缺失项**：

| 缺失 | 影响 |
|---|---|
| **State LLM prompt 无 quest/faction 指令** | `buildStatePrompt_Preset` 的 Field Rules 仅列出 characters 字段。LLM 不知道它可以修改 quests/factions |
| **无自动初始化模板** | LLM 输出 `factions.xxx.name=xxx` 时无代码层辅助创建默认结构 |
| **无世界书驱动发现** | 无法像角色那样从世界书自动提取势力/任务信息 |
| **mergeStateChanges 无 faction 处理** | factions 路径没有 `ensureXxxTemplate` 等价物 |
| **Factions 无 auto-decay** | 势力不会自动标记为非活跃 |

**不需要改的部分**：
- Schema 定义完整（factions 6 字段，quests 3 子类 15+ 字段）
- UI 渲染完整（可展开卡片，态度/状态着色，3 子类型区分）
- `buildStateInjectionTable` 已注入 factions/quests 当前状态到 prompt（作为只读上下文）
- `mergeStateChanges` 直接写入 factions/quests 路径（通过通用 dot-path 合并），数据写入通道可用
- `handleQuestCompletion` 已完成状态自动记录 deadline
- factions 的 `attitude_toward_player` 有枚举约束（友好/中立/冷淡/敌对）
- quests 的 status 有枚举约束（正在进行/已完成/已失败/已过期）

### 改动方向

按优先级排列：

1. **State LLM prompt 添加 factions/quests 管理指令**（最低成本、最大收益）：
   - `rulesZh/En` 的"你管理"列表中加入 `factions、quests`
   - 添加一行：`factions/quests 当前为空时，若对话中出现了势力或任务信息，可以创建。`
   - 添加一行：`quests.tasks.<Name>.status: 正在进行/已完成/已失败/已过期。`
   - 这样 LLM 就能输出 `state_changes.factions.xxx` 或 `state_changes.quests.tasks.xxx`，而 mergeStateChanges 已经能处理这些路径

2. **mergeStateChanges 添加 faction 路径自动初始化**（中成本）：
   - 当路径为 `factions.<name>` 且目标不存在时，自动创建默认模板（类似 `ensureCharacterTemplate` 对 characters 的处理）
   - 对 `quests.tasks.<name>` / `quests.goals.<name>` / `quests.events.<name>` 同理

3. **世界书驱动发现**（高成本、长期）：
   - 在 `buildStatePrompt_Preset` 中为 factions/quests 添加类似 `newCharHint` 的指令块
   - 在 `_fetchWorldBookText` 或新增函数中提取世界书中的势力/任务信息
   - 首次对话提供势力/任务初始化提示

4. **Factions auto-decay**（低优先级）：
   - 类似 `autoDecayStaleCharacters`：若某势力在连续 N 轮对话中未被提及，在注入表中标注但不自动删除

### 建议执行顺序

**先做 1**（只需改 `buildStatePrompt_Preset` 中两行），验证 LLM 是否能正确创建 factions/quests。如果可以，再做 2 增强鲁棒性。3 和 4 按需推进。