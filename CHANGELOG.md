# NE-Memory v7.0.0 更新日志

## 架构升级

- **增量版本链引擎**：取代旧快照系统（30 次上限），改为无限增量 delta 记录。每次管线运行自动产生 State 和 Memory 版本，支持任意深度回滚。Pipeline Log 追踪每条版本的来源
- **精确回滚机制**：消息删除/重掷/滑动/编辑时，基于版本链自动回滚相关 State 和 Memory，不再依赖脆弱的消息 ID 快照匹配
- **存储分离**：IndexedDB 拆分为 `state_vaults` + `memory_vaults` 两个独立 Object Store，消除并行写入竞争导致的数据丢失。DB 自动检测损坏并从 `chat_metadata` 恢复

## 新功能

### 开放角色 Schema & 模板系统
- **自定义角色 Schema**：放弃硬编码字段列表，改为开放的字段库 + Schema 编辑器。支持动态字段定义、嵌套子字段
- **模板库**：预设 PC/NPC/Faction/Task/Goal 五类模板。双区卡片布局（全局库 / 对话配置），一键添加到对话，支持编辑、复制、版本管理
- **模板版本系统**：不可变版本历史，支持导航、回退到任意历史版本。卡片级编辑入口
- **方案发现**：新角色自动检测已安装的角色卡 Schema，推断默认字段方案
- **模板 LLM 子代理**：Native Function Calling 驱动的模板操作（方案发现、字段建议），独立于主记忆管线运行
- **三层锁架构**：系统锁（预设模板编辑自动复制）+ 卡片锁 + 字段锁

### 注入增强
- **相对时间前缀**：SmartPush 注入内容包含相对于当前时间的描述（如"约 2 小时前"），替代裸时间戳
- **HTML 格式化**：注入内容改为 HTML 格式，支持粗体/斜体/着色

### 配置与同步
- **跨设备配置同步**：所有设置持久化到 `extension_settings.ne_memory`，随 SillyTavern 聊天同步跨设备传输
- **诊断导出按钮**：Settings → Data 新增一键导出全部存储数据
- **聊天删除清理**：删除聊天时自动清理全关联 IndexedDB + localStorage

### UI 改进
- **面板重构**：State / Memory 双主 Tab + Settings / Usage 侧滑面板
- **滚动条美化**：细窄半透明风格（8px），匹配毛玻璃视觉
- **角色名称编辑**：编辑模式下可修改显示名称

## 性能优化

- **并行写入队列**：各管线独立写入队列，STM/LTM/State 写入不再互相阻塞
- **检索缓存**：BM25 分词+索引按 chatId 缓存，增量更新；检索结果浅拷贝替代 JSON 序列化
- **LTM 子表懒渲染**：首次展开填充，减少初始 DOM 节点
- **topK 收紧**：15–80 → 10–50，基于 token 效率基准

## Bug 修复

### 严重修复
- **Firefox 面板不可见**：Firefox Shadow DOM 不应用 `:host(.open)` CSS，改用 inline style 绕过
- **DB 迁移数据丢失**：连续升级路径中重复迁移 + 异步属性未解包导致 Vault 数据清零
- **消息接收崩溃**：`computeWindowStartMsgId` import 缺失（v6.7 遗留）

### 管线修复
- **State LLM 漏轮**：阈值修正（`>2` → `>=2`），管线排空后正确触发
- **NE-CHAR 合并方向**：State LLM 的新状态不再被 NE-CHAR 过时默认值覆盖，角色不再全部显示"非活跃"
- **活跃角色默认状态**：首次使用自动初始化 `status='活跃'`
- **跨类型字段泄漏**：State LLM 不再向角色卡写入势力/任务/目标专属字段
- **重掷状态丢失**：重掷后 State LLM 正确重新运行
- **Token 统计**：7 个管线操作不再落入不可见 "tok" 分类

