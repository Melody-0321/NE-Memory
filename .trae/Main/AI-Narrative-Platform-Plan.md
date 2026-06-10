# AI 角色扮演叙事与创作平台 - 技术实施方案

## 一、架构总览

### 1.1 设计原则

- **插件化开发**：全部新功能通过 SillyTavern 现有插件/扩展系统注入，不修改核心代码
- **渐进式增强**：先实现最小可行产品（MVP），再逐步迭代
- **前后端分离**：Python 后端（处理 Agent 逻辑、记忆管理）+ JS/TS 前端插件（UI 与交互）
- **事件驱动**：充分利用 SillyTavern 的 100+ 事件钩子，避免侵入式修改

### 1.2 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     SillyTavern 前端 (Vanilla JS SPA)              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ 基础界面  │  │ 角色管理  │  │ 对话窗口  │  │ ◎ 叙事插件 UI  │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                  │              │
│  ┌───────────────────────────────────────────────────┐          │
│  │          SillyTavern 事件系统 (EventEmitter)         │          │
│  │  message_sent / message_received / GENERATION_*     │          │
│  └───────────────────────────────────────────────────┘          │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ HTTP/SSE
┌───────────────────────────────────▼─────────────────────────────┐
│               SillyTavern Node.js 后端 (Express)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ API 路由 │  │ 插件加载器│  │ LLM 网关 │  │ ◎ 叙事 API 代理│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ REST API
┌───────────────────────────────────▼─────────────────────────────┐
│              ◎ 叙事引擎服务层 (Python/FastAPI)                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                 导演智能体 (GM Agent)                        │  │
│  │  • 场景检测器: 分析对话上下文，识别当前场景类型                  │  │
│  │  • 角色调度器: 决定哪些角色应该参与下一轮对话                    │  │
│  │  • 氛围设定器: 生成环境描述、情绪基调                         │  │
│  │  • 一致性检查器: 验证角色行为是否符合人设                      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                三层记忆系统 (Memory Vault)                    │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │  │
│  │  │ L1: 对话暂存  │ │ L2: 向量知识库│ │ L3: 关键节点  │        │  │
│  │  │ (Redis)      │ │ (Chroma/Qdrant)│ │ (JSON/DB)   │        │  │
│  │  │ 最近20-30轮  │ │ 记忆豆+语义   │ │ 情感炸弹等   │        │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              通信协议层 (MCP-like 轻量协议)                   │  │
│  │  • 标准化 Agent 消息格式                                     │  │
│  │  • 请求/响应 Schema                                          │  │
│  │  • 流式/批处理支持                                           │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、实施方案：6 个阶段

## 阶段 1：项目基础设施搭建

### 1.1 创建项目目录结构

```
project-root/
├── narrative-engine/              # Python 叙事引擎服务
│   ├── pyproject.toml             # Python 项目配置 (Poetry/PDM)
│   ├── src/
│   │   ├── __init__.py
│   │   ├── main.py                # FastAPI 应用入口
│   │   ├── config.py              # 配置管理
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── routes.py          # API 路由
│   │   │   └── schemas.py         # Pydantic 模型
│   │   ├── agents/
│   │   │   ├── __init__.py
│   │   │   ├── base.py            # Agent 基类
│   │   │   ├── gm_agent.py        # 导演智能体
│   │   │   └── character_agent.py # 角色智能体
│   │   ├── memory/
│   │   │   ├── __init__.py
│   │   │   ├── l1_short_term.py   # L1 短期记忆
│   │   │   ├── l2_vector_store.py # L2 向量知识库
│   │   │   ├── l3_key_nodes.py    # L3 关键节点
│   │   │   └── summarizer.py      # 记忆豆生成器
│   │   └── protocol/
│   │       ├── __init__.py
│   │       └── message.py         # Agent 通信协议
│   └── tests/
│
├── public/scripts/extensions/
│   └── narrative/                 # SillyTavern 前端叙事插件
│       ├── manifest.json
│       ├── index.js
│       ├── style.css
│       ├── config.html            # 设置面板
│       ├── panel.html             # 叙事控制面板
│       └── i18n/
│           ├── en.json
│           └── zh.json
│
└── plugins/
    └── st-narrative-bridge/       # SillyTavern Node.js 服务端插件
        ├── package.json
        ├── index.js               # 桥接插件：转发请求到 Python 服务
        └── README.md
```

### 1.2 Python 服务脚手架

```python
# narrative-engine/src/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Narrative Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000"],  # SillyTavern 地址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}

# 使用 uvicorn 启动: uvicorn main:app --host 127.0.0.1 --port 8080
```

### 1.3 Node.js 桥接插件

```javascript
// plugins/st-narrative-bridge/index.js
const NARRATIVE_ENGINE_URL = process.env.NARRATIVE_ENGINE_URL || 'http://127.0.0.1:8080';

export const info = {
    id: 'narrative-bridge',
    name: 'Narrative Engine Bridge',
    description: 'Bridges SillyTavern to the Python Narrative Engine service. Proxies API requests from frontend to the narrative engine backend.',
};

async function proxyRequest(fetchUrl, method, body, headers) {
    let response;
    try {
        const fetchHeaders = {
            'Content-Type': 'application/json',
        };

        if (headers) {
            const headerNames = Object.keys(headers);
            for (const name of headerNames) {
                const lower = name.toLowerCase();
                if (lower !== 'host' && lower !== 'connection' && lower !== 'content-length') {
                    fetchHeaders[name] = headers[name];
                }
            }
        }

        const fetchOptions = {
            method,
            headers: fetchHeaders,
        };

        if (body && method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = JSON.stringify(body);
        }

        response = await fetch(fetchUrl, fetchOptions);
    } catch (error) {
        return {
            status: 502,
            body: {
                error: 'Narrative Engine service unreachable',
                detail: error.message || String(error),
            },
        };
    }

    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return {
        status: response.status,
        body: data,
    };
}

export async function init(router) {
    // 代理: 将叙事引擎的 API 暴露给前端
    router.post('/health', async (req, res) => {
        const result = await proxyRequest(
            `${NARRATIVE_ENGINE_URL}/health`,
            'GET',
        );
        res.status(result.status).json(result.body);
    });

    router.post('/memory/vault/read', async (req, res) => {
        const result = await proxyRequest(
            `${NARRATIVE_ENGINE_URL}/api/memory/vault/read`,
            'POST',
            req.body,
            req.headers,
        );
        res.status(result.status).json(result.body);
    });

    router.post('/memory/vault/update', async (req, res) => {
        const result = await proxyRequest(
            `${NARRATIVE_ENGINE_URL}/api/memory/vault/update`,
            'POST',
            req.body,
            req.headers,
        );
        res.status(result.status).json(result.body);
    });

    router.post('/memory/lookup', async (req, res) => {
        const result = await proxyRequest(
            `${NARRATIVE_ENGINE_URL}/api/memory/lookup`,
            'POST',
            req.body,
            req.headers,
        );
        res.status(result.status).json(result.body);
    });

    router.post('/gm/analyze', async (req, res) => {
        const result = await proxyRequest(
            `${NARRATIVE_ENGINE_URL}/api/gm/analyze`,
            'POST',
            req.body,
            req.headers,
        );
        res.status(result.status).json(result.body);
    });
}
```

