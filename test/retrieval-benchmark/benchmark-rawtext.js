// NE-Memory: Raw Text vs Summary Retrieval Benchmark
// Tests: does reranker gain value when documents are long (raw dialogue)?
// Four-way comparison: STM+Lin, STM+Lin+Rerank, RAW+Lin, RAW+Lin+Rerank

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse, rerankFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var CONFIG_PATH = join(__dirname, 'config.json');
var config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
var CHAT_ID_PREFIX = '__bench_rawtext_';
var TOP_K = 40;

function f(v, d) { d = d || 3; return v.toFixed(d); }

// ── Expand STM summaries into simulated raw dialogue ──
function expandToRawText(entry) {
    var raw = '';

    var chars = (entry.entities || []).map(function(e) { return e.name; });
    var scene = entry.scene || '';
    var event = entry.event || entry.summary || '';
    var period = entry.period || '';

    raw += '[' + period + '] ' + scene + '\n\n';

    // Build simulated multi-message dialogue
    if (chars.length >= 2) {
        var lines = [];
        var a = chars[0], b = chars[1];

        // Narrator setup
        lines.push('*' + scene + '，' + period + '。' + a + '和' + b + '都在场。*');

        // Dialogue turns based on event
        for (var ti = 0; ti < 4; ti++) {
            if (ti === 0) {
                if (event.indexOf('提议') !== -1 || event.indexOf('提出') !== -1) {
                    lines.push(a + '：「我觉得我们可以换个思路。」');
                    lines.push(b + '：「什么意思？」');
                } else if (event.indexOf('争吵') !== -1 || event.indexOf('争执') !== -1) {
                    lines.push(a + '：「我不同意你这个观点。」');
                    lines.push(b + '：「你每次都这样，根本不考虑我的感受。」');
                    lines.push(a + '：「我没有不考虑你的感受，我只是觉得这样更合理。」');
                } else if (event.indexOf('合作') !== -1 || event.indexOf('协议') !== -1) {
                    lines.push(a + '：「那这样吧，我们合作。」');
                    lines.push(b + '：「你确定？」');
                    lines.push(a + '：「当然，我什么时候骗过你。」');
                } else if (event.indexOf('发现') !== -1 || event.indexOf('注意到') !== -1) {
                    lines.push(a + '：「你看这个。」');
                    lines.push(b + '：「嗯？怎么了？」');
                    lines.push(a + '：「你不觉得有点奇怪吗？」');
                } else if (event.indexOf('安慰') !== -1 || event.indexOf('安慰') !== -1) {
                    lines.push(a + '：「别难过了。」');
                    lines.push(b + '：「我没有难过。」');
                    lines.push(a + '：「骗人，你眼眶都红了。」');
                    lines.push(b + '：「……谢谢。」');
                } else {
                    lines.push(a + '：「' + event.substring(0, Math.min(15, event.length)) + '……」');
                    lines.push(b + '：「你是认真的吗？」');
                    lines.push(a + '：「当然。我已经想了很久了。」');
                }
            } else if (ti === 1) {
                lines.push(b + '：「说实话，我之前也有这种感觉。」');
                lines.push(a + '：「那你为什么不早说？」');
                lines.push(b + '：「因为我不想显得……你知道的。」');
            } else if (ti === 2) {
                lines.push(a + '：「不过这样也好。至少我们现在达成一致了。」');
                lines.push(b + '：「是啊。虽然过程有点曲折。」');
            } else {
                lines.push('*两人沉默了一会儿，各自想着心事。*');
                lines.push(a + '：「那接下来怎么办？」');
                lines.push(b + '：「走一步看一步吧。反正我们有的是时间。」');
            }
        }
        raw += lines.join('\n');
    } else if (chars.length === 1) {
        var c = chars[0];
        raw += '*' + scene + '，' + period + '。' + c + '独自一人在场。*\n';
        raw += c + '深吸了一口气。' + scene + '很安静，只有远处偶尔传来的声音。\n';
        raw += c + '：「' + event.substring(0, Math.min(20, event.length)) + '……这倒是没想到。」\n';
        raw += '他/她低头看了看手机，屏幕上没有任何新消息。\n';
        raw += '想了想，还是决定继续做手头的事。毕竟时间不等人。';
    } else {
        raw += '场景：' + scene + '。' + period + '。\n';
        raw += event;
    }

    raw += '\n';
    return raw;
}

