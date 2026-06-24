# 「异世界和平」角色卡 — 系统工程分析

## 一、卡片构成概要

```
异世界和平.png
├── data (Spec V3 JSON, 827K)
│   ├── name: "异世界和平"
│   ├── description/personality/scenario: ★全部为空
│   ├── first_mes: 序幕演出（64行 game_response XML + 含UpdateVariable）
│   ├── extensions:
│   │   ├── tavern_helper: MVU变量系统 + 资源预载 + 角色名scanner
│   │   ├── depth_prompt: {depth:4, role:"system", prompt:""}
│   │   ├── regex_scripts: 6条正则（PC/手机/去变量/折叠变量/状态栏占位）
│   │   └── world: "异世界和平" （绑定世界书）
│   └── (无 character_book 内嵌)
│
└── 绑定世界书: 异世界和平.json (98条目)
    ├── 4 条 输出格式规范（24: 游戏化输出格式）
    ├── 1 条 核心角色数据库 (58, 7角色档案)
    ├── 1 条 概念数据库概况 (83, EJS)
    ├── 1 条 变量完整schema (85, ~10KB JSON)
    ├── 1 条 GM规则 (84, 历法+叙事规则)
    ├── 1 条 角色立绘列表 (87, 86个立绘名)
    ├── 1 条 场景背景列表 (88)
    ├── 1 条 BGM列表 (96, 91首)
    ├── 1 条 报纸更新规则 (97)
    ├── 10 条 EJS动态章节（20,21,23,83,86,90,91,92,93,94）
    │   └── 每条含：标题、角色、场景、核心目标、剧情纲要、NPC行为、
    │            伏笔悬念、章节终止条件、变量更新指令<UpdateVariable>
    └── ~40 条 角色/设定/机制条目
```

**关键发现**：这张卡不使用传统角色的 description/personality/scenario 字段。**所有内容都通过世界书和 first_mes 组织**。

---

## 二、运行时架构（五层模型）

