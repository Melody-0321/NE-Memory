/**
 * Multi-stage JSON fallback parser.
 * Reference: SP (5-layer sanitize), Anima (balanced bracket scan), ST-BME (5-stage fallback)
 */

import { recordJsonParseResult } from './json-parse-telemetry.js';

function stripThinking(raw) {
    var stripped = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    return stripped;
}

function extractMarkdownCodeBlock(raw) {
    var match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    return match ? match[1].trim() : null;
}

function extractBalancedJson(raw) {
    var openers = ['{', '['];
    var closers = ['}', ']'];
    for (var o = 0; o < openers.length; o++) {
        var start = raw.indexOf(openers[o]);
        if (start === -1) continue;
        var depth = 1;
        var inString = false;
        var escape = false;
        for (var i = start + 1; i < raw.length; i++) {
            var ch = raw[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === openers[o]) { depth++; }
            else if (ch === closers[o]) { depth--; if (depth === 0) { return raw.substring(start, i + 1).trim(); } }
        }
    }
    return null;
}

function fixTrailingCommas(raw) {
    return raw.replace(/,(\s*[}\]])/g, '$1');
}

function fixTruncatedJson(raw) {
    var openBraces = (raw.match(/{/g) || []).length;
    var closeBraces = (raw.match(/}/g) || []).length;
    var openBrackets = (raw.match(/\[/g) || []).length;
    var closeBrackets = (raw.match(/\]/g) || []).length;
    if (openBraces === closeBraces && openBrackets === closeBrackets) return raw;
    var cleaned = raw.replace(/,\s*"[^"]*"\s*:\s*[^\}\]\s,]*$/g, '').replace(/,\s*$/g, '');
    for (var i = 0; i < openBraces - closeBraces; i++) cleaned += '}';
    for (var j = 0; j < openBrackets - closeBrackets; j++) cleaned += ']';
    return cleaned;
}

export function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    raw = stripThinking(raw);

    // Stage 1: Direct parse
    try {
        var direct = JSON.parse(raw.trim());
        recordJsonParseResult('direct');
        return direct;
    } catch (e) {}

    // Stage 2: Markdown code block
    var codeBlock = extractMarkdownCodeBlock(raw);
    if (codeBlock) {
        try {
            var cb = JSON.parse(codeBlock);
            recordJsonParseResult('code_block');
            return cb;
        } catch (e) {}
    }

    // Stage 3: Balanced bracket scan
    var balanced = extractBalancedJson(raw);
    if (balanced) {
        try {
            var bal = JSON.parse(balanced);
            recordJsonParseResult('balanced');
            return bal;
        } catch (e) {}
    }

    // Stage 4: Trailing comma fix
    if (balanced) {
        var commaFixed = fixTrailingCommas(balanced);
        if (commaFixed !== balanced) {
            try {
                var cf = JSON.parse(commaFixed);
                recordJsonParseResult('trailing_comma');
                return cf;
            } catch (e) {}
        }
    }

    // Stage 5: Truncated JSON repair
    if (balanced) {
        var repaired = fixTruncatedJson(balanced);
        try {
            var tr = JSON.parse(repaired);
            recordJsonParseResult('truncated');
            return tr;
        } catch (e) {}
    }

    recordJsonParseResult('failed');
    return null;
}
