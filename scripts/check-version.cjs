/**
 * scripts/check-version.cjs — 版本一致性校验
 *
 * 校验 manifest.json 版本号（唯一真源）与下列文件是否一致：
 *   package.json / dist/extension/manifest.json / src/adapter/index.js /
 *   CODE_WIKI.md / test6.X.json 系列 / README.md（安装 JSON + 兼容表）/ CHANGELOG.md（已发版块）
 *
 * 用法：npm run check:version   （或 node scripts/check-version.cjs）
 * 退出码：0 = 全部一致；1 = 存在不一致
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ── 1. 读取真源 ──
const manifest = JSON.parse(read('manifest.json'));
const fullVersion = manifest.version;               // 例 "7.2.0"
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(fullVersion);
if (!m) {
    console.error(`[FAIL] manifest.json version 格式非法: "${fullVersion}"（期望 MAJOR.MINOR.PATCH）`);
    process.exit(1);
}
const majorMinor = `${m[1]}.${m[2]}`;               // 例 "7.2"
const tag = `test${majorMinor}`;                    // 例 "test7.2"
const installerFile = `test${majorMinor}.json`;     // 例 "test7.2.json"

const failures = [];
const check = (label, ok, detail) => {
    if (!ok) failures.push({ label, detail });
};

// ── 2. JSON 版本字段 ──
const pkg = JSON.parse(read('package.json'));
check(`package.json version`, pkg.version === fullVersion, `期望 ${fullVersion}，实际 ${pkg.version}`);

if (exists('dist/extension/manifest.json')) {
    const distManifest = JSON.parse(read('dist/extension/manifest.json'));
    check(`dist/extension/manifest.json version`, distManifest.version === fullVersion,
        `期望 ${fullVersion}，实际 ${distManifest.version}`);
} else {
    check(`dist/extension/manifest.json 存在`, false, '文件不存在（先运行 npm run build:all）');
}

// ── 3. 源码/文档中的版本字符串 ──
const indexJs = read('src/adapter/index.js');
const idxMatch = /NE v\d+\.\d+\.\d+/.exec(indexJs);
check(`src/adapter/index.js 版本字符串`, idxMatch && idxMatch[0] === `NE v${fullVersion}`,
    idxMatch ? `期望 NE v${fullVersion}，实际 ${idxMatch[0]}` : `未找到 "NE v..."`);

const codeWiki = read('CODE_WIKI.md');
const wikiMatch = /版本：v\d+\.\d+\.\d+/.exec(codeWiki);
check(`CODE_WIKI.md 版本行`, wikiMatch && wikiMatch[0] === `版本：v${fullVersion}`,
    wikiMatch ? `期望 版本：v${fullVersion}，实际 ${wikiMatch[0]}` : `未找到 "版本：v..."`);

// ── 4. 安装器 JSON（test6.X.json）──
if (exists(installerFile)) {
    const installer = JSON.parse(read(installerFile));
    const content = installer.content || '';
    const info = installer.info || '';
    const name = installer.name || '';
    const tagCount = (content.match(new RegExp('@' + tag.replace(/\./g, '\\.'), 'g')) || []).length;
    check(`${installerFile} name 含 v${majorMinor}`, name.includes(`v${majorMinor}`),
        `期望 name 含 "v${majorMinor}"，实际 name: ${name}`);
    check(`${installerFile} content 含 @${tag} ×2`, tagCount === 2,
        `期望 @${tag} 出现 2 次，实际 ${tagCount} 次`);
    check(`${installerFile} info 含 v${majorMinor}`, info.includes(`v${majorMinor}`),
        `期望 info 含 "v${majorMinor}"，实际 info: ${info}`);
} else {
    check(`${installerFile} 存在`, false, `文件不存在（发版需新建 ${installerFile}）`);
}

// ── 5. README.md（内嵌安装 JSON + 兼容表）──
const readme = read('README.md');
const readmeTagCount = (readme.match(new RegExp('@' + tag.replace(/\./g, '\\.'), 'g')) || []).length;
check(`README.md 含 @${tag} ×2`, readmeTagCount === 2, `期望 @${tag} 出现 2 次，实际 ${readmeTagCount} 次`);
check(`README.md 含 v${majorMinor}`, readme.includes(`v${majorMinor}`),
    `未找到 "v${majorMinor}"`);
const compatRow = new RegExp('\\| v' + majorMinor.replace(/\./g, '\\.') + ' \\|').test(readme);
check(`README.md 兼容表含 | v${majorMinor} |`, compatRow, `未找到兼容表行 "| v${majorMinor} |"`);

// ── 6. CHANGELOG.md（已发版块；Unreleased 期跳过）──
const changelog = read('CHANGELOG.md');
const releasedBlock = `# NE-Memory v${fullVersion} 更新日志`;
if (changelog.trim().startsWith('# NE-Memory Unreleased')) {
    // Unreleased 期：发版前无版本块，跳过（不算失败）
    console.log('[SKIP] CHANGELOG 处于 Unreleased 期，跳过版本块检查');
} else {
    check(`CHANGELOG.md 含 "${releasedBlock}"`, changelog.includes(releasedBlock),
        `未找到 "${releasedBlock}"`);
}

// ── 7. 汇总输出 ──
if (failures.length > 0) {
    console.error(`[FAIL] 版本一致性校验未通过（真源 v${fullVersion} / tag ${tag}）：`);
    failures.forEach((f) => console.error(`  [FAIL] ${f.label} → ${f.detail}`));
    process.exit(1);
}
console.log(`✓ 版本一致性校验通过：v${fullVersion}（tag ${tag}）`);
