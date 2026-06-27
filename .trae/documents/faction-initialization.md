# 势力一次性预载 + 关键词激活 — 状态：已实现，待构建部署

## 目标

将世界书中的势力信息在对话初始化时一次性提取到 state 中，后续不再每轮注入世界书原文。势力默认隐藏，仅在对话中被提及时通过关键词匹配激活。

## 最终决策：方案 A

**势力提取合并进 `resolveNpcSchemes` 的同一次 LLM 调用。** 该调用本就通过 `collectWorldBookContent_raw()` 接收全量世界书数据（所有条目，不做 key-match 过滤），追加 faction 输出在输入端上不造成任何额外负担。

一次 LLM 响应同时输出三个字段：`schemes` + `initial_characters` + `factions`。之后 `npc_schemes` 已存在 → `resolveNpcSchemes` 直接 return → 不再触发。

## 数据流

```
首轮 → extractStateChangesOnly()
  ├── resolveNpcSchemes(vault, chatId, messages)   ← 仅首次（npc_schemes 不存在时）
  │     ├── collectWorldBookContent_raw() → 全量世界书条目（不过滤）
  │     ├── buildSchemeDiscoveryPrompt()            ← prompt 中已追加势力提取指令 #3
  │     ├── callMemoryPipeline() → LLM 调用 #1
  │     └── 解析: schemes + initial_characters + factions
  │           └── 写入 state.factions（全部 _hidden: true）
  │           └── 写入 vault.content.faction_keywords
  │           └── 设置 vault.content._factions_extracted = true
  │
  └── buildStatePrompt_Preset + callMemoryPipeline() → LLM 调用 #2（State 提取）
        └── rulesZh/En 已包含 factions 管理指令

第二轮起：
  ├── resolveNpcSchemes → npc_schemes 已存在 → return（跳过）
  ├── scanMessageForFactions(scanText, faction_keywords, state)  ← 纯 indexOf
  │     → 匹配到关键词 → faction._hidden = false
  └── State LLM 每轮运行，势力管理指令生效
```

## 实现清单（全部完成）

### 文件一：[src/core/engine/update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

| 项目 | 位置 | 状态 |
|------|------|------|
| `buildSchemeDiscoveryPrompt` 追加 task #3 势力提取指令 + JSON 输出格式 | L1345+ | ✅ |
| `resolveNpcSchemes` 解析 `parsed.factions` 并写入 `state.factions`（`_hidden: true`） | L1530-1565 | ✅ |
| `resolveNpcSchemes` 写入 `faction_keywords` + `_factions_extracted` 标记 | L1548-1549 | ✅ |
| `buildFactionKeywords()` 函数 | L964-L975 | ✅ |
| `scanMessageForFactions()` 函数 | L977-L996 | ✅ |
| `extractStateChangesOnly` 调用 `scanMessageForFactions` | L1601-L1605 | ✅ |
| `buildStatePrompt_Preset` rulesEn 追加 factions 指令 | L1023-L1024 | ✅ |
| `buildStatePrompt_Preset` rulesZh 追加 factions 指令 | L1040-L1041 | ✅ |

### 文件二：[src/core/vault/schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js)

| 项目 | 位置 | 状态 |
|------|------|------|
| `DEFAULT_GLOBAL_SCHEMA.factions` 新增 `_hidden` 字段 | L153 | ✅ |
| `DEFAULT_FACTION_SCHEMA` 新增 `_hidden` 字段 | L245 | ✅ |
| `buildStateInjectionTable` 过滤 `_hidden: true` 势力，仅注入可见势力 | L693-718 | ✅ |

### 文件三：[src/adapter/panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js)

| 项目 | 位置 | 状态 |
|------|------|------|
| `.ne-faction-card.ne-faction-hidden` CSS 样式 | L221-222 | ✅ |
| `renderFactionCard` 读取 `isHidden`、设置 `cardCls` | L701-702 | ✅ |
| `renderFactionPanelHTML` 渲染所有势力（含隐藏） | L744-761 | ✅ |
| `factionCount` 统计（全部势力） | L1074 | ✅ |
| `renderQuickIndex` 势力数量显示 | L368-381 | ✅ |

## 待执行

- [ ] **`npm run build`** — 源码改动尚未构建到 `dist/`

## 验证清单

1. 新建含势力世界书的聊天 → 首轮后 `state.factions` 非空、全部 `_hidden: true`
2. 对话中首次提到某势力 → 控制台 `[NE] Faction activated: xxx matched: xxx`
3. `buildStateInjectionTable` 注入文本不含未激活势力
4. State Board UI 显示所有势力，未激活灰色（opacity 0.55）
5. State LLM 在势力激活后可更新其 attitude/notes
6. 第二轮起 `resolveNpcSchemes` 直接 return，不额外调用

## 设计决策记录

- **为什么合并进 `resolveNpcSchemes` 而非新增独立 LLM 调用**：该调用本就接收全量世界书数据，合并零额外输入负担、零额外 API 调用。
- **为什么用全量世界书 (`collectWorldBookContent_raw`) 而非 key-match (`collectWorldBookContent`)**：key-match 依赖首条用户消息中的名称匹配，无法保证覆盖所有势力条目；全量版本始终返回所有条目，适合一次性提取。
- **为什么用 `indexOf` 而非 LLM 做关键词激活**：无延迟、零成本、每轮自动重试（漏激活不永久丢失），误激活代价低（State LLM 后续自判是否需要更新）。
- **为什么未激活势力仍渲染但灰色显示**：用户可见完整势力列表，了解世界设定；透明度区分"已知但未接触"与"已接触"。
