# 本地 LLM (Secondary API) 支持 — 实施计划

## 摘要

当前架构已完整支持 OpenAI 兼容的本地 LLM（keyless 调用 + URL 校正 + 响应解析），用户现在就可以接入。只需三处 UX/文档更新让用户知道这个能力：面板 placeholder 提示、README 文档、CODE_WIKI 文档。

## 改动清单

### 1. panel-settings.js — Secondary API placeholder 更新

**文件**：[src/adapter/panel-settings.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-settings.js)

**Current** (L63-65):
```javascript
'<div><label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
'<div><label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '"></div>' +
'<div><label>' + t('Model') + '</label><input type="text" id="nes_secondary_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '"></div>' +
```

**新的 placeholder 改为**:
- API URL: `https://api.deepseek.com/v1/chat/completions` → `https://api.deepseek.com/v1/chat/completions 或 http://localhost:1234/v1`
- API Key: `sk-...` → `sk-...(本地LLM无需填写)`
- Model: `deepseek-v4-flash` → `deepseek-v4-flash 或本地模型名`

**说明文字追加**：在 API URL input 下方加一行灰色提示：
```
支持任何 OpenAI 兼容端点：Ollama、vLLM、LM Studio、LocalAI 等。
本地 LLM 无需填写 API Key（留空即可）。
```

面板下方连接状态旁边也加一个兼容提示，避免用户疑惑。

### 2. README.md — 安装后配置说明更新

**文件**：[README.md](file:///d:/SillyTavern/xm/ne-memory/README.md)

在"安装"步骤后面新增一个"配置"小节：

```
## 配置副 API

NE 记忆提取和管线处理需要 LLM。在设置面板的"Secondary API"中配置：

**云 API**（推荐入门）：
- URL: `https://api.deepseek.com/v1/chat/completions`（或其他 OpenAI 兼容地址）
- Key: 填写 API Key
- Model: `deepseek-v4-flash`

**本地 LLM**（免费，需本地运行）：
- URL: `http://localhost:1234/v1`（LM Studio / vLLM 等）
- Key: 留空
- Model: 填写本地模型名（如 `qwen2.5-7b-instruct`）

支持列表：DeepSeek、硅基流动、OpenRouter 等云平台，以及 Ollama、vLLM、LM Studio、LocalAI 等任何 OpenAI 兼容的本地端点。
```

### 3. CODE_WIKI.md — llm.js 文档更新

**文件**：[CODE_WIKI.md](file:///d:/SillyTavern/xm/ne-memory/CODE_WIKI.md)

在 `3.4.2 llm.js` 节 (L278-300) 更新：

- `callCustomAPI` 描述中补充：无 key 模式（本地 LLM）
- `normalizeApiUrl` 行为说明加 localhost 支持
- 补充 `callMemoryLLM` 的降级路径图，强调 keyless 路径

### 4. i18n.js — 新增提示文字键

**文件**：[src/core/i18n.js](file:///d:/SillyTavern/xm/ne-memory/src/core/i18n.js)

新增键（三语）:
```
'Supports any OpenAI-compatible endpoint: Ollama, vLLM, LM Studio, LocalAI. Leave API Key empty for local LLMs.'
```

### 无需代码改动

- `callCustomAPI` / `normalizeApiUrl` / response 解析 — 已完整支持
- 无 key 模式（`if (config.key)` 条件跳过）— 已存在
- CORS proxy 回退对 localhost 无影响（localhost 不走 CORS）

## 验证

- 修改后打开设置面板 → Secondary API 折叠区 → 确认 placeholder + 说明文字显示正确
- 用本地 LM Studio 实际测试：填入 `http://localhost:1234/v1` + 模型名 + 留空 Key → 点击 Connect → 应显示绿色 Connected