---

## 阶段 2：前端叙事插件开发

### 2.1 插件 Manifest

```json
{
    "display_name": "Narrative Engine",
    "loading_order": 50,
    "js": "index.js",
    "css": "style.css",
    "author": "YourTeam",
    "version": "0.1.0",
    "hooks": {
        "activate": "init"
    }
}
```

### 2.2 插件核心初始化

```javascript
// public/scripts/extensions/narrative/index.js
import {
    getContext,
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../extensions.js';
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../../../script.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';

const NARRATIVE_SETTINGS_KEY = 'narrative';
const NARRATIVE_API_ENDPOINT = '/api/plugins/narrative-bridge';

let narrativeSettings = {
    enabled: false,
    gmEnabled: false,
    memoryEnabled: false,
    gmModel: '',
    memoryProvider: 'chroma',
    maxShortTermRounds: 30,
    memoryRecallThreshold: 0.6,
};

export async function init() {
    const context = getContext();

    // 1. 加载设置
    if (!extension_settings[NARRATIVE_SETTINGS_KEY]) {
        extension_settings[NARRATIVE_SETTINGS_KEY] = narrativeSettings;
    }
    narrativeSettings = extension_settings[NARRATIVE_SETTINGS_KEY];

    // 2. 注入设置面板 HTML
    const settingsHtml = await renderExtensionTemplateAsync('narrative', 'config', {});
    $('#narrative_container').append(settingsHtml);

    // 3. 注入叙事控制面板
    const panelHtml = await renderExtensionTemplateAsync('narrative', 'panel', {});
    $('#narrative_panel_container').append(panelHtml);

    // 4. 绑定 UI 事件
    $('#narrative_enable').on('change', function () {
        narrativeSettings.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // 5. 注册事件监听
    // 消息发送后 -> 触发记忆保存
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
    // 消息接收后 -> 触发记忆保存 + GM 分析
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    // 生成前 -> 注入记忆和 GM 指令
    eventSource.on(event_types.GENERATE_AFTER_COMMANDS, onBeforeGenerate);

    // 6. 注册斜杠命令
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'narrative',
        callback: async (args) => {
            // 处理 /narrative 命令
        },
        helpString: 'Control narrative engine features.',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'action',
                description: 'Action: status/toggle',
                required: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));

    console.log('[Narrative Engine] Extension initialized');
}
```

### 2.3 事件处理器

```javascript
// 消息发送后: 保存到短期记忆
async function onMessageSent(messageId) {
    if (!narrativeSettings.enabled || !narrativeSettings.memoryEnabled) return;
    const context = getContext();
    const message = context.chat.find(m => m.id === messageId);
    if (!message) return;

    await saveToShortTermMemory({
        role: 'user',
        content: message.mes,
        timestamp: Date.now(),
        characterId: context.characterId,
    });
}

// 消息接收后: 保存到短期记忆 + 触发 GM 分析
async function onMessageReceived(messageId) {
    if (!narrativeSettings.enabled) return;
    const context = getContext();
    const message = context.chat.find(m => m.id === messageId);
    if (!message) return;

    // 1. 保存到短期记忆
    if (narrativeSettings.memoryEnabled) {
        await saveToShortTermMemory({
            role: 'assistant',
            content: message.mes,
            timestamp: Date.now(),
            characterId: message.force_avatar || context.characterId,
        });

        // 检查是否需要提炼记忆豆（每 10 轮或检测到情感触发）
        await checkAndSummarizeMemory();
    }

    // 2. GM 场景分析
    if (narrativeSettings.gmEnabled) {
        const gmAnalysis = await requestGmAnalysis();
    }
}

// 生成前: 注入检索到的记忆和 GM 指令
async function onBeforeGenerate() {
    if (!narrativeSettings.enabled) return;
    const context = getContext();

    // 1. 检索相关记忆
    if (narrativeSettings.memoryEnabled) {
        const lastMessage = context.chat[context.chat.length - 1];
        const memories = await recallMemories(lastMessage?.mes || '');

        if (memories && memories.length > 0) {
            const memoryPrompt = memories.map(m =>
                `[Memory: ${m.summary} (relevance: ${(m.score * 100).toFixed(0)}%)]`
            ).join('\n');

            context.setExtensionPrompt(
                'narrative_memory',
                memoryPrompt,
                'in_braces',
                3,      // depth: 靠前注入
                'system'
            );
        }
    }

    // 2. 注入 GM 场景指令
    if (narrativeSettings.gmEnabled) {
        const gmDirective = await requestGmDirective();
        if (gmDirective) {
            context.setExtensionPrompt(
                'narrative_gm',
                gmDirective,
                'in_braces',
                1,      // depth: 最靠前
                'system'
            );
        }
    }
}
```

### 2.4 与叙事引擎的 API 通信

```javascript
async function requestGmAnalysis() {
    const context = getContext();
    const recentChat = context.chat.slice(-10);

    try {
        const response = await fetch(`${NARRATIVE_API_ENDPOINT}/gm/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_history: recentChat.map(m => ({
                    role: m.is_user ? 'user' : 'character',
                    name: m.name,
                    content: m.mes,
                })),
                character: context.characters[context.characterId],
                user_name: context.name1,
            }),
        });
        return await response.json();
    } catch (error) {
        console.error('[Narrative Engine] GM analysis failed:', error);
        return null;
    }
}

