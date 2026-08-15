# SP·数据库 VII（shujuku）可参考项分析 → NE

> 来源：2026-08-15 ~ 2026-08-16 会话。基于 shujuku-latest（test31.3, 2026-08-12, SP·数据库 VII）的 CODE_WIKI.md 分析，
> 筛选出对 NE 项目有参考价值的架构点，逐项讨论采纳/排除。
> shujuku 版本分析详见 `d:\SillyTavern\xm\shujuku-latest\CODE_WIKI.md`。

## 1. 参考项总览

清单来源：shujuku CODE_WIKI.md §13.2（10 项新功能）+ §13.3（7 项架构改进），
与 NE 场景相关性筛选后归并为 13 项。

### 1.1 新功能类

| # | 参考项 | shujuku 中的实现 | NE 决策 | 状态 |
|---|--------|------------------|---------|------|
| 1 | V2 存储框架（原子事务写入 + V2 提交模型强制） | Mutation Log + Checkpoint + Write Transaction，单事务提交 vault/delta/chain | **部分采纳**（见 §2） | ✅ 已实施 |
| 2 | V2 恢复服务 | `table-v2-recovery-service.ts`，从 `recoveryBackup` 重建存储帧 | **轻量采纳**（见 §3） | ✅ 已实施 |
| 3 | 混合存储决策系统 | mixed-storage 系列 7 个文件，自动选择最佳存储策略（SQLite/原生） | **轻量采纳**（见 §5） | ✅ 已实施 |
| 4 | 严格 JSON 填表 | JSON Schema 约束 AI 响应格式（`table_edit_ops_v1` / `table_edit_sql_v1`），减少解析失败 | **轻量采纳**（见 §6） | ✅ 已实施 |
| 5 | Schema 迁移系统 | `schema-migration-preflight/planner` 预检规划 + `table-schema-migration` 执行 | **轻量采纳**（见 §7） | ✅ 已实施 |
| 6 | 模板种子污染诊断 | 检测和迁移模板数据中的种子污染（`template-seed-pollution-diagnostics/migration`） | **轻量采纳**（见 §8） | ✅ 已实施 |
| 7 | Agent 世界书接管 | `pre_takeover` 视图恢复条目先前状态、`agentGreenlights` 绿灯允许列表、签名快照 | **排除**（见 §9） | ❌ 不采用 |
| 8 | 严格世界书读取 | 可中断、作用域感知、每书缓存的世界书读取器；`notFoundPolicy: 'fail' | 'isolate_stale'` 过期隔离 | **排除**（见 §10） | ❌ 不采用 |
| 9 | AI 改表助手 | 对话式 AI 助手，伪 role 模板，一问一答模式（`AssistantPromptDrawer.vue`） | **重设计采纳**（见 §11） | ✅ 已实施 |
| 10 | 飞行模式 | 会话级纪要表→大总结表切换，控制上下文窗口占用（隐藏仅作运行时投影，不影响 replay） | **排除**（见 §12） | ❌ 不采用 |

### 1.2 架构改进类

| # | 参考项 | shujuku 中的实现 | NE 决策 | 状态 |
|---|--------|------------------|---------|------|
| 11 | 多槽生成门控 | `activeGenerations` 栈替代单一 `lastGeneration`，TTL 清理 + 栈配对消费 | **排除**（见 §13） | ❌ 不采用 |
| 12 | 跨 checkpoint 分阶段提交协议 | 跨 full checkpoint 的统一分阶段提交 | 待讨论 | ⏳ |
| 13 | 性能优化 | replay 惰性 hydrate、多 boundary 一次前向 replay、受控主线程让步(yield)、post-save 收敛 | **排除**（见 §4） | ❌ 不采用 |

### 1.3 明确排除项

| 参考项 | shujuku 中的实现 | 排除理由 |
|--------|------------------|---------|
| **有损压缩**（飞行模式的深度压缩部分） | 会话级纪要表→大总结表切换，压缩上下文占用 | NE 不接受任何有损压缩方案。深度压缩丢失原始信息，与 NE 的「版本链可回滚、delta 可追溯」设计目标冲突 |
| WASM base64 内联 | `scripts/sql-wasm-assets.mjs`，sql-wasm 单文件分发，修复 CDN 404 | shujuku 特有（SQLite WASM 分发问题）；NE 不使用 sql.js |
| 存储桥接增强 | 插件模式快速路径 + IndexedDB 配置缓存三级降级 | shujuku 特有（油猴/插件双模式桥接）；NE 为纯插件，无此问题 |
| UI 入口收敛 | V1 UI 入口收敛至 V2 | shujuku 双 UI 并存期的收尾工作；NE 无历史 UI 包袱 |
| 拼音表名降级 | 表名冲突时自动降级为拼音（`pinyin-pro` 依赖） | shujuku 特有（中文表名→SQL 标识符冲突）；NE 无 SQL 表名场景 |

---

## 2. 第 1 项：V2 存储框架（已实施）

### 2.1 shujuku 的 V2 存储帧能力

| 能力 | 说明 |
|------|------|
| Mutation Log | 记录每次写操作的增量日志 |
| Checkpoint | 定期生成全量快照，支持 `forceCheckpoint` / `checkpointReason` |
| Write Transaction | 事务 ACID 保证，`assumeCommitLock` 委托模式 |
| Conflict Detection | `revisionWriteSet` 写入冲突检测 |
| Canonical Snapshot | 规范快照信封，确保数据一致性 |
| Recovery Service | 从 `recoveryBackup` 重建（归入第 2 项） |

### 2.2 NE 改造前的现状与差距

NE 使用 IndexedDB + delta 版本链（`state_deltas` / `memory_versions` / `active_chains`），
管线产出记录 160B~1.5KB delta 而非全量拷贝 vault。对比 shujuku 方案后发现三个差距：

1. **vault 内容与版本链写入非原子**：`store.js` 先写 vault、再由 `state-versions.js`
   单独写 delta/chain，两次独立事务之间存在不同步窗口（中途崩溃/异常 → vault 与链脱节）。
2. **compact 缺少 checkpoint_reason**：折叠时不知道是自动阈值触发还是手动触发，诊断困难。
3. **active_chains 的 read-modify-write 无保护**：跨事务先 get 再 put，并发管线同时
   更新链时会丢失更新（lost update）。

### 2.3 采纳决策

**采纳**（适配到 IndexedDB）：

- ✅ **单事务原子写入**：vault 内容 + delta/version 记录 + chain 更新合并进同一个
  `readwrite` 事务；chain 的读取也收进同一事务（IndexedDB 事务独占锁天然杜绝竞态，
  不需要 shujuku 的 `assumeCommitLock`）。
- ✅ **checkpoint_reason**：compact 时记录 `'auto_threshold'` 或手动触发原因。

**不采纳**（shujuku 特有，对 NE 无收益或过重）：

| 特性 | 不采纳理由 |
|------|-----------|
| Mutation Log | NE 的 delta 版本链本身就是轻量等价物，再加一层日志冗余 |
| revisionWriteSet | 为 SQL 多写者冲突检测设计；NE 单事务独占锁已覆盖 |
| assumeCommitLock | 同上，IndexedDB 原生事务语义即可 |
| strictSave | shujuku 的提交校验门控，NE 原子事务已保证一致性 |
| forceCheckpoint | NE 的 compact 由版本数阈值自动触发即可，无需强制快照入口 |

