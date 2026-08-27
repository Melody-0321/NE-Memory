// quick index 废弃 + Memory 压平门禁：P1R 收尾锁死
// 决策（见 .trae/documents/P1R-quick-index废弃与Memory压平.md）：
//   压平 Memory 三层嵌套（删除 Memory List 外层 accordion，STM/LTM 升为顶级）
//   + 两侧一并废弃 quick index 芯片条带（renderQuickIndex / #ne_quick_index / #ne_state_quick_index）
// 本源码断言防止未来未经评估地重新引入此"深嵌套补偿性设计"。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var panelInit = readFileSync(path.resolve(__dirname, '../src/adapter/panel-init.js'), 'utf8');
var panelDrawer = readFileSync(path.resolve(__dirname, '../src/adapter/panel-drawer.js'), 'utf8');

var test = { passed: 0, failed: 0 };
function assert(cond, msg) {
    if (cond) { test.passed++; } else { test.failed++; console.error('  FAIL: ' + msg); }
}

console.log('\n=== ratchet-quick-index-deprecated: quick index 废弃 + Memory 压平 ===');

assert(panelInit.indexOf('ne_state_quick_index') === -1, 'State quick index 容器不得回归');
assert(panelInit.indexOf('ne_quick_index') === -1, 'Memory quick index 容器不得回归');
assert(panelInit.indexOf('ne-acc-memory-list') === -1, 'Memory List 外层嵌套不得回归');
assert(panelDrawer.indexOf('renderQuickIndex') === -1, 'renderQuickIndex 导出不得回归');
assert(panelDrawer.indexOf('_quickIdxCache') === -1, 'quick index 缓存不得回归');

console.log('\n=== ratchet-quick-index-deprecated: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);