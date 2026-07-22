/**
 * ne-system-msg.test.js — tests for sendNeNotification / sendNeInteraction
 * Tests the console fallback path (no SillyTavern context).
 */

import { sendNeNotification, sendNeInteraction, sendNePopup } from '../src/adapter/ne-system-msg.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// Capture console.log output
var consoleOutput = [];
var originalLog = console.log;
console.log = function() {
    var args = Array.prototype.slice.call(arguments);
    consoleOutput.push(args.join(' '));
    originalLog.apply(console, args);
};

// ====== sendNeNotification ======
console.log('\n=== ne-system-msg: sendNeNotification ===');

sendNeNotification('test_chat', 'Test notification');
var foundNotify = consoleOutput.some(function(s) { return s.indexOf('[NE-NOTIFY]') !== -1 && s.indexOf('Test notification') !== -1; });
assert(foundNotify, 'sendNeNotification falls back to console.log with prefix');

sendNeNotification(null, 'Warning', { level: 'warn' });
var foundWarn = consoleOutput.some(function(s) { return s.indexOf('[NE-NOTIFY:warn]') !== -1 && s.indexOf('Warning') !== -1; });
assert(foundWarn, 'warn level includes [NE-NOTIFY:warn]');

sendNeNotification(null, 'Error', { level: 'error' });
var foundErr = consoleOutput.some(function(s) { return s.indexOf('[NE-NOTIFY:error]') !== -1 && s.indexOf('Error') !== -1; });
assert(foundErr, 'error level includes [NE-NOTIFY:error]');

// ====== sendNeInteraction ======
console.log('\n=== ne-system-msg: sendNeInteraction ===');

sendNeInteraction('test_chat', 'Interactive prompt', {
    buttons: [{ text: 'Confirm', key: 'ok' }],
    timeoutMs: 10
}).then(function(result) {
    // Since there's no ST context, onConfirm is called immediately
    console.log('  Interaction resolved with: ' + result);
    var foundInteraction = consoleOutput.some(function(s) { return s.indexOf('Interactive prompt') !== -1; });
    assert(foundInteraction, 'sendNeInteraction log found');
});

// Wait for async completion
await new Promise(function(r) { setTimeout(r, 50); });

// ====== sendNePopup ======
console.log('\n=== ne-system-msg: sendNePopup ===');

sendNePopup('test_chat', 'Critical warning', {
    dedupKey: 'test_popup',
    buttons: [{ text: 'I understand', key: 'ok' }]
}).then(function(result) {
    var foundPopup = consoleOutput.some(function(s) { return s.indexOf('Critical warning') !== -1; });
    assert(foundPopup, 'sendNePopup log found');
});

await new Promise(function(r) { setTimeout(r, 50); });

// Restore console.log
console.log = originalLog;

console.log('\n=== ne-system-msg: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