### 2.4 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 消除 vault/链不同步风险；消除 chain 并发丢更新；checkpoint_reason 提升可诊断性 |
| 成本 | 写入延迟略增（单事务串行化）；原子写函数复杂度高于两段式写入 |
| 兼容性 | 数据结构不变（state_deltas/memory_versions/active_chains schema 原样），旧数据无需迁移 |

### 2.5 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/vault/state-versions.js` | 新增 `writeStateWithDelta` / `writeMemoryWithVersion`：vault + delta/version + chain 同事务原子写，chain 读取在事务回调内完成；`compact` 增加 `checkpoint_reason` |
| `src/core/engine/pipeline-shared.js` | `saveStateVault(chatId, vault, deltaData?)` / `saveMemoryVault(chatId, vault, versionData?)` 增加可选增量参数，走原子写路径 |
| `src/adapter/events.js` | LTM 巩固：保存前基于内存中已变更 vault 计算 `pendingLtmVersion`（stm_moved/ltm_added/ltm_modified + message_dates + derived_from_stm_version），与 vault 保存合并为单事务 |
| `src/core/engine/state-pipeline.js` | State 保存切换到 `saveStateVault` + deltaData 原子路径 |
| `src/core/engine/stm-pipeline.js` | Memory 保存切换到 `saveMemoryVault` + versionData 原子路径 |
| `src/core/vault/store.js` | 导出 store 常量供 `state-versions.js` 组事务使用 |

版本链超限时的 auto-compact 在事务 `oncomplete` 后异步触发（不阻塞主写入），
失败仅 warn 不回滚。

---

## 3. 第 2 项：V2 恢复服务（已讨论，轻量采纳）

### 3.1 shujuku 为什么需要它

shujuku 的恢复服务（`table-v2-recovery-service.ts`，618 行）诊断 5 类帧损坏并生成恢复计划：
双 full checkpoint、checkpoint 数据审计失败、孤立 data_replace、replay 依赖临时补锚、空信封。
根因是三点叠加：

1. 数据存聊天消息里，写入经宿主 `saveChatToHostStrict`，**无法事务化**——半写状态可能落盘
2. V2 帧结构复杂（checkpoint + logEntries + perSheetCheckpoints + manualRefillProgress），
   不变量多，历史 bug 留下多种违约形态
3. **replay 是读取的唯一路径** → 帧坏了 = 当前状态不可用 = 必须恢复，没有退路

### 3.2 NE 为什么不需要移植，只吸收流程原则

| shujuku 根因 | NE 现状 |
|-------------|---------|
| 写入无法事务化 | IndexedDB 原生 ACID + 第 1 项原子写改造 |
| 帧结构复杂、不变量多 | 物化 vault + 平铺 delta 列表 + 单条 chain 记录，不变量极少 |
| replay 是唯一读取路径 | **chain 坏了 vault 照常可用**——chain 只是历史索引，当前状态不依赖它 |

NE 已有自己的「recoveryBackup」等价物且形态更优：`auto-restore.js` 的双存储冗余
（vault 同时写聊天文件 `chat_metadata.ne_vault` + IndexedDB，互为兜底自动回填）——
shujuku 的空信封场景在 NE 天然不存在。

**NE 的真实残余风险**（移植动机）：

1. 原子化改造**之前**的历史数据：旧两段式写入中途失败 → chain 引用不存在的 delta（悬空引用）
2. **fold 静默跳过**：`foldState`/`foldMemory` 遇缺失 delta `continue` 跳过——
   回滚结果会无声丢数据，且无任何告警
3. **`archived` 死锁**：回滚被 `evaluateRollbackTarget` 拒绝时，用户无法区分
   「正常折叠归档」与「链损坏」，也没有修复出口

### 3.3 采纳决策

**不移植**数据恢复逻辑（修数据的场景不存在），**吸收三条流程原则**落地为轻量链体检：

| shujuku 原则 | NE 落地 |
|--------------|---------|
| 诊断/计划/确认分离 | `diagnoseChainConsistency`（只读）→ UI confirm → `repairChainConservative` / `removeOrphanVersionRecords` |
| 拒绝猜测 | 保守修复只**截断到第一个悬空 seq（保留连续前缀）**，绝不推测/重建内容；无 chain 记录时拒绝删除孤儿 |
| 修复留证据 | 修复前原链完整快照写入 `chain._pre_repair_backup`（+ console.warn），对应 recoveryBackup 的轻量等价物 |

关键设计点：
- **修复=只修索引**：单 readwrite 事务只写 active_chains，vault / delta / version 内容零触碰
- **seq 0 哨兵豁免**：新链 `state_active:[0]` 但 seq 0 永无记录，不计悬空（否则新对话全部误报）
- **前缀截断而非过滤**：fold 按 active 数组顺序迭代，过滤保留会留下中段洞
- **`_global_*_seq` 不回退**：防止新记录 id 复用
- **orphans ≠ broken**：孤儿只报告计数不影响 status，删除单独确认（删除类操作强制 confirm）
- **手动触发**：设置 → 数据 → 版本链体检；回滚被拒（archived）时 toastr 文案引导

### 3.4 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 清理原子化前的历史债务；给 fold 静默丢数据一个发现手段；给 `archived` 死锁修复出口；gc bug 安全网 |
| 成本 | ~200 行（2 纯函数 + 3 异步封装 + UI handler）；无常态运行时开销（手动触发） |
| 风险 | 误修——由保守策略控制（只截断不推测、删除双确认、修复留备份） |

### 3.5 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/vault/state-versions.js` | 纯函数 `diagnoseChainRefs` / `computeConservativeRepair`；异步封装 `diagnoseChainConsistency`（双链只读体检）/ `repairChainConservative`（截断 + `_pre_repair_backup` 证据）/ `removeOrphanVersionRecords`（单事务删孤儿） |
| `src/adapter/panel-settings.js` | Data 卡片新增「版本链体检」按钮：体检 → broken 时 confirm 修复 → 孤儿 confirm 删除 → 复检确认 ok |
| `src/adapter/events.js` | `_rollbackOrWarn` 的 archived 警告文案追加体检引导 |
| `test/state-versions-chain-check.test.js` | 37 用例：哨兵豁免 / 尾部·中段悬空 / 孤儿 / head 归位 / 前缀截断语义 / undefined 防御 |

---

## 4. 第 13 项：性能优化（已讨论，排除）

### 4.1 shujuku 的问题根源：读取 = 主线程同步 replay

shujuku 的表数据存在聊天消息里的 V2 存储帧（mutation log + checkpoint），**没有「当前状态」的直接存储**。
要拿到当前表状态必须 replay：从最近 full checkpoint 起，把后续 mutation 逐条应用到 sql.js WASM
（同步、主线程、内存 SQLite）。这个 replay 在世界书注入、UI 刷新、merged refresh 的**热路径**上，
长对话下是几百毫秒级的主线程同步任务，直接卡 UI。