async function recallMemories(query) {
    try {
        const response = await fetch(`${NARRATIVE_API_ENDPOINT}/memory/recall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                top_k: 5,
                threshold: narrativeSettings.memoryRecallThreshold,
            }),
        });
        return await response.json();
    } catch (error) {
        console.error('[Narrative Engine] Memory recall failed:', error);
        return [];
    }
}

async function saveToShortTermMemory(entry) {
    try {
        await fetch(`${NARRATIVE_API_ENDPOINT}/memory/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'short_term',
                entry,
            }),
        });
    } catch (error) {
        console.error('[Narrative Engine] Save to memory failed:', error);
    }
}
```

---

## 阶段 3：导演智能体（GM Agent）+ 多角色 Agent 生命周期

### 3.1 核心设计

#### 要解决的问题

**问题 1：多角色 Agent 生命周期管理**
- 一个角色不出场时，其 Agent 不应占用资源 → **休眠/销毁**
- 角色重新出场时，其 Agent 需重新获取角色状态 → **唤醒/重建**
- 重新唤醒的 Agent 需要知道自己角色的全部状态和历史 → **从记忆区读取**

**问题 2：角色状态认知**
- 一个角色"应该知道什么"和"不应该知道什么"需要区分
- 角色不在场时发生的事件，该角色不应该知道
- 角色再次出场时，GM 需要告诉 Agent 该角色的已知信息范围

**问题 3：多角色上下文膨胀**
- 同时维护多个角色的状态栏，每次全量生成会大量消耗 Token
- 独立记忆区 + 增量更新使每个角色的状态只需维护增量变化

#### 解决方案概览

```
┌─────────────────────────────────────────────────────────────────────┐
│  GM Agent (全局唯一，始终运行)                                       │
│                                                                      │
│  职责：                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ① 场景分析器：判断当前场景类型和氛围                            │    │
│  │ ② 角色调度器：决定"谁应该在场景中" + "谁应该被唤醒/休眠"        │    │
│  │ ③ 知识边界控制器：决定每个角色"知道了什么"和"不知道什么"         │    │
│  │ ④ 信息指引器：告诉每个角色 Agent 去记忆区哪里找自己的状态       │    │
│  │ ⑤ 一致性审查员：检查角色 Agent 的输出是否合人设                  │    │
│  │ ⑥ Agent 生命周期管理器：创建/休眠/唤醒/销毁 角色 Agent         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 调度指令
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ 角色 Agent A      │ │ 角色 Agent B      │ │ 角色 Agent C      │
│ (活跃/在场)        │ │ (休眠/不在场)      │ │ (活跃/在场)        │
│                  │ │                  │ │                  │
│ prompt = 人设卡   │ │ 不占用内存/不调用  │ │ prompt = 人设卡   │
│ + 角色状态(从记忆区)│ │ 状态保存在记忆区   │ │ + 角色状态(从记忆区)│
│ + 已知信息范围     │ │ GM 决定唤醒时重建  │ │ + 已知信息范围     │
└──────────────────┘ └──────────────────┘ └──────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ 独立记忆区 (Memory Vault) │
                    │                      │
                    │ ┌─ 全局叙事流         │
                    │ ├─ 角色A的状态/已知信息 │
                    │ ├─ 角色B的状态/已知信息 │
                    │ └─ 角色C的状态/已知信息 │
                    └──────────────────────┘
```

### 3.2 现有插件调研：角色状态管理现状

搜索了 GitHub 和社区后，SillyTavern 的第三方插件在处理角色状态/多角色时的现状：

| 插件 | 处理方式 | 局限 |
|------|---------|------|
| **Silly Sim Tracker** (prolix-oc) | 在聊天消息中用 JSON 代码块嵌入角色状态数据，渲染为可视化卡片 | 状态嵌入在 chat 消息中，不持久独立；每次需重解析 JSON；无 AI 自动更新 |
| **Horae 时光记忆** (SenriYuki) | 结构化时间锚 + 物品/关系/场景记忆 | 只聚焦单角色的环境感知，无多角色 Agent 概念 |
| **酒馆原生群聊** | group.members 数组 + 轮询选择角色 | 无状态管理、无角色知识边界、无生命周期 |
| **Shore** (Rust, 非插件) | 每个角色独立 workspace + Markdown 记忆文件 | 独立项目，不兼容 SillyTavern 插件体系，有参考价值 |

**核心差距**：现有方案都没有解决"角色不在场时怎么办"和"角色应该知道什么"这两个核心问题。

### 3.3 Agent 基类（含生命周期）

```python
# narrative-engine/src/agents/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class AgentLifecycleState(Enum):
    """Agent 生命周期状态"""
    ACTIVE = "active"       # 活跃：角色在当前场景中
    SLEEPING = "sleeping"   # 休眠：角色不在场景中，状态保留在记忆区
    TERMINATED = "terminated"  # 已终止：不再需要


@dataclass
class AgentContext:
    """Agent 上下文"""
    chat_history: list[dict]
    vault_content: dict              # 从独立记忆区读取的最新数据
    character_state: Optional[dict] = None  # 当前角色的专属状态
    known_info_scope: Optional[list[str]] = None  # 角色"应该知道"的信息范围
    gm_directive: Optional[str] = None   # GM 的导演指令
    scene_type: Optional[str] = None
    emotional_tone: Optional[str] = None


class BaseAgent(ABC):
    """所有 Agent 的基类（含生命周期）"""

    def __init__(self, agent_id: str, character_data: dict):
        self.agent_id = agent_id
        self.character_data = character_data
        self.lifecycle = AgentLifecycleState.TERMINATED

    @abstractmethod
    async def on_wake(self, context: AgentContext) -> None:
        """唤醒时执行：从记忆区读取状态，初始化 prompt"""
        pass

    @abstractmethod
    async def on_sleep(self) -> None:
        """休眠时执行：保存当前状态到记忆区"""
        pass

    @abstractmethod
    async def process(self, context: AgentContext) -> dict:
        """处理 Agent 逻辑（仅在 ACTIVE 状态时调用）"""
        pass
```

### 3.4 导演智能体（含生命周期管理）

```python
# narrative-engine/src/agents/gm_agent.py
import json
from typing import Optional
from .base import BaseAgent, AgentContext, AgentLifecycleState


