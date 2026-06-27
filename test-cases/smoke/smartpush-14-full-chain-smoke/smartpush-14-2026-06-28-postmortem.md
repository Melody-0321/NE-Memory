# smartpush-14 全链路冒烟测试事后分析：管线崩溃 & State Board 回退

> 生成时间: 2026-06-28  
> 对比基准: test5.0 (06-26 版本) vs 当前 HEAD (06-27 版本)  
> 相关提交范围: `520afe0..b727a0e` (共 13 次)

---

## 一、数据对比速览

| 维度 | 06-26 (test5.0) | 06-27 (当前版本) |
|---|---|---|
| Vault 初始状态 | STM=2, LTM=0（有存量） | STM=0, LTM=0（全新） |
| 管线 LLM 调用 | ✅ 每轮均有 STM/LTM/State 调用 | ❌ 全部显示 "(本轮无 NE 管线 LLM 调用)" |
| 结构断言通过 | **16/16** | **6/16** |
| SmartPush 注入 | ✅ 丰富记忆叙事 | ❌ "No memory entries available" 占位符 |
| 上下文记忆 | ✅ 长文本上下文摘要 | ❌ 不存在 |
| 执行耗时 | 11分24秒 | 4分40秒 |

> **结论:** 06-27 的整个 NE 管线（STM 提取 → LTM 合流 → SmartPush 检索 → State LLM → 上下文窗口记忆）**全线未执行**。

---

## 二、全部症状清单

### 🔴 症状 S1：管线完全静默（P0 — 致命）

整个 NE 管线（STM 提取、LTM 合流、SmartPush 检索合成、State LLM、上下文窗口记忆）在任何轮次均未执行任何 LLM 调用。Vault 从头到尾 STM=0，LTM=0。

**影响的断言:**
- `pipeline_responses` (min_length: 50) → 断言失败，返回 `[]`
- `pipeline_changes` (min_length: 1) → 断言失败，返回 `[]`
- `ltm_state` (exists) → 断言失败
- `stm_events` (exists) → 断言失败
- `smartpush_prompt` (min_length: 200) → 断言失败
- `smartpush_injection` (min_length: 50) → 断言失败

---

### 🔴 症状 S2：State Board 静态字段全部回退为空（P0）

test5.0 已修复的空字段问题再度出现（影响的字段与之前完全相同）：

**江岚 (NPC)**

| 字段 | 值 |
|------|-----|
| 性别与年龄 | `<span class="ne-empty-value">(未填)` |
| 体型外貌 | `<span class="ne-empty-value">(未填)` |
| 职业 | `<span class="ne-empty-value">(未填)` |
| 穿着 | `<span class="ne-empty-value">(未填)` |
| 性格 | `<span class="ne-empty-value">(未填)` |
| 内心想法 | 分得这么干脆，倒省事了。不过她那本书数据真比我好？不行，下本得认真了。 |
| 好感度 | `<span class="ne-empty-value">(未填)` |
| 关系 | `<span class="ne-empty-value">(未填)` |
| 当前情绪 | 平静中带着一丝胜负欲，对同居的现实接受度比预期高，但对稿费差距耿耿于怀 |

**安然 (NPC)**

| 字段 | 值 |
|------|-----|
| 性别与年龄 | `<span class="ne-empty-value">(未填)` |
| 体型外貌 | `<span class="ne-empty-value">(未填)` |
| 职业 | `<span class="ne-empty-value">(未填)` |
| 穿着 | `<span class="ne-empty-value">(未填)` |
| 性格 | `<span class="ne-empty-value">(未填)` |
| 内心想法 | 他说'拆一句打字，下一句改成动作'——这不是我上个月给他批的弹幕吗？他用了，还写得比我好。算了，反正肉也是他请的。 |
| 好感度 | 10 |
| 关系 | 同居室友/性转同位体/默契正在向日常渗透，边界感进一步消融 |
| 当前情绪 | 抢到最大块牛肉的得意，夹杂着看到江岚用自己批过的建议时的小小胜利感 |

**分析:** 只填充的字段（当前情绪、内心想法、安然的好感度/关系）全部来自 Main LLM 输出的 NE-CHAR 块，而非 State LLM 管线。**State LLM 从未运行**。

---

### 🟡 症状 S3：SmartPush 注入为占位符（P1）

每轮注入均为固定的 109 字符 "No memory entries available and no World Book state" 占位符，无任何记忆内容。Vault 中无 STM/LTM 条目可供 SmartPush 检索。

