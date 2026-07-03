# NE-Memory v6.1 更新日志

## 架构升级

- **Shadow DOM 全面适配** — CSS 变量重注入机制、:host 选择器覆盖层、panelById/panelQS 全量替换 byId/qs，面板在 iframe 隔离环境中样式完整可用
- **4 面板统一滚动架构** — 发现并修复了 settings/usage 面板被多余的 `.ne-settings-scroll` 包装层和多出的一个 `</div>` 提前关闭滚动容器的布局 bug，所有面板共享同一滚动逻辑，内容对齐正确

## Bug 修复

- **管线守卫死锁导致 STM 永不整合** — 移除 STM pipeline 中的 transitionTo，整合按钮/processHistory 正确 acquire/release guard
- **整合循环被空 STM 堵死** — createMinimalLtm 不再卡空事件，始终返回有效决策
- **编辑/删除记忆报错** — 补回 panel-drawer.js 遗漏的 write import
- **LTM force-close prompt 注入修复** + placeholder 文本区分

## UI 改进

- **管线状态去重** — 副 API 和向量搜索标题栏显示绿色小圆点，移除引擎区和检索区的重复文本
- **统计面板重设计** — 弃用总计统计，改为对话-今日-本月三栏卡片布局
- **每日趋势图** — 全月 x 轴堆叠柱状图，支持 tooltip
- **面板视觉润色** — 标题重命名、版本号下沉、设置 accordion 默认闭合、ToS 确认存档
- **滑块原生样式** — Shadow DOM 内定制 -webkit-slider-thumb/-moz-range-track，匹配 ST 原生外观
- **综合无障碍适配** — aria-label 覆盖、键盘导航、PC/NPC 标签、搜索过滤、触控反馈

## 文档与项目卫生

### README.md 全面重写

参照 Baibai（柏宝书）的 Readme 最佳实践，将 README 从"开发者笔记"改写为"用户产品页"：

- **开场共鸣**：新增痛点描述 + 价值主张，让路过的用户第一段就知道"这个工具能解决我的什么问题"
- **功能分组**：原来的 12 个扁平技术列表 → 6 组场景化分组，去掉内部参数噪音（k1=1.5、b=0.75、α=0.20 等）
- **安装指引内嵌化**：安装 JSON 折叠到 `<details>` 标签；首次配置简化为单步配副 API 即用（SmartPush 始终在线）
- **配置指南重写**：替换为实际 UI 中的 9 个真实设置项，移除已删除的开关（Smart Context Injection、State Extraction、Contradiction Detection、Retrieval API 等），补充 Dialog Window Rounds、Memory Budget、Schema Editors 等
- **FAQ 章节**：5 个常见问题（副 API 连不上 / Token 消耗大 / 面板打不开 / 数据存储位置），内嵌化存储位置表格
- **更新说明内嵌**：版本兼容表、CDN 更新方式、数据迁移说明均在 Readme 内自足
- **删除 Tool-calling 章节**（v6.0 中已停用）
- **删除内建测试框架章节**（用户不需要）
- **删除「与 SP 记忆库的关系」章节及 FAQ 条目**

### CODE_WIKI.md 清理

- 删除 §3.4.23 worldbook-sync.js 整个小节 + 架构图中对应条目
- 后续小节编号前移

### AGENTS.md 清理

- 中风险模块列表中删除 worldbook-sync

### .gitignore 扩充

新增 7 组忽略规则：
- `.trae/` — AI 助手工作文件
- `*.bak` / `_old_*.js` — 重构备份
- test artifacts（report / trace / postmortem / generated data）
- `dist/test-harness.js` / `dist/th-test.js` — 测试用 dist 文件
- `scripts/extract-precise.cjs` — 一次性脚本
- `testv4.*.json` / `test5.*.json` — 旧版测试配置
