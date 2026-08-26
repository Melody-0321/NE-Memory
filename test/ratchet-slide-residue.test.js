// ratchet-slide-residue: slide-in 链路删除后，断言 adapter 与 panel.css 无残留
// P1 导航重构已用页栈替换 slide-in；任何 ne-slide / openSlidePanel /
// registerSlideRenderer / closeSlidePanel 出现即视为回潮，直接 FAIL。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var adapterDir = path.join(__dirname, '..', 'src', 'adapter');
var panelCss = path.join(__dirname, '..', 'src', 'ui', 'panel.css');

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('\n=== ratchet-slide-residue: No slide-in residue ===');

var forbidden = ['ne-slide', 'openSlidePanel', 'registerSlideRenderer', 'closeSlidePanel'];

// 1. adapter/*.js 扫描
var adapterFiles = fs.readdirSync(adapterDir).filter(function (f) { return f.endsWith('.js'); });
assert(adapterFiles.length > 0, 'adapter 目录存在 .js 文件可扫描');
adapterFiles.forEach(function (f) {
    var content = fs.readFileSync(path.join(adapterDir, f), 'utf-8');
    forbidden.forEach(function (token) {
        if (content.indexOf(token) !== -1) {
            failed++;
            console.error('  FAIL: ' + f + ' 含禁用字符串 ' + token);
        }
    });
});

// 2. panel.css 扫描
var css = fs.readFileSync(panelCss, 'utf-8');
forbidden.forEach(function (token) {
    if (css.indexOf(token) !== -1) {
        failed++;
        console.error('  FAIL: panel.css 含禁用字符串 ' + token);
    }
});

console.log('\n--- ratchet-slide-residue: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