### 面板修复
- **首次打开不渲染**：`open` class 与 `busEmit` 时序冲突
- **CORS 代理 URL**：`127.0.0.1:8000` 硬编码 → `window.location.origin`
- **Embedding API 验证**：发送前校验模型名非空
- **滚动位置保存**：innerHTML 重建后恢复 scrollTop
- **版本导航按钮**：Shadow DOM 内查询改用 container.querySelector
- **事件总线竞态**：侦听器注册移至 await 之前

---

# NE-Memory v6.8.0 更新日志

## 新功能

- **角色卡删除**：编辑模式下角色卡片新增删除按钮，可一键移除角色及其全部 State 数据，操作前弹出确认对话框

## Bug 修复

- **消息接收崩溃（严重）**：v6.7 上下文窗口重构时误删 `computeWindowStartMsgId` 的 import，导致每条消息触发 `onMessageReceived` 时抛出 `ReferenceError`，引擎完全不可用
- **快照恢复被覆盖**：`restoreSnapshot` 恢复 IndexedDB 后未同步 `chat_metadata`，导致 `loadVault` 在版本平局时用聊天文件中的旧缓存覆盖刚恢复的数据
- **State LLM max_tokens 触顶**：`max_tokens` 硬上限 2048 对 `state_extract` 过紧（该操作频繁接近上限），提升至 4096

---

# NE-Memory v6.7 更新日志

## 新功能

- **API 连接增强**：`GET /v1/models` 快速连通性检测（~3s），失败回退到 chat ping；5 个手动模型名输入框替换为可拉取下拉菜单（select + text + fetch 按钮）；三色连接状态指示（绿/黄/红，含错误类型详情）
- **API 韧性机制**：指数退避自动重试（最多 2 次，1s→2s→4s），仅对超时/网络/5xx 重试；客户端 API Key 格式校验（非ASCII、sk- 前缀、空格），实时黄色警告
- **Test Message 延迟显示**：连接测试成功 toast 中显示端到端耗时
- **Embedding API 超时保护**：AbortController 超时保护，防止卡死

## 性能优化

- **STM 合并 LLM 调用**：`executeIncrementalUpdate` 中所有子段打包到单次 LLM 调用，API 调用量减少约 **5 倍**
- **PH 字符级批处理**：Process History 中消息数批处理改为基于字符累积拆分；新增 `phBatchChars` 设置（1000–8000，步长 500，默认 4000），设置面板提供对数滑块
- 批处理失败时 toast 警告；LLM 失败时自动重试一次

## Bug 修复

- **快照恢复错误吞噬**：`restoreSnapshot` 异步回调中的错误不再被静默吞掉
- **STM 编辑按钮缺失**：孤儿/LTM 子 STM 行现在显示编辑按钮
- **对话轮次剪裁修复**：对话框轮次剪裁从 `chat.splice()` 移至 `generate_interceptor`，在 `coreChat` 副本上安全操作

---

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

---

# NE-Memory v6.0.0 更新日志

> 2026-07-03 · 架构清理 + 管线重构合并 · 从 v5.6 到 v6.0 跨版本整合

## 架构重构

- **Pipeline 拆分**：原单体管线拆分为 STM / LTM / State / InnerThoughts 四大独立子管线，互不阻塞
- **SmartPush 重构**：记忆检索从 onBeforeGenerate 中移出，仅在 recall_memory 工具中触发次级 LLM；Smart Context 仅做廉价 vault 格式化注入
- **实体系统简化**：移除递归 gapfill 和检索 LLM 合成，减少 pipeline 复杂度
- **API 设置精简**：移除 API split 设置项，统一为副 API 单一路径

## 新功能

