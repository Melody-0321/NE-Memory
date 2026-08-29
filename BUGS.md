# NE Memory Engine — Bug 追踪

---

## vNext-56 角色卡对象字段裸 JSON 展示且不可编辑（仅 inventory/power_slots 有专属 UI）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-29（用户反馈：状态栏角色卡中只有物品栏是独立 UI 模式，其它对象字段裸 JSON 展示不可读） |
| **解决** | 2026-08-29 |
| **严重程度** | **Medium** |
| **影响** | 角色卡中 schema 声明为 object 的字段（abilities、power_slots、任意自定义 object 字段）以 `JSON.stringify` 裸文本塞进表格单元格，不可读；且对象字段移出表格后编辑模式从未接线，inventory 也一并不可编辑（历史缺陷）。 |

### 根因

1. **裸 JSON 展示**：`renderCharacterCard` 仅对 inventory/power_slots 走专属区块渲染，其余 object 字段落入表格行以 `JSON.stringify` 裸文本展示——机制没有通用化。
2. **不可编辑**：`enterCardEditMode` 只遍历表格单元格（`.ne-char-val`），对象区块渲染在表格之外、无任何 DOM 接点；`saveCardFields`/`exitCardEditMode` 同理只处理表格，对象字段保存/取消两路全部缺失。

### 修复

- **通用对象区块渲染器**（`src/adapter/panel-state-cards.js`）：新增 `renderObjectFieldSection`/`_renderObjectItem`/`_objTitle`/`_objIsObject`，按 schema 声明或值类型统一识别 object 字段（含模板外字段），渲染为「标题 + 数量徽章 + 条目（名称 + type/rarity/level/quality 等徽章 + desc/effect/properties 描述 + 其余键值行）」结构化区块，数据属性 `data-char`/`data-field`/`data-type="object"` 供编辑模式定位；schema 声明但无数据的字段渲染空态区，消除"方案有字段、卡无区块"的不一致。
- **编辑模式补齐**：`enterCardEditMode` 将各 `.ne-object-field` 的 items 容器替换为预填 vault 实际值的 JSON textarea（`_neOrigObjHTML` 存原 HTML）；`saveCardFields` 遍历 `.ne-object-field` 解析 textarea，非法 JSON 进 `invalidJsonFields` 上报且跳过；`exitCardEditMode` 还原原结构化区块。
- **样式统一**：`panel.css` 中 inventory/power-slots 专属类合并为通用 `.ne-object-*` 类（badge 默认 info 色、`--level` 用 warning 色），并补充 `.ne-obj-edit` 编辑态样式。
- **i18n 补齐**：`STATE_FIELD_I18N` 三语补充对象子键 level/effect/rarity/properties 标签。commit: 待提交。

---

## vNext-55 聊天切换后聊天文件权威 vault 从未被读取（init 早于聊天加载）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-28（跨浏览器数据不同步排查，Trae 内置浏览器实测） |
| **解决** | 2026-08-28 |
| **严重程度** | **High** |
| **影响** | 聊天文件权威重构（vNext 存储策略 Track1）不生效：换浏览器/设备后记忆面板恒为空，`chat_metadata.ne_vault`（权威数据，实测 31KB / v97 / 35 条 STM）自始至终无人读取。 |

### 根因

两层叠加：

1. **init 时序**：酒馆助手 iframe 脚本在 ST 完成聊天加载前启动，`bootstrapVault → loadVault` 执行时 `chatMetadata` 还是空对象、`ctx.chatId` 为 falsy → getChatId 走 localStorage 指纹回退（`ne_x_0`），loadVault 读不到聊天文件权威数据，fresh start。
2. **事件处理器未走权威路径**：聊天真正就绪后 ST 触发 `chat_id_changed`/`CHAT_CHANGED`，但处理器里读的是 `readVault`（纯 IndexedDB）——新浏览器 IDB 为空，且永远不查聊天文件。

### 修复

`chat_id_changed` 与 `CHAT_CHANGED`（legacy）两处处理器的 `readVault` 改为 `loadVault`（聊天文件恒定权威读，命中即回写 IDB 缓存）。聊天就绪事件成为权威读入点，时序问题随之化解。控制台验证：事件触发时 `chatMetadata.ne_vault` 已就绪（ST 先置 metadata 后发事件）。commit: 待提交。

---

## vNext-54 抽取记忆丢失否定/反悔的最终状态（D 方案 resolver 生产化）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-19（T1 情态存活率审计 + modality 臂评测，canonical §7.5） |
| **解决** | 2026-08-19 |
| **严重程度** | **High** |
| **影响** | STM 抽取以最初主张为锚点，跨 turn 折叠时丢弃晚到的「最终状态」——反悔/否定类事件（"发誓戒烟"→"又抽了"）被存成"发誓戒烟"，反悔存活率 0%，错误状态每轮被注入。 |

### 根因

抽取任务框架是"编年转录"（问这段发生了什么），不要求状态消解；LLM 能力/信息都不缺（QA 探针：同对话显式反悔 100% 答对，抽取 0%）。加 modality 字段（B/C 方案）不改变任务框架故无效（评测证伪）。

### 修复

**resolve-rewrite 二段式（D 方案）生产化**：抽取后新增 resolver pass（`src/core/engine/stm-resolver.js`），对每个 chunk 的 events 喂「段内对话 + 事件列表」，判定最终真实状态是否反转；命中反转则重写 event 文本为最终态（"先……最终……"+ 逐字 evidence），未反转原样返回。规格（modality-schema-fix-plan §3.9.2）：K=2 批量 + max_tokens≥1800 + 降级（失败原样返回）+ 证据约束（reversed=true 必须带 evidence 否则视为未反转，防幻觉）。接线在 stm-pipeline.js 抽取后、validate 前；`stmResolveReversal` 开关默认开。验收（D-prod vs D 臂，dev+holdout）：**dev 反悔 94%、holdout 100%，与评测 D 对齐，无生产化损耗**。commit: 待提交。

---

## vNext-1 resolvePipelineApi 缺 template_assistant 通道路由

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-01（审计） |
| **解决** | 2026-08-01 |
| **严重程度** | **High** |
| **影响** | SHUJUKU_REFS §11.8 声明的 `ne_template_api` 专属路由实现遗漏，配置模板通道时静默落到通用副 API，模板 LLM 无法按配置的专属通道工作。 |

### 根因

`resolvePipelineApi` 未实现 `template_assistant` 通道分支，模板调用未命中专属路由。

### 修复

补 `template_assistant` 通道路由。commit: `3b84301`

> 该修复未进入 CHANGELOG Unreleased 与审计追踪表，系三方台账遗漏项（git log 兜底发现）。

---

## vNext-2 审计 D/R 系列修复（DB 缓存/跨聊天缓存/模板回填）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-01（审计） |
| **解决** | 2026-08-01 |
| **严重程度** | 多项（D1/R2 Medium，D3/D4 Low） |
| **影响** | 审计 D/R/P 系列发现的四个独立问题：① **D1** `listAllChatIds` 用独立连接，`db.close()` 会误杀 openDB 缓存连接；② **R2** 排序/消息 token 缓存未按 chatId 隔离 + 无容量上限（跨聊天缓存污染）；③ **D3** `ensureCharacterTemplate` 隐式创建/回填未标记 changed，仅输出角色名的新角色内容丢失；④ **D4** per-merge 模板解析无缓存（N 字段 → N 次 localStorage 读）。 |

### 修复

- D1：显式 `db.close()` 不再影响缓存连接
- R2：sort/msg-token 缓存按 chatId 隔离 + 容量上限
- D3：隐式创建/回填时标记 changed
- D4：`ensureCharacterTemplate` 增加 per-merge 模板解析缓存
- 另修复 retrieval-cache.test.js 异步调用未 await + 注册进 run.mjs（此前静默从未运行）
- commit: `f572ba8`

> 该修复未进入 CHANGELOG Unreleased 与审计追踪表，系三方台账遗漏项（git log 兜底发现）。

---

## vNext-3 设置页控件在 Shadow DOM 下失效（UI-11）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | panel-settings 的 `.ne-manual-controls`/`.ne-adaptive-only` 用裸 `document.querySelectorAll`，扩展模式面板在 shadow root 内查不到 → 手动控制/自适应专属选项无法切换。 |

### 修复

替换为 shadow-aware 的 `panelQSA`。commit: `5bc0d1d`

---

## vNext-4 初始化窗口期首轮消息漏记（UI-10）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | init 顺序是先 `_bootstrapVault`（loadVault + 迁移 + 渲染面板，耗时）再绑事件，期间到达的首轮 `message_received/sent` 无人监听永久漏记。 |

### 修复

事件绑定 + 工具注册 + ChatCompletion patch 移到 bootstrap 之前；bootstrap 首次初始化加重读保护（写前检查已有数据则跳过全量初始化写）。commit: `5bc0d1d`

---

## vNext-5 消息内假按钮不可点击（UI-8）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 系统消息把按钮拼成 `[文字]` 纯文本进聊天，ST 当前版本无消息内按钮机制，用户点击无反应且文本误导。 |

### 修复

诚实降级：按钮以 `·` 分隔的纯文本提示呈现，不再拼假按钮；`sendNeInteraction`/`sendNePopup` 接口保留，事件调用点改走 `sendNeNotification`。commit: `5bc0d1d`

---

## vNext-6 手动编辑保存静默失败（UI-6）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `saveCardFields`/`deleteCharacterCard` 的 `writeState` 无 catch，IndexedDB 写入失败无任何反馈（"保存无反应"）；保存后清理逻辑为死代码（`.ne-card-edit-form`/`.ne-card-edit-btns` 从不创建）。 |