// Build raw-text STM dataset
function buildRawSTM() {
    return allSTM.map(function(entry) {
        var rawText = expandToRawText(entry);
        var rawEntry = Object.assign({}, entry);
        // Replace event with raw dialogue for indexing; keep original event for metadata
        rawEntry._original_summary = entry.event;
        rawEntry.event = rawText;
        rawEntry.raw_mode = true;
        return rawEntry;
    });
}

function buildSTById(stmArr) {
    var map = {};
    stmArr.forEach(function(s) {
        map[s.id] = s;
        map[s.__id || s.id] = s;
    });
    return map;
}

function setModel(modelName) {
    process.env.EMBEDDING_URL = modelName === 'BAAI/bge-m3' ? config.url : config.url;
    process.env.EMBEDDING_MODEL = modelName;
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

async function buildVecIndex(stmArr, chatId, modelName) {
    setModel(modelName);
    resetVectorIndex(chatId);
    await ensureVectorIndex(stmArr, {}, chatId);
    return getVectorIndex(chatId);
}

async function runBM25AndVec(stmArr, vecIdx, chatId, modelName) {
    setModel(modelName);
    delete process.env.NE_BENCHMARK_VECTOR;
    var bm25PerQuery = [];
    var bm25Ids = [];
    var vecPerQuery = [];
    var vecIds = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;

        var bm25Results = await filterCandidates(q.query, stmArr, allLTM, TOP_K, 3, {}, chatId);
        var bm25List = bm25Results.map(function(r) { return r.__id || r.id; });
        bm25Ids.push(bm25List);

        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K);
        var vecList = vecResults.map(function(v) { return v.entry.id; });
        vecIds.push(vecList);

        var gt = q.groundTruth;
        bm25PerQuery.push({ ids: bm25List, scores: calcScores(bm25List, gt, q) });
        vecPerQuery.push({ ids: vecList, scores: calcScores(vecList, gt, q) });
    }
    return { bm25PerQuery: bm25PerQuery, bm25Ids: bm25Ids, vecPerQuery: vecPerQuery, vecIds: vecIds };
}

function calcScores(ids, gt, q) {
    var s = {
        p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
        r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
        ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
        hit3: hitAtK(ids, gt, 3),
        p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
    };
    s.ws = weightedScore(s);
    return s;
}

function aggregate(perQuery, label) {
    var sQ = perQuery.map(function(q) { return q.scores; });
    return {
        label: label,
        p5: avg(sQ.map(function(s) { return s.p5; })),
        p10: avg(sQ.map(function(s) { return s.p10; })),
        ndcg10: avg(sQ.map(function(s) { return s.ndcg10; })),
        mrr: avg(sQ.map(function(s) { return s.mrr; })),
        hit3: avg(sQ.map(function(s) { return s.hit3; })),
        hit5: avg(sQ.map(function(s) { return s.hit5; })),
        r10: avg(sQ.map(function(s) { return s.r10; })),
        r20: avg(sQ.map(function(s) { return s.r20; })),
        p5a: avg(sQ.map(function(s) { return s.p5a; })),
        ws: avg(sQ.map(function(s) { return s.ws; })),
    };
}

