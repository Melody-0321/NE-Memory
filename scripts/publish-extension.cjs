/**
 * scripts/publish-extension.cjs — 构建插件并推送到 release 制品分支
 */
const { execSync } = require('child_process');
const { copyFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join, resolve } = require('path');
const os = require('os');

const PROJECT_ROOT = resolve(__dirname, '..');
const RELEASE_BRANCH = 'release';
const DIST_DIR = join(PROJECT_ROOT, 'dist', 'extension');
const MANIFEST = join(PROJECT_ROOT, 'manifest.json');
const TMP_DIR = join(os.tmpdir(), 'ne-extension-publish-' + Date.now());

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            stdio: opts.silent ? 'pipe' : 'inherit',
            ...opts
        });
    } catch (e) {
        console.error('[FAIL] 命令失败: ' + cmd);
        if (opts.noExit) throw e;
        process.exit(1);
    }
}

function info(msg) { console.log('[INFO] ' + msg); }
function ok(msg) { console.log('[OK]   ' + msg); }
function warn(msg) { console.warn('[WARN] ' + msg); }

// ── Step 1 ──
info('Step 1/5: 检查环境...');
const currentBranch = run('git rev-parse --abbrev-ref HEAD', { silent: true }).trim();
const originalHead = run('git rev-parse HEAD', { silent: true }).trim();

if (currentBranch === RELEASE_BRANCH) {
    console.error('[FAIL] 当前位于 release 分支，禁止在产物分支上执行发布。');
    process.exit(1);
}
try { run('git show-ref --verify --quiet refs/heads/' + RELEASE_BRANCH, { silent: true }); } catch (e) {
    console.error('[FAIL] 本地 release 分支不存在。');
    process.exit(1);
}
if (!existsSync(MANIFEST)) { console.error('[FAIL] manifest.json 不存在'); process.exit(1); }
const version = process.argv[2] || require(MANIFEST).version;
info('版本号: ' + version);
ok('环境检查通过');

// ── Step 2: Stash + 构建 ──
info('Step 2/5: 构建插件 (extension 模式)...');
try {
    execSync('git stash push --include-untracked --message "publish-stash"', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
    info('已 stash 本地改动（含未跟踪文件）');
} catch (e) {}

info('构建中...');
run('npx cross-env BUILD_MODE=extension npx rollup -c');

const distIndex = join(DIST_DIR, 'index.js');
const distManifest = join(DIST_DIR, 'manifest.json');
if (!existsSync(distIndex)) { console.error('[FAIL] 缺少 ' + distIndex); process.exit(1); }
if (!existsSync(distManifest)) { console.error('[FAIL] 缺少 ' + distManifest); process.exit(1); }
ok('构建完成: index.js (' + require('fs').statSync(distIndex).size + ' bytes)');

// 恢复 stash（获取原始代码状态用于后续切回）
try { execSync('git stash pop', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' }); } catch (e) {}

// ── Step 3: 备份产物 ──
info('Step 3/5: 备份产物...');
mkdirSync(TMP_DIR, { recursive: true });
copyFileSync(distIndex, join(TMP_DIR, 'index.js'));
copyFileSync(distManifest, join(TMP_DIR, 'manifest.json'));
ok('已备份');

// ── Step 4: 更新 release 分支 ──
info('Step 4/5: 切换到 release 分支...');
run('git checkout -f ' + RELEASE_BRANCH);
ok('已切换到 ' + RELEASE_BRANCH);

info('Step 5/5: 覆盖产物并推送...');
copyFileSync(join(TMP_DIR, 'index.js'), join(PROJECT_ROOT, 'index.js'));
copyFileSync(join(TMP_DIR, 'manifest.json'), join(PROJECT_ROOT, 'manifest.json'));
run('git add -f index.js manifest.json');

let hasChanges = false;
try { execSync('git diff --cached --quiet -- index.js manifest.json', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { hasChanges = true; }

if (!hasChanges) {
    warn('产物无变化，跳过提交');
} else {
    var d = new Date().toISOString().replace('T', ' ').substring(0, 19);
    run('git commit -m "release: v' + version + '" -m "构建时间: ' + d + '" -m "来源分支: ' + currentBranch + '" -m "来源提交: ' + originalHead + '"');
    ok('已提交: release v' + version);
}
run('git push origin ' + RELEASE_BRANCH);
ok('已推送 origin/' + RELEASE_BRANCH);

// ── 切回 ──
try {
    execSync('cd ' + PROJECT_ROOT + ' && git checkout ' + currentBranch, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
    run('git checkout ' + currentBranch);
}
ok('已切回 ' + currentBranch);

rmSync(TMP_DIR, { recursive: true, force: true });

console.log('');
console.log('════════════════════════════════════════════════');
console.log('  ✅ 发布成功！v' + version);
console.log('════════════════════════════════════════════════');
console.log('  安装 URL: https://github.com/Melody-0321/NE-Memory');
console.log('  Branch: ' + RELEASE_BRANCH);
