# State 系统重构计划（修订版）

## 摘要

移除 5 个被后续方案替代的废弃层次（expose_level、▲/△/○/◆ flag、CORE_SCHEMA、folded_fields、clothing_mode）、引入 **NPC 多方案（scheme）系统**（LLM 在初期根据世界书决定 1-N 套 NPC 追踪方案），UI 折叠从 per-field 改为 per-card。方案一旦决定，贯穿全程不变。

## 架构决策：废弃 State → 世界书同步

**决策**：`syncStateToWorldBook`（将角色 state 写入 `NE_Memory_State` 世界书条目，供 Main LLM 通过关键词匹配读取）将被废弃。

**理由**：语义错位——State 是「当前上下文状态」（每轮变化），世界书是「世界设定」（很少变）。将动态状态写入世界书 = 把「今天天气 25°C」写进百科全书。

**替代**：NE-BANNER 直接注入 Main LLM 的 system prompt（`injection.js` 中 `buildStateBlockSystemMessage`）——可靠、自控 token、格式完整。

**世界书的保留用途**：世界书仅在**方案发现阶段**作为 LLM 理解世界观的输入上下文（读取世界书条目的 content 文本，让 LLM 了解这个世界有什么类型的 NPC）。方案定义本身存储于 vault。

| State 内容 | 走世界书？ | 走 NE-BANNER？ | 原因 |
|------------|:--:|:--:|------|
| 角色当前 status/gender_age/affection/... | ❌ | ✅ | 动态状态 |
| 当前时间/场景/事件 | ❌ | ✅ | 动态状态 |
| 势力/任务进度 | ❌ | ✅ | 动态状态 |
| NPC 方案发现上下文（世界观设定文本） | ✅ → LLM 读取 | ❌ | 输入到 scheme discovery prompt |

## 参考对象

### Anima Memory（最接近的参考）

| 特性 | 做法 | 对我们的启发 |
|------|------|-------------|
| 状态变量 | YAML 格式，per-chat | 我们的 vault 天然就是 per-chat |
| Schema 校验 | Zod 定义字段类型 | 我们的 `validateField` 已有类似能力 |
| World Book 同步 | 将状态写入 World Book 给 Main LLM 用 | 我们已有 `syncStateToWorldBook` |
| 配置粒度 | per-chat 的 `extension_settings` | 我们的 `vault.content` 就是 per-chat 配置 |
| 正则提取 | 从 AI 回复中正则提取状态 | 不做——这不是我们的机制 |

### ST-BME（Graph + Schema 系统）

| 特性 | 做法 | 对我们的启发 |
|------|------|-------------|
| 节点类型 | 8 种硬编码类型，每种有独立 columns | NPC 方案相当于节点类型——不同 NPC 类别有不同字段 |
| KnowledgeState | per-character 追踪"该角色知道什么" | 不是我们要的，但 per-character 粒度值得参考 |
| Schema 校验 | `validateSchema()` 统一校验 | 我们已有类似能力 |

### 两者共同缺失的

**没有一个系统让 LLM 在初始化时根据世界书决定方案。** 这是我们的增量价值——不是用户手动配、不是硬编码，而是 LLM 阅读世界书后"自己决定该追踪什么"。

---

## ST 世界书能力映射：哪些为我们所用、哪些无关

### ST 世界书条目完整字段表（40+ 字段）