### 修复

writeState 加 catch + toast 报错；死代码替换为显式 `exitCardEditMode`。commit: `5bc0d1d`

---

## vNext-7 LTM 主行未转义（UI-5）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | LTM 表主行的 title/event/period 直接拼 innerHTML，特殊字符可破坏渲染（STM 行已转义）。 |

### 修复

ltmTitle/ltmEvent/periodCell 统一 `escapeHtml`。commit: `5bc0d1d`

---

## vNext-8 确认弹窗 Promise 挂起（UIS-7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `showConfirm` 的 close 依赖 `transitionend` 事件才 resolve，若弹窗 CSS transition 被主题/样式覆盖禁用（`transition:none` 等）事件永不触发 → Promise 永久挂起，确认后的删除/保存代码不执行，弹窗瞬隐但数据未变（"点删除没反应"可疑根因）。 |

### 修复

close 加 300ms 超时兜底：`transitionend` 触发则即时清理，不触发则超时强制移除弹窗 + resolve。commit: `5bc0d1d`

---

## vNext-9 版本历史滑杆每事件落盘（UIS-6）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | panel-version-history 两个限制滑杆 oninput 每次移动都写 localStorage + neSync（与 UIP-3 同源）。 |

### 修复

oninput 只更新即时显示，onchange（拖动结束）才 `saveConfig`。commit: `5bc0d1d`

---

## vNext-10 ResizeObserver 泄漏（UIS-5）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | 移动端响应式 ResizeObserver 挂在 overlay 上但关闭时从不 disconnect；init 双跑可能重复创建。 |

### 修复

`stopOverlayResizeWatcher` 一并 disconnect（`closeVaultOverlay` 必经路径）；`setupMobileObserver` 防重复创建。commit: `5bc0d1d`

---

## vNext-11 全局键盘导航重复绑定（UIS-4）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | bootstrap 的卡片回车/空格切换 keydown 监听无去重守卫，init 双跑时按键重复触发。 |

### 修复

`_keyNavBound` 守卫，`_bindCardToggleKeyNav()` 只绑一次。commit: `5bc0d1d`

---

## vNext-12 overlay 关闭监听累积（UIS-3）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | `closeVaultOverlay` 每次调用都 `addEventListener transitionend`，若 overlay 已 `display:none`（无过渡触发）监听永留累积。 |

### 修复

命名 handler + 关闭前先移除 + 兜底 timer 重置。commit: `5bc0d1d`

---

## vNext-13 帮助卡片外部点击监听泄漏（UIS-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |

### 修复

统一 `closeCard`：X 按钮 / 外部点击 / `hideHelpCard` 三路径都 `removeEventListener`。commit: `5bc0d1d`

---

## vNext-14 确认弹窗 Esc 监听泄漏（UIS-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | `showConfirm` 的 document keydown 监听只在按 Esc 时移除自身，点确定/取消/遮罩关闭则每次弹窗残留一个监听。 |

### 修复

close 统一移除 escHandler，任何关闭路径都清理。commit: `5bc0d1d`

---

## vNext-15 自适应上下文空转死循环（P1-18）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | 启用自适应上下文控制后"一发消息就卡死"：对话初期 vault 记忆为空 → `expandLayers`/`compressLayers` 选中 memory_vault 层后无分支可执行，`totalTokens` 永不变化 → 无限循环冻结主线程（7.2 的 `maxIterations` 仅兜底，把卡死降级为每次空转 100-200 轮）。 |

### 修复

两主循环加 no-progress 检测（本轮 token 无变化即 break）；layers 构建时无缓存层不入候选（源头过滤）。commit: `a537b3e`（此前 7.2 曾以 `maxIterations` 兜底 + 无撤回分支退出，commit: `ec36b82`/`882deea`，仅把卡死降级为每次空转 100-200 轮，未根治）

---

## vNext-16 STM 事件 partial 语义被覆盖（P1-17）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `mapEventData` 强制 `event.status = 'closed'` 抹掉 LLM 输出的 partial（窗口内容不足以形成完整事件），跨窗口续接链路永远闭合。 |

### 修复

仅缺失/非法值归 closed，partial 保留。commit: `5bc0d1d`

---

## vNext-17 present_characters 死代码 fallback（P1-16）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | `openLtm.present_characters[0].scene`——present_characters 是字符串数组（LLM 输出全名数组）无 `.scene` 字段，fallback 恒为 `''`。 |

### 修复

删除，仅保留 `openLtm.scene || ''`。commit: `5bc0d1d`

---

## vNext-18 歧义解析语义不一致（P1-15）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 模式3 的 resolved 存"实体名+后缀"与模式1/2 只存实体名不一致；`enhancedQuery.replace` 无 `/g` 只替换第一处引用。 |

### 修复

只存实体名（与模式1/2 一致）；`split/join` 全局替换（避免正则转义问题）。commit: `5bc0d1d`

---

## vNext-19 vault 状态栏无数据（UIP-1 缓存回归）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | UIP-1 区块缓存引入后，panel-content.js 顶部仍无条件移除 `.narrative_*_block` 元素，而内层 Section 仅在缓存未命中时才重新注入 innerHTML → 任一刷新轮次若 state 数据未变（缓存命中），State 区块被先删后不重建，状态栏永久空白。 |

### 修复

删除冗余的区块移除循环，依赖 innerHTML 覆盖完成清理。commit: `bf94b20` / `2560b80`

---

## vNext-20 access 工具消息引用崩溃（P0-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `[→msgId]` 引用未声明变量（ReferenceError），`msg#N`/裸数字引用且消息存在时 100% 失败。 |

### 修复

改为 `numId` 回显引用数字（根因：`55f21c7` 改名时漏改此用法）；`findMessageInChat` 支持裸数字输入，走数组下标 O(1) 反问 + id 身份校验，漂移时回退全量扫描；修复 `!msgId` 守卫误拦合法下标 0。commit: `55f21c7`

---

## vNext-21 v6→v7 迁移在空库上永久挂起（P0-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `_migrateVaultsToSplit` 用 `verifyHashes.forEach` 逐条校验，旧 vaults store 为空（或无带 content 记录）时回调一次不执行 → `done >= checks`（0>=0）永不成立，Promise 永不 settle → `openDB` 的 `resolve(db)` 永不执行，所有 read/write 永久挂起。 |

### 修复

空数组早退：`checks === 0` 直接 resolve 完成迁移。commit: `5bc0d1d`

---

## vNext-22 单任务失败后该队列后续任务全部被跳过（P0-3）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | pipeline-guard 三个 enqueue 用 `.then(success, rejection)` 双参数链，rejection handler `throw e` 毒化队列 → 失败任务之后的任务只走 rejection 分支、`taskFn` 永不执行（记忆写入静默丢失），直到 `reset()`。 |

### 修复

改 `.then(success).catch(failure)` 链式结构：失败经 `addAnomaly` 入 telemetry + console.error，尾部 catch 吞错保链 resolved，后续任务照常执行。commit: `5bc0d1d`

---

## vNext-23 STM 校验系统性误报（P0-4）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `validateMsgRanges` 用本次增量条数（`filteredMessages.length`）校验 msgRange 的**全局绝对消息索引** → 长对话增量更新时必然报"越界 + 未覆盖"，污染 telemetry validation_warnings。 |

### 修复

窗口语义：`validateMsgRanges`/`validateSTMOutput` 增可选参数 `windowStart`/`windowEnd`（默认 0..messageCount-1 兼容旧签名），越界按窗口边界检查、covered 数组改连续性检查。commit: `5bc0d1d`

---

## vNext-24 orphaned_branches 死机制移除（P0-5）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 孤立分支 store 的写入生产者从未存在，`restoreBranch`/`cleanupBranches` 无任何调用方，`pruneOrphanedBranches` 唯一调用消费的永远为空数据。"恢复已删除记忆"与产品原则（记忆生命周期 = 对话生命周期）矛盾。 |

### 修复

删除 `restoreBranch`/`cleanupBranches`/`pruneOrphanedBranches` 三函数 + state-pipeline 调用 + 死变量 `BRANCH_TTL_MS`；store 定义与 `remove(chatId)` 防御性清理保留。commit: `5bc0d1d`

---

## vNext-25 原型链保留键 path 污染（P1-6）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `__proto__`/`constructor`/`prototype` 作为 dot-path 段时，`mergeStateChanges` 的 `current[key]` 写入会落到 `Object.prototype` 或读到原型属性（LLM 输出的恶意/异常字段名可造成校验绕过或污染）。 |

### 修复

schema.js merge 路径遍历 + `ensureCharacterTemplate` 调用处 + state-versions `_setByPath`/`_getByPath` 统一加 `isReservedKey` 拦截。commit: `5bc0d1d`

---

## vNext-26 schema 校验缺口补全（P1-7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | ① `resolveSchemaPath` 不支持 `item_schema` 步进，abilities/inventory 等 map 容器子结构校验完全无效；② `validateField` 对 object 类型零校验（任意值放行）；③ required 字段从不校验。 |

### 修复

① 补"动态键丢弃 + 进入 item_schema 模板"逻辑；② 补 object 类型检查（null 归 {}，数组/标量拒绝）；③ required 字段补空值拦截（`''`/`undefined`/`null`/`NaN` → 拒绝写入 + warning，保留旧值）。commit: `5bc0d1d`

---

## vNext-27 `__inc` 增量语法通用化（P1-8）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | merge 层对 `__inc` 只特判 `affection`，LLM 对其他 number 字段输出 `+N`/`-N` 时把 `{__inc,delta}` 对象直接写进状态。 |