### 4.2 四项优化的具体做法

| 优化 | 具体做法 | 代码位置 |
|------|---------|---------|
| 惰性 hydrate（阶段 D） | replay 时不预物化所有表进 SQLite runtime，只物化被 `sql_sheet_batch` 实际命中的表（每 epoch 按需构建单张表） | `storage-frame-v2-replay.ts:1437-1453` |
| 多 boundary 一次前向 replay（阶段 H） | 多个消息位点需要快照时，从共享 checkpoint 一趟前向推进、每个命中点物化+深克隆，替代 N 次冷 replay。仅限共享同一起算 checkpoint + 只读路径 | `storage-frame-v2-replay.ts:189-211` |
| 受控主线程让步（阶段 I） | replay 循环按时间预算让步：累计超 `yieldBudgetMs` 才 yield 一次宏任务，未超时零开销；只在只读路径生效（副作用路径让步有半执行事务风险）；yield 窗口内响应 AbortSignal | `storage-frame-v2-replay.ts:2057-2075` |
| post-save 收敛（阶段 E） | 保存后刚算出的 authoritative canonical 结果直接作为 merged refresh 基底，跳过内部再从聊天完整 replay 一次 | `service/worldbook/pipeline.ts:585-598` |

另有阶段 G2：in-flight replay 去重——并发/紧邻的相同只读 replay 调用共享同一 Promise，settle 即删。

### 4.3 排除理由：NE 的问题面不存在

1. **NE 的读取是单键 get，没有 replay**。vault 是物化对象直接存 IndexedDB，读 = 一次
   `get(chat_id)`。版本链只在显式回滚时逐 delta 重放——罕见、用户主动、单目标
   （对应 shujuku 的多 boundary 场景不存在）。
2. **NE 管线异步、事后触发**（post-message pipeline），不在对话流路径上。
3. **主线程让步针对同步 CPU 长循环**（WASM replay），NE 无此形态——最重的同步操作是
   50-200KB vault 深拷贝/JSON 序列化，毫秒级。

四项中仅两个概念在 NE 有微弱影子，且已覆盖或价值极低：

| shujuku 概念 | NE 对应 | 判断 |
|--------------|---------|------|
| G2 in-flight 去重 | `pipeline-guard.js` 触发门控 | 概念已覆盖（守护对象不同：触发 vs 并发相同计算），无需改动 |
| post-save 收敛 | 同一调用链内保存后不重读刚算好的结果 | NE 的 readVault 是廉价单键读，即使有冗余重读成本也低，不值得立项 |

**结论：排除。不是「已优化过」，而是问题面不存在——四项优化全部为「同步主线程 WASM replay」
读取模型服务，NE 的读取模型（单键 get + 异步管线）没有这个问题。**

---

## 5. 第 3 项：混合存储决策系统（已讨论，轻量采纳）

### 5.1 shujuku 是怎么存储的

shujuku 的存储是**两个维度的组合**：

| 维度 | 取值 | 载体 |
|------|------|------|
| 后端（用户可选） | `native` / `sqlite` | 聊天消息 tagData / WASM SQLite |
| 帧格式（历史演进） | legacy V1 / V2 帧 | V1=平铺表格数据，V2=checkpoint+mutation log |

数据**全部嵌在聊天消息里**（每条 AI 楼层携带 tagData），写入经宿主 API，无事务保证。

**混合态是结构性必然产生的**（不需要用户犯错）：用户降级插件 → 旧版又写 V1；
迁移中途失败；聊天从备份恢复；消息被编辑/删除导致 V2 锚点断链。
`mixed-storage-decision.ts`（313 行）就是 V1→V2 迁移撞上混合态时的**仲裁器**：
采集两侧证据（消息位置、AI 楼层、sheet 覆盖度、provenance 校验、数据指纹）→ 裁决出
8 种 kind（3 blocked / 3 verified 等价 / 1 保守合并 / 1 冲突需用户选择）→ 冻结成不可变
决策记录入 registry → 允许动作仅 `keep_v2 / commit_merge_candidate / download_snapshots / noop`。
保守合并只**追加** legacy 有而 V2 没有的行，绝不猜内容。

### 5.2 收益是否确实存在

**对 shujuku：确实存在，是迁移生死线。** 没有它，V1→V2 迁移在混合态下只能静默覆盖（丢数据）
或拒绝迁移（用户卡死）。指纹对比 + 证据冻结让「哪边是权威」变成可审计判断而非赌博。
恢复服务 + 仲裁器本质都在为「数据存在不可事务化的用户文件里」还债。

### 5.3 NE 的存储与仲裁现状

| shujuku 混合态来源 | NE 现状 |
|---|---|
| 两代格式共存于同一聊天 | **只有一代格式**（delta 版本链），无 V1/V2 分裂 |
| 数据散布在消息里，锚点可被删 | vault 是**单份物化快照**，无锚点断链 |
| 无事务存储 | IndexedDB 原生事务（第 1 项已原子化） |
| 双后端数据可能分叉 | 双存储（IDB + 聊天文件）是**主从冗余**，不是双主 |

NE 的对位机制是 `loadVault`（auto-restore.js）的 **version 单调计数器 LWW**：
chat 版本高 → 聊天文件赢并恢复 IDB；IDB 高 → 回填聊天文件；等号 → 视为同步。
每次保存 version+1 同步写两侧，写入失败造成的滞后下一次加载自愈。

**唯一的真实残余风险**：**等版本·异内容盲区**。LWW 靠版本号，version 相等时内容分歧
被静默忽略（取 IDB 侧）。触发需要外部干预（两设备各自演进到同版本 / 手工拷贝聊天文件）。
多设备云端切换使用（用户确认存在此场景）会产生该分歧。

### 5.4 采纳决策

**排除决策仲裁器本体**（8 种裁决里 NE 有对应对的只有零星——无 provenance、无 checkpoint
收敛、无保守合并场景，移植是 90% 死代码）。

**轻量采纳 shujuku 的指纹对比思想** → `content_hash` 检测：

| shujuku 概念 | NE 落地 |
|--------------|---------|
| 数据指纹（`getTableDataFingerprint`） | `computeVaultContentHash`（FNV-1a 32bit，对合并 content 的 JSON.stringify 计算） |
| 指纹比对判定等价 | `loadVault` 等版本分支：chat 侧持久化 hash vs IDB 侧实时 hash 比对 |
| 决策冻结 + 用户确认 | 分歧 → 按持久化 `updated_at` 择新、`version+1` 打破僵局、同步两侧，`runtime.notify` 告警；绝不合并内容 |

关键设计点：
- **hash 只挂 chat 侧**：`persistVaultToChatFile` 内部统一挂载（覆盖全部 5 个调用点，调用方零改动）；
  IDB 侧不持久化 hash，检测时实时计算（load 路径本就全量读 vault）
- **时间戳用持久化值**：择新比较用 `readState`/`readMemory` 的持久化 `updated_at`（取较大者），
  **禁止用 `readVault` 的 `updated_at`**（store.js 强制覆盖为 now，每次读都变）