async function runScenario(label, stmArr, chatId, runRerank, modelName) {
    process.stdout.write('  Setup vec index (' + modelName + ') ... ');
    var vecIdx = await buildVecIndex(stmArr, chatId, modelName);
    var stmById = buildSTById(stmArr);
    console.log('done (' + vecIdx.size + ' entries)');

    process.stdout.write('  BM25+Vector retrieval ... ');
    var bm25AndVec = await runBM25AndVec(stmArr, vecIdx, chatId, modelName);
    var bm25Agg = aggregate(bm25AndVec.bm25PerQuery, 'BM25');
    var vecAgg = aggregate(bm25AndVec.vecPerQuery, 'Vector');
    console.log('BM25 WS=' + f(bm25Agg.ws) + ', Vec WS=' + f(vecAgg.ws));

    process.stdout.write('  Lin α=0.20 ... ');
    var linPerQuery = [];
    for (var qi = 0; qi < queries.length; qi++) {
        var fusedIds = linearFuse(bm25AndVec.bm25Ids[qi], bm25AndVec.vecIds[qi], 0.20, TOP_K, 60);
        var gt = queries[qi].groundTruth;
        linPerQuery.push({ ids: fusedIds, scores: calcScores(fusedIds, gt, queries[qi]) });
    }
    var linAgg = aggregate(linPerQuery, 'Lin');
    console.log('WS=' + f(linAgg.ws) + ' NDCG@10=' + f(linAgg.ndcg10));

    var rerankAgg = null;
    if (runRerank) {
        process.stdout.write('  Lin+Rerank (pool=60) ... ');
        var rerankPerQuery = [];
        for (var qi2 = 0; qi2 < queries.length; qi2++) {
            var q = queries[qi2];
            var rIds = await rerankFuse(
                bm25AndVec.bm25Ids[qi2], bm25AndVec.vecIds[qi2],
                q.query || q.question, stmById, TOP_K, 60, 0.20, 60
            );
            rerankPerQuery.push({ ids: rIds, scores: calcScores(rIds, q.groundTruth, q) });
        }
        rerankAgg = aggregate(rerankPerQuery, 'Lin+Rerank');
        console.log('WS=' + f(rerankAgg.ws) + ' NDCG@10=' + f(rerankAgg.ndcg10));
    }

    return { label: label, bm25Agg: bm25Agg, vecAgg: vecAgg, linAgg: linAgg, rerankAgg: rerankAgg, linPerQuery: linPerQuery };
}