- **Inner Thoughts 管线**：缓存积累 → STM prompt 注入 → entities+thoughts UI 渲染，系统级别的内心独白记忆链
- **Embedding 一键预设**：SiliconFlow bge-m3 免费嵌入模型一键配置（预填 URL + model，零配置门槛）
- **向量质量测试**：端到端语义检索验证取代基本的连通性 ping
- **反回声查询策略**：多样化检索查询生成，带注入去重追踪
- **faction 势力提取**：一次性势力信息提取 + 关键词激活机制

## 性能优化

- **KV-Cache 复用**：State LLM prompt 拆分为两条 system message，利用 KV-Cache 减少重复计算
- **实体链预取移除**：从检索管线中移除 entity chain pre-fetch，减少不必要开销
- **STM prompt 精简**：移除角色 inner_thoughts 字段，缩小 prompt 体积
- **词阈触发器删除**：移除 words-threshold 触发条件（曾绕过 batchSize 导致每轮 STM 提取）

## Bug 修复

- **Pipeline Guard 锁泄漏**：移除 `isIdle()` 门控，修复并发管线死锁
- **computeContextPressure 崩溃**：`neSettings` 在模块作用域中 undefined，导致 ReferenceError
- **LTM 验证替换**：`validateLTMOutput` 替换为 `validateLtmDecision`，带 action 验证 + 重试 + 标题截断
- **panel 拆分后 import 缺失三联**：6 个模块 11 处跨文件引用修复
- **LTM force-close prompt 注入修复** + placeholder 文本区分
- **token stats 图表 overhaul**：面板统计修复 + 图表完全重绘
- **测试评估器卡死**：evaluator 从 ST 主 API 切换到副 API，避开 `isGenerating` 锁

## UI/UX 改进

- **管线状态去重**：副 API 和向量搜索标题栏显示绿色小圆点，移除引擎区和检索区的重复文本
- **统计面板重设计**：弃用总计统计，改为对话-今日-本月三栏卡片布局
- **每日趋势图**：全月 x 轴堆叠柱状图，支持 tooltip
- **面板视觉润色**：标题重命名为 NE-叙事引擎、版本号下沉到 Memory Tab、设置 accordion 默认闭合、ToS 确认存档
- **L1/L2/L3 三级 UI 负债清理**：emoji → Font Awesome 图标、语义色 token、斑马表格、无障碍覆盖、搜索过滤、键盘导航、Touch 反馈、i18n 补全

---

# NE-Memory v5.6 更新日志

> 2026-06-30 · Pipeline 拆分 + 实体简化 + SmartPush 重构

## 架构重构

- **Pipeline 拆分 + 智能分块**：多管线并行、batch LTM、自适应分段
- **检索与合成分离**：Memory LLM 合成仅在 recall_memory 工具触发，SmartPush 纯本地 BM25/向量 → 格式化注入
- **语义化测试断言**：从 6 个语义断言重构为结构化断言，新增截断/回退监控，简化评估器
- **死代码清理**：移除递归 gapfill、检索 LLM 合成、分类器死代码、API 拆分设置

## 新功能

- **Embedding 质量端到端测试**：语义检索正确率验证取代基础连通性 ping，`_vectorUsed` 标记暴露给调试全局变量
- **测试管线 token 统计**：每次测试运行追踪每次操作的 token 消耗
- **反回声查询策略**：标记并追踪查询多样性，防止重复检索噪声
- **Vector-RRF 管线监控**：candidate count 暴露给自动化断言

## Bug 修复

- **Pipeline guard 锁泄漏修复**：transitionTo 在 STM pipeline 中被移除
- **panel 拆分跨模块 import 缺失**：`loadVault`、`isAuto`、`createVaultPopout` 等 11 处修复
- **LTM 输出验证重写**：`validateLTMOutput` → `validateLtmDecision`，包含 action 验证 + 重试 + 标题截断
- **测试滑块默认值被覆盖**：`updateSmokeSliderDefault` 不再在测试完成后覆盖用户设置
- **周期/场景信号冲突**：分类器死代码移除 + 双信号冲突修复

---

# NE-Memory v5.0 更新日志

