/**
 * scripts/publish-extension.cjs — 构建插件并推送到 release 制品分支
 *
 * 前置条件：工作树必须干净（无未提交改动）。请先 commit 所有修改。
 * 发布后自动切回 test 并 pull origin/test 同步远端。
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

// ── Step 1: 环境检查 ──
info('Step 1/6: 检查环境...');
const currentBranch = run('git rev-parse --abbrev-ref HEAD', { silent: true }).trim();
const originalHead = run('git rev-parse HEAD', { silent: true }).trim();

if (currentBranch === RELEASE_BRANCH) {
    console.error('[FAIL] 当前位于 release 分支，禁止在产物分支上执行发布。');
    process.exit(1);
}

// 工作树必须干净 — 不允许 stash/pop 操作，防止残留 stash 覆盖源码
var dirty = false;
try {
    execSync('git diff-index --quiet HEAD --', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
} catch (e) { dirty = true; }

if (dirty) {
    console.error('[FAIL] 工作树不干净。请先 commit 所有修改，再执行发布。');
    process.exit(1);
}

try { run('git show-ref --verify --quiet refs/heads/' + RELEASE_BRANCH, { silent: true }); } catch (e) {
    console.error('[FAIL] 本地 release 分支不存在。');
    process.exit(1);
}
if (!existsSync(MANIFEST)) { console.error('[FAIL] manifest.json 不存在'); process.exit(1); }
const version = process.argv[2] || require(MANIFEST).version;
info('版本号: ' + version);
ok('环境检查通过（工作树干净）');

// ── Step 2: 构建 ──
info('Step 2/6: 构建插件 (extension 模式)...');
run('npx cross-env BUILD_MODE=extension npx rollup -c');

const distIndex = join(DIST_DIR, 'index.js');
const distManifest = join(DIST_DIR, 'manifest.json');
if (!existsSync(distIndex)) { console.error('[FAIL] 缺少 ' + distIndex); process.exit(1); }
if (!existsSync(distManifest)) { console.error('[FAIL] 缺少 ' + distManifest); process.exit(1); }
ok('构建完成: index.js (' + require('fs').statSync(distIndex).size + ' bytes)');

// ── Step 3: 备份产物 ──
info('Step 3/6: 备份产物...');
mkdirSync(TMP_DIR, { recursive: true });
copyFileSync(distIndex, join(TMP_DIR, 'index.js'));
copyFileSync(distManifest, join(TMP_DIR, 'manifest.json'));
ok('已备份');

// ── Step 4: 版本比对 ──
info('Step 4/6: 版本比对...');
var releaseVersion = '0.0.0';
try {
    var releaseManifestRaw = execSync('git show origin/' + RELEASE_BRANCH + ':manifest.json', { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
    var releaseManifest = JSON.parse(releaseManifestRaw);
    releaseVersion = releaseManifest.version || '0.0.0';
} catch (e) {}

if (version === releaseVersion) {
    warn('版本号未变 (当前 v' + version + ' === release v' + releaseVersion + ')，跳过推送 release。');
    // 清理构建产物，还原工作树
    run('git checkout -- dist/');
    info('已还原 dist/ 目录。');
    rmSync(TMP_DIR, { recursive: true, force: true });
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  ⏭  已跳过：版本号未变化 (v' + version + ')');
    console.log('════════════════════════════════════════════════');
    process.exit(0);
}

// ── Step 5: 推送到 release 分支 ──
info('Step 5/6: 切换到 release 分支...');
run('git checkout -f ' + RELEASE_BRANCH);
ok('已切换到 ' + RELEASE_BRANCH);

info('Step 6/6: 覆盖产物并推送...');
copyFileSync(join(TMP_DIR, 'index.js'), join(PROJECT_ROOT, 'index.js'));
copyFileSync(join(TMP_DIR, 'manifest.json'), join(PROJECT_ROOT, 'manifest.json'));
run('git add -f index.js manifest.json');

var d = new Date().toISOString().replace('T', ' ').substring(0, 19);
run('git commit -m "release: v' + version + '" -m "构建时间: ' + d + '" -m "来源分支: ' + currentBranch + '" -m "来源提交: ' + originalHead + '"');
ok('已提交: release v' + version);
run('git push origin ' + RELEASE_BRANCH);
ok('已推送 origin/' + RELEASE_BRANCH);

// ── 切回 test 并同步远端 ──
info('切回 ' + currentBranch + ' 并同步远端...');
run('git checkout ' + currentBranch);
ok('已切回 ' + currentBranch);
run('git pull origin ' + currentBranch);
ok('已同步 origin/' + currentBranch);

// 还原 dist/extension/ 构建产物（checkout 后 dist/ 是干净的，重新构建一次恢复）
info('重新构建以还原 dist/ 产物...');
run('npx rollup -c');
ok('dist/ 产物已还原');

rmSync(TMP_DIR, { recursive: true, force: true });

console.log('');
console.log('════════════════════════════════════════════════');
console.log('  ✅ 发布成功！v' + version);
console.log('════════════════════════════════════════════════');
console.log('  安装 URL: https://github.com/Melody-0321/NE-Memory');
console.log('  Branch: ' + RELEASE_BRANCH);
