// commitlint 配置 — 类型白名单与 NE-Memory 提交体系对齐
// package.json 为 "type": "module"，故用 .cjs 保证 CJS 加载
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'perf', 'refactor', 'docs', 'test',
      'build', 'ci', 'chore', 'style', 'revert',
      'release', 'dev-build',   // 发版流程前缀（release-rules Step 4 / Step 6 / publish-extension）
    ]],
    'subject-case': [0],        // 允许中英混合主题（默认规则对中文 subject 可能误判）
  },
};