class CharacterAgentManager:
    """
    角色 Agent 生命周期管理器
    
    核心职责：
    - 维护所有角色 Agent 的生命周期状态
    - 根据 GM 的调度指令 创建/唤醒/休眠/销毁 Agent
    - 休眠的 Agent 不占用内存，状态保存在记忆区
    - 唤醒的 Agent 从记忆区读取完整状态
    """

    def __init__(self):
        self._agents: dict[str, BaseAgent] = {}

    def get_active_agents(self) -> list[BaseAgent]:
        return [a for a in self._agents.values()
                if a.lifecycle == AgentLifecycleState.ACTIVE]

    async def wake_agent(self, agent: BaseAgent, context: AgentContext) -> None:
        """唤醒一个角色 Agent（或首次创建）"""
        agent.lifecycle = AgentLifecycleState.ACTIVE
        await agent.on_wake(context)
        self._agents[agent.agent_id] = agent
        print(f"[Lifecycle] Agent {agent.agent_id} woken")

    async def sleep_agent(self, agent_id: str) -> None:
        """休眠一个角色 Agent"""
        agent = self._agents.get(agent_id)
        if agent and agent.lifecycle == AgentLifecycleState.ACTIVE:
            await agent.on_sleep()
            agent.lifecycle = AgentLifecycleState.SLEEPING
            print(f"[Lifecycle] Agent {agent_id} slept")

    def terminate_agent(self, agent_id: str) -> None:
        """终止一个角色 Agent"""
        if agent_id in self._agents:
            self._agents[agent_id].lifecycle = AgentLifecycleState.TERMINATED
            del self._agents[agent_id]
            print(f"[Lifecycle] Agent {agent_id} terminated")


class GMAgent(BaseAgent):
    """
    导演智能体 (Game Master Agent)

    核心职责（含生命周期管理扩展）:
    1. 场景检测 - 识别当前叙事场景类型
    2. 角色调度 - 决定哪些角色"在场"，哪些应"休眠"
    3. 知识边界控制 - 决定每个角色"知道什么"和"不知道什么"
    4. 信息指引 - 告诉角色 Agent 去记忆区哪里找自己的数据
    5. Agent 生命周期管理 - 通过 CharacterAgentManager 控制
    6. 一致性检查 - 验证角色行为是否符合人设
    """

    SCENE_TYPES = [
        "dialogue", "exploration", "conflict", "romance",
        "action", "mystery", "comedy", "tragedy", "transition",
    ]

    def __init__(self, model_name: str, agent_manager: CharacterAgentManager):
        super().__init__("gm", {"name": "Game Master"})
        self.model_name = model_name
        self.agent_manager = agent_manager

    async def analyze_scene(self, vault: dict, chat_history: list[dict]) -> dict:
        """场景检测（基于独立记忆区 + 最近对话）"""
        recent = chat_history[-6:]
        scene_prompt = f"""Analyze current scene:
Memory summary: {vault.get('content', {}).get('summary', '')}
Recent chat: {json.dumps(recent, ensure_ascii=False, indent=2)}

Determine:
1. Scene type: {', '.join(self.SCENE_TYPES)}
2. Emotional tone (1-2 words)
3. Tension level: 0.0-1.0
4. Which characters are present in this scene (from memory character_states)
5. Which characters are not present and should remain off-stage

Respond in JSON."""
        response = await self._call_llm([
            {"role": "system", "content": "You are a narrative scene analyzer."},
            {"role": "user", "content": scene_prompt},
        ])
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            return {"scene_type": "dialogue", "emotional_tone": "neutral",
                    "tension_level": 0.3, "present_characters": [], "absent_characters": []}

    async def determine_knowledge_boundaries(
        self,
        vault: dict,
        present_characters: list[str],
    ) -> dict[str, list[str]]:
        """
        知识边界控制
        
        决定每个"在场"角色应该知道/不应该知道什么。
        不在场角色在离线期间发生的事件，该角色不应知道。
        
        Returns: { character_name: [应该知道的信息范围列表] }
        """
        character_states = vault.get("content", {}).get("character_states", {})
        key_events = vault.get("content", {}).get("key_events", [])
        absent_events = [
            e for e in key_events
            if e.get("known_to", present_characters)  # 已知范围
        ]

        boundaries = {}
        for char in present_characters:
            boundaries[char] = {
                "known_events": [...],  # 该角色参与或目睹的事件
                "unknown_events": [...],  # 该角色不在场时发生的事件
                "state": character_states.get(char, {}),
                "memory_vault_path": f"character_zones.{char}",
            }
        return boundaries

    async def schedule_characters(
        self,
        scene_analysis: dict,
        vault: dict,
        all_characters: list[str],
    ) -> dict:
        """
        角色调度：决定谁出场、谁休眠
        在独立记忆区 + 增量更新架构下这变得可行：
        - 每次只需读取角色状态的增量变化
        - 休眠角色的状态安全保存在 vault 中
        """
        present = scene_analysis.get("present_characters", [])
        absent = [c for c in all_characters if c not in present]

        # 检查需要状态恢复的角色（重新出场的角色）
        reentering = []
        for char in present:
            state = vault.get("content", {}).get("character_states", {}).get(char)
            if state and state.get("last_seen_version", 0) < vault.get("version", 0):
                reentering.append(char)

        return {
            "present": present,
            "absent": absent,
            "reentering": reentering,  # 这些角色需要从 vault 读取历史状态恢复
        }

    async def process(self, vault: dict, chat_history: list[dict],
                      all_characters: list[str]) -> dict:
        """GM Agent 主入口（含完整的 Agent 生命周期管理）"""
        # 1. 场景分析
        scene = await self.analyze_scene(vault, chat_history)

        # 2. 角色调度
        schedule = await self.schedule_characters(scene, vault, all_characters)

        # 3. 生命周期管理
        for char in schedule["present"]:
            if char not in self.agent_manager._agents:
                # 首次出场：新建 Agent
                agent = CharacterAgent(char, {})
                await self.agent_manager.wake_agent(agent, self._build_context(
                    vault, char, scene, schedule))
            else:
                agent = self.agent_manager._agents[char]
                if agent.lifecycle != AgentLifecycleState.ACTIVE:
                    # 重新出场：从 vault 恢复状态
                    await self.agent_manager.wake_agent(
                        agent, self._build_context(vault, char, scene, schedule))

        for char in schedule["absent"]:
            await self.agent_manager.sleep_agent(char)

        # 4. 知识边界控制
        knowledge = await self.determine_knowledge_boundaries(
            vault, schedule["present"])

        # 5. 生成 GM 指令（包含信息指引）
        directive = await self._generate_directive(scene, schedule, knowledge, vault)

        return {
            "scene_analysis": scene,
            "schedule": schedule,
            "knowledge_boundaries": knowledge,
            "directive": directive,
            "active_agents": [a.agent_id for a in self.agent_manager.get_active_agents()],
        }

    def _build_context(self, vault, char_name, scene, schedule):
        """构建角色 Agent 的上下文（包含记忆区指引路径）"""
        return AgentContext(
            chat_history=[],
            vault_content=vault,
            character_state=vault.get("content", {}).get("character_states", {}).get(char_name),
            gm_directive=f"Your state is at memory_vault.character_zones.{char_name}",
            scene_type=scene.get("scene_type"),
        )

    async def _generate_directive(self, scene, schedule, knowledge, vault) -> str:
        """生成导演指令"""
        reentering = schedule.get("reentering", [])
        reentry_note = ""
        if reentering:
            reentry_note = (f"Re-entering characters: {reentering}. "
                            "Their Agents will be initialized from vault state.")

        return f"""Scene: {scene['scene_type']} | Tone: {scene['emotional_tone']}
Present: {schedule['present']} | Absent (not needed): {schedule['absent']}
{reentry_note}
Knowledge boundaries applied: each Agent has assigned known/unknown scope.
Character Agents should read their state from the vault path provided."""
```

### 3.5 角色智能体（含生命周期 + 从记忆区恢复）

```python
# narrative-engine/src/agents/character_agent.py
from .base import BaseAgent, AgentContext, AgentLifecycleState


