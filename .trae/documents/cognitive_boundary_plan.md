# 认知边界优化实现计划

## 概要

在 NE-Memory 的 Smart Push (Path B) 管线中增加认知边界机制：让 Synthesis LLM 从当前对话上下文中识别活跃角色，在合成叙事输出中标注每个叙事线对各角色的知晓程度，代码解析后重组为带结构化指令的注入文本，使主 LLM 能够为不同角色呈现不同的认知水平。

## 当前状态分析

### 数据流 (Path B / Smart Push)

```
onBeforeGenerate (events.js:276-346)
  → formatSmartContext(vault, chatMessages) (vault-panel.js:1387)
    → extractEntityNames(query, content) → lookupEntityChains()
    → filterCandidates() → BM25 候选
    → mergePipelines() → RetrievalNotebook
    → prefetchOriginalTexts()
    → buildRetrievalPrompt(notebook, query, vault, budget, ...) (retrieval.js:434)
    → callMemoryLLMWithTools() → synthesis 文本
    → 后处理: 清洗 stm_/ltm_ ID, 拼接 memory_system_prompt + 缺口标记
    → 返回格式化文本
  → TavernHelper.injectPrompts() → 注入主 LLM 上下文
```

### 当前问题

- Synthesis LLM 将所有记忆当作"全局知识"输出叙事
- 主 LLM 接收到的记忆没有角色认知边界区分
- 所有角色表现得好像知道一切

### 可用的现有结构

| 结构 | 位置 | 内容 |
|------|------|------|
| `conversationBlock` | `buildRetrievalPrompt` prompt 中 | 最新一轮对话上下文 |
| `visibleWindowBlock` | `buildRetrievalPrompt` prompt 中 | 主 LLM 上下文已知的消息 |
| entry `entities[]` | STM/LTM entries 上 | `[{name: "黑鹰", type: "character"}, ...]` |
| `{L:实体名#pos/total}` | candidatesText 中每个候选 | 实体链线程标注 |
| `chatMessages` | events.js → formatSmartContext | ST 聊天消息数组 |

## 设计决策（已确认）

| 决策点 | 选择 |
|--------|------|
| POV 策略 | Synthesis LLM 从 conversation context 中动态识别活跃角色 |
| 标注粒度 | 按叙事线标注（每个 `##` 节末尾） |
| 覆盖路径 | 仅 Smart Push (Path B)，不覆盖 recall_memory tool call |
| KB 标签格式 | 每角色独立一行：`[KB: 角色名=等级(理由)]` |
| 主 LLM 注入形式 | 结构化指令块（代码生成） + 叙事中的视角标记 |

## 改造方案

### 修改 1: `src/engine/retrieval.js` — buildRetrievalPrompt()

**位置**：`buildRetrievalPrompt()` 函数，第 614-637 行（中文分支）/ 第 586-611 行（英文分支）

**改动内容**：

#### A. 增加规则 8 — 认知边界规则

在当前 7 条规则之后、输出格式之前插入：

```
8. KNOWLEDGE BOUNDARY（认知边界）：
   先根据对话上下文（conversation context）判断当前场景下有哪些活跃角色（通常 1-4 位）。
   对每条合成叙事线，从每个活跃角色的视角判断知晓程度：
   - 直接知晓：该角色在事件中在场（候选的 entities[] 或线程标注 {L:角色名} 中有该角色）
   - 间接知晓：该角色不在场，但可通过以下方式获悉——他人转述、共享场景的对话、可观察的后果
   - 线索：该角色只有碎片信息，不足以还原事件全貌
   - 未知：该角色与该叙事线无任何可追溯的连接
   判断依据：候选条目的 entities[] 标注、线程标签 {L:实体名}、原文片段提及、时间/场景关联。
   不确定时标注为"线索"并注明原因。
```

#### B. 修改输出格式说明

将现有：
```
## <叙事线标题>
<详细叙事段落，每个事件展开>
```
改为：
```
## <叙事线标题>
<详细叙事段落，每个事件展开>
[KB: 角色A=等级]
[KB: 角色B=等级(理由)]
```

