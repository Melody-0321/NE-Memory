import { neSync } from '../settings-adapter.js';
import { readNeSettingsCached } from '../settings.js';

var EMBEDDING_DIM = 1536;

function getConfiguredTimeoutSec(fallbackSec) {
    fallbackSec = fallbackSec || 120;
    try {
        var settings = readNeSettingsCached();
        if (settings.apiTimeoutMs && typeof settings.apiTimeoutMs === 'number') {
            return Math.max(10, Math.floor(settings.apiTimeoutMs / 1000));
        }
    } catch (e) {}
    return fallbackSec;
}

function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var fetchOptions = Object.assign({}, options, { signal: controller.signal });
    return fetch(url, fetchOptions).then(function (r) {
        clearTimeout(timer);
        return r;
    }, function (e) {
        clearTimeout(timer);
        throw e;
    });
}

export function loadEmbeddingApiConfig() {
    try {
        var raw = localStorage.getItem('ne_embedding_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    if (typeof process !== 'undefined' && process.env && process.env.EMBEDDING_URL) {
        return {
            url: process.env.EMBEDDING_URL,
            model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
            key: process.env.EMBEDDING_API_KEY || ''
        };
    }
    return null;
}

export function saveEmbeddingApiConfig(config) {
    if (config && config.url) config.url = config.url.replace(/\/+$/, '');
    localStorage.setItem('ne_embedding_api', JSON.stringify(config));
    try { neSync('ne_embedding_api'); } catch (e) {}
}

export function isVectorSearchEnabled() {
    if (typeof process !== 'undefined' && process.env && process.env.NE_BENCHMARK_VECTOR === '0') return false;
    try {
        return !!readNeSettingsCached().enableVectorSearch;
    } catch (e) {}
    if (typeof process !== 'undefined' && process.env && process.env.EMBEDDING_URL) return true;
    return false;
}

export async function computeEmbedding(text) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;

    try {
        var resp = await fetchWithTimeout(cfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (cfg.key || '')
            },
            body: JSON.stringify({ model: cfg.model, input: text })
        }, getConfiguredTimeoutSec(120) * 1000);
        if (!resp.ok) throw new Error('Embedding API returned ' + resp.status);
        var data = await resp.json();
        var vec = data.data && data.data[0] && data.data[0].embedding;
        if (!vec || !Array.isArray(vec)) throw new Error('No embedding in response');
        EMBEDDING_DIM = vec.length;
        return new Float32Array(vec);
    } catch (e) {
        console.warn('[NE] computeEmbedding failed:', e && e.message);
        return null;
    }
}

// R3: L2 归一化（原地），供向量索引入库与查询侧归一化用
export function normalizeVec(vec) {
    var sum = 0;
    for (var i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
    var norm = Math.sqrt(sum);
    if (norm <= 0) return vec;
    for (var i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
}

function _embedBatch(cfg, batch) {
    return fetchWithTimeout(cfg.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (cfg.key || '')
        },
        body: JSON.stringify({ model: cfg.model, input: batch.texts })
    }, getConfiguredTimeoutSec(120) * 1000).then(function(resp) {
        if (!resp.ok) throw new Error('Embedding API returned ' + resp.status);
        return resp.json();
    }).then(function(data) {
        if (!data.data || !Array.isArray(data.data)) throw new Error('No embeddings in response');
        return data.data;
    });
}

// R4: 限并发 2 的批处理 map（保序收集，fn 自行消化错误）
function _mapLimit2(items, fn) {
    return new Promise(function(resolve, reject) {
        var results = new Array(items.length);
        var nextIdx = 0, running = 0, done = 0, rejected = false;
        function pump() {
            if (rejected) return;
            while (running < 2 && nextIdx < items.length) {
                var idx = nextIdx++;
                running++;
                fn(items[idx], idx).then(function(res) {
                    results[idx] = res;
                    running--; done++; pump();
                }, function(err) {
                    if (!rejected) { rejected = true; reject(err); }
                });
            }
            if (done === items.length) resolve(results);
        }
        pump();
    });
}

// R4: 单批嵌入 + 失败重试 1 次；仍失败返回全 null 占位（不拖垮整批）
function _embedBatchWithRetry(cfg, batch) {
    var attempt = 0;
    function run() {
        return _embedBatch(cfg, batch).then(function(embeddings) {
            var vecs = new Array(batch.texts.length);
            for (var i = 0; i < batch.texts.length; i++) {
                var emb = embeddings[i] && embeddings[i].embedding;
                vecs[i] = emb ? new Float32Array(emb) : null;
            }
            return vecs;
        }, function(err) {
            if (attempt < 1) { attempt++; return run(); }
            console.warn('[NE] computeEmbeddings batch [' + batch.start + '-' + (batch.start + batch.texts.length - 1) + '] failed:', err && err.message);
            var nulls = new Array(batch.texts.length);
            for (var i = 0; i < batch.texts.length; i++) nulls[i] = null;
            return nulls;
        });
    }
    return run();
}

