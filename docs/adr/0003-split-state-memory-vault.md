# Split State / Memory Vault

- 状态：已接受（v7.0 落地，v8.0 修补）
- 日期：2026-08-16

## 背景（Context）

早期 `store.js` 用一个 `vaults` ObjectStore + `store.put()` 全量写入整份 vault JSON。State 与 STM/LTM 管线通过 per-pipeline 队列**并行**运行，各自 `read → modify → saveVault → put`，而 IndexedDB `put` 在 `keyPath: chat_id` 下**全量替换整条记录** → 后写者覆盖先写者，STM 提取的新记忆被 State 管线的写入静默覆盖。

此外单一 store 使 GC 扫描、Schema 校验、聊天删除清理等跨维度耦合：清理 State 必然扫到 Memory，反之亦然。

## 决策（Decision）

将单一 vault 拆为两个独立 ObjectStore（`DB_VERSION` 7）：

- `state_vaults`（State 专属）+ `memory_vaults`（STM/LTM 专属），各自独立读写，从根上消除并行写竞态。
- Delta 版本链 store 同步拆分：`state_deltas` / `memory_versions`（State 与 Memory 各维护独立链，对应 0001）。
- 迁移 `_migrateVaultsToSplit`：遍历旧 `vaults`，按字段归属拆建两条记录并做内容 hash 校验；空库/无 content 记录时**早退直接完成迁移**（P0-2，避免 Promise 永久挂起导致存储层冻结）。
- `DB_VERSION` 8 追加 force-reset：修补 v7 升级失败留下的空 store，从 chat metadata 恢复。

## 后果（Consequences）

**正面**

- 消除并行写冲突：State/STM 各自读改写，互不覆盖。
- 独立生命周期：GC、聊天删除清理、Schema 校验按维度隔离，互不干扰。
- 与 0001 的 delta 版本链天然对齐，读写路径更清晰。

**负面**

- 双 store 一致性：同一 chat 的 state 与 memory 分布在两条记录，读取需分别查询。
- 迁移面扩大：v6 → v7 → v8 多版本升级路径，`onupgradeneeded` 需处理残留旧 store（旧 `vaults` 标记废弃）。
- 旧 `vaults` store 定义保留（避免 IDB schema 变更），但不再写入。

**关联**

- 前置决策：[0001-snapshot-to-delta-version-chain.md](./0001-snapshot-to-delta-version-chain.md)
