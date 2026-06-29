# SmartPush 重构计划 — 实体链为主 + LLM 转信息勘探

## 摘要

将 SmartPush 从"Retrieval LLM 合成叙事散文 → 对话 LLM 消费"重构为"代码层按实体链组织 → Retrieval LLM 做 KB 标注 + 缺口检测 → 代码拼装整合文档 → 对话 LLM 消费"。消除检索 LLM 的叙事合成职责和认知滤网效应，让对话 LLM 直接看到组织化的原始记忆。

---

## 当前状态

```
mergePipelines → threadIndex + Map → toPromptEntries(平面列表, 按评分排序)
    ↓
buildRetrievalPrompt
    ├─ 9 Rules: 相关性/分组/展开叙事/时间/完整性/自包含/不确定性/KB/事实约束
    ├─ conversationContext (2轮滑动窗口)
    ├─ visibleWindow (msg_id 判断)
    ├─ toolGuidance (access + note_thread)
    ├─ availChainHint
    ├─ candidatesText (平面列表 + {L:实体#pos/total} 标注)
    └─ dirBlock (LTM 目录)
    ↓
callMemoryRetrievalWithTools(maxTokens:2048, access最多2次)
    ↓
parseKBAnnotations → 分离 KB 标注 vs 叙事散文
    ↓
formatSmartContext → 拼装 parts: system_prompt + KB block + narrative + gap markers
```

