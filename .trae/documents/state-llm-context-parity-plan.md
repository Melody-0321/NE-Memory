# State LLM 上下文信息补齐计划

## 摘要

当前 State LLM 和 Main LLM 之间存在信息差：Main LLM 收到 ST 角色卡（description/personality/scenario）和上下文激活的世界书条目，State LLM 只收到全量静态世界书。补齐后，State LLM 可从角色卡和激活世界书中独立提取角色字段，不再依赖 Main LLM 的 NE-CHAR 代填。

## 当前状态

### State LLM 收到的信息（buildStatePrompt_Preset）

| 内容 | 来源 | 说明 |
|------|------|------|
| `=== Current State ===` 结构化表格 | `buildStateInjectionTable()` | PC/NPC 字段矩阵，含 (未填) 标记 |
| `## World Book (active entries)` | `buildWorldBookSection()` | **全量静态**世界书，不做触发条件评估 |
| 状态提取规则 | 硬编码 | 中/英文规则 |
| 最近 2 条消息 | `latestUserMsg` + `latestAssistantMsg` | role+content，不含 persona |

### Main LLM 收到的信息（onBeforeGenerate 注入）

| 内容 | 来源 | 说明 |
|------|------|------|
| ST 原生角色卡 | ST 内部注入 | `description`, `personality`, `scenario` |
| ST 原生世界书 | ST 内部 `getWorldInfoPrompt()` | **上下文触发评估后**的激活条目 |
| `ne_state_table` | `buildStateInjectionTable()` | 同 State LLM |
| `ne_memory_vault` | SmartPush 检索合成 | STM + LTM 记忆 |
| `ne_state_block` / `ne_char_block` | NE-Memory 指令 | BANNER / NE-CHAR 输出指令 |

### 已有基础设施（未使用）

