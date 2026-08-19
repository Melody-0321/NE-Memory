// resolver-batch-corpus.js — 追加 buildCapacityCorpus：事件文本量（L）× 条数（K）的容量语料
// 与对话解耦：claim 事件文本按目标长度 L 合成（填充式长事件），对话用 modality-eval-dev 的短对话。
// 局限登记（resolver-capacity-quality-plan §7）：填充式长事件 ≠ 真实长事件（真实长事件信息密度高），
// 结论指向"文本量对 resolver 的影响"而非真实事件语义复杂度。

import { modalityEvalDev } from './modality-eval-dev.js';

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 把 claim 文本扩展到目标长度 L：以角色首条主张为核心 + 填充从句（保持语义是"最初主张"的 claim）
// 修正（2026-08-19，resolver-capacity-quality 阶段 B 发现）：T02/H03/H05/H07 的 messages[0] 是 user 提问，
// 误当事件会污染结果——必须取第一条 assistant 消息（真正的角色主张）。
function expandClaimToLen(caseObj, L) {
    var claimMsg = caseObj.messages.find(function (m) { return m.role === 'assistant'; }) || caseObj.messages[0];
    var base = claimMsg.mes;
    var fillers = [
        '（这是角色在对话初期立下的承诺，后来是否兑现尚待后续验证）',
        '（当时角色态度明确，语气坚决，认为自己一定能做到）',
        '（这段表态发生在两人日常相处的场景里，是角色对自己设定的一个目标）',
        '（从说话时的语气和后续语境看，这个主张是角色真实的想法，而非随口玩笑）',
    ];
    var rnd = mulberry32(hashStr(caseObj.id));
    var out = base;
    var guard = 0;
    while (out.length < L && guard < 20) {
        var f = fillers[Math.floor(rnd() * fillers.length)];
        out += f;
        guard++;
    }
    if (out.length > L) out = out.slice(0, L - 1) + '…';
    return out;
}

function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// buildCapacityCorpus({ L, K, segments }) → 该 (L,K) 下的段列表（复用 buildBatchCorpus 的分桶逻辑）
// events 的 eventText = 按 L 扩展的 claim 文本（resolver 输入事件），与对话独立
export function buildCapacityCorpus(opts) {
    opts = opts || {};
    var L = opts.L || 60;
    var K = opts.K || 2;
    var segments = opts.segments || 4;
    var seed = opts.seed || 20260819;

    var rnd = mulberry32(seed + L * 1000 + K * 10);
    var segs = [];
    var caseIds = modalityEvalDev.map(function (c) { return c.id; });
    for (var s = 0; s < segments; s++) {
        var picked = [];
        var pool = caseIds.slice();
        for (var p = 0; p < K; p++) {
            var idx = Math.floor(rnd() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
        }
        var cases = picked.map(function (id) {
            return modalityEvalDev.find(function (c) { return c.id === id; });
        }).filter(Boolean);
        var messages = [];
        cases.forEach(function (c, ci) {
            c.messages.forEach(function (m, mi) {
                messages.push({
                    role: m.role, name: m.name, mes: (ci > 0 && mi === 0 ? '\n（下一条主题）\n' : '') + m.mes,
                });
            });
        });
        segs.push({
            id: 'L' + L + '_K' + K + '_S' + s,
            L: L, K: K,
            messages: messages,
            events: cases.map(function (c, ci) {
                return {
                    idx: ci,
                    caseId: c.id,
                    eventText: expandClaimToLen(c, L), // 按 L 扩展的 claim 事件
                    finalState: c.finalState || null,
                    expectedNote: c.expectedNote || '',
                    category: c.category,
                    explicit: c.explicit,
                };
            }),
        });
    }
    return segs;
}