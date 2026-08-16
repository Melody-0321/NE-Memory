# Architecture Decision Records (ADR)

NE-Memory 的核心架构决策记录。每则 ADR 使用 Michael Nygard 标准模板（Status / Context / Decision / Consequences），记录决策的**背景、权衡与结果**，而非仅记录结论。

## 记录列表

| # | 文件 | 主题 | 决策日期 | 落地版本 | 关联 |
|---|------|------|---------|---------|------|
| 0001 | [快照→Delta 版本链](./0001-snapshot-to-delta-version-chain.md) | 全量快照替换为增量 delta 版本链 | 2026-07-09 | v6.0 | → 0003 |
| 0002 | [开放角色 Schema](./0002-open-character-schema.md) | 硬编码字段扩展为三层开放体系 | 2026-06-10 | v7.0 | — |
| 0003 | [State/Memory Vault 拆分](./0003-split-state-memory-vault.md) | 单一 vault 拆为 state_vaults + memory_vaults | 2026-07-10 | v7.0 | ← 0001 |
| 0004 | [消息身份系统](./0004-message-identity-system.md) | 基于下标 → 稳定 msg-id | 2026-07-09 | v7.0 | — |
| 0005 | [纯本地 SmartPush 检索](./0005-local-smartpush-retrieval.md) | LLM 合成检索 → 纯本地 BM25/RRF 管线 | 2026-07-01 | v6.0 | — |
| 0006 | [分层记忆架构](./0006-layered-memory-architecture.md) | STM/LTM/State 三层记忆体系 | 2026-05-30 | v0.2.0 起 | → 0007 |
| 0007 | [分层管线+独立锁](./0007-layered-pipeline-and-independent-locks.md) | update.js → 三管线 + pipeline-guard 并行 | 2026-06-30 | v5.6 | ← 0006 |
| 0008 | [记忆生命周期=对话生命周期](./0008-memory-lifecycle-equals-conversation-lifecycle.md) | 删对话→删记忆，移除 orphaned_branches | 2026-07-11 | v7.0/vNext | ← 0001 |
| 0009 | [自适应上下文控制](./0009-adaptive-context-control.md) | 注入预算 + 对话轮数裁剪 + 轮转细化 | 2026-07-17 | v7.2 | ← 0006 |

## 如何新增 ADR

1. 确定下一个序号（查看 `docs/adr/` 下的最大序号）
2. 复制模板结构，填入 `NNNN-english-title.md`
3. 内容写四段式：**状态**（已接受/提议/已废弃，含版本）→ **背景**（问题与权衡）→ **决策**（具体方案）→ **后果**（正面/负面+关联 ADR）
4. 更新本 README 索引和 `CODE_WIKI.md` ADR 小节