- `runtime.getCharacters()` — [index.js L108-L115](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js#L108-L115)：返回完整角色卡数组（name, description, personality, scenario 等）
- `SillyTavern.getContext().getWorldInfoPrompt(chat, maxContext, isDryRun, scanData)` — ST 上下文激活世界书评估函数，返回激活条目的格式化文本

## 修改方案

### 改动 1：新增 `buildCharacterCardSection()` — 角色卡注入到 State LLM system prompt

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**位置**：在 `buildWorldBookSection` 之前新增

**逻辑**：
```
function buildCharacterCardSection() {
    var chars = runtime.getCharacters();
    if (!chars || chars.length === 0) return '';
    var lines = [];
    for each char in chars:
        if char.name and (char.description or char.personality or char.scenario):
            lines.push('### ' + char.name);
            if char.description: lines.push('Description: ' + char.description);
            if char.personality: lines.push('Personality: ' + char.personality);
            if char.scenario: lines.push('Scenario: ' + char.scenario);
    if lines.length === 0: return '';
    return '## Character Cards\n' + lines.join('\n') + '\n';
}
```

**为什么**：State LLM 需要知道角色是谁才能填 gender_age/occupation/personality 等字段。角色卡是唯一可信源。

### 改动 2：重写 `buildWorldBookSection()` → 使用上下文激活世界书

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**位置**：替换原 L846-L881

**改为异步函数**，调用 ST 的 `getWorldInfoPrompt()` 进行 dry-run（不产生副作用）：

```
async function buildWorldBookSection(vault, messages) {
    var ctx = SillyTavern.getContext();
    var maxContext = runtime.maxContext || ctx.maxContext || 8192;

    // 构建 scanData（同 Main LLM 使用的格式）
    var scanData = buildScanData(vault);

    // 构建 chat 数组（逆序消息文本，同 ST 格式）
    var chatArray = buildChatArrayForWI(messages);

    // dryRun=true：不触发 sticky/cooldown 副作用
    var result = await ctx.getWorldInfoPrompt(chatArray, maxContext, true, scanData);
    var text = result.worldInfoString || '';
    if (!text.trim()) return '';
    return '## World Book (activated)\n' + text + '\n';
}
```

**`buildScanData`**：从 vault 内容构造 `globalScanData` 对象
```
{
    personaDescription: vault.persona_description || '',
    characterDescription: vault.character_description || '',
    characterPersonality: vault.character_personality || '',
    characterDepthPrompt: vault.depth_prompt || '',
    scenario: vault.scenario || '',
    creatorNotes: '',
    trigger: 'normal'
}
```

**`buildChatArrayForWI`**：将 messages 数组转为 ST 世界书扫描所需的逆序文本数组
```
messages.reverse().map(m => m.name ? m.name + ': ' + m.content : m.content)
```

**降级**：如果 `ctx.getWorldInfoPrompt` 不可用，回退到原有的全量静态世界书逻辑：
```
try { ... getWorldInfoPrompt ... } catch(e) {
    // fallback to full static entries
    return buildWorldBookSection_fallback();
}
```

**为什么**：当前 `buildWorldBookSection` 返回的是全量世界书（所有未禁用的条目），与 Main LLM 收到的按触发条件激活的条目完全不同。State LLM 只需要（也只应该）看到与当前上下文相关的世界书条目。

### 改动 3：修改 `buildStatePrompt_Preset` 注入角色卡 + 变为异步

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**位置**：L883-L943

**改动**：
```diff
- function buildStatePrompt_Preset(messages, vault) {
+ async function buildStatePrompt_Preset(messages, vault) {
      // ... stateTable 构建保持不变 ...

      return {
-         system: stateTable + buildWorldBookSection() + rulesZh,
+         system: stateTable + buildCharacterCardSection() + await buildWorldBookSection(messages, vault) + rulesZh,
          user: '最近的对话消息：\n\n' + msgTexts + '\n\n输出包含 state_changes 的 JSON...'
      };
  }
```

**为什么**：`buildCharacterCardSection` 是同步的，`buildWorldBookSection` 需要 `await`。整个函数签名从同步变为异步。

### 改动 4：调用处变为 await

**文件**：[src/core/engine/update.js](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js)

**位置**：L1277

```diff
- var statePrompt = buildStatePrompt_Preset(messages, vault);
+ var statePrompt = await buildStatePrompt_Preset(messages, vault);
```

**为什么**：`buildStatePrompt_Preset` 改为异步后，调用处需同步适配。

### 不改动

- **NE-CHAR 机制**：保留不动，另开对话评估损益
- **Main LLM 注入**：不动
- **NE-CHAR 消费端**：不动
- **`runtime.injectPrompt` 注册**：不动
- **worldbook-sync.js**：不动（该模块管理 NE-Memory 自己的世界书，与 ST 世界书是独立的）

## System Prompt 最终结构

```
=== Current State ===
▶ 江岚 · 活跃 · PC · gender_age: (未填) · occupation: (未填) ...

## Character Cards
### 江岚
Description: 表面沉稳寡言，实则内里拧巴...
Personality: 胜负心强，习惯用行动解决...
Scenario: 702公寓的同居生活...

### 安然
Description: 江岚的异性同位体...
Personality: 外在直率，内在柔软...
Scenario: 世界融合后成为江岚的同居室友...

## World Book (activated)
[702公寓] 这是两人同居的公寓，一个阳台、一个客厅...
[异性同位体] 世界融合后同一人的不同性别版本...

## Rules
- state_changes: flat object of dot-path → new-value.
...
```

## 假设 & 决策

1. **角色卡体积可控**：角色卡（description + personality + scenario）通常几百到几千字，State LLM 可承受
2. **世界书 dry-run 不产生副作用**：使用 `isDryRun=true` 调用 `getWorldInfoPrompt`，不会改变 sticky/cooldown/delay 状态
3. **scanData 从 vault 读取**：`buildScanData` 从 vault 字段读取 persona/character 描述，与 Main LLM 使用相同数据源
4. **降级安全**：如果 `ctx.getWorldInfoPrompt` 不可用（如测试环境无 ST），回退到原有全量静态世界书逻辑

## 验证

1. 运行 `npm run build` — 确保无编译错误
2. 运行 `pipeline-state-01` 测试 — 验证 State LLM 首轮即可填满字段（gender_age, occupation, personality 等不再全空）
3. 检查 trace — 确认 system prompt 包含 Character Cards 和 World Book (activated) 段
4. 检查 State LLM prompt token 消耗 — 不应超出合理范围

## 副作用

- **State LLM 每轮 token 增加**：角色卡 + 激活世界书会增加 system prompt 长度。需要观察 token 消耗是否超标
- **异步化**：`buildStatePrompt_Preset` 变为异步，调用链无影响（调用方已在 async 函数中）
- **世界书 dry-run 频率**：State LLM 每轮调用一次 `getWorldInfoPrompt(dryRun=true)`，对 ST 性能影响极小
