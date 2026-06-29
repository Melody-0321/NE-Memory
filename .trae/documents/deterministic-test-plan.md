# ne-memory 确定性测试新增清单

> 目标：在现有 7 个 `test/*.test.js` 基础上，建立覆盖核心模块行为的确定性测试层。
> 测试形式：纯 JavaScript 模块，用 `mock-runtime.js` 替换 ST 依赖，`node:assert` 断言，通过 `test/run.mjs` 统一运行。
> 预计总新增：**16 个测试文件，约 1500 行**。

---

## 现有基础（已覆盖，7 个文件）

| 文件 | 覆盖内容 | 行数 |
|------|---------|:---:|
| `text-utils.test.js` | `tokenize()` / `vocabularyOverlap()` | 118 |
| `state-discovery.test.js` | `extractStateFields()` / `mergeDynamicState()` / `formatDynamicStateSummary()` | 121 |
| `pipeline-guard.test.js` | 互斥锁全部状态转移 | 73 |
| `consolidate.test.js` | `getNextEligibleStmId()` / `splitStmsIntoContiguousGroups()` | 100 |
| `context-window.test.js` | `computeWindowStartMsgId()` / `formatContextMemory()` | 209 |
| `concurrency-guard.test.js` | 双管线并发防护 | 97 |
| `ltm-rebatch-call-pattern.test.js` | `buildRebatchPrompt()` 结构 / LLM 调用签名 | 105 |

> **注意**：后 3 个文件（context-window / concurrency-guard / ltm-rebatch）未在 `run.mjs` 的 `tests` 数组中注册。应先注册验证。

---

## 新增清单

### Batch 1 — 检索与过滤（最高价值，3 个文件）

| # | 测试文件 | 被测试模块 | 测试什么 | 预估行数 |
|---|---------|-----------|---------|:---:|
| 1.1 | `bm25-scoring.test.js` | `vault/retrieval-filter.js` | `bm25Score()` 的分词计数、IDF 计算、平均长度分母；中文/英文混合 query 排序一致性；空 doc/单 token doc 边界 | 180 |
| 1.2 | `time-filter.test.js` | `vault/retrieval-filter.js` | `parseTimeConstraint()` 的时间表达式解析（"前两天"/"三小时前"/"早上"）；`applyTimeFilter()` 的时间范围过滤；`isTimeOnlyQuery()` 纯时间疑问检测 | 120 |
| 1.3 | `turn-segmenter.test.js` | `engine/turn-segmenter.js` | `groupMessagesIntoTurns()` 的用户/AI 交替分组正确性；系统消息跳过；`collectMsgIdsFromTurns()` 的 msg_id 收集；`getTurnMsgRange()` 范围计算 | 130 |

#### 关键理由

检索是注入质量的入口。BM25 排序参数（`K1=1.2, B=0.75`）是固定魔法数字，改了没人知道。时间过滤覆盖了"用户说'前两天'→ 应该过滤哪些条目"这类频繁使用的功能。turn-segmenter 是 STM 提取的前置步骤，msg_id 收集错误会导致去重失效。

---

### Batch 2 — 验证与修复（刚接上线，应立即锚定行为，3 个文件）

| # | 测试文件 | 被测试模块 | 测试什么 | 预估行数 |
|---|---------|-----------|---------|:---:|
| 2.1 | `stm-validate.test.js` | `engine/validate.js` | `validateSTMOutput()` 对合法条目返回空数组；event 字段缺失/过短 → 告警；msgRange 越界/重复/缺失 → 告警；`postFillSTM()` 对缺失字段的默认值填充；`validateMsgRanges()` 的各种异常模式 | 200 |
| 2.2 | `ltm-validate.test.js` | `engine/validate.js` | `validateLTMOutput()` 对合法 LTM 决策返回空数组；stm_refs 缺失/无效 → 告警；action 非法值 → 告警；`postFillLTM()` 对空 title/event 的填充 | 100 |
| 2.3 | `merge-story-period.test.js` | `engine/validate.js` | `mergeStoryPeriod()` 接受纯数字 "3"、中文 "第三天"、ISO 日期等输入格式；空值/null/undefined 降级为 "?" | 60 |

#### 关键理由

`validate.js` 在 `immediate-fixes.md` #1 中刚复活。验证函数的错误拒绝/放行逻辑直接影响 pipeline 中写入 vault 的数据质量。msgRange 越界检查是最容易出错的——LLM 输出的 turns 范围经常偏移 ±1。

---

### Batch 3 — LTM 整合核心逻辑（3 个文件）

| # | 测试文件 | 被测试模块 | 测试什么 | 预估行数 |
|---|---------|-----------|---------|:---:|
| 3.1 | `consolidate-core.test.js` | `engine/consolidate.js` | `findOpenLtm()` 在空/单/多 LTM 中找 open 条目；`computeClosureSignals()` 的时间跨度/角色重合/场景切换信号计算；`getNextEligibleStmId()` 的 parent_ltm 过滤完整矩阵（补充现有 consolidate.test.js 的覆盖盲区） | 130 |
| 3.2 | `consolidate-apply.test.js` | `engine/consolidate.js` | `applyLtmDecision()` 的 append/close_and_new 两种动作；stm_refs 添加后源条目的清理；LTM 切换时实体引用保留 | 140 |
| 3.3 | `ltm-rebatch.test.js` | `engine/consolidate.js` | `buildRebatchGroupPrompt()` 的输出结构（必须返回 `{system, user}`）；`parseRebatchResponse()` 对合法/非法 JSON 的处理；`deriveTimeRange()` 从 STM 列表中计算时间跨度 | 100 |

