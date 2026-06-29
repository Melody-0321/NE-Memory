# 提示词三层结构重构计划

## 摘要

将外部滚动总结提示词中的「三层结构」模式应用到 NE Memory 全部 3 个主提示词中，提升 LLM 对否定指令的遵守率。同时修复 State LLM 的 charCard KV-Cache 位置 bug。

---

## 当前状态分析

### 现存问题

1. **否定指令与肯定指令混排**：各提示词中 "Do NOT output X" 与 "You MUST output Y" 散落在同一个 Rules 列表里，LLM 对末尾指令赋予最高权重（原则 1.1），混排导致否定指令被稀释。

2. **禁止的是抽象字段名而非具体短语**：State LLM 的 `Do NOT output present_characters` 是字段名级别的禁止，不如 `不要写"关系升温""感情加深"` 这类具体短语有效。

3. **缺少"已被后续推翻的信息"指导**：buildRetrievalPrompt 的 SELF-VERIFICATION 规则只提到冲突检测，没有"以前者为准推广到后续可覆盖"的主动清理指令。

4. **已知 bug**：buildStatePrompt_Preset 中 charCard 放在 system[0]（Message 1），但 newCharHint 中写 `从上方角色卡中提取` 在 system[1]（Message 2），违反原则 1.2（语义共现）。导致 LLM 在 Message 2 中找不到 charCard 数据源。

### 涉及文件