### 修复

任意字段应用增量，affection 保留 0-100 clamp，capturedChanges 记录 old/new。commit: `5bc0d1d`

---

## vNext-28 token 相似度原型链误判（P1-10）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `vocabularyOverlap` 用普通对象字面量 `{}` 当 Set，token 为 `constructor`/`toString`/`valueOf` 时经 `Object.prototype` 误判命中 → 相似度虚高。 |

### 修复

`Object.create(null)` 无原型对象替代 `{}`（两条 token 集）。commit: `5bc0d1d`

---

## vNext-29 SmartPush 注入次数伪统计（P1-11）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | `total_smartpush_injections` 直接赋 `total_turns` 占位，无真实计数来源且全代码库无消费方，UI 展示误导。 |

### 修复

删除字段（含注释示例与 aggregate 初始化）。commit: `5bc0d1d`

---

## vNext-30 GC 漏 memory_vaults store（P1-12）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `listAllChatIds` 只扫 `vaults`/`state_vaults`/`active_chains`，memory_vaults 中的孤儿数据永不参与清理。 |

### 修复

stores 列表补 `'memory_vaults'`。commit: `5bc0d1d`

---

## vNext-31 时间戳 NaN 输出"NaN 个月前"（P1-13）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | `calRelativeTime` 对字符串时间戳直接相减得 `NaN`，一路比较为 false 后落到"NaN 个月前"。 |

### 修复

入口 `Number()` 归一化 + 空值/NaN 早退。commit: `5bc0d1d`

---

## vNext-32 派系扫描大小写敏感（P1-14）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `scanMessageForFactions` 用 `indexOf` 精确匹配，alias 大小写变体（如 `Order` 匹配不到 `order`）导致派系激活失败。 |

### 修复

文本与关键词统一 toLowerCase 比较。commit: `5bc0d1d`

---

## vNext-33 设置保存全量热更新（UIP-4）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 任何单项设置变更都经 `saveSettingsTab` 全量重写 `ne_settings` + channels 全量重写 5 份 API 配置 + `neSyncAll` 全量扫描 17+ key，改 1 项 = 6 份全量 JSON + 全量同步。 |

### 修复

增量保存：① `ne_settings` 写前变更检测（值未变不落盘不同步）② channels 4 份 API 配置拆分独立保存（`_saveChannelApiOnly`）③ embedding/secondary 复用既有拆分函数 ④ 保存后 `neSyncAll` → `neSync(key)` 精确同步，删除 `neSyncAll`。commit: `5bc0d1d`

---

## vNext-34 设置页滑杆拖动卡顿（UIP-3）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | 8 处滑杆 oninput 每 tick 触发全量保存（6×setItem + neSyncAll 全量扫描），拖动时 UI 卡顿。 |

### 修复

`_debouncedSaveSettingsTab()` 300ms 防抖，拖动结束后才写入；输入框/开关 onchange 保持直存。commit: `5bc0d1d`

---

## vNext-35 模板卡每卡重复读 localStorage（UIP-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | 渲染配置卡时每卡重复调用 `SillyTavern.getContext()` + `loadCardConfigSync`（localStorage 读 + JSON.parse）。 |

### 修复

基于渲染时已读入的 cardConfig 内联判断锁定态，一次读取全卡复用；`store.js` 的 `isDialogueTemplateLocked`（无引用）已删除。commit: `5bc0d1d`

---

## vNext-36 面板每轮全量重建（UIP-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | 每轮 `vault:updated` 无条件 innerHTML 全量重建 + 事件重绑，即使数据未变也触发解析/重排/失焦 → 面板卡顿。 |

### 修复

区块级 HTML 缓存：char/faction/quest 用渲染字符串比较、STM/LTM 用输入 JSON 签名、quick index 用内容比较，全部未变的轮次跳过 DOM 重建与重绑；移除 setTimeout(50) 二次绑定（重建时同步绑定）；热路径 console.log 改 `__NE_DEV_MODE` 守卫。commit: `5bc0d1d`

---

## vNext-37 移动端响应式失效（UIB-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `.ne-mobile` 类挂在 shadow host 上，注入到 shadow 内的 `.ne-mobile .xxx` 选择器无法跨边界选中宿主 → 移动端减 padding/降字号/关模糊/模板单列全部不生效。 |

### 修复

动态前缀：shadow 用 `:host(.ne-mobile)`、非 shadow 用 `.ne-vault-bottom-overlay.ne-mobile`；修正原两分支均不匹配的错误选择器。commit: `5bc0d1d`

---

## vNext-38 面板样式 token 失效（UIB-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | 所有 `--ne-*` 设计 token 只定义在 style.css 的 `:root`，但 style.css 从未被加载（manifest css 为空、rollup 无 CSS、CDN 只装 index.js）→ 所有 `var(--ne-*)` 静默失效，状态点/徽章/按钮颜色全部退色（"UI 变丑"主因）。记忆表格 th/td 边框、padding 同样缺失，内容挤压无边框。 |

### 修复

token 块迁移进 JS 注入（PD.head `:root`，shadow 树经 host 继承同样生效）；memory table 基础规则迁移进注入 CSS；548 行 style.css 规则经审计仅此两项存活，其余为死代码，style.css 清空为废弃说明占位。commit: `5bc0d1d`

---

## vNext-39 启动重复执行（UI-9）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | bootNE 无守卫，DOMContentLoaded + `readyState==='interactive'` 双触发导致工具重复注册、vault 双写。 |

### 修复

`window.__ne_booted` 启动守卫。commit: `5bc0d1d`

---

## vNext-40 编辑内容被刷新抹掉（UI-7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | panel-content.js 防刷新保护 class 列表漏 `.ne-inline-row`/`.ne-char-edit`，用户在管线运行时手改 STM/LTM 行或卡片会被 `vault:updated` 抹掉。 |

### 修复

编辑保护 `closest` 条件补两类编辑态 class。commit: `5bc0d1d`

---

## vNext-41 自定义字段误存类型名（UI-4）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 保存模板/方案时选择器同时匹配字段名 + 类型两个 span，把 `'string'/'number'` 混入字段引用并写入字段库（三处保存 + 两处查重同源）。 |

### 修复

选择器改 `> span:first-child`（字段名 span 均为容器首个子元素），5 处一并修正。commit: `5bc0d1d`

---

## vNext-42 用量图表 State 序列断档（UI-3）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Low |
| **影响** | panel-usage.js 图表默认对象用 `sp`、消费方读 `.state`，无数据日 State 曲线断档 + state-only 月份误判"无数据"。 |

### 修复

默认对象与判定统一为 `state: 0`。commit: `5bc0d1d`

---

## vNext-43 embedding 通道鉴权失效（UI-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | key 读取取不存在的 `nes_embedding_api_key`（真实 ID 是 `nes_embedding_key`），fetch models 永远无鉴权。 |

### 修复

keyId 特判：`prefix === 'nes_embedding'` 时用 `nes_embedding_key`。commit: `5bc0d1d`

---

## vNext-44 设置保存必然报错（UI-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | panel-settings.js 引用 `setRetrievalEnabled` 但从未 import，每次保存设置抛 ReferenceError，channels 模式下 API 通道配置/neSyncAll 全部不落盘。 |

### 修复

L7 补 `import { setRetrievalEnabled }`。commit: `5bc0d1d`

---

## vNext-45 冒烟测试三项误判（smartpush-14）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | 三项独立误判导致冒烟测试结果不可靠：① LTM 断言依赖环境设置默认值（本次=6 但测试 8 轮仅 5 条 STM，必然 FAIL）；② 用 `completion_tokens>=4096` 代理判定截断，长但完整的 JSON 响应被误判；③ 语义评估器只收到累积缓冲前 3000 字符（全是首轮），永远看不到 STM 输出。 |

### 修复

① test-case.md 前置条件写死默认值 5；② 改为"触顶且响应无法解析为 JSON"才算真截断；③ 改收对话文本 + STM 事件结构化上下文、截取缓冲末尾，修正"(超时截断)"误导标签，测试开始时重置累积缓冲。commit: `5bc0d1d`

---

## vNext-46 compact 折叠后回滚越界破坏版本链（P2-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `rollbackState`/`rollbackMemory` 只挡 `target >= head`，向已折叠版本回滚时把 head 也当孤儿项删除 → `newActive=[]`、`base_seq=0`，head delta（含 folded_state）被物理删除，版本链损坏。commit: `884e474` |

### 修复

三层防护：①数据层 `evaluateRollbackTarget` 非 active 目标统一拒绝；②面板回滚/前进按钮按 active 链可用性置灰；③ events.js 调用点经 `_rollbackOrWarn` 处理，`archived` 时 toastr 警告弹窗。

---

## vNext-47 SmartPush 实体链链路恢复

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `formatSmartContext` 中 `entityChains` 初始化为 `{}` 后从未赋值，mergePipelines 三步消费点全部空转——文档宣称的实体链增强功能未接线 。 |

### 修复

补 `await lookupEntityChains(content, entityNames)` 接线——实体链从事件指针 `present_characters` 实时构建，非独立存储。commit: `5bc0d1d`

---

## vNext-48 退化日期 msgId 漂移断链（P1-5）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | 数字 id 退化格式（`3_0000-00-00T00:00:00.000Z_5_user`）在消息漂移后无法按 send_date 匹配，fallback 直接断链 → msg 引用永久丢失。 |

### 修复

