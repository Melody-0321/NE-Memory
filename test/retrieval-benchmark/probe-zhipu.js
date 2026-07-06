import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);

var API_KEY = '778c57a7a5ae40039e0e78bb00d852b4.DyAB4vVY3m9rrADc';

var MODELS = [
    'embedding-2',
    'embedding-3',
];

var ENDPOINTS = [
    'https://open.bigmodel.cn/api/paas/v4/embeddings',
];

async function probe(endpoint, model) {
    try {
        var resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: JSON.stringify({ model: model, input: '测试文本' })
        });
        var data = await resp.json();
        if (!resp.ok) {
            return { ok: false, error: 'HTTP ' + resp.status + ': ' + JSON.stringify(data).substring(0, 200) };
        }
        var dim = data.data && data.data[0] && data.data[0].embedding ? data.data[0].embedding.length : '?';
        return { ok: true, dim: dim, model: model };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function main() {
    console.log('=== Zhipu AI Embedding Model Probe ===\n');
    
    for (var ei = 0; ei < ENDPOINTS.length; ei++) {
        var endpoint = ENDPOINTS[ei];
        console.log('Endpoint: ' + endpoint + '\n');
        
        for (var mi = 0; mi < MODELS.length; mi++) {
            var model = MODELS[mi];
            process.stdout.write('  ' + model + ' ... ');
            var r = await probe(endpoint, model);
            if (r.ok) {
                console.log('OK (' + r.dim + 'd)');
            } else {
                console.log('FAIL: ' + r.error);
            }
        }
        console.log('');
    }
}

main().catch(function(e) { console.error(e); process.exit(1); });
