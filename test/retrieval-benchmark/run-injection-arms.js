// run-injection-arms.js — 注入侧三层仪器主脚本（4 臂渲染 + L0 确定性度量 + contains 判定 + aggregate）
// 计划：.trae/documents/injection-ablation-rerun-plan.md §3.2/§3.4
// 臂定义：
//   floor     空文档（校准地板）
//   oracle    GT 事件裸列表（校准天花板，不走检索）
//   baseline  buildContext(withHighlights=false)   ← 复用旧消融管线
//   hl        buildContext(withHighlights=true)
// 用法：
//   node run-injection-arms.js --render-only          # 只渲染文档+L0（不调 LLM）
//   node run-injection-arms.js --render-only --arms floor,oracle  # 校准臂先行
//   node run-injection-arms.js --judge                # 渲染 + 调读者 + 判定 + aggregate
//   node run-injection-arms.js --judge --arms baseline,hl
//   node run-injection-arms.js --aggregate-only       # 只重算 aggregate（judge 已跑完）

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { buildKeyHighlights } from '../../src/core/engine/injection.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { qaAnchors } from './injection-qa-anchors.js';
import { linearFuse } from './benchmark-fusions.js';
import { askReader } from './judge-injection-arm-lib.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_injection_arms__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;
delete process.env.NE_BENCHMARK_VECTOR;

var OUT_BASE = join(__dirname, 'output', 'injection-eval');
var DOCS_DIR = join(OUT_BASE, 'docs');

var argv = process.argv;
var RENDER_ONLY = argv.includes('--render-only');
var JUDGE = argv.includes('--judge');
var AGG_ONLY = argv.includes('--aggregate-only');
var armsArg = argv.indexOf('--arms') !== -1 ? argv[argv.indexOf('--arms') + 1] : 'floor,oracle,baseline,hl,flat,grouped,groupedpre,coverfix';
var ARMS = armsArg.split(',').map(function (a) { return a.trim(); });

// ─── 以下管线构造复制自 benchmark-key-highlights.js（同源，保证与旧消融可比） ───

function setBgeM3() { process.env.EMBEDDING_MODEL = 'BAAI/bge-m3'; }

function collectAllEntityNames(stmArr) {
    var names = [];
    stmArr.forEach(function (e) {
        if (e.entities) e.entities.forEach(function (en) {
            var n = typeof en === 'string' ? en : en.name;
            if (n && names.indexOf(n) === -1) names.push(n);
        });
    });
    return names;
}

function extractEntityNames(query, allEntityNames) {
    var queryLower = query.toLowerCase();
    var matched = allEntityNames.filter(function (name) {
        return name.length > 1 && queryLower.indexOf(name.toLowerCase()) !== -1;
    });
    matched.sort(function (a, b) { return b.length - a.length; });
    return matched.slice(0, 5);
}

function buildEntityChains(stmArr, entityNames) {
    var chains = {};
    entityNames.forEach(function (name) {
        var chainEntries = [];
        stmArr.forEach(function (e) {
            if (e.entities && e.entities.some(function (en) {
                return (typeof en === 'string' ? en : en.name) === name;
            })) chainEntries.push(e);
        });
        if (chainEntries.length > 0) {
            chainEntries.sort(function (a, b) {
                var ta = a.msg_ids && a.msg_ids.length > 0 ? a.msg_ids[0] : 0;
                var tb = b.msg_ids && b.msg_ids.length > 0 ? b.msg_ids[0] : 0;
                return ta - tb;
            });
            chains[name] = chainEntries;
        }
    });
    return chains;
}

