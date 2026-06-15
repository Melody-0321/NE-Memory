# NE Memory 测试用例清单

这份清单按子系统/模块组织，每项是一个独立测试用例。每个测试用例包含一个 `test-cases/<name>/test-case.md` 文件。
**test-case.md 是唯一数据源**——文件头的 YAML frontmatter 包含 runner 需要的所有结构化参数（断言、轮次控制、前置条件），
markdown 正文是供人类阅读的测试说明和 driver 引导策略。Runner 在运行时自动提取 frontmatter 并编译。
报告和 trace 保存在同目录下。

## 架构说明

```
test-cases/<name>/test-case.md   ← 自包含（YAML frontmatter + markdown 正文）
           ↓
runner 自动提取 frontmatter        ← loadTestCaseByName(name) → fetch + parseYaml
           ↓
runTestByName(name) 执行           ← 无需 _testPresets，无需 npm run build
           ↓
trace + report 写入同目录           ← 保持 test-case.md 所在文件夹
```

调用方式：
```javascript
await __ne_debug.runTestByName('smartpush-01')       // 单个用例
await __ne_debug.runTestByName('smartpush-group-b')  // 组合（frontmatter 中 tests: [...] 指定子用例）
```

组合测试可将多个 TC 的断言合并到单次对话的 test-case.md 中一同验证。
runner 管理从 frontmatter 自动提取所有断言。无需 `tests` 数组。

状态标记：
- ✅ 通过 — 已通过
- 🔴 失败 — 已运行但未通过
- 🟡 待测 — 已定义但未运行
- ⬜ 未定义 — 需要设计

---

## 管线核心 (Pipeline Core)

### SmartPush 注入

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 01 | **注入非空** | ✅ 通过 | 有 STM 时 SmartPush 是否真的注入了记忆内容（非 state-only） |
| 02 | **注入无来源标记** | ✅ 通过 | 注入文本不包含 `→stm:` / `→[stm:` / `stm_` 等内部标记（trace-level, 在 T01 trace 上判定） |
| 03 | **大轮次注入稳定性** | 🟡 待测 | 连续 15-20 轮，SmartPush 持续稳定注入，无退化（变空、乱码、重复碎片） |
| 04 | **STM=0 注入降级** | 🟡 待测 | 无 STM 时优雅降级为 state-only 注入。运行前需手动清空 vault |
| 05 | **注入内容去重** | 🟡 待测 | 同一事件二次触发时，注入内容稳定、无多余重复膨胀（合并于 Group B） |
| 06 | **跨场景注入切换** | 🟡 待测 | 场景切换后注入重心从老场景转向新场景 |
| 07 | **注入格式兼容性** | ⬜ 未定义 | Inject 文本对主 LLM 输出的影响：是否导致 LLM 在回复中确认"我记得" |
| 08 | **可见窗口跳过预取** | 🟡 待测 | 事件全部 msg_id 在 visibleWindow 内时，prefetch 是否跳过该条目，避免向 memory LLM 重复注入主 LLM 已知信息 |
| 09 | **可见窗口计算精度** | 🟡 待测 | 向后行走 token 计数器是否正确累加；构造 30 轮对话，验证 maxContext 边界处截断正确（检查被标记为"可见"的消息实际 token 总和是否 ≤ maxContext - 1500） |
| 10 | **预取原文完整度** | 🟡 待测 | prefetchOriginalTexts 是否取全部 msg_id 的原文而非仅首尾；原文行是否带 `[msg_xx]` 前缀；3 条候选总计是否不超过 2000 字符；事件原文较短时不因 eventLen > 80 而被跳过 |
| 11 | **query 含 AI reply** | 🟡 待测 | 验证格式处理后的 system prompt 的 BM25 query 是否包含最近的 2 轮 AI 回复和 user 输入，而非仅 5 条 user messages；降级路径（只有 user）是否正常 |

### STM 提取管线

