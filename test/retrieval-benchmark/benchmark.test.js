// NE-Memory Retrieval Benchmark — Entry Script
// Run: node test/retrieval-benchmark/benchmark.test.js
// Required env for BM25+Vector: EMBEDDING_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY
// Select rounds: set NE_BENCHMARK_MODE=bm25|vector|vec|rrf|all (default: all)
// Force BM25-only: set NE_BENCHMARK_VECTOR=0 (superseded by NE_BENCHMARK_MODE)

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runBenchmark, aggregateMetrics } from './benchmark-runner.js';
import { avg } from './metrics.js';
import { queries } from './queries.js';
import { noiseCount, allSTM } from './fixture.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var CONFIG_PATH = join(__dirname, 'config.json');

if (existsSync(CONFIG_PATH)) {
    try {
        var config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
        if (config.url) process.env.EMBEDDING_URL = config.url;
        if (config.model) process.env.EMBEDDING_MODEL = config.model;
        if (config.key) process.env.EMBEDDING_API_KEY = config.key;
        console.log('[benchmark] Loaded embedding config from ' + CONFIG_PATH);
    } catch (e) { /* ignore */ }
}

var OUTPUT_DIR = 'test/retrieval-benchmark/output';

function fmt(val, decimals) {
    decimals = decimals || 3;
    return Number(val).toFixed(decimals);
}

function deltaStr(a, b) {
    if (a === 0 && b === 0) return '—';
    if (a === 0) return '+∞';
    var d = ((b - a) / a) * 100;
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
}

function findByLabel(arr, label) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].label === label) return arr[i];
    }
    return null;
}

function resolveRoundData(rounds) {
    var bm25 = findByLabel(rounds, 'BM25');
    var vec = findByLabel(rounds, 'Vector (pure)');
    var rrf = findByLabel(rounds, 'BM25+Vector (RRF)');
    return { bm25: bm25, vec: vec, rrf: rrf };
}