| 类别 | 字段 | 类型 | 对我们有用？ | 用途 |
|------|------|------|:---:|------|
| **身份标识** | `comment` | string | ✅ | 前缀 `NE_Scheme_` 区分方案条目 |
| | `uid` | number | ✅ | 条目唯一 ID，更新/删除用 |
| | `world` | string | ✅ | 来源世界书名 |
| **内容** | `content` | string | ✅ | 方案定义文本（required:... / optional:...） |
| | `keys` | string[] | ✅ | 中文方案名（如 "方案1" "人形"），供 LLM 引用 |
| | `keysecondary` | string[] | ❌ | 方案不依赖关键词匹配 |
| **激活控制** | `constant` | boolean | ✅ | `true` → State LLM 始终可见 |
| | `disable` | boolean | ✅ | 用户可在 UI 中禁用方案 |
| | `enabled` | boolean | ✅ | 同上 |
| **注入（Main LLM）** | `position` | number | ❌ | 方案不注入 Main LLM prompt |
| | `order` | number | ❌ | 同上 |
| | `depth` | number | ❌ | 同上 |
| | `role` | number | ❌ | 同上 |
| | `outletName` | string | ❌ | 同上 |
| **关键词匹配** | `selective` | boolean | ❌ | 不触发，`constant=true` 跳过匹配 |
| | `selectiveLogic` | number | ❌ | 同上 |
| | `caseSensitive` | boolean | ❌ | 同上 |
| | `matchWholeWords` | boolean | ❌ | 同上 |
| | `scanDepth` | number | ❌ | 同上 |
| **时序控制** | `sticky` | number | ❌ | 不触发，无需时序 |
| | `cooldown` | number | ❌ | 同上 |
| | `delayUntilRecursion` | number | ❌ | 同上 |
| | `probability` | number | ❌ | 同上 |
| **分组互斥** | `group` | string | ❌ | 不触发，无需互斥 |
| | `groupWeight` | number | ❌ | 同上 |
| | `groupOverride` | boolean | ❌ | 同上 |
| **过滤器** | `characterFilter` | object | ❌ | 方案全局适用 |
| | `triggers` | string[] | ❌ | 方案不区分生成类型 |
| | `matchPersonaDescription` 等 | boolean[] | ❌ | 不扫描这些文本源 |
| **递归** | `excludeRecursion` | boolean | ❌ | 不参与递归 |
| **装饰器** | `@@activate` / `@@dont_activate` | — | ❌ | 不适用 |

### 核心差异：我们**不**使用 ST 的 world book 注入管线

```
ST 的路径（Main LLM）:
  用户输入 → checkWorldInfo() 扫描消息 → 关键词匹配 → 激活条目 → 注入 LLM prompt

我们的路径（State LLM）:
  初始化 → getLorebookEntries('NE_Memory_State') 直接读 → 过滤 comment='NE_Scheme_*'
     → 解析 content 文本 → 写入 State LLM 的 system prompt
```

我们使用世界书作为**数据存储**，而非触发机制。这与 `syncStateToWorldBook` 的设计一致：世界书是 NE-Memory 在这个对话中的持久化附加数据。

### 方案条目的世界书字段用法

```javascript
// NE_Memory_State 世界中，每条方案就是一个 entry：
{
    comment: "NE_Scheme_humanoid",     // ← 前缀标识这是方案条目
    keys: ["方案1", "人形", "人类NPC"], // ← LLM 用中文方案名引用
    content: "description: 类人NPC\nrequired: gender_age, occupation...",
    constant: true,                     // ← 始终可见（不依赖关键词匹配）
    enabled: true,
    disable: false,
    // 以下字段我们不用，保持默认即可：
    selective: true, position: 0, order: 100, depth: 4, role: 0, ...
}
```

### 读取 API

```
runtime.getLorebookEntries('NE_Memory_State')
    → Promise<Array<Entry>>
    → 遍历过滤 comment.startsWith('NE_Scheme_')
    → 解析 content 文本 → { schemeKey, description, required[], optional[] }
```

这个调用在 `buildStateInjectionTable` 中每轮执行一次（结果可缓存到 vault，但世界书条目本身已经在内存中，缓存意义不大）。

---

## 一、当前状态分析

### 废弃层（将被移除）