export async function computeEmbeddings(texts) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;
    if (!texts || texts.length === 0) return [];

    var BATCH_SIZE = 40;
    var batches = [];
    for (var start = 0; start < texts.length; start += BATCH_SIZE) {
        batches.push({ start: start, texts: texts.slice(start, start + BATCH_SIZE) });
    }

    var results = new Array(texts.length);
    var anySuccess = false;

    await _mapLimit2(batches, function(batch) {
        return _embedBatchWithRetry(cfg, batch).then(function(vecs) {
            for (var i = 0; i < vecs.length; i++) {
                results[batch.start + i] = vecs[i] || null;
                if (vecs[i]) anySuccess = true;
            }
        });
    });

    // 全部批都失败 → 保持旧语义返回 null
    if (!anySuccess) return null;
    return results;
}

export function cosineSimilarity(a, b) {
    var dot = 0, normA = 0, normB = 0;
    for (var i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    var denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
}

export async function testEmbeddingApiConnection(cfg) {
    var testCfg = cfg || loadEmbeddingApiConfig();
    if (!testCfg || !testCfg.url) return { success: false, error: 'No API URL configured' };
    try {
        var resp = await fetchWithTimeout(testCfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (testCfg.key || '')
            },
            body: JSON.stringify({ model: testCfg.model, input: 'test' })
        }, Math.min(getConfiguredTimeoutSec(120) * 250, 30000));
        if (!resp.ok) {
            var errText = '';
            try { errText = await resp.text(); } catch (e) {}
            return { success: false, error: 'HTTP ' + resp.status + (errText ? ': ' + errText.substring(0, 120) : '') };
        }
        var data = await resp.json();
        var vec = data.data && data.data[0] && data.data[0].embedding;
        if (!vec || !Array.isArray(vec)) return { success: false, error: 'No embedding in response' };
        return { success: true, dimensions: vec.length };
    } catch (e) {
        return { success: false, error: e && e.message ? e.message : String(e) };
    }
}

/**
 * 向量质量端到端测试：批量化 → 余弦相似度排序 → 验证语义检索正确性
 * 测试集包含中英双语、同义改写、反义词，覆盖叙事文本检索的典型场景。
 */
export async function runVectorQualityTest(cfg) {
    var testCfg = cfg || loadEmbeddingApiConfig();
    if (!testCfg || !testCfg.url) return { success: false, error: 'No API URL configured' };

    var testSet = [
        { id: 'scene_transfer', text: '半夜遇到梦游的舍友在走廊里游荡，她似乎完全没发现自己被转性了' },
        { id: 'work_dispute', text: '凌晨三点，他们在办公室里为方案争执，声音大到隔壁都能听到' },
        { id: 'quiet_night', text: '夜深人静，窗外只有风声，房间里只亮着一盏台灯' },
        { id: 'confrontation', text: '她挡在门口，盯着对方的眼睛，一字一字地说："你不敢。"' },
        { id: 'flashback', text: '回忆起童年的那个雨天，母亲撑着伞在校门口等他，一等就是两小时' },
        { id: 'en_scene', text: 'He wandered the hallway at 3am, not recognizing his own reflection in the mirror.' },
        { id: 'en_conflict', text: 'She blocked the door, staring into his eyes. "You wouldn\'t dare," she said slowly.' },
    ];

    var queryText = '半夜在公寓走廊碰见了一个游荡的人';
    var expectedBest = 'scene_transfer';

    try {
        var allTexts = testSet.map(function(s) { return s.text; });
        var allEmb = await computeEmbeddings(allTexts);
        if (!allEmb) return { success: false, error: 'Batch embedding failed — check API configuration' };

        var queryEmb = await computeEmbedding(queryText);
        if (!queryEmb) return { success: false, error: 'Query embedding failed' };

        var results = testSet.map(function(s, i) {
            return {
                id: s.id,
                text: s.text.substring(0, 40),
                // R4: 部分失败时向量为 null，给 -1 分排到末尾，不影响 top 判定
                score: allEmb[i] ? cosineSimilarity(queryEmb, allEmb[i]) : -1
            };
        });
        results.sort(function(a, b) { return b.score - a.score; });

        var top = results[0];
        var pass = top.id === expectedBest;
        var dimension = allEmb[0].length;

        var scoreSummary = results.map(function(r, i) {
            return (i + 1) + '. ' + r.id + (r.id === expectedBest ? ' ★' : '') + ' (' + r.score.toFixed(4) + ')';
        }).join(', ');

        return {
            success: pass,
            pass: pass,
            dimensions: dimension,
            topResult: top.id + ' (' + top.score.toFixed(4) + ')',
            expected: expectedBest,
            scoreSummary: scoreSummary,
            detail: pass
                ? 'OK — vector correctly matched "' + expectedBest + '" as top result (' + dimension + 'd). Semantic retrieval is working.'
                : 'Top result was "' + top.id + '", expected "' + expectedBest + '". Cosine similarity may be inaccurate for this model/dimension. Retrieval quality may be degraded.'
        };
    } catch (e) {
        return { success: false, error: e && e.message ? e.message : String(e) };
    }
}

export { EMBEDDING_DIM };