> Pipeline 的提取质量和稳定性直接影响所有下游系统。每个场景都应覆盖。

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 10 | **基础提取（续连续场景）** | 🟡 待测 | 在同一场景中连续 7 轮对话，检查 STM 提取的 event 质量、turns 范围、实体标注 |
| 11 | **场景切换提取** | ⬜ 未定义 | 对话中自然切换场景（地点/时间跳转），检查 STM 是否产生独立事件 |
| 12 | **多角色引入提取** | ⬜ 未定义 | 3+ 角色参与对话，检查 STM 的 entity 标注是否正确覆盖所有参与角色 |
| 13 | **长时间线 batch 提取** | ⬜ 未定义 | 长对话（15-20 轮）触发的 batch pipeline，确保无 token 溢出、分批正确 |
| 14 | **partial event 追踪** | ⬜ 未定义 | 同一场景内未闭合的事件在后续轮次是否被 pipeline 正确归并或更新 |
| 15 | **pipeline 失败后自动恢复** | ⬜ 未定义 | LLM 调用失败时（API 错误/超时），下轮 pipeline 是否正常重试 |

### LTM 合并

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 20 | **基础合并** | ⬜ 未定义 | STM 数量达到 consolidate_threshold 后，LTM 是否被正确创建 |
| 21 | **合并后 stm_index 一致性** | ⬜ 未定义 | 合并后，stm_index 的 ltm_id 映射是否正确 |
| 22 | **合并归并多事件** | ⬜ 未定义 | 合并是否将同一主题的多个 STM 正确归并到一条 LTM，不重复 |
| 23 | **合并的 LLM token 控制** | ⬜ 未定义 | LTM 合并的 LLM 调用是否在 max_tokens 约束内 |

### State 管线

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 30 | **基础 State 提取（Preset mode）** | ⬜ 未定义 | Schema ON 时，state 管线的提取是否正确解析 state_changes |
| 31 | **基础 State 提取（Dynamic mode）** | ⬜ 未定义 | Schema OFF + 动态模式时，state 提取是否正确 |
| 32 | **State 字段白名单校验** | ⬜ 未定义 | validateStateChanges 是否正确过滤不在 schema 中的字段 |
| 33 | **State 合并不覆盖非重叠字段** | ⬜ 未定义 | mergeStateChanges 是否正确保留未被当前轮次变更的旧字段 |
| 34 | **角色属性衰减 (autoDecay)** | ⬜ 未定义 | 长时间未出现的角色，其 state 字段是否被正确降级/标记 |
| 35 | **任务完成标记 (handleQuestCompletion)** | ⬜ 未定义 | 当 state 字段变为 completed/ended 时，系统是否正确触发回调 |

### Entity 系统

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 40 | **实体链提取** | ⬜ 未定义 | 跨多轮跟踪某一角色时，entity chain 是否准确收集了该角色的所有相关事件 |
| 41 | **实体链排序** | ⬜ 未定义 | entity chain 返回的事件按时间排序是否正确 |
| 42 | **多实体关联** | ⬜ 未定义 | 共享同一实体的多个事件是否被正确聚合成一条链 |

---

## 检索层 (Retrieval)

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 50 | **BM25 过滤命中** | ⬜ 未定义 | 给定查询，BM25 是否能从 N 条 STM 中返回正确的 top-K |
| 51 | **BM25 过滤空结果** | ⬜ 未定义 | 给定无关查询，BM25 是否能返回空结果或最少回退 |
| 52 | **Pipeline 合并（四路）** | ⬜ 未定义 | BM25 + entity chains + LTM groups + 隐式实体发现是否正确合并 |
| 53 | **Notebook 去重** | ⬜ 未定义 | 同一事件在多条 pipeline 中被检出时，notebook 是否去重 |
| 54 | **Notebook 线程标注** | ⬜ 未定义 | 条目在 notebook 中的 thread 批注是否正确（chain/group/dispersed） |
| 55 | **检索 System Prompt 构建** | 🟡 待测 | buildRetrievalPrompt 的 system prompt 是否包含：候选记忆、线程标注、`## 当前对话可见窗口` 节段（含 msg_id 标注）、`## 最近一轮对话上下文` 节段、精简后的参考工具说明 |
| 56 | **检索 Token 预算控制** | ⬜ 未定义 | estimateComplexityBudget 是否正确限制候选数量 |
| 57 | **检索跨语言处理** | ⬜ 未定义 | 中英混合输入时，检索是否正确处理候选排序 |
| 58 | **短链自动 inline** | 🟡 待测 | mergePipelines Step 5：availableChains 中 count ≤ 5 的实体链是否被自动注入到 notebook map，并从 availableChains 移除；count > 5 的长链保持不变 |
| 59 | **工具调用频率下降验证** | ⬜ 未定义 | 在 trace 中统计 access/note_thread 工具调用次数，对比优化前后同一数据集的调用轮数是否显著下降（预期从 2-3 轮降至接近 0） |