- **`version+1` 打破等版本僵局**：下轮加载两侧版本相等但 hash 一致 → 正常 in sync，不重复告警
- **不引入 key 排序规范化**：content 由固定 schema + 固定 `Object.assign` 顺序构造，直接 stringify 即可
- **旧数据无 hash → 自动降级**为现状（不检测），无迁移负担

### 5.5 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 消除等版本·异内容盲区（跨设备/备份场景可检测、可告警、自愈）；LWW 语义补全 |
| 成本 | ~45 行（hash 函数 + persist 挂载 + loadVault 检测分支 + 裁决函数）；hash 计算在保存/加载热路径的 O(n) 遍历（毫秒级，可忽略） |
| 风险 | 几乎无——检测只在等版本且两侧均有 hash 时触发；裁决仍是 LWW 择新，不引入合并 |

### 5.6 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/auto-restore.js` | 纯函数 `computeVaultContentHash`（FNV-1a 32bit）；`persistVaultToChatFile` 挂 `_meta.content_hash`；`loadVault` 等版本分支 hash 比对 + `_reconcileDivergence`（按持久化 updated_at 择新、version+1、同步两侧、runtime.notify 告警） |
| `test/vault-content-hash.test.js` | 10 用例：确定性 / 值敏感 / 结构敏感 / 空对象 / undefined / 中文 / 嵌套 / 大对象 |

---

## 6. 第 4 项：严格 JSON 填表（已讨论，轻量采纳）

### 6.1 shujuku 为什么专门有这一项

shujuku 的表格编辑发生在**主对话流内**——AI 回复正文直接携带 `<tableEdit>` 块（文本 DSL）：
`insertRow(0, {...})` / `updateRow(1, 2, {...})`。文本 DSL **没有模型端约束**，
`table-edit-parser.ts` 的 normalize 函数要兜格式漂移：JS 拼接字符串、中文冒号、
字面 `\n`、大小写混乱、指令写进 HTML 注释。**后果放大器**：填表在用户在场的对话流里
→ 解析失败 = 当轮编辑全部丢失（可见）；错误写入（字段 typo、错行定位）污染表格资产（更糟）。

### 6.2 shujuku 是怎么做的（strict-json-table-fill.ts）

| 层 | 做法 |
|---|---|
| 模型端约束 | `response_format: { type: 'json_schema', strict: true }`，输出 `{ format:'table_edit_ops_v1', ops:[…] }` |
| 动态 schema | 按当前表结构生成：每 sheet × 3 操作（insert/update/delete）= oneOf 分支，**字段名枚举进 schema**——typo 在模型端被禁止 |
| 复杂度降级 | sheet>8 / 字段>32 / schema>24KB 时降级为宽 schema（`additionalProperties:true`），靠事后校验兜底 |
| 严格校验语义 | 字段不存在→**整包拒绝**+retryHint；where 必须唯一匹配（0 行/多行都拒）；越权 sheet 拒绝 |

解析成功后**转回 DSL 文本**喂给既有管线——严格 JSON 只是前端交换格式，内部管线零改动。

### 6.3 NE 的填表与对照

NE 的 LLM 输出全部在**事后异步管线**，已有三条约束路线混合：
`json_object`（llm.js 默认）→ 5 级容错解析（json-fallback.js）→ 部分场景 Function Calling
（template-llm.js，含支持度探测降级）。失败后果：增量静默丢弃、下轮可补救、用户无感；
错误字段被应用侧校验过滤。**失败模型与 shujuku 完全不同**：
shujuku 是「用户可见的当轮资产丢失 + 半正确写入污染」，NE 是「静默可重试的增量丢失 + 错误字段被过滤」。

### 6.4 采纳决策

**主体排除 json_schema strict**：NE 输出结构固定（title/event/字段集），动态 oneOf schema 的
核心价值（按表结构枚举字段）无用武之地；json_schema 在用户自配 API 上兼容性低于 json_object，
反而引入现实风险。

**轻量采纳 shujuku 的失败可观测性思想** → JSON 解析分级遥测：

| shujuku 概念 | NE 落地 |
|--------------|---------|
| 结构化 error + retryHint | `recordJsonParseResult(level)` 分级计数（direct/code_block/balanced/trailing_comma/truncated/failed） |
| 失败诊断闭环 | `getJsonParseStats()` 暴露 5 级容错兜底率数据，供诊断/后续面板 |

### 6.5 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 5 级容错解析的兜底率可观测；异常 API/模型（大量 failed）可被发现 |
| 成本 | ~50 行纯计数模块（零依赖）+ safeJsonParse 6 处打点（不改解析逻辑）；受 enableTelemetry 开关控制，未启用零开销 |
| 风险 | 几乎无——纯旁路计数，返回值和行为完全不变 |

### 6.6 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/engine/json-parse-telemetry.js` | 新增纯计数模块：`recordJsonParseResult` / `getJsonParseStats` / `resetJsonParseStats` / `flushJsonParseStats`；内存计数 + 节流落盘 localStorage（`ne_json_parse_stats`）；受 enableTelemetry 开关控制；不记录内容（隐私最小化） |
| `src/core/engine/json-fallback.js` | `safeJsonParse` 6 处打点（各级成功 return 前 + 最终 failed）；返回值/行为不变 |
| `test/json-parse-telemetry.test.js` | 15 用例：开关控制 / 空输入不打点 / 各级成功计数 / 未闭合输入→failed / 深拷贝 / 返回值不受影响 |

---

## 7. 第 5 项：Schema 迁移系统（已讨论，轻量采纳）

### 7.1 shujuku 是从哪里迁移到哪里

**不是存储格式迁移**（那是 V1→V2 帧），而是**表格 schema 数据迁移**：
`baseline schema（旧 DDL+表头）→ candidate schema（新 DDL+表头）`，旧列布局的存量行数据
搬到新布局。**触发源**：用户（或 AI 改表助手）在可视化编辑器里直接改表结构——增列、删列、改列名。
表是用户核心资产，改结构后旧行数据必须无损跟随。

机制要点（table-schema-migration.ts / schema-migration-preflight.ts）：
- **身份协议**：DDL+表头 → schema descriptor → canonicalJson → **SHA-256 摘要**；迁移操作携带
  `beforeSchema`/`targetSchema` + 双方摘要，校验候选与目标一致才执行
- **两种执行模式**：`migration`（列级精确迁移，保留历史列值）vs `rebase`（planner 无法构造
  精确迁移时，以编辑器候选整表作为新边界快照）
- **破坏性守卫**：删列 → `DESTRUCTIVE_COLUMN_DROP_CONFIRMATION_REQUIRED`，列出将删列名 +
  受影响行数，必须显式确认

核心动机：**表是用户亲手填的资产，改 schema 必须无损搬数据**。

### 7.2 NE 有相同需求吗

**结构性错配**。NE 的 vault 是 JSON 对象，不是用户资产表；「表 schema」类比 NE 的角色/势力/
任务模板字段。逐点对照：