> 2026-06-26~27 · 上下文窗口注入 + 管道压力 + 交互式 NE-CHAR

## 新功能

- **上下文窗口记忆注入**：`formatContextMemory` 在 `onBeforeGenerate` 中工作，注入会话窗口之前的 LTM+STM 摘要，对话轮数范围 2-30（默认 10）
- **三重管线压力系统**：token 密度（主指标）+ maxContext 溢出 + 窗口轮数溢出，自动调参
- **physique（体格）字段**：从 `gender_age` 中拆分出独立体格描述字段，PC+NPC 必需，Schema + i18n + 注入 + prompt 全覆盖
- **NE-CHAR 回退系统**：主 LLM 跳过情感块时发出警告，State LLM 从对话上下文推断 affection/mood/thoughts
- **势力一次性提取**：`faction` 字段通过独立 LLM 调用提取，关键词激活，合并进 `resolveNpcSchemes`
- **World Book 记忆整合**：`getWorldInfoPrompt` 按角色名作为 key 定向激活世界书条目，移除角色 lore 特殊大小写

## 架构改进

- **State 字段三级分类**：字段分为 static/snapshot/hybrid，每种带边界定义；衣着字段支持场景感知推断
- **State LLM prompt 全面重构**：i18n 标签以表格呈现、newCharHint 移至末尾带完整示例、World Book 提取指导、条件性零变更示例
- **BANNER 集成**：`story_date` 从 `story_day` 中独立，代码合并进 STM/LTM period；`resolveSchemaPath` 修复纯字段容器通配符解析
- **faction 提取独立 LLM 调用**：从 State LLM 中拆分，通过 `Promise.all` 并行执行
- **管道守卫锁泄漏修复**：移除 `isIdle()` 门控

## Bug 修复

- `computeContextPressure` 中 `neSettings` undefined 导致 ReferenceError
- `resolveSchemaPath` 通配符后裸字段容器处理失败
- World Book 非恒定 key 条目激活：`{{user}}` 宏 → 直接角色名 → ST 原生 `substituteParams`
- State LLM 新角色强制要求 state_changes 输出（此前允许空 `{}`）
- `status` 字段去冗余：卡片标题和正文中移除重复状态显示
- UI 中角色卡片字段标签改为 `t_field()` i18n 显示

---

# NE-Memory v4.0 更新日志

> 2026-06-15~25 · 逐轮 State 管线 + 字段分类 + 副 LLM 增强

## 新功能

- **逐轮 State 管线**：消息发出后自动触发管线（`onMessageSent` → `onMessageReceived`），游标单次调用整合
- **动态字段发现**：从角色卡描述/first_mes/世界书中自动提取 `key:value` 字段 → 双模式自动切换 → `dynamic.*` 路径路由
- **State Schema 全面翻新**：Core 层字段约束 + 三种独立 prompt 模式（full/extract/update）+ 动态角色面板
- **Cursor/State 双管线拆分**：游标追踪和状态提取独立为两个管线，游标在所有 STM 写入后先更新再驱动 State
- **World Book 字段泄漏防护**：`isDynamicStateMode()` 守卫防止世界书字段污染非动态模式
- **回退捕获**：首次打开聊天时自动回退处理开场消息

## 架构改进

- **副 API 用户体验增强**：本地代理默认 + 模型覆盖支持 + OpenAI 格式 + 本地代理 `{content}` 格式
- **LLM 输出验证**：提取结果缺失 time/scene/event 时拒绝 + 重试一次 + 后填充回退
- **chat_metadata 嵌套 Vault**：每次保存自动嵌入 + 加载时恢复（跨设备数据持久化）
- **CDN 分发修复**：从 `raw.githubusercontent.com` → `jsDelivr` → `gcore` 多轮迭代解决 CDN 缓存滞后

## Bug 修复