#### 关键理由

现有 `consolidate.test.js` 只测了 `getNextEligibleStmId` 和 `splitStmsIntoContiguousGroups`。LTM 整合的另外 6 个函数完全没有覆盖。`applyLtmDecision` 是写操作，错误意味着 vault 数据损坏。

---

### Batch 4 — Notebook 与检索工作区（2 个文件）

| # | 测试文件 | 被测试模块 | 测试什么 | 预估行数 |
|---|---------|-----------|---------|:---:|
| 4.1 | `notebook-core.test.js` | `vault/retrieval-notebook.js` | `addEntry()`/`getEntry()` 读写循环；`addThread()`/`extendThread()` 线程注册与扩展；`diff()` 增量计算（新增条目、新增线程、扩张条目）；`describe()` 的完整描述输出（STM entries + LTM entries + threads + chains） | 150 |
| 4.2 | `notebook-sort.test.js` | `vault/retrieval-notebook.js` | `toPromptEntries()` 的 RRF/默认排序；`jumpGapBetween()` 的跳跃检测；`threadBoundaryMark()` 的边界检测 | 80 |

#### 关键理由

`RetrievalNotebook` 是 SmartPush 检索→LLM 合成之间的桥梁。LLM 通过 `access()` / `note_thread()` 等工具调用操作 notebook。notebook 的行为如果出错（如 diff 计算错误导致 LLM 看到过期数据），SmartPush 注入质量直接受损。

---

### Batch 5 — Injection 合成（2 个文件）

| # | 测试文件 | 被测试模块 | 测试什么 | 预估行数 |
|---|---------|-----------|---------|:---:|
| 5.1 | `kb-annotations.test.js` | `engine/injection.js` | `parseKBAnnotations()` 对含/不含 KB 标注的文本的解析；`parseKBLine()` 的 name/level/reason 提取；`buildKBInstructionBlock()` 的输出格式；多角色多等级混合标注 | 120 |
| 5.2 | `smartpush-query.test.js` | `engine/injection.js` | `estimateComplexityBudget()` 短/中/长对话的预算计算；`computeVisibleWindow()` 的窗口边界；`resolveAmbiguousReferences()` 的代称消歧（"他"/"那个地方"） | 140 |

#### 关键理由

KB 标注是认知边界过滤的实现核心。如果解析逻辑有 bug（如角色名含特殊字符），整条 POV 过滤链失效。`resolveAmbiguousReferences` 是 query 进入检索前的最后一环——代称消歧失败意味着 query 本身就是错的。

---

### Batch 6 — 护栏（3 个文件）

| # | 测试文件 | 类型 | 测试什么 | 预估行数 |
|---|---------|------|---------|:---:|
| 6.1 | `ratchet-arch-layers.test.js` | Ratchet | 扫描 `src/core/` 下所有 import，确保无 `adapter/` 引用；无 `ui/` 引用；无 `panel` 引用 | 40 |
| 6.2 | `ratchet-empty-catch.test.js` | Ratchet | 扫描 `src/` 下所有 `.js` 文件，找到 `catch` 块内完全为空的（无 `console.warn`/`console.error`），数量必须 ≤ 当前基准值 | 30 |
| 6.3 | `ratchet-dead-exports.test.js` | Ratchet | 扫描 `src/` 下所有 export，逐一验证是否被 import；输出未使用的导出列表；数量必须 ≤ 基准值 | 50 |

#### 关键理由

`ratchet-arch-layers` 对应 `cross-project-analysis.md` §13.6。`ratchet-empty-catch` 对应刚修完的 `immediate-fixes.md` #2——防止以后又出现静默吞异常。`ratchet-dead-exports` 对应刚清理的 `recordTokenUsage`/`incSignal`——阻止死代码回流。

---

## 汇总

| Batch | 文件数 | 预估行数 | 优先级 | 理由 |
|:-----:|:-----:|:-------:|:-----:|------|
| 1 — 检索过滤 | 3 | 430 | **P0** | 注入质量入口，改了参数就是盲飞 |
| 2 — 验证修复 | 3 | 360 | **P0** | 刚接上线，立即锚定行为 |
| 3 — LTM 整合 | 3 | 370 | P1 | 记忆演化核心，覆盖盲区 |
| 4 — Notebook | 2 | 230 | P1 | LLM 工具调用依赖 |
| 5 — Injection | 2 | 260 | P2 | 认知边界 + query 构造 |
| 6 — 护栏 | 3 | 120 | P2 | 架构约定 + 反回归 |
| **合计** | **16** | **~1770** | | |

---

## 执行建议

### 第一步：修正现有基础

```bash
# run.mjs 中补注册已存在的 3 个测试文件
context-window.test.js
concurrency-guard.test.js
ltm-rebatch-call-pattern.test.js
```

- 先跑一遍确认它们都能通过
- 如果失败则修复后再进入新增

### 第二步：Batch 1 + 2

6 个文件是最优先的：检索入口 + 刚上线的验证。基本覆盖了"如果这里有 bug 用户立刻能感觉到"的代码路径。

### 第三步：Batch 3 + 4

consolidate.js 和 retrieval-notebook.js 是记忆演化的核心。Bug 延迟爆发（用户可能要到几十轮后才注意到 vault 坏了），但后果严重。

### 第四步：Batch 5 + 6

injection 是纯函数为主的模块，风险较低；ratchet 是防御性的，不直接提升正确性但阻止退化。

### 每完成一个 batch 后的 check-in

```bash
npm run test:unit        # 全量确定性测试
npm run build            # 确认构建不受影响
```
