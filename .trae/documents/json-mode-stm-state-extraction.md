# JSON Mode: STM & State Extraction 重写

## 问题

STM 提取和 State 提取的 LLM 输出格式不稳定。当前做法要求 LLM "只输出事件块，不要推理、分析或任何额外文字"，但推理模型无法遵守此约束——输出中混入大量分析文本，导致 `parseBatchResponse` / `parseSTMResponse` 解析失败，最终 vault 始终为空。

## 方案

把输出格式从「纯文本解析」切换为 `response_format: { type: "json_object" }`（API 层担保）。允许 LLM 自由推理（写在 JSON 的 `analysis` 字段中），代码只从固定的 JSON 字段中提取结构化数据。

## 改动清单

### 1. api/llm.js — API 请求加 `response_format`

**`callCustomAPI` (L500-L505)**：
```javascript
const body = JSON.stringify({
    model: config.model,
    messages: messages,
    temperature: options.temperature || 0.3,
    max_tokens: options.max_tokens || 2048,
    response_format: { type: "json_object" }   // ← 新增
});
```

**不修改 `callCustomAPITools`** — 因为 tool-calling 与 `response_format: json_object` 冲突。SmartPush 合成（使用 tools）不走 JSON mode，但它的输出直接作为注入文本使用，不需要解析，不受影响。

**删除或简化**：
- `robustParseJson` 函数 (~60 行) — 不再需要，API 担保返回合法 JSON
- `findValidJsonPrefixEnd` / `skipString` — 连带删除

### 2. engine/stm-extractor.js — 换解析方式

**删除：**
- `extractEntryFields` 函数 (~31 行) — 纯文本解析，不再需要
- `parseBatchResponse` 函数 (~55 行) — 纯文本解析，不再需要
- `normalizeEvents` 函数 (~56 行) — 不再需要（重叠消解现在交给 LLM 处理）
- `isResponseEcho` 函数 (~9 行) — JSON mode 下不再需要（不会回显 prompt）

**删除重试循环** (L205-L289)：
- 从 3 次重试改为 1 次调用
- 失败或空事件 → 直接返回空数组

**新增/修改：**
- `buildBatchPrompt` 的 prompt 改成 JSON schema（改 update.js）
- 解析处改为 `JSON.parse(response).events` + 简单的空/非数组校验

### 3. engine/update.js — State prompt + 解析

**`buildStatePrompt_Preset` 和 `buildStatePrompt_Dynamic` (L734-L878)**：
- 删除 `<thought>`...`</thought>`、`<state_changes>`...`</state_changes>` 等格式约束
- 替换为 JSON schema 描述
- prompt 中加入 `analysis` 字段（让 LLM 有一个地方写推理）

目标输出结构：
```json
{
  "analysis": "逐步分析...（LLM 可以自由推理）",
  "checkpoints": {"time": "傍晚", "scene": "洋馆客厅", "story_date": "Day 1"},
  "state_changes": [
    {"path": "time", "value": "傍晚"},
    {"path": "scene", "value": "洋馆客厅"},
    {"path": "main_event", "value": "抵达洋馆"},
    {"path": "npc_names", "value": ["紫瞳女孩"]},
    {"path": "characters.江岚.status", "value": "活跃"}
  ]
}
```

**`parseSTMResponse` (L415-L524)**：
- 简化：剥离 `<thought>` 的逻辑删除
- 剥离 `<state_changes>` 的逻辑删除
- 直接 `JSON.parse(response)`，取 `checkpoints` 和 `state_changes` 字段
- 保留 `stateChangesText` 到 `flat object` 的转换逻辑（`[{"path":"...","value":"..."}]` → `{path: value}`）

### 4. engine/update.js — STM batch prompt

`buildBatchPrompt` (L685-L730) 改成 JSON schema：

```json
{
  "events": [
    {"event": "事件描述", "period": "时间", "scene": "场景", "turns": "0-2"},
    {"event": "事件描述", "period": "时间", "scene": "场景", "turns": "3-5"}
  ]
}
```

- 要求必须覆盖全部 turn 范围
- 如果无有效事件，events 设为空数组

### 5. 被删除的补丁代码汇总

| 文件 | 删除函数 | 行数 |
|------|---------|------|
| llm.js | `robustParseJson`、`findValidJsonPrefixEnd`、`skipString` | ~60 |
| stm-extractor.js | `extractEntryFields`、`parseBatchResponse`、`normalizeEvents`、`isResponseEcho`、重试循环 | ~150 |
| update.js | `parseSTMResponse` 中的 XML 剥离逻辑, `parseStateChangesText`（如果存在） | ~50 |
| **合计** | | **~260 行** |

### 6. 重试逻辑

- STM 提取：**0 次重试**。1 次调用失败 → 返回空数组。
- State 提取：**0 次重试**。1 次调用失败 → 返回空 stateChanges。
- 两种管线在当前轮失败都不会阻塞后续对话。下一轮触发 `executeIncrementalUpdate` 时会自动补过。

## vault 数据兼容

旧格式的 vault 条目（`event: ... period: ...` 纯文本格式）不做转换。新格式 JSON 条目与之共存，互不影响。

## 验证

1. `npm run build` 通过
2. 运行 smartpush01 测试
3. 检查 trace 中是否出现有效的 STM events（不再是 0 条）
4. 检查 state 提取的 `stateChanges` 是否非空
