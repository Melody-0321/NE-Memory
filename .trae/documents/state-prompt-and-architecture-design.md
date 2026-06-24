# State 管线 Prompt 优化与架构设计结论

## 一、Prompt 层优化（7 点）

### P0 — 直接影响正确性

**1. `_checkpoints` 位置约束 + hard gate 补全**

当前 hard gate 只提 `state_changes`，不提 `_checkpoints`。LLM 在 `state_changes` 为空时可能连带省略 `_checkpoints`（Harness Gap B 已兜底，但 prompt 应该是第一道防线）。

> 改法：hard gate 增加 `_checkpoints must ALWAYS be present`。JSON schema 描述中约定 `_checkpoints` 必须是 JSON 输出的第一个字段。

**2. 移除 `_checkpoints.story_date`**

State prompt 的 `_checkpoints` schema 包含 `story_date`，但 `postFillSTM` 只消费 `time` 和 `scene`。`story_date` 通过 `stateChanges.story_date` 走另一条路径（L1395）。同一个字段有两个注入位置，造成 LLM 混淆 + 浪费 token。

> 改法：从 `_checkpoints` 的 JSON schema 示例中移除 `story_date`。

**3. 预设字段说明精简**

`buildStatePrompt_Preset` 的 `stateChangesEn/Zh` 块列出了所有预设字段（`clothing_build`, `injuries`, `power_slots` 等），但 80% 的轮次中这些低频字段不会变化。当前写法是"百科全书式"列举，LLM 被无关信息分心。

> 改法：低频字段移至"仅在消息中提到时更新"的压缩提示中，不在主路径展开。

---

### P1 — 减少 LLM 输出错误

**4. 零变化完整示例**

当前 prompt："If no changes detected, set state_changes to empty array []"——但没有给出完整 JSON。LLM 可能理解为"无变化 → 不需要输出"，这正是 Harness Gap B 要防御的故障。

> 改法：增加零变化的完整 JSON 示例：
> ```json
> {"_checkpoints":{"time":"傍晚","scene":"洋馆客厅"},"state_changes":[]}
> ```
> 文字强调："即使 state_changes 为空，_checkpoints 也必须输出。"

**5. `state_changes` 格式统一为 flat object**

State pipeline prompt 要求 `"state_changes": [{"path":"x","value":"y"}]`（数组），`parseSTMResponse` 立即转为 flat object。STM prompt 的 `stateChangesEn/Zh` 块用 `<state_changes>{"x":"y"}</state_changes>`（flat object）。两个 prompt 用了两种格式，LLM 在不同语境下被训练了不同输出习惯。

> 改法：统一为 flat object 格式 `{"time":"Evening","scene":"客厅"}`，删除 `parseSTMResponse` 中的 array→object 转换。减少 JSON 体积约 40%。

---

### P2 — Token 优化

**6. `analysis` 字段缩短或移除**

State pipeline 要求输出 `"analysis": "Step-by-step reasoning..."`，标注 "(will be ignored)"。每轮浪费 50-100 token。

> 改法：① 保留但缩短——`"analysis": "brief reasoning (1 sentence)"`；② 移除——需冒烟验证不影响输出质量。

**7. State summary 截断**

`formatStateSummary` 将完整 state 注入 prompt（L1049-1050）。state 膨胀后（多角色、多势力、多任务）产生大量 token。

> 改法：截断 state summary——只输出最近有变化的字段，或做字符数限制（如 500 字符）。

---

### 优化要点汇总

| # | 优化点 | 严重度 | 类型 | 预期效果 |
|---|--------|--------|------|---------|
| 1 | `_checkpoints` hard gate 补全 | P0 | 正确性 | 减少 Gap B 触发频率 |
| 2 | 移除 `_checkpoints.story_date` | P0 | 一致性 | 消除 code-prompt 不一致 |
| 3 | 预设字段说明精简 | P0 | 降噪 | 减少 LLM 被低频字段分心 |
| 4 | 零变化完整示例 | P1 | 正确性 | LLM 明确空 state_changes 也要输出 _checkpoints |
| 5 | `state_changes` 统一为 flat object | P1 | 简化 | 消除 array↔object 转换，减少 40% token |
| 6 | `analysis` 字段缩短/移除 | P2 | Token | 节省 50-100 token/次 |
| 7 | State summary 截断 | P2 | Token | 防止 state 膨胀后 token 爆炸 |

