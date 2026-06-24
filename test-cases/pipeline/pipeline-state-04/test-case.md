---
name: pipeline-state-04
folder: pipeline/pipeline-state-04
title: "⚠ DEPRECATED — ne_context_memory 已移除"
objective: 本测试已废弃。ne_context_memory 注入（formatContextMemory 直接 dump STM/LTM 到 Main LLM）已于 commit f5eb1ab 中移除。context_memory 监控目标将始终为空。
preconditions:
  - N/A（已废弃）
structural: []
semantic: []
minRounds: 0
maxRounds: 0
expectedRounds: "N/A"
timeoutPerRound: 0
---

# ⚠ pipeline-state-04: 已废弃

## 废弃原因

`ne_context_memory` 注入已于 [f5eb1ab](https://github.com/your-repo/commit/f5eb1ab) 移除。

旧逻辑：`formatContextMemory(vault, chatMessages, contextWindowRounds)` 在 `onBeforeGenerate` 中无差dump STM + LTM 条目到 Main LLM 的 system prompt，与 SmartPush 检索合成功能重复。

移除后，`context_memory` 监控目标始终为空，所有依赖 `exists: context_memory` / `contains: context_memory` 的断言必定失败。

## 替代

不再需要此测试。SmartPush 的检索合成 + `ne_memory_vault` 已覆盖记忆注入功能。

## 日期

deprecated: 2026-06-25