| # | 废弃层 | 原始设计目的 | 为何废弃 | 当前危害 |
|---|--------|-------------|---------|---------|
| 1 | `expose_level: 'summary'\|'detail'` | Main LLM tool-call 分两层获取 state | Main LLM 只能一次 tool call → 不可行 | `clothing_build`(detail) 面板永不可见 |
| 2 | ▲/△/○/◆ 四级 flag | LLM 行为控制 | 与原始 schema 的 `required: true/false` 语义重复，过度复杂 | 4 级区分只增加了 prompt 噪声，LLM 无法精确理解区别 |
| 3 | `CORE_SCHEMA` / `CORE_STATE_FIELDS` | Core 字段定义 | 始终为 `fields: {}`，从未有实际数据 | 无效遍历 + 死逻辑 |
| 4 | `STATE_INJECTION_FOLDED_FIELDS` | 折叠显示非活跃角色字段 | 与 flag 体系平行 | 硬编码列表 |
| 5 | `clothing_mode` / `inventory_mode` 作为角色字段 | 控制 LLM 是否追踪穿着/物品 | 开关应从 schema 移到 Settings | 面板显示「服装模式: false」无意义 |

### PC/NPC 分离失败

| 问题 | 现状 | 后果 |
|------|------|------|
| Injection 表 | `STATE_INJECTION_CHAR_FIELDS` 12 字段统一，不分 PC/NPC | PC 被要求填写 affection/relationship |
| 模板初始化 | `ensureCharacterTemplate` 写死 NPC 模板 | PC 初始就带 affection=0 |
| protagonist_name | `ctx.name2` = AI 角色名 | 角色身份判定错误 |

### 缺少 NPC 多方案能力

| 问题 | 例 |
|------|-----|
| 男性向 NSFW 玩家 | 需要为女性 NPC 追踪 `body_description` 等字段，男性 NPC 不需要 |
| 奇幻世界玩家 | 需要为人类 NPC 追踪 social 字段，为怪物 NPC 追踪 combat 字段 |
| 当前系统 | 所有 NPC 强制统一——要么字段太多（无用空字段），要么太少（遗漏需要追踪的字段） |

---

## 二、目标架构

### 2.1 NPC 多方案系统（替代动态发现）

动态发现系统（`state-discovery.js`）原始目标是让 state 自适应多种世界观，但仅做文本正则提取字段名，缺乏语义理解，且从未真正集成。NPC 方案系统是它的替代方案：

| 动态发现 | NPC 方案系统 |
|---------|-------------|
| 正则扫描角色卡+世界书文本 → 提取字段名 | LLM 阅读世界书 → 理解世界观 → 决定 1-3 套 NPC 方案 |
| 无结构，无校验 | JSON 结构化，schema 校验 |
| 一经提取全程不变（但可能提取错误） | LLM 语义理解，准确分组 |
| 字段与角色无关 | 字段按 NPC 类型分组（humanoid / monster / ...） |

**决策**：废弃 `state-discovery.js`、`isDynamicStateMode`、`dynamic_state` 相关代码。NPC 方案系统全权承担「适应不同世界观」职责。方案存于 `vault.content.npc_schemes`。

### 2.2 NPC 方案发现流程

```
对话开始
    │
    ▼
Step 1: 方案发现（一次性，LLM 调用）
    State LLM 接收世界书条目文本
    → 返回 1-N 套 NPC 追踪方案
    → 存储到 vault.content.npc_schemes
    
    例（奇幻世界）：
    {
      "humanoid_npc": {
        "description": "人类/精灵/矮人等类人生物",
        "required": ["gender_age", "occupation", "personality", "affection", "relationship", "current_mood"],
        "optional": ["inner_thoughts", "clothing_build"]
      },
      "monster_npc": {
        "description": "怪物/野兽/龙等非人生物",
        "required": ["species", "threat_level", "status"],
        "optional": ["weakness", "territory", "behavior"]
      },
      "default": {
        "description": "兜底方案，用于无法归类的 NPC",
        "required": ["gender_age", "occupation", "status"],
        "optional": ["personality"]
      }
    }
    │
    ▼
Step 2: 方案锁定
    方案一旦决定，贯穿全程不变
    LLM 不能增加新方案
    │
    ▼
Step 3: NPC 方案分配（per-character，State LLM 在首次遇到时）
    新 NPC "哥布林" 出现
    → State LLM 看到可用方案列表 + 对话上下文
    → LLM 决定：scheme = "monster_npc"
    → 该角色按 monster_npc 字段集初始化并追踪
```

