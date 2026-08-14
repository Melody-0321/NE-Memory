import { cleanMessageText, normalizeStripTag } from '../src/core/engine/content-clean.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== content-clean: format-block stripping ===');

// --- normalizeStripTag ---
eq(normalizeStripTag('<note>'), 'note', 'strips angle brackets');
eq(normalizeStripTag(' think '), 'think', 'trims whitespace');
eq(normalizeStripTag('note>'), 'note', 'strips trailing bracket');
eq(normalizeStripTag('<a/b>'), 'ab', 'strips all brackets and slash');
eq(normalizeStripTag(null), '', 'null becomes empty');
eq(normalizeStripTag(undefined), '', 'undefined becomes empty');
eq(normalizeStripTag(''), '', 'empty stays empty');

// --- think block (paired, single line) ---
var t1 = cleanMessageText('Hello <think>internal reasoning</think> world', []);
eq(t1, 'Hello  world', 'paired think block removed');

// --- thinking block (paired, multi-line) ---
var t2 = cleanMessageText('A\n<thinking>\nline1\nline2\n</thinking>\nB', []);
eq(t2, 'A\n\nB', 'paired thinking block removed across lines');

// --- think with attribute ---
var t3 = cleanMessageText('X <think hidden="true">secret</think> Y', []);
eq(t3, 'X  Y', 'think block with attribute removed');

// --- unclosed think stays (conservative, requires closing tag) ---
var t4 = cleanMessageText('Keep <think>this', []);
eq(t4, 'Keep <think>this', 'unclosed think block preserved');

// --- HTML comment ---
var t5 = cleanMessageText('A <!-- hidden note --> B', []);
eq(t5, 'A  B', 'HTML comment removed');

// --- HTML comment multi-line ---
var t6 = cleanMessageText('A\n<!-- multi\nline -->\nB', []);
eq(t6, 'A\n\nB', 'multi-line HTML comment removed');

// --- custom tag pair ---
var t7 = cleanMessageText('A <status>full text here</status> B', ['status']);
eq(t7, 'A  B', 'custom paired tag removed');

// --- custom tag with attribute ---
var t8 = cleanMessageText('A <status type="hp">full</status> B', ['status']);
eq(t8, 'A  B', 'custom paired tag with attribute removed');

// --- custom lone tag ---
var t9 = cleanMessageText('A <status/> B', ['status']);
eq(t9, 'A  B', 'custom self-closing tag removed');

// --- custom stray opening tag ---
var t10 = cleanMessageText('A <status> B', ['status']);
eq(t10, 'A  B', 'custom stray opening tag removed');

// --- custom tag normalization in list ---
var t11 = cleanMessageText('A <note>x</note> B', ['<note>']);
eq(t11, 'A  B', 'tag name normalized (<note> -> note)');

// --- multiple custom tags ---
var t12 = cleanMessageText('A <n1>x</n1> B <n2>y</n2> C', ['n1', 'n2']);
eq(t12, 'A  B  C', 'multiple custom tags removed');

// --- no format blocks: text unchanged ---
var t13 = 'Plain text with <b>bold</b> stays as-is.';
eq(cleanMessageText(t13, []), t13, 'plain text with html-ish tags preserved');

// --- custom list without matching tags: unchanged ---
var t14 = 'Just words <div>x</div>';
eq(cleanMessageText(t14, ['note']), t14, 'non-matching custom tag preserved');

// --- think + comment + custom combined ---
var t15 = cleanMessageText('A <think>r</think> B <!--c--> C <note>n</note> D', ['note']);
eq(t15, 'A  B  C  D', 'all block types removed together');

// --- input guards ---
eq(cleanMessageText('', []), '', 'empty string passthrough');
eq(cleanMessageText(null, []), null, 'null passthrough');
eq(cleanMessageText(undefined, []), undefined, 'undefined passthrough');
eq(cleanMessageText(123, []), 123, 'non-string passthrough');

// --- regex special chars in custom tag (no SyntaxError / no overmatch) ---
var t16 = cleanMessageText('A <note(2)>x</note(2)> B', ['note(2)']);
eq(t16, 'A  B', 'tag with regex special chars (parenthesis) removed safely');
var t17 = cleanMessageText('A <a.b>x</a.b> B', ['a.b']);
eq(t17, 'A  B', 'tag with dot treated literally, not as wildcard');
var t18 = cleanMessageText('A <n>y</n> B', ['n*']);
eq(t18, 'A <n>y</n> B', 'star tag does not accidentally match plain <n>');

// --- non-array customStripTags fallback (string treated as no-op, no per-char iteration) ---
var t19 = cleanMessageText('A <h>x</h> B', 'h');
eq(t19, 'A <h>x</h> B', 'string customStripTags ignored (array guard)');

console.log('\n--- content-clean: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