**全部 7 项为纯 prompt 改动，不改代码逻辑。**

---

## 二、信息差分析

### 2.1 经典架构 vs NE-Memory

```
经典架构（单 LLM）：
  [用户消息 + 角色卡 + 世界书 + ★完整当前 state★] 
       → 对话LLM → [回复 + 新state + 记忆]
  
  对话 LLM 知道 state 里的一切，因为 state 就是它上一轮自己写的。
  没有信息差——同一个大脑。

NE-Memory（三 LLM）：
  [用户消息 + 注入] → 对话LLM → [回复]
       │
       ├── 对话LLM 不知道 state 详情（只通过 SmartPush 注入看到摘要）
       │
  [本轮2条消息 + 完整state摘要] → StateLLM → [state_changes]
       │
       ├── StateLLM 不知道上轮发生了什么（看不到上轮消息）
       └── StateLLM 不知道对话LLM的"意图"（只看到原始文本）
```

**信息差的本质**：State LLM 被要求做"变化检测"，但它缺少"之前是什么"的直接证据。

---

### 2.2 当前 State LLM 收到的上下文

```
┌─ State LLM Prompt ─────────────────────────────────────┐
│                                                         │
│ ① currentStateSnapshot:                                 │
│    story_day / story_date / story_scene                 │
│                                                         │
│ ② formatStateSummary(content.state) ← 完整当前 state   │
│    几百字的角色/势力/任务摘要                              │
│                                                         │
│ ③ Schema 字段说明（百科全书式）                           │
│                                                         │
│ ④ Hard gate                                             │
│                                                         │
│ ⑤ user 消息（仅本轮 2 条）:                              │
│    [0] [User] user: "..."                              │
│    [1] [Character] assistant: "..."                    │
└─────────────────────────────────────────────────────────┘
```

**关键缺失**：看不到上轮消息，没有对比基线。

---

### 2.3 快照对 State LLM 是否必要？

**不必要。** State LLM 调用 `extractStateChangesOnly` 时，`vault.content` 里的 state 本身就是上轮结束时的 state（还没被这一轮更新）。快照 {time, scene, date} 的内容已被包含在 state 和 story_time/story_scene 里。

**快照的真正用途是给 STM 管线用的** —— STM 管线处理多区间批量消息时，用快照为每个区间填充 period/scene。

---

### 2.4 State LLM 应该看到什么？

| 上下文类型 | 当前是否给 | 应该给？ | 理由 |
|-----------|-----------|---------|------|
| 本轮消息 | ✅ | ✅ 必须 | "after" 画面 |
| 上轮消息 | ❌ | ✅ **应该给** | "before" 画面，变化检测的基准 |
| 上轮快照 | ❌ | ❌ 不需要 | 被 state 和 story_time/scene 覆盖，对 State LLM 冗余 |
| 当前完整 state 对象 | ✅ | ❌ **不应该给** | 噪声！90% 不变，LLM 被无关信息淹没 |
| 已知角色列表 | ✅（嵌在 state 里） | ✅ 精简版 | 只需角色名列表 |
| Schema 字段定义 | ✅ | ⚠️ 精简 | 只给本轮可能变化的类型 |

**核心洞察**：

```
❌ 当前：State LLM 看到"当前宇宙的全貌" → 从全貌中找变化
✅ 应该：State LLM 看到"上轮消息 + 本轮消息 + 待检查字段" → 填空
```

原始叙事才是 ground truth。给 State LLM 结构化 state 数据会：
1. 让 LLM "偷懒"——直接照抄 state 而不从消息中提取
2. 让 LLM "被误导"——state 里有"张三.status:活跃"但本轮张三没出现 → LLM 困惑

---

## 三、方案 C：代码选田 + LLM 耕种

### 3.1 三种方案对比

| | 方案 A（全量 state） | 方案 B（纯对比） | 方案 C（代码选田） |
|---|---|---|---|
| 给 LLM 什么 | 本轮消息 + 完整 state | 上轮 + 本轮消息 | 上轮 + 本轮消息 + 待填字段列表 |
| LLM 任务 | 从全貌中找变化 | 从消息中 de novo 提取 | **填空**：代码给表单，LLM 填值 |
| 单轮 token | 500-1000 | 300-500 | 150-300 |
| 100 轮 token | ~50,000-100,000 | ~30,000-50,000 | ~15,000-30,000 |
| LLM 错误面 | 照抄不变字段 / 幻觉 / 遗漏 | 长期状态失忆 | 仅值层面（path 被代码锁定） |
| 代码复杂度 | 低 | 低 | 中（需 `identifyActiveFields`） |

