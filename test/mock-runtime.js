import { runtime } from '../src/core/runtime.js';

var _mockChats = {};
var _mockCharacters = [];
var _mockWorldInfo = { entries: {}, globalSelect: [] };

export function mockRuntime(overrides) {
    var mock = {
        getChat: function() {
            var chatId = runtime.getChatId ? runtime.getChatId() : 'test-chat-001';
            return _mockChats[chatId] || [];
        },
        getChatMetadata: function() { return {}; },
        saveChat: function() { return Promise.resolve(); },
        getCharacters: function() { return _mockCharacters; },
        getWorldInfo: function() { return _mockWorldInfo; },
        generateQuiet: function() { return Promise.resolve('mock response'); },
        generateRaw: function() { return Promise.resolve('mock raw'); },
        maxContext: 4096,
        getLanguage: function() { return 'zh'; },
        getPowerUserCfg: function() { return {}; },
        on: function() {},
        emit: function() {},
        injectPrompt: function() {},
        getLorebookEntries: function() { return Promise.resolve([]); },
        setLorebookEntries: function() { return Promise.resolve(); },
        createLorebookEntries: function() { return Promise.resolve(); },
        deleteLorebookEntries: function() { return Promise.resolve(); },
        getLorebooks: function() { return Promise.resolve([]); },
        getParentDoc: function() { return undefined; },
        notify: function() {},
        confirm: function() { return true; }
    };

    if (overrides) Object.assign(mock, overrides);

    Object.assign(runtime, mock);
}

export function setMockChat(chatId, messages) {
    _mockChats[chatId] = messages;
    mockRuntime({ getChatId: function() { return chatId; } });
}

export function setMockCharacters(chars) {
    _mockCharacters = chars;
}

export function setMockWorldInfo(wi) {
    _mockWorldInfo = wi;
}

export function resetMocks() {
    _mockChats = {};
    _mockCharacters = [];
    _mockWorldInfo = { entries: {}, globalSelect: [] };
}

export function assert(condition, msg) {
    if (!condition) throw new Error('ASSERT FAIL: ' + msg);
}
