// Scale Benchmark: does the large embedding model's value emerge with corpus size × raw-text mode?
// Hypothesis (from model-benchmark/rawtext-benchmark): at 144 entries big models gain nothing;
// this tests whether 4096d models pull ahead as the vault grows (144 → 500 → 1000) in raw-text mode.
//
// Design:
//   Corpus: 144 real fixture events + N distractors (distractors.json) → sizes [144, 500, 1000]
//   Modes:  summary (event text) | raw (expandToRawText simulated dialogue, same as benchmark-rawtext.js)
//   Models: bge-m3 (1024d) / Qwen3-Embedding-4B (2560d) / Qwen3-Embedding-8B (4096d)
//   Fusion: Lin α=0.20, k=60 (production setting); vector-only also reported
//   Embedding reuse: 1000-entry index embedded once per (model × mode); smaller sizes evaluated
//   by slicing the vector array — same vectors, no extra API cost.
//
// Run: node test/retrieval-benchmark/benchmark-scale.js

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { computeEmbeddings, computeEmbedding, normalizeVec } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries, outputDirFor, getSplitName } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader, computeTuple } from './report-provenance.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

var TOP_K = 40;
var SIZES = [144, 500, 1000];
var MODELS = [
    { name: 'BAAI/bge-m3', label: 'bge-m3', dim: 1024 },
    { name: 'Qwen/Qwen3-Embedding-4B', label: 'Qwen3-E-4B', dim: 2560 },
    { name: 'Qwen/Qwen3-Embedding-8B', label: 'Qwen3-E-8B', dim: 4096 },
];

