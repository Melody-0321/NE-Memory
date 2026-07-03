// stateBus.js -- lightweight pub/sub for decoupled UI updates
var _listeners = {};

export function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
}

export function off(event, fn) {
    var list = _listeners[event];
    if (!list) return;
    if (fn) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i] === fn) list.splice(i, 1);
        }
    } else {
        _listeners[event] = [];
    }
}

export function emit(event, payload) {
    var list = _listeners[event];
    if (!list || list.length === 0) return;
    for (var i = 0; i < list.length; i++) {
        try { list[i](payload); } catch (e) {
            console.warn('[NE-stateBus] handler error for "' + event + '":', e);
        }
    }
}