`_legacyScan` 提取退化日期段的尾段数字 id 按 `m.id` 匹配（无 id 消息按位置即身份）。commit: `5bc0d1d`

---

## vNext-49 LLM 超时重试加剧延迟（P1-4）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | AbortError（超时）无条件重试 ×2 轮 × 双请求且全部等满 timeoutSec，最坏 ~19s+ 延迟。 |

### 修复

AbortError 不重试直接抛（仅 5xx/网络类可重试）。commit: `5bc0d1d`

---

## vNext-50 小模型上下文压缩永不触发（P1-3）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | Medium |
| **影响** | `usableBase = Math.max(2000, ...)` 强抬下限，maxContext < 2300 的小模型 goldenUpper 超过模型容量 → 压缩条件恒不成立。 |

### 修复

下限改 1000 + `goldenUpper = Math.min(goldenUpper, usableBase)` 封顶在可用预算内。commit: `5bc0d1d`

---

## vNext-51 STM 事件映射全量错位（P1-2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | 事件按数组下标与 segment 一一映射，LLM 少输出事件时后续事件全部错位到错误的 turn 区间。 |

### 修复

优先用 LLM 返回的事件自带 `msgRange`（窗口内下标）→ 经 windowMessages（含 `_absIdx`）转换全局下标 → 与 turns 相交得覆盖轮次。commit: `5bc0d1d`

---

## vNext-52 超长 segment 非首位置不拆分（P1-1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23 |
| **严重程度** | **High** |
| **影响** | `chunkSegmentsForLLM` 仅 currentChunk 为空时才拆分超长 segment，累积场景下超长 chunk 整段提交给 LLM，触发上下文溢出。 |

### 修复

超长 segment 无论是否首位置都先 flush 当前 chunk 再 `splitIntraSegment` 拆分。commit: `5bc0d1d`

---

## vNext-53 key-highlights 前置段无收益且方向性负（注入精简）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-08-19（三层仪器评测，canonical-numbers.md §8/§8.2） |
| **解决** | 2026-08-19 |
| **严重程度** | Low |
| **影响** | 注入文档前置"关键记忆"段（buildKeyHighlights）对取答正确率无收益（state 0.0pp）且方向性推后已突出事件（narrative -11.1pp，双向位移机制——前置段把原本已突出的高相关事件挤到文档后部），同时多占约 350 字注入预算。 |

### 根因

呈现层位置置换无信息增益：前置段内容与实体块/检索结果同源（同一 pipelineMap 按 relevance 排序取 top5），机制为双向位移——段内条目上移的同时把其余已突出事件整体推后，净收益为零且叙事类问题负向。

### 修复

移除 injection.js 中 buildKeyHighlights 的生产调用（entityGrouped 判断块内 5 行），原位留注释说明依据；函数定义保留供 test/retrieval-benchmark/ 两个评测脚本 import。commit: （随本次变更统一提交）

---

## v7.2-1 chat-completion 拦截器稳定性（v7.2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23（v7.2） |
| **严重程度** | **High** |
| **影响** | 对话轮次裁剪拦截器 hook 目标错误、NARRATOR/newMainChat 消息被误过滤、事件名大小写不匹配、模块被 ES tree-shaking 丢失，导致裁剪不生效或崩溃。 |

### 修复

- 修正 hook 目标与 NARRATOR/newMainChat 过滤逻辑
- 修正事件名大小写不匹配（`CHAT_COMPLETION_PROMPT_READY` 必须小写）
- 移至模块顶层防止 ES tree-shaking 丢失
- commit: `993fe98` / `e01d5fd` / `45b9d0f` / `6d33767` / `fe82fcb`

---

## v7.2-2 import() URL 解析失败（v7.2）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-23 |
| **解决** | 2026-07-23（v7.2） |
| **严重程度** | **High** |
| **影响** | ST 服务器返回 `location.origin === null` 时动态 `import()` 失败；Rollup 将绝对路径转为相对路径导致解析错误。 |

### 修复

多级 fallback：`location.origin` → href regex 提取 → 硬编码；阻止 Rollup 绝对路径转相对。commit: `2c9d035` / `d891a02` / `9bf02f5` / `855783d`

---

## v7.1-1 UI 与 Prompt 修正（v7.1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-17 |
| **解决** | 2026-07-17（v7.1） |
| **严重程度** | Medium |
| **影响** | 内联版本导航按钮方向反转（与侧滑面板语义不符）；角色卡尺寸异常、inventory/power_slots 显示原始 JSON；LLM Prompt 未区分 string（填 none）与 object/array（填 []）字段，消歧义指引缺失。 |

### 修复

- 内联版本导航按钮方向反转修正
- 角色卡尺寸调整，inventory/power_slots 改为 chip 样式
- Prompt 区分 string/object/array 字段默认值 + "或"源文本消歧义指引
- commit: `3ef1661` / `809b95b` / `167b9ac` / `ae52028` / `44dd5b6`

---

## v7.1-2 模板字段生命周期（v7.1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-17 |
| **解决** | 2026-07-17（v7.1） |
| **严重程度** | Medium |
| **影响** | 现有角色不自动补齐新增字段（current_outfit/abilities/power_level），空字段无占位显示，编辑默认方案时直接改动默认方案。 |

### 修复

- 现有角色自动补齐新增字段为类型合适的默认值
- 空字段在卡片中以占位样式显示并可点击编辑
- 编辑默认方案时先克隆到卡片级再修改
- commit: `7c7c46f` / `0a7d2d5`

---

## v7.1-3 方案持久化与渲染（v7.1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-17 |
| **解决** | 2026-07-17（v7.1） |
| **严重程度** | **High** |
| **影响** | 方案编辑后仅停留在内存，未写入 state vault；角色卡按默认模板而非实际 `_scheme` 渲染；版本切换不级联 → "编辑后无变化/重载后丢失"。 |

### 修复

- 方案编辑后正确写入 state vault 并即时切换
- 角色卡按实际 `_scheme` 渲染字段而非默认模板
- 版本切换正确级联
- commit: `71b9764` / `bcbd193` / `14f6078` / `3029671` / `e96488c` / `3853997`

---

## v7.1-4 自定义字段系统 5 处问题（v7.1）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-17 |
| **解决** | 2026-07-17（v7.1） |
| **严重程度** | **High** |
| **影响** | 字段库回退缺失、类型选择器缺失、库写入断裂、引用追踪死码等 5 处问题，导致自定义字段无法完整添加/编辑/保存。 |

### 修复

修复全部 5 处问题，自定义字段可完整添加/编辑/保存。commit: `ef85d5d`

---

## v7.0-1 事件总线竞态（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | 侦听器注册在 `await` 之前，异步操作期间错过事件导致 UI 不刷新。 |

### 修复

侦听器注册移至 `await` 之前，避免事件丢失。commit: `67754ad`

---

## v7.0-2 版本导航按钮 Shadow DOM 查询失效（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | 版本导航按钮在 Shadow DOM 内用错误查询方式，找不到元素 → 点击无反应。 |

### 修复

Shadow DOM 内查询改用 `container.querySelector`。commit: `61b0cf6`

---

## v7.0-3 滚动位置不保存（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Low |
| **影响** | innerHTML 重建后滚动位置重置到顶部，长列表浏览体验差。 |

### 修复

innerHTML 重建后恢复 `scrollTop`。commit: `66382b3` / `d7738ad`

---

## v7.0-4 Embedding API 验证缺失（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | 发送 Embedding 请求前不校验模型名非空 → `JSON.stringify` 省略 undefined key 导致 "Model field is required" 400 错误。 |

### 修复

发送前校验模型名非空；设置 UI 增加必填字段标记。commit: `1a4c538`

---

## v7.0-5 CORS 代理 URL 硬编码（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | CORS 代理 URL 硬编码 `http://127.0.0.1:8000`，用户修改 ST 端口/域名后代理失效。 |

### 修复

改为 `window.location.origin` 动态获取；错误提示补充可操作的检查项。commit: `eb8a4c2`

---

## v7.0-6 首次打开面板不渲染（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | 首次打开面板无内容，`open` class 与 `busEmit` 时序冲突。 |

### 修复

修正 `open` class 与 `busEmit` 的触发时序。commit: `8e6e3be`

---

## v7.0-7 Token 统计落"tok"不可见分类（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Low |
| **影响** | 7 个管线操作（state_extract / faction_discovery / scheme_discovery / template ops / ltm_rebatch / ltm_decision_retry / init_power_slots）全部落入不可见的通用 "tok" 分类，用量图表无法体现。 |

### 修复

将 7 个操作映射到各自的 token 统计分类。commit: `0b4f2c0`

---

## v7.0-8 重掷状态丢失（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | 重掷后 State LLM 不重新运行，状态停留在旧消息。 |

### 修复

重掷后 State LLM 正确重新运行并重建状态。commit: `3fe9f3a`

---

## v7.0-9 跨类型字段泄漏（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | State LLM 向角色卡写入势力/任务/目标专属字段，跨类型字段互相污染。 |

### 修复

prompt 过滤 + validate 拒绝跨类型字段写入。commit: `979bb2c`

---

## v7.0-10 活跃角色默认状态缺失（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | 首次使用的角色无状态，面板全部显示"非活跃"。 |

### 修复

首次使用自动初始化 `status='活跃'`。commit: `566cd12`

---

## v7.0-11 NE-CHAR 合并方向反转（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | State LLM 的新状态被 NE-CHAR 过时默认值覆盖，角色状态全部显示为"非活跃"。 |

### 修复

合并方向反转：NE-CHAR 最新状态合入 State 状态，而非反向覆盖。commit: `7139877`

---

