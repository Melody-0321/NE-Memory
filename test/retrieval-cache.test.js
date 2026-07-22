import { filterCandidates, bm25Score, _resetRetrievalCache } from '../src/core/vault/retrieval-filter.js';
import { tokenize } from '../src/core/engine/text-utils.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

function makeSTM(id, event, scene, entities) {
    return {
        id: id,
        period: 'Day 1',
        scene: scene || '默认场景',
        event: event || '默认事件',
        entities: entities || [],
        msg_ids: [id]
    };
}

console.log('\n=== retrieval-cache: filterCandidates 缓存正确性 ===');

// ── 场景 1: 缓存命中 -- 同 chatId 同 STM 集合连续调用，结果一致 ──
(function() {
    _resetRetrievalCache();
    var stms = [
        makeSTM('s1', '在古城找到秘境入口', '古城'),
        makeSTM('s2', '在森林遭遇怪物袭击', '森林'),
        makeSTM('s3', '在酒馆与商人交易', '酒馆'),
        makeSTM('s4', '古神苏醒引发地震', '神殿'),
        makeSTM('s5', '主角与同伴商议对策', '营地')
    ];
    var r1 = filterCandidates('古城秘境', stms, [], 40, 3, {}, 'chat-A');
    var r2 = filterCandidates('古城秘境', stms, [], 40, 3, {}, 'chat-A');
    eq(r1.length, r2.length, '场景1: 缓存命中结果数量一致');
    var sameOrder = r1.every(function(e, i) { return e.__id === r2[i].__id; });
    assert(sameOrder, '场景1: 缓存命中结果顺序一致');
})();

// ── 场景 2: 新增失效 -- 加一条 STM 后，结果应反映新条目 ──
(function() {
    _resetRetrievalCache();
    var stms = [
        makeSTM('s1', '在古城找到秘境入口', '古城'),
        makeSTM('s2', '在森林遭遇怪物袭击', '森林'),
        makeSTM('s3', '在酒馆与商人交易', '酒馆'),
        makeSTM('s4', '古神苏醒引发地震', '神殿'),
        makeSTM('s5', '主角与同伴商议对策', '营地')
    ];
    filterCandidates('特殊关键词', stms, [], 40, 3, {}, 'chat-B');
    stms.push(makeSTM('s6', '特殊关键词触发的事件', '特殊场景'));
    var r2 = filterCandidates('特殊关键词', stms, [], 40, 3, {}, 'chat-B');
    var found = r2.some(function(e) { return e.__id === 's6'; });
    assert(found, '场景2: 新增 STM 后检索能命中新条目');
})();

// ── 场景 3: 删除失效 -- 移除一条 STM 后，结果不含它 ──
(function() {
    _resetRetrievalCache();
    var stms = [
        makeSTM('s1', '在古城找到秘境入口', '古城'),
        makeSTM('s2', '在森林遭遇怪物袭击', '森林'),
        makeSTM('s3', '在酒馆与商人交易', '酒馆'),
        makeSTM('s4', '古神苏醒引发地震', '神殿'),
        makeSTM('s5', '主角与同伴商议对策', '营地')
    ];
    filterCandidates('神殿地震', stms, [], 40, 3, {}, 'chat-C');
    stms = stms.filter(function(s) { return s.id !== 's4'; });
    var r2 = filterCandidates('神殿地震', stms, [], 40, 3, {}, 'chat-C');
    var stillThere = r2.some(function(e) { return e.__id === 's4'; });
    assert(!stillThere, '场景3: 删除 STM 后结果不再含该条目');
})();

// ── 场景 4: 修改失效 -- 改 STM.event 后，tokens 反映新内容 ──
(function() {
    _resetRetrievalCache();
    var stms = [
        makeSTM('s1', '在古城找到秘境入口', '古城'),
        makeSTM('s2', '在森林遭遇怪物袭击', '森林'),
        makeSTM('s3', '在酒馆与商人交易', '酒馆'),
        makeSTM('s4', '古神苏醒引发地震', '神殿'),
        makeSTM('s5', '主角与同伴商议对策', '营地')
    ];
    filterCandidates('完全不存在的内容', stms, [], 40, 3, {}, 'chat-D');
    stms[0].event = '修改后的独特关键词XYZ';
    var r2 = filterCandidates('独特关键词XYZ', stms, [], 40, 3, {}, 'chat-D');
    var found = r2.some(function(e) { return e.__id === 's1'; });
    assert(found, '场景4: 修改 STM.event 后检索能命中新关键词');
})();

