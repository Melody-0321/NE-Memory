/**
 * banner-regex.test.js — NE-BANNER / NE-CHAR 剥离正则冒烟测试（UI-12）
 *
 * 内联与 events.js 一致的三个正则字符串常量，用与 ST `regexFromString`
 * （utils.js: new RegExp(m[2], m[3])）相同的编译方式验证转义层级正确性，
 * 防止 FIND_PROMPT 双重转义（\\\\| → regex 交替）回归。
 */

// 与 src/adapter/events.js L828 逐字一致（FIND_PIPE，display 提取用）
var FIND_PIPE = '<!--NE-BANNER-->([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)<!--\\/NE-BANNER-->';

// 与 src/adapter/events.js L836 逐字一致（FIND_PROMPT，prompt 剥离用，UI-12 已降层）
var FIND_PROMPT = '/(?:<!--NE-BANNER-->[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*<!--\\/NE-BANNER-->\\s*|<!--NE-CHAR:[^-]+-{2,3}>[\\s\\S]*?<!--\\/NE-CHAR-->)/g';

// 与 src/adapter/events.js L912 逐字一致（CHAR_FIND）
var CHAR_FIND = '/<!--NE-CHAR:[^-]+-{2,3}>[\\s\\S]*?<!--\\/NE-CHAR-->/g';

// 模拟 ST regexFromString（utils.js L1388）：剥离首尾斜杠 + flags，new RegExp 编译
function compileStRegex(input) {
    var m = input.match(/(\/?)(.+)\1([a-z]*)/i);
    return new RegExp(m[2], m[3]);
}

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
// g flag 正则的 test() 依赖 lastIndex，跨样例断言前必须重置，避免状态污染
function testFrom0(re, str) { re.lastIndex = 0; return re.test(str); }

console.log('\n=== banner-regex: compile ===');

var rePrompt, rePipe, reChar;
try {
    rePrompt = compileStRegex(FIND_PROMPT);
    assert(true, 'FIND_PROMPT compiles');
} catch (e) {
    assert(false, 'FIND_PROMPT compiles (threw: ' + e.message + ')');
}
try {
    rePipe = compileStRegex(FIND_PIPE);
    assert(true, 'FIND_PIPE compiles');
} catch (e) {
    assert(false, 'FIND_PIPE compiles (threw: ' + e.message + ')');
}
try {
    reChar = compileStRegex(CHAR_FIND);
    assert(true, 'CHAR_FIND compiles');
} catch (e) {
    assert(false, 'CHAR_FIND compiles (threw: ' + e.message + ')');
}

console.log('\n=== banner-regex: banner matching ===');

var bannerSample = '<!--NE-BANNER-->a|b|c|d|e<!--/NE-BANNER-->';
assert(testFrom0(rePrompt, bannerSample), 'FIND_PROMPT matches NE-BANNER block (| separated)');
var strippedPrompt = bannerSample.replace(rePrompt, '');
assert(strippedPrompt === '', 'FIND_PROMPT strips whole NE-BANNER block from prompt');

assert(testFrom0(rePipe, bannerSample), 'FIND_PIPE matches NE-BANNER block (display)');
var m = bannerSample.match(rePipe);
assert(m && m[1] === 'a' && m[5] === 'e', 'FIND_PIPE captures the 5 pipe-separated segments');

// banner 后跟换行场景（\s* 分支）
var bannerTrailingNewline = '<!--NE-BANNER-->a|b|c|d|e<!--/NE-BANNER-->\n\n';
assert(testFrom0(rePrompt, bannerTrailingNewline), 'FIND_PROMPT matches NE-BANNER block followed by newlines');

console.log('\n=== banner-regex: char block matching ===');

var charSample = '<!--NE-CHAR:阿瓦-->{"key":"val"}<!--/NE-CHAR-->';
assert(testFrom0(rePrompt, charSample), 'FIND_PROMPT matches NE-CHAR block');
assert(testFrom0(reChar, charSample), 'CHAR_FIND matches NE-CHAR block');
assert(testFrom0(rePrompt, charSample) === testFrom0(reChar, charSample), 'FIND_PROMPT and CHAR_FIND agree on NE-CHAR sample');

console.log('\n=== banner-regex: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
