---
name: pipeline-state-02
folder: pipeline-state-02
title: State Banner 指令格式 + 提取完整性
objective: 验证 NE-BANNER 指令格式引入、Main LLM 能输出 data-* 标记的 banner HTML、onMessageReceived 正确提取
preconditions:
  - NE-Memory 已初始化，State Schema 已开启
  - 副 API 可用
  - build 含 NE-BANNER 格式（commit 514c991 及之后）
structural:
  - { op: exists, target: state_block_instruction }
  - { op: contains, target: state_block_instruction, value: "<!--NE-BANNER-->" }
  - { op: contains, target: state_block_instruction, value: "<!--/NE-BANNER-->" }
  - { op: contains, target: state_block_instruction, value: "data-scene" }
  - { op: contains, target: state_block_instruction, value: "data-time" }
  - { op: contains, target: state_block_instruction, value: "data-day" }
  - { op: contains, target: state_block_instruction, value: "data-event" }
  - { op: contains, target: state_block_instruction, value: "data-chars" }
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "Main LLM 的回复是否包含 <!--NE-BANNER--> 格式的 banner HTML（带 data-scene / data-time / data-day / data-event / data-chars 属性）？"
  - "onMessageReceived 的 data-* 提取正则是否正确提取了 scene/time/day/event/chars？"
  - "pipeline_changes 是否记录了状态更新（验证 pending_state_block → vault 链路未断裂）？"
minRounds: 3
maxRounds: 8
expectedRounds: "4-6"
timeoutPerRound: 120000
---

# pipeline-state-02: State Banner 指令格式 + 提取完整性

## 目标
切换 `<!--NE-STATE:场景,时间,...-->` → `<!--NE-BANNER--><div data-scene="...">...</div><!--/NE-BANNER-->`
后，验证 LLM 收到的指令格式正确，且 onMessageReceived 的 data-* 提取正则正常工作。

## 前置条件
- NE-Memory 已初始化，State Schema 已开启
- 副 API 可用
- 全局正则 `ne-state-banner-v1` 已注册（首次刷新自动完成）
- 角色卡包含至少 1-2 个角色

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

引导策略：自然推进 4-6 轮对话，给 State 管线时间提取变化。当 `pipeline_changes` 有内容且 `state_block_instruction` 存在后即可结束。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: state_block_instruction` | onBeforeGenerate 注入了指令 |
| 2 | `contains: <!--NE-BANNER-->` | 格式标记存在 |
| 3 | `contains: <!--/NE-BANNER-->` | 闭合标记存在 |
| 4 | `contains: data-scene` | 场景属性存在 |
| 5 | `contains: data-time` | 时间属性存在 |
| 6 | `contains: data-day` | 天数属性存在 |
| 7 | `contains: data-event` | 事件属性存在 |
| 8 | `contains: data-chars` | 角色属性存在 |
| 9 | `exists: pipeline_changes` | State 管线执行过 |
| 10 | `not_contains: "error"` | 无报错 |

### 语义性断言（LLM 评估 trace）
1. Main LLM 的回复是否包含 `<!--NE-BANNER-->` 格式的 banner HTML？
2. `onMessageReceived` 的 data-* 提取正则是否正确提取了结构化数据？
3. `pipeline_changes` 是否记录了状态更新？

## 运行参数
- minRounds: 3
- maxRounds: 8
- expectedRounds: 4-6
- timeoutPerRound: 120000

## 说明

本测试验证 commit 514c991 及之后版本中 NE-BANNER 格式的完整性：
- `registerGlobalBannerRegex` 已向 `extensionSettings.regex` 写入全局正则
- `onBeforeGenerate` 注入的 LLM 指令使用 `<!--NE-BANNER-->...<!--/NE-BANNER-->` 格式
- `onMessageReceived` 的正则匹配 `data-scene="..."` 等属性

在 ST 实际环境中验证时，还需目视确认 banner 卡片在消息气泡内正确渲染
（`_ensureBannerCSS` 注入样式正确，全局正则解包注释正确）。

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-02')
```
