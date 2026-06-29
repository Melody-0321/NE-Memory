// Precise extraction script for update.js split
// Uses exact line ranges from update.js.bak with function-level import analysis
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'core', 'engine');
const bakPath = path.join(srcDir, 'update.js.bak');
const lines = fs.readFileSync(bakPath, 'utf8').split('\n');

function getCode(startLine, endLine) {
    return lines.slice(startLine - 1, endLine).join('\n');
}

function writeFile(filename, imports, codeBlocks) {
    const content = imports.join('\n') + '\n\n' + codeBlocks.join('\n\n') + '\n';
    const filepath = path.join(srcDir, filename);
    fs.writeFileSync(filepath, content);
    console.log('Created ' + filename + ' (' + content.split('\n').length + ' lines)');
}

// ===== Step 1: pipeline-shared.js =====
console.log('\n=== Step 1: pipeline-shared.js ===');
const sharedImports = [
    "import { writeWithSnapshot } from '../vault/store.js';",
    "import { pruneSnapshotsForChat } from '../vault/versions.js';",
    "import { persistVaultToChatFile } from '../auto-restore.js';",
    "import { isStateSchemaEnabled, DEFAULT_GLOBAL_SCHEMA } from '../vault/schema.js';",
    "import { safeJsonParse } from './json-fallback.js';",
];

const sharedBlocks = [
    // saveVaultWithSnapshot L22-L40
    getCode(22, 40),
    // ensureStateStructure L62-L96
    getCode(62, 96),
    // initStateFromSchema L101-L136 (skip JSDoc closing */ at L100)
    getCode(101, 136),
    // filterNewMessages L138-L144
    getCode(138, 144),
    // flattenNestedChanges L259-L281
    getCode(259, 281),
    // parseSTMResponse L283-L335
    getCode(283, 335),
    // handleQuestCompletion L337-L354
    getCode(337, 354),
];
writeFile('pipeline-shared.js', sharedImports, sharedBlocks);

// ===== Step 2: stm-pipeline.js =====
console.log('\n=== Step 2: stm-pipeline.js ===');
const stmImports = [
    "import { read, appendSTMEntries, collectAllMsgIds } from '../vault/store.js';",
    "import { isStateSchemaEnabled } from '../vault/schema.js';",
    "import { safeJsonParse } from './json-fallback.js';",
    "import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';",
    "import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';",
    "import { isLtmEnabled, findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';",
    "import { saveVaultWithSnapshot, filterNewMessages } from './pipeline-shared.js';",
    "import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';",
    "import { validateSTMOutput, postFillSTM } from './validate.js';",
    "import { transitionTo } from './pipeline-guard.js';",
    "import { vocabularyOverlap } from './text-utils.js';",
];

const stmBlocks = [
    // buildSTMUpdatePrompt L146-L257
    getCode(146, 257),
    // buildCursorPrompt L358-L461
    getCode(358, 461),
    // buildRetrospectiveContext L465-L484
    getCode(465, 484),
    // buildBatchPrompt L486-L562
    getCode(486, 562),
    // buildStmOnlyPrompt L564-L593
    getCode(564, 593),
    // computeTurnBoundarySignals L595-L631
    getCode(595, 631),
    // L1_CUT/L2_CUT/L2_KEEP/L3_ASK constants + classifyBoundary L633-L645
    getCode(633, 645),
    // askBoundaryJudge L647-L683
    getCode(647, 683),
    // segmentTurns L685-L712
    getCode(685, 712),
    // buildStmSummaryPrompt L714-L741
    getCode(714, 741),
    // executeIncrementalUpdate L1161-L1287
    getCode(1161, 1287),
];
writeFile('stm-pipeline.js', stmImports, stmBlocks);

// ===== Step 3: ltm-pipeline.js =====
console.log('\n=== Step 3: ltm-pipeline.js ===');
const ltmImports = [
    "import { findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';",
    "import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';",
    "import { safeJsonParse } from './json-fallback.js';",
    "import { validateLTMOutput } from './validate.js';",
];

const ltmBlocks = [
    // EVENT_CLOSING_PUNCT L42
    getCode(42, 42),
    // _validateLtmEventText L44-L54
    getCode(44, 54),
    // buildLtmDecisionPrompt L743-L811
    getCode(743, 811),
    // runLtmDecision L813-L852
    getCode(813, 852),
];
writeFile('ltm-pipeline.js', ltmImports, ltmBlocks);

// ===== Step 4: state-pipeline.js =====
console.log('\n=== Step 4: state-pipeline.js ===');
const stateImports = [
    "import { read } from '../vault/store.js';",
    "import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled, ensureCharacterTemplate, rebuildPresentCharacters, buildStateInjectionTable, DEFAULT_NPC_SCHEME } from '../vault/schema.js';",
    "import { saveVaultWithSnapshot, ensureStateStructure, parseSTMResponse, handleQuestCompletion } from './pipeline-shared.js';",
    "import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';",
    "import { safeJsonParse } from './json-fallback.js';",
    "import { runtime } from '../runtime.js';",
];

const stateBlocks = [
    // buildCharacterCardSection L856-L879
    getCode(856, 879),
    // findNewCharacterNames L881-L906
    getCode(881, 906),
    // _matchEntryKeyToName L908-L921
    getCode(908, 921),
    // _fetchWorldBookText L923-L955
    getCode(923, 955),
    // buildWorldBookSection L957-L968
    getCode(957, 968),
    // buildFactionKeywords L970-L981
    getCode(970, 981),
    // scanMessageForFactions L983-L1002
    getCode(983, 1002),
    // buildStatePrompt_Preset L1004-L1122
    getCode(1004, 1122),
    // autoDecayStaleCharacters L1128-L1159
    getCode(1128, 1159),
    // collectWorldBookContent L1291-L1354
    getCode(1291, 1354),
    // collectWorldBookContent_raw L1356-L1375
    getCode(1356, 1375),
    // buildWorldBookSystemBlock L1377-L1383
    getCode(1377, 1383),
    // buildSchemeCharPrompt L1385-L1419
    getCode(1385, 1419),
    // buildFactionExtractionPrompt L1421-L1440
    getCode(1421, 1440),
    // resolveNpcSchemes L1442-L1609
    getCode(1442, 1609),
    // extractStateChangesOnly L1613-L1751
    getCode(1613, 1751),
];
writeFile('state-pipeline.js', stateImports, stateBlocks);

console.log('\nDone!');