```
┌─────────────────────────────────────────────────────────────┐
│                      世界书注入（ST 世界书引擎）               │
│  根据关键词扫描激活条目 → 注入到 LLM system prompt            │
│                                                             │
│  注入内容：                                                  │
│  - 输出格式规范（<游戏化输出格式>）                            │
│  - 核心角色数据库（<核心角色数据库>）                          │
│  - 概念/设定（历法、魔法体系等）                               │
│  - GM规则                                                     │
│  - 资源列表（sprite/scene/bgm/cg）                           │
│  - 当前章节（EJS 条件激活）                                   │
│  - 变量schema（<变量定义与更新规则>）                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM 一次输出                               │
│                                                             │
│  LLM 输出包含两大块：                                         │
│                                                             │
│  ① <game_response> XML                                       │
│     旁白/对话/[bg|bgm|cg|choice]/[action|角色|shake]          │
│                                                             │
│  ② <UpdateVariable> 块                                       │
│     _.set('世界状态.当前地点[0]', '神殿')                      │
│     _.assign('角色', '露娜玛丽亚', {fullName: [...], ...})    │
│     _.add('角色.莉莉亚.favorability[0]', 5)                   │
│     <Analysis> 变化推理 </Analysis>                          │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌─────────────────────────┐  ┌──────────────────────────────┐
│    Regex 层（6条正则）    │  │    MVU 变量引擎              │
│                         │  │  (tavern_helper)              │
│  ① game_response →     │  │                              │
│     iframe 前端渲染     │  │  消费 <UpdateVariable>        │
│                         │  │  执行 _.set/_.assign/_.add    │
│  ② <UpdateVariable>    │  │  写入 stat_data 内存对象       │
│     → 从 LLM 上下文剥离  │  │                              │
│     (节省 token)        │  │  变量 schema 校验             │
│                         │  │  模板创建新角色               │
│  ③ <UpdateVariable>    │  │                              │
│     → <details> 折叠显示 │  │                              │
│                         │  │                              │
│  ④ <StatusPlaceHolder/> │  │                              │
│     → 从 LLM 上下文剥离  │  │                              │
└─────────────────────────┘  └──────────────────────────────┘
              │                           │
              └───────────┬───────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    前端渲染层                                  │
│                                                             │
│  iframe 加载: https://ikemenrourou.github.io/ISKHW/          │
│                                                             │
│  接收 game_response XML → 解析 → 渲染:                       │
│  - 角色立绘（按 sprite_list 匹配文件名）                      │
│  - 场景背景（按 scene_list 匹配）                             │
│  - BGM 播放（按 bgm_list 匹配）                              │
│  - CG 插画（插入/隐藏）                                      │
│  - 选项 menu                                                │
│  - 状态栏（MVU stat_data 渲染）                              │
│  - 角色 portrait 动作 (shake/jump_up/jump_down)              │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、State 系统：MVU（MagVarUpdate）

### 3.1 变量 schema（自文档化）

世界书条目 85 定义了完整 schema。关键设计：

```
{
  "$meta": {
    "extensible": false,        // 顶层不可扩展（结构化锁）
    "required": ["世界状态", "玩家状态", "角色"]
  },
  "世界状态": {
    "当前日期": ["天之月 30日", "格式为'XX之月 XX日'"],
    "当前时间段": ["午后", "可能值: 清晨, 午前, 午后, 傍晚, 夜晚"],
    "当前地点": ["阿尔伯特公爵府邸", "玩家所在的宏观与微观地点"],
    "当前互动角色": [["莉莉亚"], "当前场景中与玩家互动的角色名数组"],
    "已解锁成就": [["序幕", "$__META_EXTENSIBLE__$"], "已完成的剧情事件"],
    "主线任务": [[{"名称":"...","详情":"..."}, "$__META_EXTENSIBLE__$"], "任务数组，最后一个=当前"],
    "行动建议": [["开始探索"], "1-4条建议，每次完整替换"],
    "报纸": {"报刊名":"...", "头条标题":"...", ...}
  },
  "玩家状态": {
    "基本属性": {"rank": "史莱姆以上，哥布林未满"},
    "货币": {"里拉(R)": 0, "白金币": 0},
    "技能": [[{name:"言语加护",effect:"..."}, "$__META_EXTENSIBLE__$"], "技能列表"],
    "称号": [[], "称号列表"],
    "物品栏": {
      "$meta": {"extensible": true, "template": {"type":"杂物","quantity":1,"isEquipped":false}},
      "连帽卫衣": {"type":"服装","quantity":1, "isEquipped":true}
    }
  },
  "角色": {
    "$meta": {
      "extensible": true,
      "template": {
        "fullName": ["未知",""], "nickname": ["未知",""],
        "affiliation": ["所属不明",""], "race": ["未知",""],
        "rank": ["未知",""], "relationship_with_user": ["陌生人",""],
        "favorability": [0,""], "likes": [["$__META_EXTENSIBLE__$"],""],
        "dislikes": [["$__META_EXTENSIBLE__$"],""], "chatHistory": [[]],
      }
    }
  }
}
```

### 3.2 自文档化的值格式

每个变量值是一个 **`[value, description]` 双元组**：

```javascript
"当前日期": ["天之月 30日", "格式为'XX之月 XX日'"]
"当前时间段": ["午后", "可能的值: 清晨, 午前, 午后, 傍晚, 夜晚"]
```

这意味着**schema 自己就是文档**——LLM 看到变量键名就知道值的语义和格式。

### 3.3 `$__META_EXTENSIBLE__$` 标记

Extensible 数组的末尾始终有 `"$__META_EXTENSIBLE__$"` 标记，表示"此数组可追加新元素"。代码层和 LLM 都知道这个约定。

### 3.4 变量更新命令（三种操作）

| 命令 | 语义 | 示例 |
|------|------|------|
| `_.set(path, value)` | **完整替换**某个变量 | `_.set('世界状态.当前地点[0]', '神殿')` |
| `_.assign(path, [key,] value)` | **深度合并**到对象或**覆盖**数组元素 | `_.assign('角色', '露娜玛丽亚', {...})` |
| `_.add(path, value)` | **追加**到数组 | `_.add('玩家状态.货币.里拉(R)', 50000)` |

三种操作覆盖了所有状态变更场景，没有歧义。比我们的"merge/replace/append"概念更具体——因为它直接给出**代码执行的指令**而非**策略声明**。

### 3.5 `<Analysis>` 推理块

每次变量更新都附带 `<Analysis>` 块，让 LLM 先**用自然语言推理**，再输出指令。这是 Chain-of-Thought 在状态更新中的应用。

```
<Analysis>
  - Duplication Check: Lilia already exists → UPDATE
  - World Status: location神殿, time午后, active characters [...]
  - Player Status: gained 言语加护 ability
