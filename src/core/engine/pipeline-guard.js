import { addAnomaly } from './telemetry.js';

var _pipelinePhase = 'idle'; // idle | state | stm | ltm
var _pipelineWaiters = [];
var _stateSince = 0;

var PIPELINE_PHASES = ['state', 'stm', 'ltm'];

/**
 * @param {string} targetState
 * @returns {boolean}
 */
export function tryAcquire(targetState) {
    if (_pipelinePhase !== 'idle') return false;
    if (PIPELINE_PHASES.indexOf(targetState) === -1) return false;
    _pipelinePhase = targetState;
    _stateSince = Date.now();
    console.log('[NE-GUARD] acquire ' + targetState + ' (idle → ' + targetState + ')');
    return true;
}

/**
 * @param {string} newState
 * @returns {void}
 */
export function transitionTo(newState) {
    if (PIPELINE_PHASES.indexOf(newState) === -1) return;
    var old = _pipelinePhase;
    _pipelinePhase = newState;
    _stateSince = Date.now();
    console.log('[NE-GUARD] transition ' + old + ' → ' + newState);
}

/**
 * @returns {void}
 */
export function releasePipeline() {
    _pipelinePhase = 'idle';
    _stateSince = 0;
    console.log('[NE-GUARD] release pipeline → idle');
    var waiters = _pipelineWaiters.splice(0);
    for (var i = 0; i < waiters.length; i++) {
        try { waiters[i].resolve(); } catch (e) {}
    }
}

/**
 * @returns {boolean}
 */
export function isIdle() {
    return _pipelinePhase === 'idle';
}

/**
 * @returns {string|null}
 */
export function getPipelinePhase() {
    return _pipelinePhase;
}

/**
 * @returns {string}
 */
export function getState() {
    return _pipelinePhase;
}

/**
 * @returns {void}
 */
export function reset() {
    _pipelinePhase = 'idle';
    _stateSince = 0;
    var waiters = _pipelineWaiters.splice(0);
    _pipelineWaiters = [];
    for (var i = 0; i < waiters.length; i++) {
        try { waiters[i].resolve(); } catch (e) {}
    }
    console.log('[NE-GUARD] reset → idle');
}

/**
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export function waitForPipelineTrackIdle(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    return new Promise(function(resolve) {
        if (_pipelinePhase === 'idle') { resolve(); return; }
        var resolved = false;
        var timer = setTimeout(function() {
            if (!resolved) {
                resolved = true;
                var idx = _pipelineWaiters.indexOf(entry);
                if (idx !== -1) _pipelineWaiters.splice(idx, 1);
                var stuckMs = Date.now() - _stateSince;
                console.warn('[NE-GUARD] pipeline wait timeout after ' + timeoutMs + 'ms, phase=' + _pipelinePhase + ', stuck for ' + stuckMs + 'ms');
                addAnomaly('pipeline_timeout', { phase: _pipelinePhase, timeoutMs: timeoutMs, stuckMs: stuckMs });
                resolve();
            }
        }, timeoutMs);
        var entry = { resolve: function() {
            if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve();
            }
        }};
        _pipelineWaiters.push(entry);
    });
}