## v7.0-12 State LLM 漏轮（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | Medium |
| **影响** | State 管线触发阈值错误（`>2`），管线排空后漏触发，部分轮次状态不更新。 |

### 修复

阈值修正：`>2` → `>=2`，管线排空后正确触发。commit: `b29d870`

---

## v7.0-13 消息接收崩溃（v7.0 复现）—— `computeWindowStartMsgId` import 再次缺失

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | 与 v6.8-3 同根因（v6.7 遗留 import 缺失），在 v7.0 窗口期再次导致 `onMessageReceived` ReferenceError。 |

### 修复

同 v6.8-3：补回 `computeWindowStartMsgId` import（v7.0 变更中再次确认保留）。

---

## v7.0-14 DB 迁移数据丢失（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | 连续升级路径中重复迁移 + 异步属性未解包导致 Vault 数据清零。 |

### 修复

v7 迁移完整性校验 + 损坏 store 强制重置 + 从 `chat_metadata` 恢复。commit: `5a17c71` / `8f6a682` / `b5dcada` / `bf7514d`

---

## v7.0-15 Firefox 面板不可见（v7.0）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-16 |
| **解决** | 2026-07-16（v7.0） |
| **严重程度** | **High** |
| **影响** | Firefox Shadow DOM 不应用 `:host(.open)` CSS，面板打开后不可见/样式错乱。 |

### 修复

改用 inline style 绕过 `:host(.open)` CSS 不生效问题。commit: `f37915d` / `b9fb892` / `0260eff`

---

## v6.8-1 State LLM max_tokens 触顶

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.8） |
| **严重程度** | Medium |
| **影响** | `state_extract` 操作的 `max_tokens` 硬上限 2048 过紧，该操作频繁接近上限，输出被截断导致状态更新不完整。 |

### 修复

`max_tokens` 上限从 2048 提升至 4096，为 `state_extract` 留出足够空间。commit: `0b21551`

---

## v6.8-2 快照恢复被覆盖（v6.8）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.8） |
| **严重程度** | **High** |
| **影响** | `restoreSnapshot` 恢复 IndexedDB 后未同步 `chat_metadata`，导致 `loadVault` 在版本平局时用聊天文件中的旧缓存覆盖刚恢复的数据。 |

### 修复

`restoreSnapshot` 在 IndexedDB 写入后同步 `chat_metadata`，避免 `loadVault` 以旧缓存覆盖恢复结果。commit: `590582c`

---

## v6.8-3 消息接收崩溃（v6.8）—— `computeWindowStartMsgId` import 缺失

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.8） |
| **严重程度** | **High** |
| **影响** | v6.7 上下文窗口重构时误删 `computeWindowStartMsgId` 的 import，但 `computeContextPressure` 在 `onMessageReceived` 中仍调用它 → 每条消息到达都抛 `ReferenceError`，引擎完全不可用。 |

### 修复

在 events.js 重新补回 `computeWindowStartMsgId` import。commit: `3525039`

---

## v6.7-1 对话轮次剪裁修复（v6.7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.7） |
| **严重程度** | Medium |
| **影响** | 对话框轮次剪裁从 `chat.splice()` 直接在原始聊天数组上操作，有副作用风险。 |

### 修复

剪裁逻辑从 `chat.splice()` 移至 `generate_interceptor`，在 `coreChat` 副本上安全操作。commit: `42f9a56`

---

## v6.7-2 STM 编辑按钮缺失（v6.7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.7） |
| **严重程度** | Low |
| **影响** | 孤儿/LTM 子 STM 行不显示编辑按钮，无法行内修改。 |

### 修复

孤儿/LTM 子 STM 行现在显示编辑按钮。commit: `5c5dbd3`

---

## v6.7-3 快照恢复错误吞噬（v6.7）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07（v6.7） |
| **严重程度** | Medium |
| **影响** | `restoreSnapshot` 异步回调中的错误被静默吞掉，用户无法得知快照恢复失败。 |

### 修复

不再静默吞掉 `restoreSnapshot` 异步回调中的错误。commit: `5c5dbd3`

---

## v6.6-1 Embedding API 输入框修改不保存

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | 用户在 Vector Search accordion 中修改 Embedding 的 URL / Key / Model，输入框显示新值，但关闭重开面板后恢复旧值。修改从未保存。副 API 不受影响。 |

### 根因

`panel-settings.js` 中 Embedding 的 channel-group 无条件渲染在 `commonHtml` 中。当 channelsEnabled = false（默认）时，`nes_embedding_url/key/model` ID 在两处同时出现：channels 隐藏区（第 113-115 行）+ Vector Search 可见区（第 132-134 行）。`panelById()` 永远返回 DOM 中第一个匹配元素（隐藏区），`onchange` 绑定和 save 都命中隐藏副本 → 用户在可见区打字不触发事件，save 读取的是 stale 值。

### 修复

Embedding channel-group 改为 `channelsEnabled ? ... : ''` 条件渲染。两个模式下 embedding 输入字段各只有一份，无 ID 冲突。commit: `93a8266`

### 引入者

`c181ccc`（多通道 API 路由）

---

## v6.6-2 设置面板副 API 保存崩溃

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | `saveSettingsTab` 中 `secApi` 对象的 `panelById('nes_secondary_url').value.trim()` 无空值保护 → `panelById` 返回 null 时首行 TypeError，整函数静默崩溃。所有设置修改均不保存。副 API 字段本身的 `onchange` 走 `saveSecApiOnly()` 分支，不受影响。 |

### 修复

`secApi` 三字段全部加 `panelById(...) ? panelById(...).value.trim() : ''` 空值安全。commit: `8c4954d`

---

## v6.6-3 面板 overlay 与聊天窗口分层：双滚轮 + 下滑翻开面板回归

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-07 |
| **解决** | 2026-07-07 |
| **严重程度** | **High** |
| **影响** | v6.4 修复后面板尺寸对齐后，双滚轮和下滑翻开面板再次出现。关态 overlflow inline `display: flex` 残留（优先级高于 CSS `display: none`），布局盒撑开 `#sheld` 滚动区域。 |

### 根因链

v6.4 的修复依赖 `transitionend` 事件将 `display` 切回 `none`，但 `transitionend` 可能不触发（CSS 变量未定义、快速切换等）。`open` 类移除后，inline `display: flex`（`createVaultPopout` 第 20 行设置）仍覆盖 CSS 的 `display: none`。

### 修复（三段迭代）

1. `5346b9d`：三个关闭路径加 600ms timeout 兜底 + transitionend 正常清。
2. `eff3dd1`：架构层修复——overlay 挂到 `PD.body` 而非 `#sheld` 内 + `position: fixed`。不再参与任何 `#sheld` 滚动计算。
3. `ad9777d`：动态对齐 `#sheld` 尺寸（`getBoundingClientRect`）+ `resize` 同步，面板精确覆盖聊天窗口区域而非占满全屏。

### 最终效果

面板和聊天窗口在同一位置、同一尺寸，但在不同画布（`body` vs `#sheld`）。双滚轮从根本上不存在，下滑永远翻不开面板。

---

## v6.6-4 STM 分块默认值过大

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-06 |
| **解决** | 2026-07-07 |
| **严重程度** | Low |
| **影响** | `stmChunkMaxChars` 默认 4000（另有代码兜底 8000）与新的对数滑块 UI（100-10000）不匹配——默认值偏高，且两处默认不一致。 |

### 修复

5 处全部改为 500：`panel-settings.js` ×4（显示值/数字输入/滑块/保存回退）+ `stm-pipeline.js` ×1（管道兜底）。commit: `0f02516`

---

## 汇总 (vNext – v6.6)

