import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

var __dirname = path.dirname(fileURLToPath(import.meta.url));

var ratchets = [
    'ratchet-arch-layers.test.js',
    'ratchet-empty-catch.test.js',
    'ratchet-dead-exports.test.js'
];

var totalFailed = 0;
var failures = [];

for (var i = 0; i < ratchets.length; i++) {
    var testFile = path.resolve(__dirname, ratchets[i]);
    var urlPath = 'file:///' + testFile.replace(/\\/g, '/');
    var result = spawnSync('node', ['--input-type=module', '-e', 'import("' + urlPath + '")'], {
        stdio: 'inherit',
        timeout: 30000
    });

    if (result.error) {
        totalFailed++;
        failures.push(ratchets[i] + ' — ERROR: ' + result.error.message);
        continue;
    }

    if (result.status !== 0) {
        totalFailed++;
        failures.push(ratchets[i] + ' — exit code ' + result.status);
    }
}

if (failures.length > 0) {
    console.log('\n=== RATCHET FAILURES:');
    failures.forEach(function(f) { console.log('  ' + f); });
    process.exit(1);
} else {
    console.log('\n=== All ' + ratchets.length + ' ratchets passed ===');
}
