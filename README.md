# NE Memory Engine

SillyTavern 长对话结构化记忆管理引擎。基于酒馆助手 (Tavern Helper) 运行。

## 安装

1. 确保已安装 [酒馆助手 (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)
2. 在 TH 脚本管理器中粘贴以下 URL：

```
https://cdn.jsdelivr.net/gh/xxxx/ne-memory@v0.2.0/dist/index.js
```

3. 完成。Vault 面板会自动出现在 TH 弹窗中。

## 功能

- **STM/LTM 分层记忆**：短期记忆自动提取，长期记忆合并整合，整合不丢失原始数据
- **增量更新**：代码级保证不重复处理同一消息，事件记忆消耗不随对话增长
- **三层穿透**：LTM 摘要 → STM 详情 → 原始对话原文
- **版本管理**：30 个历史快照 + 精确回滚
- **状态维护**：Schema 驱动的字段级约束，LLM 只修改变化字段
- **Tool-calling**：4 个注册工具（lookup_memory_source / lookup_stm / update_opening_summary / update_state）
- **副 API 支持**：记忆提取可以使用独立 API（配置中填写），节省主 API Token
- **三语界面**：简体中文 / 繁體中文 / English

## 与 SP 记忆库的共存

NE 和 SP 是互补方案：
- **SP** 管理结构化事实（角色属性/物品/时间/NPC）→ 通过世界书注入
- **NE** 管理叙事事件（剧情/情感/因果关系）→ 通过 setExtensionPrompt 注入

两者可以在同一 ST 实例共存。
