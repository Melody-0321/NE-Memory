# Local SmartPush Retrieval

- 状态：已接受（v6.0 落地）
- 日期：2026-08-16

## 背景（Context）

v5.x 的 SmartPush 用 LLM 从候选记忆中**合成**注入文本（`formatSmartContext` 走 LLM）。问题：

- **额外 API 成本**：每次 LLM 生成前都要额外调用一次检索 LLM，Token 消耗随对话频率线性增长。
- **非确定性**：同一输入可能产出不同注入文本，行为不可复现、难测试。
- **依赖外部 API**：检索 LLM 不可用时 SmartPush 降级或失败，离线/弱网场景受限。
- **延迟**：同步等待 LLM 响应拉长注入路径。

## 决策（Decision）

`ce0fc40` 起删除 LLM 合成，SmartPush 改为**纯本地管线**：

- **BM25 检索**：纯本地词频/相关度打分，零 API。
- **可选向量 RRF 融合**：配置 Embedding 时，BM25 候选与向量候选按 Reciprocal Rank Fusion（k=60）融合；无 Embedding 时纯 BM25 兜底。
- **实体链分组**：候选按实体链（角色/势力等）分组，组织为结构化记忆链。
- **代码拼装注入**：`buildEntityBlock` 以 HL+GP 代码方式生成实体子标题 + 事件列表 + KB 标注，替代 LLM 散文合成。

## 后果（Consequences）

**正面**

- 零额外 API 成本：SmartPush 完全本地化，只有主对话 LLM 消耗 Token。
- 确定性 + 可测试：同一输入恒产出同一注入，支撑回归测试与可复现排障。
- 可离线/弱网可用：检索路径不再依赖额外 API 可用性。
- 注入格式稳定：代码拼装的实体链块比 LLM 散文更可控、更省 Token。

**负面**

- 失去 LLM 语义总结能力：注入文本由代码拼装而非语义润色。
- 缓解：语义理解由 STM（短期逐轮提取）与 LTM（长期叙事弧线合并）分层承担，检索层专注"召回 + 组织"而非"生成"。

**关联**

- 同步变更：注入格式从叙事散文切为实体链块；工具从 5 个精简为 `access` + `recall_memory`。
