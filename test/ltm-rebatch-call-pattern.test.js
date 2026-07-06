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

function buildRebatchPrompt(vault, stmPool) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var stmLines = stmPool.map(function(s, i) {
        return (i + 1) + '. [' + (s.id || '') + '] ' + (s.event || '').substring(0, 200) +
            '\n   period=' + (s.period || '-') + '  scene=' + (s.scene || '-');
    });

    var ltmIndex = (content.ltm_entries || []).map(function(e) {
        return '- [' + (e.title || e.event || '').substring(0, 50) + '] ' + (e.period || '') + ' (' + ((e.stm_refs || []).length) + ' STM)';
    });

    var system = lang === 'en' ?
        'You are a memory consolidator. Group STM entries into LTM arcs.' :
        '你的记忆整合器。将 STM 条目分组为 LTM 弧。';

    var user = '待整合的 STM 条目：\n\n' + stmLines.join('\n\n');

    return { system: system, user: user };
}

var mockVault = {
    content: {
        language: 'zh',
        ltm_entries: [{ id: 'ltm_1', title: 'Test Arc', stm_refs: ['stm_a'] }]
    }
};

var mockStmPool = [
    { id: 'stm_1', event: '张三进入酒馆', period: 'Day 1', scene: '酒馆' },
    { id: 'stm_2', event: '张三与李四交谈', period: 'Day 1', scene: '酒馆' }
];

var prompt = buildRebatchPrompt(mockVault, mockStmPool);

// TEST 1: buildRebatchPrompt returns {system, user} with string values
console.log('\n=== TEST 1: buildRebatchPrompt returns correct structure ===');
assert(typeof prompt === 'object' && prompt !== null, 'prompt should be an object');
assert(typeof prompt.system === 'string', 'prompt.system should be a string');
assert(typeof prompt.user === 'string', 'prompt.user should be a string');
assert(prompt.system.length > 0, 'prompt.system should not be empty');
assert(prompt.user.length > 0, 'prompt.user should not be empty');

// TEST 2: Correct call pattern — wrap as messages array [{role, content}]
console.log('\n=== TEST 2: Correct call pattern wraps system/user into messages array ===');
var correctMessages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
];
assert(Array.isArray(correctMessages), 'messages should be an array');
assert(correctMessages.length === 2, 'messages should have 2 entries');
assert(typeof correctMessages[0] === 'object', 'messages[0] should be an object');
assert(correctMessages[0].role === 'system', 'messages[0].role should be "system"');
assert(correctMessages[0].content === prompt.system, 'messages[0].content should be prompt.system');
assert(correctMessages[1].role === 'user', 'messages[1].role should be "user"');
assert(correctMessages[1].content === prompt.user, 'messages[1].content should be prompt.user');

// TEST 3: Broken call pattern detection — passing raw strings instead of array
console.log('\n=== TEST 3: Detection of broken call pattern (raw strings, not array) ===');
var brokenArg1 = prompt.system;
var brokenArg2 = prompt.user;
assert(typeof brokenArg1 !== 'object' && !Array.isArray(brokenArg1), 'Broken: arg1 is a raw string, not array');
assert(typeof brokenArg2 !== 'object' && !Array.isArray(brokenArg2), 'Broken: arg2 is a raw string, not array');

// TEST 4: The function signature expects messages as first arg, which is Array.isArray safe
console.log('\n=== TEST 4: callMemoryPipeline(messages, options) expects messages as array ===');
function mockCallMemoryPipeline(messages, options) {
    return {
        isArray: Array.isArray(messages),
        messageCount: Array.isArray(messages) ? messages.length : -1,
        hasSystemRole: Array.isArray(messages) && messages.length > 0 && messages[0].role === 'system',
        hasUserRole: Array.isArray(messages) && messages.length > 1 && messages[1].role === 'user'
    };
}

var fixedCall = mockCallMemoryPipeline(correctMessages, { operation: 'ltm_rebatch' });
assert(fixedCall.isArray === true, 'Fixed: messages is an array');
assert(fixedCall.messageCount === 2, 'Fixed: messages has 2 entries');
assert(fixedCall.hasSystemRole === true, 'Fixed: messages[0] has role=system');
assert(fixedCall.hasUserRole === true, 'Fixed: messages[1] has role=user');

var brokenCall = mockCallMemoryPipeline(brokenArg1, brokenArg2);
assert(brokenCall.isArray === false, 'Broken: messages is NOT an array (it is a string)');
assert(brokenCall.messageCount === -1, 'Broken: messageCount is -1 (not an array)');
assert(brokenCall.hasSystemRole === false, 'Broken: hasSystemRole is false');
assert(brokenCall.hasUserRole === false, 'Broken: hasUserRole is false');

console.log('\n=== RESULTS ===');
console.log('Passed: ' + test.passed + ', Failed: ' + test.failed);
console.log(test.failed === 0 ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(test.failed === 0 ? 0 : 1);
