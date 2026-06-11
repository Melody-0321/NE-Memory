import { formatWorldBookGlobal, formatWorldBookCharacterCard, formatWorldBookFactionCard, formatWorldBookQuestCard } from '../vault/schema.js';

var WORLD_BOOK_NAME = 'NE_Memory_State';

var ENTRY_PREFIX_GLOBAL = 'NE_State_Global';
var ENTRY_PREFIX_CHAR = 'NE_Char_';
var ENTRY_PREFIX_FACTION = 'NE_Faction_';
var ENTRY_PREFIX_QUEST = 'NE_Quest_';

function getTH() {
    if (typeof TavernHelper !== 'undefined' && TavernHelper.getLorebookEntries) return TavernHelper;
    return null;
}

function getLorebookEntries(bookName) {
    var th = getTH();
    if (th) return th.getLorebookEntries(bookName);
    return Promise.resolve([]);
}

function setLorebookEntries(bookName, entries) {
    var th = getTH();
    if (th) return th.setLorebookEntries(bookName, entries);
    return Promise.resolve();
}

function createLorebookEntries(bookName, entries) {
    var th = getTH();
    if (th) return th.createLorebookEntries(bookName, entries);
    return Promise.resolve();
}

function deleteLorebookEntries(bookName, uids) {
    var th = getTH();
    if (th) return th.deleteLorebookEntries(bookName, uids);
    return Promise.resolve();
}

function getLorebooks() {
    var th = getTH();
    if (th && th.getLorebooks) return th.getLorebooks();
    return Promise.resolve([]);
}

function findEntryByComment(entries, comment) {
    if (!entries || !Array.isArray(entries)) return null;
    for (var i = 0; i < entries.length; i++) {
        if (entries[i] && entries[i].comment === comment) return entries[i];
    }
    return null;
}

async function upsertEntry(bookName, existingEntries, comment, content, opts) {
    opts = opts || {};
    var existing = findEntryByComment(existingEntries, comment);

    var entry = {
        comment: comment,
        content: content || '',
        keys: opts.keys || [],
        keysecondary: opts.keysecondary || [],
        enabled: true,
        constant: opts.constant || false,
        selective: opts.selective !== undefined ? opts.selective : !opts.constant,
        position: opts.position || 'before_char',
        order: opts.order || 100,
        depth: opts.depth || 4,
        prevent_recursion: true
    };

    if (existing) {
        entry.uid = existing.uid;
        await setLorebookEntries(bookName, [entry]);
    } else {
        await createLorebookEntries(bookName, [entry]);
    }
}

async function deleteEntryByComment(bookName, existingEntries, comment) {
    var existing = findEntryByComment(existingEntries, comment);
    if (existing && existing.uid !== undefined) {
        await deleteLorebookEntries(bookName, [existing.uid]);
    }
}

export async function ensureStateWorldBook() {
    try {
        var books = await getLorebooks();
        if (books && books.length > 0 && books.indexOf(WORLD_BOOK_NAME) !== -1) {
            console.log('[NE] State world book already exists: ' + WORLD_BOOK_NAME);
            return;
        }

        console.log('[NE] Creating state world book: ' + WORLD_BOOK_NAME);
        await createLorebookEntries(WORLD_BOOK_NAME, [{
            comment: '_NE_Placeholder',
            content: '[placeholder]',
            keys: ['__ne_placeholder__'],
            enabled: false,
            constant: false,
            selective: false,
            position: 'before_char',
            order: 9999,
            depth: 4,
            prevent_recursion: true
        }]);

        try {
            var booksAfter = await getLorebooks();
            if (booksAfter && booksAfter.indexOf(WORLD_BOOK_NAME) !== -1) {
                console.log('[NE] State world book created successfully: ' + WORLD_BOOK_NAME);
            }
        } catch (e) {}

        var placeholderEntries = await getLorebookEntries(WORLD_BOOK_NAME);
        if (placeholderEntries && Array.isArray(placeholderEntries)) {
            var uidsToDelete = [];
            placeholderEntries.forEach(function(e) {
                if (e && e.comment === '_NE_Placeholder' && e.uid !== undefined) {
                    uidsToDelete.push(e.uid);
                }
            });
            if (uidsToDelete.length > 0) {
                await deleteLorebookEntries(WORLD_BOOK_NAME, uidsToDelete);
            }
        }
    } catch (e) {
        console.warn('[NE] Failed to ensure state world book:', e.message);
    }
}

export async function syncStateToWorldBook(vault) {
    var state = vault.content && vault.content.state;
    if (!state) return;

    var entries;
    try {
        entries = await getLorebookEntries(WORLD_BOOK_NAME);
        if (!entries || !Array.isArray(entries)) entries = [];
    } catch (e) {
        console.warn('[NE] Failed to load world book entries for sync:', e.message);
        return;
    }

    try {
        await syncGlobal(state, entries);
    } catch (e) { console.warn('[NE] WB syncGlobal failed:', e.message); }

    try {
        await syncCharacters(state, entries);
    } catch (e) { console.warn('[NE] WB syncCharacters failed:', e.message); }

    try {
        await syncFactions(state, entries);
    } catch (e) { console.warn('[NE] WB syncFactions failed:', e.message); }

    try {
        await syncQuests(state, entries);
    } catch (e) { console.warn('[NE] WB syncQuests failed:', e.message); }
}