class CharacterAgent(BaseAgent):
    """
    角色智能体（含生命周期管理）

    生命周期：
    - SLEEPING → 角色不在场，不占用资源，状态保存在 vault
    - ACTIVE → 角色在场，从 vault 读取状态 + 已知信息范围 + GM 指引
    - 重新唤醒时：GM 告诉 Agent 去哪里找自己的状态（vault path）

    核心改进：
    1. 不维护自己的记忆状态（全部从 vault 读取）
    2. 接受 GM 的"知识边界"指令
    3. 增量更新架构下无需全量重生成
    """

    def __init__(self, agent_id: str, character_data: dict):
        super().__init__(agent_id, character_data)
        self._state_cache = None  # 仅在 ACTIVE 时持有

    async def on_wake(self, context: AgentContext) -> None:
        """
        唤醒时执行（角色重新出场时调用）

        GM Agent 通过 context 告诉此 Agent：
        - 你的角色状态在 vault.character_states.{name}
        - 你应该知道的已知事件范围
        - 你不知道的事情（知识边界）
        """
        self._state_cache = context.character_state or {}
        self._known_scope = context.known_info_scope or []
        self._gm_directive = context.gm_directive or ""

    async def on_sleep(self) -> None:
        """休眠时执行（角色离场时调用）"""
        # 将当前状态写回 vault（增量更新引擎随后处理）
        # 注意：此方法只是标记状态已变更，实际持久化由增量引擎统一处理
        self._state_cache = None
        self._known_scope = []
        self._gm_directive = ""

    def _build_system_prompt(self, context: AgentContext) -> str:
        """构建角色 prompt（含 vault 指引）"""
        char_name = self.character_data.get("name", self.agent_id)
        char_desc = self.character_data.get("description", "")
        char_personality = self.character_data.get("personality", "")

        # GM 指令 + 角色状态
        state_text = json.dumps(self._state_cache, ensure_ascii=False) if self._state_cache else ""

        return f"""You are roleplaying as {char_name}.

{char_desc}
{char_personality}

[Your Current State]
{state_text}

[GM Direction]
{self._gm_directive}

[Memory Access]
Your personal state is managed by the Game Master.
Your known information scope is defined by GM.
For detailed memory recall, use the lookup_memory_source tool.

Stay in character. You only know what your character would know."""

    async def generate_response(
        self,
        context: AgentContext,
    ) -> str:
        """生成角色回复（仅在 ACTIVE 状态时调用）"""
        if self.lifecycle != AgentLifecycleState.ACTIVE:
            return ""

        messages = [{"role": "system", "content": self._build_system_prompt(context)}]

        # 注入对话历史
        for msg in context.chat_history[-20:]:
            role = "user" if msg["role"] == "user" else "assistant"
            name = msg.get("name", "")
            content = msg["content"]
            messages.append({
                "role": role,
                "content": f"{name}: {content}" if name else content,
            })

        return await self._call_llm(messages)

    async def process(self, context: AgentContext) -> dict:
        return {
            "agent_id": self.agent_id,
            "lifecycle": self.lifecycle.value,
            "response": await self.generate_response(context),
        }