- State 阶段 1 状态丢失：游标阶段失败时立即持久化状态
- Cursor 过期位置修复：游标 >= batch 长度时重置（因上一轮不完整运行遗留的过期值）
- `generateRaw` / `generateQuietPrompt` 无限递归：`onBeforeGenerateRunning` 重入守卫
- 非用户触发的 Generate() 不触发 SmartPush
- MESSAGE_SENT/MESSAGE_RECEIVED 使用小写事件名（此前永不被触发）
- eventSource 事件注册健壮性：并发守卫、崩溃恢复、异步管线、阈值修复

---

# NE-Memory v3.0 更新日志

> 2026-06-10~14 · 动态 State Schema + World Book 整合

## 架构升级

- **动态 State 字段系统**：从角色卡自动发现并注册 `key:value` 字段，双模式（静态/动态）自动切换，支持世界书字段作为动态扩展
- **State Pipeline 逐轮执行**：`onMessageSent` + `onMessageReceived` 双触发器，游标增量追踪
- **CDN 分发链路稳定化**：jsDelivr (gcore) 主 CDN + GitHub raw 回退，解决 Tampermonkey 脚本加载器在 TH 环境下的兼容性问题

## 新功能

- **World Book 记忆整合**：世界书条目作为动态字段源，`globalSelect` 过滤启用条目，多回退策略保证字段解析
- **副 API 本地代理**：LLM 调用支持两种格式 — 标准 OpenAI chat/completions + 本地代理 `{content}` 模板格式
- **导出/导入 Vault**：面板 JSON 格式导出/导入按钮
- **Process History**：一键处理全历史消息为记忆
- **LLM 日志面板**：完整记录 prompt + response
- **角色自动衰减**：非活跃角色 prompt + 代码双重回退

## Bug 修复

- Cursor 过期位置重置：batch 完成状态检测
- parseSTMResponse 数组优先解析 + null checkpoint 校验
- State 字段缺失时显式 fallback：`story_time=Day 1`、`story_scene=未知`
- 适配层健壮性 6 连修：await、死代码清理、null 检查、并发守卫、空 catch 块
- 世界书字段泄漏：动态模式守卫 + 未知字段拒绝

---

# NE-Memory v2.0 更新日志

> 2026-06-06~09 · Per-Round State Pipeline + 动态字段发现

## 架构升级

- **逐轮 State 管线**：从批量处理改为每轮消息自动触发，游标模式增量更新
- **动态 State 字段发现**：自动从角色卡描述/first_mes/世界书扫描 `key:value` 模式，`dynamic.*` 路径路由
- **Cursor/State 双管线**：游标追踪和状态提取独立为两条管线，游标先更新 → 驱动 State

## 新功能

- **回退捕获（Retroactive Capture）**：`retroCapturedChatId` 守卫防止重复运行，首次打开聊天自动回退处理开场消息
- **World Book 字段泄漏防护**：`isDynamicStateMode()` 守卫 + `dynamic.*` 路径隔离
- **副 API 本地代理**：LLM 调用双格式路由（OpenAI + 本地代理 `{content}`）
- **Token 统计分类**：按管线操作类型细分统计
- **快照限制**：每聊天最多 30 个历史快照

## Bug 修复

- State 阶段 1 数据丢失：游标失败时立即持久化
- `MESSAGE_SENT` / `MESSAGE_RECEIVED` 使用小写事件名（此前永不被触发）
- Tampermonkey 环境 `window.parent.document` 不可用时的多重回退
- `generateRaw`/`generateQuietPrompt` 递归级联守卫
- SmartPush 干跑防涌：`_smartPushDone` 标志 + 新消息/聊天切换时重置

---

# NE-Memory v1.0.0 更新日志

> 2026-06-09 · 生产级发布 · 从 0→1 完成的里程碑

## 新功能

