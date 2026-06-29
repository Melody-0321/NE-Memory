import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var srcDir = path.join(__dirname, '..', 'src');

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('\n=== ratchet-arch-layers: core/ must not import adapter/ ===');

function collectFiles(dir, list) {
    list = list || [];
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(function(e) {
        var full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules') {
            collectFiles(full, list);
        } else if (e.name.endsWith('.js')) {
            list.push(full);
        }
    });
    return list;
}

var coreFiles = collectFiles(path.join(srcDir, 'core'));
var violations = [];

coreFiles.forEach(function(file) {
    var content = fs.readFileSync(file, 'utf-8');
    var lines = content.split('\n');
    lines.forEach(function(line, idx) {
        var match = line.match(/from\s+['"]\.\.?\/.*(adapter|panel|index\.js)['"]/);
        if (match) {
            var importPath = match[0];
            if (importPath.indexOf('test-runner') !== -1) return;
            if (importPath.indexOf('generate-test-data') !== -1) return;
            violations.push(path.relative(srcDir, file) + ':' + (idx + 1) + ' — ' + line.trim());
        }
    });
});

// Also check for direct adapter references via '..'
coreFiles.forEach(function(file) {
    var content = fs.readFileSync(file, 'utf-8');
    var lines = content.split('\n');
    lines.forEach(function(line, idx) {
        var match = line.match(/from\s+['"]\.\.\/adapter/);
        if (match) {
            violations.push(path.relative(srcDir, file) + ':' + (idx + 1) + ' — ' + line.trim());
        }
    });
});

// SPECIAL: Allow core/runtime.js to reference adapter paths in its createRuntime signature
// Allow test-runner modules that are in core/ but reference adapter for test hooks

if (violations.length === 0) {
    console.log('  OK: No core→adapter import violations');
    passed++;
} else {
    violations.forEach(function(v) { console.error('  VIOLATION: ' + v); });
    failed++;
}

console.log('\n--- ratchet-arch-layers: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
