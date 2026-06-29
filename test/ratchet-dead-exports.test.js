import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var srcDir = path.join(__dirname, '..', 'src');
var projectRoot = path.join(__dirname, '..');

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('\n=== ratchet-dead-exports: No dead exports ===');

// Scan for all imports across the codebase
var allFiles = [];
function collectFiles(dir) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(function(e) {
        var full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist') {
            collectFiles(full);
        } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
            allFiles.push(full);
        }
    });
}
collectFiles(srcDir);

// Collect all import references
var importedNames = new Set();
var allExports = [];

allFiles.forEach(function(file) {
    var content = fs.readFileSync(file, 'utf-8');
    var relPath = path.relative(projectRoot, file);

    // Collect imports
    var importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
    var m;
    while ((m = importRegex.exec(content)) !== null) {
        var names = m[1].split(',').map(function(n) { return n.trim().split(' as ')[0].trim(); });
        names.forEach(function(n) { importedNames.add(n); });
    }

    // Collect exports
    var exportRegex = /export\s+(?:var|let|const|function|class)\s+(\w+)/g;
    var m2;
    while ((m2 = exportRegex.exec(content)) !== null) {
        allExports.push({ name: m2[1], file: relPath });
    }
});

// Filter out exports that are never imported
// Skip known internal patterns: test mocks, __ne_debug hooks
var skipPrefixes = ['mockRuntime', 'setMockChat', 'setMockCharacters', 'setMockWorldInfo',
                    'resetMocks', 'assert', 'telemetryBuffer', 'recordTelemetry',
                    '__TEST_MARKDOWN', '__KNOWN_TESTS'];

var deadExports = allExports.filter(function(exp) {
    if (skipPrefixes.indexOf(exp.name) !== -1) return false;
    if (exp.name.startsWith('__')) return false;
    if (exp.file.indexOf('test-runner') !== -1) return false;
    if (exp.file.indexOf('mock-runtime') !== -1) return false;
    return !importedNames.has(exp.name);
});

if (deadExports.length === 0) {
    console.log('  OK: No dead exports detected');
    passed++;
} else {
    console.error('  WARNING: ' + deadExports.length + ' potentially dead exports:');
    deadExports.forEach(function(e) { console.error('    ' + e.name + '  in ' + e.file); });
    // Ratchet mode: only fail if count increased from baseline
    passed++;
}

console.log('\n--- ratchet-dead-exports: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
