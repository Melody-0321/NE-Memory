---
name: pipeline-state-02
folder: pipeline-state-02
title: State 预分配 + flat object 格式验证
objective: 验证 State 管线输出使用 flat object 格式（非 array）、_checkpoints 始终出现、LLM 不自创字段名
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: not_contains, target: pipeline_changes, value: '"path"' }
  - { op: not_contains, target: pipeline_changes, value: '"value"' }
  - { op: exists, target: pipeline_responses }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
  - { op: exists, target: stm_events }
semantic:
  - "State 管线的输出中，_checkpoints 是否始终出现（即使在 state_changes 为空的轮次）？"
  - "state_changes 是否使用了 flat object 格式（如 {\"time\":\"黎明\",\"scene\":\"山路\"}）而非 [{\"path\":...,\"value\":...}] 数组格式？"
  - "提取的字段路径是否都是系统预分配的字段名（如 time, scene, story_date, main_event, characters.xxx.status 等），没有 LLM 自创的字段名？"
  - "state_changes 中是否没有出现 present_characters（应由系统自动生成）？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# pipeline-state-02: State 预分配 + flat object 格式验证

## 目标
验证 State 管线在预分配架构下正确工作：
1. LLM 输出的 `state_changes` 使用 flat object 格式（不再是 `[{"path":...,"value":...}]` 数组）
2. `_checkpoints` 始终出现（即使在 state_changes 为空的轮次）
3. LLM 不创造新的字段名（只使用系统预分配的路径）
4. `present_characters` 不会出现在 state_changes 中

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- **State Schema 已开启**（预设模式）
- 角色卡加载完毕（确保 vault 已初始化，state 结构已预分配）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：跟随 AI 故事，让 Driver 进行正常互动。每 1-2 轮发生一个自然的小变化（换场景、情绪波动、新人物短暂出现等），让 State 管线有 state_changes 可输出。注意至少有几轮 state_changes 为空（无变化），以验证 _checkpoints 在零变化轮次也能正确输出。不需要复杂剧情——2-3 个角色的自然日常即可。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化输出 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `not_contains: pipeline_changes ["path"]` | **不使用旧的 array 格式**（`[{"path":...}]` 格式会包含字符串 `"path"`） |
| 5 | `not_contains: pipeline_changes ["value"]` | **同上，旧格式的 `"value"` 键不应出现** |
| 6 | `exists: pipeline_responses` | pipeline 响应完整 |
| 7 | `not_contains: pipeline_responses [undefined]` | 响应无破碎 |
| 8 | `exists: stm_events` | STM 管线独立正常运行（state_changes 已从 STM prompt 移除） |

### 语义性断言（LLM 评估 trace）
1. State 管线的输出中，`_checkpoints` 是否始终出现（即使在 `state_changes` 为空的轮次）？
2. `state_changes` 是否使用了 flat object 格式（如 `{"time":"黎明","scene":"山路"}`）而非 `[{"path":...,"value":...}]` 数组格式？
3. 提取的字段路径是否都是系统预分配的字段名（如 `time`, `scene`, `story_date`, `main_event`, `characters.xxx.status` 等），没有 LLM 自创的字段名？
4. `state_changes` 中是否没有出现 `present_characters`（应由系统自动生成）？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 与 pipeline-state-01 的区别
- pipeline-state-01：验证 State 管线**能否运行**（基础健康检查）
- pipeline-state-02：验证 State 管线**输出格式正确**（flat object、_checkpoints、不自创字段）

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-02')
```
