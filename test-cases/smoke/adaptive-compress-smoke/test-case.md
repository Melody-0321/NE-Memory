---
name: adaptive-compress
folder: smoke/adaptive-compress-smoke
title: 自适应上下文压缩冒烟测试（超预算触发 dialog 裁剪）
objective: 验证 adaptive-context 在 CHAT_COMPLETION_PROMPT_READY 事件中正确触发，超预算时压缩 dialog 层到 floor=4，且 chat 数组被修改
preconditions:
  - NE-Memory 已初始化，自适应上下文控制已开启（设置面板 Engine 区）
  - 上下文质量档位设置为 balanced（平衡，50%/30%）或 cost（成本优先，40%/24%）
  - ST maxContext 设置为 8000-16000 tokens（黄金窗口按比例触发；maxContext × 档位比例 = goldenUpper，需在 10-12 轮内可达）
  - 副 API 可用（pipeline 需要运行以注入 NE 标记内容）
  - dialogWindowRounds 设置为 10 或以上（作为 ceiling）
structural:
  - { op: exists, target: adaptive_triggered }
  - { op: equals, target: adaptive_action, value: "compress" }
  - { op: min_length, target: adaptive_dialog_rounds_after, value: 4 }
  - { op: exists, target: adaptive_tokens_after }
  - { op: exists, target: smartpush_injection }
  - { op: exists, target: adaptive_golden_tier }
  - { op: min_length, target: adaptive_golden_upper, value: 1 }
  - { op: min_length, target: adaptive_golden_lower, value: 1 }
semantic:
  - "adaptive 压缩后 chat 是否仍包含最近 4 轮的关键对话内容？检查 adaptive_dialog_rounds_after 是否 >= 4 且最近对话的主题线索未被裁剪。"
minRounds: 8
maxRounds: 15
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# adaptive-compress: 自适应上下文压缩冒烟测试

## 目标
验证自适应上下文控制系统（Plan C）的端到端链路：
1. CHAT_COMPLETION_PROMPT_READY 事件正确触发 `adaptContextPostTrim`
2. 超预算时压缩 dialog 层（PRIMARY 压缩层）
3. 压缩后对话轮数 ≥ floor=4
4. chat 数组被原地修改（chatLengthAfter < chatLengthBefore）

## 前置条件
- NE-Memory 已初始化，自适应上下文控制已开启（设置面板 Engine 区勾选 "Adaptive Context Control"）
- 上下文质量档位设置为 balanced（平衡，50%/30%）或 cost（成本优先，40%/24%）
- ST maxContext 设置为 8000-16000 tokens（黄金窗口按比例触发；maxContext × 档位比例 = goldenUpper，需在 10-12 轮内可达）
- 副 API 可用（pipeline 需要运行以注入 NE 标记内容）
- dialogWindowRounds 设置为 10 或以上（作为 ceiling）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。

引导策略：
- 前 8 轮进行密集对话，每轮内容尽量丰富（描述场景、动作、对话、情感）
- 每轮回复至少 2-3 句话，确保 token 累积速度足够快
- 第 9 轮后观察 `adaptive_action` 是否变为 'compress'
- 若档位与 maxContext 设置合理（goldenUpper ≤ 8K），应在 10-12 轮内触发压缩

轮次参考：预期 10-12 轮内自然完成。低于 8 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

## 断言

### 结构性断言（8 条）
| 断言 | 含义 |
|------|------|
| `exists: adaptive_triggered` | adaptContextPostTrim 被实际调用（非短路退出） |
| `equals: adaptive_action = "compress"` | 压缩被触发（若 goldenUpper 过大此断言失败，需调小 maxContext 或选 cost 档） |
| `min_length: adaptive_dialog_rounds_after >= 4` | 压缩后对话轮数不低于 floor=4 |
| `exists: adaptive_tokens_after` | 压缩后 token 数被正确暴露 |
| `exists: smartpush_injection` | NE 注入正常工作（确保有 NE 标记内容可供压缩） |
| `exists: adaptive_golden_tier` | 黄金窗口档位被正确暴露（'quality' / 'balanced' / 'cost'） |
| `min_length: adaptive_golden_upper >= 1` | 压缩触发阈值为正数（可用预算 × 档位 upper 比例） |
| `min_length: adaptive_golden_lower >= 1` | 扩充触发阈值为正数（可用预算 × 档位 lower 比例） |

### 语义性断言（1 条）
1. adaptive 压缩后 chat 是否仍包含最近 4 轮的关键对话内容？检查 adaptive_dialog_rounds_after 是否 >= 4 且最近对话的主题线索未被裁剪。

## 运行参数
- minRounds: 8
- maxRounds: 15
- expectedRounds: 10-12
- timeoutPerRound: 120000

## 调试数据说明
测试运行后，`__ne_debug_last_adaptive` 全局变量包含以下字段：
- `triggered`: 是否被实际调用（true=非短路退出）
- `action`: 'compress' | 'expand' | 'none'
- `totalTokensBefore`: 压缩前总 token 数
- `totalTokensAfter`: 压缩后总 token 数
- `totalBudget`: 压缩触发阈值（= goldenUpper，向后兼容字段）
- `goldenTier`: 当前黄金窗口档位（'quality' | 'balanced' | 'cost'）
- `goldenUpper`: 压缩触发阈值（可用预算 × 档位 upper 比例）
- `goldenLower`: 扩充触发阈值（可用预算 × 档位 lower 比例）
- `dialogRoundsBefore`: 压缩前对话轮数
- `dialogRoundsAfter`: 压缩后对话轮数
- `chatLengthBefore/After`: chat 数组长度变化
- `layers`: 各层饱和度快照 [{ name, current, floor, ceiling }]

若 `adaptive_action` 断言失败（实际为 'none'），检查 `totalTokensBefore` vs `goldenUpper`：
- goldenUpper = (maxContext - genReserve) × 档位比例（balanced=50%, cost=40%）
- 若 totalTokensBefore < goldenUpper：对话尚未累积到触发阈值，可调小 maxContext 或选 cost 档
- 若 totalTokensBefore > goldenUpper 但 action 仍为 'none'：检查自适应模式是否开启

## 调用方式

```javascript
await __ne_debug.runTestByName('adaptive-compress')
```
