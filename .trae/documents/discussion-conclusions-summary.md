# NE-Memory 讨论结论总结

## 一、已修复的 Bug（3 个）

### Bug 1：STM 条目在 LTM 整合中被跳过
- **根因**：`applyLtmDecision`（consolidate.js）中 `skip` 动作导致死循环——被跳过的 STM 留在 `unconsolidated_stm` 中被反复选中，耗尽 20 次 MAX_LTM_PASSES。
- **修复**：删除 `skip` 选项。LLM 对每条 STM 只有两个选项：`append`（加入当前未闭合 LTM）或 `close_and_new`（闭合当前 LTM 并新建一个，将该 STM 加入新 LTM）。
- **结论**：不能让 LLM 有"跳过"的权力——每条 STM 必须落地到某个 LTM 条目中。

### Bug 2：STM 面板 Msg IDs 列显示 stm_id（如 `stm_4`）
- **根因链**：
  1. LLM 输出的 events 数量 > segments 数量 → `Math.min(events.length, segments.length)` 截断导致超出部分没有 `msg_ids` 赋值
  2. Panel 渲染时找不到 `msg_ids`，fallback 显示 `stm.id`
- **修复（P0+P1）**：
  - **P0（prompt 层）**：在 prompt 中注入 cardinality 约束——events 数量必须等于 segments 数量
  - **P0（代码层）**：`msg_ids` 过滤 —— 没有真实 msgId 的事件直接丢弃（而非截断）
  - **P1（诊断层）**：添加 `msgRange` 诊断字段 + LTM 截断检测日志

### Bug 3：时间格式不统一
- **根因**：LLM 自由推断时段/场景，没有代码约束
- **修复**：引入 State Snapshots 机制——每条消息写入时捕获 `{msgIdx, time, scene, date}`，STM 管线用快照填充 `period`/`scene`（而非靠 LLM 推断）
- **当前状态**：快照机制已工作，但依赖 state 管线先运行产生快照

---

## 二、管线架构

### 双管线模型
```
                    消息到达
                       │
              ┌───────▼───────┐
              │  pipeline-guard │  ← 全局 mutex (_pipelinePhase)
              └───────┬───────┘
                      │
         state? ──YES──► ① State 管线（extractStateChangesOnly）
         │                        │
         │                   写入快照
         │                        │
         └──NO───────────────────┐│
                                 ▼▼
                        ② STM 管线（processTurnsInBatches）
```

- **State 和 STM 串行**：state 先跑完（写快照），STM 再跑（读快照），通过 `pipeline-guard` 全局锁保证不会并发
- **自动 vs 手动**：两条路径都调用同一个 `executeIncrementalUpdate`。区别在于输入源：自动使用 `pendingMessages`（增量 FIFO 队列），手动扫描全部聊天消息

### State 关闭时的行为
- State 关闭 → 直接跳过 state 管线，进入 STM 管线
- 此时没有快照 → `period`/`scene` 回退到 LLM 推断（历史行为）

---

## 三、State 系统架构设计结论

### 3.1 Schema-Ready 模型（按需懒创建）

**决策：不做"第一轮全量提取"**

- 状态面板/字段按需懒创建——LLM 第一次提到某个字段时才生成
- 不做 pre-allocation（不在 state 初始化时预先创建所有字段并设空值）
- 不做"第一轮后全量 state 更新"

**`_initialized` vs `_schema_ready` 区分**：
- `_initialized`：schema 元数据是否已加载（只做一次）
- `_schema_ready`：所有面板/字段是否至少被填充过一次（需要多轮逐渐填满）
- 当前只实现了 `_initialized`，`_schema_ready` 的语义尚未在代码中体现

### 3.2 State 字段分类（按更新频率）

| 类型 | 描述 | 更新频率 | 示例 |
|------|------|---------|------|
| A | 每轮必查 | 每轮 LLM 调用 | `scene`, `story_time`, `present_characters` |
| B | 事件驱动 | 特定事件发生后 | `main_event`（剧情转折）、角色加入/离场 |
| C | 高频变化 | 几乎每轮都可能变 | 角色情绪、位置、对话态度 |
| D | 一次性设置 | 设定后基本不变 | 角色基础信息（年龄、职业等） |

### 3.3 `update_rule` 系统设计（尚未实现）

为每个字段配置更新策略：
- `replace`：直接覆盖（如 `story_time`）
- `merge`：深度合并（如 `characters.张三`）
- `append`：追加（如 `quests`）
- `once`：只设一次，后续不再更新（如角色基本信息）

**当前问题**：没有 `update_rule` 机制。LLM 可以随意覆盖/创建/删除字段，没有代码层约束。

### 3.4 与经典架构的对比

| 维度 | 经典单 LLM | NE-Memory 多 LLM |
|------|-----------|-----------------|
| State 更新方式 | 每轮全量重写 | 增量变更（`stateChanges`） |
| 字段控制 | prompt 模板锁定 90% 字段 | LLM 自由决定输出哪些字段 |
| 缺失防御 | 模板保证结构 | **需要 harness 工程兜底** |
| 字段创建 | 全部预定义 | 按需懒创建 |
| 并发 | 无（单次 LLM 调用） | 需要 pipeline-guard 协调 |