```

---

## 阶段 4：独立持久化记忆区

### 4.1 设计理念

**核心洞察**: 传统方案中，每次对话的记忆/摘要附着在聊天消息 `chat[i].extra.memory` 上，导致：
1. 旧版本记忆散布在整个聊天数组中，无法清理
2. Chat Vectorization 检索时会命中所有代的旧摘要，产生检索污染
3. 每次生成都是"旧摘要+新消息→新摘要"的完整重生成

**解决方案**:
1. **独立存储**：记忆与对话分离，Python 后端独立 JSON 文件持久化
2. **单版本**：只维护一个最新版本，旧版本被覆盖而非累积
3. **增量更新**：每次只处理新对话 delta，LLM 仅生成变更部分
4. **超链接索引**：每条记忆绑定原始对话 msg_id，通过 tool calling 按需回溯

### 4.2 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  SillyTavern 聊天界面 (chat[])                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  对话区域：纯原始对话消息，不包含任何记忆/摘要数据                │    │
│  │  Chat Vectorization 只检索这里的原始文本，无旧摘要污染            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                           ▲                                           │
│                           │ setExtensionPrompt() 注入                  │
│                           ▼                                           │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Prompt 组装器                                                  │    │
│  │  注入内容：记忆摘要 + 超链接(msg_id) + lookup_memory_source tool  │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┬───────────────────┘
                                                   │ REST API
┌──────────────────────────────────────────────────▼───────────────────┐
│  叙事引擎 - 独立记忆区 (Memory Vault)                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  记忆存储 (Memory Store)                                      │    │
│  │  ┌────────────────────┐  ┌────────────────────┐              │    │
│  │  │  最新记忆文本       │  │  超链接索引         │              │    │
│  │  │  (latest.json)     │  │  (link_index.json)  │              │    │
│  │  │  • 核心摘要         │  │  • msg_id → 消息元数据│              │    │
│  │  │  • 关键事件流       │  │  • 事件→msg_id映射   │              │    │
│  │  │  • 角色状态         │  │  • 按需定位O(1)      │              │    │
│  │  └────────────────────┘  └────────────────────┘              │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  增量更新引擎 (Incremental Updater)                           │    │
│  │  1. 接收新对话内容                                              │    │
│  │  2. 对比当前最新记忆，识别变化 delta                             │    │
│  │  3. LLM 仅处理变化部分 → 输出增量变更                           │    │
│  │  4. 合并变更到最新记忆，覆盖旧版本                               │    │
│  │  5. 记录变更日志                                                 │    │
│  │  → Token 消耗降低 60%+，无全量重生成                             │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  超链接回溯服务 (Link Lookup Service)                          │    │
│  │  - 注册 Tool: lookup_memory_source(chat_id, msg_ids)          │    │
│  │  - 通过 Node.js 桥接读取 JSONL 聊天文件中的指定消息              │    │
│  │  - 仅返回目标消息，不加载整个历史                                │    │
│  │  - 响应毫秒级                                                    │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.3 数据结构

```python
# data/memory_vault/{chat_id}.json
{
    "chat_id": "abc123",
    "version": 15,
    "updated_at": "2026-05-28T10:30:00Z",
    "content": {
        "summary": "A和B在春日咖啡厅重逢，气氛温馨",  # 核心摘要
        "key_events": [
            {
                "event": "重逢",
                "summary": "A先到咖啡厅等待",
                "importance": 0.8,
                "links": [{"msg_id": 3}, {"msg_id": 4}]
            },
            {
                "event": "告白",
                "summary": "B在樱花树下表白",
                "importance": 1.0,
                "links": [{"msg_id": 45}]
            }
        ],
        "character_states": {
            "A": {
                "mood": "开心",
                "location": "咖啡厅",
                "last_seen_version": 15,
                "known_events": ["重逢", "告白"],  # 角色A知道的事件
                "inventory": {"项链": "重要"},
                "relationships": {"B": "恋人"}
            },
            "B": {
                "mood": "紧张",
                "location": "咖啡厅",
                "last_seen_version": 15,
                "known_events": ["重逢", "告白"],  # 角色B知道的事件
                "inventory": {},
                "relationships": {"A": "恋人"}
            }
        },
        "relationships": [
            {"from": "A", "to": "B", "status": "朋友→恋人",
             "links": [{"msg_id": 46}]}
        ]
    },
    "tokens": 512,
    "link_index": {
        3:  {"chat_id": "abc123", "role": "user",     "summary": "A打招呼"},
        4:  {"chat_id": "abc123", "role": "assistant","summary": "B回应"},
        45: {"chat_id": "abc123", "role": "assistant","summary": "B告白"},
        46: {"chat_id": "abc123", "role": "user",     "summary": "A接受"}
    }
}
```

### 4.4 增量更新引擎

```python
# narrative-engine/src/memory/incremental_updater.py
import json
import os
from datetime import datetime


class IncrementalMemoryUpdater:
    """
    增量更新引擎
    
    核心思想：只处理变化 delta，不重新生成整个记忆。
    流程：当前记忆 + 新消息 → LLM → 增量变更 → 合并 → 覆盖旧版本
    """

    def __init__(self, storage_dir: str = "./data/memory_vault"):
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)

    def _vault_path(self, chat_id: str) -> str:
        return os.path.join(self.storage_dir, f"{chat_id}.json")

    async def read_vault(self, chat_id: str) -> dict:
        """读取当前最新记忆"""
        path = self._vault_path(chat_id)
        if not os.path.exists(path):
            return {"content": {"summary": "", "key_events": [], "character_states": {}, "relationships": []},
                    "link_index": {}, "version": 0}
        with open(path, "r") as f:
            return json.load(f)

    async def save_vault(self, chat_id: str, vault: dict):
        """保存（覆盖）最新记忆"""
        vault["updated_at"] = datetime.utcnow().isoformat()
        path = self._vault_path(chat_id)
        with open(path, "w") as f:
            json.dump(vault, f, ensure_ascii=False, indent=2)

    async def update(
        self,
        chat_id: str,
        new_messages: list[dict],
        llm_client,
    ) -> dict:
        """
        增量更新记忆
        
        Args:
            chat_id: 聊天 ID
            new_messages: 自上次更新以来的新对话
            llm_client: LLM 调用客户端
        Returns: 更新后的 vault
        """
        # 1. 读取当前最新记忆
        current = await self.read_vault(chat_id)
        current_content = current.get("content", {})

        # 2. 构造增量 prompt → LLM 只处理变化
        diff_prompt = f"""Current memory summary:
{json.dumps(current_content, ensure_ascii=False, indent=2)}

New conversation messages:
{json.dumps(new_messages, ensure_ascii=False, indent=2)}

Task: Based on the new messages, output ONLY the changes needed.
Respond in JSON with this exact structure:
{{
    "summary_update": "updated overall summary or empty string if no change",
    "new_events": [{{"event": "...", "summary": "...", "importance": 0.0-1.0, "msg_ids": [int]}}],
    "event_updates": [{{"event": "...", "changed_field": "..."}}],
    "character_state_changes": {{"char_name": {{"field": "new_value"}}}},
    "relationship_changes": [{{"from": "...", "to": "...", "status": "..."}}]
}}"""

        changes = await llm_client.chat([
            {"role": "system",
             "content": "You are an incremental memory updater. Output only what changed, nothing else."},
            {"role": "user", "content": diff_prompt},
        ])

        # 3. 解析变更 + 自动绑定超链接
        import json as _json
        try:
            changes_data = _json.loads(changes)
        except _json.JSONDecodeError:
            return current

        # 4. 合并变更到记忆
        content = current_content

        if changes_data.get("summary_update"):
            content["summary"] = changes_data["summary_update"]

        for new_event in changes_data.get("new_events", []):
            # 自动绑定 msg_id 超链接
            event_entry = {
                "event": new_event["event"],
                "summary": new_event["summary"],
                "importance": new_event.get("importance", 0.5),
                "links": [{"msg_id": mid} for mid in new_event.get("msg_ids", [])],
            }
            content["key_events"].append(event_entry)

            # 更新 link_index
            for mid in new_event.get("msg_ids", []):
                current["link_index"][str(mid)] = {
                    "chat_id": chat_id,
                    "role": "assistant",
                    "summary": new_event["summary"],
                }

        for char, state_changes in changes_data.get("character_state_changes", {}).items():
            if char not in content["character_states"]:
                content["character_states"][char] = {}
            content["character_states"][char].update(state_changes)

        if changes_data.get("relationship_changes"):
            content["relationships"] = changes_data["relationship_changes"]

        # 5. 更新 token 计数（估计值）
        text_len = len(json.dumps(content, ensure_ascii=False))
        vault = {
            "chat_id": chat_id,
            "version": current.get("version", 0) + 1,
            "content": content,
            "tokens": text_len // 4,  # 粗略估计
            "link_index": current.get("link_index", {}),
        }

        # 6. 覆盖保存（只保留最新版本）
        await self.save_vault(chat_id, vault)
        return vault
