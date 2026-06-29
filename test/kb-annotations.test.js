
var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== kb-annotations: entity annotation parsing ===');

function parseKBLine(line) {
    var match = line.match(/^(.+?)=(.+?)(?:\((.+)\))?$/);
    if (!match) return null;
    var level = match[2].trim();
    var validLevels = ['直接知晓', '间接知晓', '线索', '未知'];
    if (validLevels.indexOf(level) === -1) {
        var fuzzy = validLevels.find(function(v) { return v.indexOf(level) !== -1 || level.indexOf(v) !== -1; });
        if (fuzzy) level = fuzzy;
    }
    return { name: match[1].trim(), level: level, reason: (match[3] || '').trim() };
}

function parseEntityAnnotations(text) {
    var entityAnnotations = {};
    var gaps = [];
    var hasKB = false;
    var lines = text.split('\n');
    var inGaps = false;
    var currentEntity = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var entityMatch = line.match(/^\[实体:\s*(.+?)\]/);
        if (entityMatch) {
            currentEntity = entityMatch[1].trim();
            if (!entityAnnotations[currentEntity]) entityAnnotations[currentEntity] = [];
            inGaps = false;
            continue;
        }
        if (/^##\s*缺口/.test(line)) { inGaps = true; currentEntity = null; continue; }
        if (inGaps) {
            var gapMatch = line.match(/^[-*]\s+(.+)/);
            if (gapMatch && gapMatch[1].trim() !== '无') gaps.push(gapMatch[1].trim());
            continue;
        }
        var kbMatch = line.match(/^\[KB:\s*(.+?)\]/);
        if (kbMatch) {
            var kbContent = kbMatch[1].trim();
            if (kbContent === '无') { hasKB = false; continue; }
            if (currentEntity) {
                var parsed = parseKBLine(kbContent);
                if (parsed) { entityAnnotations[currentEntity].push(parsed); hasKB = true; }
            }
        }
    }
    return { entityAnnotations: entityAnnotations, gaps: gaps, hasKB: hasKB };
}

function buildEntityBlock(entityGrouped, entityAnnotations) {
    var lines = [];
    lines.push('## 实体记忆链');
    lines.push('');
    Object.keys(entityGrouped.groups).forEach(function(name) {
        var group = entityGrouped.groups[name];
        var annotations = entityAnnotations[name] || [];
        var kbLine = '';
        if (annotations.length > 0) {
            kbLine = ' [KB: ' + annotations.map(function(a) {
                return a.name + '=' + a.level + (a.reason ? '(' + a.reason + ')' : '');
            }).join(' | ') + ']';
        }
        var refCount = group.refs ? group.refs.length : 0;
        var refPart = refCount > 0 ? ', ' + refCount + ' refs' : '';
        lines.push('### ' + name + ' (' + group.entries.length + ' events' + refPart + ')' + kbLine);
        group.entries.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event);
            if (e._originalText) lines.push('   > ' + e._originalText.replace(/\n/g, '\n   > '));
        });
        if (group.refs && group.refs.length > 0) {
            lines.push('');
            var refMap = {};
            group.refs.forEach(function(r) {
                if (!refMap[r.primaryName]) refMap[r.primaryName] = [];
                refMap[r.primaryName].push(r.entryId);
            });
            Object.keys(refMap).forEach(function(primary) {
                lines.push('   关联: 见「' + primary + '」' + refMap[primary].join(', '));
            });
        }
        lines.push('');
    });
    if (entityGrouped.unassigned && entityGrouped.unassigned.length > 0) {
        lines.push('### 未标注条目 (' + entityGrouped.unassigned.length + ' entries)');
        entityGrouped.unassigned.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event);
        });
        lines.push('');
    }
    return lines.join('\n');
}

function buildMemoryUsageGuide() {
    var lines = [];
    lines.push('## 记忆使用指南');
    lines.push('以上记忆按实体分链，时间排序。每条链顶部的 KB 标注表示各角色对该链事件集合的知晓程度：');
    lines.push('- **直接知晓** = 该角色亲自在场或经历，完全知情。可自由使用链中所有事件来驱动决策和对话。');
    lines.push('- **间接知晓** = 该角色通过转述、书面记录或可观察后果推断得知。可引用链中事件但需保持细节不确定性。');
    lines.push('- **线索** = 该角色只有碎片信息。仅能基于碎片做有限推理，不应表现出全知。');
    lines.push('- 链中未提到的角色 = 该角色**不知道**此链中的事件。仅供你理解全局故事语境，禁止该角色在对话中表现出知情。');
    return lines.join('\n');
}

console.log('--- parseEntityAnnotations ---');

var emptyResult = parseEntityAnnotations('');
eq(Object.keys(emptyResult.entityAnnotations).length, 0, 'empty text => no annotations');
eq(emptyResult.gaps.length, 0, 'empty text => no gaps');

var singleEntityText = '[实体: 张三]\n[KB: 张三=直接知晓(亲自在场)]\n[KB: 李四=间接知晓(听张三讲述)]';
var singleResult = parseEntityAnnotations(singleEntityText);
eq(Object.keys(singleResult.entityAnnotations).length, 1, 'single entity detected');
eq(singleResult.entityAnnotations['张三'].length, 2, '2 KB annotations for 张三');
eq(singleResult.entityAnnotations['张三'][0].name, '张三', 'first char name');
eq(singleResult.entityAnnotations['张三'][0].level, '直接知晓', 'first char level');
eq(singleResult.entityAnnotations['张三'][0].reason, '亲自在场', 'first char reason');
eq(singleResult.entityAnnotations['张三'][1].name, '李四', 'second char name');
eq(singleResult.entityAnnotations['张三'][1].level, '间接知晓', 'second char level');
eq(singleResult.hasKB, true, 'hasKB=true when annotations present');