---

## 存储层 (Vault/Store)

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 60 | **Vault CRUD（读写）** | ⬜ 未定义 | read/write 在 IndexedDB 中是否正确持久化 |
| 61 | **快照写入 (writeWithSnapshot)** | ⬜ 未定义 | 带快照的写入是否创建了正确的 snapshots |
| 62 | **消息去重 (processed_msg_ids)** | ⬜ 未定义 | 同一消息是否被 pipeline 正确处理（不重复提取） |
| 63 | **STM 追加 (appendSTMEntries)** | ⬜ 未定义 | 新 STM 追加后，id 递增和 stm_index 是否正确 |
| 64 | **消息回滚 (rollbackByMsgIds)** | ⬜ 未定义 | 删除/滑动消息后，关联的 STM/LTM 是否被正确回滚 |
| 65 | **消息回滚边界（LTM 级联）** | ⬜ 未定义 | 一条 LTM 的所有子 STM 都被回滚时，LTM 本身是否被正确删除 |
| 66 | **快照列表/恢复/删除** | ⬜ 未定义 | versions.js 的快照管理是否完整 |
| 67 | **快照自动裁剪** | ⬜ 未定义 | pruneSnapshotsForChat 是否在超出限制时正确删除旧快照 |

---

## API / LLM 调用

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 70 | **管线 LLM 调用 (callMemoryPipeline)** | 🟡 待测 | 管线是否走副 API，temperature/max_tokens 是否正确传参 |
| 71 | **主/副 API 切换** | ⬜ 未定义 | 副 API 不可用时是否回退到主 API |
| 72 | **分离模式 (isApiSplitMode)** | ⬜ 未定义 | 检索走专用 API 时，配置是否正确分离 |
| 73 | **API 连通性测试** | ⬜ 未定义 | testSecondaryApiConnection 是否正确检测 API 是否可用 |
| 74 | **多轮 Tool Calling 循环** | ⬜ 未定义 | （当前版本）callMemoryLLMWithTools 的 5 轮循环是否正确退出，且在新的 tool guidance 下工具调用轮数是否显著减少 |

---

## 集成 / 边界

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 80 | **消息生命周期事件流** | ⬜ 未定义 | sent → received → beforeGenerate → generated 的完整事件链是否无异常 |
| 81 | **消息删除/滑动回滚** | ⬜ 未定义 | 选中历史消息删除或滑动后，vault 回滚是否正确 |
| 82 | **消息编辑回滚** | ⬜ 未定义 | 编辑历史消息后，vault 回滚和重新提取是否正常 |
| 83 | **首轮对话无 vault** | 🟡 待测 | 全新对话（vault=空），首轮 onBeforeGenerate 是否正常，不产生错误 |
| 84 | **矛盾检测 (contradiction)** | ⬜ 未定义 | LLM 回复与 vault 存储矛盾时，是否被正确标记 |
| 85 | **歧义消解 (ambiguity)** | ⬜ 未定义 | 用户输入中有歧义指代时，系统是否尝试消解 |
| 86 | **自动恢复 (auto-restore)** | ⬜ 未定义 | Vault 数据被意外清空时，是否能从聊天记录中恢复 |
| 87 | **World Book 同步** | ⬜ 未定义 | 状态更新后，对应的 World Book 条目是否被正确同步 |
| 88 | **动态状态发现 (state-discovery)** | ⬜ 未定义 | 从角色卡/世界书自动构建 schema 是否完整 |

---

## 压力 / 稳定性

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| 90 | **长对话管道累积（50 轮）** | ⬜ 未定义 | 连续 50 轮对话，pipeline 是否正确处理批量和边界 |
| 91 | **重复消息处理** | ⬜ 未定义 | processed_msg_ids 在极长对话中是否正确积累和去重 |
| 92 | **高密度多角色（舞台装置）** | ⬜ 未定义 | 10+ 角色 + 多剧情线并行，entity/retrieval 是否正确 |
| 93 | **Token 预算极限测试** | ⬜ 未定义 | 在极端 token 压力下，pipeline 是否仍能正确执行 |

---

## 测试分组策略

### 可合并条件

多个测试用例可以共享一次运行，需满足以下所有条件：

