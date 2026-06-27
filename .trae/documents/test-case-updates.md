# 测试用例更新 — test5.0 后新功能覆盖

## 改动范围

| 类型 | 项目 | 文件 |
|------|------|------|
| **框架改动** | 新增 `faction_state` 监视器靶点 | monitor.js, assertions.js, index.js |
| **重写** | `pipeline-state-04`：废弃→滑动窗口上下文 | test-case.md |
| **新增** | `pipeline-state-06`：势力生命周期 | test-case.md |
| **扩展** | `smartpush-14`：冒烟测试加 `context_memory` | test-case.md |
| **文档** | README.md 更新 | README.md |

---

## 一、框架改动

### 1.1 [monitor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/monitor.js) — 新增靶点

在 `collectRoundData()` 的返回对象中增加：

```js
factionState: globalThis.__ne_debug_last_faction_state || null,
```

### 1.2 [assertions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/assertions.js) — 注册新 target

在 `resolveTarget()` 的 switch 中添加：

```js
case 'faction_state': return collected.factionState ? JSON.stringify(collected.factionState) : '';
```

### 1.3 [index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js) — Bridge 暴露

新增 bridge 函数：

```js
getFactionSummary: function() {
    try {
        var vault = getCurrentVault(getChatId());
        if (!vault || !vault.content || !vault.content.state || !vault.content.state.factions) return null;
        var f = vault.content.state.factions;
        var names = Object.keys(f);
        var hidden = names.filter(function(n) { return f[n]._hidden; });
        var visible = names.filter(function(n) { return !f[n]._hidden; });
        return { total: names.length, hidden: hidden, visible: visible, names: names };
    } catch (e) { return null; }
},
```

### 1.4 [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) — 写入监视器变量

在 vault 读取后（约 L805）添加：

```js
globalThis.__ne_debug_last_faction_state = vault.content.state && vault.content.state.factions
    ? (function() {
        var f = vault.content.state.factions;
        var names = Object.keys(f);
        var hidden = names.filter(function(n) { return f[n]._hidden; });
        var visible = names.filter(function(n) { return !f[n]._hidden; });
        return { total: names.length, hidden: hidden, visible: visible, names: names };
    })() : null;
```

---

## 二、测试用例：`pipeline-state-04` 重写

**文件**：[test-cases/pipeline/pipeline-state-04/test-case.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/pipeline/pipeline-state-04/test-case.md)

**原状态**：deprecated（旧 `ne_context_memory` 已于 f5eb1ab 移除）
**新状态**：active — 测试滑动窗口上下文

### YAML Frontmatter

```yaml
name: pipeline-state-04
folder: pipeline/pipeline-state-04
title: 滑动窗口上下文注入 — formatContextMemory → ne_context_memory
objective: 验证滑动窗口上下文（pre-window LTM/STM summary）正确注入 Main LLM 的 system prompt，且 context_memory 非空、格式正确、不含内部标记
preconditions:
  - NE-Memory 已初始化
  - SmartPush 启用
  - 滑动窗口轮次设置 > 0（默认 10）
  - 副 API 可用
  - 有 LTM/STM 积累（至少 4 轮后触发 pipeline）
structural:
  - { op: exists, target: context_memory }
  - { op: min_length, target: context_memory, value: 30 }
  - { op: not_contains, target: context_memory, value: "→stm:" }
  - { op: not_contains, target: context_memory, value: "stm_0x" }
semantic:
  - "context_memory 是否以自然语言摘要形式呈现（而非 raw JSON dump 或 stm_xxx 碎片列表）？"
  - "context_memory 是否包含对话历史的关键信息摘要？"
  - "context_memory 长度是否合理（不应超过 2000 字符）？"
minRounds: 4
maxRounds: 10
expectedRounds: "6-8"
timeoutPerRound: 120000
```

### 测试说明（Markdown 正文）

```markdown
# pipeline-state-04: 滑动窗口上下文注入

## 目标

本测试验证 test5.0 后重新实现的 `formatContextMemory` 功能。

旧版本（commit f5eb1ab 前）将 raw STM/LTM 条目 dump 到 Main LLM，与 SmartPush 重复。
新版本生成自然语言摘要，由 `computeContextPressure` 三重标准判定触发。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: context_memory` | 滑动窗口上下文已注入 |
| 2 | `min_length: context_memory >= 30` | 非空壳 |
| 3 | `not_contains: context_memory [→stm:]` | 无内部标记泄漏 |
| 4 | `not_contains: context_memory [stm_0x]` | 非 raw dump |

### 语义性
1. 是否以自然语言摘要呈现？
2. 是否包含对话历史关键信息？
3. 长度是否合理（≤2000 字符）？

## 调用方式

\`\`\`javascript
await __ne_debug.runTestByName('pipeline-state-04')
\`\`\`
```

---

## 三、测试用例：`pipeline-state-06` 新增（势力）

**文件**：[test-cases/pipeline/pipeline-state-06-factions/test-case.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/pipeline/pipeline-state-06-factions/test-case.md)（新建）

### YAML Frontmatter

