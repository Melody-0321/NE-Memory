/**
 * ne-system-msg.js — NE-Memory 系统消息发送
 *
 * sendNeInteraction(chatId, text, { buttons, labels, timeoutMs, onConfirm, onDismiss })
 * sendNeNotification(chatId, text, { level, durationMs })
 *
 * 依赖 SillyTavern context API。在测试 / 独立构建环境中自动降级为 console fallback。
 */

var _alertQueue = [];
var _alertIdCounter = 0;
var _shownAlerts = {};  // session-scoped dedup

function _getSTContext() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            return SillyTavern.getContext();
        }
    } catch (e) {}
    return null;
}

/**
 * Send an interactive NE message (requires user response).
 * Falls back to system message if interaction callback support unavailable.
 *
 * @param {string} chatId
 * @param {string} text — plain text or markdown
 * @param {Object} [options]
 * @param {{ text: string, key: string }[]} [options.buttons] — e.g. [{ text: '确认', key: 'confirm' }]
 * @param {string[]} [options.labels]  — shorthand, equivalent to buttons with key=label
 * @param {number} [options.timeoutMs] — auto-dismiss timeout (0 = no timeout)
 * @param {function(string):void} [options.onConfirm] — called with the button key
 * @param {function():void} [options.onDismiss]
 * @returns {Promise<'confirm'|'dismiss'|string>}
 */
export async function sendNeInteraction(chatId, text, options) {
    options = options || {};
    var dedupKey = options._dedupKey || null;
    if (dedupKey && _shownAlerts[dedupKey]) return 'dismiss';

    var ctx = _getSTContext();
    if (!ctx && !chatId) {
        console.log('[NE-SYS] (no ST context) ' + text);
        if (options.onConfirm) options.onConfirm('confirm');
        return 'confirm';
    }

    return new Promise(function(resolve) {
        var alertId = ++_alertIdCounter;
        var timer = null;

        if (options.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(function() {
                _removeAlert(alertId);
                if (options.onDismiss) options.onDismiss();
                resolve('timeout');
            }, options.timeoutMs);
        }

        _alertQueue.push({
            id: alertId,
            text: text,
            buttons: options.buttons || options.labels || [{ text: 'OK', key: 'ok' }],
            timer: timer,
            onConfirm: function(key) {
                if (timer) clearTimeout(timer);
                _removeAlert(alertId);
                if (dedupKey) _shownAlerts[dedupKey] = true;
                if (options.onConfirm) options.onConfirm(key);
                resolve(key);
            },
            onDismiss: function() {
                if (timer) clearTimeout(timer);
                _removeAlert(alertId);
                if (options.onDismiss) options.onDismiss();
                resolve('dismiss');
            }
        });

        _renderAlertQueue();
    });
}

/**
 * Send a compact notification (auto-dismissed, non-interactive).
 *
 * @param {string} chatId
 * @param {string} text
 * @param {Object} [options]
 * @param {'info'|'warn'|'error'} [options.level] — default 'info'
 * @param {number} [options.durationMs]   — default 5000
 */
export function sendNeNotification(chatId, text, options) {
    options = options || {};
    var level = options.level || 'info';
    var prefix = level === 'error' ? '\u26A0\uFE0F ' : (level === 'warn' ? '\u2139\uFE0F ' : '');
    var ctx = _getSTContext();
    if (!ctx) {
        console.log('[NE-NOTIFY' + (level !== 'info' ? ':' + level : '') + '] ' + text);
        return;
    }
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.sendSystemMessage) {
            SillyTavern.sendSystemMessage(null, prefix + text);
        }
    } catch (e) {
        console.log('[NE-NOTIFY] ' + prefix + text);
    }
}

/**
 * Send a blocking system popup (cannot be dismissed by clicking elsewhere).
 * Only for critical blocking warnings (e.g. function calling not supported).
 *
 * @param {string} chatId
 * @param {string} text
 * @param {Object} [options]
 */
export async function sendNePopup(chatId, text, options) {
    options = options || {};
    options._dedupKey = options.dedupKey || null;
    if (!options.buttons) {
        options.buttons = [{ text: (options.dismissLabel || '\u6211\u77E5\u9053\u4E86'), key: 'ok' }];
    }
    return sendNeInteraction(chatId, text, options);
}

function _renderAlertQueue() {
    if (_alertQueue.length === 0) return;
    var alert = _alertQueue[0];
    var ctx = _getSTContext();

    if (!ctx) {
        console.log('[NE-SYS] ' + alert.text);
        alert.onConfirm('ok');
        return;
    }

    try {
        if (ctx.sendSystemMessage) {
            var msg = alert.text;
            if (alert.buttons && alert.buttons.length) {
                msg += '\n\n';
                alert.buttons.forEach(function(b) {
                    msg += '[' + b.text + '] ';
                });
            }
            ctx.sendSystemMessage(null, msg);
        }
    } catch (e) {
        console.log('[NE-SYS] ' + alert.text);
    }

    alert.onDismiss();
}

function _removeAlert(alertId) {
    for (var i = 0; i < _alertQueue.length; i++) {
        if (_alertQueue[i].id === alertId) {
            _alertQueue.splice(i, 1);
            break;
        }
    }
    if (_alertQueue.length > 0) _renderAlertQueue();
}
