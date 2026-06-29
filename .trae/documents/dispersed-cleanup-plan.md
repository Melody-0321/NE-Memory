# 散列叙事线残留清理

## 摘要

上次会话已完成散列叙事线（note_thread / dispersed thread）核心实现的移除，但遗留 2 处残存引用。本次清理 + 重新验证。

## 当前状态

- `injection.js`: noteThreadTool / noteThreadExecutor **已移除** ✅
- `retrieval-notebook.js`: addDispersedThread **已移除** ✅
- `retrieval.js`: D: 前缀渲染逻辑 **已移除** ✅，EN prompt 已不含 D: ✅
- 单元测试、ratchet、build 上次已验证通过 ✅

## 残存引用（2 处）

| # | 文件 | 行 | 内容 | 处理 |
|---|------|-----|------|------|
| 1 | `src/types.js` | 223 | `@property {'entity_chain'\|'dispersed'} type` | 改为 `@property {'entity_chain'} type` |
| 2 | `src/core/engine/retrieval.js` | 629 | ZH prompt 中 `, {D:标签#位置/总数} = 散列叙事线` | 删除该片段，与 EN prompt 对齐 |

## 验证步骤

1. `npm test` — 24 单元测试 + 3 ratchets
2. `npm run build` — test-data 再生 + Rollup 构建
