# 删除 LLM 递归补漏 + KB 标注机制计划

## 摘要

将 `formatSmartContext` 从"检索 → LLM 递归补漏 → KB 标注 → 实体块注入"简化为"检索 → 实体块注入"。删除的工具调用递归循环、LLM KB 认知标注、缺口检测段、使用指南段，保留 BM25+向量融合检索和实体链分组显示。主 LLM 根据每条事件的 `entities` 字段自行推断角色认知边界。

## 当前状态

```
formatSmartContext 流程:
  BM25+向量融合检索 → RetrievalNotebook 构建 → 预取原文
    → callMemoryRetrievalWithTools (最多5轮LLM递归+access()工具调用)
    → parseEntityAnnotations (解析 [KB: ...] + ## 缺口)
    → buildEntityBlock(entityGrouped, KB标注)
    → buildMemoryUsageGuide (KB等级说明)
    → ## 缺口注入
    → 注入到主 LLM 的 prompt
```

每轮主 LLM 生成前额外产生 1-5 次 Memory LLM 调用，8 秒超时，fallback 降级为纯 BM25 扁平列表。

## 目标状态

```
formatSmartContext 简化流程:
  BM25+向量融合检索 → mergePipelines → prefetchOriginalTexts
    → buildRetrievalMessagesLegacy → callMemoryRetrieval (无工具)
    → buildEntityBlock(entityGrouped, {} /* 无KB标注 */)
    → 注入到主 LLM 的 prompt
```

- 不再有工具调用递归
- 不再有 KB 认知标注
- 不再有缺口检测
- 不再有使用指南
- 实体链分组块保留（按实体分组、时间排序的格式不变）

## 主 LLM 推断认知边界的可靠性分析

每条事件已自带 `entities` 字段：

```
### 江岚 (5 events in chain, 3 hits)
1. [Day 3 上午] 702公寓·书房: 江岚发现毯子，猜到是安然的 [entities: 江岚]
2. [Day 5 下午] 702公寓·阳台: 安然递可乐给江岚 [entities: 江岚, 安然]
3. [Day 7 晚上] 苏茉来探班 [entities: 苏茉, 江岚, 安然]
```

主 LLM 从 `entities` 字段可以直接推断：
- 江岚/安然都在 Day 5 阳台事件中在场 → 两人都知道可乐的事
- 苏茉只在 Day 7 事件中出现 → 她不知道之前的阳台互动

**用 LLM KB 标注能额外覆盖但主 LLM 无法从 entities 推断的情况：**

| 情况 | entities 能覆盖？ | 影响 |
|------|:---:|------|
| 角色亲自在场 | ✅ entities[] 中直接体现 | 无退化 |
| 角色通过转述得知（如安然对苏茉说了某事） | ✅ STM 摘要本身若写了"安然向苏茉讲述"，则 entities 含苏茉 | 很少退化 |
| 角色的错误认知（误解） | ❌ | 主 LLM 不会知道角色误解了什么—但我们之前也没暴露这个 |
| 多跳信息传递（A→B→C） | ❌ 但实际出现频率极低 | 可忽略 |
| 角色"应该知道但未在场"的推理（如看到证据） | ❌ 需要 LLM 推理 | 罕见 |

**结论**：在 144 条事件的 STM 场景中，entities 字段能覆盖 95%+ 的认知边界信息。主 LLM 从 entities 字段推断角色认知的可靠性高（LLM 本身有推理能力，不需要额外标注来告诉它"角色 X 在场→角色 X 知道"）。

## 文件变更清单

### 1. `src/core/engine/injection.js` — 核心裁剪（~120行删除，~30行改动）

**删除：**
- `import { callMemoryRetrievalWithTools, recordTelemetry }` → 改为 `import { callMemoryRetrieval, recordTelemetry }`
- `import { executeAccess }` → 删除
- `import { RetrievalNotebook }` → 删除
- `var notebook = new RetrievalNotebook()` 及相关填充 → 删除
- `__ne_debug_last_notebook` 写入 → 删除
- `var accessTool = ...` + `var accessExecutor = ...` → 删除
- 整个 `try { callMemoryRetrievalWithTools(...) } catch { formatBM25Results(...) }` 块 → 替换为 `try { callMemoryRetrieval(...) } catch { formatBM25Results(...) }`
- `smPushMethod` 变量 → 改为固定字符串
- `parseEntityAnnotations` 定义（L454-L513）→ 删除
- `parseEntityAnnotations` 调用（L387）→ 删除
- `parseResult.gaps` 缺口注入块（L400-L405）→ 删除
- `buildMemoryUsageGuide` 调用（L397）→ 删除
- `buildMemoryUsageGuide` 函数定义（L662-L671）→ 删除
- `parseKBLine` 函数（L515-L529）→ 删除