| 编号 | 描述 | 严重度 | 状态 |
|---|---|---|---|
| vNext-1 | resolvePipelineApi 缺 template_assistant 通道路由 | **High** | ✅ 已解决 |
| vNext-2 | 审计 D/R 系列（DB 缓存/跨聊天缓存/模板回填） | 多项 | ✅ 已解决 |
| vNext-3 | 设置页控件 Shadow DOM 失效（裸 querySelectorAll） | Medium | ✅ 已解决 |
| vNext-4 | 初始化窗口期首轮消息漏记 | **High** | ✅ 已解决 |
| vNext-5 | 消息内假按钮不可点击（[文字] 纯文本误导） | Medium | ✅ 已解决 |
| vNext-6 | 手动编辑保存静默失败（writeState 无 catch） | **High** | ✅ 已解决 |
| vNext-7 | LTM 主行未转义（title/event/period） | Medium | ✅ 已解决 |
| vNext-8 | 确认弹窗 Promise 挂起（transitionend 依赖） | **High** | ✅ 已解决 |
| vNext-9 | 版本历史滑杆每事件落盘 | Low | ✅ 已解决 |
| vNext-10 | ResizeObserver 泄漏（close 不 disconnect） | Low | ✅ 已解决 |
| vNext-11 | 全局键盘导航重复绑定（init 双跑） | Low | ✅ 已解决 |
| vNext-12 | overlay 关闭监听累积（transitionend 永留） | Low | ✅ 已解决 |
| vNext-13 | 帮助卡片外部点击监听泄漏 | Low | ✅ 已解决 |
| vNext-14 | 确认弹窗 Esc 监听泄漏 | Low | ✅ 已解决 |
| vNext-15 | 自适应上下文空转死循环（P1-18，空记忆冻结主线程） | **High** | ✅ 已解决 |
| vNext-16 | STM 事件 partial 语义被覆盖（P1-17） | Medium | ✅ 已解决 |
| vNext-17 | present_characters 死代码 fallback（P1-16） | Low | ✅ 已解决 |
| vNext-18 | 歧义解析语义不一致（P1-15） | Medium | ✅ 已解决 |
| vNext-19 | vault 状态栏无数据（UIP-1 缓存回归） | **High** | ✅ 已解决 |
| vNext-20 | access 工具消息引用崩溃（P0-1，msgId 未声明） | **High** | ✅ 已解决 |
| vNext-21 | v6→v7 迁移空库永久挂起（P0-2） | **High** | ✅ 已解决 |
| vNext-22 | 队列 rejection 毒化后续任务跳过（P0-3） | **High** | ✅ 已解决 |
| vNext-23 | STM 校验系统性误报（P0-4，msgRange 窗口语义） | Medium | ✅ 已解决 |
| vNext-24 | orphaned_branches 死机制移除（P0-5） | Medium | ✅ 已解决 |
| vNext-25 | 原型链保留键 path 污染（P1-6） | **High** | ✅ 已解决 |
| vNext-26 | schema 校验缺口补全（P1-7） | **High** | ✅ 已解决 |
| vNext-27 | `__inc` 增量语法通用化（P1-8） | Medium | ✅ 已解决 |
| vNext-28 | token 相似度原型链误判（P1-10） | Medium | ✅ 已解决 |
| vNext-29 | SmartPush 注入次数伪统计（P1-11） | Low | ✅ 已解决 |
| vNext-30 | GC 漏 memory_vaults store（P1-12） | Medium | ✅ 已解决 |
| vNext-31 | 时间戳 NaN 输出"NaN 个月前"（P1-13） | Low | ✅ 已解决 |
| vNext-32 | 派系扫描大小写敏感（P1-14） | Medium | ✅ 已解决 |
| vNext-33 | 设置保存全量热更新（UIP-4） | Medium | ✅ 已解决 |
| vNext-34 | 设置页滑杆拖动卡顿（UIP-3） | Low | ✅ 已解决 |
| vNext-35 | 模板卡每卡重复读 localStorage（UIP-2） | Low | ✅ 已解决 |
| vNext-36 | 面板每轮全量重建（UIP-1） | **High** | ✅ 已解决 |
| vNext-37 | 移动端响应式失效（UIB-2，Shadow DOM） | Medium | ✅ 已解决 |
| vNext-38 | 面板样式 token 失效（UIB-1，style.css 未加载） | **High** | ✅ 已解决 |
| vNext-39 | 启动重复执行（UI-9） | Medium | ✅ 已解决 |
| vNext-40 | 编辑内容被刷新抹掉（UI-7） | **High** | ✅ 已解决 |
| vNext-41 | 自定义字段误存类型名（UI-4） | Medium | ✅ 已解决 |
| vNext-42 | 用量图表 State 序列断档（UI-3） | Low | ✅ 已解决 |
| vNext-43 | embedding 通道鉴权失效（UI-2） | **High** | ✅ 已解决 |
| vNext-44 | 设置保存必然报错（UI-1） | **High** | ✅ 已解决 |
| vNext-45 | 冒烟测试三项误判（smartpush-14） | Medium | ✅ 已解决 |
| vNext-46 | compact 折叠后回滚越界破坏版本链（P2-1） | **High** | ✅ 已解决 |
| vNext-47 | SmartPush 实体链链路恢复 | **High** | ✅ 已解决 |
| vNext-48 | 退化日期 msgId 漂移断链（P1-5） | **High** | ✅ 已解决 |
| vNext-49 | LLM 超时重试加剧延迟（P1-4） | Medium | ✅ 已解决 |
| vNext-50 | 小模型上下文压缩永不触发（P1-3） | Medium | ✅ 已解决 |
| vNext-51 | STM 事件映射全量错位（P1-2） | **High** | ✅ 已解决 |
| vNext-52 | 超长 segment 非首位置不拆分（P1-1） | **High** | ✅ 已解决 |
| vNext-53 | key-highlights 前置段无收益且方向性负（注入精简） | Low | ✅ 已解决 |
| v7.2-1 | chat-completion 拦截器稳定性（hook 目标/事件名/过滤） | **High** | ✅ 已解决 |
| v7.2-2 | import() URL 解析失败（origin null + Rollup 相对路径） | **High** | ✅ 已解决 |
| v7.1-1 | UI 与 Prompt 修正（版本导航方向/inventory chip/Prompt 字段默认值） | Medium | ✅ 已解决 |
| v7.1-2 | 模板字段生命周期（现有角色补字段/占位显示/克隆编辑） | Medium | ✅ 已解决 |
| v7.1-3 | 方案持久化与渲染（_scheme 未落盘/按默认模板渲染） | **High** | ✅ 已解决 |
| v7.1-4 | 自定义字段系统 5 处问题（库回退/选择器/写入断裂） | **High** | ✅ 已解决 |
| v7.0-1 | 事件总线竞态（侦听器注册在 await 前） | Medium | ✅ 已解决 |
| v7.0-2 | 版本导航按钮 Shadow DOM 查询失效 | Medium | ✅ 已解决 |
| v7.0-3 | 滚动位置不保存（innerHTML 重建） | Low | ✅ 已解决 |
| v7.0-4 | Embedding API 模型名校验缺失 | Medium | ✅ 已解决 |
| v7.0-5 | CORS 代理 URL 硬编码 | Medium | ✅ 已解决 |
| v7.0-6 | 首次打开面板不渲染（open class 时序） | **High** | ✅ 已解决 |
| v7.0-7 | Token 统计落"tok"不可见分类（7 操作） | Low | ✅ 已解决 |
| v7.0-8 | 重掷状态丢失 | **High** | ✅ 已解决 |
| v7.0-9 | 跨类型字段泄漏（State LLM 写专属字段） | **High** | ✅ 已解决 |
| v7.0-10 | 活跃角色默认状态缺失（全"非活跃"） | Medium | ✅ 已解决 |
| v7.0-11 | NE-CHAR 合并方向反转（新状态被默认值覆盖） | **High** | ✅ 已解决 |
| v7.0-12 | State LLM 漏轮（阈值 >2 → >=2） | Medium | ✅ 已解决 |
| v7.0-13 | 消息接收崩溃 v7.0 复现（computeWindowStartMsgId import） | **High** | ✅ 已解决 |
| v7.0-14 | DB 迁移数据丢失（重复迁移 + 异步属性未解包） | **High** | ✅ 已解决 |
| v7.0-15 | Firefox 面板不可见（:host(.open) 不生效） | **High** | ✅ 已解决 |
| v6.8-1 | State LLM max_tokens 触顶（2048→4096） | Medium | ✅ 已解决 |
| v6.8-2 | 快照恢复被覆盖（未同步 chat_metadata） | **High** | ✅ 已解决 |
| v6.8-3 | 消息接收崩溃（computeWindowStartMsgId import 缺失） | **High** | ✅ 已解决 |
| v6.7-1 | 对话轮次剪裁修复（splice → generate_interceptor 副本） | Medium | ✅ 已解决 |
| v6.7-2 | STM 编辑按钮缺失（孤儿/LTM 子行） | Low | ✅ 已解决 |
| v6.7-3 | 快照恢复错误吞噬 | Medium | ✅ 已解决 |

---

## 汇总 (v6.6 及之前)

| 编号 | 描述 | 严重度 | 状态 |
|---|---|---|---|
| v6.6-1 | Embedding API 输入框修改不保存（ID 双份冲突） | **High** | ✅ 已解决 |
| v6.6-2 | 设置面板副 API 保存崩溃（secApi 空值保护缺失） | **High** | ✅ 已解决 |
| v6.6-3 | 面板 overlay 分层（body 挂载 + bounds 同步） | **High** | ✅ 已解决 |
| v6.6-4 | STM 分块默认值 4000→500 | Low | ✅ 已解决 |
| 33 | STM 时间/场景无 Banner 时永远为 "-" | Medium | ✅ 已解决 |
| 26 | 设置面板全部控件不持久化 | **High** | ✅ 已解决 |
| 27 | 记忆编辑/删除不持久化（双重根因） | **High** | ✅ 已解决 |
| 28 | 处理历史按钮静默无反应（三重根因） | **High** | ✅ 已解决 |
| 29 | 手机端滑动关闭后页面卡死 | **High** | ✅ 已解决 |
| 30 | 面板 CSS 三重 Bug（双滚轮 / 下滑翻开 / 占满全屏） | **High** | ✅ 已解决 |
| 31 | 上下文窗口轮数控制死代码 | Medium | ✅ 已解决 |
| 32 | `getStmBatchSize` 未导出 | Medium | ✅ 已解决 |

---

# NE Memory Engine — Bug 追踪 (v6.3 及之前)

---

## #26 设置面板全部控件不持久化

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 所有滑块、复选框、文本域修改后关闭面板重开即恢复原值。 |

### 根因

`saveSettingsTab` 引用了渲染 HTML 中不存在的 DOM ID（`nes_enable_state_schema` / `nes_enable_retrieval`），`.checked` 抛 TypeError 导致整函数静默崩溃，`localStorage.setItem` 永远走不到。

### 修复

所有 `panelById` 访问改为空值安全 + 合理默认值。

---

## #27 记忆编辑/删除不持久化

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-06 |
| **严重程度** | **High** |
| **影响** | UI 中编辑或删除记忆后看起来保存成功，但关闭重开面板即恢复。 |

### 根因（双重）

1. IndexedDB 写入（`write()`）是 fire-and-forget，失败静默丢弃
2. `loadVault` 版本平局时 IndexedDB 与 `chat_metadata` 同版本，错误地用聊天文件旧数据覆盖 IndexedDB

