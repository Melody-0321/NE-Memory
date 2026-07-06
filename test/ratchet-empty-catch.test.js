import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var srcDir = path.join(__dirname, '..', 'src');
var projectRoot = path.join(__dirname, '..');

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('\n=== ratchet-empty-catch: Empty catch blocks must not grow ===');

// Baseline: allowable count of catch blocks with zero meaningful body
// Updated after fix #2 (immediate-fixes)
var CATCH_BASELINE = 3;

function isNonEmptyCatchBody(lines, startIdx) {
    for (var j = startIdx; j < Math.min(lines.length, startIdx + 15); j++) {
        var line = lines[j].trim();
        if (line === '}' || line === '});') break;
        if (line.length === 0) continue;
        if (line.startsWith('//')) continue;
        return true;
    }
    return false;
}

function collectFiles(dir, list) {
    list = list || [];
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(function(e) {
        var full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist') {
            collectFiles(full, list);
        } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
            list.push(full);
        }
    });
    return list;
}

var allFiles = collectFiles(srcDir);
var emptyCatches = [];

allFiles.forEach(function(file) {
    if (file.indexOf('test-') !== -1 && file.indexOf('test-runner') === -1) return;
    var content = fs.readFileSync(file, 'utf-8');
    var lines = content.split('\n');

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.match(/catch\s*\(/) || !line.includes('{')) continue;

        var braceIdx = line.lastIndexOf('{');
        var afterBrace = line.substring(braceIdx + 1).trim();
        var hasBodyOnSameLine = afterBrace.length > 0 && !afterBrace.startsWith('//');

        if (hasBodyOnSameLine) continue;

        if (!isNonEmptyCatchBody(lines, i + 1)) {
            emptyCatches.push(path.relative(projectRoot, file) + ':' + (i + 1));
        }
    }
});

var count = emptyCatches.length;
if (count <= CATCH_BASELINE) {
    console.log('  OK: ' + count + ' empty catch blocks <= baseline ' + CATCH_BASELINE);
    passed++;
} else {
    console.error('  RATCHET: ' + count + ' empty catch blocks exceeds baseline ' + CATCH_BASELINE);
    emptyCatches.forEach(function(c) { console.error('    ' + c); });
    failed++;
}

console.log('\n--- ratchet-empty-catch: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
