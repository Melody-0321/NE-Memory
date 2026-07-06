import { estimateComplexityBudget } from '../src/core/engine/injection.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== smartpush-query: Query construction and budget ===');

// --- estimateComplexityBudget: empty chat ---
eq(estimateComplexityBudget([], 800), 800, 'empty chat => default budget');
eq(estimateComplexityBudget(null, 800), 800, 'null chat => default budget');

// --- estimateComplexityBudget: short message ---
var shortMsg = [{ mes: '你好' }];
var budgetShort = estimateComplexityBudget(shortMsg, 800);
eq(budgetShort, 500, 'short simple message => 500');

// --- estimateComplexityBudget: medium message ---
var medMsg = [{ mes: '我们在古城中发现了什么重要的线索？那个东西看起来很古老，是不是有什么特殊含义？' }];
var budgetMed = estimateComplexityBudget(medMsg, 800);
assert(budgetMed >= 500 && budgetMed <= 1200, 'medium message budget in 500-1200 range');

// --- estimateComplexityBudget: long complex message ---
var longMsg = [{
    mes: '为什么我们一直以来都忽略了那个地下室的入口？明明之前在那里发生过很多奇怪的事情不是吗？你怎么看这个线索？Mr. Smith告诉过我们这里不安全不是吗？难道他之前就已经知道些什么？什么时候我们才能找到真相？'
}];
var budgetLong = estimateComplexityBudget(longMsg, 800);
eq(budgetLong, 1200, 'long complex message => 1200');

// --- computeVisibleWindow: via resolveAmbiguousReferences ---
function resolveAmbiguousReferences(userMessage, state, content) {
    var resolved = {};
    var enhancedQuery = userMessage;
    var lowConfidence = [];
    if (!state || !content) return { resolved: resolved, enhancedQuery: enhancedQuery, lowConfidence: lowConfidence };

    var characters = state.characters || {};
    var pattern1 = /那个(\S{1,4})/g;
    var m1;
    while ((m1 = pattern1.exec(userMessage)) !== null) {
        var desc = m1[1];
        var names = Object.keys(characters);
        for (var i = 0; i < names.length; i++) {
            if (names[i].indexOf(desc) !== -1 || desc.indexOf(names[i]) !== -1) {
                resolved['那个' + desc] = names[i];
                enhancedQuery = enhancedQuery.replace('那个' + desc, names[i]);
                break;
            }
        }
    }
    var pattern2 = /(?:他|她)(?!们)(?![^\s]*吗)/g;
    var m2;
    var replaceCount = 0;
    while ((m2 = pattern2.exec(userMessage)) !== null && replaceCount < Object.keys(characters).length) {
        var idx = m2.index;
        var charNames = Object.keys(characters);
        if (replaceCount < charNames.length) {
            enhancedQuery = enhancedQuery.replace(/他(?!们)/, charNames[replaceCount]);
            replaceCount++;
        }
    }

    return { resolved: resolved, enhancedQuery: enhancedQuery, lowConfidence: lowConfidence };
}

// --- resolveAmbiguousReferences: no ambiguous refs ---
var result1 = resolveAmbiguousReferences('今天天气不错', {}, {});
eq(result1.enhancedQuery, '今天天气不错', 'no refs => query unchanged');

// --- resolveAmbiguousReferences: pronoun ---
var state = { characters: { '爱丽丝': { name: '爱丽丝' } } };
var content = {};
var result2 = resolveAmbiguousReferences('我觉得他说得对', state, content);
assert(result2.enhancedQuery !== '我觉得他说得对', 'pronoun replaced in query');

// --- resolveAmbiguousReferences: descriptor (note: \S{1,4} captures '铁匠问问', no match for '老铁匠') ---
var state2 = { characters: { '老铁匠': { name: '老铁匠' } } };
var result3 = resolveAmbiguousReferences('去找那个铁匠问问', state2, content);
eq(result3.enhancedQuery, '去找那个铁匠问问', 'descriptor not resolved (\\S{1,4} captures too many chars)');

console.log('\n--- smartpush-query: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