**影响的断言:**
- `smartpush_injection` (not_contains "→stm:") → 断言通过（但无意义）
- `smartpush_injection` (min_length: 50, exists) → 断言失败
- `smartpush_prompt` (min_length: 200, exists) → 断言失败

---

### 🟡 症状 S4：上下文窗口记忆缺失（P1）

`context_memory` 断言失败——滑动窗口摘要为空。Vault 中没有 STM/LTM 可用来生成摘要。

**影响的断言:**
- `context_memory` (exists) → 断言失败

---

### 🟡 症状 S5：管线响应和数据变更均为空（P1）

所有依赖管线输出的断言全部失败。`pipeline_responses` 返回 `[]`，`pipeline_changes` 返回 `[]`。

**影响的断言:**
- `pipeline_responses` (min_length: 50, not_contains "error", contains "ltm_decision") → 全部失败
- `pipeline_changes` (min_length: 1, not_contains "error") → 全部失败

---

### 🟢 症状 S6：独立于管线的功能正常

以下功能不依赖管线运行，仍在正常工作：

- `state_block_instruction` 断言通过 —— 该指令在 `onBeforeGenerate` 中注入，不依赖管线
- NE-CHAR 块的解析和消费（`consumeNeCharBlocks`）仍在工作
- `ne_state_table` 和 `ne_char_block` 注入指令仍产生（但内容来自 Main LLM 推断，非 State 管线）

---

## 三、根因分析

### ⬛ Bug #1（P0 — 直接根因）：`isIdle()` 守卫在管线忙时永久跳过触发判定

**位置:** `src/adapter/events.js:358`

```javascript
// onMessageReceived 中 (line 354 → 358)
pendingMessages.push(assistantMsg);   // ← 消息始终累积
persistPending();

if (!isIdle()) return;               // ← 管线忙时直接跳过触发判定！
```

**机制:**

1. 从 Round 3 开始（`pendingMessages.length > 2`），`triggerPerRoundExtraction` 每轮都会被调用，获取 `'state'` 管线锁
2. `triggerPerRoundExtraction` → `extractStateChangesOnly` → 首次运行时调用 `resolveNpcSchemes`，后者通过 `Promise.all` 并行发起 **2 次 LLM 调用**（scheme_discovery + faction_discovery），持有 'state' 锁 20-40 秒
3. 当下一个 `onMessageReceived` 来临而 'state' 锁仍被占用时，第 358 行的 `isIdle()` 返回 `false`，**整个触发器判定逻辑被跳过**
4. `shouldRunPipeline` 永远不会在此轮被执行；`flushPendingMessages` 永远不会被调用
5. 消息虽仍在 `pendingMessages` 中积累，但 **触发判定被永久排除在每一轮之外**

**由提交引入:** `456c70d`（势力提取加入 `resolveNpcSchemes`） + `92f7498`（拆分势力调用 → `Promise.all`），二者共同将 `triggerPerRoundExtraction` 的持锁时间从 ~5秒 延长至 ~20-40秒。

---

### ⬛ Bug #2（P0 — 管线锁泄露）：`flushPendingMessages` 获取锁后不释放即返回

**位置:** `src/adapter/events.js:397-412`

```javascript
async function flushPendingMessages() {
    if (!tryAcquire('stm')) {
        // 等待 → 重试
        if (!tryAcquire('stm')) {
            return;  // ← 安全：未获取到锁就返回
        }
    }
    // ===== 从此处开始，'stm' 锁已被占用 =====
    
    if (pendingMessages.length === 0) return;   // ← 💀 L406: 未释放锁！
    // ...
    if (pendingMessages.length < STM_BATCH && pressure < 0.50) {
        return;   // ← 💀 L412: 未释放锁！
    }
    
    const batch = pendingMessages.splice(0);
    // ...
    try {
        // 记忆管线执行
    } finally {
        releasePipeline();   // ← 仅在此处释放
    }
}
```

**严重性:** 如第 406/412 行的提前返回被触发，管线将**永久卡死在 `'stm'` 阶段**。此后：

- 所有 `isIdle()` → `false`
- 所有 `onMessageReceived` → 在第 358 行短路
- 所有 `flushPendingMessages` → `tryAcquire('stm')` 失败 → 等待 → 再次失败 → 延迟
- 管线 **死锁**