function applyPrefetch(mapObj, chatMessages, topK) {
    if (!chatMessages || chatMessages.length === 0) return;
    topK = topK || 3;
    var entries = [];
    mapObj.forEach(function (v) { entries.push(v); });
    entries.sort(function (a, b) { return (b.relevance || 0) - (a.relevance || 0); });
    entries.slice(0, topK).forEach(function (entry) {
        var msgIds = entry.entry.msg_ids;
        if (!msgIds || msgIds.length === 0) return;
        var originalLines = [];
        msgIds.forEach(function (mid) {
            var msg = chatMessages.find(function (m) { return String(m.id) === String(mid); });
            if (msg) {
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) originalLines.push('[msg_' + mid + '] ' + text.substring(0, 200));
            }
        });
        if (originalLines.length > 0) entry._originalText = originalLines.join('\n');
    });
}

function foldMissRunsText(entries) {
    var result = [];
    var missRun = [];
    var num = 0;
    function flushMiss() {
        if (missRun.length === 0) return;
        if (missRun.length === 1) {
            num++;
            var p = missRun[0].entry.period || '?';
            result.push(' ' + num + '. [' + p + '] （' + p + ' 未展开）');
        } else {
            num++;
            var fp = missRun[0].entry.period || '?';
            var lp = missRun[missRun.length - 1].entry.period || '?';
            result.push(' ' + num + '. [' + fp + '] ' + fp + '-' + lp + '（' + missRun.length + '条事件未展开）');
        }
        missRun = [];
    }
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.relevance > 0) {
            flushMiss();
            num++;
            var period = e.entry.period || '?';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            var line = ' ' + num + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event;
            if (e._originalText) line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
            result.push(line);
        } else {
            missRun.push(e);
        }
    }
    flushMiss();
    return result;
}

function buildContext(mergedMap, grouped, activeEntities, withHighlights) {
    var lines = [];
    if (withHighlights) {
        var hl = buildKeyHighlights(mergedMap, grouped, 5);
        if (hl) {
            lines.push(hl);
            lines.push('---');
        }
    }
    lines.push('## 实体记忆链');
    lines.push('');
    var activeNames = [];
    var externalNames = [];
    Object.keys(grouped.groups).forEach(function (name) {
        if (activeEntities && activeEntities.indexOf(name) !== -1) activeNames.push(name);
        else externalNames.push(name);
    });

    function renderGroup(name, group) {
        var entries = group.entries;
        var total = entries.length;
        var hitCount = entries.filter(function (e) { return e.relevance > 0; }).length;
        var refCount = group.refs ? group.refs.length : 0;
        lines.push('### ' + name + ' (' + total + ' events in chain, ' + hitCount + ' hits, ' + refCount + ' refs)');
        var textLines = foldMissRunsText(entries);
        textLines.forEach(function (l) { lines.push(l); });
        if (group.refs && group.refs.length > 0) {
            var refIds = group.refs.map(function (r) { return r.entryId; });
            var refNames = [];
            group.refs.forEach(function (r) { if (refNames.indexOf(r.primaryName) === -1) refNames.push(r.primaryName); });
            lines.push('   关联: 见' + refNames.map(function (n) { return '\u300c' + n + '\u300d'; }).join('') + ' ' + refIds.join(', '));
        }
        lines.push('');
    }
    activeNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
    if (grouped.unassigned && grouped.unassigned.length > 0) {
        lines.push('### 未标注条目 (' + grouped.unassigned.length + ' entries)');
        grouped.unassigned.forEach(function (e, i) {
            var period = e.entry.period || '?';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.summary || '';
            lines.push(' ' + (i + 1) + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event);
        });
        lines.push('');
    }
    if (externalNames.length > 0) {
        lines.push('### 场景外角色');
        lines.push('');
        externalNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
    }
    return lines.join('\n');
}

// ─── flat / grouped 渲染（搬自 benchmark-llm-judge.js L125-248，No-Score 变体）───

function formatEntryLine(e, num) {
    var period = e.entry.period || '?';
    var scene = e.entry.scene || '';
    var event = e.entry.event || e.entry.summary || '';
    var line = (num || '') + ' [' + period + '] ' + (scene ? scene + ': ' : '') + event;
    if (e._originalText) {
        line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
    }
    return line;
}