- **Vault 面板全面翻新**：Tabs 分页（State / Memory / Settings / Usage）、手风琴展开、快速索引跳转、行内编辑、设置迁移至面板内集成
- **Tool-calling 正式上线**：`access`（统一引用查询，穿透 LTM 摘要 → STM 详情 → 原始对话）和 `recall_memory`（开放语义检索）两个注册工具，带独立遥测统计
- **SmartPush 注入日志**：每次 LLM 生成前注入的记忆内容写入 LLM 日志面板，含语义对齐标识
- **角色自动衰减**：长时间未活跃的角色自动进入衰减状态，prompt + 代码双重回退保底
- **快照限制**：每聊天最多 30 个历史快照，`pruneSnapshotsForChat` 自动清理超量

## Bug 修复

- **11 项生产级润色修复**：覆盖数据流断点、重试队列、空响应处理、合并 STM 过滤、统一 openDB 等
- **State 字段翻译缺失**：`main_event`、`present_characters` 等关键字段补充中英繁三语翻译
- **角色 Current State 文本区字段名翻译**：面板中的字段显示名现在跟随语言
- **审计发现 9 个 Bug 全部修复**：（#90–#98）涵盖 UI 渲染、数据处理、事件绑定等多模块
- **dryRun 触发误判**：`onBeforeGenerate` 检测 `dryRun` 参数后直接跳过，不再误触发生成管线
- **非用户触发的 Generate() 跳过 SmartPush**：按钮状态不再被面板操作异常切换
- **Cascade Loop 无限递归**：`generateRaw` / `generateQuietPrompt` 内部调用 ST 的 `Generate()` 触发 `GENERATION_AFTER_COMMANDS` 形成递归级联，新增 `onBeforeGenerateRunning` 重入守卫彻底阻断
- **5s 硬超时保护**：`formatSmartContext` 挂载超时兜底，`callTavernHelper` 的 `generateRaw` / `generateQuietPrompt` 可超时退出，防止阻塞 ST 主生成管线
- **LLM 提供的 stm_refs 校验**：`postFillLTM` 验证 LLM 返回的引用 ID 有效性，无效引用（如数组下标）替换为实际 STM ID
- **已合并 STM 条目自愈**：面板渲染时检测 stuck 在 `unconsolidated_stm` 中的已合并条目，自动移入 `stm_entries`
- **AI帮答/impersonate 跳过管线**：非用户主动发送的消息不触发记忆提取
- **parent_ltm 双重过滤**：显示侧和 `allSTM` 池侧同时过滤，防止已合并 LTM 条目出现在 STM 表格中

## UI/UX 改进

- 滑块标签重命名：`stmBatch` / `stmMaxUnconsolidated` 改为用户可理解的名称
- 移除死代码工具：`update_state`、`rollback_memory`
- Time Range 派生逻辑改进：全量空 `time_label` 时不再显示 `??`

---

# NE-Memory v0.4 更新日志

> 2026-06-01 · Smart Push + 记忆检索服务上线

## 新功能

- **Smart Push 记忆检索**：每次 LLM 生成前自动检索并注入相关记忆，懒激活（STM < 20 条时跳过 LLM，直接注入全量摘要），分层上下文排序
- **Smart Context 注入**：`formatVaultForPrompt` 仅做廉价的 vault 格式化注入（无二次 LLM），记忆检索 LLM 专属于 `recall_memory` 工具
- **Process History 按钮**：一键处理全部历史对话消息为记忆条目
- **可配置 STM 批次大小**：Settings 面板增加 `stmBatch` 滑块
- **LTM 整合阈值滑块**：整合从固定阈值改为可配置最大未整合 STM 数
- **LLM 日志面板**：完整记录每次 LLM 调用的 prompt + response
- **Vault 导出/导入**：面板增加 JSON 格式导出/导入按钮
- **chat_metadata 自动嵌套**：每次管线保存时自动将 vault 嵌入 chat_metadata，聊天加载时自动恢复

## 性能优化

