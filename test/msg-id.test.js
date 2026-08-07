import { buildMsgId, findMessageInChat, collectAllMsgIds, lookupMessageByDate, ensureNeMsgId } from '../src/core/engine/msg-id.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

// ── buildMsgId 格式 ──

console.log('\n=== msg-id: buildMsgId idx 前缀 ===');

var mUser = { send_date: '2026-07-09T06:55:00.000Z', is_user: true };
var idUser = buildMsgId(mUser, 3);
ok(idUser.startsWith('3_'), 'idx prefix (3) present: ' + idUser);
ok(idUser.endsWith('_user'), 'role suffix user: ' + idUser);
ok(idUser.indexOf('2026-07-09T06:55:00.000Z') > 0, 'send_date in middle: ' + idUser);

var mAsst = { send_date: '2026-07-09T06:56:00.000Z', is_user: false };
var idAsst = buildMsgId(mAsst, 4);
ok(idAsst.startsWith('4_'), 'idx prefix (4) present: ' + idAsst);
ok(idAsst.endsWith('_assistant'), 'role suffix assistant: ' + idAsst);

// idx 为 0
var idZero = buildMsgId(mUser, 0);
ok(idZero.startsWith('0_'), 'idx prefix (0) present: ' + idZero);

// 不传 idx → 降级标记 ?
var idNoIdx = buildMsgId(mUser);
ok(idNoIdx.startsWith('?_'), 'no idx → fallback ?_: ' + idNoIdx);

// created_date 后备
var mCreated = { created_date: '2026-01-01T00:00:00.000Z', is_user: false };
var idCreated = buildMsgId(mCreated, 2);
ok(idCreated.indexOf('2026-01-01T00:00:00.000Z') > 0, 'created_date fallback: ' + idCreated);

// role 字段后备
var mRole = { send_date: '2026-07-09T06:55:00.000Z', role: 'user' };
eq(buildMsgId(mRole, 5).endsWith('_user'), true, 'role field (user): ' + buildMsgId(mRole, 5));

// 旧格式 ID 后备
var mLegacy = { id: 'msg_abc_123' };
var idLegacy = buildMsgId(mLegacy, 7);
ok(idLegacy.startsWith('7_'), 'legacy ID idx prefix: ' + idLegacy);
ok(idLegacy.indexOf('msg_abc_123') > 0, 'legacy ID preserved: ' + idLegacy);

// 纯数字 ID 后备
var mNum = { id: 42 };
var idNum = buildMsgId(mNum, 8);
ok(idNum.indexOf('0000-00-00') > 0, 'pure numeric ID → 0000 placeholder');

console.log('\n=== msg-id: collectAllMsgIds ===');

var msgs = [
    { send_date: '2026-01-01T00:00:00.000Z', is_user: true },
    { send_date: '2026-01-02T00:00:00.000Z', is_user: false },
    { send_date: '2026-01-03T00:00:00.000Z', is_user: true }
];
var collected = collectAllMsgIds(msgs);
eq(collected.length, 3, 'collectAllMsgIds length');
ok(collected[0].startsWith('0_'), 'first msg idx=0: ' + collected[0]);
ok(collected[1].startsWith('1_'), 'second msg idx=1: ' + collected[1]);
ok(collected[2].startsWith('2_'), 'third msg idx=2: ' + collected[2]);

// 空数组
eq(collectAllMsgIds([]).length, 0, 'empty array → empty result');
eq(collectAllMsgIds(null).length, 0, 'null → empty result');

console.log('\n=== msg-id: findMessageInChat O(1) + 漂移兜底 ===');

var chat = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true, id: 0 },
    { send_date: '2026-07-02T00:00:00.000Z', is_user: false, id: 1 },
    { send_date: '2026-07-03T00:00:00.000Z', is_user: true, id: 2 },
    { send_date: '2026-07-04T00:00:00.000Z', is_user: false, id: 3 },
];

// O(1) 首跳 — idx 匹配
var mid = buildMsgId(chat[1], 1);  // "1_2026-07-02T00:00:00.000Z_assistant"
var found = findMessageInChat(chat, mid);
ok(found !== null, 'O(1) lookup hit: ' + mid);
eq(found.send_date, '2026-07-02T00:00:00.000Z', 'O(1) correct send_date');

// 漂移兜底 — idx 不指向原位置 (模拟消息被删除后重建)
var chatAfterDelete = [
    chat[0],  // idx 0 不变
    chat[2],  // idx 1 现在是第三个
    chat[3],  // idx 2 现在是第四个
];
// 用旧的 msgId 找 chat[2]（send_date=2026-07-03, 原来是 idx=2, 现在在 idx=1）
var midForShifted = buildMsgId(chat[2], 2);
var foundShifted = findMessageInChat(chatAfterDelete, midForShifted);
ok(foundShifted !== null, 'drift fallback hit after delete: ' + midForShifted);
eq(foundShifted.send_date, '2026-07-03T00:00:00.000Z', 'drift fallback correct msg');

// idx 不存在但 send_date+role 可匹配 → 全扫描兜底命中
var midGhost = buildMsgId(chat[0], 99);
var foundGhost = findMessageInChat(chat, midGhost);
ok(foundGhost !== null, 'bad idx but full scan finds by send_date+role');
eq(foundGhost.send_date, '2026-07-01T00:00:00.000Z', 'full scan correct msg');

// idx 和 send_date 都构造为不存在 → 真正返回 null
var midTrulyGhost = '999_2099-01-01T00:00:00.000Z_user';
var foundTrulyGhost = findMessageInChat(chat, midTrulyGhost);
eq(foundTrulyGhost, null, 'truly non-existent msg → null');

