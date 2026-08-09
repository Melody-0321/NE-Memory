import { normalizeVec, cosineSimilarity } from '../src/core/engine/embedding.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(Math.abs(a - b) < 1e-6, msg + ' (got ' + a + ', want ' + b + ')'); }
function near(a, b, msg) { assert(Math.abs(a - b) < 1e-6, msg + ' (got ' + a + ', want ' + b + ')'); }

console.log('\n=== embedding: normalizeVec 与 R3 归一化点积等价 ===');

// 1. 归一化后 L2 范数为 1
(function() {
    var v = new Float32Array([1, 2, 3, 4]);
    var out = normalizeVec(v);
    var sum = 0;
    for (var i = 0; i < out.length; i++) sum += out[i] * out[i];
    near(Math.sqrt(sum), 1, 'normalizeVec: L2 范数归一为 1');
    assert(out === v, 'normalizeVec: 原地修改返回同一引用');
})();

// 2. 零向量不崩、保持原样
(function() {
    var z = new Float32Array([0, 0, 0]);
    var out = normalizeVec(z);
    var sum = 0;
    for (var i = 0; i < out.length; i++) sum += out[i] * out[i];
    eq(sum, 0, 'normalizeVec: 零向量保持原样');
})();

// 3. 幂等：已归一化向量再次归一化不变
(function() {
    var v = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    var once = normalizeVec(v.slice());
    var twice = normalizeVec(once.slice());
    var same = true;
    for (var i = 0; i < once.length; i++) {
        if (Math.abs(once[i] - twice[i]) > 1e-6) { same = false; break; }
    }
    assert(same, 'normalizeVec: 幂等（二次归一化不变）');
})();

// 4. R3 核心：归一化后点积 === 归一化余弦（索引向量归一化入库 + query 归一化 → 纯点积即余弦）
(function() {
    var a = new Float32Array([1.2, -0.4, 2.1, 0.7, 3.3]);
    var b = new Float32Array([-0.8, 1.5, 0.3, 2.2, -1.1]);
    var na = normalizeVec(a.slice());
    var nb = normalizeVec(b.slice());
    var dot = 0;
    for (var i = 0; i < na.length; i++) dot += na[i] * nb[i];
    var cos = cosineSimilarity(a, b);
    near(dot, cos, 'R3: normalizeVec 点积与 cosineSimilarity 等价');
})();

// 5. 负向量（语义相反）点积为负，正向量为正
(function() {
    var u = new Float32Array([1, 0, 0]);
    var v = new Float32Array([0, 1, 0]);
    var nv = new Float32Array([-1, 0, 0]);
    var dotOrtho = 0;
    var dotNeg = 0;
    var nu = normalizeVec(u.slice());
    var nv2 = normalizeVec(v.slice());
    var nn = normalizeVec(nv.slice());
    for (var i = 0; i < nu.length; i++) { dotOrtho += nu[i] * nv2[i]; dotNeg += nu[i] * nn[i]; }
    near(dotOrtho, 0, '归一化点积：正交向量为 0');
    near(dotNeg, -1, '归一化点积：相反向量为 -1');
})();

console.log('embedding normalizeVec: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
