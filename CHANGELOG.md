# NE-Memory v6.6 更新日志

## Bug 修复

- **面板 overlay 彻底分层**：从 CSS 时序补丁改为架构修复——overlay 挂载到 `<body>` + `position: fixed` + 动态对齐 `#sheld` 尺寸和 `resize` 同步。面板和聊天窗口不再是同一画布，双滚轮从根本上不存在。
- **设置面板副 API 保存崩溃**：`saveSettingsTab` 中 `secApi` 对象构建无空值保护，`panelById` 返回 null 时 `value.trim()` 抛 TypeError，整函数静默崩溃导致所有设置修改均不保存。
- **Embedding 输入框修改不保存**：non-channels 模式下 `nes_embedding_url/key/model` ID 在两处同时出现（channels 隐藏区 + Vector Search 可见区），`panelById` 始终命中隐藏副本 → `onchange` 绑定在不可见元素上，save 读取 stale 值。修复：Embedding channel-group 改为条件渲染，两种模式各只有一份。

## 参数调整

- **`stmChunkMaxChars` 默认值**：4000 → 500，与新的对数滑块设计对齐。

---

# NE-Memory v6.5 更新日志

## 新功能

- **STM 时间/场景自动推断**：未安装 NE-BANNER 时，STM 提取不再留空时间和场景字段。LLM 自动从上文对话和近期记忆条目中推断当前时间（如"深夜""清晨"）和场景（如"客厅""森林"）。Banner 用户无影响。

---

# NE-Memory v6.4 更新日志

## Bug 修复

- **面板 CSS 三重坑**：双滚轮 + 下滑翻开无响应面板 + 面板占满全屏。overlay 初始 `display: flex` + `position: absolute` 占据 #sheld 布局空间导致额外滚动条；修复为关态 `display: none`，开态 `display: flex`。
- **设置面板全部控件不持久化**：`saveSettingsTab` 引用了渲染 HTML 中不存在的 DOM 元素，第一行 `.checked` 即抛 TypeError 导致整函数静默崩溃。所有滑块、复选框、文本域的修改均未保存。修复：所有 `panelById` 访问改为空值安全 + 合理默认值。
- **记忆编辑/删除不持久化**：双重根因——(1) IndexedDB 写入 fire-and-forget，失败静默丢弃；(2) `loadVault` 版本平局时用聊天文件旧数据覆盖 IndexedDB。修复：`async/await write` + toast 错误提示；`loadVault` 改严格大于比较。
- **处理历史按钮静默失败**：`collectAllMsgIds` import 缺失 + 主逻辑无 try/catch + `onProgress` 从未被调用。三者全部补齐。
- **手机端滑动关闭卡死**：手势关闭后 inline `transform` 残留未清，压住 CSS transition 导致面板钉死。
- **上下文窗口轮数控制死代码**：`computeWindowStartMsgId` 字段名错误导致 Dialog Rounds 设置从未生效。

## 新功能

- **多通道 API 路由**：记忆提取和 Embedding 可分别配置独立 API 端点，不同操作使用不同 API。
- **STM 对数滑块**：100–10000 范围非线性刻度，带每轮提示；数字输入框双向同步。
- **动态摘要比例**：STM 摘要长度按段落比例自适应，不再硬编码 10–160 字符上下限。
- **Extension 模式**：浏览器扩展形态入口、manifest、构建脚本。

## 行为变更

- State Schema 始终开启（移除 `enableStateSchema` 开关），Schema 字段级约束默认生效。
- NPC 好感度变化/关系字段从 NE-CHAR 和 State LLM 输出中移除。

### 从 v6.3 出发的外部变更统计

共 13 个用户可见变更：6 项 Bug 修复（面板 CSS ×3 / 设置面板 / 记忆编辑 / 处理历史 / 滑动关闭 / 上下文窗口）+ 4 项新功能 + 2 项行为变更 + 1 项 i18n 补充。

---

# NE-Memory v6.3 更新日志

## Bug 修复

- **设置面板全部控件不持久化** — `saveSettingsTab` 引用了渲染 HTML 中不存在的 DOM 元素（`nes_enable_state_schema` / `nes_enable_retrieval`），第一行 `.checked` 即抛 TypeError 导致整函数静默崩溃，`localStorage.setItem` 永远走不到。所有滑块、复选框、文本域的修改均未保存。修复：所有 `panelById` 访问改为空值安全 + 合理默认值。
- **记忆编辑/删除不持久化** — `saveSingleEntry` / `deleteSingleEntry` 的 `write()` 是 fire-and-forget，写失败静默丢弃；`loadVault` 版本平局（IndexedDB 与 chat_metadata 同版本）时错误地用聊天文件旧数据覆盖 IndexedDB。修复：改为 `async/await write` + toast 错误提示；`loadVault` 版本比较改为严格大于（`>`），平局时 IndexedDB 为真源。
- **处理历史按钮静默失败** — 三连坑：(1) `collectAllMsgIds` import 缺失导致 `ReferenceError`；(2) 确认弹窗 resolve 后到 `try` 块间无错误捕获，`read`/`waitForPipelineTrackIdle` 抛异常直接作为未捕获 rejection 消失；(3) `onProgress` 回调在 `executeIncrementalUpdate` 中从未被调用。修复：补齐 import、try/catch 扩展至全链路、`stm-pipeline.js` 开始/结束时调用 onProgress。
- **手机端滑动关闭卡死** — 下拉 >60px 关闭面板后，inline `transform: translateY(movedY)` 未被清除，压住 CSS transition 导致面板钉在滑动位置、页面完全卡死。修复：`touchend` 中无条件先清除 `transform`。