// 空 chat
eq(findMessageInChat([], '0_test'), null, 'empty chat → null');

// null msgId
eq(findMessageInChat(chat, null), null, 'null msgId → null');

console.log('\n=== msg-id: findMessageInChat 裸数字（O(1) 下标反问）===');

// 下标与 m.id 一致 → O(1) 直取
var bareHit = findMessageInChat(chat, 1);
ok(bareHit !== null, 'bare digit O(1) hit');
eq(bareHit.send_date, '2026-07-02T00:00:00.000Z', 'bare digit correct msg');

// 字符串形式数字同样生效（LLM 可能输出 "95" 字符串）
var bareStrHit = findMessageInChat(chat, '3');
ok(bareStrHit !== null, 'bare digit string hit');
eq(bareStrHit.send_date, '2026-07-04T00:00:00.000Z', 'bare digit string correct msg');

// 下标与 m.id 不符（漂移）→ 回退全量扫描按 m.id 命中
var chatDrift = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true, id: 0 },
    { send_date: '2026-07-02T00:00:00.000Z', is_user: false, id: 2 },   // 位置 1 的 id 是 2
    { send_date: '2026-07-03T00:00:00.000Z', is_user: true, id: 1 },   // id=1 漂移到位置 2
];
var bareDrift = findMessageInChat(chatDrift, 1);
ok(bareDrift !== null, 'bare digit drift → fallback scan hit');
eq(bareDrift.send_date, '2026-07-03T00:00:00.000Z', 'bare digit drift correct msg');

// 无 id 的新建消息 → 按数组位置即身份
var chatNoId = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true },
];
var bareNoId = findMessageInChat(chatNoId, 0);
ok(bareNoId !== null, 'bare digit no-id message → position match');

// 裸数字完全不存在 → null
eq(findMessageInChat(chat, 999), null, 'bare digit non-existent → null');

console.log('\n=== msg-id: lookupMessageByDate ===');

var lookup = lookupMessageByDate(chat, '2026-07-02T00:00:00.000Z');
ok(lookup !== null, 'lookupMessageByDate hit');
eq(lookup.index, 1, 'lookupMessageByDate correct index');

var lookupMiss = lookupMessageByDate(chat, '2099-01-01T00:00:00.000Z');
eq(lookupMiss, null, 'lookupMessageByDate miss → null');

console.log('\n=== msg-id: P1-5 退化日期格式 legacy fallback ===');

// 数字 id 退化格式 "3_0000-00-00T00:00:00.000Z_5_user" 在消息漂移后无法按 send_date 匹配，
// 修复前 fallback 直接断链 → msg 引用永久丢失；修复后提取尾段数字 id 按 m.id 匹配。
var degradedChat = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true, id: 3 },
    { send_date: '2026-07-02T00:00:00.000Z', is_user: false, id: 5 }   // 目标 id=5，漂移后不在原 idx
];
var degradedId = '3_0000-00-00T00:00:00.000Z_5_user';
var degradedHit = findMessageInChat(degradedChat, degradedId);
ok(degradedHit !== null, 'P1-5 degraded date fallback hit by numeric id: ' + degradedId);
eq(degradedHit.id, 5, 'P1-5 degraded date correct msg (id=5)');

// 4 条消息 + idx 越界场景：idx=3 存在但身份不符 → full scan → legacy 命中
var degradedChat2 = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true, id: 0 },
    { send_date: '2026-07-02T00:00:00.000Z', is_user: false, id: 1 },
    { send_date: '2026-07-03T00:00:00.000Z', is_user: true, id: 5 },   // id=5 漂移到位置 2
    { send_date: '2026-07-04T00:00:00.000Z', is_user: false, id: 3 }
];
var degradedHit2 = findMessageInChat(degradedChat2, degradedId);
ok(degradedHit2 !== null, 'P1-5 degraded date fallback after drift: ' + degradedId);
eq(degradedHit2.id, 5, 'P1-5 drifted msg id=5 resolved');

// 退化 id 指向无 id 消息 → 按数组位置即身份（_legacyScan 用 j 兜底）
var degradedNoId = [
    { send_date: '2026-07-01T00:00:00.000Z', is_user: true, id: 0 },
    { send_date: '2026-07-02T00:00:00.000Z', is_user: false, id: 1 },
    { send_date: '2026-07-03T00:00:00.000Z', is_user: true },          // 位置 2 无 id
    { send_date: '2026-07-04T00:00:00.000Z', is_user: false }
];
var degradedIdNoId = '9_0000-00-00T00:00:00.000Z_2_user';
var degradedHitNoId = findMessageInChat(degradedNoId, degradedIdNoId);
ok(degradedHitNoId !== null, 'P1-5 degraded date → position-as-identity for no-id msg');
eq(degradedHitNoId.send_date, '2026-07-03T00:00:00.000Z', 'P1-5 no-id position match correct msg');

// 退化 id 数字不存在 → 返回 null（不误伤）
var degradedGhost = '3_0000-00-00T00:00:00.000Z_99_user';
eq(findMessageInChat(degradedChat2, degradedGhost), null, 'P1-5 non-existent numeric id → null');

console.log('\n=== msg-id: ensureNeMsgId 兼容性 ===');

var compat = ensureNeMsgId(mUser);
ok(typeof compat === 'string', 'ensureNeMsgId returns string');
ok(compat.startsWith('?_'), 'ensureNeMsgId (no idx) → ?_ fallback');

console.log('\n=== msg-id: buildMsgId 确定性 ===');
var id1 = buildMsgId(mUser, 3);
var id2 = buildMsgId(mUser, 3);
eq(id1, id2, 'deterministic: same inputs → same ID: ' + id1);

// ── 总结 ──
console.log('\n--- msg-id tests: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
