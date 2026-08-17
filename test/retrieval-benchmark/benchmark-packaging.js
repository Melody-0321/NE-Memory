// NE-Memory: Pre/Post Packaging Comparison
// Raw recall (ranked list) vs Post-processing (entity-grouped, miss-run-folded)
// Metrics: GT visibility rate, reading-order position shift, chain injection noise, fold loss

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_packaging__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

function f(v, d) { d = d || 3; return v.toFixed(d); }
function pct(n, total) { if (total === 0) return '0%'; return (n / total * 100).toFixed(1) + '%'; }

function setBgeM3() {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

// ─── Collect all entity names from fixture ───
function collectAllEntityNames(stmArr) {
    var names = [];
    stmArr.forEach(function(e) {
        if (e.entities) {
            e.entities.forEach(function(en) {
                var n = typeof en === 'string' ? en : en.name;
                if (n && names.indexOf(n) === -1) names.push(n);
            });
        }
    });
    return names;
}

// ─── Extract entity names from query (mirrors retrieval.js) ───
function extractEntityNames(query, allEntityNames) {
    var queryLower = query.toLowerCase();
    var matched = allEntityNames.filter(function(name) {
        return name.length > 1 && queryLower.indexOf(name.toLowerCase()) !== -1;
    });
    matched.sort(function(a, b) { return b.length - a.length; });
    return matched.slice(0, 5);
}

// ─── Build entity chains from fixture (mirrors lookupEntityChains) ───
function buildEntityChains(stmArr, entityNames) {
    var chains = {};
    entityNames.forEach(function(name) {
        var chainEntries = [];
        stmArr.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) {
                return (typeof en === 'string' ? en : en.name) === name;
            })) {
                chainEntries.push(e);
            }
        });
        if (chainEntries.length > 0) {
            chainEntries.sort(function(a, b) {
                var ta = a.msg_ids && a.msg_ids.length > 0 ? a.msg_ids[0] : 0;
                var tb = b.msg_ids && b.msg_ids.length > 0 ? b.msg_ids[0] : 0;
                return ta - tb;
            });
            chains[name] = chainEntries;
        }
    });
    return chains;
}

// ─── Apply foldMissRuns logic — returns visible entries + folded summary ───
function analyzeFoldMissRuns(entries) {
    var visible = [];
    var foldedRuns = [];
    var missRun = [];

    function flushMiss() {
        if (missRun.length === 0) return;
        var ids = missRun.map(function(e) { return e.entry.id; });
        foldedRuns.push({
            count: missRun.length,
            ids: ids,
            firstPeriod: missRun[0].entry.period || '?',
            lastPeriod: missRun[missRun.length - 1].entry.period || '?'
        });
        missRun = [];
    }

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var isHit = e.relevance > 0;
        if (isHit) {
            flushMiss();
            visible.push(e);
        } else {
            missRun.push(e);
        }
    }
    flushMiss();
    return { visible: visible, foldedRuns: foldedRuns };
}

