import { addAnomaly } from './telemetry.js';

var _stateQueue = Promise.resolve();
var _stmQueue = Promise.resolve();
var _ltmQueue = Promise.resolve();

var _status = { state: 'idle', stm: 'idle', ltm: 'idle' };
var _onChangeCallbacks = [];

function _setStatus(pipeline, value) {
    if (_status[pipeline] === value) return;
    _status[pipeline] = value;
    _notifyChange();
}

function _notifyChange() {
    var status = { state: _status.state, stm: _status.stm, ltm: _status.ltm };
    var callbacks = _onChangeCallbacks.slice();
    for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](status); } catch (e) {}
    }
}

/**
 * @param {function({state:string, stm:string, ltm:string}):void} fn
 * @returns {void}
 */
export function onPipelineChange(fn) {
    if (_onChangeCallbacks.indexOf(fn) === -1) _onChangeCallbacks.push(fn);
}

/**
 * @param {function({state:string, stm:string, ltm:string}):void} fn
 * @returns {void}
 */
export function offPipelineChange(fn) {
    var idx = _onChangeCallbacks.indexOf(fn);
    if (idx !== -1) _onChangeCallbacks.splice(idx, 1);
}

/**
 * @param {function(): Promise<void>} taskFn
 * @returns {Promise<void>}
 */
export function enqueueStateWrite(taskFn) {
    _stateQueue = _stateQueue
        .then(async function() {
            _setStatus('state', 'active');
            try { await taskFn(); } finally { _setStatus('state', 'idle'); }
        })
        .catch(function(e) {
            // P0-3: 任务失败记录后吞掉——不 rethrow 毒化队列，后续任务照常执行；
            // 链尾 catch 保证返回 Promise 永远 resolved，调用方 await 不会收到未处理 rejection
            console.error('[NE] pipeline task (state) failed:', e);
            try { addAnomaly('pipeline_task_failed', { pipeline: 'state', error: String((e && e.message) || e) }); } catch (err) {}
        });
    return _stateQueue;
}

/**
 * @param {function(): Promise<void>} taskFn
 * @returns {Promise<void>}
 */
export function enqueueStmWrite(taskFn) {
    _stmQueue = _stmQueue
        .then(async function() {
            _setStatus('stm', 'active');
            try { await taskFn(); } finally { _setStatus('stm', 'idle'); }
        })
        .catch(function(e) {
            // P0-3: 任务失败记录后吞掉——不 rethrow 毒化队列，后续任务照常执行；
            // 链尾 catch 保证返回 Promise 永远 resolved，调用方 await 不会收到未处理 rejection
            console.error('[NE] pipeline task (stm) failed:', e);
            try { addAnomaly('pipeline_task_failed', { pipeline: 'stm', error: String((e && e.message) || e) }); } catch (err) {}
        });
    return _stmQueue;
}

/**
 * @param {function(): Promise<void>} taskFn
 * @returns {Promise<void>}
 */
export function enqueueLtmWrite(taskFn) {
    _ltmQueue = _ltmQueue
        .then(async function() {
            _setStatus('ltm', 'active');
            try { await taskFn(); } finally { _setStatus('ltm', 'idle'); }
        })
        .catch(function(e) {
            // P0-3: 任务失败记录后吞掉——不 rethrow 毒化队列，后续任务照常执行；
            // 链尾 catch 保证返回 Promise 永远 resolved，调用方 await 不会收到未处理 rejection
            console.error('[NE] pipeline task (ltm) failed:', e);
            try { addAnomaly('pipeline_task_failed', { pipeline: 'ltm', error: String((e && e.message) || e) }); } catch (err) {}
        });
    return _ltmQueue;
}

/**
 * @returns {{state:string, stm:string, ltm:string}}
 */
export function getState() {
    return { state: _status.state, stm: _status.stm, ltm: _status.ltm };
}

/**
 * @returns {void}
 */
export function reset() {
    _stateQueue = Promise.resolve();
    _stmQueue = Promise.resolve();
    _ltmQueue = Promise.resolve();
    _status = { state: 'idle', stm: 'idle', ltm: 'idle' };
    _notifyChange();
}

// ── Deprecated (kept for backward compatibility) ──

var _deprecatedWarned = {};

function _warnDeprecated(name) {
    if (!_deprecatedWarned[name]) {
        _deprecatedWarned[name] = true;
        console.warn('[NE-GUARD] ' + name + ' is deprecated. Use enqueueStateWrite / enqueueStmWrite / enqueueLtmWrite instead.');
    }
}

/**
 * @deprecated Use enqueueStateWrite / enqueueStmWrite / enqueueLtmWrite instead.
 * @returns {boolean} Always returns true (no-op).
 */
export function tryAcquire() {
    _warnDeprecated('tryAcquire');
    return true;
}

/**
 * @deprecated Queue model handles serialization internally.
 * @returns {void}
 */
export function releasePipeline() {
    _warnDeprecated('releasePipeline');
}

/**
 * @deprecated Queue model handles waiting internally.
 * @param {number} [timeoutMs]
 * @returns {Promise<void>} Always resolves immediately.
 */
export function waitForPipelineTrackIdle(timeoutMs) {
    _warnDeprecated('waitForPipelineTrackIdle');
    return Promise.resolve();
}

/**
 * @deprecated Use getState() instead.
 * @returns {boolean} true if no pipeline is active.
 */
export function isIdle() {
    _warnDeprecated('isIdle');
    return _status.state === 'idle' && _status.stm === 'idle' && _status.ltm === 'idle';
}

/**
 * @deprecated Use getState() instead.
 * @returns {string}
 */
export function getPipelinePhase() {
    _warnDeprecated('getPipelinePhase');
    var active = [];
    if (_status.state === 'active') active.push('state');
    if (_status.stm === 'active') active.push('stm');
    if (_status.ltm === 'active') active.push('ltm');
    return active.length > 0 ? active.join(',') : 'idle';
}

/**
 * @deprecated Queue model transitions are handled internally.
 * @returns {void}
 */
export function transitionTo() {
    _warnDeprecated('transitionTo');
}