| 维度 | shujuku（需要迁移） | NE（现状） |
|------|---------------------|-----------|
| 数据所有者 | 用户亲手填的表 → 不可再生 | LLM 生成的 state → 可再生成 |
| 触发源 | 用户/AI 直接改表结构（高频） | 模板演进（低频） |
| 增字段 | 迁移 = 老行保留 + 新列补默认 | **已有**：ensureCharacterTemplate backfill 补默认值 |
| 删/改名字段 | 迁移 = 数据搬到新列 / 需确认 | 容忍：旧 key 留 vault 变孤儿，读旧数据不报错 |
| 改类型 | 迁移 = 列类型转换 | **写时校验**：validateField 拦截 LLM 类型错误写入，不迁移存量值 |

**结论：主体不需要**——数据可再生成（删了 LLM 下轮管线重填）、触发低频、已有 backfill 覆盖
增字段路径、已有 validateField 写时守卫。

### 7.3 采纳决策

**主体排除**列级精确迁移（NE 无「不可再生资产」前提，重放成本为零）。

**轻量采纳：孤儿字段裁剪**——模板删/改名后，旧 key 会永久残留（数据膨胀）。在
`ensureCharacterTemplate` 的 backfill 分支裁剪「不在当前模板字段集」的普通字段。

**实施修正（重要）**：初版实现只排除「模板字段 + 字段库 + 系统键」，导致 schema.test.js 10 个
回归——**预定义字段全集（ALL_PREDEFINED_FIELDS）必须加入排除集**。原因：mergeStateChanges 的
LLM 活跃写入路径对角色执行 ensureCharacterTemplate，而 LLM 的 `__inc` 增量语法依赖
「非当前角色模板的预定义字段」（如 affection 不在 DEFAULT_NPC presetFields，但 LLM 可对
`characters.X.affection` 做 `{ __inc: true, delta: 10 }` 增量）。裁剪预定义字段会破坏该核心契约。

最终保留集：**当前模板字段 + ALL_PREDEFINED_FIELDS + 字段库登记字段 + 系统键（`_` 前缀）**。
仅裁剪**纯孤儿**：LLM 幻觉字段、手工编辑残留、已从字段库删除的自定义字段。

### 7.4 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 纯孤儿字段（LLM 幻觉/手工残留）自动收敛，控制 vault 膨胀；模板演进后不再累积垃圾 key |
| 成本 | ~20 行 + 仅在有候选孤儿时才读字段库（常态零额外开销） |
| 风险 | 语义权衡：模板移除的预定义字段（如 affection）**保留**——为保护 LLM 增量契约，这是正确取舍 |

### 7.5 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/vault/schema.js` | `ensureCharacterTemplate` backfill 分支新增 D5 孤儿裁剪：候选孤儿（非模板字段、非预定义、非系统键）→ 读字段库 → 非登记字段删除并置 modified |
| `test/schema-prune.test.js` | 20 用例：孤儿裁剪 / 模板字段保留 / name/status 保留 / 系统键保留 / 字段库字段保留 / **预定义字段保留（__inc 依赖）** / 无孤儿时不动 / 新建角色不受影响 / NPC 路径 |

---

## 8. 第 6 项：模板种子污染诊断（已讨论，轻量采纳）

### 8.1 shujuku 的模板与「种子」

shujuku 的模板 = **一套表的定义 + 初始数据**（`TableDataObject`）：每个 sheet 含 `content`
（表头+数据行）、`sourceData.ddl`（含 UNIQUE 业务键）、`updateConfig`。同一份模板数据存在于
4 个池：global preset（全局预设库）、chat scope（聊天级快照）、sheet guide（空白指导表：
只留表头 + `seedRows` 种子行）、runtime（实际运行数据）。

**种子 = 模板自带的初始数据行**，设计为惰性物化：guide 只保留表头 + seedRows 空骨架，
新聊天首次使用时 `materializeDataFromSheetGuide` 把 seedRows 灌入 content 成为运行时数据。

### 8.2 「污染」是什么

**双池重复**——同一行数据在 content / seedRows / runtime 都有副本，且经多条物化路径，
历史 bug 产生四类问题：

| code | 含义 | 后果 |
|---|---|---|
| `content_seed_duplicate` | 模板 content 与 seedRows 同 UNIQUE 键 | 物化时双重灌入 → 同一角色出现两行 |
| `guide_seed_duplicate` | guide seedRows 与 runtime 同键 | 已物化但残留 seed，再次物化会重复 |
| `seed_row_id_conflict` | seedRows 内 row_id 重复 | 身份空间冲突，更新错乱 |
| `content_runtime_mismatch` | 模板与 runtime 不一致 | 数据来源歧义 |

处置：诊断纯只读扫四池（按 DDL UNIQUE 键建索引）；迁移走显式 prepare（计划+备份）→
commit（事务+严格保存+后置校验，失败回滚）→ rollback，语义 template-wins，global preset
只诊断不迁移。

### 8.3 NE 的对照与采纳决策

**种子污染问题面在 NE 不存在**：NE 的模板是字段级 schema 定义（type/max_length/enum），
不携带行数据；实体身份是 `characters` map 的 name key；没有「模板数据→runtime」双池物化路径。
NE 的等价问题面已覆盖：副本重复（模板副本去重）、残留字段（孤儿字段裁剪）、多池不一致
（双存储 content_hash 裁决）、引用完整性（版本链体检）。

**但调研中发现同本质的真实缺口**（跨存储引用不对称、随时间累积、阻塞正常操作）：
`deleteTemplate` 删除全局模板并级联孤儿化卡片副本，但**不清理字段库 `usedByTemplates` 引用**
（编辑路径有对称清 ref，整体删除路径漏了）。后果链：删除模板 → 字段库留悬挂 templateId →
`removeFieldFromLibrary` 见 `usedByTemplates.length > 0` 即拒绝 → **用户永远删不掉这个自定义字段**。

**不做独立体检 UI**（问题单点、判定廉价），用 ~40 行源头修补 + 惰性 guard 解决：

| 位置 | 改动 |
|------|------|
| `store.js` 新增 `templateIdExists` | 有效模板 id 全集 = 系统默认 ∪ 全局模板库 ∪ 所有卡片 `_dialogueTemplates` key；不在全集即悬挂 |
| `store.js` `removeFieldFromLibrary` | guard 改为惰性过滤：删字段时先清悬挂 ref（存量自动解锁），仅剩有效 ref > 0 才拒绝 |
| `store.js` `deleteTemplate`（含 override 分支）+ `deleteTemplateVersion` | 删除前按 `customFieldRefs` 对称清 ref（源头防新增悬挂） |

### 8.4 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 解除「字段被已删模板永久占用」的删除阻塞；字段库引用对称性修复；存量悬挂数据自愈 |
| 成本 | ~40 行 + 36 用例测试；`templateIdExists` 扫 localStorage 仅在删字段/判悬挂时触发（低频） |
| 风险 | 几乎无——清 ref 对不存在的 entry 自动跳过；保护语义不变（仍有有效引用时照样拒绝删除） |

### 8.5 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/vault/store.js` | `templateIdExists` 存在性校验；`removeFieldFromLibrary` 惰性过滤悬挂 ref；`deleteTemplate` / `deleteTemplateVersion` 删除前清 customFieldRefs 对应的字段库 ref |
| `test/store-field-ref.test.js` | 36 用例：存在性校验 / 删除清 ref / 共享字段保护 / override 分支 / 存量解锁 / 混合 ref 清理 / 副本删除 |
| `test/store.test.js` | 保护语义断言更新为引用真实存在的模板（悬挂引用不再构成保护） |

