import { enqueueStateWrite, enqueueStmWrite, enqueueLtmWrite, reset, getState, isIdle, onPipelineChange, offPipelineChange } from '../src/core/engine/pipeline-guard.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms || 5); }); };

console.log('\n=== pipeline-guard: queue API ===');

reset();

// ── 1. Initial idle ──
eq(getState().state, 'idle', 'initial state idle');
eq(getState().stm, 'idle', 'initial stm idle');
eq(getState().ltm, 'idle', 'initial ltm idle');
assert(isIdle(), 'isIdle() initial true');

// ── 2. enqueueStateWrite transitions to active, then idle ──
var stateActiveObserved = false;
var stateDoneObserved = false;

var p1 = enqueueStateWrite(async function() {
    await sleep(10);
    stateActiveObserved = (getState().state === 'active');
});
// Immediately after enqueue: should be active (if no contention)
await sleep(2);
assert(getState().state === 'active' || stateActiveObserved, 'state becomes active during write');
await p1;
eq(getState().state, 'idle', 'state returns to idle after write');
assert(stateActiveObserved || getState().state === 'idle', 'state was active at some point');

// ── 3. enqueueStmWrite and enqueueLtmWrite are independent ──
reset();
var stmPhase = [];
var ltmPhase = [];

var pStm = enqueueStmWrite(async function() {
    stmPhase.push('start:' + getState().stm);
    await sleep(15);
    stmPhase.push('end:' + getState().stm);
});
var pLtm = enqueueLtmWrite(async function() {
    ltmPhase.push('start:' + getState().ltm);
    await sleep(10);
    ltmPhase.push('end:' + getState().ltm);
});

await Promise.all([pStm, pLtm]);
eq(getState().stm, 'idle', 'stm idle after enqueue');
eq(getState().ltm, 'idle', 'ltm idle after enqueue');
assert(stmPhase.join(',').indexOf('start:active') !== -1, 'stm was active');
assert(ltmPhase.join(',').indexOf('start:active') !== -1, 'ltm was active');

// ── 4. Same pipeline serializes (second write waits for first) ──
reset();
var order = [];
var p2a = enqueueStateWrite(async function() {
    order.push('a-start');
    await sleep(20);
    order.push('a-end');
});
var p2b = enqueueStateWrite(async function() {
    order.push('b-start');
    await sleep(5);
    order.push('b-end');
});

await p2a;
await p2b;
eq(order.join(','), 'a-start,a-end,b-start,b-end', 'state writes are serialized (a then b)');

// ── 5. Different pipelines run concurrently ──
reset();
var concurrentOrder = [];
var pState = enqueueStateWrite(async function() {
    concurrentOrder.push('state-start');
    await sleep(20);
    concurrentOrder.push('state-end');
});
await sleep(3);
var pStm2 = enqueueStmWrite(async function() {
    concurrentOrder.push('stm-start');
    await sleep(10);
    concurrentOrder.push('stm-end');
});

await Promise.all([pState, pStm2]);
assert(concurrentOrder.indexOf('stm-start') < concurrentOrder.indexOf('state-end'),
    'stm starts before state ends (concurrent)');

// ── 6. isIdle() during concurrent activity ──
reset();
var midIdle = null;
var pStm3 = enqueueStmWrite(async function() {
    await sleep(5);
    midIdle = isIdle();
});
await pStm3;
assert(midIdle === false, 'isIdle() false during stm activity');

reset();
eq(isIdle(), true, 'isIdle() true after reset');

// ── 7. reset replaces chain head; already-chained tasks still complete ──
reset();
var resetOrder = [];
var pResetA = enqueueStateWrite(async function() { await sleep(5); resetOrder.push('a'); });
var pResetB = enqueueStateWrite(async function() { await sleep(5); resetOrder.push('b'); });
reset();
// a and b were already chained so they still execute
await pResetA;
await pResetB;
assert(resetOrder.indexOf('a') !== -1, 'a still executes (already chained)');
assert(resetOrder.indexOf('b') !== -1, 'b still executes (already chained)');

// New chain starts fresh after reset
var pResetC = enqueueStateWrite(async function() { await sleep(5); resetOrder.push('c'); });
await pResetC;
assert(resetOrder.indexOf('c') !== -1, 'c executes on new chain after reset');

// ── 8. onPipelineChange / offPipelineChange ──
reset();
var changeEvents = [];
function onChg(status) { changeEvents.push(JSON.stringify(status)); }
onPipelineChange(onChg);

await enqueueStateWrite(async function() { await sleep(5); });
assert(changeEvents.length >= 2, 'at least 2 events (active + idle)');
assert(changeEvents[0].indexOf('"state":"active"') !== -1, 'active event captured');
assert(changeEvents[changeEvents.length - 1].indexOf('"state":"idle"') !== -1, 'idle event captured');

offPipelineChange(onChg);
var beforeCount = changeEvents.length;
await enqueueStateWrite(async function() { await sleep(5); });
eq(changeEvents.length, beforeCount, 'offPipelineChange stops further events');

// ── 9. Multiple enqueues — all resolve ──
reset();
var results = [];
for (var i = 0; i < 3; i++) {
    (function(idx) {
        enqueueStateWrite(async function() {
            await sleep(3);
            results.push(idx);
        });
    })(i);
}
// Wait for all to complete
await enqueueStateWrite(async function() { results.push('marker'); });
eq(results.join(','), '0,1,2,marker', 'all 3 enqueued tasks execute in order');

console.log('\n--- pipeline-guard: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
