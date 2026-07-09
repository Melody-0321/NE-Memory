const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, '.trae', 'documents');
const statusLabels = {
  completed: '✅ 已完成',
  in_progress: '🔄 进行中',
  not_started: '⏳ 未开始',
  abandoned: '❌ 已废弃',
};

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const fm = {};
  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

function getTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '(无标题)';
}

const files = fs.readdirSync(docsDir)
  .filter(f => f.endsWith('.md') && f !== 'INDEX.md')
  .sort();

const rows = [];
let completed = 0, inProgress = 0, notStarted = 0, unknown = 0;

for (const file of files) {
  const filePath = path.join(docsDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const fm = parseFrontmatter(content);
  const title = getTitle(content);

  const status = fm && fm.status ? fm.status : 'unknown';
  const label = statusLabels[status] || '❓ 未知';
  const created = fm && fm.created ? fm.created : '—';
  const updated = fm && fm.updated ? fm.updated : '—';

  rows.push({ file, title, status, label, created, updated });

  if (status === 'completed') completed++;
  else if (status === 'in_progress') inProgress++;
  else if (status === 'not_started') notStarted++;
  else unknown++;
}

const total = rows.length;
const now = new Date().toISOString().slice(0, 10);

const md = [
  '# 计划文档索引',
  '',
  `> 自动生成 | ${now} | ${total} 个文档 | ${(completed / total * 100).toFixed(0)}% 完成`,
  '',
  `| 文件 | 状态 | 创建 | 最后更新 | 标题 |`,
  `|------|------|------|---------|------|`,
];

for (const r of rows) {
  md.push(`| \`${r.file}\` | ${r.label} | ${r.created} | ${r.updated} | ${r.title} |`);
}

md.push('');
md.push('---');
md.push('');
md.push('所有文件位于 `.trae/documents/`。在文件树中定位该目录即可查看。');
md.push('');
md.push(`### 统计`);
md.push(`- ✅ 已完成：${completed}`);
md.push(`- 🔄 进行中：${inProgress}`);
md.push(`- ⏳ 未开始：${notStarted}`);
md.push(unknown > 0 ? `- ❓ 未标记：${unknown}` : '');

const content = md.join('\n') + '\n';

const indexPath = path.join(docsDir, 'INDEX.md');
fs.writeFileSync(indexPath, content, 'utf-8');

const planIndexPath = path.join(root, 'PLAN_INDEX.md');
fs.writeFileSync(planIndexPath, content, 'utf-8');

console.log(`[build-doc-index] INDEX.md + PLAN_INDEX.md generated (${completed}/${total} completed)`);
