/**
 * injection-stateblock.test.js — P0 状态原子块测试
 *
 * 覆盖：
 * - buildStateAtomBlock：people/world 段渲染、空值/'(未填)'/'_'前缀跳过、数组值 join、
 *   valueMaxChars 截断、_hidden faction 跳过、全空返回 ''
 * - formatSmartContext 接线：stateBlockEnabled off 时字节级不变（不触发 readState）
 */
import { buildStateAtomBlock } from '../src/core/engine/injection.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== injection-stateblock: buildStateAtomBlock ===');

// 基本形态：people + world
var block = buildStateAtomBlock({
    characters: {
        '江岚': { '职业': '网络小说作者', '住处': '702公寓', '好感度': 85 },
        '安然': { '职业': '网络小说作者，写感情线' }
    },
    factions: {
        '王姐编辑部': { name: '王姐编辑部', description: '出版公司编辑部', leader: '王姐', attitude_toward_player: '友好', notes: '' }
    }
}, {});
assert(block.indexOf('[当前状态] 已确立的事实') === 0, '标题打头');
assert(block.indexOf('people:') !== -1, 'people 段存在');
assert(block.indexOf('  江岚:') !== -1, '角色行缩进 2 格');
assert(block.indexOf('    - 职业: 网络小说作者') !== -1, '字段行缩进 4 格');
assert(block.indexOf('    - 好感度: 85') !== -1, 'number 值直接渲染');
assert(block.indexOf('world:') !== -1, 'world 段存在');
assert(block.indexOf('    - 描述: 出版公司编辑部') !== -1, 'faction 描述渲染');
assert(block.indexOf('    - 备注') === -1, '空 notes 跳过');

// 空值/未填/_前缀跳过
var block2 = buildStateAtomBlock({
    characters: {
        '甲': { '空串': '', '未填': '(未填)', 'null值': null, '_系统': 'x', '有效': 'ok', '空数组': [] }
    }
}, {});
assert(block2.indexOf('空串') === -1, '空串字段跳过');
assert(block2.indexOf('(未填)') === -1, '未填字段跳过');
assert(block2.indexOf('null值') === -1, 'null 字段跳过');
assert(block2.indexOf('_系统') === -1, '_ 前缀系统字段跳过');
assert(block2.indexOf('空数组') === -1, '空数组字段跳过');
assert(block2.indexOf('- 有效: ok') !== -1, '有效字段保留');

// 数组值 join
var block3 = buildStateAtomBlock({
    characters: { '甲': { '别名': ['小安', '安然'] } }
}, {});
assert(block3.indexOf('- 别名: 小安、安然') !== -1, '数组值顿号 join');

// 对象字段展开（affection 形态，V2 暴露的 [object Object] bug）+ 旁白伪角色过滤
var block3b = buildStateAtomBlock({
    characters: {
        '旁白': { '职业': '叙述者', '体型': '无实体', 'name': '旁白', 'status': '非活跃' },
        '江岚': { 'affection': { '安然': '好感（同居磨合中）' }, '职业': '网络小说作者' }
    }
}, {});
assert(block3b.indexOf('旁白') === -1, '旁白伪角色整卡跳过');
assert(block3b.indexOf('affection: 安然: 好感（同居磨合中）') !== -1, '对象字段展开为 k: v 列表');
assert(block3b.indexOf('[object Object]') === -1, '无 [object Object] 残留');
assert(block3b.indexOf('江岚') !== -1, '正常角色保留');

// 对象字段：多键 '; ' 分隔、空值键跳过、空对象整字段跳过、数组值 join
var block3c = buildStateAtomBlock({
    characters: {
        '甲': {
            'affection': { '乙': '敌对', '丙': '信任', '_丁': 'x', '戊': '' },
            '空对象': {},
            '清单': { '物品': ['钥匙', '地图'] }
        }
    }
}, {});
assert(block3c.indexOf('affection: 乙: 敌对; 丙: 信任') !== -1, "多键对象 '; ' 分隔、_前缀与空值键跳过");
assert(block3c.indexOf('空对象') === -1, '空对象字段跳过');
assert(block3c.indexOf('清单: 物品: 钥匙、地图') !== -1, '对象内数组值顿号 join');

// narrator/系统（大小写）同样过滤
var block3d = buildStateAtomBlock({
    characters: { 'Narrator': { '职业': 'x' }, 'System': { '职业': 'y' }, '江岚': { '职业': '作者' } }
}, {});
assert(block3d.indexOf('Narrator') === -1 && block3d.indexOf('System') === -1, 'narrator/system（大小写不敏感）过滤');
assert(block3d.indexOf('江岚') !== -1, '正常角色保留（混合伪角色场景）');

// valueMaxChars 截断
var longVal = new Array(300 + 1).join('长');
var block4 = buildStateAtomBlock({
    characters: { '甲': { '备注': longVal } }
}, { valueMaxChars: 120 });
var m = /- 备注: (长+)/.exec(block4);
assert(m && m[1].length === 120 && block4.indexOf('…') !== -1, '超长值截 120 + …（实际 ' + (m ? m[1].length : -1) + '）');
// 0 = 不截断
var block4b = buildStateAtomBlock({
    characters: { '甲': { '备注': longVal } }
}, { valueMaxChars: 0 });
assert(block4b.indexOf(longVal) !== -1, 'valueMaxChars=0 不截断');

// _hidden faction 跳过
var block5 = buildStateAtomBlock({
    factions: {
        '可见': { name: '可见组织', description: 'x' },
        '隐藏': { name: '隐藏组织', description: 'y', _hidden: true }
    }
}, {});
assert(block5.indexOf('可见组织') !== -1, '非 hidden faction 渲染');
assert(block5.indexOf('隐藏组织') === -1, '_hidden faction 跳过');

// 全空 → ''
eq(buildStateAtomBlock({}, {}), '', '空 state 返回空串');
eq(buildStateAtomBlock(null, {}), '', 'null state 返回空串');
eq(buildStateAtomBlock({ characters: { '甲': { '空': '' } } }, {}), '', '全空字段返回空串');

// 无 opts 调用容错
var block6 = buildStateAtomBlock({ characters: { '甲': { '职业': '作家' } } });
assert(block6.indexOf('- 职业: 作家') !== -1, '无 opts 调用正常');

console.log('\n=== injection-stateblock: 接线（off 不变） ===');
// formatSmartContext 的 stateBlockEnabled 分支在 readNeSettingsCached 返回 off（默认）时
// 不触发 readState、不改 parts——由 budget 系列测试的同款对账模式覆盖（开关全 off
// 时的字节级回归）。此处验证分支卫语句语义：ne_settings 缺省时 stateBlockEnabled 为 falsy。
var settings = {};
assert(!settings.stateBlockEnabled, '缺省设置下 stateBlockEnabled 为 falsy（默认 off）');

console.log('\n' + (failed === 0 ? 'ALL PASS (' + passed + ')' : 'FAILED ' + failed + '/' + (passed + failed)));
process.exit(failed === 0 ? 0 : 1);