1. **同一对白场景/角色卡** — driver 基于同一段故事展开，不能既有"男校校园"又有"奇幻洋馆"
2. **driver prompt 可合并** — 比如"自然互动到第 7 轮"和"第 7 轮问一个具体问题"可合并为一个 prompt，不会产生冲突行为指令
3. **round 数一致或子集关系** — 比如 7 轮的测试可以覆盖 7 轮就结束的断言，但 15 轮的测试不能和 7 轮的合并（会被截断）
4. **断言为只读/非破坏性** — 只是检查注入输出、trace 文件、系统提示词内容，不要求改变 driver 行为
5. **管线配置一致** — stmBatch、SmartPush 开关、副 API 配置相同

### 不可合并的典型情况

- 需要**不同角色卡**（校园 vs 奇幻）
- driver prompt 给出**冲突指令**（"7 轮后结束" vs "至少 15 轮"）
- **前提条件不同**（有 STM vs 无 STM vs 特定场景切换）
- 断言需要在某轮**改变 driver 行为**（第 N 轮干不同的事）

### 当前分组（已实现）

| 组 | 名称 | 用例 | 文档 | 说明 |
|----|------|------|------|------|
| **Group B: SmartPush 检索优化** | `smartpush-group-b` | 05、08、10、11、55、58 | `smartpush-group-b/test-case.md` | 去重 + 可见窗口 + 预取 + query + system prompt + 短链 inline。**单次对话统一运行**，所有断言共用同一段对话数据 |
| **TC-03: 大轮次稳定性** | `smartpush-03` | 03 | `smartpush-03-long-run/test-case.md` | 独立运行，需 15-20 轮 |
| **TC-04: STM=0 降级** | `smartpush-04` | 04 | `smartpush-04-stm-zero/test-case.md` | 独立运行，需手动清空 vault |
| **TC-06: 跨场景切换** | `smartpush-06` | 06 | `smartpush-06-scene-switch/test-case.md` | 独立运行，driver 主导场景切换 |
| **TC-09: 可见窗口精度** | `smartpush-09` | 09 | `smartpush-09-visible-window-precision/test-case.md` | 独立运行，需 30 轮长对话 |
| **待设计** | — | 07 | — | 需不同前提条件 |

### 个体调试入口

每个用例通过 `__ne_debug.runTestByName(name)` 直接运行：
- `smartpush-01`~`smartpush-06`、`smartpush-08`~`smartpush-11`
- `retrieval-55`、`retrieval-58`

所有结构化参数（断言、轮次、前置条件）均从各自 `test-case.md` 的 frontmatter 自动提取。无需在代码中维护平行配置。

### 语义评估三态机制

Driver 在 minRounds 后每 2 轮执行一次语义评估（LLM 调用），评估结果分三态：
- **passed=true**（确定通过）→ 所有问题均明确通过则自然结束
- **passed=false**（确定不通过）→ 立即停止并标记失败
- **passed=null**（无法判断）→ 继续运行，等更多数据

被强制截断（`forced_max_rounds`）时，所有 `null` 结果转为 `false`（按不通过处理）。

## 汇总

| 分组 | 计划 | 已通过 | 待测 | 未定义 |
|------|------|--------|------|--------|
| SmartPush 注入 | 11 | 2 | 8 | 1 |
| STM 提取管线 | 6 | - | 1 | 5 |
| LTM 合并 | 4 | - | - | 4 |
| State 管线 | 6 | - | - | 6 |
| Entity 系统 | 3 | - | - | 3 |
| 检索层 | 10 | - | 3 | 7 |
| 存储层 | 8 | - | - | 8 |
| API/LLM 调用 | 5 | - | 1 | 4 |
| 集成/边界 | 9 | - | 1 | 8 |
| 压力/稳定性 | 4 | - | - | 4 |
| **合计** | **66** | **2** | **14** | **50** |

> 注：smartpush-02-no-markers (TC-02) 为 trace-level 断言，基于 smartpush-01 的 trace 直接判定，无需独立运行。
> 当前 66 个用例中有 54 个尚未设计具体测试。建议将 smartpush 系列（01-11）作为第一阶段覆盖，管线核心（10-15、20-23、30-35）作为第二阶段。
> 新增的检索优化测试（TC-08~11、55、58、59）依赖本次检索管线优化的改动（可见窗口计算、预取重写、短链 inline）。
> 测试框架 v2 新增: test-case.md 自包含 YAML frontmatter，runner 自动提取编译。组合测试通过 frontmatter 的 `tests` 数组声明。调用: `__ne_debug.runTestByName(name)`。
