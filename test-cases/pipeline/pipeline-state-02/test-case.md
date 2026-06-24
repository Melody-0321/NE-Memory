---
name: pipeline-state-02
folder: pipeline/pipeline-state-02
title: State Banner 管道格式 + 提取完整性
objective: 验证 NE-BANNER 管道格式指令注入、Main LLM 输出 | 分隔的状态数据、onMessageReceived 正确提取
preconditions:
  - NE-Memory 已初始化，State Schema 已开启
  - 副 API 可用
structural:
  - { op: exists, target: state_block_instruction }
  - { op: contains, target: state_block_instruction, value: "<!--NE-BANNER-->" }
  - { op: contains, target: state_block_instruction, value: "<!--/NE-BANNER-->" }
  - { op: contains, target: state_block_instruction, value: "|" }
  - { op: contains, target: state_block_instruction, value: "场景|" }
  - { op: contains, target: state_block_instruction, value: "天数只写数字" }
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "Main LLM 是否在回复开头输出了 <!--NE-BANNER-->...<!--/NE-BANNER--> 格式的状态数据？"
  - "onMessageReceived 的管道正则是否正确提取了结构化数据到 vault？"
  - "pipeline_changes 是否记录了状态更新？"
minRounds: 3
maxRounds: 8
expectedRounds: "4-6"
timeoutPerRound: 120000
---

# pipeline-state-02: State Banner 管道格式

## 目标

验证 NE-BANNER 管道机制——Main LLM 输出 `<!--NE-BANNER-->场景|时间|天数|事件|角色<!--/NE-BANNER-->`，ST 全局正则自动渲染，`onMessageReceived` 提取结构化数据。

本次架构变更中，BANNER 管道格式本身未变。验证在所有其他注入变更后该管道仍然工作。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: state_block_instruction` | BANNER 指令已注入 |
| 2 | `contains: <!--NE-BANNER-->` | 开始标记存在 |
| 3 | `contains: <!--/NE-BANNER-->` | 闭合标记存在 |
| 4 | `contains: \|` | 管道分隔符存在 |
| 5 | `contains: 场景\|` | 格式包含场景字段 |
| 6 | `contains: 天数只写数字` | 天数约束 |
| 7 | `exists: pipeline_changes` | State 管线执行过 |
| 8 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. Main LLM 是否在回复开头输出了管道格式的状态数据？
2. onMessageReceived 的管道正则是否正确提取了结构化数据？
3. pipeline_changes 是否记录了状态更新？

## 运行参数

- minRounds: 3
- maxRounds: 8
- expectedRounds: 4-6
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-02')
```
