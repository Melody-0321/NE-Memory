# panel.js 拆分验证与收尾计划

## 当前状态

上一轮对话中已经完成 `panel.js`（3020 行）按 UI 区域拆分为 **9 个 split 文件 + 1 个 barrel**：

| 文件 | 行数 | 职责 |
|------|------|------|
| `panel.js`（barrel） | 4 | 4 个外部导出统一入口 |
| `panel-shared.js` | ~310 | DOM 工具、CSS 注入器、共享状态变量、closeVaultOverlay |
| `panel-drawer.js` | ~200 | 折叠面板状态、手风琴切换、标签切换、快速索引、保存/删除条目 |
| `panel-state-cards.js` | ~666 | 角色/阵营/任务卡片渲染器、编辑模式、renderMemoryTable |
| `panel-popout.js` | ~80 | createVaultPopout、toggleVaultPanel、renderHistory |
| `panel-content.js` | ~275 | updateVaultViewerPopout（主内容更新函数） |
| `panel-init.js` | ~545 | renderVaultPanel（主面板初始化） |
| `panel-tools.js` | ~250 | 测试运行器工具 |
| `panel-usage.js` | ~205 | 使用量统计图表 |
| `panel-settings.js` | ~430 | 设置标签页 |
| `panel-entities.js` | ~120 | 实体管理标签页 |

**编译验证：** `npm run build` exit 0 ✅

## 剩余验证步骤

### Step 1: 运行测试
```bash
npm test
```
目标：22 个单元测试 + 3 个 ratchet 全部通过

### Step 2: 清理临时脚本
- `scripts/extract-panel.cjs` — 提取脚本，已无需保留
- `scripts/add-exports.cjs` — export 补充脚本，已无需保留

### Step 3: 保留/删除备份
- `panel.js.bak` — 备份文件，建议保留 1-2 周确保稳定后再删除

## 文件依赖关系

```
panel.js (barrel)
  ├── panel-shared.js ─────────────── 基础工具 + 共享状态
  ├── panel-state-cards.js ────────── 卡片渲染器
  ├── panel-popout.js ─────────────── 弹出窗口
  │     ├── panel-shared.js
  │     ├── panel-init.js
  │     └── panel-content.js
  ├── panel-init.js ───────────────── 主入口初始化
  │     ├── panel-shared.js
  │     ├── panel-drawer.js
  │     ├── panel-state-cards.js
  │     ├── panel-popout.js
  │     ├── panel-content.js
  │     ├── panel-tools.js
  │     ├── panel-usage.js
  │     ├── panel-settings.js
  │     └── panel-entities.js
  └── (panel-content.js) ──────────── 内容更新
        ├── panel-shared.js
        ├── panel-drawer.js
        └── panel-state-cards.js
```

**无循环依赖** ✅（所有依赖方向为 shared → other components → init，单向流动）
