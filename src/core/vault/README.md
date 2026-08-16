# src/core/vault — 记忆存储层

> 深度架构见 `CODE_WIKI.md` §3.5。**AI 编码约束见 [`.rules.md`](./.rules.md)，动工前必读**。

IndexedDB 记忆存储：CRUD、Delta 版本链、Schema 校验、检索过滤。**engine 只通过本层读写数据，不直接操作浏览器 API 细节**。

## 文件职责

| 文件 | 职责 |
|------|------|
| `store.js` | IndexedDB CRUD（`state_vaults` / `memory_vaults`）+ 迁移 + 模板/字段库；`DB_VERSION=8` |
| `state-versions.js` | 统一 Delta 版本链引擎（State/Memory 共用）：record/fold/rollback/compact |
| `schema.js` | 三层开放角色 Schema（必备/预设/自定义）+ 字段级校验 + dot-path 解析 |
| `template-defs.js` | 默认模板常量（`_default_pc`/`_default_npc`/faction/task/goal） |
| `retrieval-filter.js` | 检索候选过滤（BM25 打分等，消费方在 engine） |
| `garbage-collector.js` | 孤儿数据清理（按 chat 生命周期） |

## IndexedDB ObjectStore 清单

| Store | 说明 |
|-------|------|
| `state_vaults` | State 角色状态（keyPath `chat_id`） |
| `memory_vaults` | Memory（STM/LTM） |
| `state_deltas` / `memory_versions` | Delta 版本链 |
| `active_chains` | 活跃版本链元信息 |
| `card_configs` | 角色卡配置 |
| 旧 `vaults` / `snapshots` | 废弃（只读迁移兼容） |

## 关键约定

- **写入唯一入口**：管线内通过 engine 的 `update.js` 写数据，`store.js` 的底层 put 只被非管线路径（gc/tools）直接调用
- **版本链原则**：记忆生命周期 = 对话生命周期（删对话→物理删除；重掷→版本回退重提取），不回滚到已归档版本
- **迁移**：`DB_VERSION` 递增时必须写 `onupgradeneeded` 迁移 + 空数据早退（防挂起）

## 新增模块指引

1. Schema 字段增删 → 同步 `template-defs.js` + `schema.js` 校验 + CODE_WIKI §5.4
2. 新 store / DB_VERSION 变更 → 处理迁移与旧 store 残留
3. 新增纯函数（如版本链计算）→ 补 `test/*.test.js` 注册进 `test/run.mjs`