async function main() {
    console.log('=== Pre/Post Packaging Comparison ===\n');
    console.log('Methods: BM25 (k1=1.5,b=0.75,TOP_K=' + TOP_K_BM25 + ') + Vector (bge-m3,TOP_K=' + TOP_K_VEC + ') → Lin α=0.20');
    console.log('Post-processing: mergePipelines → groupCandidatesByEntity → foldMissRuns');
    console.log('Queries: ' + queries.length + '\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);

    // Per-query data for analysis
    var perQueryRows = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var gt = q.groundTruth;
        var gtIds = Object.keys(gt).filter(function(k) { return gt[k] >= 1; });
        var gtTotal = gtIds.length;

        process.stdout.write('[' + (qi + 1) + '/' + queries.length + '] ' + (q.id || ('q'+(qi+1))) + ' ... ');

        // ── Phase 1: Raw Recall ──
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(q.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });

        setBgeM3();
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });

        // Lin fusion (our standard pipeline)
        var rawIds = linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);

        // ── Phase 2: Post-Processing ──
        var entityNames = extractEntityNames(q.query, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);

        // mergePipelines
        var merged = await mergePipelines(bm25Results, entityChains, allLTM, { characters: {}, factions: {} }, allSTM);

        // groupCandidatesByEntity
        var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);

        // ── Prefetch coverage: how many GT entries would get original text? ──
        var prefetchCandidates = 0;
        var prefetchGtCovered = 0;
        if (allChatMessages && allChatMessages.length > 0) {
            var topEntries = [];
            merged.map.forEach(function(v) { topEntries.push(v); });
            topEntries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });
            prefetchCandidates = Math.min(topEntries.length, 3);
            topEntries.slice(0, 3).forEach(function(e) {
                if (gt[e.entry.id] >= 1) prefetchGtCovered++;
            });
        }

        // ── Analyze visibility ──
        var allVisibleIds = {};
        var allFoldedIds = {};
        var allChainOnlyIds = {};
        var readingOrder = [];
        var groupBreakdown = {};
        var position = 0;

        function processGroup(name, group) {
            var result = analyzeFoldMissRuns(group.entries);
            groupBreakdown[name] = {
                total: group.entries.length,
                visible: result.visible.length,
                folded: result.foldedRuns.reduce(function(s, r) { return s + r.count; }, 0),
                refs: (group.refs || []).length
            };

            result.visible.forEach(function(e) {
                position++;
                var id = e.entry.id;
                readingOrder.push({ position: position, id: id, group: name, relevance: e.relevance, sources: e.sources });
                allVisibleIds[id] = true;

                if (e.sources && e.sources.length === 1 && e.sources[0].indexOf('chain:') === 0) {
                    allChainOnlyIds[id] = true;
                }
            });

            result.foldedRuns.forEach(function(run) {
                run.ids.forEach(function(id) {
                    allFoldedIds[id] = true;
                });
            });
        }

        var activeNames = [];
        var externalNames = [];
        Object.keys(grouped.groups).forEach(function(name) {
            if (q.activeEntities && q.activeEntities.indexOf(name) !== -1) {
                activeNames.push(name);
            } else {
                externalNames.push(name);
            }
        });

        activeNames.forEach(function(name) {
            processGroup(name, grouped.groups[name]);
        });

        if (grouped.unassigned && grouped.unassigned.length > 0) {
            groupBreakdown['_unassigned'] = {
                total: grouped.unassigned.length,
                visible: grouped.unassigned.length,
                folded: 0,
                refs: 0
            };
            grouped.unassigned.forEach(function(e) {
                position++;
                var id = e.entry.id;
                readingOrder.push({ position: position, id: id, group: '_unassigned', relevance: e.relevance, sources: e.sources });
                allVisibleIds[id] = true;
            });
        }

        externalNames.forEach(function(name) {
            processGroup(name, grouped.groups[name]);
        });

        // ── Compute metrics ──
        var gtVisible = [];
        var gtFolded = [];
        var gtMissing = [];
        var gtReadingPositions = [];

        gtIds.forEach(function(id) {
            if (allVisibleIds[id]) {
                gtVisible.push(id);
                var ro = readingOrder.filter(function(r) { return r.id === id; });
                ro.forEach(function(r) { gtReadingPositions.push(r.position); });
            } else if (allFoldedIds[id]) {
                gtFolded.push(id);
            } else {
                gtMissing.push(id);
            }
        });

        // Chain injection analysis
        var chainInjectedTotal = Object.keys(allChainOnlyIds).length;
        var chainInjectedGT = Object.keys(allChainOnlyIds).filter(function(id) { return gt[id] >= 1; }).length;

        // Raw rank positions of GT (from rawIds)
        var rawGtPositions = {};
        rawIds.forEach(function(id, idx) {
            if (gt[id] >= 1) rawGtPositions[id] = idx + 1;
        });

        // Raw rank positions that exist
        var rawGtFound = Object.keys(rawGtPositions).length;

        var row = {
            queryId: q.id,
            type: q.type,
            query: q.query.substring(0, 50),
            gtTotal: gtTotal,
            rawTopK: rawIds.length,
            rawGtFound: rawGtFound,
            rawGtFoundRate: rawGtFound / gtTotal,
            gtVisible: gtVisible.length,
            gtVisibleRate: gtVisible.length / gtTotal,
            gtFolded: gtFolded.length,
            gtMissing: gtMissing.length,
            chainInjectedTotal: chainInjectedTotal,
            chainInjectedGT: chainInjectedGT,
            totalVisible: readingOrder.length,
            totalGroups: Object.keys(groupBreakdown).length,
            gtMedianReadPos: gtReadingPositions.length > 0 ?
                gtReadingPositions.sort(function(a, b) { return a - b; })[Math.floor(gtReadingPositions.length / 2)] : null,
            gtReadPositions: gtReadingPositions,
            gtRawPositions: rawGtPositions,
            prefetchCandidates: prefetchCandidates,
            prefetchGtCovered: prefetchGtCovered,
        };

        process.stdout.write(
            'GT=' + gtTotal +
            ' raw=' + rawGtFound + '(' + pct(rawGtFound, gtTotal) + ')' +
            ' vis=' + gtVisible.length + '(' + pct(gtVisible.length, gtTotal) + ')' +
            ' fold=' + gtFolded.length +
            ' miss=' + gtMissing.length +
            ' chain+' + chainInjectedTotal + '(GT:' + chainInjectedGT + ')' +
            ' medPos=' + (row.gtMedianReadPos != null ? row.gtMedianReadPos : '—') +
            ' prefGT=' + prefetchGtCovered + '/' + prefetchCandidates + '\n'
        );

        perQueryRows.push(row);
    }

    // ── Aggregate Summary ──
    console.log('\n' + '═'.repeat(70));
    console.log('=== AGGREGATE SUMMARY ===\n');

    var agg = {
        gtTotal: perQueryRows.reduce(function(s, r) { return s + r.gtTotal; }, 0),
        rawGtFound: perQueryRows.reduce(function(s, r) { return s + r.rawGtFound; }, 0),
        gtVisible: perQueryRows.reduce(function(s, r) { return s + r.gtVisible; }, 0),
        gtFolded: perQueryRows.reduce(function(s, r) { return s + r.gtFolded; }, 0),
        gtMissing: perQueryRows.reduce(function(s, r) { return s + r.gtMissing; }, 0),
        chainInjectedTotal: perQueryRows.reduce(function(s, r) { return s + r.chainInjectedTotal; }, 0),
        chainInjectedGT: perQueryRows.reduce(function(s, r) { return s + r.chainInjectedGT; }, 0),
        totalVisible: perQueryRows.reduce(function(s, r) { return s + r.totalVisible; }, 0),
        prefetchCandidates: perQueryRows.reduce(function(s, r) { return s + r.prefetchCandidates; }, 0),
        prefetchGtCovered: perQueryRows.reduce(function(s, r) { return s + r.prefetchGtCovered; }, 0),
    };

    console.log('Ground Truth total entries:  ' + agg.gtTotal);
    console.log('Raw recall:                 ' + agg.rawGtFound + ' GT found (' + pct(agg.rawGtFound, agg.gtTotal) + ')');
    console.log('Post-processing visible:    ' + agg.gtVisible + ' GT visible (' + pct(agg.gtVisible, agg.gtTotal) + ')');
    console.log('Post-processing folded:     ' + agg.gtFolded + ' GT folded (' + pct(agg.gtFolded, agg.gtTotal) + ')');
    console.log('Post-processing missing:    ' + agg.gtMissing + ' GT missing (' + pct(agg.gtMissing, agg.gtTotal) + ')');
    console.log('Chain-only entries added:   ' + agg.chainInjectedTotal + ' (of which GT: ' + agg.chainInjectedGT + ')');
    console.log('Total visible after pack:   ' + agg.totalVisible);
    if (allChatMessages && allChatMessages.length > 0) {
        console.log('Prefetch coverage:          ' + agg.prefetchGtCovered + '/' + agg.prefetchCandidates +
                    ' GT-in-top3 slots (' + (agg.prefetchCandidates > 0 ? pct(agg.prefetchGtCovered, agg.prefetchCandidates) : 'N/A') + ')');
    }

    // Per-query position shift analysis
    console.log('\n=== Position Shift: Raw Rank → Reading Order ===\n');
    var allShifts = [];
    perQueryRows.forEach(function(row) {
        if (row.gtReadPositions.length === 0) return;
        var readPos = row.gtMedianReadPos;
        if (readPos == null) return;
        var rawPositions = Object.values(row.gtRawPositions);
        if (rawPositions.length === 0) return;
        var rawMedian = rawPositions.sort(function(a, b) { return a - b; })[Math.floor(rawPositions.length / 2)];
        var shift = readPos - rawMedian;
        allShifts.push({
            queryId: row.queryId,
            rawMedian: rawMedian,
            readMedian: readPos,
            shift: shift
        });
    });

    var posShiftMed = allShifts.length > 0 ?
        allShifts.map(function(s) { return s.shift; }).sort(function(a, b) { return a - b; })[Math.floor(allShifts.length / 2)] : 0;
    var posShiftAvg = allShifts.length > 0 ? avg(allShifts.map(function(s) { return s.shift; })) : 0;
    var shiftedLater = allShifts.filter(function(s) { return s.shift > 5; }).length;
    var shiftedEarlier = allShifts.filter(function(s) { return s.shift < -5; }).length;

    console.log('Median position shift: ' + f(posShiftMed, 1) + ' (positive = pushed later in reading order)');
    console.log('Mean position shift:   ' + f(posShiftAvg, 1));
    console.log('Queries pushed later (>5):  ' + shiftedLater + '/' + allShifts.length);
    console.log('Queries pulled earlier (<-5): ' + shiftedEarlier + '/' + allShifts.length);

    // ── Report ──
    var lines = [];
    lines.push('# Pre/Post Packaging Comparison');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Pipeline**: BM25(TOP_K=' + TOP_K_BM25 + ') + Vector(bge-m3, TOP_K=' + TOP_K_VEC + ') → Lin α=0.20');
    lines.push('**Post-processing**: mergePipelines → groupCandidatesByEntity → foldMissRuns');
    lines.push('**Queries**: ' + queries.length);
    lines.push('');

    // Aggregate table
    lines.push('## Aggregate Metrics');
    lines.push('');
    lines.push('| Metric | Raw Recall | Post-Processing | Δ |');
    lines.push('|--------|-----------|-----------------|---|');
    lines.push('| GT Recall | ' + agg.rawGtFound + '/' + agg.gtTotal + ' (' + pct(agg.rawGtFound, agg.gtTotal) + ') | ' + (agg.gtVisible + agg.gtFolded) + '/' + agg.gtTotal + ' (' + pct(agg.gtVisible + agg.gtFolded, agg.gtTotal) + ') | — |');
    lines.push('| GT Visible | ' + agg.rawGtFound + ' (ranked) | ' + agg.gtVisible + ' (visible, ' + pct(agg.gtVisible, agg.gtTotal) + ') | ' + f(agg.gtVisible - agg.rawGtFound) + ' |');
    lines.push('| GT Folded (lost) | — | ' + agg.gtFolded + ' (' + pct(agg.gtFolded, agg.gtTotal) + ') | — |');
    lines.push('| GT Missing (not in pack) | ' + (agg.gtTotal - agg.rawGtFound) + ' (' + pct(agg.gtTotal - agg.rawGtFound, agg.gtTotal) + ') | ' + agg.gtMissing + ' (' + pct(agg.gtMissing, agg.gtTotal) + ') | ' + f(agg.gtMissing - (agg.gtTotal - agg.rawGtFound)) + ' |');
    lines.push('| Chain-only injection | — | ' + agg.chainInjectedTotal + ' entries (GT: ' + agg.chainInjectedGT + ') | — |');
    lines.push('| Total visible entries | ' + '~' + TOP_K_BM25 + ' (fixed) | ' + agg.totalVisible + ' (dynamic) | — |');
    lines.push('');

    // Per-query detail
    lines.push('## Per-Query Detail');
    lines.push('');
    var pqHeaders = ['ID', 'Type', 'GT#', 'Raw Found', 'Raw%', 'Visible', 'Vis%', 'Folded', 'Missing', 'Chain+', 'ChainGT', 'MedReadPos'];
    lines.push('| ' + pqHeaders.join(' | ') + ' |');
    lines.push('|' + pqHeaders.map(function() { return '---'; }).join('|') + '|');

    perQueryRows.forEach(function(r) {
        lines.push('| ' + [
            r.queryId,
            r.type,
            r.gtTotal,
            r.rawGtFound,
            pct(r.rawGtFound, r.gtTotal),
            r.gtVisible,
            pct(r.gtVisible, r.gtTotal),
            r.gtFolded,
            r.gtMissing,
            r.chainInjectedTotal,
            r.chainInjectedGT,
            r.gtMedianReadPos != null ? r.gtMedianReadPos : '—'
        ].join(' | ') + ' |');
    });

    // Aggregate row
    lines.push('| **SUM** | — | **' + agg.gtTotal + '** | **' + agg.rawGtFound + '** | **' + pct(agg.rawGtFound, agg.gtTotal) + '** | **' + agg.gtVisible + '** | **' + pct(agg.gtVisible, agg.gtTotal) + '** | **' + agg.gtFolded + '** | **' + agg.gtMissing + '** | **' + agg.chainInjectedTotal + '** | **' + agg.chainInjectedGT + '** | — |');
    lines.push('');

    // Position shift analysis
    lines.push('## Position Shift: Raw Rank → Reading Order');
    lines.push('');
    lines.push('- **Median shift**: ' + f(posShiftMed, 1) + ' (positive = pushed later)');
    lines.push('- **Mean shift**: ' + f(posShiftAvg, 1));
    lines.push('- **Shifted later (>5)**: ' + shiftedLater + '/' + allShifts.length);
    lines.push('- **Shifted earlier (<-5)**: ' + shiftedEarlier + '/' + allShifts.length);
    lines.push('');

    if (allShifts.length > 0) {
        lines.push('| Query | Raw Median Rank | Read Median Pos | Shift |');
        lines.push('|-------|----------------|-----------------|-------|');
        allShifts.sort(function(a, b) { return b.shift - a.shift; }).forEach(function(s) {
            var icon = s.shift > 10 ? '🔴' : s.shift > 5 ? '🟡' : '🟢';
            lines.push('| ' + s.queryId + ' | ' + s.rawMedian + ' | ' + s.readMedian + ' | ' + icon + ' ' + (s.shift > 0 ? '+' : '') + f(s.shift, 1) + ' |');
        });
    }
    lines.push('');

    // Key insights
    lines.push('## Key Insights');
    lines.push('');
    lines.push('### 1. Visibility Impact');
    lines.push('- Raw recall catches **' + agg.rawGtFound + '/' + agg.gtTotal + '** GT entries across all queries');
    lines.push('- Post-processing **folds ' + agg.gtFolded + '** GT entries that were found by raw recall');
    lines.push('- Post-processing **misses ' + agg.gtMissing + '** GT entries entirely (never in BM25 results)');
    lines.push('- Net visibility: **' + agg.gtVisible + '/' + agg.gtTotal + '** (' + pct(agg.gtVisible, agg.gtTotal) + ') visible in final output');
    lines.push('');
    lines.push('### 2. Chain Injection');
    lines.push('- ' + agg.chainInjectedTotal + ' entries added purely via entity chains (not in BM25 results)');
    lines.push('- Of these, **' + agg.chainInjectedGT + '** are ground truth — chains recover GT that BM25 missed');
    lines.push('- Chain injection is ' + (agg.chainInjectedGT > 0 ? 'beneficial' : 'neutral') + ' for recall');
    lines.push('');
    lines.push('### 3. Position Distortion');
    lines.push('- Median reading position shift: **' + f(posShiftMed, 1) + '** — GT items move ' + (posShiftMed > 2 ? 'significantly later' : posShiftMed < -2 ? 'significantly earlier' : 'roughly the same') + ' in reading order');
    lines.push('- Entity grouping + period sorting fundamentally changes the attention ranking');
    lines.push('');

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'packaging-comparison.md');
    writeFileSync(outPath, withProvenanceHeader('packaging', report), 'utf-8');

    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Packaging comparison crashed:', e);
    process.exit(2);
});