```yaml
name: pipeline-state-06
folder: pipeline/pipeline-state-06-factions
title: 势力状态管理 — 一次性预载 + 关键词激活
objective: 验证势力从世界书一次性提取到 state（全隐藏）、对话中提及后关键词激活、已激活势力出现在 state injection table 中
preconditions:
  - NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
  - 副 API 可用
  - 角色卡附带世界书，世界书中包含势力信息（至少 1 个势力条目）
  - stmBatch >= 4
structural:
  - { op: exists, target: faction_state }
  - { op: min_length, target: faction_state, value: 20 }
  - { op: contains, target: faction_state, value: "\"hidden\"" }
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "state.factions 中是否提取到了世界书中确实存在的势力名称？"
  - "是否有势力在对话中被提及后从 hidden 变为 visible？检查 faction_state 中 visible 列表是否非空。"
  - "状态注入表中是否出现了已激活势力的名称和态度字段？"
  - "State LLM 的 state_changes 是否输出了 factions 相关路径？"
minRounds: 4
maxRounds: 10
expectedRounds: "6-8"
timeoutPerRound: 120000
```

### 测试说明（Markdown 正文）

```markdown
# pipeline-state-06: 势力状态管理

## 目标

验证 commit `456c70d` 引入的势力一次性预载 + 关键词激活机制：

1. **预载**：首轮 `resolveNpcSchemes` 从世界书全量提取势力 → `state.factions`（全部 `_hidden: true`）
2. **关键词激活**：对话中提到势力名/别名 → `_hidden: false`
3. **State LLM 更新**：激活后 State LLM 可管理 attitude/notes
4. **注入过滤**：仅已激活势力进入 State Injection Table

## 前置条件

- 角色卡包含世界书，世界书中有势力相关条目
- Driver 应在对话中自然提及至少一个世界书中的势力名称

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: faction_state` | 势力状态已采集 |
| 2 | `min_length: faction_state >= 20` | 非空 |
| 3 | `contains: faction_state ["hidden"]` | 至少有一个隐藏势力 |
| 4 | `exists: pipeline_changes` | State 管线执行过 |
| 5 | `min_length: pipeline_changes >= 1` | 有变化写入 |
| 6 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. 提取的势力名是否匹配世界书内容？
2. 对话中提及的势力是否被激活（visible 非空）？
3. State injection table 是否包含已激活势力？
4. State LLM 是否输出了 factions 相关路径？

## 调用方式

\`\`\`javascript
await __ne_debug.runTestByName('pipeline-state-06')
\`\`\`
```

---

## 四、测试用例：`smartpush-14` 扩展

**文件**：[test-cases/smoke/smartpush-14-full-chain-smoke/test-case.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/smoke/smartpush-14-full-chain-smoke/test-case.md)

在现有 structural assertions 列表中追加 1 条：

```yaml
  - { op: exists, target: context_memory }
```

在 semantic assertions 列表中追加 1 条：

```yaml
  - "context_memory（滑动窗口上下文摘要）是否非空、以自然语言呈现？检查 trace 中 ne_context_memory 注入内容。"
```

把 `objective` 描述中的覆盖管线列表追加：

```
- 滑动窗口上下文（formatContextMemory → ne_context_memory）
```

---

## 五、README.md 更新

在 [test-cases/README.md](file:///d:/SillyTavern/xm/ne-memory/test-cases/README.md) 中：

1. **State 管线表格**中，`pipeline-state-04` 行改为：

```
| pipeline-state-04 | 滑动窗口上下文注入 | ⬜ | formatContextMemory → ne_context_memory 摘要注入 |
```

2. **State 管线表格**末尾新增一行：

```
| pipeline-state-06 | 势力状态管理 | ⬜ | 一次性预载 + 关键词激活 + State LLM 管理 |
```

3. 废弃列表中去掉 `pipeline-state-04`

---

## 改动汇总

| # | 文件 | 动作 |
|---|------|------|
| 1 | `src/core/test-runner/monitor.js` | `collectRoundData` 加 `factionState` 字段 |
| 2 | `src/core/test-runner/assertions.js` | `resolveTarget` 加 `faction_state` case |
| 3 | `src/adapter/index.js` | 新增 `getFactionSummary` bridge 函数 |
| 4 | `src/adapter/events.js` | 写 `__ne_debug_last_faction_state` |
| 5 | `test-cases/pipeline/pipeline-state-04/test-case.md` | **重写**：deprecated → 滑动窗口上下文 |
| 6 | `test-cases/pipeline/pipeline-state-06-factions/test-case.md` | **新建**：势力状态管理 |
| 7 | `test-cases/smoke/smartpush-14-full-chain-smoke/test-case.md` | **扩展**：+1 structural +1 semantic |
| 8 | `test-cases/README.md` | 更新 pipeline-state-04 描述 + 新增 pipeline-state-06 |

---

## 验证

1. `npm run build` 后 `dist/index.js` 含新靶点代码
2. 控制台 `__ne_debug.listTests()` 列出 `pipeline-state-04` 和 `pipeline-state-06`
3. `pipeline-state-04` 运行后 assertion 验证 context_memory 非空
4. `pipeline-state-06` 运行后 faction_state 包含世界书中的势力
5. `smartpush-14` 运行后 context_memory 检查通过