- **500 轮 BM25 池排除**：LTM 条目在 500 条 STM 之前不纳入 BM25 检索池
- **整合逻辑重排**：Consolidation 移入管线最前（在新一轮提取之前运行）
- **阈值一致性**：所有调用方统一 LTM/STM 选择逻辑，排除已含 `parent_ltm` 的 STM

## Bug 修复

- **IndexedDB 升级**：版本升至 2，新增 snapshots 存储区
- **待处理消息冲刷**：`flushPendingMessages` 遵循 batch + words 阈值
- **未整合 STM 下限**：最小未整合 STM 数设为 2
- **保存快照错误显式日志**：`saveVaultWithSnapshot` 不再静默失败

---

# NE-Memory v0.3.0 更新日志

> 2026-05-31 · State Schema 模块 + 工具体系奠基

## 新功能

- **State Schema 模块**：字段级 Schema 约束，LLM 只修改变化字段不重写全量，支持 Schema 驱动的状态维护
- **Tool 体系整合**：从散落函数整合为统一的工具注册与调用框架

## Bug 修复

- **数据流断点三联**：重试队列恢复、空 LLM 响应处理、usage 声明补齐
- **合并 STM 过滤**：已合并至 LTM 的 STM 条目不再参与新一轮处理
- **统一 openDB**：多处重复的 IndexedDB 打开逻辑收归单一路径
- **Pin 图标恢复**：修复尺寸与 hover 效果
- **配置按钮布局修复**：Settings 面板按钮对齐

---

# NE-Memory v0.2.0 更新日志

> 2026-05-30 · 纯前端架构 + CDN 分发首版

## 架构决策

- **纯前端架构**：不依赖任何服务端，基于 SillyTavern Extension API 的纯浏览器端记忆引擎
- **CDN 分发链路**：jsDelivr（gcore）+ GitHub raw 双 CDN，Tampermonkey 脚本装载器实现零安装部署
- **Shadow DOM 隔离**：面板渲染在 `window.parent.document` 上，与 SillyTavern 主页面 DOM 完全隔离

## 新功能

- **右侧抽屉式 Vault 面板**：带 Tabs 分页、历史记录面板、LLM 操作日志面板、记忆条目编辑
- **遥测模块**：Issue 报告 + gcore CDN 埋点，提供运行时健康数据采集
- **TH 脚本导入模板**：一键安装 JSON，README 安装指引

## Bug 修复

- **iframe 高度冻结**：抽屉 UI 实现 `iframe height freeze`，防止面板撑开主页面
- **CSS 注入**：因 TH 环境 `style.css` 不加载，改为 JS 动态注入样式
- **CDN 缓存**：多次迭代 CDN URL（raw → jsDelivr → gcore）解决缓存滞后
- **启动方式**：从 jQuery-only 改为 `DOMContentLoaded` + 重试机制
- **Tampermonkey banner**：移除被 TH 误解析的 UserScript 头部注释

---

# 项目起源 — 叙事引擎 P1-P3

> 2026-05-28 ~ 2026-05-29 · SillyTavern Extension 架构下的记忆引擎原初设计

## 核心决策

- **定位**：SillyTavern AI 角色扮演前端的长对话结构化记忆管理引擎
- **技术选型**：JavaScript ES Modules → Rollup IIFE 构建，IndexedDB 持久化存储
- **分层架构**：STM（短期记忆，对话轮次级）→ LTM（长期记忆，叙事弧线级）→ State（角色状态，Schema 驱动）

## 初始骨架

- **叙事引擎 P1–P3 全量基础骨架**：pipeline-guard 管线编排器、STM/LTM 提取管线、IndexedDB vault 存储层
- **前端配置页**：设置面板 UI 框架、参数滑块、连接状态指示
- **LLM 适配层**：副 API 渠道（独立于主对话 LLM 的记忆提取专用 API），支持 OpenAI 格式 + 本地代理