</Analysis>
_.set('世界状态.当前地点[0]', '神殿');
_.assign('角色', '露娜玛丽亚', {...});
```

---

## 四、LLM 与代码的分工

### 4.1 LLM 负责什么

| 职责 | 方式 |
|------|------|
| 叙事创作 | `<game_response>` XML 内的旁白/对话/视觉指令 |
| 状态变更推理 | `<Analysis>` 自然语言推理 |
| 输出变更指令 | `_.set` / `_.assign` / `_.add` 声明式命令 |
| 角色行为整合 | 按 GM 规则将玩家行为后果融入主线框架 |

### 4.2 代码负责什么

| 职责 | 方式 |
|------|------|
| 执行变量更新 | MVU 引擎消费 `<UpdateVariable>` 块，执行 lodash 命令 |
| 上下文剥离 | Regex 将 `<UpdateVariable>` 从 LLM 下次 context 中移除 |
| Schema 校验 | 按 schema 定义的类型/模板/required 校验 |
| 前端渲染 | iframe 解析 game_response XML + MVU stat_data |
| 资源匹配 | 按 sprite_list/scene_list/bgm_list 验证 LLM 输出引用 |

### 4.3 核心洞察

**LLM 写的是"要做什么"，代码执行的是"怎么做"。**

这与我们讨论的方案 C（代码选田 + LLM 耕田）方向一致，但更加激进——这里 LLM 不仅填值，还选字段和操作类型。代码不筛选字段，而是**执行并校验 LLM 的指令**。

但异世界和平不需要担心字段泛滥——因为它的**变量 schema 是固定的**。不像 NE-Memory 的按需创建模型，字段范围是 schema 锁死的。

---

## 五、Context 管理策略（三大手段）

### 5.1 上下文剥离

LLM 输出的 `<UpdateVariable>` 块在**下一轮对话前被正则删除**。LLM 下一轮看不到自己上轮写的状态更新细节——它只看到 MVU 系统维护的 `stat_data` 结果（通过世界书 EJS 模板中的 `getvar()` 调用）。

### 5.2 占位符模式

```
<StatusPlaceHolderImpl/>
```

这个标记出现在 LLM 的上下文里，告诉它"这里有一个状态栏"，但**状态栏的真实数据不进入 LLM 上下文**。Regex 在发送给前端前把它删掉。

LLM 不需要看到"莉莉亚好感度: 42 / 克罗好感度: 38 / ..."这些原始数字——它只需要知道"有一个状态栏渲染着这些数字"。

### 5.3 EJS 成就门控

章节条目用 EJS 条件包裹：

```
<%_ if (_.includes(getvar('stat_data.世界状态.已解锁成就[0]') || [], "初访魔界") { _%>
章节信息: 第24章...
变量更新指令: <UpdateVariable>...</UpdateVariable>
<%_ } _%>
```

当前章节没解锁的后续章节**完全不进入 LLM 上下文**。这意味着这个世界书虽然有 98 条条目，但每轮实际注入的内容只包含当前章节 + 通用规则 + 核心角色 + 变量 schema。

---

## 六、NE-Memory 可参考的设计模式

### 6.1 ★ 最高价值：上下文剥离 → state 更新 block 不进入 LLM 上下文

异世界和平的 `<UpdateVariable>` 在下一轮被正则删除，NE-Memory 的 `state_changes` 同样可以做这件事。

**当前 NE-Memory 的问题**：state LLM 输出的 `state_changes` 被 merge 进 vault.content.state，而 `formatStateSummary(content.state)` 在**每次 state LLM 调用时**都把完整 state 注入 prompt。如果 state 里已经有 20 个角色 × 每个 8 字段 = 160 行，每轮都注入就是巨大的 token 浪费。

**解法**：参考异世界和平，"状态栏"不需要让 LLM 看到全貌。State LLM 只需要看到：
- 上轮消息 + 本轮消息（变化检测基准）
- 待填字段表（代码筛查）
- **不需要看到完整的当前 state**

### 6.2 自文档化值：`[value, description]` 双元组

NE-Memory 当前的 state 字段是裸值。异世界和平的双元组格式有两个好处：

1. **LLM 知道自己输出的是什么**——例如看到 `["午后", "可能的值: 清晨, 午前, 午后, 傍晚, 夜晚"]`，LLM 不会输出"大概是下午"这种非枚举值
2. **Schema 即文档**——不需要单独的"字段说明"块

### 6.3 三种命令替代 update_rule

我们讨论过 update_rule（replace/merge/append/once），异世界和平的方案更直接：**不要让 LLM 声明策略（replace/merge），让 LLM 写具体的执行命令（_.set/_.assign/_.add）**。

NE-Memory 的状态字段可以不是 strategy-declared，而是 operation-instructed：

```
当前（策略声明式）:
  state_changes: { "characters.莉莉亚.favorability": 52 }

改进（命令式）:
  _.set('scene', '神殿')
  _.merge('characters.莉莉亚', {favorability: 52, status: "主役"})
  _.add('quests', {name: "寻找圣剑", detail: "..."})
```

但要注意——命令式比声明式更"重"，token 消耗更大。对于 NE-Memory 的使用场景（每轮增量更新），声明式 flat-object `{"path": "value"}` 可能已经足够。

### 6.4 placeholder 模式：状态栏引用而不展开

NE-Memory 的 state 面板可以提供一个"摘要占位符"：

```
<StatePlaceHolder>
  活跃角色: 莉莉亚, 克罗, 爱西丝
  当前场景: 阿尔伯特公爵府邸
  当前时间: 午后
</StatePlaceHolder>
```

而不是注入完整 500 字 state 摘要。这符合"让 LLM 知道有状态栏，但不让状态栏霸占 context"的原则。

### 6.5 EJS 条件注入 → state 面板按需展开

NE-Memory 的 state 面板可以不是"永远渲染所有字段"，而是"按消息中提到的人/地/事筛选相关字段"：

- 消息中提到了"克罗" → 展开 `characters.克罗` 子面板
- 消息没提到 → 折叠为一行的 `克罗 (好感 48)` 摘要
- 这本质上就是我们讨论的"方案 C：代码选田 + LLM 填空"在面板渲染侧的对应

### 6.6 `<Analysis>` 推理块作为 Chain-of-Thought

异世界和平的每次状态更新都带 `<Analysis>`，但它在"上下文剥离"中被删除了。所以它只在 LLM 自己的输出流中起 CoT 作用——先想再写指令。

NE-Memory 的 `analysis` 字段有相同的用途，但当前标注 "(will be ignored for extraction)" 且全量保留在 output 中。可以改为：
- LLM 端：CoT 推理，不限长度
- 代码端：解析后直接丢弃（不存也不注入）

### 6.7 MVU threefold: set / assign / add 对应 NE-Memory 的需求

| MVU 命令 | 语义 | NE-Memory 对应 | 当前状态 |
|----------|------|---------------|---------|
| `_.set` | 完整替换 | `replace` | 已有（state_changes flat object 就是 replace） |
| `_.assign` | 深度合并对象 | `merge` | **缺失** —— 当我们讨论 update_rule 时提到 |
| `_.add` | 数组追加 | `append` | **缺失** —— 任务列表、成就列表等需要 |

对于 NE-Memory，"多角色 state 中的 characters.XXX 是 object"——当前的 flat object merge 策略是浅合并，会覆盖整个子对象。如果用 `_.assign` 的语义（深度合并），可以只更新 `characters.克罗.favorability` 而不覆盖其他字段。但这个问题也可以留在代码层解决（mergeStateChanges 已经做了深度合并）。

---

## 七、与 NE-Memory 架构的互补

| 维度 | 异世界和平 | NE-Memory |
|------|-----------|-----------|
| State LLM | 无（主 LLM 一次输出叙事+状态） | 独立 State LLM |
| 信息差 | 无（同一个 LLM 大脑） | 存在（结构性，不可消除但可缓解） |
| 字段范围 | 完全固定（schema 锁死） | 按需创建（Schema-Ready 模型） |
| 状态更新策略 | 命令式（_.set/assign/add） | 声明式（flat path→value） |
| 上下文管理 | 剥离 + 占位符 + EJS 门控 | 全量注入完整 state 摘要 |
| 前端的角色 | 独立 iframe 渲染一切 | ST 原生面板 |
| 代码复杂度 | 极高（MVU引擎 + Regex引擎 + 前端） | 中 |
| 创作成本 | 极高（98条世界书 + 前端开发） | 低（一键安装） |

**NE-Memory 的核心优势**：不需要创作者写 98 条世界书，不需要开发 iframe 前端。安装即用，通用性强。

**异世界和平的核心优势**：沉浸式游戏体验，完全消除信息差，LLM 输出即视觉演出。

---

## 八、可实施改动的优先级

### 即刻可做（纯改动现有代码）

| # | 改动 | 灵感来源 | 预计收益 |
|---|------|---------|---------|
| 1 | State LLM prompt 不再注入完整 state 摘要 | 上下文剥离 + 占位符模式 | Token 节省 60%+ |
| 2 | State LLM prompt 注入上轮消息 | 需要对比基线 | 变化检测准确度 |
| 3 | <Analysis> 解析后丢弃 | CoT 模式 | Token 节省 50-100/轮 |
| 4 | 代码层筛选"本轮在玩的字段" | 方案 C + EJS 门控思想 | Token 减少 70% |

### 中期（需要新功能）

| # | 改动 | 灵感来源 | 所需工作量 |
|---|------|---------|-----------|
| 5 | 自文档化值格式 `[value, description]` | 双元组 | ~100行 prompt + schema 改动 |
| 6 | `_.add` 语义支持（append 到数组） | 三种命令 | ~30行 mergeStateChanges |
| 7 | 状态栏占位符（摘要而非全量注入） | <StatusPlaceHolderImpl/> | ~20行 |

### 远期（架构级）

| # | 改动 | 灵感来源 | 权衡 |
|---|------|---------|------|
| 8 | 主 LLM 输出 STATE-HINT | 同一 LLM 大脑消除信息差 | 对话质量 vs state 完备性 |
| 9 | State 面板 EJS 条件渲染 | 成就门控 | 开发复杂度 |

---

## 九、总结

「异世界和平」是一张**系统工程杰作**。它的设计哲学可以概括为：

> **LLM 写剧本和舞台指令，代码执行和渲染。**

这条原则贯穿了它的每一个子系统：
- 叙事 XML → 前端渲染
- UpdateVariable 命令 → MVU 引擎执行
- Regex 剥离 → LLM 上下文保持清洁
- EJS 门控 → 按进度注入内容

NE-Memory 可以从中学到的核心一课是：**不要让 LLM 看到它不需要看到的数据**。State 管线的 prompt 重构成了"方案C：代码选田+LLM填空"后，将天然走向这个方向。
