# JSON Mode 收尾清理

## 摘要

JSON mode 的主体改动（`response_format: json_object` + prompt 重写 + parser 简化）已在上一轮会话中完成。当前计划是**清理残留的 XML 引用和死代码**，使代码与 JSON mode 完全一致，然后构建和测试。

---

## 当前状态分析

### ✅ 已完成

| 文件 | 改动 |
|------|------|
| `src/api/llm.js` L500-506 | `callCustomAPI` 已加 `response_format: { type: "json_object" }` |
| `src/engine/stm-extractor.js` | 已重写：`JSON.parse`、无旧解析函数、无重试循环 |
| `src/engine/update.js` L655-657 | `buildBatchPrompt` 已改用 JSON schema 输出 |
| `src/engine/update.js` L662-717 | `buildStatePrompt_Preset` 已改用 JSON schema |
| `src/engine/update.js` L720-784 | `buildStatePrompt_Dynamic` 已改用 JSON schema |
| `src/engine/update.js` L415-443 | `parseSTMResponse` 已简化：直接 `JSON.parse`，无 XML 剥离逻辑 |

### ❌ 待清理

#### A. 死代码删除

1. **`update.js` L389-413: `parseStateChangesText` 函数** — 不再被任何代码调用，应删除。

#### B. 不一致的残留 XML 引用

2. **`update.js` L701-702 (buildStatePrompt_Preset 的 HARD GATE)**：仍引用 `<state_changes>` XML 标签
   ```
   - Skip Part 2 (no <state_changes>)
   - Empty <state_changes></state_changes>
   ```
   应改为 JSON 语义：
   ```
   - Omit "state_changes" from the JSON output
   - Output "state_changes": [] (empty array) when nothing changed
   ```

3. **`update.js` L774-775 (buildStatePrompt_Dynamic 的 HARD GATE)**：同上
   ```
   - Skip Part 2 (no <state_changes>)
   - Empty <state_changes>
   ```
   应改为 JSON 语义。

4. **`update.js` L860: 调试日志仍检查 `<state_changes>` 标签**
   ```javascript
   /<state_changes>/i.test(stateResponse)
   ```
   JSON mode 下 State LLM 的响应是纯 JSON，不会再包含 `<state_changes>`。该检查已无意义，应改为检查 `state_changes` JSON key 是否存在。

### 🔵 不修改（超出范围）

| 代码段 | 原因 |
|--------|------|
| `update.js` L210-346 `buildSTMUpdatePrompt` 中的 `<state_changes>` XML 引用 | 这是 CURSOR-mode 的独立事件更新 prompt，非 batch extraction 路径，不在 JSON mode 计划范围内 |
| `llm.js` L133-226 `robustParseJson` / `findValidJsonPrefixEnd` / `skipString` | 仍被 `callMemoryLLMWithTools`（SmartPush 合成）使用，用于解析 tool arguments。该工具调用路径不加入 `response_format`，仍需要健壮解析 |

---

## 改动清单

### 改动 1: 删除 `parseStateChangesText`

- **文件**: `src/engine/update.js`
- **操作**: 删除 L389-413 整段函数定义
- **旧代码**:
  ```javascript
  function parseStateChangesText(text) {
      var changes = {};
      var lines = String(text || '').split('\n');
      // ... 25 行文本解析逻辑 ...
      return changes;
  }
  ```
- **新代码**: 无（整段删除）

### 改动 2: 更新 `buildStatePrompt_Preset` 的 HARD GATE

- **文件**: `src/engine/update.js`
- **操作**: L701-702 更新 HARD GATE 文本
- **旧代码**:
  ```javascript
  var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Skip Part 2 (no <state_changes>)\n- Empty <state_changes></state_changes>\n- Miss characters in conversation\n- Include present_characters in any path\n- Omit npc_names or label all characters as protagonist\n============================================================\n';
  var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 跳过第二部分（不输出 <state_changes>）\n- 输出空的 <state_changes></state_changes>\n- 遗漏对话中明显出现的角色\n- 在任何路径中包含 present_characters\n- 遗漏 npc_names 或将所有角色都标为主控\n============================================================\n';
  ```
- **新代码**: 引用 JSON `state_changes` 字段
  ```javascript
  var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Omit "state_changes" from the JSON output\n- Output "state_changes": [] (empty array) when nothing changed\n- Miss characters in conversation\n- Include present_characters in any path\n- Omit npc_names or label all characters as protagonist\n============================================================\n';
  var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 在 JSON 输出中省略 "state_changes" 字段\n- 当无变化时输出 "state_changes": []（空数组）\n- 遗漏对话中明显出现的角色\n- 在任何路径中包含 present_characters\n- 遗漏 npc_names 或将所有角色都标为主控\n============================================================\n';
  ```

### 改动 3: 更新 `buildStatePrompt_Dynamic` 的 HARD GATE

- **文件**: `src/engine/update.js`
- **操作**: L774-775 更新 HARD GATE 文本
- **旧代码**:
  ```javascript
  var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Skip Part 2 (no <state_changes>)\n- Empty <state_changes>\n- Use preset fields instead of discovered fields\n- Include present_characters in any path\n============================================================\n';
  var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 跳过第二部分\n- 输出空的 <state_changes>\n- 使用预设字段而非动态发现字段\n- 在任何路径中包含 present_characters\n============================================================\n';
  ```
- **新代码**: 引用 JSON `state_changes` 字段
  ```javascript
  var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Omit "state_changes" from the JSON output\n- Output "state_changes": [] (empty array) when nothing changed\n- Use preset fields instead of discovered fields\n- Include present_characters in any path\n============================================================\n';
  var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 在 JSON 输出中省略 "state_changes" 字段\n- 当无变化时输出 "state_changes": []（空数组）\n- 使用预设字段而非动态发现字段\n- 在任何路径中包含 present_characters\n============================================================\n';
  ```

### 改动 4: 更新 State pipeline 调试日志

- **文件**: `src/engine/update.js`
- **操作**: L860 修改标签检查
- **旧代码**:
  ```javascript
  console.log('[NE] State LLM — NO state_changes extracted. Tag found in raw:', /<state_changes>/i.test(stateResponse));
  ```
- **新代码**:
  ```javascript
  console.log('[NE] State LLM — NO state_changes extracted. Has state_changes key in JSON:', /"state_changes"\s*:/i.test(stateResponse));
  ```

---

## 验证步骤

1. **构建**: `npm run build` 通过，无语法/类型错误
2. **运行测试**: 执行 smartpush01 测试用例
3. **检查 trace**: 验证 STM events 和 state changes 是否有效（不再是 0 条）
4. **检查日志**: 确保无 `parseStateChangesText` 相关报错，无 XML 标签遗留警告
