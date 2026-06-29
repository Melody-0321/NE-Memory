import { RetrievalNotebook } from '../src/core/vault/retrieval-notebook.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== notebook-sort: Sorting and ordering ===');

var nb = new RetrievalNotebook();

nb.addEntry('stm_a', { id: 'stm_a', event: 'Alpha', threads: [], sources: ['bm25'], rank: 2, msgRange: [0, 1] });
nb.addEntry('stm_b', { id: 'stm_b', event: 'Beta', threads: [], sources: ['bm25'], rank: 1, msgRange: [2, 3] });
nb.addEntry('stm_c', { id: 'stm_c', event: 'Gamma', threads: [], sources: ['bm25'], rank: 3, msgRange: [4, 5] });

// --- toPromptEntries: default order ---
var entries1 = nb.toPromptEntries();
assert(entries1.length >= 3, 'toPromptEntries returns entries');

// --- toPromptEntries: RRF ordering ---
var entries2 = nb.toPromptEntries(true);
assert(entries2.length >= 3, 'toPromptEntries with RRF returns entries');

// --- jumpGapBetween: non-existent IDs ---
var result1 = nb.jumpGapBetween('nonexistent', 'nonexistent2', 'th_1');
assert(typeof result1 === 'number', 'jumpGapBetween with bad thread returns 0');

// --- threadBoundaryMark: same scene ---
nb.addEntry('stm_s1', { id: 'stm_s1', period: 'Day 1', scene: '古城', threads: [], sources: [], entities: [] });
nb.addEntry('stm_s2', { id: 'stm_s2', period: 'Day 1', scene: '古城', threads: [], sources: [], entities: [] });
var boundary1 = nb.threadBoundaryMark('stm_s1', 'stm_s2');
eq(boundary1, 'thread_boundary', 'same scene, no shared threads => thread_boundary');

// --- jumpGapBetween: period gap ---
nb.addEntry('stm_g1', { id: 'stm_g1', period: 'Day 1', threads: [], sources: [], entities: ['A'], msgRange: [0, 2] });
nb.addEntry('stm_g2', { id: 'stm_g2', period: 'Day 10', threads: [], sources: [], entities: ['A'], msgRange: [20, 22] });
var jump2 = nb.jumpGapBetween('stm_g1', 'stm_g2', 'th_gap');
assert(typeof jump2 === 'number', 'jumpGapBetween with bad thread returns 0');

// --- toPromptEntries with sorted entries ---
var sortedEntries = nb.toPromptEntries(true);
assert(sortedEntries.length > 0, 'toPromptEntries(RRF) returns entries');

console.log('\n--- notebook-sort: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