### 修复

- `async/await write` + toast 错误提示
- `loadVault` 版本比较改为严格大于（`>`），平局时 IndexedDB 为真源并向聊天文件反向同步

---

## #28 处理历史按钮静默无反应

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 点击"处理历史"按钮后面板无任何变化，用户无法判断是否在工作。 |

### 根因（三重）

1. `collectAllMsgIds` 未 import → ReferenceError
2. `showConfirm` resolve 后到 `try` 块之间无错误捕获，异常作为未捕获 rejection 静默消失
3. `onProgress` 回调在 `executeIncrementalUpdate` 中从未被调用

### 修复

补齐 import、try/catch 扩展到全链路、stm-pipeline.js 开始/结束时调用 onProgress。

---

## #29 手机端滑动关闭后页面卡死

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 下滑手势关闭面板后页面完全卡死，面板钉在滑动位置。 |

### 根因

手势关闭后 inline `transform: translateY(movedY)` 未被清除，压住 CSS transition。

### 修复

`touchend` 中无条件先清除 `overlay.style.transform`。

---

## #30 面板 CSS 三重 Bug：双滚轮 + 下滑翻开无响应面板 + 面板占满全屏

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | 未打开面板时聊天窗口出现双滚动条；下滑聊天会翻出无法交互的面板。 |

### 根因

overlay 默认 `display: flex; position: absolute; inset: 0` 追加到主文档 `#sheld` 中。`#sheld` 有 `overflow: auto`，overlay 的布局盒参与其滚动区域计算导致双滚轮 + 被滚进视口。

### 修复

- 关态 CSS：`display: none`（无布局盒，不参与滚动）
- 开态 `.open`：`display: flex`
- `position: absolute`（保持与 ST 窗口对齐）

---

## #31 上下文窗口轮数控制死代码

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | Medium |
| **影响** | Dialog Window Rounds 设置从未生效，上下文窗口始终使用默认值。 |

### 根因

`computeWindowStartMsgId` 使用了不存在的 `mes_id` 字段名。

### 修复

字段名修正为实际属性名。

---

## #32 `getStmBatchSize` 未导出

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | Medium |

### 修复

从 `events.js` 补充导出。

---

## 汇总

| # | 描述 | 严重度 | 状态 |
|---|---|---|---|
| 26 | 设置面板全部控件不持久化 | **High** | ✅ 已解决 |
| 27 | 记忆编辑/删除不持久化（双重根因） | **High** | ✅ 已解决 |
| 28 | 处理历史按钮静默无反应（三重根因） | **High** | ✅ 已解决 |
| 29 | 手机端滑动关闭后页面卡死 | **High** | ✅ 已解决 |
| 30 | 面板 CSS 三重 Bug（双滚轮 / 下滑翻开 / 占满全屏） | **High** | ✅ 已解决 |
| 31 | 上下文窗口轮数控制死代码 | Medium | ✅ 已解决 |
| 32 | `getStmBatchSize` 未导出 | Medium | ✅ 已解决 |

---

# NE Memory Engine — Bug 追踪 (v6.3 及之前)

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

## #14 🟡 Pipeline 零产出死循环：`return []` 合约破坏 + `added>0` 跳过保存

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-16（用户报告）→ 2026-06-17（根因定位） |
| **严重程度** | **P0** |
| **影响** | 用户 152 条消息（76 轮对话），面板始终空白。Process History 显示"Completed (10 轮)"，但记忆仍为空。Pipeline 每 12 条消息触发一次，共 ~6 次，每次 LLM 调用成功（或返回空事件），每次零产出，每次 vault 不保存，每次下轮重新扫描——死循环。 |

### 用户报告实录

- 导入 test4.0，副 API 已连 → 聊了 76 轮，记忆从未更新
- 点击「处理历史」→ 显示 "10 轮" → 仍空白
- maxContext 开满

### 完整根因链

**第 1 环：`runStmExtractorCore` 5 处 `return []` 违反下游合约**

[stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/engine/stm-extractor.js) 有 5 个退出点直接 `return []`：

| 行号 | 触发条件 | 类型 |
|------|---------|------|
| L45 | LLM 调用抛异常 | 异常 |
| L50 | LLM 返回空响应 | 异常 |
| L78 | JSON 解析失败 | 常规（不同模型） |
| **L107** | **JSON 解析成功但 `turns` 正则不匹配** | **常规** |
| L132 | 所有事件 msg_ids 为空 | 边缘 |

下游 `processTurnsInBatches` 期望返回 `{ vault, totalAdded }` 对象。`[]` 没有 `.totalAdded` → `undefined` → `0`。

**第 2 环：`added > 0` 才保存 vault → 消息永不被标记**