### 3.2 方案 C 的三层分工模型

```
┌──────────────────────────────────────────────────┐
│                   代码层                           │
│                                                   │
│  ① 正则扫描：从消息中提取实体（人名、地名、势力名）   │
│     结果："张三""李四""酒馆""魔教"被提及             │
│                                                   │
│  ② 字段交叉：匹配实体 ↔ state.characters.*          │
│     结果：张三.status 可能变、李四.current_mood 可能变│
│                                                   │
│  ③ 令牌过滤：只给 LLM "本轮可能变的字段"              │
│     结果：prompt 中只出现 4 个字段而非 50 个          │
│                                                   │
│  ④ 输出校验：LLM 输出的 path 不在令牌内 → 丢弃并告警  │
│                                                   │
│  ⑤ 值合并：LLM 新值 + 代码兜底（autoDecay 等）       │
│                                                   │
├──────────────────────────────────────────────────┤
│                   LLM 层                           │
│                                                   │
│  唯一任务：给定"之前值"和"消息原文"，输出"现在值"      │
│  - 时间推断（"天亮了"→"黎明"）                       │
│  - 场景推断（"走出酒馆"→"街道"）                     │
│  - 情绪推断（"我好了"→current_mood:"平静"）          │
│  - 状态推断（"张三走了"→status:"非活跃"）            │
│                                                   │
│  不需要做的事：                                     │
│  ✗ 决定跟踪哪些字段  ← 代码已决定                    │
│  ✗ 判断字段是否变化   ← 只填值，空则不变              │
│  ✗ 维护字段一致性     ← 代码校验                     │
└──────────────────────────────────────────────────┘
```

### 3.3 LLM prompt 形态（填空题）

代码递给 LLM 的表单：

```
上轮状态（本次需检查的字段）：
  时间: 傍晚
  场景: 酒馆
  张三.status: 活跃
  李四.current_mood: 低落

本轮对话：
[上轮] 李四: "我心情不好。"
[上轮] 张三: "喝一杯就好了。"
[本轮] 小明: "天亮了，该走了。"
[本轮] 李四: "嗯，我好了，走吧。"

输出 JSON（仅输出有变化的字段，未变化的省略）：
{
  "_checkpoints": {"time": "___", "scene": "___"},
  "state_changes": {"___": "___"}
}
```

**LLM 不知道 state 里有 50 个字段，只知道代码让它填的那 4 个。**

### 3.4 可行性结论

- **Token 减少 60-70%**
- **LLM 负担降到只填值**
- **错误面缩小到值层面**
- 代码复杂度增加适中（`identifyActiveFields` 函数，约 30-50 行）
- 不影响现有管线逻辑，仅改 prompt builder 参数

---

## 四、不可消除的信息差与架构决策

### 4.1 两个结构性缺口

**缺口 1：主 LLM 的"隐线"无法被 State LLM 观测**

```
┌── 主 LLM 的内部空间 ──────────────────────┐
│                                             │
│  隐线（不可观测）:                            │
│  "李四其实崩溃了，但他在强撑。                  │
│   下一轮他可能会爆发。"                        │
│                                             │
│  显线（可观测的文字输出）:                      │
│  "李四勉强笑了笑：'我没事。'"                   │
└─────────────────────────────────────────────┘
                    │
      只有显线流到 State LLM
                    │
                    ▼
┌── State LLM ──────────────────────────────┐
│  看到: "勉强笑了笑：'我没事。'"               │
│  记录: current_mood = "平静"    ← 错了      │
└─────────────────────────────────────────────┘
```

**缺口 2：新角色设定不在正文里**

主 LLM 引入酒馆老板，内部画像：退役老兵、粗犷但心善、左腿有旧伤。正文只写："住店三文，吃饭另算。" State LLM 只能提取 `酒馆老板.occupation: "酒馆老板"`，无法还原主 LLM 的角色认知。

### 4.2 是否致命？

