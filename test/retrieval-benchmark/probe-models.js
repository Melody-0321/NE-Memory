import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);

var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

var MODELS = [
    'BAAI/bge-m3',
    'Pro/BAAI/bge-m3',
    'BAAI/bge-large-zh-v1.5',
    'Qwen/Qwen3-Embedding-4B',
    'Qwen/Qwen3-Embedding-8B',
    'Qwen/Qwen3-VL-Embedding-8B'
];

async function probe(model) {
    try {
        var resp = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.key
            },
            body: JSON.stringify({ model: model, input: '测试' })
        });
        if (!resp.ok) {
            var errText = '';
            try { errText = await resp.text(); } catch (e) {}
            return { ok: false, error: 'HTTP ' + resp.status + ': ' + errText.substring(0, 100) };
        }
        var data = await resp.json();
        var dim = data.data && data.data[0] && data.data[0].embedding ? data.data[0].embedding.length : '?';
        return { ok: true, dim: dim };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function main() {
    console.log('=== SiliconFlow Embedding Model Probe ===\n');
    for (var i = 0; i < MODELS.length; i++) {
        var model = MODELS[i];
        process.stdout.write('Probing ' + model + ' ... ');
        var r = await probe(model);
        if (r.ok) {
            console.log('OK (' + r.dim + 'd)');
        } else {
            console.log('FAIL: ' + r.error);
        }
    }
}

main().catch(function(e) {
    console.error(e);
    process.exit(1);
});