---

## 9. 第 7 项：Agent 世界书接管（已讨论，排除）

### 9.1 shujuku 做了什么

ST 原生世界书是**关键词触发**：条目配 keys，ST 扫描最近聊天文本，命中 → 激活 → 注入。
shujuku 的剧情 Agent 系统认为关键词触发不够语义化，于是接管：

1. **接管（takeover）**：把候选世界书里所有条目的原生触发**物理禁用**（`disable=true`），
   ST 的关键词扫描从此永远无法激活它们。禁用前把每个条目的先前状态
   （enabled/keys/type）写进**签名快照**，持久化到条目 comment 字段的标记块 + 独立 state。
2. **绿灯（greenlights）**：每轮正文生成前，Agent LLM 读候选条目摘要元数据，**语义化决定**
   本轮激活哪些条目（输出 `bookName/uid + reason`），带 min/max Token 预算约束，
   绿灯条目临时启用参与注入。
3. **恢复（restore）**：生成后清绿灯；用户关闭接管时从快照还原所有条目先前状态。

围绕「物理改用户资产」配套了 1600+ 行防御工事：`pre_takeover` 只读视图、书单签名
（selectionSignature 变了快照即失效）、**快照写失败则阻止禁用**（宁可不做也不能无法恢复）、
pending/applied 状态机（恢复中断可重试）、stale 书隔离、legacy 快照迁移。

### 9.2 为什么它非物理改数据不可

两个设计选择推导出的结构性必然：

1. **Agent 要成为唯一决策者** → 必须让原生关键词触发失效。但 ST 没有「按书/按条目的
   运行时过滤器」API——唯一让扫描命不中的办法就是 `disable = true`。
2. **注入最后一公里复用 ST 原生管线**（绿灯 ≠ 自己注入，是临时启用条目借原生管线注入）
   → 条目的 position/depth/order/递归时机都是卡作者按条目配置的，ST 也没有「虚拟激活这批
   条目」的 API——想让原生管线注入你选的子集，唯一办法就是临时 `enable = true`。

即：**ST 的世界书 API 只有「读什么会被激活」（dryRun）和「改条目状态」两种，没有「替你决定
激活集」的第三种**。选了「Agent 决策 + ST 注入」的组合，物理写入就是必然。

替代路线都被否掉：全局关 World Info 会误伤接管范围外的书；不关只追加注入会双重注入
（唯一决策者前提破产）；自己模拟条目位置注入要重实现 position/depth/递归时序，跨版本脆弱。

那 1600 行防御工事不是过度设计，而是「物理改用户资产」这个选择的**强制保险**。

### 9.3 NE 的对照与排除理由

先澄清 NE 与世界书的实际关系：NE **只读世界书，从不写**。State LLM 管线通过
`getWorldInfoPrompt(dryRun)` 把已激活条目内容作为新角色字段提取的信息源
（读失败 fallback 到 raw entries）。NE 的混合检索（BM25+vector）作用于**记忆（vault）**，
与世界书是两个正交的通道——NE 的注入内容由 SmartPush 语义相关性选择，不经世界书条目。

| 维度 | shujuku 接管 | NE |
|---|---|---|
| 要解决的问题 | 关键词触发不语义化，想用 LLM 决定注入 | 注入走 SmartPush 混合检索，本来就是语义选择，问题面不存在 |
| 手段 | 物理禁用/启用**用户的世界书资产** | 只读宿主数据（dryRun），写自己的 vault（边界原则） |
| 每轮 LLM 决策成本 | 接受 | **已实测并放弃过**（在记忆检索上尝试每轮 LLM 检索，时延+token 不可接受） |

**排除理由**：
1. 需求不存在——「LLM 语义化选择注入内容」NE 已用混合检索实现，且作用在自己的记忆资产上
2. 产品判断相反——shujuku 认为语义收益 > 每轮 LLM 决策成本；NE 实测结论为反（时延/token）
3. 手段与 NE 哲学冲突——接管的全部复杂度都在为「物理修改用户资产后的可恢复性」服务，
   NE 的设计原则是永不物理修改宿主资产，这套复杂度对 NE 是负资产

**留一个未来选项**：若 NE 将来做 LLM 世界书选择（低频、缓存友好变体），write-free 路线是
现成的：dryRun 读候选 → LLM 选 → 自己的注入点注内容——代价只是丢失条目级
position/depth 保真，且不需要任何快照/恢复工事。

---

## 10. 第 8 项：严格世界书读取（已讨论，排除）

### 10.1 它是什么

可中断（AbortSignal）、作用域感知（只枚举角色绑定/手动选择的书）、每书缓存的世界书读取器；
`notFoundPolicy: 'fail' | 'isolate_stale'` 对已删除/改名书的过期隔离。

### 10.2 排除理由

它是第 7 项的**伴生基础设施**：shujuku 造它主要是给接管/绿灯做严格读写——接管要改条目、
绿灯每轮读写、恢复要校验快照，读写失败必须 fail-closed 或 stale 隔离，所以需要一套严格、
可中断、作用域精确的读取层。

第 7 项排除后，NE 对世界书的全部用法是 State LLM 管线里的一次 dryRun 只读（做新角色字段
提取的信息源）：
- 单次读取、不在对话流热路径（事后异步管线）
- 读失败已有 fallback（`getWorldInfoPrompt` 失败 → `collectWorldBookContent_raw`）
- 无写入 → 无 stale 隔离/fail-closed 需求

**结论：排除。** 它解决的问题（严格读写的容错语义）只在物理接管场景成立，NE 的只读
dryRun + fallback 已覆盖。

---

## 11. 第 9 项：AI 改表助手（已讨论，重设计采纳）

### 11.1 shujuku 的做法与用户旧版复盘

| 版本 | 做法 | 结果 |
|------|------|------|
| shujuku | 对话式 AI 助手 + 伪 role 模板 + `AssistantPromptDrawer.vue`，一问一答模式 | 依赖助手槽位与表格直接交互 |
| 用户旧版（封存） | **LLM 自动管线**：每轮读对话内容 → 自动改当前模板 | 管线不可靠（读对话理解偏、改错）+ 成本高（每轮都烧 token）→ 封存 |

用户旧版失败的根本点：把「改表」挂进**自动管线**，每轮都要 LLM 判断「该不该改、改什么」，不可靠且持续烧钱。
NE 重设计把这两点都拆掉——**手动触发**（成本可控）+ **目标态全量草稿**（可靠性从模型自觉转移到结构校验）。

### 11.2 重设计：手动触发的目标态草稿 Agent

三条设计原则（对应 `template-assistant.js` 头部注释）：

1. **LLM 只产草稿，永不下场改真数据**——可靠性靠校验结构，不靠模型自觉
2. **目标态全量输出（非增量操作）**——LLM 输出完整模板定义，编译器退化为纯校验 + 比对
3. **单轮会话 + 失败回喂修复重试（默认 ≤2 次）**——不做自动多轮

