---
name: pipeline-state-02
folder: pipeline-state-02
title: State Banner 指令格式 + 提取完整性
objective: 验证 NE-BANNER 管道格式指令引入、Main LLM 能输出 | 分隔的状态数据、onMessageReceived 正确提取，全局正则静态 HTML 包装正确
preconditions:
  - NE-Memory 已初始化，State Schema 已开启
  - 副 API 可用
  - build 含管道格式（commit 之后）
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
  - "Main LLM 是否在回复开头输出了 <!--NE-BANNER-->...<!--/NE-BANNER--> 管道格式的状态数据？"
  - "onMessageReceived 的管道正则是否正确提取了 scene/time/day/event/chars？"
  - "pipeline_changes 是否记录了状态更新（验证 pending_state_block → vault 链路未断裂）？"
minRounds: 3
maxRounds: 8
expectedRounds: "4-6"
timeoutPerRound: 120000
---

# pipeline-state-02: State Banner 指令格式 + 提取完整性

## 目标
LLM 输出管道格式 `<!--NE-BANNER-->场景|时间|天数|事件|角色<!--/NE-BANNER-->`，
ST 全局正则（replaceString 静态 HTML 模板）自动包装为完整 banner HTML，
自然渲染到 `.mes_text`，`onMessageReceived` 从管道路提取结构化数据。

## 前置条件
- NE-Memory 已初始化，State Schema 已开启
- 副 API 可用
- 全局正则 `ne-state-banner-v5` 已注册（icon+label 行布局，v5=卡片式 UI）
- 角色卡包含至少 1-2 个角色

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

引导策略：自然推进 4-6 轮对话，给 State 管线时间提取变化。当 `pipeline_changes` 有内容且 `state_block_instruction` 存在后即可结束。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: state_block_instruction` | onBeforeGenerate 注入了指令 |
| 2 | `contains: <!--NE-BANNER-->` | 开始标记存在 |
| 3 | `contains: <!--/NE-BANNER-->` | 闭合标记存在 |
| 4 | `contains: \|` | 管道分隔符存在 |
| 5 | `contains: 场景\|` | 格式提示包含场景字段 |
| 6 | `contains: 天数只写数字` | 天数格式约束存在 |
| 7 | `exists: pipeline_changes` | State 管线执行过 |
| 8 | `not_contains: "error"` | 无报错 |

### 语义性断言（LLM 评估 trace）
1. Main LLM 是否在回复开头输出了 `<!--NE-BANNER-->...<!--/NE-BANNER-->` 管道格式的状态数据？
2. `onMessageReceived` 的管道正则是否正确提取了结构化数据？
3. `pipeline_changes` 是否记录了状态更新？

## 运行参数
- minRounds: 3
- maxRounds: 8
- expectedRounds: 4-6
- timeoutPerRound: 120000

## 说明

管道格式设计：
```
LLM 输出:  <!--NE-BANNER-->公寓阳台|2024-05-21 21:35|1|稿费争执|安然、江岚<!--/NE-BANNER-->
          ↓ ST 全局正则（messageFormatting，文本阶段）
          ↓ replaceString 静态 HTML 模板（$1-$5 替换捕获组）
          ↓
渲染:     <div class="ne-state-banner" data-scene="公寓阳台" data-time="..."
          <span class="ne-state-scene">📍 公寓阳台</span> ...
```

LLM 只需输出 ~50-80 字符管道数据，正则负责完整 ~500 字符 HTML 包装。

在 ST 实际环境中，需目视确认 banner 卡片正确渲染（CSS 样式 + 全局正则解包）。

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-02')
```
