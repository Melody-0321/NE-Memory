# src/core/test-runner — 自动化测试框架

> 深度架构见 `CODE_WIKI.md` §3.6 / §8（测试体系）。

NE 自研的轻量测试框架：驱动 `test-cases/` 下的集成用例在真实浏览器环境跑批，用于冒烟测试与回归验证。

## 文件职责

| 文件 | 职责 |
|------|------|
| `assertions.js` | 断言工具集（结构化断言/错误分类） |
| `files.js` | 测试文件/用例目录遍历与定位 |
| `monitor.js` | 运行监控（截图/日志/超时捕获） |
| `test-data.generated.js` | **生成文件**：`npm run build` 时由 `scripts/generate-test-data.cjs` 从 `test-cases/` 生成（29 个用例的映射表），勿手改 |

## 工作方式

1. `scripts/generate-test-data.cjs` 扫描 `test-cases/**/`（pipeline / retrieval / smoke）生成用例清单到 `test-data.generated.js`
2. `test-runner.js`（adapter 侧）在浏览器里按清单执行用例
3. 单元测试侧（`test/*.test.js`）不经本框架，走 Node 直接 import（见 `test/run.mjs`）

## 如何新增集成测试用例

1. 在 `test-cases/` 对应目录新建用例目录（带 `test-case.md` 前置说明）
2. 重新 `npm run build`（或 `build:dev:all`）让生成脚本收录
3. 确认 `test-data.generated.js` 出现新用例条目，冒烟测试覆盖到它

> 本目录不参与生产路径，也不计入覆盖率门禁（`.c8rc.json` 已排除）。