---

# NE-Memory v6.2 更新日志

## Bug 修复

- **聊天切换面板同步** — 修复先开面板再切换聊天时数据不更新的问题。`chat_id_changed` 事件现在正确触发面板刷新，STM/LTM 表格、角色卡、State Board 实时跟随当前聊天。
- **历史快照表格修复** — 修复先展开历史再切换聊天后表格锁定为空的问题。History accordion 不再受一次性 lazy-render 限制，聊天切换和管线完成时自动刷新。

## UI 改进

- **Shadow DOM 图标适配** — 全部 Font Awesome 图标替换为 Unicode 字符，彻底解决 Shadow DOM 隔离下外部字体不可见的问题。删除 (🗑) / 取消 (←) / 编辑 (✎) / 保存 (✓) 等按钮视觉可区分。
- **menu_button 样式修复** — 补齐 Shadow DOM 内 `menu_button` 的完整样式（padding / border / cursor / hover），工具 Tab 按钮恢复正常外观和点击反馈。
- **副 API 状态提示增强** — 绿点 tooltip 现在同时显示副 API 和向量 API 的连接状态（分行）。
- **i18n 补齐** — 14 处硬编码文本（Auto / Chat / (empty) / N/A / Msg 等）补充中英繁三语翻译。
- **面板简化** — 移除面板锁定图标。
- **历史表格对齐统一** — 表头与内容统一左对齐。

### 从 v6.1 出发的外部变更统计

共 8 个用户可见变更：聊天同步修复 / 历史快照修复 / Unicode 图标 / menu_button 样式 / 副 API tooltip / i18n 补齐 / 锁定图标移除 / 表格对齐修复。

---

# NE-Memory v6.1 更新日志

## 架构升级

- **Shadow DOM 全面适配** — CSS 变量重注入机制、:host 选择器覆盖层、panelById/panelQS 全量替换 byId/qs，面板在 iframe 隔离环境中样式完整可用
- **4 面板统一滚动架构** — 发现并修复了 settings/usage 面板被多余的 `.ne-settings-scroll` 包装层和多出的一个 `</div>` 提前关闭滚动容器的布局 bug，所有面板共享同一滚动逻辑，内容对齐正确

## Bug 修复

- **管线守卫死锁导致 STM 永不整合** — 移除 STM pipeline 中的 transitionTo，整合按钮/processHistory 正确 acquire/release guard
- **整合循环被空 STM 堵死** — createMinimalLtm 不再卡空事件，始终返回有效决策
- **编辑/删除记忆报错** — 补回 panel-drawer.js 遗漏的 write import
- **LTM force-close prompt 注入修复** + placeholder 文本区分

## UI 改进

- **管线状态去重** — 副 API 和向量搜索标题栏显示绿色小圆点，移除引擎区和检索区的重复文本
- **统计面板重设计** — 弃用总计统计，改为对话-今日-本月三栏卡片布局
- **每日趋势图** — 全月 x 轴堆叠柱状图，支持 tooltip
- **面板视觉润色** — 标题重命名、版本号下沉、设置 accordion 默认闭合、ToS 确认存档
- **滑块原生样式** — Shadow DOM 内定制 -webkit-slider-thumb/-moz-range-track，匹配 ST 原生外观
- **综合无障碍适配** — aria-label 覆盖、键盘导航、PC/NPC 标签、搜索过滤、触控反馈

## 文档与项目卫生

### README.md 全面重写

参照 Baibai（柏宝书）的 Readme 最佳实践，将 README 从"开发者笔记"改写为"用户产品页"：

- **开场共鸣**：新增痛点描述 + 价值主张，让路过的用户第一段就知道"这个工具能解决我的什么问题"
- **功能分组**：原来的 12 个扁平技术列表 → 6 组场景化分组，去掉内部参数噪音（k1=1.5、b=0.75、α=0.20 等）
- **安装指引内嵌化**：安装 JSON 折叠到 `<details>` 标签；首次配置简化为单步配副 API 即用（SmartPush 始终在线）
- **配置指南重写**：替换为实际 UI 中的 9 个真实设置项，移除已删除的开关（Smart Context Injection、State Extraction、Contradiction Detection、Retrieval API 等），补充 Dialog Window Rounds、Memory Budget、Schema Editors 等
- **FAQ 章节**：5 个常见问题（副 API 连不上 / Token 消耗大 / 面板打不开 / 数据存储位置），内嵌化存储位置表格
- **更新说明内嵌**：版本兼容表、CDN 更新方式、数据迁移说明均在 Readme 内自足
- **删除 Tool-calling 章节**（v6.0 中已停用）
- **删除内建测试框架章节**（用户不需要）
- **删除「与 SP 记忆库的关系」章节及 FAQ 条目**

### CODE_WIKI.md 清理

- 删除 §3.4.23 worldbook-sync.js 整个小节 + 架构图中对应条目
- 后续小节编号前移

### AGENTS.md 清理

- 中风险模块列表中删除 worldbook-sync

### .gitignore 扩充

新增 7 组忽略规则：
- `.trae/` — AI 助手工作文件
- `*.bak` / `_old_*.js` — 重构备份
- test artifacts（report / trace / postmortem / generated data）
- `dist/test-harness.js` / `dist/th-test.js` — 测试用 dist 文件
- `scripts/extract-precise.cjs` — 一次性脚本
- `testv4.*.json` / `test5.*.json` — 旧版测试配置
