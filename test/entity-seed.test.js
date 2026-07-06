var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== entity-seed: NE-BANNER seed + text-matching fallback ===');

function postFillSTM_entities(entries, characters, factions, activeChars) {
    var allKnownNames = Object.keys(characters || {}).concat(Object.keys(factions || {}));
    entries.forEach(function(e) {
        var entities = [];
        (activeChars || []).forEach(function(name) {
            if (entities.indexOf(name) === -1) entities.push(name);
        });
        var eventText = (e.event || '') + (e.scene || '') + (e.summary || '');
        allKnownNames.forEach(function(name) {
            if (entities.indexOf(name) === -1 && eventText.indexOf(name) !== -1) {
                entities.push(name);
            }
        });
        e.entities = entities;
    });
}

console.log('--- NE-BANNER seed only ---');

var entries1 = [{ event: '张三进入教室', scene: '教室' }];
postFillSTM_entities(entries1, { 张三: {}, 李四: {} }, {}, ['张三']);
eq(entries1[0].entities.length, 1, 'banner seed: 1 entity');
eq(entries1[0].entities[0], '张三', 'banner seed: correct name');

console.log('--- text-matching fallback ---');

var entries2 = [{ event: '张三和李四在操场打球', scene: '操场' }];
postFillSTM_entities(entries2, { 张三: {}, 李四: {} }, {}, []);
eq(entries2[0].entities.length, 2, 'text match: 2 entities found');
assert(entries2[0].entities.indexOf('张三') !== -1, 'text match: 张三 in text');
assert(entries2[0].entities.indexOf('李四') !== -1, 'text match: 李四 in text');

console.log('--- dedup: seed + text overlap ---');

var entries3 = [{ event: '张三发现了密室', scene: '密室' }];
postFillSTM_entities(entries3, { 张三: {}, 李四: {} }, {}, ['张三']);
eq(entries3[0].entities.length, 1, 'dedup: 张三 not duplicated');

console.log('--- faction name matching ---');

var entries4 = [{ event: '正道联盟向魔教宣战', scene: '大殿' }];
postFillSTM_entities(entries4, { 张三: {} }, { 正道联盟: {}, 魔教: {} }, ['张三']);
eq(entries4[0].entities.length, 3, 'faction match: 3 entities (1 seed + 2 factions)');

console.log('--- no entities at all ---');

var entries5 = [{ event: '下雨了', scene: '户外' }];
postFillSTM_entities(entries5, {}, {}, []);
eq(entries5[0].entities.length, 0, 'no entities when no chars/factions/seed');

console.log('--- empty seed, empty known names ---');

var entries6 = [{ event: '发生了什么' }];
postFillSTM_entities(entries6, null, null, null);
eq(entries6[0].entities.length, 0, 'handles null inputs gracefully');

console.log('\n--- entity-seed: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
