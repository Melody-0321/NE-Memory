/**
 * entity-chain.test.js — 实体链（lookupEntityChains）单测
 *
 * P1-18 接线恢复后，SmartPush 注入流程依赖此函数从事件指针（present_characters）
 * 实时构建实体链。覆盖：基本聚合、时间排序、跨 STM/LTM、entities 字段回退、
 * 对象数组 {name} 兼容、未命中实体不建链。
 */
import { lookupEntityChains } from '../src/core/engine/retrieval.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

console.log('\n=== entity-chain: P1-18 指针 → 链 ===');

var content = {
    unconsolidated_stm: [
        { id: 's1', event: '初见', present_characters: ['Alice'], timestamp: '2026-01-01T00:00:00.000Z', absMsgStart: 0 },
        { id: 's2', event: '同行', present_characters: ['Alice', 'Bob'], timestamp: '2026-01-03T00:00:00.000Z', absMsgStart: 1 },
        { id: 's3', event: '独白', present_characters: null, timestamp: '2026-01-05T00:00:00.000Z', absMsgStart: 2 }
    ],
    stm_entries: [],
    ltm_entries: [
        { id: 'l1', event: '分别', present_characters: ['Bob'], timestamp: '2026-02-01T00:00:00.000Z' }
    ]
};

(async function() {
    var chains = await lookupEntityChains(content, ['Alice', 'Bob', 'Ghost']);

    // 基本聚合 + 时间升序
    ok(chains.Alice && chains.Alice.length === 2, 'Alice 链含 2 条事件');
    eq(chains.Alice[0].id, 's1', 'Alice 链按时间升序 → s1 在前');
    eq(chains.Alice[1].id, 's2', 'Alice 链按时间升序 → s2 在后');

    // 跨 STM + LTM 聚合
    ok(chains.Bob && chains.Bob.length === 2, 'Bob 链跨 STM/LTM 共 2 条');
    eq(chains.Bob[0].id, 's2', 'Bob 链 STM 事件在前');
    eq(chains.Bob[1].id, 'l1', 'Bob 链 LTM 事件在后');

    // 未命中实体不建链（Ghost 无事件）
    ok(!chains.Ghost, '未命中实体不出现在结果中');

    // present_characters 为 null 的事件不参与任何链（s3 只出现在 Alice/Bob 之外）
    var allInChain = (chains.Alice || []).concat(chains.Bob || []).map(function(e) { return e.id; });
    ok(allInChain.indexOf('s3') === -1, 'present_characters=null 事件不进链');

    // entities 字段回退（present_characters 缺失时用 entities）
    var contentEntities = {
        unconsolidated_stm: [],
        stm_entries: [{ id: 's4', event: '会议', entities: ['Carol'], timestamp: '2026-03-01T00:00:00.000Z' }],
        ltm_entries: []
    };
    var chainsEntities = await lookupEntityChains(contentEntities, ['Carol']);
    ok(chainsEntities.Carol && chainsEntities.Carol.length === 1, 'entities 字段回退建链');
    eq(chainsEntities.Carol[0].id, 's4', 'entities 回退命中正确事件');

    // 对象数组 {name} 兼容
    var contentObj = {
        unconsolidated_stm: [],
        stm_entries: [{ id: 's5', event: '狩猎', present_characters: [{ name: 'David' }], timestamp: '2026-04-01T00:00:00.000Z' }],
        ltm_entries: []
    };
    var chainsObj = await lookupEntityChains(contentObj, ['David']);
    ok(chainsObj.David && chainsObj.David.length === 1, '对象数组 {name} 兼容建链');

    // 空实体名列表 → 空链
    var chainsEmpty = await lookupEntityChains(content, []);
    eq(Object.keys(chainsEmpty).length, 0, '空实体名列表 → 空结果');

    console.log('--- entity-chain: ' + passed + ' passed, ' + failed + ' failed ---');
    if (failed > 0) process.exit(1);
})();
