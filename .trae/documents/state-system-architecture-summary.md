# State Pipeline Harness 工程

## 什么是 Harness

Harness = 管线每个阶段边界上对 LLM 输出的**代码层防御**。LLM 输出不可控（幻觉、截断、遗漏），代码在每个阶段边界检查输出是否可用、在不满足时兜底或告警。

STM 管线已在 `9b8f9a3` 完成 P0+P1 harness（msg_ids 过滤、文本长度校验、msgRange 诊断、LTM 截断检测）。State 管线尚未配备等效保护。

---

## Harness 缺口扫描（按管线阶段顺序）

State 管线有 **5 个阶段边界**：

```
① extractStateChangesOnly 入口
      → ② LLM 调用（buildStatePrompt → callMemoryPipeline）
           → ③ parseSTMResponse 解析
                → ④ validateStateChanges + mergeStateChanges
                     → ⑤ saveVaultWithSnapshot
```

### 缺口 A：①→② 之间 — `_initialized` 误标记导致 schema 空转

**位置**: `ensureStateStructure` L122-L131

**当前代码**:
```javascript
if (!state._initialized) {
    var schema = vault.content.state_schema;  // null（已有 vault）
    if (schema) { /* 不执行 */ }
    state._initialized = true;  // ← 永久标记
}
```

**故障模式**: Schema 开关 ON、vault 已存在（非新建）→ `state_schema` 为 null → 扩展字段不初始化 → `_initialized` 被设为 true → 以后每次 state pipeline 都跳过。

**Harness 修复**: 只在真正初始化后才设标记。

```javascript
if (!state._initialized) {
    var schema = vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA;
    if (schema) {
        var extState = initStateFromSchema(schema);
        Object.assign(state, extState);
        state._initialized = true;
        if (!vault.content.state_schema) {
            vault.content.state_schema = schema;  // 回填
        }
    }
}
```

---

### 缺口 B：②→③ 之间 — LLM 返回空 `stateChanges` 且无 `_checkpoints`

**位置**: `extractStateChangesOnly` L1379-L1381

**当前代码**:
```javascript
if (Object.keys(stateChanges).length === 0 && !parsed._checkpoints) {
    return { vault, changed: false };  // 静默退出，不写快照
}
```

**故障模式**: state 无变化（同一场景连续对话）→ LLM 只输出 `state_changes: []`、忘记 `_checkpoints` → 命中此条件 → `changed: false` → 快照未捕获 → 该消息的 state 锚点永久缺失。

**Harness 修复**: 构造最小 `_checkpoints` 兜底。

```javascript
if (Object.keys(stateChanges).length === 0) {
    if (!parsed._checkpoints) {
        // 兜底：从当前 vault state 构造最小 checkpoints
        var content = vault.content || {};
        parsed._checkpoints = {};
        if (content.story_time) parsed._checkpoints.time = content.story_time;
        if (content.story_scene) parsed._checkpoints.scene = content.story_scene;
        console.log('[NE-HARNESS] State LLM did not output _checkpoints — fallback to snapshot values');
    }
    postFillSTM({ stmEntries: [], _checkpoints: parsed._checkpoints }, vault);
    vault.content._state_snapshots = vault.content._state_snapshots || [];
    // 快照仍正常写入...
    return { vault, changed: true };
}
```

---

### 缺口 C：③→④ 之间 — `autoDecayStaleCharacters` 与 `stateChanges` 耦合

**位置**: `extractStateChangesOnly` L1383-L1389

**当前代码**:
```javascript
if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
    // validate + merge
    vault.content.state = autoDecayStaleCharacters(vault.content.state, messages);
}
```

**故障模式**: `stateChanges` 为空 → 整个块不执行 → `autoDecayStaleCharacters` 不运行 → 角色离场 3 轮仍标记为"活跃"。

**Harness 修复**: `autoDecayStaleCharacters` 独立于 block 运行。

```javascript
// stateChanges 合并路径（不变）
if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
    // validate + merge
}

// 兜底：无论 stateChanges 是否为空，角色衰减总是运行
if (isStateSchemaEnabled()) {
    vault.content.state = autoDecayStaleCharacters(vault.content.state, messages);
}
```

---

### 缺口 D：③→④ 之间 — `stateChanges` 非空但全部被 `validateStateChanges` 拒绝

**位置**: `mergeStateChanges` L414-L439

**当前代码**:
```javascript
export function mergeStateChanges(state, validatedChanges) {
    var newState = JSON.parse(JSON.stringify(state || {}));
    var hasChanges = false;
    Object.keys(validatedChanges).forEach(function (path) {
        // ... 合并 ...
        hasChanges = true;
    });
    if (hasChanges) {
        newState = rebuildPresentCharacters(newState);
    }
    return newState;
}
```

