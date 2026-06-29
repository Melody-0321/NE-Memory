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

export { EMBEDDING_DIM };
