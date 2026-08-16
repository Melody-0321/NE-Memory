# Memory Lifecycle Equals Conversation Lifecycle

- 状态：已接受（v7.0 落地，vNext 收尾）
- 日期：2026-07-11（`80b4f2f` 聊天删除全清理；2026-08 移除 orphaned_branches 死机制收尾）

## 背景（Context）

记忆数据需要明确的生命周期，否则会产生与对话无关的**孤儿数据**与**反模式**：

- **孤立分支**：早期 `orphaned_branches` store 设想"回滚后保存可恢复的孤立分支"，但其写入生产者从未存在，`restoreBranch`/`cleanupBranches` 无任何调用方——是纯死代码。
- **删除不彻底**：删除聊天时若只清部分 store，`state_vaults`/`memory_vaults`/delta 链会残留孤儿数据，GC 清理面不完整（曾漏 memory_vaults）。
- **"恢复已删除记忆"反模式**：回滚到已删除/已压缩版本违背"记忆跟随对话"的直觉，还会损坏版本链（head delta 物理删除、base_seq 归零）。

## 决策（Decision）

确立产品原则：**记忆生命周期 = 对话生命周期**。

- **删对话 → 记忆物理删除**：`80b4f2f` 删除聊天时全量清理关联 IndexedDB（`state_vaults`+`memory_vaults`+所有 delta/versions）+ localStorage。
- **重掷 / swipe / 编辑 → 版本链回退 + 重新提取跟随版本**：`onMessageSwiped` 回退相关版本并重新提取，而非保留可恢复分支（`e0f03b8` 回滚直接删除 delta 记录，不再创建孤儿分支）。
- **移除 orphaned_branches 死机制**：删除 `restoreBranch`/`cleanupBranches`/`pruneOrphanedBranches` 三函数 + state-pipeline 调用 + `BRANCH_TTL_MS` 死变量；store 定义保留（避免 IDB schema 变更），`remove(chatId)` 中的防御性清理保留。
- **拒绝回滚到已归档版本**：`evaluateRollbackTarget` 统一拒绝 archived 目标（P2-1 折叠归档守卫）。

## 后果（Consequences）

**正面**

- 存储自洽：无孤儿数据累积，GC 覆盖面完整。
- 直觉一致：记忆行为跟随对话（删了就没，重掷就回退重来），用户心智负担低。
- 消除死代码：移除从未被调用的分支恢复机制，简化数据模型。

**负面**

- 设计取舍：**彻底放弃"恢复已删除记忆"能力**——对误删保护较弱的场景不友好。
- 回滚语义更严格：越界/已归档回滚被拒，需面板置灰 + toastr 提示引导。

**关联**

- 前置决策：[0001-snapshot-to-delta-version-chain.md](./0001-snapshot-to-delta-version-chain.md)
