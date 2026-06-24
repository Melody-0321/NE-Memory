# NE Memory 测试用例清单

每个测试用例对应一个 `test-cases/<name>/test-case.md` 文件。YAML frontmatter 包含 runner 所需的结构化参数，
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

## 一、已定义测试用例（22 个）

### SmartPush 注入 / 检索

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| smartpush-01 | 注入非空 | ✅ | 有 STM 时 SmartPush 是否注入记忆内容 |
| smartpush-02 | 注入无来源标记 | ✅ | 注入文本不含内部标记（基于 smartpush-01 trace 判定） |
| smartpush-03 | 大轮次注入稳定性 | 🟡 | 连续 15-20 轮，SmartPush 持续稳定注入 |
| smartpush-04 | STM=0 注入降级 | 🟡 | 无 STM 时优雅降级为 state-only |
| smartpush-06 | 跨场景注入切换 | 🟡 | 场景切换后注入重心从老场景转向新场景 |
| smartpush-09 | 可见窗口计算精度 | 🟡 | maxContext 边界截断正确 |
| retrieval-55 | 检索 System Prompt 结构 | ✅ | buildRetrievalPrompt 的 system prompt 包含所有必需节段 |
| retrieval-58 | 短链自动 inline | ✅ | mergePipelines Step 5：短链自动注入 notebook map |
| smartpush-group-b | 组合：去重+可见窗口+预取+query+短链 | ✅ | smartpush-05/08/10/11 + retrieval-55/58 合并运行 |

### STM 提取

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| pipeline-stm-01 | STM 提取质量 | ⬜ | LLM 响应格式规范（无代词、无标识符残留、无 JSON 破碎） |

### State 管线

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| pipeline-state-01 | 架构验证 — NE-CHAR 增量 + 静态字段 | ⬜ | State LLM 不输出 affection/current_mood/inner_thoughts |
| pipeline-state-02 | BANNER 管道格式 | ⬜ | NE-BANNER 指令注入 + 提取完整性 |
| pipeline-state-03 | 信息源验证 — Character Cards + World Book | ⬜ | State LLM 从角色卡主动提取，不等对话 |
| pipeline-state-04 | ⚠ 已废弃 — ne_context_memory 已移除 | — | context_memory 监控目标始终为空 |
| pipeline-state-05 | autoDecayStaleCharacters 两轮缓冲 | ⬜ | 角色不在 present 列表时两轮后才衰减 |

### LTM 合并

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| pipeline-ltm-01 | LTM 流式整合测试 | ⬜ | STM+LTM 合流，open/closed 生命周期，硬上限自动闭合 |

### 冒烟测试

| # | 用例 | 状态 | 描述 |
|---|------|------|------|
| smartpush-14 | 全链路冒烟 | ⬜ | STM + LTM + SmartPush + 注入一次跑通 |

---

## 二、高价值 — 应定义（8 个）

| # | 用例 | 理由 |
|---|------|------|
| stm-scene-switch | 场景切换提取 | L1 同场景检测是 STM 边界核心逻辑。场景切换漏切 → 一条 STM 跨两个场景 → 记忆混乱 |
| stm-long-batch | 长时间线 batch 提取 | Phase 2 batch 是真实使用中必触发的路径。token 溢出、分批逻辑如有 bug，用户直接受损 |
| ltm-consolidate | LTM 基础合并 | 验证 append vs close_and_new 是否被正确执行（pipeline-ltm-01 是烟测，不验证具体合并逻辑正确性） |
| state-field-validate | 字段白名单校验 | 防止 LLM 自创字段名写入 state。静默数据损坏——字段被写入但永不被展示 |
| state-merge-retain | 合并保留非重叠字段 | 同一角色两轮 state_changes 不互相覆盖字段 |
| vault-dedup-msg | 消息去重 (processed_msg_ids) | 同一消息被 pipeline 处理两次 → 双倍 STM → LTM 膨胀 |
| vault-msg-rollback | 消息回滚 | 删除/滑动消息后 vault 不同步 = 永久数据损坏 |
| integ-msg-delete | 消息删除端到端 | vault-msg-rollback 的端到端版本（删除消息 → vault 回滚 → pipeline 恢复） |

---

## 三、中价值 — 可定义但不急（6 个）

| # | 用例 | 理由 |
|---|------|------|
| stm-multi-char | 多角色引入提取 | 已有 sameChar 覆盖，更多是统计验证 |
| stm-tier-dist | 三层判决分级分布 | 统计类，不影响功能 |
| stm-phase2-quality | Phase 2 摘要质量 | 已有烟测 + LTM 合并间接覆盖 |
| ltm-merge-duplicate | 合并归并多事件 | 依赖 LLM 行为，波动大 |
| vault-append-stm | STM 追加正确性 | 更适合单元测试而非集成测试 |
| stress-50-rounds | 长对话 50 轮 | 有价值但执行成本极高。先在 smartpush-03 (15-20 轮) 验证稳定性 |

---

## 汇总

| 分组 | 已定义 | 高价值待定义 | 中价值待定义 |
|------|--------|-------------|-------------|
| SmartPush 注入 / 检索 | 9 | — | — |
| STM 提取 | 1 | 2 | 3 |
| LTM 合并 | 1 | 1 | 1 |
| State 管线 | 5 | 2 | — |
| Vault/Store | — | 2 | 1 |
| 集成 | — | 1 | — |
| 冒烟 | 1 | — | — |
| 压力 | — | — | 1 |
| **合计** | **17** (`-1` 废弃) | **8** | **6** |
