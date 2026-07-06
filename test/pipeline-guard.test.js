import { tryAcquire, transitionTo, releasePipeline, reset, isIdle, getPipelinePhase, getState } from '../src/core/engine/pipeline-guard.js';

var test = { passed: 0, failed: 0 };

function assert(condition, msg) {
    if (condition) {
        test.passed++;
    } else {
        test.failed++;
        console.error('  FAIL: ' + msg);
    }
}

function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== pipeline-guard ===');

// 确保从干净状态开始
reset();

// 1. 初始空闲
eq(getPipelinePhase(), 'idle', '初始状态 idle');
eq(getState(), 'idle', 'getState() 初始 idle');
assert(isIdle(), 'isIdle() 初始 true');

// 2. tryAcquire 合法状态
var ok = tryAcquire('stm');
assert(ok, 'tryAcquire("stm") 返回 true');
eq(getPipelinePhase(), 'stm', '获取后状态为 stm');
assert(!isIdle(), 'isIdle() → false');

// 3. 已占用时拒绝新获取
ok = tryAcquire('ltm');
assert(!ok, 'stm 运行时 tryAcquire("ltm") 返回 false');
eq(getPipelinePhase(), 'stm', '状态保持 stm 不变');

// 4. tryAcquire 非法状态
releasePipeline();
ok = tryAcquire('invalid');
assert(!ok, 'tryAcquire("invalid") 返回 false');
eq(getPipelinePhase(), 'idle', '非法状态后保持 idle');

// 5. 状态转换
tryAcquire('stm');
transitionTo('ltm');
eq(getPipelinePhase(), 'ltm', 'transitionTo(ltm) 后状态为 ltm');

// 6. 转换到非法状态不生效
transitionTo('invalid');
eq(getPipelinePhase(), 'ltm', 'transitionTo(invalid) 后保持 ltm 不变');

// 7. 释放后 idle
releasePipeline();
assert(isIdle(), 'release 后 idle');

// 8. 多阶段流：idle → state → stm → ltm → idle
reset();
eq(getPipelinePhase(), 'idle', 'reset → idle');
tryAcquire('state');
eq(getPipelinePhase(), 'state', 'acquire state');
transitionTo('stm');
eq(getPipelinePhase(), 'stm', 'state → stm');
transitionTo('ltm');
eq(getPipelinePhase(), 'ltm', 'stm → ltm');
releasePipeline();
eq(getPipelinePhase(), 'idle', 'ltm → idle (release)');

// 9. reset 清空等待队列
releasePipeline();
assert(isIdle(), '最终状态 idle');

console.log('--- pipeline-guard: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