### 2.2 PC 方案

PC 始终使用固定的 `protagonist` 字段集（从 `DEFAULT_CHARACTER_SCHEMA.protagonist`），不受 NPC 多方案影响。

```
PC 方案 = 固定，从 DEFAULT_CHARACTER_SCHEMA.protagonist 派生
NPC 方案 = 可变，LLM 根据世界书在初始化时决定
```

### 2.3 字段方案决策时机

```
时机 A: vault 初始化（version === 0）且 world book 有内容
    → 在 bootstrapVault 中触发 LLM 调用
    → 取回方案并存入 vault.content.npc_schemes

时机 B: 用户首次在已有对话中开启 State Schema
    → 同样触发 LLM 调用

时机 C: world book 为空
    → 使用 DEFAULT_NPC_SCHEME（从 DEFAULT_CHARACTER_SCHEMA.npc 派生）
    → 单一方案，无需 LLM 调用
```

### 2.4 字段语义：required/optional 二分

```
required 字段 = schema 定义中 required: true 的字段
optional 字段 = schema 定义中 required: false 的字段（用户可选，在方案中选择是否追踪）
```

**不再有 ▲/△/○/◆。** 不再有「增量追加」概念——`past_experience` 改为 required 字段，LLM 追加新内容时写入完整文本。

### 2.5 UI：per-card 折叠，无 summary/detail 分层

```
角色卡 HTML 结构（新）：
  .ne-char-card (open 类控制折叠)
    .ne-char-card-header  ← 始终显示（名字 + status + PC/NPC 标签 + 方案名 + ▶ 箭头）
    .ne-char-card-body    ← 折叠控制（所有字段平级）
      │ 所有字段以 table 形式展示
      │ 无 summary/detail 区分
      │ affection 特殊渲染（进度条，仅 NPC）
```

### 2.6 protagonist_name 来源修正

```
ctx.name2 → ctx.name1
```

---

## 三、改动清单

### Phase 0: NPC 多方案系统（新增）— 方案存储于 vault

**存储位置**：`vault.content.npc_schemes`（结构化 JSON），而非世界书。

**理由**：
1. 方案是**运维配置**（「这个世界的 NPC 该追踪什么字段」），不是世界设定（「魔法分三系」）。世界设定放世界书，配置放 vault。
2. JSON 结构化存储，不依赖文本解析，无格式脆弱性。
3. 不受用户在世界书 UI 中禁用 `NE_Memory_State` 的影响。
4. 不在 Main LLM 每轮的 ST 世界书扫描中被遍历检查。
5. 不在用户的世界书编辑器中产生噪音条目。

**方案发现 prompt 输入**：LLM **读取**所有活跃世界书的 content 文本来理解世界观，但**输出**（方案定义）写入 vault，不写回世界书。

**数据流**：

```
初始化时（vault version === 0 或首次开启 State Schema）
    │
    ▼
Step A: 检查 vault.content.npc_schemes 是否已存在
    ├── 有 → 直接使用，无需 LLM 调用
    └── 没有 → 
        │
        ▼
Step B: 收集所有活跃世界书条目的 content 文本
    → 构建 scheme discovery prompt（世界书条目作为输入上下文）
    → callMemoryPipeline → LLM 返回 schemes JSON
    → 存入 vault.content.npc_schemes
    │
    ▼
Step C: world book 为空
    → 使用 DEFAULT_NPC_SCHEME（从 DEFAULT_CHARACTER_SCHEMA.npc 派生）
    → 存入 vault.content.npc_schemes
    → 无需 LLM 调用
```

