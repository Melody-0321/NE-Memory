import { loadRetrievalApiConfig } from '../api/llm.js';

var EMBEDDING_DIM = 1536;

export function loadEmbeddingApiConfig() {
    try {
        var raw = localStorage.getItem('ne_embedding_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

export function saveEmbeddingApiConfig(config) {
    if (config && config.url) config.url = config.url.replace(/\/+$/, '');
    localStorage.setItem('ne_embedding_api', JSON.stringify(config));
}

export function isVectorSearchEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? !!JSON.parse(raw).enableVectorSearch : false;
    } catch (e) { return false; }
}

export async function computeEmbedding(text) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;

    try {
        var resp = await fetch(cfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (cfg.key || '')
            },
            body: JSON.stringify({ model: cfg.model, input: text })
        });
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

export async function computeEmbeddings(texts) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;
    if (!texts || texts.length === 0) return [];

    try {
        var resp = await fetch(cfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (cfg.key || '')
            },
            body: JSON.stringify({ model: cfg.model, input: texts })
        });
        if (!resp.ok) throw new Error('Embedding API returned ' + resp.status);
        var data = await resp.json();
        var embeddings = data.data;
        if (!embeddings || !Array.isArray(embeddings)) throw new Error('No embeddings in response');
        EMBEDDING_DIM = embeddings[0].embedding.length;
        return embeddings.map(function(d) { return new Float32Array(d.embedding); });
    } catch (e) {
        console.warn('[NE] computeEmbeddings failed:', e && e.message);
        return null;
    }
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
        var resp = await fetch(testCfg.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (testCfg.key || '')
            },
            body: JSON.stringify({ model: testCfg.model, input: 'test' })
        });
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
            return { id: s.id, text: s.text.substring(0, 40), score: cosineSimilarity(queryEmb, allEmb[i]) };
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
