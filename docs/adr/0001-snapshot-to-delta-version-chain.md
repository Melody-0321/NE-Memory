# Snapshot to Delta Version Chain

- 状态：已接受（v6.0 落地）
- 日期：2026-08-16

## 背景（Context）

早期版本用 `versions.js` 的全量快照管理 State/Memory 历史：每次管线产出将整个 vault JSON（50-200KB）拷贝为一份快照，最多保留 30 份。带来的问题：

- **写放大严重**：每轮管线变更都全量落盘 50-200KB，Token/磁盘/IndexedDB 写入成本高。
- **无细粒度追踪**：快照只有"整份 vault"粒度的历史，无法区分 State 与 Memory 的独立变更轨迹。
- **回滚粗糙**：回滚到任意快照意味着整体替换 vault，丢失精细增量信息，也不利于 diff 审计。

## 决策（Decision）

以增量 Delta 版本链取代全量快照，`src/core/vault/state-versions.js` 成为 State 与 Memory 共用的统一版本链引擎：

- 每次管线产出仅记录 160B ~ 1.5KB 的 delta（变更字段 + seq + summary），而非全量拷贝。
- 三个 IndexedDB ObjectStore：`state_deltas`、`memory_versions`、`active_chains`（`DB_VERSION` 5→6 强制创建）。
- 核心操作：`recordStateDelta` / `recordMemoryVersion` 追加增量、`foldState` 折叠物化、`rollbackState`/`rollbackMemory` 精确回滚、`compact` 压缩归档（`COMPACT_THRESHOLD=100`、`MAX_ACTIVE_VERSIONS=500`）。
- State 与 Memory 各维护独立版本链，互不干扰。

## 后果（Consequences）

**正面**

- 写放大骤降：每轮写入从 50-200KB 降到 KB 级。
- 精确回滚：支持按 seq 回退到任意历史点，配合折叠归档守卫，拒绝回滚到已压缩版本。
- 变更可追溯：delta 天然携带"改了什么"的语义，支撑审计与版本历史面板。

**负面**

- 迁移复杂度：v5 → v6 需要为存量库创建新 store，`onupgradeneeded` 需处理残留旧 store。
- 折叠/压缩语义需仔细维护（折叠起点、base_seq、head delta 含 folded_state），否则链损坏。
- 版本链机制随后被 0003（Vault 拆分）进一步拆分吸收；`orphaned_branches` 孤立分支机制因产品原则（记忆生命周期=对话生命周期）最终移除。

**关联**

- 后续决策：[0003-split-state-memory-vault.md](./0003-split-state-memory-vault.md)