与 shujuku 的关键差异：NE 不引入「伪 role 模板 / 助手槽位」，也没有一问一答的持续会话；
是一个**独立的单次 Agent 调用**，产物经严格协议校验后由用户在 UI 上显式确认落盘。

### 11.3 协议与流程

```
UI 收集输入（制表 create / 改表 modify）
  ├─ 基线：create=scratch / default:pc / default:npc；modify=现有模板
  ├─ 需求文本（必填）
  ├─ 世界书设定（可选勾选，只读 collectWorldBookContent，截断 8K 字符）
  └─ 值分布（modify 自动携带，collectFieldValueSummary）
        ↓
fingerprint 计算（稳定序列化 + djb2 短哈希，'fp1_' 前缀）
  ├─ create：基线标记字符串原样传（'scratch'/'default:pc'/'default:npc'）
  └─ modify：buildTemplateFingerprint(baseline)
        ↓
buildAssistantMessages 上下文组装（system 字段规范+输出协议 / user 基线+目录+值分布+世界书+需求）
        ↓
上下文预算门禁（48K 字符）→ 超限硬失败（failureKind='context_budget'），不静默截断
        ↓
callMemoryLLM（operation='template_assistant' → ne_template_api 独立通道，temperature 0.4）
        ↓
parse → validate（fingerprint 回显 / protocolVersion / 字段级元数据硬拒）→ 失败回喂 repairErrors 重试（≤2）
        ↓
buildApplyPlan：字段级 ops（add/update/reuse）+ refAdds/refRemoves + diff + highRiskItems
        ↓
UI 渲染：理解摘要 + diff + 高风险项逐项确认
        ↓
applyAssistantPlan 落盘：字段库 → saveTemplate → ref 维护（复用编辑器保存路径同款顺序）
```

### 11.4 校验硬拒规则（validateAssistantDraft）

| 类别 | 规则 |
|------|------|
| 协议 | `protocolVersion === 1`；`baseFingerprint` 必须原样回显请求指纹（否则 `failureKind='fingerprint'`） |
| 顶层 | understanding 1~500 字符；name 1~30；role ∈ {pc,npc,faction,quest}；description ≤200；tags ≤5 个×20 字符 |
| presetFields | 仅限当前 role 作用域内（getPresetFieldsForRole）+ 无重复 |
| perRoundFields | 仅 pc/npc 可用（faction/quest 必须省略）+ 仅限 PER_ROUND_CANDIDATES 候选集 |
| customFields | 无下划线前缀；不与预定义字段/预设字段重名；名称唯一；string 必带 max_length；enum 必带 2~8 个不重复 values；number 可选 min/max 且 min<max；类型白名单 {string,number,enum,boolean} |

### 11.5 值分布分析（modify 模式，L3）

`collectFieldValueSummary`：扫描当前聊天所有角色，聚合基线模板引用字段的值分布。
enum/number/boolean 全量 distinct，string 取 top10；输出格式
「字段（N 个角色有值）: 值×次数」。两个用途：
- **给 LLM**：prompt 注入值分布，要求改结构时向后兼容这些存量值
- **给前端**：高风险项展示影响面（如删字段时「3 个角色持有该字段值」）

### 11.6 高风险变更检测（buildApplyPlan）

| kind | 触发 | 展示 |
|------|------|------|
| `field_removed` | 模板移除自定义字段 | 该字段被多少角色持有（valueMap.total），字段库不删、历史数据不清理 |
| `type_changed` | 字段类型变更（如 string→enum） | 变更前后类型 |
| `enum_narrowed` | 枚举删除 values | 移除值列表 + 存量数据在用值高亮 |
| `lib_update` | 字段库定义更新 | 被多少模板引用（将一并生效） |

用户必须逐项确认全部高风险项才能应用；无高风险时展示纯 diff 摘要。

### 11.7 损益评估

| 维度 | 评估 |
|------|------|
| 收益 | 手动触发 → 成本完全可控（对比自动管线每轮烧 token）；目标态全量 → 校验退化为结构比对（可靠）；协议校验+修复重试 → 不靠模型自觉；高风险逐项确认 → 破坏性操作（删字段/改类型/收窄枚举）必须显式确认；独立通道 `ne_template_api` → 不与主对话管线争通道；落盘复用现有路径 → 字段库/模板/ref 一致性由既有机制保证 |
| 成本 | 核心 ~620 行 + UI 子视图 + i18n 三语 + 82 测试用例；每次生成一次 LLM 调用（+最多 2 次修复） |
| 风险 | 低——草稿不落地，校验不过不产生任何副作用；落盘路径与编辑器保存完全同构 |

### 11.8 实施落点

| 文件 | 改动 |
|------|------|
| `src/core/engine/template-assistant.js` | 核心模块：`buildTemplateFingerprint` / `buildAssistantMessages` / `collectFieldValueSummary` / `parseAssistantDraft` / `validateAssistantDraft` / `buildApplyPlan` / `applyAssistantPlan` / `runTemplateAssistant`（编排 + 修复重试 + 上下文预算门禁） |
| `src/adapter/panel-templates.js` | 工具栏「✨ AI」制表入口 + 卡片「✨ AI」改表入口；`_showAssistant` 子视图（基线选择/需求/世界书勾选）+ `_aiGenerate` 编排 + `_aiRenderResult`（理解摘要/diff/高风险确认/应用） |
| `src/core/api/llm.js` | `TOKEN_OP_MAP.template_assistant='tok_tool'`；`resolvePipelineApi` 增加 `template_assistant` → `ne_template_api` 通道路由 |
| `src/core/engine/state-pipeline.js` | 导出 `collectWorldBookContent`（只读世界书集成） |
| `src/core/i18n.js` | 三语 ~25 个 `ai_*` 文案 key |
| `test/template-assistant.test.js` | 82 用例：指纹稳定性 / 消息组装 / 值分布 / 解析 / 校验硬拒 / 应用计划（create+modify）/ 落盘 / 上下文预算 / 重试耗尽 |

---

## 12. 第 10 项：飞行模式（已讨论，排除）

### 12.1 shujuku 的纪要表 = 每轮重注入的状态块（成本模型核实）

**纪要不是「住在上下文内部」，而是每轮重新注入。** 注入链路（CODE_WIKI §7.3）：

```
表格数据变更 → refreshMergedDataAndNotify
  → updateReadableLorebookEntry（表格 → 世界书条目）
     ├─ updateOutlineTableEntry      （总览表）
     ├─ updateSummaryTableEntries    （纪要表 ← 就是它）
     └─ allocConsecutiveOrderBlock   （分配连续 order 位）
```

纪要表被渲染成**世界书条目**。而 ST 的 prompt 是每轮从零重组：
`system + 世界书 + 聊天历史 + ...`。世界书条目不属于聊天历史——它是**状态型注入**，
每轮生成时按 position/depth 重新插入一次。

### 12.2 与编码 Agent 的成本模型差异

