import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));

var tests = [
    'text-utils.test.js',
    'state-discovery.test.js',
    'pipeline-guard.test.js',
    'consolidate.test.js'
];

var totalPassed = 0;
var totalFailed = 0;
var failures = [];

for (var i = 0; i < tests.length; i++) {
    var testFile = path.join(__dirname, tests[i]);
    var result = spawnSync('node', ['--input-type=module', '-e', 'import("./' + testFile.replace(/\\/g, '/') + '")'], {
        stdio: 'inherit',
        timeout: 30000
    });

    if (result.error) {
        totalFailed++;
        failures.push(tests[i] + ' — ERROR: ' + result.error.message);
        continue;
    }
}

if (failures.length > 0) {
    console.log('\n=== FAILURES:');
    failures.forEach(function(f) { console.log('  ' + f); });
    process.exit(1);
} else {
    console.log('\n=== All ' + tests.length + ' test files completed ===');
}