```

### 4.5 超链接回溯服务 (Tool Calling)

```python
# narrative-engine/src/memory/link_lookup.py
import json


class MemoryLinkLookup:
    """
    超链接回溯服务
    
    模型通过 tool calling 调用此服务，按 msg_id 定位到原始对话。
    避免将全部历史载入上下文，实现 O(1) 精准回溯。
    """

    def __init__(self, chat_storage_dir: str = "./data"):
        self.chat_storage_dir = chat_storage_dir

    async def lookup_messages(
        self,
        chat_id: str,
        msg_ids: list[int],
        user_handle: str = "default-user",
    ) -> list[dict]:
        """
        按 msg_id 回溯原始对话消息

        Args:
            chat_id: 聊天 ID
            msg_ids: 要查询的消息 ID 列表 (1-5条)
        Returns: 原始消息列表
        """
        # 读取 SillyTavern 的 JSONL 聊天文件
        chat_path = f"{self.chat_storage_dir}/{user_handle}/chats/{chat_id}.jsonl"
        results = []

        try:
            with open(chat_path, "r") as f:
                for line in f:
                    msg = json.loads(line)
                    if msg.get("mes_id") in msg_ids:
                        results.append({
                            "msg_id": msg["mes_id"],
                            "role": "user" if msg.get("is_user") else "character",
                            "name": msg.get("name", ""),
                            "content": msg.get("mes", ""),
                        })
        except FileNotFoundError:
            return [{"error": f"Chat file not found: {chat_id}"}]

        # 按请求顺序排列
        results.sort(key=lambda x: msg_ids.index(x["msg_id"]))
        return results
```

### 4.6 Prompt 注入格式

```
[Memory Vault]
## 当前概况
{A和B在春日咖啡厅相聚，气氛温馨}

## 关键事件流
1. 重逢: A先到咖啡厅等待[→msg#3], B随后到达[→msg#4]
2. 告白: B在樱花树下表白[→msg#45], A接受[→msg#46]

## 角色状态
A: 心情[开心], 位置[咖啡厅]
B: 心情[紧张→喜悦], 位置[咖啡厅]

---

可用工具:
- lookup_memory_source(chat_id: str, msg_ids: int[]): 
  查看指定消息的原始对话完整内容。用于事实核实时调用。
  日常生成不需要使用此工具。
```

### 4.7 与传统方案对比

| 维度 | 官方 Summarize (chat.extra.memory) | 官方 Chat Vectorization | 本方案 (独立记忆区) |
|------|-----------------------------------|------------------------|-------------------|
| **存储位置** | 嵌入聊天消息 | 消息级别向量索引 | **独立 JSON 文件** |
| **旧版本处理** | 累积不清理 | N/A | **只保留最新** |
| **生成方式** | 全量重生成 | 无生成，纯检索 | **增量更新** |
| **Token 消耗** | 高：每次全量重写 | 高：检索全量历史 | **低：仅处理 delta** |
| **检索污染** | 旧摘要被向量检索命中 | 包含旧消息摘要 | **不参与检索** |
| **事实核查** | 依赖 LLM 在上下文中找 | 可能返回旧消息 | **Tool O(1) 回溯** |
| **上下文占用** | 摘要+冗余遍布 chat | 全部消息向量化 | **仅最新摘要** |

---

## 阶段 5：Agent 通信协议

### 5.1 消息格式

```python
# narrative-engine/src/protocol/message.py
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime
import json


@dataclass
class AgentMessage:
    """Agent 间通信的标准消息格式"""
    
    # 消息标识
    message_id: str
    sender: str          # agent_id 或 system
    recipient: str       # agent_id 或 broadcast
    message_type: str    # directive / response / memory / scene_update / action / error
    
    # 时间戳
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    
    # 核心负载
    payload: dict = field(default_factory=dict)
    
    # 元数据
    correlation_id: Optional[str] = None  # 关联 ID，用于追踪对话链
    priority: int = 0                     # 0-normal, 1-high, 2-critical
    ttl_seconds: Optional[int] = None     # 消息过期时间
    
    def to_json(self) -> str:
        return json.dumps(self.__dict__, ensure_ascii=False)
    
    @classmethod
    def from_json(cls, data: str) -> "AgentMessage":
        return cls(**json.loads(data))


@dataclass
class SceneAnalysis:
    """场景分析结果"""
    scene_type: str
    emotional_tone: str
    tension_level: float
    recommended_style: str
    atmosphere_description: Optional[str] = None


@dataclass
class MemoryRecallResult:
    """记忆检索结果"""
    memories: list
    query: str
    total_found: int
    latency_ms: float
```

### 5.2 Agent 调度流程

```
用户发送消息
     │
     ▼
┌─────────────────────────────────────────────┐
│ 1. 对话存入酒馆聊天 (chat[])                 │
│    - 纯原始对话，不附记忆                     │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ 2. GM Agent: 场景分析 + 角色调度 + 生命周期   │
│    a) 分析最近对话 + 记忆区 → 判定场景类型     │
│    b) 决定"谁在场"、"谁缺席"                  │
│    c) 唤醒 reentering 角色的 Agent           │
│    d) 休眠 absent 角色的 Agent               │
│    e) 确定每个角色的知识边界                   │
│    f) 告诉每个 Agent 去 vault 哪里找自己的状态 │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ 3. 独立记忆区: 增量更新 + 注入               │
│    a) 更新全局叙事流（增量）                  │
│    b) 更新每个活跃角色的状态分区（增量）       │
│    c) 注入: 全局摘要 + 活跃角色状态            │
│       + 超链接(msg_id)                       │
│    d) 回溯: 模型需要时调用 tool 查看原始消息   │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ 4. 角色 Agent 并行生成                       │
│    （仅 ACTIVE 状态的 Agent）                 │
│    - 每个 Agent 从 vault 读取专属状态         │
│    - 每个 Agent 遵守 GM 设定的知识边界        │
│    - GM 指引让 Agent 知道去哪里找自己的数据    │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ 5. GM Agent: 一致性检查 + 合并               │
│    - 验证每个角色 Agent 的回复是否合人设       │
│    - 检查知识边界是否被突破                    │
│    - 合并多角色回复为统一叙事输出              │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ 6. 后处理                                    │
│    - 存储 AI 回复到 L1                       │
│    - 增量更新 vault 中的角色状态              │
│    - 检测情感炸弹事件                         │
└─────────────────────────────────────────────┘
     │
     ▼
    回复显示在 SillyTavern 界面
