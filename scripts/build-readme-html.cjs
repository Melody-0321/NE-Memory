const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

const readmeMd = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');

marked.setOptions({ mangle: false, headerIds: false });
const bodyHtml = marked.parse(readmeMd);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NE Memory Engine v${version} — 让 AI 永远记得住</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    line-height: 1.75;
    color: #222;
    max-width: 860px;
    margin: 0 auto;
    padding: 30px 24px 80px;
    background: #fff;
  }
  h1 { font-size: 1.8em; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.35em; margin-top: 0; }
  h2 { font-size: 1.35em; margin-top: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.25em; }
  h3 { font-size: 1.1em; margin-top: 1.5em; }
  p { margin: 1em 0; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
  ul, ol { padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  code { background: #f6f8fa; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.92em; }
  pre { background: #f6f8fa; border-radius: 6px; padding: 14px 18px; overflow-x: auto; font-size: 0.88em; line-height: 1.5; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d8dee4; padding: 8px 14px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  strong { color: #111; }
  .tagline { font-size: 1.15em; color: #555; margin-bottom: 2em; font-style: italic; }
  .tagline + p { margin-top: 0; }

  details { border: 1px solid #d8dee4; border-radius: 6px; margin: 0.8em 0; }
  summary { background: #f6f8fa; padding: 8px 14px; cursor: pointer; font-weight: 500; border-radius: 6px; }
  details[open] summary { border-radius: 6px 6px 0 0; }
  details .details-body { padding: 10px 18px 14px; }

  .json-block { background: #f6f8fa; border-radius: 6px; padding: 14px 18px; overflow-x: auto; }
  .json-block pre { margin: 0; background: none; padding: 0; }

  @media (prefers-color-scheme: dark) {
    body { background: #0d1117; color: #c9d1d9; }
    h1 { border-color: #30363d; }
    h2 { border-color: #21262d; }
    hr { border-color: #21262d; }
    a { color: #58a6ff; }
    code { background: #161b22; }
    pre { background: #161b22; }
    th, td { border-color: #30363d; }
    th { background: #161b22; }
    .json-block { background: #161b22; }
    details { border-color: #30363d; }
    summary { background: #161b22; }
    strong { color: #e6edf3; }
    .tagline { color: #8b949e; }
    .json-block pre, .json-block pre code { background: none; }
    .gh-badge { background: #21262d; border-color: #30363d; color: #c9d1d9; }
  }
</style>
</head>
<body>

<h1>NE Memory Engine v${version} — 让 AI 永远记得住</h1>

<p style="margin:0 0 1em 0;">
  <a href="https://github.com/Melody-0321/NE-Memory" class="gh-badge" style="display:inline-block;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:2px 12px;font-size:0.85em;color:#24292f;text-decoration:none;">
    <span style="display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:6px;background:currentColor;mask-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z%22/></svg>');-webkit-mask-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z%22/></svg>');mask-size:contain;-webkit-mask-size:contain;"></span>
    GitHub · Melody-0321/NE-Memory
  </a>
</p>

${bodyHtml.replace(/^<h1[^>]*>.*?<\/h1>\s*/s, '')}

</body>
</html>
`;

fs.writeFileSync(path.join(root, 'README.html'), html, 'utf-8');
console.log('[build-readme-html] README.html generated (v' + version + ')');
