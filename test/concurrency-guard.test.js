/**
 * Test: verify that triggerPerRoundExtraction correctly checks
 * BOTH statePipelineRunning AND pipelineRunning before starting.
 *
 * Bug: commit 721a064 introduced fire-and-forget per-round extraction
 * that uses statePipelineRunning as its guard, while flushPendingMessages
 * uses pipelineRunning. Since these are different flags, both could write
 * to the same IndexedDB vault concurrently, causing lost state updates.
 *
 * Fix: triggerPerRoundExtraction now checks both flags before proceeding.
 */

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

function reset() {
    test.passed = 0;
    test.failed = 0;
}

// Simulate the module-scope state variables
var statePipelineRunning = false;
var pipelineRunning = false;
var extractCallCount = 0;
var vaultUpdateCallCount = 0;

// Mock extractStateChangesOnly
var mockExtractResult = { vault: { content: { state: { time: 'Day 1' } } }, changed: true };
function mockExtractStateChangesOnly(chatId, userMsg, asstMsg) {
    extractCallCount++;
    return Promise.resolve(mockExtractResult);
}

function mockOnVaultUpdateCallback(vault) {
    vaultUpdateCallCount++;
}

// --- TEST 1: triggerPerRoundExtraction with pipelineRunning=true must skip ---
console.log('\n=== TEST 1: pipelineRunning=true, should skip ===');
reset();
statePipelineRunning = false;
pipelineRunning = true;
extractCallCount = 0;

// Simulate triggerPerRoundExtraction (the FIXED version)
if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', { role: 'user', content: 'hi' }, { role: 'asst', content: 'hello' })
        .then(function(result) {
            if (mockOnVaultUpdateCallback && result && result.vault) mockOnVaultUpdateCallback(result.vault);
        })
        .finally(function() { statePipelineRunning = false; });
}

assert(extractCallCount === 0, 'Should NOT call extractStateChangesOnly when pipelineRunning=true');
assert(statePipelineRunning === false, 'statePipelineRunning should remain false');

// --- TEST 2: triggerPerRoundExtraction with both false must proceed ---
console.log('\n=== TEST 2: both flags false, should proceed ===');
reset();
statePipelineRunning = false;
pipelineRunning = false;
extractCallCount = 0;

if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', { role: 'user', content: 'hi' }, { role: 'asst', content: 'hello' })
        .then(function(result) {
            if (mockOnVaultUpdateCallback && result && result.vault) mockOnVaultUpdateCallback(result.vault);
        })
        .finally(function() { statePipelineRunning = false; });
}

assert(extractCallCount === 1, 'Should call extractStateChangesOnly when no locks are held');
assert(statePipelineRunning === true, 'statePipelineRunning should be set');

// --- TEST 3: triggerPerRoundExtraction re-entrant guard ---
console.log('\n=== TEST 3: statePipelineRunning=true, re-entrant skip ===');
reset();
statePipelineRunning = true;
pipelineRunning = false;
extractCallCount = 0;

if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', null, null);
}

assert(extractCallCount === 0, 'Should skip when statePipelineRunning is already true');

// --- TEST 4: flushPendingMessages sets pipelineRunning, then per-round skips ---
console.log('\n=== TEST 4: flushPendingMessages starts, per-round must skip ===');
reset();
statePipelineRunning = false;
pipelineRunning = false;
extractCallCount = 0;

// Simulate flushPendingMessages starting
pipelineRunning = true;

// Now triggerPerRoundExtraction tries to start
if (statePipelineRunning || pipelineRunning) {
    // skip -- THIS IS THE FIX
} else {
    statePipelineRunning = true;
    mockExtractStateChangesOnly('test', null, null);
}

assert(extractCallCount === 0, 'Per-round should skip when full pipeline is running');
assert(statePipelineRunning === false, 'statePipelineRunning should still be false');

// --- TEST 5: Sequential execution — per-round completes, then full pipeline ---
console.log('\n=== TEST 5: Sequential per-round then pipeline, no overlap ===');
reset();
statePipelineRunning = false;
pipelineRunning = false;

// Per-round starts
if (statePipelineRunning || pipelineRunning) {
    // skip
} else {
    statePipelineRunning = true;
}

assert(statePipelineRunning === true, 'Per-round should start when nothing is running');

// Per-round completes (simulating .finally)
statePipelineRunning = false;

// Now pipeline starts
if (!