L410 双重检查的条件（`pendingMessages.length < stmBatchSize && pressureVal < 0.50`）本应与 `shouldRunPipeline` 保持同步，但在管线等待并重试获取锁期间，`pendingMessages` 的内容可能已被另一并发操作修改，或被 `neSyncChatId`/`onBeforeGenerate` 中的聊天 ID 变更逻辑清除。

---

### ⬛ Bug #3（P1 — 促成因素）：提交 `594264a` 移除 words-threshold，丧失安全网

**提交:** `594264a` — "fix: 移除 words-threshold 触发器"

**变更内容:**

```
旧行为：words-threshold 强制管线运行（绕过 batchSize）——确保在短对话中也能触发
新行为：条件改为 batchSize | contextPressure ——两者在全新对话中均无法满足
```

**影响:**

- test5.0 中：即使 batchSize 未达到，`words-threshold` 也能让管线**独立于 batchSize 运行**
- 当前版本：管线启动**仅**依赖 `pendingMessages.length >= stmBatchSize` 或 `contextPressure >= 0.50`
- Bug #1 使触发判定被跳过的情况下，**不再有备用机制**触发管线运行
- 对于短对话（如 8 轮冒烟测试），`contextPressure` 几乎不可能达到 0.50
- Bug #1 + Bug #3 的组合是**致命回归**的根源

---

### ⬛ Bug #4（P2 — 测试竞赛条件）：测试 `__ne_waitForPipelineDrain` 不等管线输出即收集数据

**位置:** `src/adapter/test-driver.js:101-103`

`waitForPipelineIdle` 仅在 `isIdle()` → `true` 时返回。一旦 `triggerPerRoundExtraction` 释放 'state' 锁，等待即告结束。但此时 `flushPendingMessages` 可能**刚刚才获取到 'stm' 锁**——管线记忆提取正在开始。测试立即通过 `collectRoundData` 收集数据，读取到的是管线执行**前**的旧调试全局变量。

---

## 四、Bug 触发链路（端到端）

```
Round 1: pendingMessages=2, triggerPerRoundExtraction 未调用（2 ≤ 2）
Round 2: pendingMessages=4, triggerPerRoundExtraction 调用 → 获取 'state' 锁
          → resolveNpcSchemes（2 次并行 LLM，20-40秒）→ State LLM
Round 3: pendingMessages=6, isIdle()=? 仍锁定 → 跳过触发判定 [Bug #1]
          shouldRunPipeline（6 ≥ 6）本应为 TRUE 但从未被评估
          __ne_waitForPipelineDrain 最终在 'state' 释放时返回
          flushPendingMessages 在 drain 返回后获取 'stm' [Bug #4 竞赛条件]
Round 4-8: 相同模式重复——triggerPerRoundExtraction 重新获取 'state'
           管线触发跳过，shouldRunPipeline 从未被评估
           无备用 words-threshold 可绕过 [Bug #3]
```

---

## 五、修复方案

### 🔧 修复 #1（P0 — 关键）：对 `flushPendingMessages` 进行管线锁泄露修复

**文件:** `src/adapter/events.js:397-412`

将所有 `tryAcquire('stm')` 成功后的提前返回路径包裹在 `try-finally` 内，确保 `releasePipeline()` 始终被调用：

```javascript
async function flushPendingMessages() {
    if (!tryAcquire('stm')) {
        // ... 等待并重试逻辑 ...
        if (!tryAcquire('stm')) {
            return;
        }
    }
    try {
        if (pendingMessages.length === 0) return;
        // ...
        if (pendingMessages.length < await getStmBatchSize() && pressureVal < 0.50) {
            return;   // ← 现在安全了：finally 会释放
        }
        const batch = pendingMessages.splice(0);
        // ... 主管线执行 ...
    } finally {
        releasePipeline();   // ← 始终到达，无一例外
    }
}
```

---

### 🔧 修复 #2（P0 — 关键）：当管线忙时，恢复触发判定检查

**文件:** `src/adapter/events.js:358`

移除 `isIdle()` 守卫——或将其从**跳过整个触发判定**改为**仅评估 `shouldRunPipeline` 而不调用 `flushPendingMessages`**，待管线重新空闲时再执行冲刷。

**方案 A（推荐）——移除守卫，依赖 `flushPendingMessages` 内部等待：**

