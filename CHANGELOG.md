# Changelog

## v6.0.0 (2026-07-03)

### Pipeline 泄漏修复

修复 Driver LLM 输出 `<!--NE-CHAR-->` 伪造角色状态数据的三跳泄漏链路。`stripFormatTags` 和 `cleanAiReply` 在发送消息前剥离 NE-CHAR 块，防止 `consumeNeCharBlocks` 将 Driver 产出的 `affection_delta` / `inner_thoughts` 误作为真实数据写入 vault state。NE-BANNER 不做剥离——它属于 Driver 从协作文本中习得的格式模仿，被 STM 管线作为对话原文正常消费。

修复 STM < 15 条时绕过 BM25 导致检索全 0 命中的 bug。绕过路径遗漏 `__relevance` 赋值，下游 `hitCount` 统计依赖 `relevance > 0` 判断命中，全部条目被误判为未命中。在 bypass 和 fallback 两条路径中补设 `__relevance = 1`。

### Token 消耗优化

砍掉 STM 管线 prompt 中 `## 角色心理状态` 段（`buildBatchPrompt` 和 `buildStmSummaryPrompt`）。该段落来自 Main LLM 的 NE-CHAR 输出，对 Pipeline LLM 的事件提取和边界判定无实际帮助，每批次节省 200-400 tokens。

LTM 叙事弧生命周期重构：开放弧不再逐轮更新 `title` / `event`，改用空白占位符（UI 显示绿色 `[进行中]` 标签）；闭合时 LLM 才为刚闭合的弧填写标题和摘要（挽联）。每条 `ltm_decision` 调用节省 120–240 tokens。`createMinimalLtm` fallback 同步改为返回空。修复 `close_and_new` 丢弃 LLM 输出的 bug——旧弧闭合前先接收 LLM 的命名（`updated_title`/`updated_event`）。

### 设置面板重构

移除已稳定的两个复选框开关（Enable State Schema、Enable Smart Retrieval），两项功能改为始终启用。对话轮数注入控制（`dialog_round_injection_control`）及其 override 复选框移至 Engine 折叠区顶部。修复向量搜索复选框触发 `renderSettingsTab()` 全量重渲染导致所有折叠区意外闭合的 bug——改为 `display` toggle 而非条件渲染。向量搜索区域补全 `en` / `zh-cn` / `zh-tw` 三个语言分支的 i18n 键（section 标题、按钮文本、状态提示）。

### 管线架构 v5.6（未发布）

Pipeline 模块拆分：`update.js`（1743→400 行）拆分为 `stm-pipeline.js`（640 行）、`state-pipeline.js`（768 行）、`ltm-pipeline.js`（129 行）、`pipeline-guard.js`（32 行）、`pipeline-shared.js`（191 行）。各管线独立 `tryAcquire` 锁，STM/State 可并行执行。实体模型简化：`index.js` 统一类型索引（`src/types.js`），事件实体从 3 级嵌套展平为单层数组。

SmartPush 检索重构：注入格式从"LLM 叙事散文合成"切换为"HL+GP 代码拼装实体链块"。`buildEntityBlock` 自动生成按实体分组的记忆分块文档（实体记忆链 + KB 标注），取消递归 gapfill 和检索 LLM 合成阶段，移除 Secondary API 配置分拆。对话轮数截断替代纯 token-budget 截断作为备选方案。`retrieval-fusion.js` 实现 BM25+Vector RRF 混合检索（α=0.20 BM25 权重，k=60），`retrieval-filter.js` 增加分数断崖截断（ratio > 5x 且 pctOfTop < 25%）和降噪重排。

Panel 模块化：`panel.js`（2889 行）拆分为 8 个独立模块——`panel-init.js`、`panel-content.js`、`panel-state-cards.js`、`panel-settings.js`、`panel-drawer.js`、`panel-shared.js`、`panel-tools.js`、`panel-usage.js`。Entity 面板移除，usage tab 滚动修复。

### 向量搜索增强

Embedding API 一键预设（SiliconFlow 免费 BAAI/bge-m3），质量测试替代基础连通性验证（嵌入测试集 → 相似查询 → 验证最高相似度结果排序正确）。向量/RRF 管线监控暴露 `_vectorUsed` + candidate counts 到 debug globals。垃圾回收器（`garbage-collector.js`）处理消息删除和 vault 回滚的级联清理。

### 测试体系

smartpush-14 全链路冒烟：断言从 21 条精简至 18 条，移除过时的 `smartpush_prompt`（Memory LLM 未实现）和 `## 记忆使用指南`（HL+GP 格式不生成）断言。冒烟评估 6 条语义断言转为结构性断言，新增 truncation/fallback 计数器监控，evaluator 从 ST 主 API 切换为自有 Secondary API 避免 `isGenerating` 锁冲突。测试用例 27 套全部通过。

### 移除

- Dead 工具（`update_state`、`rollback_memory`）
- Dead classifier 代码（`context-window.js`，70 行）
- Dead `stm-extractor.js`（224 行，由 `stm-pipeline.js` 替代）
- `pipeline-state-04` 测试用例
- smartpush-09/10/11 测试用例（被重构覆盖）
- `entity panel` UI 组件
