# NE Memory Engine v6.0

SillyTavern 长对话结构化记忆管理引擎。基于酒馆助手 (Tavern Helper) 运行。

## 安装

1. 确保已安装 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)
2. 在 TH 脚本管理器中点击**导入**，粘贴以下 JSON：

```json
{
  "type": "script",
  "enabled": true,
  "name": "NE Memory Engine v6.0",
  "id": "ne_memory_engine",
  "content": "(function(){var s=document.createElement('script');s.src='https://gcore.jsdelivr.net/gh/Melody-0321/NE-Memory@test6.0/dist/index.js';s.onerror=function(){var f=document.createElement('script');f.src='https://cdn.jsdelivr.net/gh/Melody-0321/NE-Memory@test6.0/dist/index.js';document.head.appendChild(f)};document.head.appendChild(s)})()",
  "info": "🧠 v6.0 — Pipeline 架构重构 · 💰 Token 优化（角色心理状态 + LTM 弧占位符） · 🔍 向量 + BM25 混合检索 · 🛡️ NE-CHAR 泄漏修复 · ⚙️ 设置面板清理 · 🧪 27 项测试全部通过"
}
```

3. 启用脚本，完成。Vault 面板会自动出现在 TH 弹窗中。

## 配置副 API

NE 的记忆提取和管线处理需要 LLM。在设置面板的「Secondary API」中配置：

**云 API**（推荐入门）：
- URL: `https://api.deepseek.com/v1/chat/completions`（或其他 OpenAI 兼容地址）
- Key: 填写 API Key
- Model: `deepseek-v4-flash`

**本地 LLM**（免费，需本地运行）：
- URL: `http://localhost:1234/v1`（LM Studio / vLLM / Ollama 等）
- Key: 留空
- Model: 填写本地模型名（如 `qwen2.5-7b-instruct`）

支持：DeepSeek、硅基流动、OpenRouter 等云平台，以及 Ollama、vLLM、LM Studio、LocalAI 等任何 OpenAI 兼容端点。

## 功能

- **STM/LTM 分层记忆**：短期记忆自动从对话中提取事件，长期记忆按叙事弧整合关联 STM。整合不丢失原始数据，LTM 弧支持手动编辑标题/摘要。
- **SmartPush 智能注入**：每次 LLM 生成前，自动检索相关记忆注入上下文。**纯本地管线**（无 LLM 参与）：BM25 检索 → 可选向量 RRF 融合 → 实体链分组 → 代码格式化实体记忆链。零额外 API 成本。
- **向量搜索**：支持 OpenAI 兼容 Embedding API，一键预设硅基流动免费 BAAI/bge-m3。BM25 + 向量 RRF 混合检索，质量测试内建。
- **增量更新**：代码级保证不重复处理同一消息，事件记忆消耗不随对话增长。独立 Pipeline 锁支持 STM/State 并行提取。
- **三层穿透**：LTM 摘要 → STM 详情 → 原始对话原文，记忆溯源完整。
- **版本管理**：30 个历史快照 + 精确回滚 + 垃圾回收器级联清理。
- **状态维护**：Schema 驱动的字段级约束——角色卡、势力、关系、任务状态均由 LLM 提取并维护在 structured state 中。
- **Tool-calling**：2 个注册工具 — `access`（统一引用查询：支持 STM/LTM/msg/实体链/角色卡/势力/任务等多种引用格式）和 `recall_memory`（开放语义检索）
- **副 API 支持**：记忆 Pipeline 和 Embedding 可分别配置独立 API（`callMemoryPipeline` / `computeEmbeddings`），节省主 API Token。CORS-proxy 自动回退。
- **上下文控制**：对话轮数注入控制（替代纯 token-budget 截断），支持 override ST 上下文窗口限制。
- **三语界面**：简体中文 / 繁體中文 / English
- **内建测试框架**：27 套端到端测试 + 全链路冒烟测试，支持从 TH 面板直接运行

## 与 SP 记忆库的共存

NE 和 SP 是互补方案：
- **SP** 管理结构化事实（角色属性/物品/时间/NPC）→ 通过世界书注入
- **NE** 管理叙事事件（剧情/情感/因果关系）→ 通过 setExtensionPrompt 注入

两者可以在同一 ST 实例共存。NE 支持世界书同步（自动创建 `NE_Memory_State` Lorebook）。

## 项目结构

详见 [CODE_WIKI.md](./CODE_WIKI.md)。

## 开发

```bash
npm install
npm run build        # 构建 dist/index.js
npm run test:unit    # 单元测试
npm run test:ratchet # 架构棘轮测试
```