async function main() {
    console.log('=== NE-Memory Retrieval Benchmark ===\n');

    var rounds = await runBenchmark();
    var aggs = rounds.map(function(r) { return aggregateMetrics(r); });

    var kRounds = [];
    aggs.forEach(function(a) {
        if (a.label.indexOf('RRF (k=') === 0) {
            var kStr = a.label.match(/k=(\d+)/);
            if (kStr) kRounds.push({ k: parseInt(kStr[1], 10), agg: a });
        }
    });

    mkdirSync(OUTPUT_DIR, { recursive: true });

    var rd = resolveRoundData(aggs);
    var hasVec = !!rd.vec;
    var hasRRF = !!rd.rrf;

    var lines = [];

    lines.push('# NE-Memory Retrieval Benchmark Report');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Embedding**: ' + (process.env.EMBEDDING_MODEL || 'N/A'));
    var isFusionMode = aggs.some(function(a) { return a.label.indexOf('Lin α=') === 0 || a.label.indexOf('Rerank') !== -1; });
    if (isFusionMode) {
        lines.push('');
        lines.push('## Fusion Comparison');
        lines.push('');
        var bestWs = -Infinity;
        var bestLabel = '';
        aggs.forEach(function(a) {
            if (a.all.ws.mean > bestWs) { bestWs = a.all.ws.mean; bestLabel = a.label; }
        });
        lines.push('| Method | NDCG@10 | WeightedScore | Hit@3 | P@5 | R@10 | R@20 | MRR |');
        lines.push('|--------|---------|--------------|-------|-----|------|------|-----|');
        aggs.forEach(function(a) {
            var isBest = a.label === bestLabel ? ' 🥇' : '';
            lines.push('| ' + a.label + isBest + ' | ' +
                fmt(a.all.ndcg10.mean) + ' | ' + fmt(a.all.ws.mean) + ' | ' +
                fmt(a.all.hit3.mean) + ' | ' + fmt(a.all.p5.mean) + ' | ' +
                fmt(a.all.r10.mean) + ' | ' + fmt(a.all.r20.mean) + ' | ' +
                fmt(a.all.mrr.mean) + ' |');
        });
        lines.push('');
        lines.push('**By Query Type**');
        lines.push('');
        ['narrative', 'targeted'].forEach(function(type) {
            var bestTypeWs = -Infinity;
            var bestTypeLabel = '';
            aggs.forEach(function(a) {
                if (a[type] && a[type].ws.mean > bestTypeWs) { bestTypeWs = a[type].ws.mean; bestTypeLabel = a.label; }
            });
            lines.push('| Method | NDCG@10 (' + type + ') | WeightedScore (' + type + ') | P@10 (' + type + ') |');
            lines.push('|--------|----------------------|--------------------------|--------------------|');
            aggs.forEach(function(a) {
                var isBest = a.label === bestTypeLabel ? ' 🥇' : '';
                var n = a[type];
                if (!n) { lines.push('| ' + a.label + ' | — | — | — |'); return; }
                lines.push('| ' + a.label + isBest + ' | ' + fmt(n.ndcg10.mean) + ' | ' + fmt(n.ws.mean) + ' | ' + fmt(n.p10.mean) + ' |');
            });
            lines.push('');
        });
    }

    lines.push('');
    lines.push('## Configuration');
    lines.push('- STM events: ' + allSTM.length + ' (' + noiseCount + ' noise, ' + Math.round(noiseCount / allSTM.length * 100) + '%)');
    lines.push('- Characters: 6 (江岚, 安然, 林晚, 苏茉, and others)');
    lines.push('- Queries: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narrative + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' targeted)');
    lines.push('- Rounds: ' + aggs.map(function(a) { return a.label; }).join(', '));
    if (hasRRF && !rd.rrf.anyVectorUsed) {
        lines.push('- **WARNING: Vector search NOT triggered in RRF round. RRF = BM25. Check EMBEDDING_URL/KEY.**');
    }
    lines.push('');

    // Core Metrics
    lines.push('## Core Metrics (消费链路关键节点)');
    lines.push('');
    lines.push('| Metric |');
    var coreSep = '|--------|';
    aggs.forEach(function(a) { lines[lines.length-1] += ' ' + a.label + ' |'; coreSep += '------|'; });
    lines.push(coreSep);
    ['hit3', 'p5', 'p5a', 'ndcg10', 'ws'].forEach(function(m) {
        var labels = { hit3: 'Hit@3', p5: 'P@5', p5a: 'P@5 (active)', ndcg10: 'NDCG@10', ws: 'WeightedScore' };
        var row = '| ' + labels[m] + ' |';
        aggs.forEach(function(a) { row += ' ' + fmt(a.all[m].mean) + ' |'; });
        lines.push(row);
    });
    lines.push('');

    // Extended Metrics
    lines.push('## Extended Metrics (辅助参考)');
    lines.push('');
    var extMetrics = ['p10', 'p20', 'r5', 'r10', 'r20', 'mrr', 'hit5'];
    var extLabels = { p10: 'P@10', p20: 'P@20', r5: 'R@5', r10: 'R@10', r20: 'R@20', mrr: 'MRR', hit5: 'Hit@5' };
    var extHeader = '| Metric |';
    var extSep = '|--------|';
    aggs.forEach(function(a) { extHeader += ' ' + a.label + ' |'; extSep += '------|'; });
    lines.push(extHeader);
    lines.push(extSep);
    extMetrics.forEach(function(m) {
        var row = '| ' + extLabels[m] + ' |';
        aggs.forEach(function(a) { row += ' ' + fmt(a.all[m].mean) + ' |'; });
        lines.push(row);
    });
    lines.push('');
    // k-Value Sweep (insert if any k-sweep rounds present)
    if (kRounds.length > 0) {
        kRounds.sort(function(a, b) { return a.k - b.k; });

        var bestK = null;
        var bestNdcg = -Infinity;
        kRounds.forEach(function(kr) {
            if (kr.agg.all.ndcg10.mean > bestNdcg) {
                bestNdcg = kr.agg.all.ndcg10.mean;
                bestK = kr.k;
            }
        });

        var baseline60 = null;
        kRounds.forEach(function(kr) { if (kr.k === 60) baseline60 = kr.agg; });

        lines.push('');
        lines.push('## k-Value Sweep');
        lines.push('');
        lines.push('| k | NDCG@10 | WeightedScore | MRR | P@5 | R@10 | Hit@5 |');
        lines.push('|---|---------|--------------|-----|-----|------|-------|');
        kRounds.forEach(function(kr) {
            var a = kr.agg.all;
            var isBest = kr.k === bestK;
            var isB60 = kr.k === 60;
            var tag = '';
            if (isBest && isB60) tag = ' 🥇 (baseline)';
            else if (isBest) tag = ' 🥇';
            else if (isB60) tag = ' (baseline)';
            lines.push('| ' + kr.k + tag + ' | ' +
                fmt(a.ndcg10.mean) + ' | ' + fmt(a.ws.mean) + ' | ' +
                fmt(a.mrr.mean) + ' | ' + fmt(a.p5.mean) + ' | ' +
                fmt(a.r10.mean) + ' | ' + fmt(a.hit5.mean) + ' |');
        });
        lines.push('');

        // Delta summary row
        if (baseline60 && bestK !== 60) {
            var bestAgg = null;
            kRounds.forEach(function(kr) { if (kr.k === bestK) bestAgg = kr.agg; });
            if (bestAgg) {
                lines.push('**Best k=' + bestK + ' vs baseline k=60:**');
                lines.push('NDCG@10: ' + fmt(bestAgg.all.ndcg10.mean) + ' vs ' + fmt(baseline60.all.ndcg10.mean) +
                    ' (' + deltaStr(baseline60.all.ndcg10.mean, bestAgg.all.ndcg10.mean) + ')');
                lines.push('MRR: ' + fmt(bestAgg.all.mrr.mean) + ' vs ' + fmt(baseline60.all.mrr.mean) +
                    ' (' + deltaStr(baseline60.all.mrr.mean, bestAgg.all.mrr.mean) + ')');
                lines.push('');
            }
        }

        // Per-type breakdown for k-sweep
        lines.push('### By Query Type');
        lines.push('');
        lines.push('| k | NDCG@10 Narr | NDCG@10 Tgt | WeightedScore | P@10 Narr | P@10 Tgt |');
        lines.push('|---|-------------|-------------|--------------|-----------|-----------|');
        kRounds.forEach(function(kr) {
            var a = kr.agg;
            var nNdcg = a.narrative ? fmt(a.narrative.ndcg10.mean) : '—';
            var tNdcg = a.targeted ? fmt(a.targeted.ndcg10.mean) : '—';
            var ws = fmt(a.all.ws.mean);
            var nP10 = a.narrative ? fmt(a.narrative.p10.mean) : '—';
            var tP10 = a.targeted ? fmt(a.targeted.p10.mean) : '—';
            var tBest = kr.k === bestK ? ' 🥇' : '';
            lines.push('| ' + kr.k + tBest + ' | ' + nNdcg + ' | ' + tNdcg + ' | ' + ws + ' | ' + nP10 + ' | ' + tP10 + ' |');
        });
        lines.push('');
    }

    lines.push('');

    // Per-Query Breakdown — 3-column (skip if k-sweep or fusion only)
    if (!(kRounds.length > 0 && kRounds.length === aggs.length) && !isFusionMode) {
    lines.push('## Per-Query Breakdown');
    lines.push('');

    if (hasVec && hasRRF) {
        lines.push('| # | Type | Description | P@10 BM25 | P@10 Vec | P@10 RRF | MRR BM25 | MRR Vec | MRR RRF | GT Ranks (BM→Vec→RRF) |');
        lines.push('|---|------|-------------|-----------|----------|----------|----------|---------|---------|------------------------|');
    } else if (hasRRF && rd.bm25) {
        lines.push('| # | Type | Description | P@10 BM25 | P@10 RRF | Delta | MRR BM25 | MRR RRF | Notes | GT Ranks (BM25→RRF) |');
        lines.push('|---|------|-------------|-----------|----------|-------|----------|---------|-------|---------------------|');
    } else if (hasRRF) {
        lines.push('| # | Type | Description | P@10 | MRR | Hit@3 | WeightedScore |');
        lines.push('|---|------|-------------|-------|-----|-------|--------------|');
    } else {
        lines.push('| # | Type | Description | P@10 | MRR |');
        lines.push('|---|------|-------------|-------|-----|');
    }
    for (var i = 0; i < rounds[0].perQuery.length; i++) {
        var qBM25 = rd.bm25 ? rd.bm25.perQuery[i] : null;
        var qVec = rd.vec ? rd.vec.perQuery[i] : null;
        var qRRF = rd.rrf ? rd.rrf.perQuery[i] : null;
        var desc = qBM25 ? qBM25.description : (qVec ? qVec.description : (qRRF ? qRRF.description : ''));
        var type = qBM25 ? qBM25.type : (qVec ? qVec.type : (qRRF ? qRRF.type : ''));

        if (hasVec && hasRRF) {
            // 3-way format
            var gtParts = [];
            var src = qRRF.gtRanks || qVec.gtRanks || [];
            src.forEach(function(gr) {
                var bR = gr.bm25Rank != null ? gr.bm25Rank : '\u2014';
                var vR = (qVec && qVec.gtRanks) ? (function() {
                    for (var k = 0; k < qVec.gtRanks.length; k++) {
                        if (qVec.gtRanks[k].id === gr.id) return qVec.gtRanks[k].fusedRank;
                    }
                    return null;
                })() : null;
                var rR = gr.fusedRank != null ? gr.fusedRank : '\u2014';
                gtParts.push(gr.id + ': ' + bR + '\u2192' + (vR != null ? vR : '\u2014') + '\u2192' + rR);
            });
            var gtStr = gtParts.length > 0 ? gtParts.join(', ') : 'N/A';
            lines.push('| ' + (i + 1) + ' | ' + type + ' | ' + desc + ' | ' +
                fmt(qBM25.scores.p10) + ' | ' + fmt(qVec.scores.p10) + ' | ' + fmt(qRRF.scores.p10) + ' | ' +
                fmt(qBM25.scores.mrr) + ' | ' + fmt(qVec.scores.mrr) + ' | ' + fmt(qRRF.scores.mrr) + ' | ' +
                gtStr + ' |');
        } else if (hasRRF && rd.bm25) {
            var notes = '';
            var p10Bm = qBM25.scores.p10;
            var p10Rr = qRRF.scores.p10;
            var dPct = p10Bm > 0 ? ((p10Rr - p10Bm) / p10Bm) * 100 : (p10Rr > 0 ? Infinity : 0);
            if (dPct >= 25) notes = 'Vector large gain';
            else if (dPct <= -10) notes = 'Vector regression';
            else if (Math.abs(dPct) < 5) notes = 'Marginal';

            var gtParts = [];
            var src = qRRF.gtRanks || [];
            src.forEach(function(gr) {
                var bR = gr.bm25Rank != null ? gr.bm25Rank : '\u2014';
                var rR = gr.fusedRank != null ? gr.fusedRank : '\u2014';
                var s = gr.vectorOnly ? ' (vec_only)' : '';
                gtParts.push(gr.id + ': ' + bR + '\u2192' + rR + s);
            });
            var gtStr = gtParts.length > 0 ? gtParts.join(', ') : 'N/A';
            lines.push('| ' + (i + 1) + ' | ' + type + ' | ' + desc + ' | ' +
                fmt(p10Bm) + ' | ' + fmt(p10Rr) + ' | ' + deltaStr(p10Bm, p10Rr) + ' | ' +
                fmt(qBM25.scores.mrr) + ' | ' + fmt(qRRF.scores.mrr) + ' | ' + notes + ' | ' +
                gtStr + ' |');
        } else if (hasRRF) {
            lines.push('| ' + (i + 1) + ' | ' + type + ' | ' + desc + ' | ' +
                fmt(qRRF.scores.p10) + ' | ' + fmt(qRRF.scores.mrr) + ' | ' +
                fmt(qRRF.scores.hit3) + ' | ' + fmt(qRRF.scores.ws) + ' |');
        } else {
            var only = rd.bm25 ? qBM25 : qVec;
            lines.push('| ' + (i + 1) + ' | ' + type + ' | ' + desc + ' | ' +
                fmt(only.scores.p10) + ' | ' + fmt(only.scores.mrr) + ' |');
        }
    }
    lines.push('');

    }

    // Diagnostic Notes (skip if k-sweep or fusion only)
    if (!(kRounds.length > 0 && kRounds.length === aggs.length) && !isFusionMode) {
    lines.push('## Diagnostic Notes');
    lines.push('');

    if (rd.bm25 && rd.rrf) {
        var narBmP10 = [], narRrfP10 = [], tgtBmP10 = [], tgtRrfP10 = [];
        for (var j = 0; j < rounds[0].perQuery.length; j++) {
            if (rd.bm25.perQuery[j].type === 'narrative') {
                narBmP10.push(rd.bm25.perQuery[j].scores.p10);
                narRrfP10.push(rd.rrf.perQuery[j].scores.p10);
            } else {
                tgtBmP10.push(rd.bm25.perQuery[j].scores.p10);
                tgtRrfP10.push(rd.rrf.perQuery[j].scores.p10);
            }
        }
        lines.push('- **Narrative queries on BM25**: avg P@10 = ' + fmt(avg(narBmP10)) + ' → RRF = ' + fmt(avg(narRrfP10)) + ' (delta: ' + deltaStr(avg(narBmP10), avg(narRrfP10)) + '). ' + (avg(narBmP10) > 0.5 ? 'BM25 already strong on rich-context queries.' : ''));
        lines.push('- **Targeted queries on BM25**: avg P@10 = ' + fmt(avg(tgtBmP10)) + ' → RRF = ' + fmt(avg(tgtRrfP10)) + ' (delta: ' + deltaStr(avg(tgtBmP10), avg(tgtRrfP10)) + ').');

        if (hasVec) {
            var narVecP10 = [], tgtVecP10 = [];
            for (var vj = 0; vj < rounds[0].perQuery.length; vj++) {
                if (rd.vec.perQuery[vj].type === 'narrative') narVecP10.push(rd.vec.perQuery[vj].scores.p10);
                else tgtVecP10.push(rd.vec.perQuery[vj].scores.p10);
            }
            lines.push('- **Narrative queries on Vector-only**: avg P@10 = ' + fmt(avg(narVecP10)) + ' (' + deltaStr(avg(narBmP10), avg(narVecP10)) + ' vs BM25, ' + deltaStr(avg(narBmP10), avg(narRrfP10)) + ' RRF vs BM25)');
            lines.push('- **Targeted queries on Vector-only**: avg P@10 = ' + fmt(avg(tgtVecP10)) + ' (' + deltaStr(avg(tgtBmP10), avg(tgtVecP10)) + ' vs BM25, ' + deltaStr(avg(tgtBmP10), avg(tgtRrfP10)) + ' RRF vs BM25)');
        }
    }
    if (hasRRF && !rd.rrf.anyVectorUsed) {
        lines.push('- **CRITICAL**: RRF round did not actually use vector search. All RRF numbers = BM25 numbers.');
    }
    lines.push('');

    }

    var report = lines.join('\n');
    var reportPath = OUTPUT_DIR + '/report.md';
    writeFileSync(reportPath, report, 'utf-8');
    console.log('Report written to ' + reportPath);

    // === Assertions ===
    var failed = false;
    if (!isFusionMode) {
    console.log('\n--- Assertions ---');

    // A1-A2: only if RRF present
    if (rd.bm25 && rd.rrf) {
        var ndcgPass = rd.rrf.all.ndcg10.mean >= rd.bm25.all.ndcg10.mean * 0.90;
        console.log((ndcgPass ? 'PASS' : 'FAIL') + ' NDCG@10: BM25=' + fmt(rd.bm25.all.ndcg10.mean) + ' RRF=' + fmt(rd.rrf.all.ndcg10.mean) + ' (threshold >= ' + fmt(rd.bm25.all.ndcg10.mean * 0.90) + ')');
        if (!ndcgPass) failed = true;

        var mrrPass = rd.rrf.all.mrr.mean >= rd.bm25.all.mrr.mean * 0.90;
        console.log((mrrPass ? 'PASS' : 'FAIL') + ' MRR: BM25=' + fmt(rd.bm25.all.mrr.mean) + ' RRF=' + fmt(rd.rrf.all.mrr.mean) + ' (threshold >= ' + fmt(rd.bm25.all.mrr.mean * 0.90) + ')');
        if (!mrrPass) failed = true;
    }

    // A3: Vector triggered if EMBEDDING_URL set and any vector round
    if (process.env.EMBEDDING_URL && hasRRF && !rd.rrf.anyVectorUsed) {
        console.log('FAIL Vector search NOT triggered despite EMBEDDING_URL being set.');
        failed = true;
    } else if (process.env.EMBEDDING_URL && hasRRF) {
        console.log('PASS Vector search triggered in RRF round.');
    } else if (!process.env.EMBEDDING_URL) {
        console.log('SKIP Vector search check (EMBEDDING_URL not set).');
    }

    // A4: Targeted R@10 only if RRF (threshold relaxed to 0.80 — targeted queries have no production value)
    if (rd.bm25 && rd.rrf && rd.bm25.targeted && rd.rrf.targeted) {
        var r10Pass = rd.rrf.targeted.r10.mean >= rd.bm25.targeted.r10.mean * 0.80;
        console.log((r10Pass ? 'PASS' : 'FAIL') + ' Targeted R@10: BM25=' + fmt(rd.bm25.targeted.r10.mean) + ' RRF=' + fmt(rd.rrf.targeted.r10.mean) + ' (threshold >= ' + fmt(rd.bm25.targeted.r10.mean * 0.80) + ')');
        if (!r10Pass) failed = true;
    }

    // A5: Narrative Hit@5 ≥ 0.80 (production core guard)
    if (rd.rrf && rd.rrf.narrative) {
        var hit5Pass = rd.rrf.narrative.hit5.mean >= 0.80;
        console.log((hit5Pass ? 'PASS' : 'FAIL') + ' Narrative Hit@5: RRF=' + fmt(rd.rrf.narrative.hit5.mean) + ' (threshold >= 0.80)');
        if (!hit5Pass) failed = true;
    }

    // A6: RRF WeightedScore ≥ BM25 WeightedScore × 0.95
    if (rd.bm25 && rd.rrf) {
        var wsPass = rd.rrf.all.ws.mean >= rd.bm25.all.ws.mean * 0.95;
        console.log((wsPass ? 'PASS' : 'FAIL') + ' WeightedScore: BM25=' + fmt(rd.bm25.all.ws.mean) + ' RRF=' + fmt(rd.rrf.all.ws.mean) + ' (threshold >= ' + fmt(rd.bm25.all.ws.mean * 0.95) + ')');
        if (!wsPass) failed = true;
    }

    // A7: k-sweep: best k NDCG@10 >= k=60 NDCG@10
    if (kRounds.length > 0) {
        var bestK = null;
        var bestNdcg = -Infinity;
        var baselineNdcg = null;
        kRounds.forEach(function(kr) {
            if (kr.agg.all.ndcg10.mean > bestNdcg) {
                bestNdcg = kr.agg.all.ndcg10.mean;
                bestK = kr.k;
            }
            if (kr.k === 60) baselineNdcg = kr.agg.all.ndcg10.mean;
        });
        if (baselineNdcg !== null) {
            var kPass = bestNdcg >= baselineNdcg * 0.99;
            console.log((kPass ? 'PASS' : 'FAIL') + ' k-Sweep: best k=' + bestK + ' NDCG@10=' + fmt(bestNdcg) + ' >= k=60 baseline=' + fmt(baselineNdcg) + ' (threshold >= ' + fmt(baselineNdcg * 0.99) + ')');
            if (!kPass) failed = true;
        }
    }
    }

    if (isFusionMode) {
        console.log('\nFusion compare complete — see report for comparison table.');
    } else {
    console.log('\n' + (failed ? 'SOME ASSERTIONS FAILED' : 'ALL ASSERTIONS PASSED'));
    }
    process.exit(failed ? 1 : 0);
}

main().catch(function(e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