function buildFlatContext(mergedMap) {
    var entries = [];
    mergedMap.forEach(function (e) {
        if (e.relevance > 0 && (!e.sources || e.sources.indexOf('ltm_dir') === -1)) {
            entries.push(e);
        }
    });
    entries.sort(function (a, b) { return b.relevance - a.relevance; });
    var lines = ['以下是按相关度排序的记忆检索结果：', ''];
    entries.forEach(function (e, i) {
        lines.push(formatEntryLine(e, (i + 1) + '.'));
    });
    if (entries.length === 0) lines.push('（未检索到相关记忆）');
    return lines.join('\n');
}

function foldMissRunsTextLLJ(entries) {
    var result = [];
    var missRun = [];
    var num = 0;
    function flushMiss() {
        if (missRun.length === 0) return;
        if (missRun.length === 1) {
            num++;
            var p = missRun[0].entry.period || '?';
            result.push(' ' + num + '. [' + p + '] （' + p + ' 未展开）');
        } else {
            num++;
            var fp = missRun[0].entry.period || '?';
            var lp = missRun[missRun.length - 1].entry.period || '?';
            result.push(' ' + num + '. [' + fp + '] ' + fp + '-' + lp + '（' + missRun.length + '条事件未展开）');
        }
        missRun = [];
    }
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.relevance > 0) {
            flushMiss();
            num++;
            result.push(formatEntryLine(e, ' ' + num + '.'));
        } else {
            missRun.push(e);
        }
    }
    flushMiss();
    return result;
}

function buildGroupedContext(mergedMap, grouped, activeEntities) {
    var lines = [];
    lines.push('## 实体记忆链');
    lines.push('');
    var activeNames = [];
    var externalNames = [];
    Object.keys(grouped.groups).forEach(function (name) {
        if (activeEntities && activeEntities.indexOf(name) !== -1) activeNames.push(name);
        else externalNames.push(name);
    });
    function renderGroup(name, group) {
        var entries = group.entries;
        var total = entries.length;
        var hitCount = entries.filter(function (e) { return e.relevance > 0; }).length;
        var refCount = group.refs ? group.refs.length : 0;
        lines.push('### ' + name + ' (' + total + ' events in chain, ' + hitCount + ' hits, ' + refCount + ' refs)');
        var textLines = foldMissRunsTextLLJ(entries);
        textLines.forEach(function (l) { lines.push(l); });
        if (group.refs && group.refs.length > 0) {
            var refIds = group.refs.map(function (r) { return r.entryId; });
            var refNames = [];
            group.refs.forEach(function (r) { if (refNames.indexOf(r.primaryName) === -1) refNames.push(r.primaryName); });
            lines.push('   关联: 见' + refNames.map(function (n) { return '\u300c' + n + '\u300d'; }).join('') + ' ' + refIds.join(', '));
        }
        lines.push('');
    }
    activeNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
    if (grouped.unassigned && grouped.unassigned.length > 0) {
        lines.push('### 未标注条目 (' + grouped.unassigned.length + ' entries)');
        grouped.unassigned.forEach(function (e, i) {
            lines.push(formatEntryLine(e, ' ' + (i + 1) + '.'));
        });
        lines.push('');
    }
    if (externalNames.length > 0) {
        lines.push('### 场景外角色');
        lines.push('');
        externalNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
    }
    return lines.join('\n');
}

// ─── coverfix 渲染：现行文档 + 该锚缺失的 GT 事件追加尾部（检索/呈现损失分解臂） ───

function renderCoverfix(baseDocText, anchor, stmById) {
    var missing = [];
    (anchor.gtEventIds || []).forEach(function (eid) {
        var ev = stmById[eid];
        if (!ev) return;
        var frag = ev.event || ev.summary || '';
        if (!frag) return;
        if (baseDocText.indexOf(frag) === -1 && baseDocText.indexOf(frag.slice(0, 20)) === -1) {
            missing.push(ev);
        }
    });
    if (missing.length === 0) return baseDocText;
    var lines = [baseDocText, '', '### 补充事件', ''];
    missing.forEach(function (ev, i) {
        lines.push(' ' + (i + 1) + '. [' + (ev.period || '?') + '] ' + (ev.scene ? ev.scene + ': ' : '') + (ev.event || ev.summary || ''));
    });
    return lines.join('\n');
}