**问题**：
- Retrieval LLM 背负叙事合成 + 相关性过滤——双重认知滤网
- 输出 2048 token 的散文，对话 LLM 丢失了原始条目粒度和所有评分信号
- 实体链仅作为 {L:name#pos/total} 标注挂载，不是主分组结构
- 对话 LLM 无法自行判断哪些记忆在当前场景有价值

---

## 重构后流程

```
mergePipelines → threadIndex + Map
    ↓
代码层 1: 按实体链分组
    ├─ 遍历 threadIndex，按 chain:* 分组 STM 条目到对应实体块
    ├─ 多实体条目：主归属 + 其他实体块用引用
    ├─ 按链内时间排序（非RRF排序），RRF 评分仅标注
    ├─ 无 entities 条目按 RRF 阈值过滤后放入"未标注"块
    └─ LTM 目录保留为独立块，标记为展示而非活跃候选
    ↓
代码层 2: 构建 Retrieval LLM prompt
    ├─ 输入详情：
    │    ├─ 按实体分组的候选块（代码生成）
    │    ├─ NE-BANNER 元数据（显式提取：场景·时间·事件摘要·活跃角色）
    │    ├─ conversationContext（最后 2 轮对话，≤1200 字符）
    │    ├─ visibleWindow（主 LLM 可见的 msg_id 列表）
    │    └─ currentTime（故事当前时间）
    │
    ├─ Rules（三层结构，见变更 10 的完整 prompt 草案）：
    │    ├─"需要做"：KB 认知标注 + 缺口检测（access/chain.X/note_thread）
    │    ├─"空输出"：显式建模无 KB / 无缺口的输出路径
    │    └─"严格禁止"：叙事散文/心理描写/评论/删除候选/推断因果（具体短语禁令+放最后）
    ├─ 工具：access(ref) / access(chain.X) / note_thread(label, stm_ids)
    └─ 柔性 4 次上限
    ↓
callMemoryRetrievalWithTools
    ↓
parseLLMOutput → KB 标注 + 代码自动补全 access() 结果
    ↓
代码层 3: 拼装整合文档
    ├─ 每个实体块 = 链条目(时间排序) + KB 标注 + 残余缺口
    ├─ 多实体引用标注
    ├─ "未标注"块（如有）
    └─ LTM 目录块（如有）
    ↓
formatSmartContext → injectPrompt 给对话 LLM
```

---

## 具体变更

### 变更 1: `mergePipelines` 下游 — 新增 `groupCandidatesByEntity`

**文件**: [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js)

**新增函数**: `groupCandidatesByEntity(map, threadIndex)` → 返回结构化分组对象

```javascript
function groupCandidatesByEntity(map, threadIndex) {
    var groups = {};           // { entityName: { entries: [], refs: [] } }
    var unassignedEntries = [];
    var allEntries = [];
    map.forEach(function(e) { allEntries.push(e); });

    allEntries.forEach(function(e) {
        var entityNames = [];
        if (e.entry.entities && Array.isArray(e.entry.entities)) {
            e.entry.entities.forEach(function(en) { entityNames.push(en.name); });
        }
        // 从 threadIndex 推断：chain:爱丽丝 的 stmIds 包含此条目
        Object.keys(threadIndex).forEach(function(tid) {
            if (tid.indexOf('chain:') === 0) {
                var name = tid.substring(6);
                var stmIds = threadIndex[tid].stmIds || [];
                if (stmIds.indexOf(e.entry.id) !== -1 && entityNames.indexOf(name) === -1) {
                    entityNames.push(name);
                }
            }
        });

        if (entityNames.length === 0) {
            unassignedEntries.push(e);
            return;
        }

        var primaryName = entityNames[0];
        if (!groups[primaryName]) groups[primaryName] = { entries: [], refs: [], name: primaryName };

        groups[primaryName].entries.push(e);

        for (var i = 1; i < entityNames.length; i++) {
            var refName = entityNames[i];
            if (!groups[refName]) groups[refName] = { entries: [], refs: [], name: refName };
            groups[refName].refs.push({ entryId: e.entry.id, primaryName: primaryName });
        }
    });

    // 链内按时间排序（period/scene）
    Object.keys(groups).forEach(function(name) {
        groups[name].entries.sort(function(a, b) {
            var pa = a.entry.period || '';
            var pb = b.entry.period || '';
            return pa.localeCompare(pb);
        });
    });

    return { groups: groups, unassigned: unassignedEntries };
}
```

### 变更 2: 新增 `formatEntityGroupedPrompt` — 替换 `toPromptEntries` 的平面格式

**文件**: [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js)

**新增函数**: `formatEntityGroupedText(groupedResult)` → 按实体块格式化为 prompt 文本

格式：
```
## 爱丽丝 (7 events in chain, 3 refs)
1. [Day3 傍晚] 乌鸦酒馆: 归还匕首给鲍勃 [RRF:0.89] [msgs:12,13] [stm_0042]
2. [Day5 正午] 灰石城: 寻找旧情人下落 [RRF:0.72] [msgs:34,35] [stm_0081]
...
### 关联条目（在其他实体块展开）
- 「鲍勃」块: [stm_0042] 同事件鲍勃视角
- 「匕首」块: [stm_0042] [stm_0081] 匕首流转线

## 鲍勃 (4 events in chain, 1 ref)
...

## 未标注条目 (2 entries)
1. [Day2 清晨] 酒馆: 旅人议论山贼 [RRF:0.34]
...

## 存档记忆目录 (5 LTM entries, not ranked)
1. [Day1-Day3] 酒馆往事: 爱丽丝初入酒馆时的经历 [ltm_0001]
...
```

### 变更 3: 重写 `buildRetrievalPrompt` 的 Rules

**文件**: [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js)

**旧 Rules**（9条，叙事合成导向） → **新 Rules**（KB 标注 + 缺口检测，三层结构）：

```
SYSTEM:

## Role
你是角色扮演的记忆分析员。当前故事时间：{currentTime}。已追踪 {stmCount} STM + {ltmCount} LTM。

## 输入
下方是按实体分组的候选记忆。每个块包含：链条目（时间排序、RRF 评分标注）、关联实体引用。

{candidates_block}

## 需要做
1. KB 认知标注（核心，输出格式如下）
   为每个实体块，对活跃角色标记知晓等级：
   - 直接知晓：角色在事件中在场（看 entities[] 或实体块归属=角色名）
   - 间接知晓：不在场但可通过转述、共享场景、可观察后果获悉
   - 线索：只有碎片，不足以还原全貌
   - 未知：无任何可追溯连接

   标注依据：实体块归属名、entities[] 标注、原文片段、时间/场景关联。
   不确定时标注"线索"并说明原因。

   输出格式：
   [实体: 实体名]
   [KB: 角色名=等级]
   [KB: 角色名=等级(理由)]

2. 缺口检测
   探索中如发现缺口，使用工具补全。最多 4 次 access() 调用。
   触发条件：
   - 实体链被截断：链总数 > 候选块展示数 → access(chain.X) 展开
   - 关键条目原文缺失：无预取文本 → access(ref) 获取
   - 跨实体叙事关联 → note_thread(label, stm_ids) 注册
   不要补全已满的链或已有原文的条目。

3. 残余缺口（递归耗尽时输出）
   格式：
   ## 缺口
   - 描述（如"爱丽丝链 7/12 已展开，尾部 5 条超出补全预算"）

{NE_BANNER_元数据}
{conversationContext}
{visibleWindowBlock}
{toolGuidance}
{availChainHint}

## 空输出
如果所有实体块均无可标注内容：
[KB: 无]

如无缺口：
## 缺口
无

## 严格禁止
不要输出：
- 任何叙事段落、散文或事件过程描述
- "她感到""他心想""这意味着""内心""情感"等心理描写
- "## " 开头的叙事标题（"[实体: ...]" 标注格式除外）
- "由此可见""这表明""标志着""这段展示了"等评价性短语
- 任何对候选条目的删除、省略或过滤
- 任何因果/动机/情感的推断
```

```
USER: 分析以上候选记忆。仅按格式返回 KB 标注和缺口。
```

**prompt-engineering 自查**：

| 检查项 | 状态 |
|:---|---:|
| 最后一行锚定（原则 1.1） | `严格禁止` 在 system 末尾 ✅ |
| 三层结构（原则 1.3） | 需要做 → 空输出 → 严格禁止 ✅ |
| 具体短语禁止（原则 2.3） | `"她感到""他心想""由此可见"` ✅ |
| 空路径显式建模（原则 3.1） | `[KB: 无]` + `## 缺口\n无` ✅ |
| 语义共现（原则 1.2） | KB 格式紧接在 KB 规则说明之后 ✅ |
| 单一定义（原则 2.2） | KB 等级 4 级仅在"需要做"段定义一次 ✅ |
| 跨管线一致（原则 6.3） | 禁止推断因果/动机/情感 — 与 STM+State prompt 一致 ✅ |
| 无示例矛盾（原则 2.1） | 空输出示例出现在同一段，非反例并置 ✅ |

### 变更 4: 新增 `extractBannerMetadata` — NE-BANNER 显式提取

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**新增函数**: 从 `chatMessages` 最近 2 轮中正则提取 `<!--NE-BANNER-->内容<!--/NE-BANNER-->`，解析出场景、时间、事件摘要、活跃角色列表。不作为 conversationContext 的替代而是其结构化补充，注入 Retrieval LLM prompt 为：

```
## 当前场景元数据
场景：乌鸦酒馆 | 时间：Day 3 傍晚 | 事件摘要：爱丽丝归还匕首，鲍勃拒绝 | 活跃角色：爱丽丝、鲍勃
```

如果最近 2 轮中无 NE-BANNER（如对话刚开始），则该段省略。

### 变更 5: 重写 `parseKBAnnotations` → `parseEntityAnnotations`

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**旧逻辑**: 按 `## ` 分割 → 提取 `[KB: ...]` → 返回叙事文本 + KB 列表

**新逻辑**: 按 `[实体: xxx]` / `[KB: xxx]` / `## 缺口` 解析 → 返回结构化对象：

```javascript
function parseEntityAnnotations(llmOutput) {
    return {
        entities: {
            "爱丽丝": {
                kb: [
                    { character: "爱丽丝", level: "直接知晓(在场+思源)", reason: "" },
                    { character: "鲍勃", level: "直接知晓(在场)", reason: "" },
                    { character: "查理", level: "间接知晓(由爱丽丝转述)", reason: "" }
                ]
            },
            "匕首": { kb: [...] }
        },
        gaps: ["爱丽丝链尾部5条被截断...", "Day3.5-Day4.5时间缺口"]
    };
}
```

### 变更 6: 重写 `formatSmartContext` 的拼装逻辑

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**旧逻辑**: parts 数组逐段拼接 → system_prompt + KB block + narrative + gap markers

**新逻辑**:
```javascript
// 1. system_prompt (如有)
if (vault.memory_system_prompt) parts.push(vault.memory_system_prompt);

// 2. 代码层生成实体块（含链条目 + RRF 评分 + 引用）
//    对每个实体块，内联 LLM 的 KB 标注
for (var entityName in groupedResult.groups) {
    var block = buildEntityBlock(entityName, groupedResult.groups[entityName], annotationResult);
    parts.push(block);
}

// 3. 未标注条目块（如有且评分足够）
if (groupedResult.unassigned.length > 0) {
    parts.push(buildUnassignedBlock(groupedResult.unassigned));
}

// 4. LTM 目录
if (dirEntries.length > 0) {
    parts.push(buildDirectoryBlock(dirEntries));
}

// 5. 缺口（如有）
if (annotationResult.gaps.length > 0) {
    parts.push('## 未补全的信息缺口\n' + annotationResult.gaps.join('\n'));
}

// 6. 记忆系统操作指引（新增，帮助对话 LLM 理解格式）
parts.push(buildMemoryUsageGuide());
```

### 变更 7: 新增 `buildEntityBlock` — 生成单个实体的注入块

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

```javascript
function buildEntityBlock(name, group, annotations) {
    var lines = [];
    lines.push('## ' + name);
    
    // 链条目（时间排序 + RRF 标注）
    lines.push('### Timeline (' + group.entries.length + ' events)');
    group.entries.forEach(function(e, i) {
        var timePart = e.entry.period || '';
        var scene = e.entry.scene || '';
        var event = e.entry.event || '';
        var score = e.bm25Score ? ' [RRF:' + e.bm25Score.toFixed(3) + ']' : '';
        var msgs = e.entry.msg_ids && e.entry.msg_ids.length > 0 ? ' [msgs:' + e.entry.msg_ids.join(',') + ']' : '';
        lines.push((i + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event + score + msgs);
    });
    
    // 关联条目引用
    if (group.refs && group.refs.length > 0) {
        lines.push('### Cross-references');
        var refMap = {};
        group.refs.forEach(function(r) {
            if (!refMap[r.primaryName]) refMap[r.primaryName] = [];
            refMap[r.primaryName].push(r.entryId);
        });
        Object.keys(refMap).forEach(function(primary) {
            lines.push('- See 「' + primary + '」: ' + refMap[primary].join(', '));
        });
    }
    
    // KB 标注（内联）
    if (annotations && annotations.entities[name]) {
        var kbList = annotations.entities[name].kb;
        kbList.forEach(function(kb) {
            lines.push('[KB: ' + kb.character + '=' + kb.level + ']');
        });
    }
    
    return lines.join('\n');
}
```

### 变更 8: 调整 `callMemoryRetrievalWithTools` 的 maxTokens

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js#L312)

**变更**: `maxTokens: 2048` → `maxTokens: 1024`

**理由**: LLM 不再生成叙事散文（之前 2048 token 用于叙事），只输出结构化标注。减少 maxTokens 同时减少延迟和成本。

### 变更 9: 移除 `MEMORY_INJECTION_WRAPPER` 中的叙事引用

**文件**: [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L22-L31)

**变更**: Wrapper 文本中移除"下方叙事段落"等字眼，改为"下方记忆条目和认知标注"。

### 变更 10: `formatBM25Results` 保留为 fallback

**文件**: [retrieval.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/retrieval.js) + [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

当 Retrieval LLM 不可用（异常/超时/禁用）时，跳过 LLM 标注，直接按实体链分组后注入。每条目无 KB 标注，对话 LLM 仍能看到组织化的记忆。

**SmPushMethod 枚举变更**：
- `'llm_synthesis'` → `'llm_annotation'`（LLM 标注成功）
- `'bm25_fallback'` / `'vector_fallback'` → `'entity_grouped_fallback'`（LLM 不可用时的代码分组结果）

---

## 文件变更清单

| 文件 | 变更 | 影响 |
|------|------|------|
| `retrieval.js` | 新增 `groupCandidatesByEntity`、`formatEntityGroupedText`。重写 `buildRetrievalPrompt` 的 Rules。 | 🔴 核心 |
| `injection.js` | 重写 `parseKBAnnotations`→`parseEntityAnnotations`。新增 `buildEntityBlock`、`buildMemoryUsageGuide`。重写 `formatSmartContext` 拼装。调整 maxTokens。 | 🔴 核心 |
| `events.js` | Wrapper 文本微调。 | 🟡 边角 |

**不修改的文件**：
- `mergePipelines`、`toPromptEntries`、`lookupEntityChains`、`extractEntityNames` — 保留，它们产出的数据直接被新分组函数消费
- `retrieval-notebook.js`、`bm25-grouper.js`、`retrieval-fusion.js` — 保留
- `retrieval-text.js`、`retrieval-filter.js` — 保留
- `llm.js` 中的 `callMemoryLLMWithTools` — 保留，递归机制不变
- `state-pipeline.js`、`stm-pipeline.js`、`ltm-pipeline.js` — 保留

---

## 假设与决策

1. **实体会被稳定标记**：依赖之前完成的 entities 生产端修复。如果还有无 entities 的条目，评分过滤后进入"未标注"块。
2. **链内按时间排序而非 RRF 排序**：RRF 评分仅作标注，不控制展示顺序。叙事因果关系依赖时间序。
3. **LLM 不再"删除"候选**：所有过滤由代码层（RRF 阈值）+ 时间排序自然完成。低关联条目排在末端，对话 LLM 自然忽略。
4. **note_thread 工具保留**：即使不做叙事合成，跨实体关联仍有价值。
5. **maxTokens 从 2048 → 1024**：因为 LLM 不再输出散文。如果实测中标注文本超出 1024，上修到 1536。
6. **不修改 `callMemoryLLMWithTools`**：递归机制（轮数/超时/异常处理）不变，只是 prompt 和工具使用语义变了。
7. **NE-BANNER 显式提取**：从 chatMessages 正则提取，不依赖对话文本中偶遇。如果最近 2 轮中无 NE-BANNER，该段省略。
8. **conversationContext 维持 2 轮**：1 轮不够（信息不足），0 轮不行（缺口检测需要知道当前话题）。不做增减。

---

## 验证方案

### 单元测试

新增 `test/smartpush-entity-grouping.test.js`：
- `groupCandidatesByEntity` 分组逻辑（单实体/多实体/无实体）
- `buildEntityBlock` 格式输出
- `parseEntityAnnotations` 解析各种标注格式
- fallback 路径（LLM 不可用时直接分组注入）

### 烟雾测试

```bash
npm run test:unit    # 确保现有 22 个测试仍通过
npm run test:ratchet # 确保架构约束不变
```

### 手动验证

```javascript
// 浏览器控制台
await __ne_debug.runTestByName('smartpush-14')  // 全链路烟雾测试
// 检查 trace 文件中的 Retrieval LLM prompt 是否为新格式
// 检查 `__ne_debug_last_notebook` 结构
```

### 回归检查

- KB 认知标注是否仍正确出现在主 LLM prompt 中
- 实体链按时间排序是否正确
- 多实体引用块是否出现
- fallback 路径（bm25_fallback）是否仍工作

---

## 实施顺序

1. 新增 `groupCandidatesByEntity` + `formatEntityGroupedText`（纯代码，无副作用）
2. 新增 `extractBannerMetadata`（Retrieval LLM 输入构建）
3. 重写 `buildRetrievalPrompt` Rules（核心 prompt 变更）
4. 重写 `parseEntityAnnotations` + 新增 `buildEntityBlock`、`buildMemoryUsageGuide`
5. 重写 `formatSmartContext` 拼装逻辑
6. 调整 maxTokens + Wrapper 文本
7. 单元测试 + 烟雾测试验证