var multiEntityText = '[实体: 张三]\n[KB: 张三=直接知晓]\n\n[实体: 李四]\n[KB: 李四=直接知晓]\n[KB: 张三=间接知晓(观察后果)]';
var multiResult = parseEntityAnnotations(multiEntityText);
eq(Object.keys(multiResult.entityAnnotations).length, 2, '2 entities detected');
eq(multiResult.entityAnnotations['张三'].length, 1, '1 annotation for 张三 entity');
eq(multiResult.entityAnnotations['李四'].length, 2, '2 annotations for 李四 entity');
eq(multiResult.entityAnnotations['李四'][1].name, '张三', 'cross-reference annotation');

var gapsText = '[实体: 张三]\n[KB: 张三=直接知晓]\n\n## 缺口\n- 缺失精灵族起源的详细记载\n- 需要补充森林战役的经过';
var gapsResult = parseEntityAnnotations(gapsText);
eq(gapsResult.gaps.length, 2, '2 gaps detected');
eq(gapsResult.gaps[0], '缺失精灵族起源的详细记载', 'first gap content');
eq(gapsResult.gaps[1], '需要补充森林战役的经过', 'second gap content');

var emptyKB = '[实体: 张三]\n[KB: 无]';
var emptyKBResult = parseEntityAnnotations(emptyKB);
eq(emptyKBResult.hasKB, false, 'hasKB=false when [KB: 无]');
eq(emptyKBResult.entityAnnotations['张三'].length, 0, 'no annotations for [KB: 无]');

var gapsNoContent = '## 缺口\n- 无';
var gapsNoResult = parseEntityAnnotations(gapsNoContent);
eq(gapsNoResult.gaps.length, 0, '"无" gap not counted');

console.log('--- parseKBLine ---');

var fuzzyLine = parseKBLine('主角=直接');
assert(fuzzyLine !== null, 'fuzzy level "直接" matched');
eq(fuzzyLine.level, '直接知晓', 'fuzzy "直接" => "直接知晓"');

eq(parseKBLine('garbage input'), null, 'garbage input => null');
eq(parseKBLine(''), null, 'empty => null');

console.log('--- buildEntityBlock ---');

var emptyGrouped = { groups: {}, unassigned: [] };
var emptyBlock = buildEntityBlock(emptyGrouped, {});
assert(emptyBlock.indexOf('## 实体记忆链') !== -1, 'block has header');
assert(emptyBlock.indexOf('### ') === -1, 'no entity sections for empty groups');

var mockEntry = { entry: { period: 'Day 1', scene: '古城', event: '发现秘境入口', id: 'stm_001' } };
var mockGrouped = {
    groups: {
        '张三': { entries: [mockEntry], refs: [], name: '张三' }
    },
    unassigned: []
};
var mockAnnotations = { '张三': [{ name: '张三', level: '直接知晓', reason: '' }] };
var blockWithAnnotations = buildEntityBlock(mockGrouped, mockAnnotations);
assert(blockWithAnnotations.indexOf('### 张三') !== -1, 'entity section present');
assert(blockWithAnnotations.indexOf('[KB: 张三=直接知晓]') !== -1, 'KB annotation inline');
assert(blockWithAnnotations.indexOf('Day 1') !== -1, 'time period shown');
assert(blockWithAnnotations.indexOf('古城: 发现秘境入口') !== -1, 'event shown');

var mockGroupedNoKB = {
    groups: {
        '李四': { entries: [mockEntry], refs: [], name: '李四' }
    },
    unassigned: []
};
var blockNoKB = buildEntityBlock(mockGroupedNoKB, {});
assert(blockNoKB.indexOf('[KB:') === -1, 'no KB line when no annotations');

var refGroup = {
    groups: {
        '张三': {
            entries: [mockEntry],
            refs: [{ entryId: 'stm_002', primaryName: '李四' }],
            name: '张三'
        }
    },
    unassigned: []
};
var refBlock = buildEntityBlock(refGroup, {});
assert(refBlock.indexOf('关联: 见「李四」') !== -1, 'cross-reference shown');

var unassignedEntry = { entry: { period: 'Day 3', scene: '森林', event: '遭遇狼群' } };
var unassignedGrouped = {
    groups: {},
    unassigned: [unassignedEntry]
};
var unassignedBlock = buildEntityBlock(unassignedGrouped, {});
assert(unassignedBlock.indexOf('### 未标注条目') !== -1, 'unassigned section present');
assert(unassignedBlock.indexOf('遭遇狼群') !== -1, 'unassigned event shown');

console.log('--- buildMemoryUsageGuide ---');

var guide = buildMemoryUsageGuide();
assert(guide.indexOf('## 记忆使用指南') !== -1, 'guide has header');
assert(guide.indexOf('直接知晓') !== -1, 'guide mentions 直接知晓');
assert(guide.indexOf('间接知晓') !== -1, 'guide mentions 间接知晓');
assert(guide.indexOf('线索') !== -1, 'guide mentions 线索');
assert(guide.indexOf('实体分链') !== -1, 'guide mentions entity chains');

console.log('\n--- kb-annotations: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