// ─── L0 度量：GT 事件首现位置（字符百分位）、覆盖数、token 数 ───

function measureDoc(docText, anchor, stmById) {
    var len = Math.max(docText.length, 1);
    var positions = [];
    var covered = 0;
    (anchor.gtEventIds || []).forEach(function (eid) {
        var ev = stmById[eid];
        if (!ev) return;
        var frag = ev.event || ev.summary || '';
        if (!frag) return;
        var idx = docText.indexOf(frag);
        if (idx === -1) {
            // 摘要文本可能被折行/截断，退化用前 20 字符子串定位
            idx = docText.indexOf(frag.slice(0, 20));
        }
        if (idx !== -1) {
            covered++;
            positions.push({ eventId: eid, charIdx: idx, pct: idx / len });
        }
    });
    return {
        docChars: docText.length,
        docTokens: Math.round(docText.length / 1.6), // 中文粗估 token
        gtCovered: covered,
        gtTotal: (anchor.gtEventIds || []).length,
        firstOccurrencePct: positions.length > 0 ? Math.min.apply(null, positions.map(function (p) { return p.pct; })) : null,
        positions: positions,
    };
}

// ─── 确定性判定（contains，零 LLM）───

function judgeFact(answer, expect) {
    var expects = Array.isArray(expect) ? expect : [expect];
    var a = String(answer || '');
    for (var i = 0; i < expects.length; i++) {
        if (a.indexOf(expects[i]) !== -1) return true;
    }
    return false;
}

// ─── oracle / floor 渲染 ───

function renderOracle(anchor, stmById) {
    var lines = ['以下为事件列表：', ''];
    (anchor.gtEventIds || []).forEach(function (eid, i) {
        var ev = stmById[eid];
        if (!ev) return;
        lines.push((i + 1) + '. [' + (ev.period || '?') + '] ' + (ev.scene ? ev.scene + ': ' : '') + (ev.event || ev.summary || ''));
    });
    return lines.join('\n');
}

function renderFloor() {
    return '';
}

// ─── aggregate ───

function computeAggregate() {
    var stmById = {};
    allSTM.forEach(function (e) { stmById[e.id || e.__id] = e; });
    var result = { arms: {}, docMetrics: {} };

    // 读者判定结果
    ARMS.forEach(function (arm) {
        var dir = join(OUT_BASE, arm);
        if (!existsSync(dir)) return;
        var files = readdirSync(dir).filter(function (f) { return f.indexOf('-f') !== -1 && f.endsWith('.json'); });
        var byTier = { state: { total: 0, correct: 0, notfound: 0, parseFail: 0 }, narrative: { total: 0, correct: 0, notfound: 0, parseFail: 0 } };
        files.forEach(function (f) {
            var d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            var tier = d.tier || 'state';
            if (!byTier[tier]) byTier[tier] = { total: 0, correct: 0, notfound: 0, parseFail: 0 };
            byTier[tier].total++;
            if (!d.parseOk) { byTier[tier].parseFail++; return; }
            // contains 判定（在 aggregate 时执行，保证判定与渲染解耦可重算）
            var anchor = qaAnchors.find(function (a) { return a.id === d.anchorId; });
            if (!anchor) return;
            var fact = anchor.facts[d.factIdx];
            var correct = d.found && judgeFact(d.answer, fact.expect);
            if (correct) byTier[tier].correct++;
            if (!d.found) byTier[tier].notfound++;
        });
        result.arms[arm] = byTier;
    });

    // L0 文档度量
    if (existsSync(DOCS_DIR)) {
        ARMS.forEach(function (arm) {
            var dir = join(DOCS_DIR, arm);
            if (!existsSync(dir)) return;
            var metrics = [];
            readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
                var d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
                if (d.metrics) metrics.push({ anchorId: d.anchorId, tier: d.tier, arm: arm, metrics: d.metrics });
            });
            result.docMetrics[arm] = metrics;
        });
    }
    return result;
}