async function syncGlobal(state, entries) {
    var content = formatWorldBookGlobal(state);
    if (content) {
        await upsertEntry(WORLD_BOOK_NAME, entries, ENTRY_PREFIX_GLOBAL, content, {
            constant: true,
            position: 'before_char',
            order: 100,
            keys: []
        });
    }
}

function buildCharacterKeys(name) {
    var keys = [name];
    if (name.length > 1) {
        keys.push(name + '(');
    }
    return keys;
}

async function syncCharacters(state, entries) {
    var characters = state.characters;
    if (!characters || typeof characters !== 'object') return;

    var syncedNames = {};

    Object.keys(characters).forEach(function(name) {
        var card = characters[name];
        if (!card || typeof card !== 'object') return;

        var status = card.status || '未知';
        var comment = ENTRY_PREFIX_CHAR + name;

        if (status === '已死亡' || status === '已归隐' || status === '已离去') {
            deleteEntryByComment(WORLD_BOOK_NAME, entries, comment).catch(function(e) {
                console.warn('[NE] WB delete char entry failed for', name, ':', e.message);
            });
            return;
        }

        var content = formatWorldBookCharacterCard(state, name);
        if (!content) return;

        syncedNames[comment] = true;
        upsertEntry(WORLD_BOOK_NAME, entries, comment, content, {
            constant: false,
            selective: true,
            position: 'at_depth_as_system',
            depth: 4,
            order: 200,
            keys: buildCharacterKeys(name)
        }).catch(function(e) {
            console.warn('[NE] WB upsert char entry failed for', name, ':', e.message);
        });
    });

    entries.forEach(function(entry) {
        if (!entry || !entry.comment) return;
        if (entry.comment.indexOf(ENTRY_PREFIX_CHAR) !== 0) return;
        if (syncedNames[entry.comment]) return;

        var name = entry.comment.substring(ENTRY_PREFIX_CHAR.length);
        var card = characters[name];
        if (card && card.status === '活跃') return;

        upsertEntry(WORLD_BOOK_NAME, entries, entry.comment, entry.content || '', {
            constant: false,
            selective: true,
            position: 'at_depth_as_system',
            depth: 4,
            order: 200,
            keys: entry.keys || buildCharacterKeys(name)
        }).catch(function(e) {
            console.warn('[NE] WB disable stale char entry failed for', name, ':', e.message);
        });
    });
}

async function syncFactions(state, entries) {
    var factions = state.factions;
    if (!factions || typeof factions !== 'object') return;

    var syncedNames = {};

    Object.keys(factions).forEach(function(name) {
        var content = formatWorldBookFactionCard(state, name);
        if (!content) return;
        var comment = ENTRY_PREFIX_FACTION + name;
        syncedNames[comment] = true;
        upsertEntry(WORLD_BOOK_NAME, entries, comment, content, {
            constant: false,
            selective: true,
            position: 'at_depth_as_system',
            depth: 4,
            order: 300,
            keys: [name]
        }).catch(function(e) {
            console.warn('[NE] WB upsert faction entry failed for', name, ':', e.message);
        });
    });

    entries.forEach(function(entry) {
        if (!entry || !entry.comment) return;
        if (entry.comment.indexOf(ENTRY_PREFIX_FACTION) !== 0) return;
        if (syncedNames[entry.comment]) return;
        var name = entry.comment.substring(ENTRY_PREFIX_FACTION.length);
        deleteEntryByComment(WORLD_BOOK_NAME, entries, entry.comment).catch(function(e) {
            console.warn('[NE] WB delete stale faction entry failed for', name, ':', e.message);
        });
    });
}

async function syncQuests(state, entries) {
    var quests = state.quests;
    if (!quests || typeof quests !== 'object') return;

    var syncedNames = {};
    var sections = ['tasks', 'goals', 'events'];

    sections.forEach(function(section) {
        var items = quests[section];
        if (!items || typeof items !== 'object') return;

        Object.keys(items).forEach(function(name) {
            var content = formatWorldBookQuestCard(state, section, name);
            if (!content) return;
            var comment = ENTRY_PREFIX_QUEST + section + '_' + name;
            syncedNames[comment] = true;
            var keys = [name];
            var item = items[name];
            if (item && item.name && item.name !== name) keys.push(item.name);

            upsertEntry(WORLD_BOOK_NAME, entries, comment, content, {
                constant: false,
                selective: true,
                position: 'at_depth_as_system',
                depth: 4,
                order: 400,
                keys: keys
            }).catch(function(e) {
                console.warn('[NE] WB upsert quest entry failed for', name, ':', e.message);
            });
        });
    });

    entries.forEach(function(entry) {
        if (!entry || !entry.comment) return;
        if (entry.comment.indexOf(ENTRY_PREFIX_QUEST) !== 0) return;
        if (syncedNames[entry.comment]) return;
        deleteEntryByComment(WORLD_BOOK_NAME, entries, entry.comment).catch(function(e) {
            console.warn('[NE] WB delete stale quest entry failed:', e.message);
        });
    });
}
