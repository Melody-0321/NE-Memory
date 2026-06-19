import { tokenize, vocabularyOverlap } from '../src/core/engine/text-utils.js';

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
function gt(a, b, msg) { assert(a > b, msg + ' (expected >' + b + ', got ' + a + ')'); }
function contains(arr, item, msg) { assert(arr.indexOf(item) !== -1, msg + ' (item not found in ' + JSON.stringify(arr) + ')'); }
function notContains(arr, item, msg) { assert(arr.indexOf(item) === -1, msg + ' (item unexpectedly found in ' + JSON.stringify(arr) + ')'); }

// ====== tokenize ======

console.log('\n=== text-utils: tokenize ===');

// 1. 空/无效输入
var t = tokenize(null);
eq(t.length, 0, 'null → []');
t = tokenize('');
eq(t.length, 0, '"" → []');
t = tokenize(undefined);
eq(t.length, 0, 'undefined → []');

// 2. 纯 ASCII 单词
t = tokenize('hello world');
contains(t, 'hello', 'hello present');
contains(t, 'world', 'world present');
eq(t.length, 2, '"hello world" → 2 tokens');

// 3. CJK 单字 1-gram
t = tokenize('蕾');
contains(t, '蕾', '蕾 1-gram');
eq(t.length, 1, '单 CJK 字 → 1 token (仅1-gram，无2-gram)');

// 4. CJK 两字：2 个 1-gram + 1 个 2-gram
t = tokenize('蕾娜');
contains(t, '蕾', '蕾 1-gram');
contains(t, '娜', '娜 1-gram');
contains(t, '^蕾娜', '蕾娜 2-gram (^前缀)');
eq(t.length, 3, '"蕾娜" → 3 tokens (2x1-gram + 1x2-gram)');

// 5. CJK 三字：3 个 1-gram + 2 个 2-gram
t = tokenize('蕾娜拥');
contains(t, '蕾', '蕾 1-gram');
contains(t, '娜', '娜 1-gram');
contains(t, '拥', '拥 1-gram');
contains(t, '^蕾娜', '蕾娜 2-gram');
contains(t, '^娜拥', '娜拥 2-gram');
eq(t.length, 5, '"蕾娜拥" → 5 tokens (3x1-gram + 2x2-gram)');

// 6. CJK 四字：4 个 1-gram + 3 个 2-gram
t = tokenize('蕾娜拥抱');
eq(t.length, 7, '"蕾娜拥抱" → 7 tokens (4x1-gram + 3x2-gram)');

// 7. 完整句子 (6 个 CJK 字符: 蕾娜拥抱辛耶)
t = tokenize('蕾娜拥抱辛耶');
eq(t.length, 11, '"蕾娜拥抱辛耶" → 11 tokens (6x1-gram + 5x2-gram)');
contains(t, '^拥抱', '拥抱 2-gram');
contains(t, '^辛耶', '辛耶 2-gram');

// 8. 混合 CJK + ASCII
t = tokenize('HP 100 体力');
contains(t, 'hp', 'hp lowercased');
contains(t, '100', '100');
contains(t, '体', '体 1-gram');
contains(t, '力', '力 1-gram');
contains(t, '^体力', '体力 2-gram');
eq(t.length, 5, '"HP 100 体力" → 5 tokens');

// 9. 2-gram 带 ^ 不会和普通 token 冲突
t = tokenize('蕾娜');
var hasHatToken = false;
for (var i = 0; i < t.length; i++) { if (t[i][0] === '^') hasHatToken = true; }
assert(hasHatToken, 'CJK 2-gram 以 ^ 开头');
notContains(t, '蕾娜', '纯 "蕾娜" 不会是 token (应该是 "^蕾娜")');

// 10. 纯标点被跳过
t = tokenize('。，！？');
assert(t.length === 0 || t.every(function(tk) { return /^[\u4e00-\u9fff^a-z0-9]/.test(tk); }), '标点不应产生 CJK token');

// 11. 数字 token
t = tokenize('abc123xyz');
contains(t, 'abc123xyz', '连续字母数字为一个 token');

// ====== vocabularyOverlap ======

console.log('\n=== text-utils: vocabularyOverlap ===');

// 12. 完全相同 → 1.0
var score = vocabularyOverlap('蕾娜拥抱辛耶', '蕾娜拥抱辛耶');
eq(score, 1, '相同文本 → 1.0');

// 13. 完全不同 → 低分
score = vocabularyOverlap('蕾娜', '张三');
assert(score < 1, '不同文本 → <1');
assert(score >= 0, '不同文本 → >=0');

// 14. 部分重叠 → 0~1 之间
score = vocabularyOverlap('蕾娜拥抱辛耶', '辛耶拥抱蕾娜');
gt(score, 0, '部分重叠 >0');
assert(score < 1, '部分重叠 < 1');

// 15. 空输入
score = vocabularyOverlap('', 'test');
eq(score, 0, '空文本A → 0 (仅B有token, overlap=0)');
score = vocabularyOverlap('test', '');
eq(score, 0, '空文本B → 0');

// ====== 结果 ======
console.log('\n--- text-utils: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