说明：每个 `##` 叙事线末尾紧接 `[KB: ...]` 标签。每个活跃角色占一行。等级为"直接知晓"、"间接知晓"、"线索"、"未知"之一。间接知晓和线索可在括号内补充理由。

#### C. 活跃角色识别指令

在规则 8 后追加：
```
活跃角色识别：从对话上下文（conversation context）中提取所有有台词、有动作或被提及的具名角色。排除泛指群体和背景角色。如有歧义，优先选择最近对话中直接参与的 1-4 位角色。
```

### 修改 2: `src/ui/vault-panel.js` — formatSmartContext() 后处理

**位置**：第 1638-1684 行，当前的后处理逻辑

**改动内容**：

当前的注入组装：
```javascript
var parts = [];
// Layer 0: memory_system_prompt
if (vault.memory_system_prompt) parts.push(vault.memory_system_prompt);
// Layer 1: 合成文本（清洗 ID）
var synthText = synthesized.trim().replace(/\(?(stm_|ltm_)\d+\)?/g, '');
parts.push(synthText);
// Layer 2: 缺口标记
// ...
```

改造后：
```javascript
var parts = [];

// Layer 0: memory_system_prompt
if (vault.memory_system_prompt) parts.push(vault.memory_system_prompt);

// Layer 1: 解析 KB 标签，生成认知边界指令块
var synthText = synthesized.trim();
var kbParseResult = parseKBAnnotations(synthText);
// kbParseResult = { cleanText, annotations: [{ threadTitle, chars: [{name, level, reason}] }] }
if (kbParseResult.annotations.length > 0) {
    parts.push(buildKBInstructionBlock(kbParseResult));
}

// Layer 2: 清洗后的叙事文本（KB 标签已移除，添加视角标记）
if (kbParseResult.cleanText) {
    if (parts.length > 0) parts.push('---');
    parts.push(kbParseResult.cleanText);
}

// Layer 3: 缺口标记
// ...
```

#### B. 新增辅助函数 `parseKBAnnotations(synthesisText)`

```javascript
function parseKBAnnotations(text) {
    // 按 ## 分割叙事线节
    // 每节检测末尾的 [KB: ...] 行
    // 移除 KB 行，在叙事段落末尾添加人类可读的视角标记 "> 角色视角：..."
    // 收集所有 role-level pairs 用于指令块生成
    
    var sections = [];
    var cleanSections = [];
    
    // 按 '## ' 分割（保留分隔符）
    var parts = text.split(/(?=## )/);
    
    parts.forEach(function(part) {
        var kbLines = [];
        var cleanPart = part.replace(/^\s*\[KB:\s*([^\]]+)\]\s*$/gm, function(match, content) {
            // 解析 "角色名=等级(理由)"
            var parsed = parseKBLine(content.trim());
            if (parsed) kbLines.push(parsed);
            return ''; // 移除该行
        }).trim();
        
        if (kbLines.length > 0) {
            var threadTitle = extractThreadTitle(part);
            sections.push({ threadTitle: threadTitle, chars: kbLines });
            // 添加视角标记
            var perspectiveLine = '> 角色视角：' + kbLines.map(function(kb) {
                return kb.name + '=' + kb.level + (kb.reason ? '(' + kb.reason + ')' : '');
            }).join(' | ');
            cleanSections.push(cleanPart + '\n' + perspectiveLine);
        } else {
            cleanSections.push(cleanPart);
        }
    });
    
    return {
        cleanText: cleanSections.join('\n\n').trim(),
        annotations: sections
    };
}

function parseKBLine(line) {
    // 格式: "角色名=等级" 或 "角色名=等级(理由)"
    var match = line.match(/^(.+?)=(.+?)(?:\((.+)\))?$/);
    if (!match) return null;
    return {
        name: match[1].trim(),
        level: match[2].trim(),
        reason: (match[3] || '').trim()
    };
}
```

#### C. 新增辅助函数 `buildKBInstructionBlock(parseResult)`