// ── Raw text expansion (copied from benchmark-rawtext.js, kept identical for comparability) ──
function expandToRawText(entry) {
    var raw = '';
    var chars = (entry.entities || []).map(function (e) { return typeof e === 'string' ? e : e.name; });
    var scene = entry.scene || '';
    var event = entry.event || entry.summary || '';
    var period = entry.period || '';

    raw += '[' + period + '] ' + scene + '\n\n';

    if (chars.length >= 2) {
        var lines = [];
        var a = chars[0], b = chars[1];
        lines.push('*' + scene + '，' + period + '。' + a + '和' + b + '都在场。*');
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
                } else if (event.indexOf('安慰') !== -1) {
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

function buildSearchableTextLocal(entry) {
    // Mirror src/core/engine/retrieval-text.js buildSearchableText (no aliases in benchmark)
    var parts = [];
    if (entry.period) parts.push(entry.period);
    if (entry.scene) parts.push(entry.scene);
    if (entry.event) parts.push(entry.event);
    var names = (entry.entities || []).map(function (e) { return typeof e === 'string' ? e : e.name; }).filter(Boolean);
    if (names.length) parts.push(names.join(' '));
    return parts.join(' ');
}

function setModel(modelName) {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = modelName;
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

// Brute-force cosine top-K over a slice of the vector index (mirrors vectorSearch)
function topKBySlice(queryVecNorm, vectors, entries, size, k) {
    var results = [];
    for (var i = 0; i < size; i++) {
        var v = vectors[i];
        if (!v) continue;
        var dot = 0;
        for (var j = 0; j < queryVecNorm.length; j++) dot += queryVecNorm[j] * v[j];
        results.push({ id: entries[i].id, sim: dot });
    }
    results.sort(function (a, b) { return b.sim - a.sim; });
    return results.slice(0, Math.min(k, results.length)).map(function (r) { return r.id; });
}

function calcScores(ids, gt, q) {
    var s = {
        p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
        r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
        ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
        hit3: hitAtK(ids, gt, 3),
        p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
    };
    s.ws = weightedScore(s);
    return s;
}

function aggregate(perQuery) {
    var sQ = perQuery;
    return {
        n: sQ.length,
        p5: avg(sQ.map(function (s) { return s.p5; })),
        p10: avg(sQ.map(function (s) { return s.p10; })),
        ndcg10: avg(sQ.map(function (s) { return s.ndcg10; })),
        mrr: avg(sQ.map(function (s) { return s.mrr; })),
        hit3: avg(sQ.map(function (s) { return s.hit3; })),
        hit5: avg(sQ.map(function (s) { return s.hit5; })),
        r10: avg(sQ.map(function (s) { return s.r10; })),
        r20: avg(sQ.map(function (s) { return s.r20; })),
        ws: avg(sQ.map(function (s) { return s.ws; })),
    };
}

async function embedAll(model, texts, label) {
    setModel(model.name);
    var t0 = Date.now();
    var vecs = await computeEmbeddings(texts);
    if (!vecs) throw new Error('embedding failed for ' + label);
    var nulls = vecs.filter(function (v) { return !v; }).length;
    if (nulls > 0) throw new Error(nulls + ' null embeddings for ' + label);
    var normalized = vecs.map(normalizeVec);
    console.log('    embedded ' + texts.length + ' texts in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    return normalized;
}

async function embedQueries(model) {
    setModel(model.name);
    var out = [];
    for (var i = 0; i < queries.length; i++) {
        var q = queries[i];
        var text = q.query || q.question;
        var v = await computeEmbedding(text);
        out.push(normalizeVec(v));
    }
    return out;
}

// BM25 over a corpus slice (local, no API)
async function bm25Round(corpus, chatId) {
    process.env.NE_BENCHMARK_VECTOR = '0';
    var perQuery = [];
    var idsLists = [];
    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        var text = q.query || q.question;
        var results = await filterCandidates(text, corpus, allLTM, TOP_K, 3, {}, chatId);
        var ids = results.map(function (r) { return r.__id || r.id; });
        idsLists.push(ids);
        perQuery.push(calcScores(ids, q.groundTruth, q));
    }
    delete process.env.NE_BENCHMARK_VECTOR;
    return { agg: aggregate(perQuery), idsLists: idsLists };
}

function f(v, d) { d = d || 3; return v.toFixed(d); }
function pct(v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; }

async function main() {
    console.log('=== Scale Benchmark: model capacity × corpus size × doc mode ===\n');

    // Load distractors
    var dpath = join(__dirname, 'distractors.json');
    if (!existsSync(dpath)) {
        console.error('distractors.json not found — run gen-distractors.js first');
        process.exit(2);
    }
    var distractors = JSON.parse(readFileSync(dpath, 'utf-8')).events;
    var maxTotal = Math.min(1000, allSTM.length + distractors.length);
    if (maxTotal < SIZES[SIZES.length - 1]) {
        console.error('not enough corpus: have ' + maxTotal + ', need ' + SIZES[SIZES.length - 1]);
        process.exit(2);
    }
    console.log('Corpus: ' + allSTM.length + ' real + ' + (maxTotal - allSTM.length) + ' distractors = ' + maxTotal);
    console.log('Sizes: ' + SIZES.join(' / ') + ' | Modes: summary / raw | Models: ' + MODELS.map(function (m) { return m.label; }).join(', ') + '\n');

    var fullCorpus = allSTM.concat(distractors.slice(0, maxTotal - allSTM.length));

    // Prepare raw-mode corpus (event replaced by expanded dialogue, like benchmark-rawtext.js)
    var rawCorpus = fullCorpus.map(function (entry) {
        var raw = Object.assign({}, entry);
        raw._orig_event = entry.event;
        raw.event = expandToRawText(entry);
        return raw;
    });
    var sumLen = Math.round(fullCorpus.reduce(function (s, e) { return s + e.event.length; }, 0) / fullCorpus.length);
    var rawLen = Math.round(rawCorpus.reduce(function (s, e) { return s + e.event.length; }, 0) / rawCorpus.length);
    console.log('Avg doc len: summary ' + sumLen + ' ch | raw ' + rawLen + ' ch\n');

    // ── Phase 1: BM25 rounds per (mode × size) — model-independent ──
    var bm25 = {}; // key: mode_size → { agg, idsLists }
    for (var mi = 0; mi < 2; mi++) {
        var mode = mi === 0 ? 'summary' : 'raw';
        var corpus = mi === 0 ? fullCorpus : rawCorpus;
        for (var si = 0; si < SIZES.length; si++) {
            var size = SIZES[si];
            var slice = corpus.slice(0, size);
            process.stdout.write('BM25 ' + mode + '/' + size + ' ... ');
            var r = await bm25Round(slice, '__scale_bm25_' + mode + '_' + size);
            bm25[mode + '_' + size] = r;
            console.log('WS=' + f(r.agg.ws) + ' NDCG@10=' + f(r.agg.ndcg10));
        }
    }

    // ── Phase 2: embeddings per (model × mode), evaluate all sizes by slicing ──
    // results[modelLabel][mode][size] = { vec: agg, lin: agg, linPerQuery }
    var results = {};
    for (var xi = 0; xi < MODELS.length; xi++) {
        var model = MODELS[xi];
        results[model.label] = {};
        console.log('\nModel: ' + model.label + ' (' + model.dim + 'd)');

        // Query embeddings: same query text for both modes → embed once
        var qVecs = await embedQueries(model);

        for (var mj = 0; mj < 2; mj++) {
            var mode2 = mj === 0 ? 'summary' : 'raw';
            var corpus2 = mj === 0 ? fullCorpus : rawCorpus;
            var texts = corpus2.map(buildSearchableTextLocal);
            console.log('  mode=' + mode2 + ':');
            var vectors = await embedAll(model, texts, model.label + '/' + mode2);

            results[model.label][mode2] = {};
            for (var sk = 0; sk < SIZES.length; sk++) {
                var size2 = SIZES[sk];
                var bm = bm25[mode2 + '_' + size2];
                var vecScores = [], linScores = [];
                for (var qi = 0; qi < queries.length; qi++) {
                    var q = queries[qi];
                    var vecIds = topKBySlice(qVecs[qi], vectors, corpus2, size2, TOP_K);
                    vecScores.push(calcScores(vecIds, q.groundTruth, q));
                    var fusedIds = linearFuse(bm.idsLists[qi], vecIds, 0.20, TOP_K, 60);
                    linScores.push(calcScores(fusedIds, q.groundTruth, q));
                }
                results[model.label][mode2][size2] = {
                    vec: aggregate(vecScores),
                    lin: aggregate(linScores),
                    vecPerQuery: vecScores.map(function (s) { return s.ws; }),
                    linPerQuery: linScores.map(function (s) { return s.ws; }),
                };
                console.log('    size=' + size2 + ': vec WS=' + f(results[model.label][mode2][size2].vec.ws) + ' | lin WS=' + f(results[model.label][mode2][size2].lin.ws) + ' NDCG@10=' + f(results[model.label][mode2][size2].lin.ndcg10));
            }
        }
    }

    // ── Report ──
    var L = [];
    L.push('# Scale Benchmark — Model Capacity × Corpus Size × Doc Mode');
    L.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    L.push('**Hypothesis under test**: large embedding models only pay off when (a) the corpus is large and (b) documents are uncompressed raw text.');
    L.push('');
    L.push('- Corpus: ' + allSTM.length + ' real events + ' + (maxTotal - allSTM.length) + ' LLM-generated same-world distractors (sideplot, Day 61-120, topics orthogonal to query arcs)');
    L.push('- Sizes evaluated: ' + SIZES.join(' / ') + ' (distractors appended in order, real events always included)');
    L.push('- TOP_K = ' + TOP_K + ' fixed across sizes → task gets proportionally harder as corpus grows (' + Math.round(TOP_K / SIZES[0] * 100) + '% → ' + Math.round(TOP_K / SIZES[2] * 100) + '% of corpus)');
    L.push('- Fusion: Lin α=0.20, k=60 (production) | Avg doc len: summary ' + sumLen + ' ch, raw ' + rawLen + ' ch');
    L.push('');

    L.push('## 1. Full results (Lin α=0.20 fusion, WS = weighted score)');
    L.push('');
    for (var modeI = 0; modeI < 2; modeI++) {
        var modeN = modeI === 0 ? 'summary' : 'raw';
        L.push('### Mode: ' + modeN);
        L.push('');
        L.push('| Model | ' + SIZES.map(function (s) { return 'WS@' + s; }).join(' | ') + ' | ' + SIZES.map(function (s) { return 'NDCG@' + s; }).join(' | ') + ' |');
        L.push('|-------|' + SIZES.map(function () { return '------'; }).join('|') + '|' + SIZES.map(function () { return '------'; }).join('|') + '|');
        L.push('| *BM25 (no vector)* | ' + SIZES.map(function (s) { return f(bm25[modeN + '_' + s].agg.ws); }).join(' | ') + ' | ' + SIZES.map(function (s) { return f(bm25[modeN + '_' + s].agg.ndcg10); }).join(' | ') + ' |');
        MODELS.forEach(function (m) {
            var wsRow = SIZES.map(function (s) { return f(results[m.label][modeN][s].lin.ws); });
            var ndRow = SIZES.map(function (s) { return f(results[m.label][modeN][s].lin.ndcg10); });
            L.push('| ' + m.label + ' (' + m.dim + 'd) | ' + wsRow.join(' | ') + ' | ' + ndRow.join(' | ') + ' |');
        });
        // vector-only
        L.push('');
        L.push('<sub>Vector-only (no BM25 fusion):</sub>');
        L.push('');
        L.push('| Model | ' + SIZES.map(function (s) { return 'vecWS@' + s; }).join(' | ') + ' |');
        L.push('|-------|' + SIZES.map(function () { return '------'; }).join('|') + '|');
        MODELS.forEach(function (m) {
            L.push('| ' + m.label + ' | ' + SIZES.map(function (s) { return f(results[m.label][modeN][s].vec.ws); }).join(' | ') + ' |');
        });
        L.push('');
    }

    L.push('## 2. Hypothesis test: ΔWS(Qwen3-E-8B − bge-m3) by mode × size');
    L.push('');
    L.push('| Mode | ' + SIZES.map(function (s) { return 'ΔWS@' + s; }).join(' | ') + ' | ' + SIZES.map(function (s) { return 'ΔNDCG@' + s; }).join(' | ') + ' |');
    L.push('|------|' + SIZES.map(function () { return '------'; }).join('|') + '|' + SIZES.map(function () { return '------'; }).join('|') + '|');
    ['summary', 'raw'].forEach(function (modeN) {
        var dWs = SIZES.map(function (s) {
            var d = results['Qwen3-E-8B'][modeN][s].lin.ws - results['bge-m3'][modeN][s].lin.ws;
            return pct(d);
        });
        var dNd = SIZES.map(function (s) {
            var a = results['bge-m3'][modeN][s].lin.ndcg10;
            var d = (results['Qwen3-E-8B'][modeN][s].lin.ndcg10 - a) / (a || 1e-9);
            return pct(d);
        });
        L.push('| ' + modeN + ' | ' + dWs.join(' | ') + ' | ' + dNd.join(' | ') + ' |');
    });
    L.push('');
    L.push('<sub>Vector-only ΔWS(Qwen3-E-8B − bge-m3):</sub>');
    L.push('');
    L.push('| Mode | ' + SIZES.map(function (s) { return 'ΔvecWS@' + s; }).join(' | ') + ' |');
    L.push('|------|' + SIZES.map(function () { return '------'; }).join('|') + '|');
    ['summary', 'raw'].forEach(function (modeN) {
        var dWs = SIZES.map(function (s) {
            return pct(results['Qwen3-E-8B'][modeN][s].vec.ws - results['bge-m3'][modeN][s].vec.ws);
        });
        L.push('| ' + modeN + ' | ' + dWs.join(' | ') + ' |');
    });
    L.push('');

    L.push('## 3. ΔWS(Qwen3-E-4B − bge-m3) — mid-size model trend');
    L.push('');
    L.push('| Mode | ' + SIZES.map(function (s) { return 'ΔWS@' + s; }).join(' | ') + ' |');
    L.push('|------|' + SIZES.map(function () { return '------'; }).join('|') + '|');
    ['summary', 'raw'].forEach(function (modeN) {
        var dWs = SIZES.map(function (s) {
            return pct(results['Qwen3-E-4B'][modeN][s].lin.ws - results['bge-m3'][modeN][s].lin.ws);
        });
        L.push('| ' + modeN + ' | ' + dWs.join(' | ') + ' |');
    });
    L.push('');

    // Auto verdict
    var rawDelta0 = results['Qwen3-E-8B']['raw'][SIZES[0]].lin.ws - results['bge-m3']['raw'][SIZES[0]].lin.ws;
    var rawDeltaN = results['Qwen3-E-8B']['raw'][SIZES[SIZES.length - 1]].lin.ws - results['bge-m3']['raw'][SIZES[SIZES.length - 1]].lin.ws;
    var sumDeltaN = results['Qwen3-E-8B']['summary'][SIZES[SIZES.length - 1]].lin.ws - results['bge-m3']['summary'][SIZES[SIZES.length - 1]].lin.ws;
    L.push('## 4. Verdict');
    L.push('');
    L.push('- Raw mode, ' + SIZES[0] + '→' + SIZES[SIZES.length - 1] + ' entries: ΔWS(8B−m3) moves ' + pct(rawDelta0) + ' → ' + pct(rawDeltaN));
    L.push('- Summary mode, ' + SIZES[SIZES.length - 1] + ' entries: ΔWS(8B−m3) = ' + pct(sumDeltaN));
    if (rawDeltaN > 0.01 && rawDeltaN > sumDeltaN && rawDeltaN > rawDelta0) {
        L.push('- **Hypothesis SUPPORTED**: the large model pulls ahead specifically in raw mode as the corpus grows.');
    } else if (rawDeltaN <= 0.01 && sumDeltaN <= 0.01) {
        L.push('- **Hypothesis NOT supported at this scale**: even at ' + SIZES[SIZES.length - 1] + ' entries with raw text, the 8B model shows no consistent advantage.');
    } else {
        L.push('- **Mixed result**: see tables above for the interaction pattern.');
    }
    L.push('');
    L.push('<sub>Limitations: distractors are LLM-generated sideplot events (topic-orthogonal by construction); hard negatives sharing a query topic were deliberately avoided to protect ground-truth validity, which makes this a conservative test of the large-model advantage. TOP_K fixed at ' + TOP_K + ' means recall ceilings drop as corpus grows — absolute WS across sizes is not directly comparable; within-size model comparisons are the valid signal.</sub>');
    L.push('');

    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'scale-benchmark.md');
    writeFileSync(outPath, withProvenanceHeader('scale', L.join('\n')), 'utf-8');

    // per-query JSON dump（P0-1 模型对比 bootstrap 输入：每模型×模式×规模 的 per-query WS）
    var scaleDump = {
        _meta: {
            report: 'scale',
            split: getSplitName(),
            version: computeTuple(),
            config: { topK: TOP_K, lin: { alpha: 0.20, k: 60 }, sizes: SIZES, models: MODELS.map(function (m) { return m.label; }) },
        },
        queries: queries.map(function (q) { return { id: q.id, type: q.type }; }),
        results: (function () {
            var out = {};
            Object.keys(results).forEach(function (ml) {
                out[ml] = {};
                Object.keys(results[ml]).forEach(function (mode) {
                    out[ml][mode] = {};
                    SIZES.forEach(function (s) {
                        var cell = results[ml][mode][s];
                        out[ml][mode][s] = { vec: cell.vecPerQuery, lin: cell.linPerQuery };
                    });
                });
            });
            return out;
        })(),
    };
    var scaleDumpPath = join(outDir, 'scale-benchmark-scores.json');
    writeFileSync(scaleDumpPath, JSON.stringify(scaleDump, null, 2) + '\n', 'utf-8');
    console.log('Scale dump: ' + scaleDumpPath);

    // Console summary
    console.log('\n=== Summary (Lin WS by size) ===');
    ['summary', 'raw'].forEach(function (modeN) {
        console.log('mode=' + modeN + ':');
        MODELS.forEach(function (m) {
            console.log('  ' + m.label + ': ' + SIZES.map(function (s) { return f(results[m.label][modeN][s].lin.ws); }).join('  '));
        });
        console.log('  BM25: ' + SIZES.map(function (s) { return f(bm25[modeN + '_' + s].agg.ws); }).join('  '));
    });
    console.log('\nΔWS(8B−m3) raw: ' + SIZES.map(function (s) { return pct(results['Qwen3-E-8B']['raw'][s].lin.ws - results['bge-m3']['raw'][s].lin.ws); }).join('  '));
    console.log('ΔWS(8B−m3) sum: ' + SIZES.map(function (s) { return pct(results['Qwen3-E-8B']['summary'][s].lin.ws - results['bge-m3']['summary'][s].lin.ws); }).join('  '));
    console.log('\nFull report: ' + outPath);
}

main().catch(function (e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