**故障模式**: LLM 输出 5 条 `state_changes`，但 `validateStateChanges` 因为没有 schema 元数据（`_initialized` 误标记）而全部丢弃 → `validatedChanges` 为空对象 → `mergeStateChanges` 返回新 state 但 `hasChanges` 为 false → **静默退回到旧 state，无告警**。

**Harness 修复**: 加一条诊断日志。

```javascript
if (!hasChanges && Object.keys(validatedChanges).length === 0 && Object.keys(stateChanges).length > 0) {
    console.warn('[NE-HARNESS] All stateChanges rejected by validateStateChanges — ' +
        Object.keys(stateChanges).length + ' paths dropped. Schema may be missing.');
}
```

---

### 缺口 E：③→④ 之间 — LLM 拼错的 path 被静默丢弃

**位置**: `validateStateChanges` L372-L394

**当前代码**:
```javascript
Object.keys(changes).forEach(function (path) {
    var fieldSchema = resolveSchemaPath(stateSchema, path);
    if (!fieldSchema) {
        warnings.push({ path: path, warning: 'Field not in schema, passing through' });
        validated[path] = changes[path];  // ← 未知字段放行
    }
});
```

这是一个**过于宽容**的策略。LLM 输出 `characters.张三.pesronality`（拼写错误）→ `resolveSchemaPath` 不匹配 → 放行 → state 里出现野字段 → 永不被读取、永不被清理。

**Harness 修复**: 区分"完全未知的顶层字段"和"已知父路径下的未知子字段"。

```javascript
if (!fieldSchema) {
    // 如果是 characters.<角色>.<未知字段>：丢弃并告警（parent 已知）
    var parts = path.split('.');
    if (parts.length >= 3) {
        var parentPath = parts.slice(0, parts.length - 1).join('.');
        var parentSchema = resolveSchemaPath(stateSchema, parentPath);
        if (parentSchema) {
            warnings.push({ path: path, warning: 'Unknown sub-field under known parent — dropped: ' + path });
            return;  // 丢弃，不放行
        }
    }
    // 顶层的未知字段：放行（向后兼容）
    warnings.push({ path: path, warning: 'Field not in schema, passing through: ' + path });
    validated[path] = changes[path];
}
```

---

### 缺口 F：⑤ — 快照清理时的边界条件

**位置**: `executeIncrementalUpdate` L1256-L1264

这是 STM 管线的快照清理逻辑。如果 state 管线在 STM 管线之前先跑并产生了新快照，STM 管线按 `maxProcessedMsgIdx` 截断会删除**被 state 刚添加但 STM 尚未处理的快照**。

**Harness 修复**: 快照截断使用 min 而非 max。

```javascript
// 改为只删除同时被 STM 和 state 都已消费的快照
var minProcessedMsgIdx = events.reduce(function(acc, e) {
    return e.absMsgStart != null ? Math.min(acc, e.absMsgStart) : acc;
}, Infinity);
vault.content._state_snapshots = snapshots.filter(function(s) {
    return s.msgIdx >= minProcessedMsgIdx;  // 保留所有 ≥ 最小 msgStart 的快照
});
```

这更保守——宁可多保留一个快照（未来轮次会清理），也不丢失尚未处理的消息的快照。

---

## Harness 优先级

| 缺口 | 严重度 | 故障后果 | 代码行数 |
|------|--------|---------|---------|
| A: `_initialized` 误标记 | P0 | 扩展字段永久无法生成 | ~8 |
| B: 空 stateChanges 无 checkpoints | P0 | 快照链断裂 | ~12 |
| C: autoDecay 绑死 | P1 | 角色离场不衰减 | ~3 |
| D: 全部被拒绝无告警 | P1 | 静默数据丢失 | ~3 |
| E: 拼写错误放行 | P2 | 野字段污染 state | ~8 |
| F: 快照截断竞态 | P2 | 快照早删 | ~5 |

---

## 改动文件一览

| 文件 | 改动 |
|------|------|
| `update.js` — `ensureStateStructure` | A（~8 行） |
| `update.js` — `extractStateChangesOnly` | B + C + 快照捕获（~20 行） |
| `schema.js` — `validateStateChanges` | D + E（~10 行） |
| `update.js` — `executeIncrementalUpdate` | F（~5 行） |
| **总计** | **~43 行** |

---

## 不变项

- State 关闭时所有 harness 不激活
- 现有 prompt 文本不动
- STM/LTM 管线不受影响
- 面板渲染不受影响
- 100 单元测试继续保持

---

## 验证

1. `npm run build` → 通过
2. 单元测试全部通过
3. 冒烟：state ON → 已有 vault → 确认扩展字段正常初始化（A）
4. 冒烟：同一场景多轮无变化 → 确认每轮快照正常（B）
5. 冒烟：角色离场 → 确认衰减运行（C）
