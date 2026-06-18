var _pipelinePhase = 'idle'; // idle | state | stm | ltm
var _isInjecting = false;
var _stateSince = 0;

var PIPELINE_PHASES = ['state', 'stm', 'ltm'];

export function tryAcquire(targetState) {
    if (targetState === 'injecting') {
        if (_isInjecting) return false;
        _isInjecting = true;
        _stateSince = Date.now();
        console.log('[NE-GUARD] acquire injecting (state=' + getState() + ')');
        return true;
    }
    if (_pipelinePhase !== 'idle') return false;
    if (PIPELINE_PHASES.indexOf(targetState) === -1) return false;
    _pipelinePhase = targetState;
    _stateSince = Date.now();
    console.log('[NE-GUARD] acquire ' + targetState + ' (idle → ' + targetState + ')');
    return true;
}

export function transitionTo(newState) {
    if (PIPELINE_PHASES.indexOf(newState) === -1) return;
    var old = _pipelinePhase;
    _pipelinePhase = newState;
    _stateSince = Date.now();
    console.log('[NE-GUARD] transition ' + old + ' → ' + newState);
}

export function releasePipeline() {
    _pipelinePhase = 'idle';
    if (!_isInjecting) _stateSince = 0;
    console.log('[NE-GUARD] release pipeline' + (_isInjecting ? ' (injecting still running)' : ' → idle'));
}

export function releaseInjection() {
    _isInjecting = false;
    if (_pipelinePhase === 'idle') _stateSince = 0;
    console.log('[NE-GUARD] release injecting' + (_pipelinePhase !== 'idle' ? ' (pipeline still ' + _pipelinePhase + ')' : ' → idle'));
}

export function isIdle() {
    return _pipelinePhase === 'idle' && !_isInjecting;
}

export function getPipelinePhase() {
    return _pipelinePhase;
}

export function getState() {
    if (_pipelinePhase === 'idle' && !_isInjecting) return 'idle';
    if (_pipelinePhase === 'idle' && _isInjecting) return 'injecting';
    if (_pipelinePhase !== 'idle' && !_isInjecting) return _pipelinePhase;
    return _pipelinePhase + '+injecting';
}

export function reset() {
    _pipelinePhase = 'idle';
    _isInjecting = false;
    _stateSince = 0;
    console.log('[NE-GUARD] reset → idle');
}