[update.js L1000](file:///d:/SillyTavern/xm/ne-memory/src/engine/update.js#L1000)：

```javascript
if (cursorResult.totalAdded > 0) {
    vault._meta.last_pipeline_task = 'stm_extract';
    vault._meta.last_pipeline_time = new Date().toISOString();
    try { await saveVaultWithSnapshot(chatId, vault); } catch (e) {...}
}
```

`added === 0` 跳过保存 → `collectAllMsgIds` 下次返回空 Set → `filterNewMessages` 认为所有消息"未处理" → 重新送入 LLM → 再次零产出 → 永不保存。

**第 3 环：pendingMessages 已消费，无法回退**

`flushPendingMessages` L199 `pendingMessages.splice(0)` 消费了消息。如果 pipeline 返回时抛异常，inflight 备份可以恢复；但 pipeline "成功"返回了（只是 added=0），inflight 被 `finally` 清除 → 消息永久从 pending 中消失，又不在 vault 中。

**引入者：`a0088af`**（6 月 14 日），将旧版 fallback 占位条目改为直接 `return []`。

### Process History "10 轮"之谜

152 条消息 → `collectAllMsgIds` 命中 132 条 → 过滤后剩 20 条（10 轮）。
`collectAllMsgIds` 只读 `unconsolidated_stm` + `stm_entries`。面板空白 ≠ vault 空——旧 vault 的 STM 条目可能在 `stm_entries` 中（已 consolidate），但 `unconsolidated_stm` 和 `ltm_entries` 为空 → 面板两表皆空，但 msg_ids 仍有效。

### 修复方案

1. **stm-extractor.js**：5 处 `return []` → `return { vault, totalAdded: 0 }`
2. **stm-extractor.js**：`processTurnsInBatches` 多 batch 路径加 `(batchResult && batchResult.totalAdded) || 0` 判空
3. **update.js L1000**：移除 `if (added > 0)` 条件，零产出时也保存 vault（至少写 `_meta`）

---

## #15 ❌ Gemini 中转站副 API 401（用户侧配置错误，非 Bug）

| 属性 | 值 |
|---|---|
| **状态** | ❌ 已关闭（非 Bug） |
| **发现** | 2026-06-16 |
| **关闭** | 2026-06-17 |
| **严重程度** | — |
| **结论** | 401 = 用户填入的模型名 / URL / Key 不匹配中转站要求，属用户侧配置错误。 `callCustomAPI` 行为正常。 |

---

## #16 ✅ `processed_msg_ids` 毒化 vault —— pipeline 消息全部被过滤，STM 永久为 0

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-11 |
| **解决** | 2026-06-14 |
| **严重程度** | **High** |
| **影响** | vault 的 STM/LTM 被清空后 `processed_msg_ids` 残留。`filterNewMessages` 认为所有消息"已处理" → 全部过滤 → STM 永远不提取。 |

### 根因

`processed_msg_ids` 是独立于 STM 条目的缓存。删除条目清空了 STM 数组但缓存未同步清理 → 僵死状态。

### 修复（三阶段）

**阶段 1 — 自愈合** ([`3721091`](file:///))：
`executeIncrementalUpdate` 检测死信（filteredMessages 为 0 但 vault 无任何 STM/LTM 且 processedIds > 0）→ 自动清除 `processed_msg_ids` 并重试过滤。

**阶段 2 — 对账** ([`31b7cfd`](file:///))：
入口处与 `collectAllMsgIds` 对账，已删条目的 msg_id 踢出；`deleteSingleEntry` 同步清理 `stm_entries` 防止残留。

**阶段 3 — 彻底删除缓存** ([`14001d0`](file:///))：
删除 `processed_msg_ids` 及其 5 个维护函数。统一以 STM 条目自身的 `msg_ids` 为唯一事实源 —— `collectAllMsgIds` 在每次 pipeline 入口实时扫描。

### commit

`3721091` `31b7cfd` `14001d0`

---

## #17 ✅ `||` 运算符吞 `msg_id=0` —— 消息 0 永远穿透去重

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-14 |
| **严重程度** | **High** |
| **影响** | ST 消息 id 从 0 开始。`id || mes_id` 将 `id=0` 判为 falsy 跳到 `mes_id`。两侧（写入/过滤）产生不同的 fallback 键值，互不认识 → msg 0 永远无法被去重。 |

### 根因

JavaScript `||` 把 `0` 当 falsy。`collectMsgIdsFromTurns` 写入 `'msg_user_0'`，但 `filterNewMessages` 过滤侧返回 `undefined` → 永远放行。

### 修复

- [`e693bcd`](file:///)：`id != null ? id : mes_id` 替代 `id || mes_id`
- [`1f22acd`](file:///)：全系统 7 处 `id || mes_id` → `id != null ? id : mes_id`（vault-panel.js `visibleWindow` / `saveSingleEntry`、tools.js `access()`、index.js 指纹、retrieval.js 标签）

### commit

`e693bcd` `1f22acd`

---

## #18 ✅ ST chatId 始终为 `'default'` —— 对话切换不识别

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-13 |
| **严重程度** | **High** |
| **影响** | ST 的"新建聊天"不生成唯一 chatId → 所有对话共享 `'default'` vault。`neSyncChatId` 因 `default === default` 跳过重置，新旧对话数据串在一起。 |

### 修复

- `getChatId()`：chatId 为 `'default'` 时用 `getChatFingerprint(ctx)` 生成稳定指纹（`ne_<characterId>_<firstMsgId>`）
- 空对话回退 localStorage 缓存
- `migrateVaultIfNeeded`：自动将旧的 `'default'` vault 迁移到新指纹
- `chat_id_changed` / `CHAT_CHANGED` 事件中加迁移调用

### commit

`d54b893`

---

## #19 ✅ SmartPush 四项修复

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-15 |
| **解决** | 2026-06-15 |
| **严重程度** | **High** |
| **影响** | 四项独立 bug 共同导致 SmartPush 注入质量差、用户感知不到记忆。 |

### Bug 1：Consolidation 延迟

STM 提取后 LTM 不立刻整合 —— 需等下一轮 pipeline 才触发。修复：`flushPendingMessages` 提取后加 post-extraction consolidation check，同轮完成整合。

### Bug 2：stmCount 误报 0

`retrieval.js` 两处计数只看 `stm_entries`，忽略了 `unconsolidated_stm`。修复：改为 `unconsolidated_stm.concat(stm_entries).length` 全量统计。

### Bug 3：合成内容截断

中英文 prompt 中含"回复控制在 X tokens 以内"自估 soft budget 指令，LLM 自估不准导致内容被截。修复：删除 soft budget 指令。

### Bug 4：`stm_` 前缀泄漏

检索 prompt 中 STM 条目带有内部 ID（`stm_42`），被复制进合成注入文本。修复：规则 5 加"不要包含内部 ID"；`formatSmartContext` 输出加 `replace(/(stm_|ltm_)\d+/g, '')`。

### commit

`504a0a6`

---

## #20 ✅ 格式化标签泄漏 —— driver 输入 / chat 消息被污染

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-13 |
| **严重程度** | Medium |
| **影响** | AI 回复中的 `<content>`、`<Time>`、`[思考过程]` 等格式标签被 driver 模仿并发送到 chat 作为玩家消息，污染测试数据。 |

### 修复

两层过滤：
- **入口**：`buildDriverUser` 传给 driver 的 AI 回复先过 `cleanAiReply()` 去除格式标签和思考链
- **出口**：`extractUserMessage` 发送到 chat 的消息先过 `stripFormatTags()` 二次过滤

### commit

`5e289dd`

---

## #21 ✅ Settings 面板无法滚轮滚动

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-15 |
| **解决** | 2026-06-15 |
| **严重程度** | Medium |
| **影响** | Settings tab 内容多时无法鼠标滚轮滚动，只能拖滚动条。 |

### 根因

`.ne-settings-scroll` 有 `overflow-y:auto` 但无 `height` 约束 → 内容不溢出 → 无法滚内部；同时截获 wheel 事件阻止传到父级 `.ne-vault-scroll-area`。

### 修复

删除 `overflow-y:auto`，让父级 `.flex:1 + overflow-y:auto` 的 scroll-area 统一处理所有 tab 滚动。

### commit

`18bc38d`

---

## #22 ✅ 消息去重击穿 —— 三联动缺陷导致跨 run 重复处理

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-13 |
| **严重程度** | **High** |
| **影响** | 同一批消息跨 run 被反复送入 pipeline，产生重复 STM。 |

### 三个根因

**（A）fallback ID 不一致** ([`3e153c8`](file:///))：
消息缺 `id`/`mes_id` 时，`filterNewMessages`（过滤侧）永远 `return true`（放行），而 `collectMsgIdsFromTurns`（写入侧）用 batch-relative `turnIndex` 生成 `'msg_user_0'`。两端互不认识 → 已标记的消息无法被过滤。

**（B）`_absIdx` 跨 run 重叠** ([`265a2fc`](file:///))：
Process History 预过滤后传入 `executeIncrementalUpdate` 的消息已不是原始 batch，`_absIdx` 用 for 循环 `mi` 重新从 0 计数 → 与之前 run 的 `_absIdx` 值重叠。修复：改用 `m.id`（原始 chat 数组下标 / ST messageIndex），跨 run 不变的真正绝对位置。

**（C）`force=true` 时 prompt 矛盾** ([`a85e031`](file:///))：
system prompt 说"覆盖全部消息不得跳过"，user prompt 说"如果没有重要事件返回 `[]`"。LLM 取中 → 跳过 Turn 0。修复：force 时 user ending 改为"所有消息均须覆盖禁止跳过"。

### commit

`3e153c8` `265a2fc` `a85e031`

---

## #23 ✅ STM 条目排序错误 + msgRange 位置显示误导

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-12 |
| **解决** | 2026-06-12 |
| **严重程度** | Medium |
| **影响** | Memory tab 中 STM 条目按 LLM 调用顺序排列（生成顺序）而非对话顺序；entry 的 `msgRange` 显示 batch-relative 位置，跨 run 误导。 |

### 修复

- [`f079ad8`](file:///)：新增 `sortStmByMsgOrder()`，六处渲染点接入（vault panel、retrieval、notebook 等）
- [`2905959`](file:///)：`msgRange` 从 batch-relative → 绝对消息位置

### commit

`f079ad8` `2905959`

---

## #24 ✅ test-runner 全面审计 —— 6 类缺陷

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-06-13 |
| **解决** | 2026-06-14 |
| **严重程度** | Medium |
| **影响** | 测试结果不可靠：断言误报通过、长测试提前终止、语义评估永远 false、Blob URL 泄漏。 |

### 修复

| 缺陷 | 修复 |
|------|------|
| `exists` 断言逻辑反转 → 永远 false | 修正比较语义 |
| `forced_max_rounds` 时 `semanticResults` 为 null → 崩溃 | 加 `\|\| []` 空数组保护 |
| 语义评估提前结束（TC-05 来不及二次触发） | 要求 `round >= minRounds + 3` 才允许 `natural_done` |
| 策略提示不适应长测试 | 分轮次给出第二次提问引导 |
| 结构断言失败提前终止 → 一条失败后面全跳过 | 改为继续跑 |
| Blob URL 泄漏 | 5 秒后 revoke |

### commit

`9fa09bd` `cc7e23d` `50692ba`

---

## #25 ✅ test-runner "No textarea" —— `hostDoc` 指向 iframe 文档而非主页面

| 属性 | 值 |
|---|---|
| **状态** | ✅ 已解决 |
| **发现** | 2026-07-05 |
| **解决** | 2026-07-05 |
| **严重程度** | **High** |
| **影响** | script 模式（IIFE 构建）下 test-runner 无法发送消息，报 `Error: No textarea`。Extension 模式不受影响。 |

### 根因

`_buildDebugApi()` 中 `hostDoc = document`。script 模式下代码通过 `<script>` 标签注入 iframe，`document` 指向 iframe 的文档，而 `send_textarea` 在 `window.parent.document`（ST 主页面文档）中。

项目中 `panel-shared.js` 等其他模块已正确通过 `window.__NE_EXTENSION_MODE ? document : window.parent.document` 解析，但 `_buildDebugApi` 遗漏了此逻辑。

### 修复

```diff
- var hostDoc = document;
+ var hostDoc = window.__NE_EXTENSION_MODE ? document : (window.parent && window.parent !== window ? window.parent.document : document);
```

### 影响范围

| 流程 | 之前 | 修复后 |
|---|---|---|
| **test-runner（script 模式）** | ❌ `No textarea` 崩溃 | ✅ 正常 |
| **test-runner（extension 模式）** | ✅ 正常（未受影响） | ✅ 正常 |
| **seedAndWait / runQuery（script 模式）** | ❌ 同样有 bug | ✅ 正常 |

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
| 14 | Pipeline 零产出死循环：`return []` 合约破坏 + `added > 0` 跳过保存 | **P0** | ✅ 已解决 |
| 15 | Gemini 中转站副 API 401（用户侧配置错误） | — | ❌ 非 Bug |
| 16 | `processed_msg_ids` 毒化 vault → pipeline 消息全部被过滤 | **High** | ✅ 已解决 |
| 17 | `\|\|` 吞 `msg_id=0` → 消息 0 永远穿透去重 | **High** | ✅ 已解决 |
| 18 | ST chatId 始终为 `'default'` → 对话切换不识别 | **High** | ✅ 已解决 |
| 19 | SmartPush 四项修复（Consolidation 延迟 / stmCount / 合成截断 / stm_ 泄漏） | **High** | ✅ 已解决 |
| 20 | 格式化标签泄漏（driver 输入 / chat 消息） | Medium | ✅ 已解决 |
| 21 | Settings 面板无法滚轮滚动 | Medium | ✅ 已解决 |
| 22 | 消息去重击穿（fallback ID 不一致 + `_absIdx` 重叠 + force prompt 矛盾） | **High** | ✅ 已解决 |
| 23 | STM 条目排序错误 + msgRange 位置误导 | Medium | ✅ 已解决 |
| 24 | test-runner 6 类缺陷（exists 断言反转 / null 崩溃 / 提前终止 / Blob 泄漏） | Medium | ✅ 已解决 |
| 25 | test-runner "No textarea" — `hostDoc` 指向 iframe 文档而非主页面 | **High** | ✅ 已解决 |