| | 编码 Agent | shujuku / ST |
|---|---|---|
| 上下文形态 | **一条持久增长的 transcript**，历史天然在上下文内部 | 每轮**重组**的 prompt：聊天历史 + 注入块 |
| 摘要压缩的对象 | transcript 本身，原位替换（/compact 把历史换成总结） | 注入块的内容源头（表格数据） |
| 成本模型 | 每条消息只付一次 token（留在 transcript 里，老化由上下文上限管） | **每行纪要从诞生起出现在之后每一次请求里**——第 N 行写完后，后面每一轮都为它付 token |
| 老化行为 | 历史超限被挤掉 | **世界书条目永不老化**——每轮重注入，永远不会因为「太旧」被挤出上下文 |

结论：纪要表是**单调增长、永不出上下文的注入块**，这才是它吃爆窗口的根本原因。
飞行模式不是「把 transcript 原位压缩」，而是：

- **冻结注入源**（纪要表 → constant，不再加行）
- **换更粗的注入源**（大总结表承接，行数增长速率大降）
- **隐藏投影**让旧纪要从「每轮注入」中消失（物理保留只为了 replay/导出）

与编码 Agent 同族（summarize-and-replace），但压缩的对象（重复付费的注入块 vs
已付过费的历史）和付费模型完全不同。

### 12.3 NE 对照：问题面不存在

| 维度 | shujuku | NE |
|---|---|---|
| 注入什么 | 表格全量行（无选择机制） | SmartPush 检索选中子集（BM25+vector）——**注入量与记忆总量天然解耦** |
| 明细→摘要降档 | 手动结构切换 + 隐藏投影（不可逆停用） | STM→LTM 巩固，管线自动、增量、无损（STM 原始记录不删） |
| 上下文测量决策 | 无（靠用户判断何时启用） | adaptive-context 每轮实测 token，黄金窗口三档（quality/balanced/cost）+ 轮转摊薄（dialog 4~N 轮 / vault 150~2000 tok 按 KB 等级裁） |
| 物理数据 | 保留（投影隐藏） | 保留（注入层原位替换，vault 零触碰） |
| 回退 | 停用 = 不可逆硬删大总结 | 无跨生成状态，下一轮重新测量即恢复 |
| 防过压护栏 | 启用门槛 15 行 | dialog floor=4、vault floor=150 |

关键：NE 的 vault 即使涨到很大也不需要「降档」——SmartPush 每轮只注入语义相关的子集，
检索本身就是比「冻结+摘要」更细粒度的上下文控制。shujuku 没有检索层，表格注入是全量的，
才被迫发明飞行模式。

### 12.4 排除理由与遗留

**排除，且是「问题面不存在」类排除**（与第 13 项性能优化同一逻辑，不是「已有更优实现」
而是「根本无此需求」）：

1. 注入-存储解耦（检索选择 vs 全量注入）使「表格体积吃上下文」的问题在 NE 不成立
2. 分层降档 NE 管线天然就有（STM→LTM），且是自动、增量、可逆的——shujuku 要靠手动
   开关 + 结构切换 + 不可逆停用才能达成
3. 借鉴它的任何一部分（投影隐藏 / 协调提交 / 归档恢复）都是在替「存储与注入耦合」
   这个 NE 没有的前提还债

**飞行模式的深度压缩部分**（有损压缩，纪要物理行被归并）在 §1.3 明确排除项中已单独列出，
此处整体排除不重复展开。NE 无此需求，且其「隐藏投影」复杂度（协调提交/归档恢复/会话隔离）
对 NE 是负资产。

---

## 13. 第 11 项：多槽生成门控（已讨论，排除）

### 13.1 多槽是什么

「槽」= ST 的**每一次 AI 生成事件**。shujuku 在 `GENERATION_STARTED` 时把每次生成推入
`activeGenerations` 数组（`init.ts` → `recordGenerationContext_ACU`），每个槽带
`{seq, type, params, dryRun, at}`（state-manager.ts:111-123）。

「生成」不限于对话正文。ST 的任何 LLM 生成都触发 GENERATION_STARTED——**包括插件自己的
quiet 调用**（正文优化、剧情 Agent、表格更新，shujuku 都走 ST quiet 通道）。同一时间栈里
可能压着正文生成(dialog)、正文优化(quiet)、剧情推进(quiet) 等多个槽。

### 13.2 门控控制什么

**控制「这次生成结束了我该不该消费」**，解决一个平台缺陷：

> ST 的 `GENERATION_ENDED` 事件**不带 generation id**——只知道「某个生成结束了」，
> 不知道它对应哪个 STARTED。

没有门控时最致命的情形：正文生成结束前，shujuku 自己发了个 quiet 优化调用，quiet 先结束
触发 ENDED → 单靠 `lastGeneration` 误判「正文生成结束」→ 错误触发自动填表/剧情消费。
多槽栈用**完成顺序配对**（pop 栈顶）+ `dryRun` 过滤 + TTL 清理 + GENERATION_STOPPED 时
discard 最近未结束的，保证**每个 ENDED 恰好消费它对应的那个 STARTED**。

本质：**多槽门控 = ST「ENDED 无 id」事件缺失下的栈配对补偿**。

### 13.3 NE 现状：布尔守卫已有等价物

NE 在 `events.js` `onBeforeGenerate` 已有同样防御，且是**布尔守卫而非多槽栈**：

| shujuku 多槽栈 | NE 等价物 | 位置 |
|---|---|---|
| `dryRun` 不消费 | `if (dryRun) return` | events.js onBeforeGenerate |
| quiet/非正文不消费 | `type ∈ {impersonate, quiet, continue} → return` | events.js |
| 栈防并发错配 | `_isInjecting` 重入守卫（斩级联） | events.js |
| TTL 清理 | `MIN_GENERATION_INTERVAL_MS` debounce | events.js |

### 13.4 排除理由：消费点不同，配对信息天然充足

| | shujuku | NE |
|---|---|---|
| 消费事件 | `GENERATION_ENDED`（**无 id**）→ 必须栈配对 | `message_received`（**带 messageIndex 精确定位消息**）+ `GENERATION_AFTER_COMMANDS`（**带 type/dryRun**） |
| 多生成源交错 | 有（正文 + 正文优化 + 剧情 Agent 全走 ST quiet） | **无**——内部 LLM 调用走独立副 API fetch，不经过 ST 生成管线，不产生额外 STARTED/ENDED |
| 配对信息 | 缺失 → 需要栈 | 充足（消息 id + 事件 type）→ 布尔守卫即够 |

NE 管线触发点是**内容驱动**（来了条带 id 的消息就处理），不是**事件驱动**（某次无标签的
生成结束了）。移植多槽栈对 NE 是纯死代码。

### 13.5 遗留观察（未来触发条件）

若 NE 将来引入**走 ST quiet 通道的并发生成源**（如剧情 Agent 化，或把某条内部 LLM 调用
改回 generateRaw 回退路径），`_isInjecting` 布尔守卫会不够（两个 quiet 交错时最后一个
覆盖判定）。届时再升级为栈配对即可——那是「为新前提服务」，不是现在参考 shujuku 的理由。

---

## 14. 待讨论项（第 12 项）

按序逐项讨论，讨论完成后在此文档为每项补充「NE 现状差距 / 采纳决策 / 损益 / 实施落点」小节，
并将结论同步到 `project_memory.md` 的 Hard Constraints（如涉及硬约束）。
