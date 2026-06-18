# 检索管线优化计划

## 问题

memory LLM 当前看不到"当前对话发生了什么"，导致：
1. 不知道哪些候选事件已经被主 LLM 回复覆盖
2. 无法判断预取原文在叙事中的相对位置
3. 只有 BM25 语义信号，缺少"叙事上下文"这个关键维度
4. access 工具调用频率高 → 5 轮延迟 → 需要优化预取以减少工具使用

## 方案

memory LLM system prompt 增加 3 个新信息块：
1. **当前对话上下文** — 最近 1 轮完整对话原文（同份文本同时用作 BM25 query）
2. **可见窗口计算** — 向后行走 token 计数器，精确确定主 LLM 的可见范围，替代"最近 20 条"硬编码
3. **原文预取（改为全部原文）** — 把事件所有 msg_id 的原文件给 memory LLM，带 [msg_xx] 标注

**保留现有工具循环和 access/note_thread 工具，但通过优化预取大幅降低其使用频率。**

---

## 改动

### P0 — 提取最近 1 轮对话原文，三用途复用

**文件：** src/ui/vault-panel.js + src/engine/retrieval.js

**做什么：**
- 在 formatSmartContext 中，提取最后 1 条 user message + 最后 1 条 assistant message
- 拼入 query（替代当前仅 user messages 的方式）
- 同时传递给 buildRetrievalPrompt，在 system prompt 中渲染

**在 retrieval.js 的 system prompt 中新增段落：**
```
## 最近一轮对话上下文
以下是最新的一轮对话（BM25 检索基准），用于帮助你理解当前检索需求的语境：
[msg_45] AI: xxx
[msg_46] User: xxx
```

---

### P0 — 可见窗口计算（替代"最近20条"硬编码）

**文件：** src/ui/vault-panel.js

**新增 `computeVisibleWindow(chatMessages, maxContext)`：**

向后行走 token 计数器，从 chatMessages 尾部开始：
```
chat:  [msg_0, msg_1, ..., msg_12, msg_13, msg_14, msg_15]
                                                    ← 向后走
maxContext = 4096
msg_15 → 380 tokens → 累计 380
msg_14 → 420 tokens → 累计 800
...
msg_3  → 已经超出 maxContext → 停
```

- token 估算：`Math.round(text.length / 3.5) + 10`（+10 为 role/name 开销）
- 固定开销：1500 tokens（角色卡 + system prompt + world info）
- 可用空间：`maxContext - 1500`
- 返回可见窗口内的消息数组（按时间顺序排列）

**在 retrieval.js 的 system prompt 中新增段落：**
```
## 当前对话可见窗口
主 LLM 的上下文窗口覆盖了以下对话轮次，这些内容主 LLM 已知：
[msg_5] User: xxx
[msg_6] AI: xxx
...
```
- 每行 `[msg_{id}] {name}: {text.substring(0, 200)}`
- 候选条目的 msg_id 若在此窗口内 → 主 LLM 已知
- 不在窗口内 → 需 memory LLM 重点关注的叙事信息
- memory LLM 自行对照 DAG（thread 标注中的 L:entity#pos/total）和候选条目的 msg_ids 交叉参照

---

### P0 — 预取改为取全部原文 + 可见窗口跳过

**文件：** src/ui/vault-panel.js, prefetchOriginalTexts

**当前：** 只取首尾 msg_id，各 200 字符，总计 400 字符；事件原文 > 80 字符跳过

**改为：**
- 移除 eventLen > 80 过滤
- 取事件所有 msg_id 的原文（每段限制 200 字符）
- 每行加 `[msg_{id}]` 前缀
- 3 条候选总计上限 2000 字符，超出时在单条截断
- **可见窗口跳过：** 如果某条目的所有 msg_id 都在 visibleWindow 内，跳过预取
- 签名从 `prefetchOriginalTexts(notebook, chatMessages, topCandidates, topK)` 改为 `prefetchOriginalTexts(notebook, chatMessages, visibleWindow, topK)`

---

### P0 — 工具 guidance 精简（保留工具，减少误导提示）

**文件：** src/engine/retrieval.js, buildRetrievalPrompt

**当前 tool guidance（line 455-472）：**
```
## 搜索工具
你可以使用：
- access(msg_id): 查看原始对话消息内容
- access(chain.X): 获取实体 X 的完整事件时间线
- note_thread(label, stm_ids): 注册跨实体叙事线

候选列表已提供完整事件描述。若需要关键时刻的精确对话原文，使用 access(msg_id)。
最多搜索 3 轮。
```

**改为：**
```
## 参考工具（保底使用）
以下工具在你需要精确验证时可用，但通常不需要：
- access(msg_id): 查看原始对话消息（预取已提供主要原文；只有在理解预取内容有歧义时使用）
- access(chain.X): 获取实体 X 的完整事件时间线（预取链不足时使用）

候选列表已提供完整事件描述。当前对话上下文和原文预取已覆盖多数需要原文的场景。
```
- 保留工具的完整功能，不删除
- 将工具描述从"鼓励使用"改为"保底使用"
- 移除"最多搜索 3 轮"的硬上限（由 LLM 自行决定，但预期接近 0）
- 保留 chain.X 的保底路径

---

### P1 — 短链 inline

**文件：** src/engine/retrieval.js, mergePipelines

availableChains 中 count ≤ 5 的实体链直接 inline 到 notebook map，从 availableChains 移除。
- mergePipelines 改为 async（需要 await lookupEntityChains）
- 调用方 formatSmartContext 已是 await，无需改动

---

### P2 — 原文顺序标注

**文件：** src/ui/vault-panel.js + src/engine/retrieval.js

预取原文和可见窗口原文的每一行前面加上 `[msg_xx]` 标记，方便 memory LLM 与 DAG 中的 thread 标注、L:entity#pos/total 交叉参照。

---

## 调用链（formatSmartContext 更新后）

```
1. 获取 chatMessages
2. 计算 visibleWindow ← 新增
3. 提取最近 1 轮对话原文（user + AI reply）
4. 构建 query ← 修改（含 AI reply）
5. BM25 filter
6. mergePipelines（含 Step 5 short chain inline）← 改为 async
7. 构建 notebook
8. prefetchOriginalTexts（传入 visibleWindow）← 修改
9. buildRetrievalMessages（传入 visibleWindow + conversationContext）← 修改
10. callMemoryRetrievalWithTools（保留工具，但预取充分 → 预期 LLM 很少调用工具）
```

工具循环仍存在，但预期：
- 预取已覆盖 top-3 候选的全部原文 → LLM 不需要为这些事件调 access(msg_id)
- 短链 inline 覆盖了 ≤5 的实体 → LLM 不需要调 access(chain.X)
- 可见窗口标注让 LLM 知道哪些是已知信息 → 减少不确定带来的工具调用
- 实际工具调用预期从平均 2-3 轮降至接近 0 轮

---

## 验证

1. npm run build 通过
2. smartpush-01-not-empty 测试通过
3. trace 中可见系统提示词包含"当前对话可见窗口"和"最近一轮对话上下文"节段
4. 工具调用频率显著降低（验证方式：对比 trace 中 tool_calls 出现次数）