**NPC 方案分配**（per-character，State LLM 在首次遇到时）：

将 `npc_schemes` 的摘要注入 State LLM 的 system prompt（简要列出可用方案），LLM 在 `state_changes` 中指定 `characters.<name>._scheme`。

```
State LLM prompt 中看到：
  可用 NPC 方案：
    humanoid_npc — 人类/精灵等类人生物 (required: gender_age, occupation, personality, affection, relationship, current_mood)
    monster_npc  — 怪物/野兽/龙 (required: species, threat_level, status)

新模式 "哥布林" 出现
  → LLM 输出: "characters.哥布林._scheme": "monster_npc"
  → 该角色之后始终按 monster_npc 字段集展示
```

| # | 改动 | 文件 | 类型 |
|---|------|------|------|
| 0.1 | 新建 `DEFAULT_NPC_SCHEME` — 从 `DEFAULT_CHARACTER_SCHEMA.npc` 提取 required/optional 字段。兜底方案。 | `schema.js` | 新增 |
| 0.2 | 新建 `buildSchemeDiscoveryPrompt(worldBookEntries)` — 用所有世界书条目的内容构建 LLM prompt（世界书是 LLM 理解世界观的**输入**，方案是**输出**到 vault） | `update.js` | 新增 |
| 0.3 | 新建 `resolveNpcSchemes(vault)` — 入口函数：检查 `vault.content.npc_schemes`，不存在则调用 LLM 生成 | `schema.js` | 新增 |
| 0.4 | 在 `bootstrapVault` 中调用 `resolveNpcSchemes(vault)`（version === 0 且 State Schema 开启时） | `bootstrap.js` | 新增 |
| 0.5 | `buildStateInjectionTable` — NPC 读取 `char._scheme` 从 `vault.content.npc_schemes` 获取字段列表；PC 使用固定 protagonist 字段集 | `schema.js` | 重构 |
| 0.6 | `ensureCharacterTemplate` — PC 用 protagonist 模板，NPC 按 `char._scheme` 的 required+optional 初始化 | `schema.js` | 重构 |

### Phase 1: Schema 定义层清理 (`src/core/vault/schema.js`)

| # | 改动 | 类型 |
|---|------|------|
| 1.1 | 删除 `CORE_SCHEMA` 和 `CORE_STATE_FIELDS` (L39-L44) | 删除 |
| 1.2 | 删除 `power_slot_defs` 和 `power_slots` 字段（已有独立初始化） | 删除 |
| 1.3 | 删除 `clothing_mode` 和 `inventory_mode` 字段 | 删除 |
| 1.4 | 删除所有字段的 `expose_level` 属性 | 删除 |
| 1.5 | 删除 `STATE_INJECTION_FOLDED_FIELDS` (L576) | 删除 |
| 1.6 | 删除 `formatCoreStateSummary` (L551-L560) | 删除 |
| 1.7 | 删除 `validateCharacterCard` (L758-L777) | 删除 |
| 1.8 | 添加 `extractCharacterFields(schemaEntry)` — 从 schema 定义中提取 `{ required: [...], optional: [...] }` | 新增 |
| 1.9 | 删除 `update_rule` 字段 | 删除 |
| 1.10 | 新建 `PC_INJECTION_FIELDS` — 从 `DEFAULT_CHARACTER_SCHEMA.protagonist` 自动生成 | 新增 |

### Phase 2: Injection 表改造 (`src/core/vault/schema.js`)

| # | 改动 | 类型 |
|---|------|------|
| 2.1 | 删除 `STATE_INJECTION_CHAR_FIELDS` 的 ▲/△/○/◆ flag | 删除 |
| 2.2 | 删除 `STATE_INJECTION_CHAR_FIELDS` 本身，改为函数式获取 | 重构 |
| 2.3 | `buildStateInjectionTable` — PC 使用 `PC_INJECTION_FIELDS`；NPC 根据 `char._scheme` 选择方案字段 | 重构 |
| 2.4 | `(未填)` 标记保留（仅对 required 字段，值为空时显示） | 保留 |

