import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));

var testMap = {
    'text-utils': 'text-utils.test.js',
    'pipeline-guard': 'pipeline-guard.test.js',
    'consolidate': 'consolidate.test.js',
    'context-window': 'context-window.test.js',
    'dialog-window': 'dialog-window.test.js',
    'concurrency-guard': 'concurrency-guard.test.js',
    'ltm-rebatch-call': 'ltm-rebatch-call-pattern.test.js',
    'bm25-scoring': 'bm25-scoring.test.js',
    'time-filter': 'time-filter.test.js',
    'turn-segmenter': 'turn-segmenter.test.js',
    'content-clean': 'content-clean.test.js',
    'suspense-pipeline': 'suspense-pipeline.test.js',
    'stm-validate': 'stm-validate.test.js',
    'stm-chunking': 'stm-chunking.test.js',
    'entity-chain': 'entity-chain.test.js',
    'ltm-validate': 'ltm-validate.test.js',
    'consolidate-core': 'consolidate-core.test.js',
    'consolidate-apply': 'consolidate-apply.test.js',
    'entity-grouping': 'entity-grouping.test.js',
    'entity-seed': 'entity-seed.test.js',
    'ltm-rebatch': 'ltm-rebatch.test.js',
    'smartpush-query': 'smartpush-query.test.js',
    'schema': 'schema.test.js',
    'schema-new': 'schema-new.test.js',
    'template-llm': 'template-llm.test.js',
    'store': 'store.test.js',
    'store-field-ref': 'store-field-ref.test.js',
    'schema-prune': 'schema-prune.test.js',
    'template-assistant': 'template-assistant.test.js',
    'ne-system-msg': 'ne-system-msg.test.js',
    'json-fallback': 'json-fallback.test.js',
    'bm25-grouper': 'bm25-grouper.test.js',
    'msg-id': 'msg-id.test.js',
    'adaptive-context': 'adaptive-context.test.js',
    'banner-regex': 'banner-regex.test.js',
    'state-versions-compact': 'state-versions-compact.test.js',
    'state-versions-rollback': 'state-versions-rollback.test.js',
    'embedding': 'embedding.test.js',
    'settings-cache': 'settings-cache.test.js',
    'chat-telemetry': 'chat-telemetry.test.js',
    'token-stats': 'token-stats.test.js',
    'retrieval-cache': 'retrieval-cache.test.js',
    'vault-authority': 'vault-authority.test.js',
    'settings-adapter': 'settings-adapter.test.js',
    'template-assistant-retry': 'template-assistant-retry.test.js',
    'stm-resolver': 'stm-resolver.test.js',
    'injection-query': 'injection-query.test.js',
    'stm-period': 'stm-period.test.js',
    'injection-budget': 'injection-budget.test.js',
    'injection-stateblock': 'injection-stateblock.test.js',
    'injection-arcblock': 'injection-arcblock.test.js',
    'consolidate-accumulate': 'consolidate-accumulate.test.js',
    'ui-tokens': 'ui-tokens.test.js',
    'nav-registry': 'nav-registry.test.js',
    'gesture-math': 'gesture-math.test.js'
};

var batchMap = {
    'p0': ['text-utils', 'pipeline-guard', 'consolidate', 'context-window', 'concurrency-guard', 'ltm-rebatch-call']
};

var args = process.argv.slice(2);
var batchArg = null;
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
        batchArg = args[i + 1];
        break;
    }
}

var testKeys;
if (batchArg && batchMap[batchArg]) {
    testKeys = batchMap[batchArg];
} else {
    testKeys = Object.keys(testMap);
}

var totalFailed = 0;
var failures = [];

for (var i = 0; i < testKeys.length; i++) {
    var testFile = path.resolve(__dirname, testMap[testKeys[i]]);
    var urlPath = 'file:///' + testFile.replace(/\\/g, '/');
    var result = spawnSync('node', ['--input-type=module', '-e', 'import("' + urlPath + '")'], {
        stdio: 'inherit',
        timeout: 30000
    });

    if (result.error) {
        totalFailed++;
        failures.push(testKeys[i] + ' — ERROR: ' + result.error.message);
        continue;
    }

    if (result.status !== 0) {
        totalFailed++;
        failures.push(testKeys[i] + ' — exit code ' + result.status);
    }
}

if (failures.length > 0) {
    console.log('\n=== FAILURES:');
    failures.forEach(function(f) { console.log('  ' + f); });
    process.exit(1);
} else {
    console.log('\n=== All ' + testKeys.length + ' test files passed ===');
}
