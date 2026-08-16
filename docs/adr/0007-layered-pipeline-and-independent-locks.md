# Layered Pipeline with Independent Locks

- 状态：已接受（v5.6 落地）
- 日期：2026-06-30（`11fab08` v5.6 pipeline 拆分）

## 背景（Context）

早期 `update.js` 是 1743 行的单体编排器，State / STM / LTM 三条管线在单一大流程里**串行**执行：

- **互相阻塞**：任一条管线耗时都会拖住其他管线，轮次处理串行化。
- **单点脆弱**：编排逻辑全集中在一处，一处出错影响全部管线。
- **不可并行**：State 提取与 STM 提取本可并发，却被串行锁住。

## 决策（Decision）

将单体编排器拆分为分层管线 + 独立锁体系（`src/core/engine/`）：

- **三管线拆分**：`stm-pipeline.js` / `state-pipeline.js` / `ltm-pipeline.js` 各管一层（对应 0006 分层记忆）。
- **`pipeline-guard.js` 状态机**：per-pipeline 独立队列/锁，STM 与 State 可**并行**执行，互不阻塞。
- **队列毒化防护**：enqueue 链从 `.then(success, rejection)` 双参数链改为 `.then(success).catch(failure)`——单个任务失败不再毒化队列，后续任务照常执行；失败经 `addAnomaly` 入 telemetry + console.error，尾部 catch 吞错保链 resolved。
- **重入守卫**：`_keyNavBound` / `__ne_booted` 等防重复注册，避免 init 双跑。
- 共享工具抽到 `pipeline-shared.js`。

## 后果（Consequences）

**正面**

- State 与 STM 并行执行，轮次处理延迟降低。
- 单管线失败不影响其他管线与后续任务（队列毒化根因修复）。
- 编排状态机可测（pipeline-guard 单测覆盖任务 A 抛错后 B/C 仍按序执行）。

**负面**

- 编排器状态机复杂：队列/锁/重置边界需严谨维护（`reset()` 语义、`waitForPipelineTrackIdle`）。
- 并行写需配合存储拆分（0003），否则仍会互相覆盖。

**关联**

- 前置决策：[0006-layered-memory-architecture.md](./0006-layered-memory-architecture.md)
- 配套决策：[0003-split-state-memory-vault.md](./0003-split-state-memory-vault.md)