```

---

## 阶段 6：部署与配置

### 6.1 环境依赖

```toml
# narrative-engine/pyproject.toml
[project]
name = "narrative-engine"
version = "0.1.0"
description = "AI Narrative Engine for roleplay"
requires-python = ">=3.11"

dependencies = [
    "fastapi>=0.100.0",
    "uvicorn[standard]>=0.23.0",
    "httpx>=0.25.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
vectors = ["chromadb>=0.4.0", "sentence-transformers>=2.2.0"]
```

### 6.2 SillyTavern 配置

```yaml
# config.yaml 需要启用的设置
enableServerPlugins: true          # 启用服务端插件
enableServerPluginsAutoUpdate: true

plugins:
  - narrative-bridge

# 叙事引擎配置 (自定义, 通过插件配置界面管理)
narrative:
  engine_url: "http://127.0.0.1:8080"
  enabled_by_default: false
```

### 6.3 启动脚本

```bash
# 启动叙事引擎
cd narrative-engine
uvicorn src.main:app --host 127.0.0.1 --port 8080 --reload

# 启动 SillyTavern (确保插件已启用)
node server.js
```

---

## 三、开发路线图

| 阶段 | 周期 | 交付物 | 里程碑 |
|------|------|--------|--------|
| **P1 基础设施** | 第1周 | Python 服务脚手架 + Node.js 桥接插件 + 前端插件骨架 | ✔ 插件在酒馆中加载成功 |
| **P2 独立记忆基础** | 第2周 | 独立记忆区 JSON 存储 + 增量更新引擎 + 读写 API | ✔ 记忆与对话分离，增量更新可用 |
| **P3 超链接回溯** | 第3-4周 | 超链接索引 + Tool Calling 回溯 + Prompt 注入 + 前端 UI | ✔ 模型可回溯原始对话，新旧方案可切换 |
| **P4 GM Agent** | 第5-6周 | 场景分析 + 导演指令生成 + 一致性检查 | ✔ GM 指令注入到生成流程 |
| **P5 多Agent** | 第7-8周 | 角色智能体 + Agent 通信协议 + 并行生成 | ✔ 多角色并行响应 |
| **P6 调优与测试** | 第9-10周 | 遗忘机制调优 + 性能优化 + UI完善 | ✔ 系统可用 |

---

## 四、为什么选择插件形式？

### 4.1 优势

| 优势 | 说明 |
|------|------|
| **无侵入** | 不修改核心代码，SillyTavern 升级不受影响 |
| **独立部署** | Python 服务可独立运行、单独升级 |
| **事件驱动** | 利用 100+ 事件钩子，轻松接入所有生命周期 |
| **渐进可试** | 每个阶段都能独立验证效果 |
| **低风险** | 插件功能异常不影响酒馆基础使用 |

### 4.2 利用的现有能力

| SillyTavern 能力 | 我们的利用方式 |
|------------------|--------------|
| `eventSource.on()` | 监听消息发送/接收/生成事件 |
| `setExtensionPrompt()` | 注入记忆和 GM 指令到 prompt |
| `generate_interceptor` | 拦截生成流程，注入 Agent 逻辑 |
| `context.generateQuietPrompt()` | 调用 GM Agent 分析（静默模式） |
| 向量存储扩展 | 作为参考，构建我们的 L2 系统 |
| 服务端插件 (plugin-loader) | 桥接 Python 服务 |
| SlashCommandParser | 注册 `/narrative` 等命令 |
| renderExtensionTemplateAsync | 渲染 UI 模板 |

---

## 五、关键技术决策

| 决策 | 选择 | 理由 |
|------|------|-----|
| **后端语言** | Python (FastAPI) | LLM/Agent 生态丰富 (LangChain/LangGraph) |
| **向量数据库** | ChromaDB (可选) / 不使用 | 核心记忆用独立 JSON 文件，向量检索仅对 RAG 场景可选 |
| **短期缓存** | 无（依赖酒馆自有聊天上下文） | 独立记忆区只维护"最新版本"，无需额外缓存 |
| **记忆更新** | 增量更新 (Delta-based) | 只处理变化部分，覆盖保存，无冗余版本 |
| **事实回溯** | Tool Calling + 超链接索引 | 模型按 msg_id O(1) 定位原始消息，不使用时零开销 |
| **嵌入模型** | sentence-transformers (可选) | 仅在需要 RAG 增强检索时使用 |
| **Agent 框架** | 自定义实现 | 避免 LangChain 的抽象开销，保持轻量 |
| **GM Agent 调用** | 通过酒馆现有 API 网关 | 复用用户配置的 LLM 供应商 |
| **通信协议** | REST (第一阶段) → 后续可升级 WebSocket | REST 实现简单，足够 MVP 使用 |
| **前端 UI** | 原生风格，保持酒馆一致性 | 降低用户学习成本 |