### Phase 3: Prompt 重构 (`src/core/engine/update.js`)

| # | 改动 | 类型 |
|---|------|------|
| 3.1 | Rules 删除 ▲/△/○/◆ 说明 — 改为 required/optional 二分 | 重构 |
| 3.2 | 在 State LLM prompt 中展示可用方案列表（仅 NPC 角色，简要概述 scheme 名+字段） | 新增 |
| 3.3 | Required 字段：空的优先填，有值的变化时输出 | 保留语义 |
| 3.4 | Optional 字段：仅在对话明确提及时填写 | 保留语义 |
| 3.5 | 保留「每个字段独立判断」+「禁止编造」 | 保留 |
| 3.6 | 删除 `buildStatePrompt_Dynamic` — 与 `buildStatePrompt_Preset` 合并为单一 `buildStatePrompt` 函数。动态模式已被 NPC 方案替代，无需分支。 | 删除+合并 |

### Phase 4: 模板初始化修复 (`src/core/vault/schema.js` + `src/core/engine/update.js`)

| # | 改动 | 类型 |
|---|------|------|
| 4.1 | `ensureCharacterTemplate` — PC 用 protagonist 模板；NPC 用 `npc_schemes[char._scheme]` 的 required+optional 字段初始化 | 重构 |
| 4.2 | 移除 number 的默认值 0 — 改为不初始化（未测量） | 重构 |
| 4.3 | `ensureStateStructure` — 删除 CORE 遍历 | 删除 |

### Phase 5: protagonist_name 来源修正 (`src/adapter/events.js`)

| # | 改动 | 类型 |
|---|------|------|
| 5.1 | `ctx.name2` → `ctx.name1` | 修复 |

### Phase 6: UI 面板重构 (`src/adapter/panel.js`)

| # | 改动 | 类型 |
|---|------|------|
| 6.1 | 删除 expose_level 相关的 summary/detail 分层渲染 | 删除 |
| 6.2 | 所有字段平级渲染（required 在前，optional 在后） | 重构 |
| 6.3 | `.ne-char-card-body` 受 `.open` 类控制 `display`（默认折叠/展开可配置） | 重构 |
| 6.4 | 删除 clothing_mode/inventory_mode 字段渲染 | 删除 |
| 6.5 | 卡片 header 显示方案名（如 `NPC · 人形`） | 新增 |
| 6.6 | affection progress bar 仅在 NPC 时渲染 | 保留 |
| 6.7 | Power slots 保留独立渲染（不受 schema 影响） | 保留 |

### Phase 7: 死代码清理 + 世界书同步废弃（全局）

| # | 改动 | 文件 | 类型 |
|---|------|------|------|
| 7.1 | `whitelistStateChanges` — 删除 | `validate.js` | 删除 |
| 7.2 | `parseSTMResponse` — 删除 Schema OFF 时的 whitelist 分支 | `update.js` | 删除 |
| 7.3 | `syncStateToWorldBook` — 删除（包括所有调用点） | `worldbook-sync.js`, `update.js` | 删除 |
| 7.4 | `syncGlobal` / `syncCharacters` / `syncFactions` / `syncQuests` — 删除 | `worldbook-sync.js` | 删除 |
| 7.5 | `formatWorldBookCharacterCard` / `formatWorldBookFactionCard` / `formatWorldBookQuestCard` / `formatWorldBookGlobal` — 删除 | `schema.js` | 删除 |
| 7.6 | 所有 `CORE_STATE_FIELDS` 引用 | 全局 | 清理 |
| 7.7 | `buildWorldBookSection` — 重构：直接通过 `runtime.getLorebookEntries` 读取激活的世界书条目文本（不再依赖 `runtime.getWorldInfo()` 的激活过滤）。方案发现 prompt 也使用此函数获取世界书上下文。 | `update.js` | 重构 |