**核心差异**：经典架构的安全性来自 prompt 模板（结构性约束），NE-Memory 的安全性需要来自代码层 harness（输出校验和兜底）。这是 harness 工程的必要性来源。

### 3.5 `_checkpoints` vs `stateChanges`

- **`_checkpoints`**：确认当前锚点值（`time`, `scene`, `date`），即使没有变化也要输出——用于生成快照
- **`stateChanges`**：实际发生变化的字段——用于更新 state 对象
- 两者是独立的输出块。LLM 可能在无变化时只输出 `state_changes: []` 而忘记输出 `_checkpoints`——这正是 Harness Gap B 要处理的

---

## 四、State Pipeline Harness 工程（6 个缺口，~43 行代码）

详见 `state-system-architecture-summary.md`。按管线阶段边界的顺序：

```
① extractStateChangesOnly 入口
      → ② LLM 调用（buildStatePrompt → callMemoryPipeline）
           → ③ parseSTMResponse 解析
                → ④ validateStateChanges + mergeStateChanges
                     → ⑤ saveVaultWithSnapshot
```

| 缺口 | 位置 | 严重度 | 故障模式 | 状态 |
|------|------|--------|---------|------|
| A: `_initialized` 误标记 | ①→② (`ensureStateStructure`) | P0 | 扩展字段永久无法初始化 | ✅ 已实现 |
| B: 空 stateChanges 无 checkpoints | ②→③ (`extractStateChangesOnly`) | P0 | 快照链断裂 | ❌ 待实现 |
| C: autoDecay 耦合在 stateChanges 块内 | ③→④ (`extractStateChangesOnly`) | P1 | 角色离场不衰减 | ❌ 待实现 |
| D: 全部 stateChanges 被拒无告警 | ③→④ (`mergeStateChanges`) | P1 | 静默数据丢失 | ❌ 待实现 |
| E: LLM 拼错子字段名被放行 | ③→④ (`validateStateChanges`) | P2 | 野字段污染 state | ❌ 待实现 |
| F: 快照截断用 max 可能早删 | ⑤ (`executeIncrementalUpdate`) | P2 | 快照竞态丢失 | ❌ 待实现 |

---

## 五、STM Pipeline 已完成的 Harness

STM 管线已在 `9b8f9a3` 完成以下防护（可作为 state 管线的参考）：

- **msg_ids 过滤**：没有真实 msgId 的事件直接丢弃
- **文本长度校验**：事件文本过短（< 3 字符）告警
- **msgRange 诊断**：记录每个事件覆盖的消息区间
- **LTM 截断检测**：检测 LLM 输出是否被 token 限制截断

---

## 六、设置同步问题（已修复）

- **问题**：删除"保存"按钮后，`saveSettingsTab()` 只写 `localStorage`，没有同步内存标志（`setStateSchemaEnabled` 等）
- **修复**（fc6cd73）：为所有设置项添加静态 import → `saveSettingsTab()` 中写完 localStorage 后立即调用对应的 setter
- **结论**：既然没有保存按钮，所有设置修改必须即时生效到内存 + localStorage

---

## 七、测试基础设施修复（已修复）

- **smartpush_prompt 未写入 trace**：`monitor.js` 收集了但 `files.js` 没写 → 断言 FAIL 是测试框架 bug，不是管线 bug
- **语义评估器超时**：评估器只收到 injection 文本，得不到 pipeline 响应和 trace 数据 → 无法回答关于 JSON 有效性、fallback 的问题
- **修复（c1f782f）**：① smartpush_prompt 写入 trace markdown ② 评估器接受 `extraContext`（pipelineResponses + ltmDecision）③ 添加 30s 超时保护

---

## 八、尚未决策 / 待讨论的问题

1. **`update_rule` 系统是否实现？** 当前 LLM 对 state 字段有完全自由的增删改能力，是否需要在代码层用 `replace/merge/append/once` 约束？
2. **`_schema_ready` 语义**：当前只有 `_initialized`。是否需要区分"schema 已加载"和"所有字段已填充"？
3. **State 时段来源**：当前 `period` 由 LLM 推断。是否改为从消息时间戳推算（如"第 1-3 轮"）？用户认为"深夜/夜晚这种时间标记一点用都没有"
4. **自动管线是否改为全量扫描**：当前自动管线只处理新消息（`pendingMessages` 增量队列）。如果用户手动删除了 memory，已消费的消息不会重新处理
5. **DEFAULT_GLOBAL_SCHEMA 作为兜底**：Gap A 中引入了 `DEFAULT_GLOBAL_SCHEMA` 作为 `state_schema` 为 null 时的 fallback。这个默认 schema 是否应该与 `DEFAULT_CHARACTER_SCHEMA` 合并？

---

## 九、当前代码基线

| 组件 | 状态 |
|------|------|
| State 管线核心逻辑 | 运行中，但未配备 harness |
| STM 管线 | 运行中，P0+P1 harness 已完成 |
| LTM 管线 | 运行中，skip 已删除 |
| 快照机制 | 运行中，依赖 state 管线先跑 |
| 设置同步 | 即时生效 |
| 测试框架 | 正常运行 |
| Harness Gap A | ✅ 已实现 |
| Harness Gap B–F | ❌ 待实现（~35 行代码，含在 `state-system-architecture-summary.md` 中） |