async function main() {
    console.log('=== Raw Text vs Summary Retrieval Benchmark ===');
    console.log('Model: bge-m3 (SiliconFlow) | Reranker: bge-reranker-v2-m3');
    console.log('Metric: Lin α=0.20, k=60\n');

    // Check rerank config
    var cfgPath = join(__dirname, 'config.json');
    var cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    var hasRerank = !!cfg.key;
    if (!hasRerank) console.log('⚠ No API key in config — rerank tests will fallback to Lin\n');

    // ── Scenario 1: STM summaries (bge-m3 baseline) ──
    console.log('## Scenario 1: STM + bge-m3 (summary baseline)');
    var stmResult = await runScenario('STM', allSTM, CHAT_ID_PREFIX + 'stm', hasRerank, 'BAAI/bge-m3');

    // ── Scenario 2: RAW dialogue + bge-m3 ──
    var rawSTM = buildRawSTM();
    console.log('\n## Scenario 2: RAW + bge-m3');
    console.log('  Average doc length: ' + Math.round(rawSTM.reduce(function(s, e) { return s + e.event.length; }, 0) / rawSTM.length) + ' chars (vs ' + Math.round(allSTM.reduce(function(s, e) { return s + e.event.length; }, 0) / allSTM.length) + ' for STM)');
    var rawBgeResult = await runScenario('RAW+bge-m3', rawSTM, CHAT_ID_PREFIX + 'raw_bge', hasRerank, 'BAAI/bge-m3');

    // ── Scenario 3: RAW dialogue + Qwen3-E-8B (4096d) ──
    console.log('\n## Scenario 3: RAW + Qwen3-E-8B (4096d, high-capacity)');
    var rawQwenResult = await runScenario('RAW+Qwen3-E-8B', rawSTM, CHAT_ID_PREFIX + 'raw_qwen', hasRerank, 'Qwen/Qwen3-Embedding-8B');

    // ── Report ──
    var lines = [];
    lines.push('# Raw Text vs Summary Retrieval — Rerank Impact');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Vector Model**: BAAI/bge-m3 (1024d)');
    lines.push('**Reranker**: BAAI/bge-reranker-v2-m3');
    lines.push('**Queries**: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narr + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' tgt)');
    lines.push('');

    // Table
    lines.push('## Results');
    lines.push('');
    var headers = ['Scenario', 'Doc Type', 'Doc Len', 'WS', 'NDCG@10', 'Hit@3', 'P@5', 'R@10', 'MRR', 'P@5(act)', 'Δ vs STM-Lin'];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('|' + headers.map(function() { return '------'; }).join('|') + '|');

    var stmLen = Math.round(allSTM.reduce(function(s, e) { return s + e.event.length; }, 0) / allSTM.length);
    var rawLen = Math.round(rawSTM.reduce(function(s, e) { return s + e.event.length; }, 0) / rawSTM.length);

    var stmLin = stmResult.linAgg;
    var rawBgeLin = rawBgeResult.linAgg;
    var rawQwenLin = rawQwenResult.linAgg;

    function deltaVs(baseWS, ws) {
        if (baseWS === 0) return '—';
        var d = ((ws - baseWS) / baseWS) * 100;
        return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    }

    // STM Lin baseline
    lines.push('| **STM + Lin (bge-m3)** | Summary | ' + stmLen + ' ch | ' + f(stmLin.ws) + ' | ' + f(stmLin.ndcg10) + ' | ' + f(stmLin.hit3) + ' | ' + f(stmLin.p5) + ' | ' + f(stmLin.r10) + ' | ' + f(stmLin.mrr) + ' | ' + f(stmLin.p5a) + ' | — (baseline) |');

    // STM + Rerank
    if (stmResult.rerankAgg) {
        var stmRerank = stmResult.rerankAgg;
        lines.push('| STM + Lin + Rerank (bge-m3) | Summary | ' + stmLen + ' ch | ' + f(stmRerank.ws) + ' | ' + f(stmRerank.ndcg10) + ' | ' + f(stmRerank.hit3) + ' | ' + f(stmRerank.p5) + ' | ' + f(stmRerank.r10) + ' | ' + f(stmRerank.mrr) + ' | ' + f(stmRerank.p5a) + ' | ' + deltaVs(stmLin.ws, stmRerank.ws) + ' |');
    }

    // RAW + bge-m3 Lin
    lines.push('| **RAW + Lin (bge-m3)** | Dialogue | ' + rawLen + ' ch | ' + f(rawBgeLin.ws) + ' | ' + f(rawBgeLin.ndcg10) + ' | ' + f(rawBgeLin.hit3) + ' | ' + f(rawBgeLin.p5) + ' | ' + f(rawBgeLin.r10) + ' | ' + f(rawBgeLin.mrr) + ' | ' + f(rawBgeLin.p5a) + ' | ' + deltaVs(stmLin.ws, rawBgeLin.ws) + ' |');

    // RAW + bge-m3 Rerank
    if (rawBgeResult.rerankAgg) {
        var rawBgeRerank = rawBgeResult.rerankAgg;
        lines.push('| RAW + Lin + Rerank (bge-m3) | Dialogue | ' + rawLen + ' ch | ' + f(rawBgeRerank.ws) + ' | ' + f(rawBgeRerank.ndcg10) + ' | ' + f(rawBgeRerank.hit3) + ' | ' + f(rawBgeRerank.p5) + ' | ' + f(rawBgeRerank.r10) + ' | ' + f(rawBgeRerank.mrr) + ' | ' + f(rawBgeRerank.p5a) + ' | ' + deltaVs(rawBgeLin.ws, rawBgeRerank.ws) + ' |');
    }

    // RAW + Qwen3-E-8B Lin
    lines.push('| **RAW + Lin (Qwen3-E-8B)** | Dialogue | ' + rawLen + ' ch | ' + f(rawQwenLin.ws) + ' | ' + f(rawQwenLin.ndcg10) + ' | ' + f(rawQwenLin.hit3) + ' | ' + f(rawQwenLin.p5) + ' | ' + f(rawQwenLin.r10) + ' | ' + f(rawQwenLin.mrr) + ' | ' + f(rawQwenLin.p5a) + ' | ' + deltaVs(stmLin.ws, rawQwenLin.ws) + ' |');

    // RAW + Qwen3-E-8B Rerank
    if (rawQwenResult.rerankAgg) {
        var rawQwenRerank = rawQwenResult.rerankAgg;
        lines.push('| **RAW + Lin + Rerank (Qwen3-E-8B)** | Dialogue | ' + rawLen + ' ch | ' + f(rawQwenRerank.ws) + ' | ' + f(rawQwenRerank.ndcg10) + ' | ' + f(rawQwenRerank.hit3) + ' | ' + f(rawQwenRerank.p5) + ' | ' + f(rawQwenRerank.r10) + ' | ' + f(rawQwenRerank.mrr) + ' | ' + f(rawQwenRerank.p5a) + ' | ' + deltaVs(rawQwenLin.ws, rawQwenRerank.ws) + ' |');
    }

    // BM25 baselines
    lines.push('');
    lines.push('### BM25 Baselines');
    lines.push('');
    lines.push('| Scenario | WS | NDCG@10 | Hit@3 | P@5 | R@10 |');
    lines.push('|----------|-----|---------|-------|-----|------|');
    lines.push('| STM BM25 | ' + f(stmResult.bm25Agg.ws) + ' | ' + f(stmResult.bm25Agg.ndcg10) + ' | ' + f(stmResult.bm25Agg.hit3) + ' | ' + f(stmResult.bm25Agg.p5) + ' | ' + f(stmResult.bm25Agg.r10) + ' |');
    lines.push('| RAW BM25 | ' + f(rawBgeResult.bm25Agg.ws) + ' | ' + f(rawBgeResult.bm25Agg.ndcg10) + ' | ' + f(rawBgeResult.bm25Agg.hit3) + ' | ' + f(rawBgeResult.bm25Agg.p5) + ' | ' + f(rawBgeResult.bm25Agg.r10) + ' |');

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'rawtext-benchmark.md');
    writeFileSync(outPath, withProvenanceHeader('rawtext', report), 'utf-8');

    // Console summary
    console.log('\n=== Summary ===');
    console.log('');
    console.log('Scenario                          DocLen   WS       NDCG@10   Hit@3   P@5');
    console.log('────────                           ──────   ──       ───────   ─────   ───');
    console.log('STM + Lin (bge-m3)                ' + pad(stmLen + 'ch', 8) + f(stmLin.ws) + '    ' + f(stmLin.ndcg10) + '    ' + f(stmLin.hit3) + '   ' + f(stmLin.p5));
    if (stmResult.rerankAgg) {
        var sR = stmResult.rerankAgg;
        console.log('STM + Lin + Rerank (bge-m3)       ' + pad(stmLen + 'ch', 8) + f(sR.ws) + '    ' + f(sR.ndcg10) + '    ' + f(sR.hit3) + '   ' + f(sR.p5) + '  Δ=' + deltaVs(stmLin.ws, sR.ws));
    }
    console.log('RAW + Lin (bge-m3)                ' + pad(rawLen + 'ch', 8) + f(rawBgeLin.ws) + '    ' + f(rawBgeLin.ndcg10) + '    ' + f(rawBgeLin.hit3) + '   ' + f(rawBgeLin.p5) + '  vs STM:' + deltaVs(stmLin.ws, rawBgeLin.ws));
    if (rawBgeResult.rerankAgg) {
        var rbR = rawBgeResult.rerankAgg;
        console.log('RAW + Lin + Rerank (bge-m3)       ' + pad(rawLen + 'ch', 8) + f(rbR.ws) + '    ' + f(rbR.ndcg10) + '    ' + f(rbR.hit3) + '   ' + f(rbR.p5) + '  Δ=' + deltaVs(rawBgeLin.ws, rbR.ws));
    }
    console.log('RAW + Lin (Qwen3-E-8B)            ' + pad(rawLen + 'ch', 8) + f(rawQwenLin.ws) + '    ' + f(rawQwenLin.ndcg10) + '    ' + f(rawQwenLin.hit3) + '   ' + f(rawQwenLin.p5) + '  vs STM:' + deltaVs(stmLin.ws, rawQwenLin.ws));
    if (rawQwenResult.rerankAgg) {
        var rqR = rawQwenResult.rerankAgg;
        console.log('RAW + Lin + Rerank (Qwen3-E-8B)   ' + pad(rawLen + 'ch', 8) + f(rqR.ws) + '    ' + f(rqR.ndcg10) + '    ' + f(rqR.hit3) + '   ' + f(rqR.p5) + '  Δ=' + deltaVs(rawQwenLin.ws, rqR.ws));
    }
    console.log('\nFull report: ' + outPath);
}

function pad(s, n) { while (s.length < n) s += ' '; return s; }

main().catch(function(e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