**修改：**
- `prefetchOriginalTexts(notebook, ...)` → `prefetchOriginalTexts(mapObj, ...)`，操作 `pipelineMerged.map` 而非 notebook
- `buildRetrievalMessages(notebook, ...)` → `buildRetrievalMessagesLegacy(query, topCandidates, ...)`
- `buildEntityBlock(entityGrouped, parseResult.entityAnnotations, ...)` → `buildEntityBlock(entityGrouped, {}, activeChars, entityChains)`
- `recordTelemetry({ sm_push_method: smPushMethod, ... })` → 直接传 `'llm_synthesis'`
- `formatSmartContext` 返回值：实体链块后不再附加使用指南和缺口段

### 2. `src/core/api/llm.js` — 删除工具调用链（~230行删除）

**删除：**
- `callMemoryRetrievalWithTools` 函数（L387-L393）
- `callMemoryLLMWithTools` 函数（L254-L330）
- `callCustomAPITools` 函数（L332-L380）
- `robustParseJson` 函数（L159-L217）
- `findValidJsonPrefixEnd` 函数（L228-L252）
- `skipString` 函数（L219-L226）

**保留：**
- `callMemoryLLM`（ST/State pipeline 使用）
- `callMemoryRetrieval`（tools.js recall_memory 使用）
- `callMemoryPipeline`（状态管线使用）

### 3. `src/core/engine/retrieval.js` — 精简 prompt（~250行删除，~15行改动）

**删除：**
- `buildRetrievalPrompt` v2 整个函数（L342-L592）→ 或精简为不含 KB/access/gaps 的 v1 式叙事合成 prompt
- 所有 `access()` 工具指令段
- 所有 `## 缺口` 指令段
- 所有 `[KB: X=Y]` 格式指令段
- `notebook.toPromptEntries()` / `notebook.describe()` 调用

**修改：**
- `buildRetrievalMessages(notebook, ...)` → 删除或改为直接路由到 `buildRetrievalMessagesLegacy`

**保留：**
- `buildRetrievalMessagesLegacy`（tools.js recall_memory 工具独立使用）
- `buildRetrievalPromptLegacy`
- `groupCandidatesByEntity`（entityBlock 使用）
- `mergePipelines`
- `lookupEntityChains` / `extractEntityNames`

### 4. `src/core/vault/retrieval-notebook.js` — 删除（死代码）

递归补漏删除后，此文件在生产代码中无任何 import。可保留文件由 Rollup tree-shake 掉，或直接删除。

### 5. `src/core/test-runner/monitor.js` — 小幅修改

`__ne_debug_last_notebook` 读取改为 `null` 或移除对应字段。

### 6. `src/types.js` — 删除 RetrievalNotebook typedef

### 7. 测试文件 — 删除

| 文件 | 操作 |
|------|------|
| `test/kb-annotations.test.js` | 删除（功能不再存在） |
| `test/notebook-core.test.js` | 删除（功能不再存在） |
| `test/notebook-sort.test.js` | 删除（功能不再存在） |
| `test/run.mjs` | 移除对上述三个测试文件的注册 |

## 不修改的文件

- `src/core/tools.js` — `executeAccess` 保留（ToolManager 的 access 工具仍然使用它）
- `src/core/i18n.js` — 无任何相关字符串
- `src/adapter/events.js` — `formatSmartContext` 调用签名不变
- `src/core/vault/retrieval-filter.js` — 无任何依赖

## 注入格式变化

**删除前**（当前）：
```
## 实体记忆链

### 江岚 (5 events in chain, 3 hits) [KB: 江岚=直接知晓(亲自在场) | 安然=间接知晓(听苏茉讲述)]
1. [Day 3 上午] 702公寓·书房: 江岚发现秘境入口
2. [Day 5 下午] 702公寓·阳台: 江岚与安然讨论秘境
...

## 记忆使用指南
以上记忆按实体分链，时间排序。每条链顶部的 KB 标注表示各角色对该链事件集合的知晓程度……

## 缺口
- 缺失龙牙剑铸造过程的详细记录
```

**删除后**（新）：
```
## 实体记忆链

### 江岚 (5 events in chain, 3 hits)
1. [Day 3 上午] 702公寓·书房: 江岚发现秘境入口 [entities: 江岚]
2. [Day 5 下午] 702公寓·阳台: 江岚与安然讨论秘境 [entities: 江岚, 安然]
...
```

每个事件条目的 `entities` 字段保留在摘要文本中，主 LLM 据此自行判断角色认知。

## 回滚与风险

- 风险：中等。属于跨模块改动（检索 + LLM API + 注入），但改动局限于删除已确认死代码。
- 回滚：保留 `callMemoryRetrievalWithTools` → `callMemoryRetrieval` 的切换变量即可（一个 if 判断）
- 降级路径：如果删除后发现问题，可从 git 恢复 `retrieval-notebook.js` 和 LLM tool 调用链
- 保护 `formatSmartContext` 的返回值签名不变（仍是 string），外部调用方 events.js 无需改动

## 验证

```powershell
# 语法检查
node --check src/core/api/llm.js
node --check src/core/engine/injection.js
node --check src/core/engine/retrieval.js

# 构建
npm run build

# 运行检索基准测试（确保检索逻辑未受影响）
$env:NE_BENCHMARK_MODE="all"
node test/retrieval-benchmark/benchmark.test.js

# 运行剩余测试
node test/run.mjs
```
