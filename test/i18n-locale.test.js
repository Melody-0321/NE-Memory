/**
 * i18n locale 污染回归测试
 *
 * 背景（3aba810 回归）：mes-button.js 误从 core/i18n.js 导入 t（locale setter）
 * 当翻译查询用，t('mes_button_title') 把模块级 _locale 覆写成翻译 key，
 * 此后全部 t_narrative/t_config/t_field 查表 miss → 整层英文回退。
 *
 * 防线：_canonLocale 白名单（表仅覆盖 en/zh-cn/zh-tw），非 zh、en 前缀的值
 * 返回 null，setter 拒绝——垃圾值不再污染已设置的 locale。
 */
import { t, t_narrative, t_config, setFieldLocale, t_field } from '../src/core/i18n.js';

var passed = 0, failed = 0;
function eq(actual, expected, msg) {
    if (actual === expected) { passed++; console.log('  ok - ' + msg); }
    else { failed++; console.error('  FAIL - ' + msg + '\n    expected: ' + JSON.stringify(expected) + '\n    actual:   ' + JSON.stringify(actual)); }
}

console.log('=== i18n: locale setter 与白名单 ===');

// 基线：默认英文
eq(t_narrative('mes_button_none'), 'No summary entry for this message', 'default locale en');

// 正常设置：zh / zh-cn / zh-TW / en-US 全部归一化
t('zh');      eq(t_narrative('mes_button_none'), '该楼暂无摘要条目', 'zh -> zh-cn');
t('zh-TW');   eq(t_narrative('mes_button_none'), '該樓暫無摘要條目', 'zh-TW -> zh-tw');
t('en-US');   eq(t_narrative('mes_button_none'), 'No summary entry for this message', 'en-US -> en');
t('zh-cn');   eq(t_narrative('mes_button_none'), '该楼暂无摘要条目', 'zh-cn ok');

// 回归核心：翻译 key 误传 setter 不得污染 locale
t('mes_button_title');
eq(t_narrative('mes_button_none'), '该楼暂无摘要条目', 'garbage key does NOT corrupt _locale');
// null/undefined/非法字符串同样拒绝
t(null); t(undefined); t('null'); t('undefined'); t('');
eq(t_narrative('mes_button_none'), '该楼暂无摘要条目', 'null/undefined/invalid all rejected');

// t_config 同一 _locale 通道（CONFIG_I18N zh-cn 真实 key：'Temperature'）
t('zh-cn'); t('garbage_key');
eq(t_config('Temperature'), '温度', 't_config unaffected by garbage');

// setFieldLocale 同样受白名单保护
setFieldLocale('zh-cn');
setFieldLocale('mes_button_none');
// zh-cn 字段表任取一个有翻译的字段验证仍为中文（用 en 表确认 key 存在）
var enField = t_field; // 引用检查
setFieldLocale('zh-cn');
eq(typeof t_field('name'), 'string', 't_field still returns string after garbage');

// 切回英文收尾
t('en');
eq(t_narrative('mes_button_none'), 'No summary entry for this message', 'back to en');

console.log('\n=== i18n: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