### Phase 8: 测试用例同步

| # | 改动 | 类型 |
|---|------|------|
| 8.1 | `pipeline-state-01` — objective 更新 | 更新 |
| 8.2 | `pipeline-state-03` — objective 更新 + 增加方案相关断言 | 更新 |
| 8.3 | `pipeline-state-04` — 同上 | 更新 |

---

## 四、方案数据结构（存储于 vault）

```json
// vault.content.npc_schemes — 由 LLM 生成（或兜底 DEFAULT_NPC_SCHEME）
{
  "humanoid_npc": {
    "description": "人类/精灵/矮人等类人生物",
    "required": ["gender_age", "occupation", "personality", "affection", "relationship", "current_mood"],
    "optional": ["inner_thoughts", "clothing_build", "past_experience"]
  },
  "monster_npc": {
    "description": "怪物/野兽/龙等非人生物",
    "required": ["species", "threat_level", "status"],
    "optional": ["weakness", "territory", "behavior"]
  },
  "default": {
    "description": "兜底方案，用于无法归类的 NPC",
    "required": ["gender_age", "occupation", "status"],
    "optional": ["personality"]
  }
}

// state.characters.<name> — 每个角色携带方案引用
{
  "艾莉丝": { "_scheme": "humanoid_npc", "gender_age": "18岁女性", ... },
  "哥布林": { "_scheme": "monster_npc",  "species": "哥布林", ... },
  "江岚":   { "_scheme": null, ... }  // PC，_scheme 为空（使用 PC 方案）
}
```

**方案摘要注入**：`buildStateInjectionTable` 从 `vault.content.npc_schemes` 直接读取 JSON，在 State LLM system prompt 中格式化展示（简要列出可用方案名 + 字段），不需要文本解析。

---

## 五、数据兼容性

### Vault 迁移

旧 vault 中：
- `expose_level` / `clothing_mode` / `inventory_mode` 保留在 JSON 中但不读取
- 旧 NPC 字段保留（不会被清空）
- `npc_schemes` 不存在 → `resolveNpcSchemes` 在下次初始化时生成并写入 vault
- 已有 NPC 的 `_scheme` 不存在 → fallback 到 `"default"` 方案

### PC 字段清理

旧 vault 中 PC 存在的 NPC 专属字段（affection 等）不删除，但不再被 injection 表引用，LLM 不会再填入。

---

## 六、验证

1. `npm run build` 通过
2. 22 测试用例注册正常
3. `dist/index.js` 中无 flag 字符 (▲/△/○/◆)、无 `expose_level`、无 `clothing_mode`/`inventory_mode` 作为 UI 字段
4. `dist/index.js` 中 `CORE_STATE_FIELDS` 无引用
5. `DEFAULT_NPC_SCHEME` 正确从 `DEFAULT_CHARACTER_SCHEMA.npc` 派生
6. `buildStateInjectionTable` 按 scheme 展示不同字段集

---

## 七、不改动的部分

- `autoDecayStaleCharacters`
- `injection.js` SmartPush 逻辑 + NE-BANNER state 注入（保留并强化——这是 State→Main LLM 的唯一路径）
- `context-window.js`
- `consolidate.js` LTM
- `stm-extractor.js` STM
- `pipeline-guard.js`
- Power slots 系统（保持独立）

### 将被删除的文件

| 文件 | 原因 |
|------|------|
| `state-discovery.js` (全部) | 被 NPC 方案系统替代 |

### 将被部分删除/大幅精简的文件

| 文件 | 保留 | 删除 |
|------|------|------|
| `worldbook-sync.js` | `ensureStateWorldBook()`（创建 NE_Memory_State 书）、底层 API 封装（`getLorebookEntries` 等） | `syncStateToWorldBook()`、`syncGlobal()`、`syncCharacters()`、`syncFactions()`、`syncQuests()` |
