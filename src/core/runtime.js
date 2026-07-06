export var runtime = {
    getChat: function() { return []; },
    getChatMetadata: function() { return {}; },
    saveChat: function() { return Promise.resolve(); },
    getCharacters: function() { return []; },
    getWorldInfo: function() {
        return { entries: [], globalSelect: [] };
    },
    generateQuiet: function(prompt, systemPrompt) { return Promise.resolve(''); },
    generateRaw: function(opts) { return Promise.resolve(''); },
    maxContext: 4096,
    getLanguage: function() { return 'en'; },
    getPowerUserCfg: function() { return {}; },
    on: function(name, fn) {},
    emit: function(name, data) {},
    injectPrompt: function(key, value, position, depth, role) {},
    getParentDoc: function() { return document; },
    notify: function(msg, title, opts) {},
    confirm: function(msg) { return true; }
};