// ── 场景 5: chatId 切换 -- 切到新 chatId 缓存重建，不串数据 ──
(function() {
    _resetRetrievalCache();
    var stmsA = [
        makeSTM('s1', 'A对话的独有事件AAA', '场景A'),
        makeSTM('s2', 'A对话的普通事件', '场景A'),
        makeSTM('s3', 'A对话的普通事件二', '场景A'),
        makeSTM('s4', 'A对话的普通事件三', '场景A'),
        makeSTM('s5', 'A对话的普通事件四', '场景A')
    ];
    var stmsB = [
        makeSTM('s1', 'B对话的独有事件BBB', '场景B'),
        makeSTM('s2', 'B对话的普通事件', '场景B'),
        makeSTM('s3', 'B对话的普通事件二', '场景B'),
        makeSTM('s4', 'B对话的普通事件三', '场景B'),
        makeSTM('s5', 'B对话的普通事件四', '场景B')
    ];
    filterCandidates('独有事件', stmsA, [], 40, 3, {}, 'chat-A2');
    var rB = filterCandidates('BBB', stmsB, [], 40, 3, {}, 'chat-B2');
    var foundB = rB.some(function(e) { return e.__id === 's1' && e.event.indexOf('BBB') !== -1; });
    assert(foundB, '场景5: 切 chatId 后检索命中新 chat 的条目');
    var rA = filterCandidates('AAA', stmsA, [], 40, 3, {}, 'chat-A2');
    var foundA = rA.some(function(e) { return e.__id === 's1' && e.event.indexOf('AAA') !== -1; });
    assert(foundA, '场景5: 切回原 chatId 后检索仍命中原 chat 条目（缓存重建正确）');
})();

// ── 场景 6: 别名变化 -- aliasesMap 加别名后，含别名的查询能命中 ──
(function() {
    _resetRetrievalCache();
    var stms = [
        makeSTM('s1', '与林夏对话', '教室', ['林夏']),
        makeSTM('s2', '在森林探索', '森林'),
        makeSTM('s3', '在酒馆休息', '酒馆'),
        makeSTM('s4', '古神苏醒', '神殿'),
        makeSTM('s5', '同伴会议', '营地')
    ];
    filterCandidates('无关查询', stms, [], 40, 3, {}, 'chat-E');
    var aliasesMap = { '林夏': ['小夏', '夏夏'] };
    var r = filterCandidates('小夏', stms, [], 40, 3, aliasesMap, 'chat-E');
    var found = r.some(function(e) { return e.__id === 's1'; });
    assert(found, '场景6: 别名加入后，含别名的查询能命中 STM');
})();

// ── 附加: bm25Score 纯函数回归（确保缓存改造未污染算法层）──
(function() {
    _resetRetrievalCache();
    var queryTokens = tokenize('古城');
    var docTokens = tokenize('主角在古城找到了秘境入口');
    var allDocs = [
        tokenize('主角在古城找到了秘境入口'),
        tokenize('小队在森林中遇到了怪物'),
        tokenize('在酒馆休息了一晚')
    ];
    var avgLen = (allDocs[0].length + allDocs[1].length + allDocs[2].length) / 3;
    var totalDocs = allDocs.length;
    var docFreq = {};
    allDocs.forEach(function(d) {
        var seen = {};
        d.forEach(function(t) {
            if (!seen[t]) { seen[t] = true; docFreq[t] = (docFreq[t] || 0) + 1; }
        });
    });
    var score = bm25Score(queryTokens, docTokens, avgLen, totalDocs, docFreq);
    gt(score, 0, '附加: bm25Score 纯函数仍正确返回正分');
})();

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