// ─── 主流程 ───

async function main() {
    var stmById = {};
    allSTM.forEach(function (e) { stmById[e.id || e.__id] = e; });
    mkdirSync(OUT_BASE, { recursive: true });
    mkdirSync(DOCS_DIR, { recursive: true });

    // ── aggregate-only 模式 ──
    if (AGG_ONLY) {
        var agg = computeAggregate();
        writeFileSync(join(OUT_BASE, 'aggregate.json'), JSON.stringify(agg, null, 2), 'utf-8');
        console.log('aggregate 重算完成: ' + join(OUT_BASE, 'aggregate.json'));
        console.log(JSON.stringify(agg.arms, null, 1));
        return;
    }

    // ── 渲染阶段（floor/oracle 免检索；其余臂需检索）──
    var needRetrieval = ['baseline', 'hl', 'flat', 'grouped', 'groupedpre', 'coverfix'].some(function (a) { return ARMS.indexOf(a) !== -1; });
    var vecIdx = null;
    var allEntityNames = null;
    if (needRetrieval) {
        setBgeM3();
        resetVectorIndex(CHAT_ID);
        await ensureVectorIndex(allSTM, {}, CHAT_ID);
        vecIdx = getVectorIndex(CHAT_ID);
        allEntityNames = collectAllEntityNames(allSTM);
        console.log('向量索引: ' + vecIdx.entries.length + ' 条');
    }

    for (var qi = 0; qi < qaAnchors.length; qi++) {
        var anchor = qaAnchors[qi];
        process.stdout.write('[' + (qi + 1) + '/' + qaAnchors.length + '] ' + anchor.id + ' (' + anchor.type + ') ... ');

        var armTexts = {};

        // floor / oracle（免检索）
        if (ARMS.indexOf('floor') !== -1) armTexts.floor = renderFloor();
        if (ARMS.indexOf('oracle') !== -1) armTexts.oracle = renderOracle(anchor, stmById);

        // baseline / hl / flat / grouped / groupedpre / coverfix（共享一次检索）
        if (needRetrieval) {
            delete process.env.NE_BENCHMARK_VECTOR;
            var bm25Results = await filterCandidates(anchor.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
            var rawBm25Ids = bm25Results.filter(function (r) { return !r.__isDirectory; }).map(function (r) { return r.__id || r.id; });

            setBgeM3();
            var queryEmb = await computeEmbedding(anchor.query);
            var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
            var rawVecIds = vecResults.map(function (v) { return v.entry.id; });
            linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);

            var entityNames = extractEntityNames(anchor.query, allEntityNames);
            var entityChains = buildEntityChains(allSTM, entityNames);
            var merged = await mergePipelines(bm25Results, entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
            var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);
            applyPrefetch(merged.map, allChatMessages, 3);

            var baseDoc = null;
            if (ARMS.indexOf('baseline') !== -1) armTexts.baseline = baseDoc = buildContext(merged.map, grouped, entityNames, false);
            if (ARMS.indexOf('hl') !== -1) armTexts.hl = buildContext(merged.map, grouped, entityNames, true);
            if (ARMS.indexOf('groupedpre') !== -1) armTexts.groupedpre = buildContext(merged.map, grouped, entityNames, false);
            if (ARMS.indexOf('flat') !== -1) armTexts.flat = buildFlatContext(merged.map);
            if (ARMS.indexOf('grouped') !== -1) armTexts.grouped = buildGroupedContext(merged.map, grouped, entityNames);
            if (ARMS.indexOf('coverfix') !== -1) {
                var cfBase = baseDoc !== null ? baseDoc : buildContext(merged.map, grouped, entityNames, false);
                armTexts.coverfix = renderCoverfix(cfBase, anchor, stmById);
            }
        }

        // 渲染落盘 + L0 度量
        Object.keys(armTexts).forEach(function (arm) {
            var dir = join(DOCS_DIR, arm);
            mkdirSync(dir, { recursive: true });
            var docText = armTexts[arm];
            var metrics = measureDoc(docText, anchor, stmById);
            writeFileSync(join(dir, anchor.id + '.json'), JSON.stringify({
                arm: arm, anchorId: anchor.id, tier: anchor.type, query: anchor.query,
                text: docText, metrics: metrics,
            }, null, 2), 'utf-8');
        });
        console.log('渲染 ' + Object.keys(armTexts).length + ' 臂');
    }
    console.log('文档渲染完成 → ' + DOCS_DIR);

    if (RENDER_ONLY) {
        // 打印 L0 摘要
        var agg0 = computeAggregate();
        console.log('\n=== L0 文档度量摘要 ===');
        Object.keys(agg0.docMetrics).forEach(function (arm) {
            var ms = agg0.docMetrics[arm];
            if (!ms.length) return;
            var firsts = ms.map(function (m) { return m.metrics.firstOccurrencePct; }).filter(function (v) { return v !== null; });
            var avgFirst = firsts.length ? (firsts.reduce(function (a, b) { return a + b; }, 0) / firsts.length * 100).toFixed(1) : '—';
            var avgTok = (ms.reduce(function (a, m) { return a + m.metrics.docTokens; }, 0) / ms.length).toFixed(0);
            var covered = ms.reduce(function (a, m) { return a + m.metrics.gtCovered; }, 0);
            var gtTotal = ms.reduce(function (a, m) { return a + m.metrics.gtTotal; }, 0);
            console.log('  ' + arm + ': GT覆盖 ' + covered + '/' + gtTotal + ' | 首现位置中位 ' + avgFirst + '% | 平均token ' + avgTok);
        });
        return;
    }

    // ── judge 阶段：调读者 + 判定落盘 ──
    if (!JUDGE) { console.log('未指定 --judge，渲染后退出'); return; }
    for (var ai = 0; ai < ARMS.length; ai++) {
        var arm = ARMS[ai];
        var docsDir = join(DOCS_DIR, arm);
        if (!existsSync(docsDir)) continue;
        var files = readdirSync(docsDir).filter(function (f) { return f.endsWith('.json'); });
        var outDir = join(OUT_BASE, arm);
        mkdirSync(outDir, { recursive: true });
        for (var fi = 0; fi < files.length; fi++) {
            var doc = JSON.parse(readFileSync(join(docsDir, files[fi]), 'utf-8'));
            var a = qaAnchors.find(function (x) { return x.id === doc.anchorId; });
            if (!a) continue;
            for (var xi = 0; xi < a.facts.length; xi++) {
                var fact = a.facts[xi];
                var outPath = join(outDir, a.id + '-f' + xi + '.json');
                if (existsSync(outPath)) continue; // 幂等
                process.stdout.write('  [' + arm + '][' + a.id + '-f' + xi + '] ... ');
                var res;
                try { res = await askReader(doc.text, fact.q); }
                catch (e) { res = { parseOk: false, answer: 'ERR:' + (e && e.message), found: false, raw: '' }; }
                writeFileSync(outPath, JSON.stringify({
                    arm: arm, anchorId: a.id, factIdx: xi, tier: a.type,
                    question: fact.q, answer: res.answer, found: res.found, parseOk: res.parseOk, raw: res.raw,
                }, null, 2), 'utf-8');
                console.log((res.parseOk ? (res.found ? 'found' : 'notfound') : 'PARSE_FAIL') + ' | ' + String(res.answer).slice(0, 40));
            }
        }
    }

    var agg = computeAggregate();
    writeFileSync(join(OUT_BASE, 'aggregate.json'), JSON.stringify(agg, null, 2), 'utf-8');
    console.log('\n=== aggregate 完成 ===');
    console.log(JSON.stringify(agg.arms, null, 1));
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });