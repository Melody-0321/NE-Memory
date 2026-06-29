# NE Memory 测试用例清单

每个测试用例对应一个 `test-cases/<category>/<name>/test-case.md` 文件。YAML frontmatter 包含 runner 所需的结构化参数，
markdown 正文是人工阅读的测试说明和 driver 引导策略。runner 运行时自动提取 frontmatter 并编译。

调用方式：
```javascript
await __ne_debug.runTestByName('pipeline-state-01')    // 单个用例
await __ne_debug.runTestByName('smartpush-group-b')    // 组合用例
```

状态标记：
- ✅ 通过 — 已运行并通过
- 🔴 失败 — 已运行但未通过
- 🟡 待定义 — 有价值但尚未编写 test-case.md
- ⬜ 未运行 — 已定义但尚未执行

---

## 一、已定义测试用例（23 个）

### SmartPush 注入 / 检索

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| smartpush-01 | 注入非空 | ✅ | 有 STM 时 SmartPush 是否注入记忆内容 |
| smartpush-02 | 注入无来源标记 | ✅ | 注入文本不含内部标记（基于 smartpush-01 trace 判定） |
| smartpush-03 | 大轮次注入稳定性 | 🟡 | 连续 15-20 轮，SmartPush 持续稳定注入 |
| smartpush-04 | STM=0 注入降级 | 🟡 | 无 STM 时优雅降级为 state-only |
| smartpush-06 | 跨场景注入切换 | 🟡 | 场景切换后注入重心从老场景转向新场景 |
| smartpush-09 | 可见窗口计算精度 | 🟡 | maxContext 边界截断正确 |
| smartpush-15 | BM25+Vector 混合检索 | ⬜ | 向量搜索启用时 SmartPush 端到端验证，向量索引构建 + RRF 融合 |
| smartpush-group-b | 组合：去重+可见窗口+query+短链 | ✅ | smartpush-05/08 + retrieval-55/58 合并运行 |

### STM 提取

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| pipeline-stm-01 | STM 提取质量 | ⬜ | LLM 响应格式规范（无代词、无标识符残留、无 JSON 破碎） |
| stm-scene-switch | 场景切换提取 | ⬜ | L1 边界检测跨场景边界，STM 不跨场景合并 |

### State 管线

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| pipeline-state-01 | 架构验证 — NE-CHAR 增量 + 静态字段 | ⬜ | State LLM 不输出 affection/current_mood/inner_thoughts |
| pipeline-state-02 | BANNER 管道格式 | ⬜ | NE-BANNER 指令注入 + 提取完整性 |
| pipeline-state-03 | 信息源验证 — Character Cards + World Book | ⬜ | State LLM 从角色卡主动提取，不等对话 |
| pipeline-state-04 | 滑动窗口上下文注入 | ⬜ | formatContextMemory → ne_context_memory 摘要注入 |
| pipeline-state-05 | autoDecayStaleCharacters 两轮缓冲 | ⬜ | 角色不在 present 列表时两轮后才衰减 |
| pipeline-state-06 | 势力状态管理 | ⬜ | 一次性预载 + 关键词激活 + State LLM 管理 |
| state-field-validate | 字段白名单校验 | ⬜ | 拒绝 LLM 自创字段名，字段路径与 schema 一致 |
| state-merge-retain | 合并保留非重叠字段 | ⬜ | 两轮 state_changes 不互相覆盖，_scheme 保护 |

### LTM 合并

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| ltm-consolidate | LTM 基础合并 | ⬜ | append/close_and_new 决策 + MAX_OPEN_STM_REFS 硬上限 |

### Vault / Store

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| vault-dedup-msg | 消息去重 | ⬜ | filterNewMessages 拒绝已处理的 msg_id |
| vault-msg-rollback | 消息回滚 | ⬜ | rollbackByMsgIds 移除 STM + 级联清理 LTM |

### 集成

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| integ-msg-delete | 消息删除端到端 | ⬜ | onMessageDeleted → rollback → vault 写回完整事件链 |

### 检索格式

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| retrieval-55 | 注入内容格式 | ✅ | SmartPush 注入以事件日志格式组织，带时间戳和 msg_id |
| retrieval-58 | 短链自动 inline | ✅ | mergePipelines Step 5：短链自动注入 notebook map |

### 冒烟测试

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| smartpush-14 | 全链路冒烟 | ⬜ | STM + LTM + SmartPush + 注入一次跑通 |

---

## 二、单元测试覆盖（22 个文件）

以下纯逻辑层已由确定性单元测试（`test/*.test.js`）覆盖，运行 `npm test` 执行。
这些单元测试**不依赖 LLM 调用**，可毫秒级验证核心算法的正确性。

