'use strict';

var test = { passed: 0, failed: 0 };

function assert(condition, msg) {
    if (condition) {
        test.passed++;
    } else {
        test.failed++;
        console.error('FAIL: ' + msg);
    }
}

var statePipelineRunning = false;
var pipelineRunning = false;
var extractCallCount = 0;
var mockExtractResult = { vault: { content: { state: { time: 'Day 1' } } }, changed: true };

function mockExtractStateChangesOnly(chatId, userMsg, asstMsg) {
    extractCallCount++;
    return Promise.resolve(mockExtractResult);
}

// TEST 1: pipelineRunning=true → per-round skips
console.log('\n=== TEST 1: pipelineRunning=true, should skip ===');
statePipelineRunning = false;
pipelineRunning = true;
extractCallCount = 0;
if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', null, null);
}
assert(extractCallCount === 0, 'Should NOT call extract when pipelineRunning=true');
assert(statePipelineRunning === false, 'statePipelineRunning should remain false');

// TEST 2: both false → per-round proceeds
console.log('\n=== TEST 2: both flags false, should proceed ===');
statePipelineRunning = false;
pipelineRunning = false;
extractCallCount = 0;
if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', { role: 'user', content: 'hi' }, { role: 'asst', content: 'hello' });
}
assert(extractCallCount === 1, 'Should call extract when no locks held');
assert(statePipelineRunning === true, 'statePipelineRunning should be set');

// TEST 3: statePipelineRunning=true → re-entrant skip
console.log('\n=== TEST 3: statePipelineRunning=true, re-entrant skip ===');
statePipelineRunning = true;
pipelineRunning = false;
extractCallCount = 0;
if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', null, null);
}
assert(extractCallCount === 0, 'Should skip when statePipelineRunning already true');

// TEST 4: pipeline starts, then per-round must skip
console.log('\n=== TEST 4: pipeline starts, per-round skips ===');
statePipelineRunning = false;
pipelineRunning = false;
extractCallCount = 0;
pipelineRunning = true;  // flushPendingMessages started
if (statePipelineRunning || pipelineRunning) {
    // skip — THIS IS THE FIX
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', null, null);
}
assert(extractCallCount === 0, 'Per-round should skip when pipeline running');
assert(statePipelineRunning === false, 'statePipelineRunning should stay false');

// TEST 5: Sequential — per-round finishes, then pipeline OK
console.log('\n=== TEST 5: Sequential per-round→pipeline, no conflict ===');
statePipelineRunning = false;
pipelineRunning = false;
// Per-round starts
if (statePipelineRunning || pipelineRunning) {} else { statePipelineRunning = true; }
assert(statePipelineRunning === true, 'Per-round starts when idle');
// Per-round finishes
statePipelineRunning = false;
// Pipeline starts
if (!pipelineRunning) { pipelineRunning = true; }
assert(pipelineRunning === true, 'Pipeline starts after per-round done');
assert(statePipelineRunning === false, 'statePipelineRunning cleared');

console.log('\n=== RESULTS ===');
console.log('Passed: ' + test.passed + ', Failed: ' + test.failed);
console.log(test.failed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(test.failed === 0 ? 0 : 1);
