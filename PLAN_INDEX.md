# 计划文档索引

> 自动生成 | 2026-08-27 | 83 个文档 | 55% 完成

| 文件 | 状态 | 创建 | 最后更新 | 标题 |
|------|------|------|---------|------|
| `P0-UI-token化实施计划.md` | ⏳ 未开始 | 2026-08-25 | 2026-08-25 | P0 UI Token 化实施计划 |
| `P1-导航重构实施计划.md` | ❓ 未知 | — | — | P1 导航重构实施计划（Tab + 页栈） |
| `P2-交互打磨实施计划.md` | ❓ 未知 | — | — | P2 交互打磨实施计划（手势 / 渲染态保持 / 状态与动效） |
| `STATUS.md` | ❌ 已废弃 | 2026-07-10 | 2026-08-16 | P1 新模块状态 & 问题记录 |
| `VERIFY.md` | ❌ 已废弃 | 2026-07-10 | 2026-08-16 | 大更新验证清单 |
| `adaptive-context-control-plan.md` | ✅ 已完成 | 2026-07-17 | 2026-07-22 | 自适应上下文控制（Plan C 重构）— 事后裁剪方案 |
| `adaptive-context-integration-test.md` | ✅ 已完成 | 2026-07-22 | 2026-07-22 | 自适应上下文控制集成测试改造计划 |
| `adaptive-dryrun-chat-history.md` | ✅ 已完成 | 2026-07-24 | 2026-07-24 | 自适应压缩 DryRun 支持 — 让 ST Chat History 反映压缩结果 |
| `add-ability-and-outfit-fields.md` | ❓ 未知 | — | — | 预设字段扩展：技能/能力 + 即时着装 |
| `api-connection-model-dropdown-plan.md` | ✅ 已完成 | 2026-06-24 | 2026-07-02 | Plan 1：API 连接检测重构 + 模型下拉改造 |
| `api-timeout-retry-enhancement-plan.md` | ✅ 已完成 | 2026-06-26 | 2026-07-03 | Plan 2：API 超时可配置 + 调用重试 + Key 校验 |
| `audit-consistency.md` | ✅ 已完成 | 2026-07-15 | 2026-07-15 | 全量审计 — 重复造轮子 & 一致性修复 |
| `benchmark-improvement-plan.md` | ✅ 已完成 | 2026-08-18 | 2026-08-18 | 评测体系统计补强与改进计划（v2） |
| `blog-post2-resolve-rewrite-outline.md` | ⏳ 未开始 | 2026-08-20 | 2026-08-20 | 博客第二篇大纲：反悔黑洞与 resolve-rewrite（效应×成本地图 + 相关工作） |
| `chat-completion-round-limit-patch.md` | 🔄 进行中 | 2026-07-17 | 2026-07-17 | ChatCompletion Prototype Patch — 让对话轮数滑块在 token 显示中生效 |
| `context-window-injection-layer.md` | ✅ 已完成 | 2026-06-22 | 2026-06-28 | 修复计划：将 Context Window 裁剪从消息源改为注入层 |
| `dialog-round-trim-via-chat-completion-event.md` | 🔄 进行中 | 2026-07-22 | 2026-07-22 | 对话轮数控制：从无效的 import() patch 迁移到 CHAT_COMPLETION_PROMPT_READY 事件裁剪 |
| `doc-management-optimization-plan.md` | ✅ 已完成 | 2026-07-09 | 2026-07-09 | NE-Memory 文档管理优化计划 |
| `extend-templates-to-faction-quest.md` | ✅ 已完成 | 2026-07-09 | 2026-07-13 | 模板系统扩展：势力 + 任务/事件 + NE-CHAR 动态字段 |
| `fix-cross-type-field-leak.md` | ✅ 已完成 | 2026-07-15 | 2026-07-15 | 修复 LLM 跨类型字段写入：validate 拒绝 + prompt 限定 |
| `fix-custom-field-system.md` | ❓ 未知 | — | — | 修复自定义字段系统 |
| `fix-dialog-round-control.md` | ✅ 已完成 | 2026-06-18 | 2026-06-22 | 修复计划：对话轮数注入控制不生效 |
| `fix-panel-chat-switch-sync.md` | ✅ 已完成 | 2026-06-20 | 2026-06-28 | 修复面板聊天切换不同步问题 |
| `fix-rollback-detect-scan-chain.md` | ✅ 已完成 | 2026-07-15 | 2026-07-15 | 修复版本链精确回退：检测逻辑重写 + 手动编辑补齐版本链 |
| `fix-rollback-force-rebuild-state.md` | ✅ 已完成 | 2026-07-15 | 2026-07-15 | 修复版本链回退后 State 未重建的 bug |
| `fix-template-llm-and-world-context.md` | ❓ 未知 | — | — | 修复：Template LLM 触发 + World Context 填充 |
| `fix-version-chain-rollback.md` | ✅ 已完成 | 2026-07-14 | 2026-07-14 | 修复版本链回退功能失效 |
| `golden-context-window.md` | ✅ 已完成 | 2026-07-22 | 2026-07-22 | 上下文黄金窗口（Golden Context Window）实现计划 |
| `injection-ablation-rerun-plan.md` | ✅ 已完成 | 2026-08-19 | 2026-08-19 | 注入侧评测仪器重审计划 —— key-highlights 消融（三层仪器：确定性度量 + 原子事实探针 + 机制归因） |
| `injection-kscan-phaseb-plan.md` | ✅ 已完成 | 2026-08-20 | 2026-08-20 | 注入量 k 扫描 Phase B：k=40/80/100 三档对比 |
| `injection-kscan-step0-plan.md` | 🔄 进行中 | 2026-08-20 | 2026-08-20 | 注入量 k 扫描：Step 0（确定性覆盖诊断）+ 全链路 TODO |
| `injection-structure-comparison-plan.md` | ✅ 已完成 | 2026-08-19 | 2026-08-19 | 注入结构 6 臂横评计划 —— 现行结构 vs 替代结构的真实差距（含检索/注入损失分解） |
| `inventory-power-slots-ui-redesign.md` | ✅ 已完成 | 2026-07-17 | 2026-07-17 | 物品栏 & 技能栏 UI 重设计 |
| `management-optimization-todos.md` | 🔄 进行中 | 2026-08-16 | 2026-08-16 | NE-Memory 文档/代码管理优化待办 |
| `modality-eval-and-decision-plan.md` | ✅ 已完成 | 2026-08-18 | 2026-08-18 | Modality 修复方式评测与决策计划（用测试数据裁决 B/C/E） |
| `modality-schema-fix-plan.md` | ✅ 已完成 | 2026-08-18 | 2026-08-19 | NE-Memory 抽取情态修复计划（T1 触发 · D 方案 = resolve-rewrite 二段式） |
| `narrative-anchor-expansion-plan.md` | ✅ 已完成 | 2026-08-19 | 2026-08-19 | Narrative 锚点扩容计划（注入侧仪器功率补齐） |
| `ne-panel-layout-restructure.md` | ⏳ 未开始 | 2026-07-05 | 2026-07-05 | NE-Memory 面板布局重构计划 |
| `open-character-schema-data-model.md` | 🔄 进行中 | 2026-06-10 | 2026-07-07 | 开放角色 Schema 系统改造计划 |
| `open-character-schema-runtime.md` | 🔄 进行中 | 2026-06-10 | 2026-07-07 | 开放角色 Schema 系统改造计划 |
| `open-character-schema-ui-plan.md` | 🔄 进行中 | 2026-07-05 | 2026-07-07 | Open Character Schema UI 实施计划 |
| `open-character-schema-ux-engineering.md` | 🔄 进行中 | 2026-06-10 | 2026-07-07 | 开放角色 Schema 系统改造计划 |
| `p0-layer1-three-features.md` | ❓ 未知 | — | — | P0 三合一计划：相对时间前缀 + HTML 格式化注入 + 多样性过滤 |
| `p1-1-retrieval-cache.md` | ⏳ 未开始 | 2026-07-14 | 2026-07-14 | P1-1: 检索分词 + BM25 索引缓存 |
| `p1-2-shallow-copy.md` | ⏳ 未开始 | 2026-07-14 | 2026-07-14 | P1-2: 检索结果深拷贝改浅拷贝 |
| `performance-optimization-overview.md` | 🔄 进行中 | 2026-07-14 | 2026-07-14 | NE-Memory 性能优化总览 |
| `plan-p0-1-github-actions-ci.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P0-1：GitHub Actions CI 实施计划 |
| `plan-p0-2-version-check-script.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P0-2：版本一致性校验脚本实施计划 |
| `plan-p0-3-single-source-of-truth.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P0-3：文档单一事实源落地实施计划 |
| `plan-p1-1-git-cliff-changelog.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P1-1：git-cliff 半自动 CHANGELOG |
| `plan-p1-2-archive-status-docs.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P1-2：一次性状态文档归档（STATUS.md / VERIFY.md） |
| `plan-p1-3-commitlint-gate.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P1-3：commitlint 提交门禁 |
| `plan-p2-1-adr.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P2-1：ADR 架构决策记录 |
| `plan-p2-2-module-readme-coverage.md` | ✅ 已完成 | 2026-08-16 | 2026-08-16 | P2-2：模块级 README + c8 覆盖率门禁 |
| `plan-settings-persistence.md` | ❓ 未知 | — | — | 计划：NE-Memory 设置跨设备持久化 |
| `plan-stm-llm-call-reduction.md` | ✅ 已完成 | 2026-06-15 | 2026-06-25 | STM 管线 API 调用次数优化 — 实施计划 |
| `prod-build-dev-stripping.md` | ✅ 已完成 | 2026-07-14 | 2026-07-14 | 生产构建 dev 代码剥离计划 |
| `resolver-batch-granularity-plan.md` | ✅ 已完成 | 2026-08-19 | 2026-08-19 | D 臂 resolver 批量粒度成本-效果曲线实验（K=1/2/4/8，找最佳平衡点） |
| `resolver-capacity-quality-plan.md` | ✅ 已完成 | 2026-08-19 | 2026-08-19 | Resolver 容量与质量两阶段测试计划（事件文本量 × 条数 × max_tokens，找处理上限） |
| `restore-per-chunk-loop.md` | ❓ 未知 | — | — | Plan: 恢复 per-chunk 循环 + STM→LTM 严格串行 |
| `restore-stm-multi-event.md` | ✅ 已完成 | 2026-06-16 | 2026-06-24 | 修复计划：恢复 STM 摘要管线多批次录入能力 |
| `retrieval-quality-test-plan.md` | ✅ 已完成 | 2026-08-17 | 2026-08-18 | NE-Memory 检索质量测试计划（T0 / T1 / T2） |
| `rollback-buttons-and-scheme-editor.md` | ❓ 未知 | — | — | 计划：版本回退按钮外移 + 方案编辑器从当前状态开始 |
| `split-state-memory-vault.md` | 🔄 进行中 | 2026-07-10 | 2026-07-10 | 拆分 State / Memory Vault + 消除并行写冲突 |
| `state-template-sync-fix.md` | ❓ 未知 | — | — | State-Template 同步修复计划 |
| `stm-fallback-time-scene-from-dialogue.md` | ✅ 已完成 | 2026-06-17 | 2026-06-23 | 修复计划：BANNER 缺失时 STM LLM 从对话正文推断时间/场景 |
| `stm-inline-edit-stacked-layout.md` | 🔄 进行中 | 2026-07-24 | 2026-07-24 | STM 行编辑模式 — 字段纵向分行布局 |
| `stm-structure-finalize.md` | ✅ 已完成 | 2026-07-23 | 2026-07-23 | STM 结构重构收尾计划：编辑模式 + 注入 + 测试 |
| `stm-structure-refactor.md` | 🔄 进行中 | 2026-07-23 | 2026-07-23 | STM 结构重构：present_characters 与 character_psyche 提升为正式字段 |
| `template-copy-management-plan.md` | ❓ 未知 | — | — | 模板副本管理：删除 + 去重 + UI 简化 |
| `template-panel-ux-optimization.md` | 🔄 进行中 | 2026-07-13 | 2026-07-13 | 模板库面板 UI/UX 优化方案 |
| `token-classification-fix.md` | ❓ 未知 | — | — | Token 统计分类修复 + SmartPush 死代码清理 |
| `unified-template-panel-restructure.md` | ❓ 未知 | — | — | 模板管理面板统一化重构 |
| `unify-st-message-id-v2.md` | ❓ 未知 | — | — | 统一 ST 消息身份标识 v2：以 send_date + role 为规范 ID |
| `unify-state-memory-top-ui.md` | ❓ 未知 | — | — | 统一 State / Memory 面板顶层 UI 结构 |
| `wire-template-llm-to-state-pipeline.md` | ❓ 未知 | — | — | 接线：模板 LLM → State 管线（补漏计划） |
| `第七批-R系列检索与注入性能优化计划.md` | ✅ 已完成 | 2026-08-09 | 2026-08-09 | 第七批：R 系列检索与注入性能优化（R1~R7） |
| `第三批-卡顿根治-UIP优化计划.md` | ✅ 已完成 | 2026-08-01 | 2026-08-01 | 第三批：卡顿根治（UIP-1 / UIP-2 / UIP-3） |
| `第五批-P0-2至P0-4修复计划.md` | ✅ 已完成 | 2026-08-07 | 2026-08-07 | 第五批：P0-2 / P0-3 / P0-4 修复计划 |
| `第八批-P系列管线与遥测性能优化计划.md` | ✅ 已完成 | 2026-08-09 | 2026-08-09 | 第八批 — P 系列（管线与遥测）性能优化计划 |
| `第六批-D系列存储层性能优化计划.md` | ✅ 已完成 | 2026-08-08 | 2026-08-09 | 第六批：D 系列存储层性能优化（D1~D8） |
| `第四批-余下UI问题修复计划.md` | ✅ 已完成 | 2026-08-01 | 2026-08-07 | 第四批：余下 UI 问题修复计划（UI-8 / UI-10 / UI-11 / UI-12） |
| `算法优化分析报告.md` | ❓ 未知 | — | — | NE-Memory 算法优化分析报告 |

---

所有文件位于 `.trae/documents/`。在文件树中定位该目录即可查看。

### 统计
- ✅ 已完成：46
- 🔄 进行中：13
- ⏳ 未开始：5
- ❓ 未标记：19