| 文件 | 提示词 | 行号 |
|------|--------|------|
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L487-L594) | buildBatchPrompt + buildStmOnlyPrompt | L487-L594 |
| [update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L998-L1116) | buildStatePrompt_Preset | L998-L1116 |
| [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js#L596-L661) | buildRetrievalPrompt (v2) | L596-L661 |

---

## 参考模式：外部提示词的三层结构

```
## 需要保留（6条肯定指令 — LLM 知道要做什么）
1. 当前明确的时间锚点与地点
2. 关键剧情推进与场景转换
...

## 请省略（4条否定指令 — LLM 知道不要做什么）
* 寒暄、重复确认、无信息量的过场动作
* 已被后续情节覆盖、取消或推翻的内容
...

## 严格禁止（独立段放在末尾 — 底线规则）
* 不要写"关系升温""感情加深""更加信任"等关系性总结
* 不要替角色判断感情状态
* 不要用原作设定纠正 AU 设定
```

关键设计特征：
- 三层各自独立成段，有显式标题
- 「严格禁止」放在末尾（原则 1.1：LLM 对最后见到的指令赋予最高权重）
- 禁止的是**具体短语**而非抽象概念

---

## 变更方案

### 变更 1：重构 buildBatchPrompt / buildStmOnlyPrompt（STM 提取）

**文件**：[update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) L558-L593

**当前结构**：所有规则（覆盖、不重叠、禁止代词、无意义内容不生成事件）混排为一个 Rules 列表。

**重构后结构**：

```
你是故事记忆提取器...（角色描述不变）

## 需要提取（以下内容必须捕获）
1. 覆盖 ALL turns 0~N，不留空、不跳过
2. 事件必须互不重叠
3. 使用角色全名，禁止代词
4. ...（schema 不变）

## 请忽略（以下内容不要生成事件）
* 寒暄、问候、应答确认语、语气词 — 并入最近有意义事件
* 无信息量的过场动作（起身、坐下、点头等，除非改变剧情方向）
* 已在同一批次前文中描述过的重复内容

## 严格禁止
* 不要为琐碎内容硬编事件
* 如果整个 batch 无可提取的有效事件，events 设为空数组 []
```

**改动量**：~20 行重新组织（规则内容基本相同，仅结构调整 + 补充省略列表）

---

### 变更 2：重构 buildStatePrompt_Preset（State LLM）+ 修复 KV-Cache bug

**文件**：[update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js) L998-L1116

#### 2a. 修复 KV-Cache bug（与重构绑定）

**问题**：charCard 在 system[0]，newCharHint 在 system[1]。newCharHint 写 `从上方角色卡中提取`，但上方是 system[0]——跨消息语义共现断裂。

**修复**：将 charCard 从 system[0] 移到 system[1]（与 stateTable + worldBook + newCharHint 同组），system[0] 仅保留 rulesStatic。

修改前（L1075-L1081）：
```javascript
system: [
    (charCard || '') + rulesStaticEn,       // Message 1: charCard + rules
    stateTable + worldBook + fallbackNote + newCharHintEn  // Message 2: state + worldBook + hint
]
```

修改后：
```javascript
system: [
    rulesStaticEn,                           // Message 1: rules only (immutable, KV-Cache hit)
    charCard + stateTable + worldBook + fallbackNote + newCharHintEn  // Message 2: data + hint (semantic co-occurrence)
]
```

中英文两分支都需改。

#### 2b. 三层结构重构

**当前 rulesStatic 结构**（混排）：
```
## 字段规则
- 你管理: gender_age, physique, ...
- 已有 _scheme 的 NPC — 不要修改
- 不要输出 present_characters
- 字段已有具体值 → 仅在变化时输出
- 零变化示例: {"state_changes":{}}
- 你也管理 factions...
```

**重构为三层**：
```
## 字段规则
...（肯定性规则：管理哪些字段、何时输出、JSON 路径等）

## 请勿修改
* 已有 _scheme 的 NPC — 不要修改其 scheme
* present_characters — 不要输出（自动生成）

## 严格禁止
* 不要写 "感情升温""关系加深""更加信任""产生依赖""逐渐靠近""产生羁绊" 等关系性判断
* 不要替角色判断感情状态或动机
* 不要输出 affection、current_mood、inner_thoughts 字段（这些由主 LLM 管理）
* 不要用原作设定纠正、补全或覆盖当前对话中的设定
```

**newCharHint 内部也需三层化**（当前只有肯定指令 + 示例）：
```
## 新角色（必须填充）
## 需要填充
- gender_age：从上方角色卡中提取...
- ...

## 严格禁止
- 不要从对话中推断（必须从角色卡 / World Book 中提取静态字段）
- 不要编造不存在的角色信息
```

#### 2c. 补充"已被推翻的信息"指令

在 rulesStatic 末尾（「严格禁止」段之后）追加：
```
## 覆盖规则
* 若本轮对话明确推翻或更新了已有的角色信息（如换了衣服、受了新伤），以前值为准覆盖，不要同时保留新旧版本。
* 若信息源（角色卡 / World Book）与对话内容冲突，以对话内容为准。
```

---

### 变更 3：重构 buildRetrievalPrompt（SmartPush 检索合成）

**文件**：[retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js) L596-L661

**当前结构**：8 条规则 + CRITICAL FACT CONSTRAINT + Output format + SELF-VERIFICATION + MULTI-TOPIC，全部平铺。

**重构后结构**（保持现有规则编号但重新分段）：

```
## 合成规则
1. RELEVANCE...（不变）
2. GROUPING...（不变）
3. EXPAND...（不变）
4. TIME COORDINATES...（不变）
5. COMPLETENESS...（不变）
6. SELF-CONTAINED...（不变）
7. UNCERTAINTY...（不变）
8. KNOWLEDGE BOUNDARY...（不变）

## 请勿包含
* 不要添加当前时间锚点或来源标记（见规则 4）
* 不要包含内部 ID — stm_、ltm_、msg_ 等模式（见规则 5/6）
* 不要使用交叉引用（"参见上文"、"如前所述"）
* 已被后续事件明确推翻的早期信息，以前者为准，不要同时呈现矛盾版本

## 严格禁止
* 禁止推断动机、情感或因果 — 除非原文明确陈述（事实约束）
* 若事件原因未说明，写 "原因不明" / "cause unknown"，不要补全
* 不要写 "这段展示了感情的进展""体现了人物的成长" 等评论性总结
* 不要将不同时间线的事件混为一谈
```

SELF-VERIFICATION 段保留在 Output format 之后（作为输出前自检）。

**改动量**：~30 行重组 + 新增「已被推翻信息的覆盖」指令

**注意**：此重构只改 system prompt 文本结构，不改变 `{ system, user }` 的调用接口。

---

## 设计决策

| 决策 | 理由 |
|------|------|
| 「严格禁止」放在末尾 | 原则 1.1：LLM 锚定最后见到的指令 |
| 禁止短语用引号包裹具体示例 | LLM 更容易做精确字符串匹配而非语义理解 |
| charCard 移到 Message 2 但不影响 Message 1 的 KV-Cache | Message 1 只保留 rulesStatic（每轮相同），Message 2 含可变数据 |
| 不改变 buildRetrievalPrompt 的调用接口 | System prompt 是纯字符串，只在内部段落顺序调整 |
| 所有三层标题统一使用 `## 需要提取` / `## 请忽略` / `## 严格禁止` | 一致性，LLM 在多次调用中形成结构锚点 |
| 中英文两个分支的「严格禁止」短语列表相同 | 用户可能在同一对话中切换语言设置 |

---

## 验证步骤

### 构建验证
```bash
npm run build
```

### 提示词输出验证（手动）
1. 在每个重构后的函数内部加 `console.log('[NE-DEBUG] <prompt_name> system:', system)` 
2. 运行一次对话，观察 console 中输出的完整拼接提示词
3. 人眼检查：
   - 「严格禁止」是否在末尾？
   - 肯定/否定指令是否分层清晰，没有混排？
   - charCard 和 newCharHint 是否在同一个 Message（system[1]）中？
   - 中英文版本结构是否一致？

### 回归测试
```javascript
// 全链路冒烟 — 验证提示词重构后管线正常
await __ne_debug.runTestByName('smartpush-14')
```

### 信号冲突检查（原则 3.2）
| 检查项 | 目标 |
|--------|------|
| Must/May 冲突 | 「必须输出 state_changes」与「零变化 {}」不矛盾（由条件分支控制） |
| 示例矛盾 | 正确示例不在「严格禁止」段附近（不违反原则 2.1） |
| 末尾锚点 | 每个提示词的最后一个指令是「严格禁止」段 |
| 源模糊性 | newCharHint 明确指向 charCard / World Book，不跨 Message 引用 |

---

## 执行顺序

1. **buildBatchPrompt / buildStmOnlyPrompt** — 改动量最小，先行验证三层结构模式
2. **buildStatePrompt_Preset** — 改动量最大（三层 + KV-Cache bug fix）
3. **buildRetrievalPrompt** — 改动量适中，收尾
4. `npm run build` + 冒烟测试
