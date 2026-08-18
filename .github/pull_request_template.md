### 变更摘要

### 变更类型

- [ ] 新功能
- [ ] 性能优化
- [ ] Bug 修复

### 发版文件检查

本 PR 是否涉及以下文件的更新：

- [ ] `package.json` version
- [ ] `manifest.json` version
- [ ] `dist/extension/manifest.json` version
- [ ] `CHANGELOG.md`
- [ ] `README.md` 版本引用（CDN tag、兼容表）
- [ ] `CODE_WIKI.md` 版本行
- [ ] `src/adapter/index.js` 版本号
- [ ] 新建 `test6.x.json`

> 版本号更新规则详见 [release-rules.md](.trae/rules/release-rules.md)。

### 测试验证

- [ ] `npm test` 全部通过
- [ ] 新增功能有对应的测试用例

### 检索 / 评测回归闸门

本 PR 是否触及检索核心（`retrieval*` / `retrieval-fusion` / `bm25*` / `embedding` / `stm-pipeline` 抽取后处理 / `modality-resolve`）？

- [ ] **是** → 已重跑权威配置 benchmark（dev split），报告带版本四元组，与 `canonical-numbers.md` §2.5/§7.5 对比无口径漂移；结论（含措辞标签）已登记
- [ ] **否** → 无需重跑（本 PR 未触及检索/抽取管线）
- [ ] 若改动涉 LLM 判定路径，报告已含 judge 模型 / temperature / 是否重试的 LLM 非确定性声明

> 规则：改动即触发；未重跑不得合入。权威数字登记于 `test/retrieval-benchmark/output/canonical-numbers.md`（§2.5 检索主表 / §7.5 抽取臂）；流程见 `.trae/documents/benchmark-improvement-plan.md` §回归闸门与 §13 关系。

### 截图 / 日志

（如有 UI 变化，请附截图）