| 测试文件 | 覆盖的关键逻辑 |
|----------|--------------|
| `schema.test.js` | State 字段校验、dot-path 解析、深度合并、PC/NPC 注入、好感度增量、quest legacy 重映射 |
| `json-fallback.test.js` | LLM JSON 5 阶段回退解析（thinking→code block→balanced scan→comma fix） |
| `bm25-grouper.test.js` | LTM 预分组 BM25 相似度计算、分组格式化 |
| `consolidate-core.test.js` | LTM open/closed 生命周期、append/close_and_new、硬上限逻辑 |
| `consolidate-apply.test.js` | LTM 决策应用、stm_refs 管理 |
| `bm25-scoring.test.js` | BM25 评分、时间约束解析与过滤 |
| `time-filter.test.js` | 时间过滤精确定义 |
| `smartpush-query.test.js` | SmartPush 查询构建、budget 分配 |
| `notebook-core.test.js` | RetrievalNotebook 工作区操作、预取逻辑 |
| `notebook-sort.test.js` | 注入条目排序与去重 |
| `turn-segmenter.test.js` | 对话轮次分组、边界检测、msg_id 提取 |
| `context-window.test.js` | 滑动窗口消息范围计算、上下文格式化 |
| `pipeline-guard.test.js` | Pipeline 互斥锁、state→stm→ltm 三阶段转换 |
| `concurrency-guard.test.js` | 多轮并发防护 |
| `ltm-rebatch-call-pattern.test.js` | LTM rebatch LLM 调用模式验证 |
| `stm-validate.test.js` | STM 输出校验 |
| `ltm-validate.test.js` | LTM 输出校验 |
| `merge-story-period.test.js` | 故事时期合并格式化 |
| `text-utils.test.js` | 分词器、词汇重叠度 |
| `kb-annotations.test.js` | KB 注解解析 |
| `ltm-rebatch.test.js` | STM 分割与分组 |
| `bm25-grouper.test.js` | 同上（预分组器） |

---

## 三、中价值 — 可定义但不急（5 个）

| # | 用例 | 理由 |
|---|------|------|
| stm-multi-char | 多角色引入提取 | 已有 sameChar 覆盖，更多是统计验证 |
| stm-tier-dist | 三层判决分级分布 | 统计类，不影响功能 |
| stm-phase2-quality | Phase 2 摘要质量 | 已有烟测 + consolidate 单元测试间接覆盖 |
| ltm-merge-duplicate | 合并归并多事件 | 依赖 LLM 行为，波动大 |
| stress-50-rounds | 长对话 50 轮 | 有价值但执行成本极高。先在 smartpush-03 (15-20 轮) 验证稳定性 |

---

## 四、测试体系说明

### 两层架构

```
确定性单元测试（22 文件）               LLM 集成测试（23 用例）
─────────────────────────              ──────────────────────
- 不依赖 LLM 调用                       - 依赖副 API（LLM）
- 毫秒级完成                            - 每轮 15-120 秒
- npm test 自动运行                    - 手动触发（__ne_debug.runTestByName）
- 验证代码逻辑正确性                     - 验证 LLM 行为质量
- 覆盖纯函数：校验/合并/检索/分组等       - 覆盖端到端：提取/注入/格式化/降级
```

### 2026-06-29 缩减记录

| 移除的 LLM 测试 | 原因 | 替代覆盖 |
|------|------|---------|
| `stm-long-batch` | 测试对象 `processTurnsInBatches` 已整文件删除 | — |
| `pipeline-ltm-01` | 与 `ltm-consolidate` 80% 重复 | `consolidate-core.test.js` + `consolidate-apply.test.js` |
| `smartpush-10` | "预取原文完整度"是纯字符串拼接 | `notebook-core.test.js` |
| `smartpush-11` | "query 含 AI reply"是 query 构建逻辑 | `smartpush-query.test.js` |
| `smartpush-05` | "注入内容去重"合并入 `smartpush-group-b` | 组合测试中附带验证 |
| `smartpush-08` | "可见窗口跳过预取"并入 `smartpush-group-b` | 组合测试中附带验证 |

### 不可进一步缩减的原因

剩余 23 个 LLM 测试测的不是"代码逻辑对不对"，而是 **"LLM 有没有听话"**——这是一个单元测试永远覆盖不了的维度：

- **State 管线（8 个）**：测试 State LLM 是否真的从 Character Card 提取字段、是否遵守职责边界不输出 NE-CHAR 字段、势力是否真的在对话提及后激活
- **STM 质量（2 个）**：测试 LLM 是否产生代词/编造/JSON 破碎
- **SmartPush（7 个）**：测试 Memory LLM 合成注入文本的质量、场景切换后重心转移、大轮次稳定性
- **Vault/Store（2 个）**：测试 ST 事件→handler→IndexedDB 的完整 I/O 链
- **集成/冒烟（2 个）**：全链路无断裂验证

LLM 是不可靠的组件。任何 prompt 改动都可能破坏其输出格式，必须有 LLM 测试做哨兵。

---

## 汇总

| 分组 | LLM 测试 | 单元测试覆盖 |
|------|:---:|------|
| SmartPush 注入 / 检索 | 8 | `smartpush-query`, `notebook-*`, `bm25-scoring`, `time-filter` |
| STM 提取 | 2 | `stm-validate`, `turn-segmenter`, `ltm-rebatch` |
| LTM 合并 | 1 | `consolidate-*`, `ltm-validate`, `merge-story-period` |
| State 管线 | 8 | `schema`, `context-window`, `pipeline-guard` |
| Vault/Store | 2 | `ltm-rebatch-call-pattern` |
| 集成 + 冒烟 | 2 | 全栈（依赖所有单元测试） |
| **合计** | **23** | **22** |
