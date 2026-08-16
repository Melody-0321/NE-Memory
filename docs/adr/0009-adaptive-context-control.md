# Adaptive Context Control

- 状态：已接受（v7.2 落地）
- 日期：2026-07-17（自适应上下文控制计划启动，`8879b40` 2026-07-22 实现落地）

## 背景（Context）

NE-Memory 有 6 个注入源（stateTable / contextMemory / memoryVault / dialogue window 等），各源 Token 消耗不可控。对话变长时：

- **上下文溢出**：所有层无条件注入，超长上下文触发 token 溢出或被截断，记忆质量下降。
- **静态窗口不够**：固定对话轮数或固定注入量无法适配不同对话的预算差异。
- **注入策略不透明**：压缩/展开按固定顺序，无法感知哪一层偏离预算最大。

## 决策（Decision）

引入**注入预算控制系统（Plan C）**，动态控制各可压缩层的 Token 占用（`src/core/engine/adaptive-context.js`）：

- **Golden Context Window**：按 token 预算动态选择传入 LLM 的记忆条目，优先高相关性内容。
- **对话轮数裁剪（dialogWindowRounds）**：主控对话历史压缩——`chat-completion-patch.js` 经 `CHAT_COMPLETION_PROMPT_READY` 事件在 API 层预压缩历史，dryRun UI 与 Prompt Manager 同步显示裁剪结果。
- **轮转细化（rotation thinning）**：动态选择与预算偏差最大的层做压缩/展开，而非固定顺序。
- **压缩层排序**：优先压缩对话层；dialogWindowRounds 有硬上限（滑杆）与下限（4 轮）。
- **防空转**：no-progress 检测（本轮 token 无变化即 break）+ layers 源头过滤（无缓存层不入候选），根治空转死循环。
- **仅摘要模式（summaryOnlyMode）**：可选只记录不注入，规避角色卡变量冲突。

## 后果（Consequences）

**正面**

- 上下文受控：token 预算内动态压缩/展开，避免溢出导致的记忆丢失。
- 自适应：不依赖固定窗口，按实际预算与各层饱和情况调整。
- 与既有检索/注入解耦：压缩后各注入源重建并重注入（覆盖旧条目）。

**负面**

- **与原参数体系互斥**：新系统与旧上下文控制不兼容，需 `ne_settings.adaptiveContextEnabled` 开关让用户二选一。
- 多数原参数不兼容新系统，需新参数集 + UI 面板集成。
- 压缩/展开后的注入源重建增加状态一致性维护成本。

**关联**

- 前置决策：[0006-layered-memory-architecture.md](./0006-layered-memory-architecture.md)