```javascript
// 移除第 358 行：
// if (!isIdle()) return;

// 改为始终评估 shouldRunPipeline：
var shouldRunPipeline = pendingMessages.length >= await getStmBatchSize()
    || (pressureVal >= 0.50 && pressureVal > 0);

if (isStateSchemaEnabled() && pendingMessages.length > 2) {
    triggerPerRoundExtraction(assistantMsg);
}
if (shouldRunPipeline) {
    flushPendingMessages().catch(...);
}
// flushPendingMessages 内部会等待空闲管线
```

**方案 B（保守）——延迟而非跳过：**

```javascript
if (!isIdle()) {
    // 将助理消息加入 pending，延迟冲刷
    // 不跳过——使用 continuation drain。
    // 当前 drain 机制应该能在管线重新空闲时重新冲刷。
    return;  // 保持守卫，但确保 drain 能在空闲后触发
}
```

> 方案 B 要求 drain 逻辑在管线重新空闲后**重新评估** `shouldRunPipeline`；目前 drain 仅在 `flushPendingMessages` **成功执行完毕**后才会检查是否有额外消息——若 `flushPendingMessages` 从未被调用，则 drain 永远不会触发。

---

### 🔧 修复 #3（P1 — 回退）：恢复 words-threshold 作为管线触发备用方案

**文件:** `src/adapter/events.js:410`

还原提交 `594264a` 的逻辑：在 `flushPendingMessages` 中恢复**独立于 batchSize 的 word-count 检查**，作为触发器安全网：

```javascript
var wordCount = pendingMessages.reduce(function(sum, m) { 
    return sum + (m.content ? m.content.length : 0); 
}, 0);
if (wordCount >= WORD_THRESHOLD) {
    // 即使 pendingMessages.length < stmBatchSize 也强制执行
}
```

---

### 🔧 修复 #4（P2 — 测试稳定性）：让测试 drain 等待管线输出完成

**文件:** `src/adapter/test-driver.js:101`

`__ne_waitForPipelineDrain` 解决后，在 `collectRoundData` 之前插入一个小延迟（如 500ms），给管线输出写入 Vault 留出时间。更好的方案是使用一个 ready flag，在 `saveVaultWithSnapshot` 完成后设置，由 drain 去检测。

---

### 🔧 修复 #5（P2 — 防御性）：为 `resolveNpcSchemes` 添加超时/保护

**文件:** `src/core/engine/update.js:1457`

为 `Promise.all` 添加超时机制，防止 faction_discovery 调用永久阻塞管线：

```javascript
var [resp1, resp2] = await Promise.race([
    Promise.all([
        callMemoryPipeline([...], { operation: 'scheme_discovery' }, chatId),
        callMemoryPipeline([...], { operation: 'faction_discovery' }, chatId)
    ]),
    new Promise(function(_, reject) { 
        setTimeout(function() { reject(new Error('resolveNpcSchemes timeout')); }, 30000); 
    })
]);
```

---

## 六、优先级汇总

| 序号 | 修复项 | 文件 | 优先级 |
|------|--------|------|--------|
| #1 | `flushPendingMessages` 锁泄露修复 | `events.js:397-412` | **P0** |
| #2 | 移除/调整 `isIdle()` 守卫 | `events.js:358` | **P0** |
| #3 | 恢复 words-threshold 安全网 | `events.js:410` | **P1** |
| #4 | 测试竞赛条件修复 | `test-driver.js:101` | **P2** |
| #5 | resolveNpcSchemes 超时保护 | `update.js:1457` | **P2** |

---

## 七、责任追溯

| 提交 | 描述 | 引入 Bug |
|------|------|----------|
| `456c70d` | feat(state): 势力一次性提取 + 关键词激活 | Bug #1（延长持锁时间） |
| `92f7498` | refactor(prompt): 将势力提取拆分为独立 LLM 调用 + Promise.all | Bug #1（2 次并行 LLM 进一步延长持锁） |
| `594264a` | fix: 移除 words-threshold 触发器 | Bug #3（丧失触发安全网） |

Bug #2（锁泄露）和 Bug #4（测试竞赛条件）为已存在代码的 bug，由上述 3 个提交**触发暴露**。

---

**预计影响:** Bug #1 和 Bug #2 是本次回归的**直接成因**。Bug #3 是失去安全网后将问题严重化的**增强因子**。修复 #1 + #2 应能恢复核心管线功能；修复 #3 防止未来发生类似回归；修复 #4 + #5 改善测试稳定性和错误韧性。
