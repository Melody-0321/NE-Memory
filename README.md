# NE Memory Engine — 让 AI 永远记得住

[![GitHub](https://img.shields.io/badge/GitHub-Melody--0321%2FNE--Memory-0969da?logo=github)](https://github.com/Melody-0321/NE-Memory)

聊到 300 楼，AI 还在提 10 楼的那个约定。

NE Memory Engine 是 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的长对话记忆管理引擎。它自动从对话中提取事件、追踪角色状态、维护叙事脉络，再在需要的时刻把相关记忆精准注入给 LLM。**既省 token，又让长篇对话前后连贯、不崩人设。**

基于 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner) 运行。

---

## 它能做什么

### 📖 自动记忆提取：短期的，长期的，它都帮你记

- **STM 事件提取**：每轮对话自动提取关键事件（谁做了什么、发生了什么事），不重复处理同一条消息，Token 消耗不随对话增长。
- **LTM 叙事弧线**：多条关联 STM 自动整合为 LTM 叙事弧（如"龙牙剑任务线"），支持开放弧持续追加、闭合弧归档。**原始数据永不丢失，每条 LTM 可追溯到源头 STM 和原始对话。**

### 🔍 SmartPush 智能注入：生成前自动把相关记忆递进去

每次 LLM 生成回复前，NE 会自动检索当前上下文最相关的记忆，注入到 LLM 可见的 prompt 中。**始终在线，无需手动开启。**

- **纯本地管线，零额外 API 成本**：BM25 检索 → 可选向量 RRF 融合 → 实体链分组 → 代码组装注入文本。全程无 LLM 参与。
- **按实体分组**：不是简单地塞一堆零散事件，而是按角色/势力/任务归类为"实体记忆链"，LLM 一看就知道谁是谁。
- **可选向量增强**：开启 Vector Search 后，BM25 检索与向量语义相似度按倒数排名融合（RRF），检索精度进一步提升。

### 🗺️ 状态追踪：角色、势力、任务，张张卡片一目了然

- **角色卡**：自动追踪每个角色的当前状态（位置/外貌/装备/情感/内心想法），Schema 驱动字段级约束，LLM 只改变化的部分。
- **势力面板**：势力关系网、对玩家态度、各势力间交往状态。
- **任务/目标/事件**：追踪进行中、已完成的各类任务，自动记录起止时间。
- **战力槽**：修仙（修为/真气/境界）、科幻（energy/shield）、现代（stamina/morale）等多套模板。

### 📐 版本管理：写坏了随时回滚

最多保存 **30 个历史快照**，精确回滚到任意版本。删除/滑动消息时自动级联回滚相关记忆。导出/导入 JSON 备份、Vault 数据嵌入聊天文件随导出迁移。

### 🎛️ 灵活配置

- **副 API 独立渠道**：记忆 Pipeline 和 Embedding 可分别配置独立的 LLM API，不占用主对话 API 额度。
- **本地 LLM 零配置接入**：Ollama、vLLM、LM Studio 等本地模型填 URL + 模型名即可（Key 留空），自动跳过认证。
- **自动调参**：根据历史 Telemetry 数据自动调优 stmBatch、topK、chainDepth 等参数。
- **上下文窗口控制**：支持按对话轮数截断注入内容，可覆盖 ST 原生上下文限制。
- **三语界面**：简体中文 / 繁體中文 / English。

---

## 快速开始

### 前置条件

- 已安装 [SillyTavern](https://github.com/SillyTavern/SillyTavern)
- 已安装 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)

### 安装

1. 在酒馆助手的脚本管理器中点击**导入**
2. 粘贴以下 JSON：

<details>
<summary>点击展开导入 JSON</summary>

```json
{
  "type": "script",
  "enabled": true,
  "name": "NE Memory Engine v7.2",
  "id": "ne_memory_engine",
  "content": "(function(){var s=document.createElement('script');s.src='https://gcore.jsdelivr.net/gh/Melody-0321/NE-Memory@test7.2/dist/index.js';s.onerror=function(){var f=document.createElement('script');f.src='https://cdn.jsdelivr.net/gh/Melody-0321/NE-Memory@test7.2/dist/index.js';document.head.appendChild(f)};document.head.appendChild(s)})()",
  "info": "🧠 v7.2 - 对话轮数裁剪 · 自适应上下文窗口 · 物品栏UI重设计 · import修复"
}
```

</details>

3. 启用脚本，Memory Vault 面板会自动出现在酒馆助手弹窗中。

### 首次配置

**配副 API**

NE 的记忆提取需要 LLM。打开面板 → Settings → Secondary API：

- **云端 API**（推荐入门）：
  - URL: `https://api.deepseek.com/v1/chat/completions`
  - Key: 填写你的 API Key
  - Model: `deepseek-v4-flash`（或其他模型）

- **本地 LLM**（免费）：
  - URL: `http://localhost:1234/v1`（LM Studio / vLLM / Ollama）
  - Key: 留空
  - Model: 填写本地模型名

支持 DeepSeek、硅基流动、OpenRouter 等云端平台，以及任何 OpenAI 兼容端点。

配好副 API 后即可开始聊天。NE 会在后台自动工作——SmartPush 始终在线，每次生成前自动检索相关记忆注入 LLM。Vault 面板里可以查看实时更新的记忆列表、状态面板和用量统计。如需微调各项参数，见下方配置指南。

---

## 配置指南

所有设置通过面板的 Settings 标签页管理。各模块说明：

| 模块 | 说明 | 必配 |
|------|------|------|
| **副API** | 记忆 Pipeline 用的 LLM API（URL / Key / Model） | ✅ 是 |
| **API 分通道（STM / LTM / State）** | 按操作类型拆分 API 端点，留空则回退副 API | 否 |
| **向量搜索 (Embedding API)** | 向量检索开关 + Embedding API 端点（一键预设硅基流动免费 bge-m3） | 否 |
| **对话轮数注入控制** | 注入上下文的对话轮数（2–20，默认 10） | 否 |
| **替代 ST 上下文窗口限制** | 覆盖 ST 原生 token-budget 截断，仅按对话轮数控制上下文 | 否 |
| **记忆预算** | SmartPush 注入的最大 Token 数（500–2000，默认 800） | 否 |
| **流水线触发阈值** | 触发记忆提取的累计消息数（1–30，默认 10；支持自动调优） | 否 |
| **STM 分块大小（字符）** | 每次 LLM 调用最大字符数（100–10000，默认 500，对数滑块） | 否 |
| **STM 摘要压缩比** | STM 摘要长度占原文比例（滑块，默认 5%） | 否 |
| **LTM整合阈值** | 未整合 STM 条数上限（2–30，默认 5），超此阈值触发 LTM 整合 | 否 |
| **记忆提取温度** | 记忆提取 LLM 的温度参数（0–1，默认 0.2） | 否 |
| **Schema编辑器** | 自定义 State / Character Schema 的 JSON 编辑器 | 否 |

### 关于 API 费用

NE 的核心设计目标之一是降低 API 成本：

- **副 API 独立配置**：记忆提取用小模型（如 DeepSeek v4-flash），主对话用大模型，互不干扰。
- **SmartPush 纯本地管线**：生成前检索完全在浏览器内完成，不消耗任何 API Token。
- **增量处理**：只处理新消息，不重复提取，Token 消耗随对话增长趋于平稳。

可以通过 Settings → Usage 面板查看 Session / Monthly / Per-chat Token 用量明细。

---
## 更新

NE 通过 jsDelivr CDN 分发，刷新 SillyTavern 页面即自动加载最新版本。若未生效，在酒馆助手中禁用再重新启用 NE 脚本即可。

NE 的 Vault 数据结构具有向后兼容性，升级后首次加载会自动迁移数据格式。建议升级前通过面板的 Export JSON 功能备份数据。

兼容性：

| NE 版本 | SillyTavern 最低版本 | 酒馆助手 |
|---------|---------------------|---------|
| v7.2 | 1.12.x | 最新版 |
| v7.1 | 1.12.x | 最新版 |
| v7.0 | 1.12.x | 最新版 |
| v6.8 | 1.12.x | 最新版 |
| v6.7 | 1.12.x | 最新版 |
| v6.6 | 1.12.x | 最新版 |
| v6.5 | 1.12.x | 最新版 |
| v6.0 | 1.12.x | 最新版 |
| v5.x | 1.11.x | 最新版 |

---

## 常见问题

<details>
<summary><strong>副 API 连不上怎么办？</strong></summary>

1. 确认 URL 格式正确，例如 DeepSeek 应填写 `https://api.deepseek.com/v1/chat/completions`（含完整路径）。
2. 本地 LLM（如 Ollama）的 URL 应为 `http://localhost:11434/v1`，Key 留空。
3. 点击 Settings 面板中的 **Test Connection** 按钮检测连通性。
4. 如果云端 API 被 CORS 阻挡，NE 会自动通过 ST 的 CORS Proxy 回退。
</details>

<details>
<summary><strong>Token 消耗太大怎么办？</strong></summary>

1. 副 API 换用更小、更便宜的模型（如 DeepSeek v4-flash 或 Qwen 2.5-7B）。
2. 降低 Memory Budget 或 Dialog Window Rounds 的值。
3. 查看 Settings → Usage 面板中的 Token 统计，定位主要消耗环节。
</details>

<details>
<summary><strong>面板打不开 / 显示异常？</strong></summary>

1. 确认酒馆助手已启用且运行正常。
2. 确认 NE 脚本在 TH 脚本管理器中处于"已启用"状态。
3. 打开浏览器控制台（F12）查看是否有红色报错。
4. 尝试清除 localStorage 中的 `ne_settings` 键，然后刷新页面。
</details>

<details>
<summary><strong>数据存在哪里？隐私安全吗？</strong></summary>

所有记忆数据存储在浏览器本地的 IndexedDB 中，不会上传到任何服务器。LLM API 调用只发送 prompt 文本，不包含原始记忆数据结构。Vault 数据还可以嵌入聊天文件（chat_metadata），随 ST 的聊天导出/备份一起迁移。各存储位置概览：

| 位置 | 内容 |
|------|------|
| IndexedDB `ne_memory_vaults` | Vault 数据 + 历史快照 |
| localStorage `ne_settings` | 用户设置 |
| localStorage `ne_secondary_api` | 副 API 配置 |
| localStorage `ne_embedding_api` | 向量 API 配置 |
| chat_metadata `ne_vault` | Vault 随聊天文件导出 |
</details>

---

## 开发

详见 [CODE_WIKI.md](./CODE_WIKI.md)（完整架构说明、模块详解、数据流图）。

```bash
# 安装依赖
npm install

# 构建 dist/index.js
npm run build

# 监听模式（文件变更自动重建）
npm run watch

# 单元测试
npm run test:unit

# 架构棘轮测试
npm run test:ratchet

# 全部测试
npm test
```

### 浏览器控制台调试

加载 NE 后，可通过 `window.__ne_debug` 使用调试 API：

```javascript
// 手动触发 Pipeline
__ne_debug.triggerPipeline()

// 导出 Vault 数据
__ne_debug.exportVault()

// 列出所有测试用例
__ne_debug.listTests()

// 运行指定测试
__ne_debug.runTestByName('smartpush-01-not-empty')
```

---

## 贡献与许可

- 作者：Melody
- 仓库：[https://github.com/Melody-0321/NE-Memory](https://github.com/Melody-0321/NE-Memory)
- 许可：[AGPL-3.0](./LICENSE)
- 行为准则：[Contributor Covenant](./CODE_OF_CONDUCT.md)