```javascript
function buildKBInstructionBlock(parseResult) {
    // 收集所有活跃角色
    var allChars = {};
    parseResult.annotations.forEach(function(section) {
        section.chars.forEach(function(ch) {
            if (!allChars[ch.name]) allChars[ch.name] = ch.name;
        });
    });
    var activeChars = Object.keys(allChars);
    if (activeChars.length === 0) return '';
    
    var lines = [];
    lines.push('## 角色认知边界');
    lines.push('当前场景活跃角色：' + activeChars.join('、'));
    lines.push('');
    lines.push('以下记忆已按各角色的知晓程度分类。你同时扮演这些角色，每个角色的行动和发言必须严格基于其对应认知等级：');
    lines.push('- **直接知晓** = 该角色亲自在场或经历，完全知情。可以此为基础主动行动和发言。');
    lines.push('- **间接知晓** = 该角色通过他人转述、书面记录、或可观察后果推断得知。可以提及但应保持细节不确定性。');
    lines.push('- **线索** = 该角色只有碎片信息。角色只能基于碎片推理，不应表现出完全知情。');
    lines.push('- 叙事线中未提到的角色 = 该角色**不知道**此叙事线的事件。仅供你理解故事全局语境，禁止该角色在对话中表现出知情。');
    lines.push('');
    
    // 快速索引表
    parseResult.annotations.forEach(function(section) {
        var charEntries = section.chars.map(function(ch) {
            return ch.name + '：' + ch.level;
        });
        lines.push('[' + section.threadTitle + '] ' + charEntries.join(' | '));
    });
    
    return lines.join('\n');
}
```

#### D. 后向兼容处理

如果 Synthesis LLM 输出中完全没有 `[KB: ...]` 标签（LLM 忽略了新规则），`parseKBAnnotations` 返回空的 annotations，`buildKBInstructionBlock` 返回空字符串，`cleanText` 等于原文 — 完全回退到现有行为。

### 修改 3: 输出格式校验（代码兜底）

在 `parseKBAnnotations` 或后续处理中增加简单的 ISO 等级校验。如果 Synthesis LLM 输出的等级不在 `["直接知晓", "间接知晓", "线索", "未知"]` 集合中，替换为最接近的匹配或默认 "未知"。

## 文件改动清单

| 文件 | 改动范围 | 改动内容 |
|------|----------|----------|
| `src/engine/retrieval.js` | L596-600 (EN), L623-627 (ZH) | 增加规则8 + 活跃角色识别 + 修改输出格式 |
| `src/ui/vault-panel.js` | L1638-1684 | 重写后处理逻辑：新增 `parseKBAnnotations`、`buildKBInstructionBlock` |

## 假设与依赖

1. **Synthesis LLM 能可靠识别活跃角色**：prompt 中已有 conversationBlock 提供完整的对话上下文
2. **Synthesis LLM 能输出标准格式的 KB 标签**：prompt 使用明确格式说明，代码有容错解析
3. **无需修改 retrieval-notebook.js**：现有 entry 结构（entities[], threads）已足够支持 LLM 判断
4. **无需修改 events.js 调用签名**：`formatSmartContext(vault, chatMessages)` 保持不变，POV 信息由 Synthesis LLM 自主提取
5. **后向兼容**：旧版 Synthesis LLM 不输出 KB 标签时，`parseKBAnnotations` 返回空 annotations，系统回退到当前行为

## 验证步骤

1. **单元级验证**（代码正确性）：
   - `parseKBAnnotations` 正确解析单角色/多角色 KB 标签
   - `parseKBAnnotations` 对无 KB 标签的输入返回空 annotations
   - `buildKBInstructionBlock` 生成正确的结构化指令
   - 最终注入文本格式正确（memory_system_prompt → 指令块 → 叙事 → 缺口标记）

2. **集成验证**（端到端）：
   - 启动 SillyTavern，加载 NE-Memory，在开启 smart push 的聊天中发送几条消息
   - 检查主 LLM 上下文中的注入内容（`globalThis.__ne_debug_last_injection`）
   - 确认注入包含认知边界指令块
   - 确认 KB 标签已被正确转换为视角标记

3. **行为验证**（核验效果）：
   - 在叙事中存在"角色A不在场但角色B在场"的事件
   - 让 Synthesis LLM 生成记忆后，检查主 LLM 扮演角色 A 时是否表现出"不知道"的态度
   - 对比开启/关闭认知边界前后的角色行为差异