| 缺口 | 是否致命？ | 理由 |
|------|-----------|------|
| 内心状态 | **否** | 叙事记忆的载体是对话正文本身，State 记录的是"事实层"——谁在场、在哪儿——而非心理活动 |
| 新角色设定 | **部分** | 长对话中角色设定可能滑出主 LLM 上下文窗口，但可通过 SmartPush 注入 STM 事件缓解 |

### 4.3 核心判断：分离 state 与 context 预算

如果 state 交回主 LLM 处理：

```
主 LLM 每轮的 context 预算：
┌────────────────────────────────────────────┐
│ 角色卡 + 世界书          ~2000 token        │
│ 对话历史                 ~6000 token        │
│ SmartPush 注入            ~1000 token       │
│ ─────────────────────────────────────────  │
│ 【新增】完整 state 对象    ~500-2000 token   │
│ 【新增】state 输出格式要求  ~300 token       │
│ 【新增】state 变更说明     ~500 token        │
│ ─────────────────────────────────────────  │
│ 留给叙事创作的空间         被严重压缩          │
└────────────────────────────────────────────┘
```

**结论：不值得为消除两个非致命缺口而牺牲主 LLM 的叙事创作空间。**

### 4.4 折中方案：STATE-HINT 轻量传递

主 LLM 的回复末尾，允许附加**可选的** 1-2 行 state hint：

```
[STATE-HINT: characters.酒馆老板.description="退役老兵，性格粗犷但心善，左腿有旧伤"]
```

- 主 LLM 在引入新角色或角色发生重大转变时才写
- State 管线消费 hints，合并到 state
- 本质：让信息所有者以最小代价传递关键信息给 state 系统
- 可选——LLM 不写也不影响运行
- 符合"代码做大部分工作、LLM 只填值"的哲学

---

## 五、设计决策汇总

| 决策 | 结论 |
|------|------|
| State LLM 角色定位 | "变化检测器"→"代码筛选字段，LLM 填空" |
| 注入完整 state？ | **❌ 不注入。** 改为代码筛选后的"待填字段列表" |
| 注入上轮消息？ | **✅ 新增。** 作为变化检测的对比基线 |
| 快照对 State LLM？ | **❌ 不需要。** 冗余于上轮 state |
| `_checkpoints.story_date` | **移除。** 与 `stateChanges.story_date` 路径重复 |
| `state_changes` 格式 | **统一为 flat object。** 删除 array→object 转换 |
| `analysis` 字段 | **缩短或移除。** 每轮节省 50-100 token |
| 预设字段说明 | **精简。** 低频字段不展开 |
| 零变化示例 | **新增。** LLM 明确"空 stateChanges 也要输出 _checkpoints" |
| 信息差缺口 | **不可消除。** 但非致命 |
| 放弃分离架构？ | **不放弃。** 主 LLM context 预算优先保障叙事质量 |
| STATE-HINT 机制 | **可选实现。** 让主 LLM 择要传递隐线信息 |

---

## 六、改动范围

### 代码改动（~50 行）

| 文件 | 改动 |
|------|------|
| `update.js` — `extractStateChangesOnly` | 传入上轮消息参数 |
| `update.js` — `buildStatePrompt_Preset` | 重构为"待填字段表"形式 + 精简字段说明 |
| `update.js` — `buildStatePrompt_Dynamic` | 同 Preset 模式重构 |
| `update.js` — 新增 `identifyActiveFields` | 代码层字段筛选（~30 行） |
| `schema.js` — 新增 `state_hints` 消费逻辑 | STATE-HINT 机制（可选，预留接口） |

### Prompt 改动（纯文本，不改代码结构）

| 项 | 内容 |
|----|------|
| `_checkpoints` hard gate | 补全 `_checkpoints` 硬性要求 |
| `_checkpoints` schema | 移除 `story_date` |
| `state_changes` 格式 | array→flat object，删除代码转换 |
| 零变化示例 | 新增完整 JSON 示例 |
| `analysis` 缩短 | `"analysis": "brief reasoning (1 sentence)"` |
| 字段说明精简 | 低频字段压缩 |
| 上轮消息注入 | 新增对比基线 |

### 不便项

- 现有 prompt 文本约 70% 重构（保持语义、精简结构）
- 解析器 `parseSTMResponse` 中 array→object 转换可删除
- State summary 截断逻辑（新增 guard）
- 100 单元测试保持
