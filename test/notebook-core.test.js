import { RetrievalNotebook } from '../src/core/vault/retrieval-notebook.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== notebook-core: RetrievalNotebook operations ===');

var nb = new RetrievalNotebook();

// --- addEntry + getEntry ---
nb.addEntry('stm_1', { id: 'stm_1', event: 'E1', threads: [], sources: ['bm25'] });
var e1 = nb.getEntry('stm_1');
assert(e1 !== undefined, 'getEntry returns added entry');
eq(e1.event, 'E1', 'entry data preserved');
eq(nb.getEntry('stm_nonexistent'), null, 'getEntry for missing id => null');

// --- addThread + extendThread ---
nb.addThread('th_1', { label: 'Thread 1', stmIds: ['stm_1'] });
assert(nb.getThread('th_1') !== undefined, 'getThread returns added thread');
eq(nb.getThread('th_1').label, 'Thread 1', 'thread data preserved');

nb.extendThread('th_1', 'stm_1');
var t1 = nb.getThread('th_1');
eq(t1.stmIds.length, 1, 'extendThread with existing stmId does not duplicate');

// --- addChain ---
var chainEntries = [
    { id: 'stm_a', event: 'A' },
    { id: 'stm_b', event: 'B' },
    { id: 'stm_c', event: 'C' }
];
nb.addEntry('stm_a', { id: 'stm_a', event: 'A', threads: [], sources: [] });
nb.addEntry('stm_b', { id: 'stm_b', event: 'B', threads: [], sources: [] });
nb.addEntry('stm_c', { id: 'stm_c', event: 'C', threads: [], sources: [] });
nb.addChain('entityX', chainEntries);

var tChain = nb.getThread('chain:entityX');
assert(tChain !== undefined, 'addChain creates chain thread');

var eA = nb.getEntry('stm_a');
assert(eA.sources.indexOf('chain:entityX') !== -1, 'chain entries get source annotation');

// --- describe ---
var desc = nb.describe();
assert(typeof desc === 'string', 'describe returns string');
assert(desc.indexOf('# RAG Note') === -1, 'describe without vector does not include vector header');

// --- diff ---
var diff = nb.diff();
assert(typeof diff === 'string', 'diff returns string');

// --- expand ---
nb.addEntry('stm_expand', { id: 'stm_expand', event: 'Expand me', threads: [], sources: ['bm25'] });
nb.expand('stm_expand');
assert(nb._getExpandedIds().indexOf('stm_expand') !== -1, 'expanded id tracked');

// --- jumpGapBetween ---
nb.addEntry('stm_x', { id: 'stm_x', period: 'Day 1', event: 'X', threads: [], sources: [] });
nb.addEntry('stm_y', { id: 'stm_y', period: 'Day 5', event: 'Y', threads: [], sources: [] });
var jump = nb.jumpGapBetween('stm_x', 'stm_y', 'th_1');
assert(typeof jump === 'number', 'jumpGapBetween returns number (-1 when IDs not in thread)');

// --- threadBoundaryMark ---
nb.addEntry('stm_p1', { id: 'stm_p1', period: 'Day 1', threads: [], sources: [], entities: ['A'] });
nb.addEntry('stm_p2', { id: 'stm_p2', period: 'Day 1', threads: [], sources: [], entities: ['B'] });
var boundary = nb.threadBoundaryMark('stm_p1', 'stm_p2');
eq(boundary, 'thread_boundary', 'threadBoundaryMark returns thread_boundary string when no shared threads');

console.log('\n--- notebook-core: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
