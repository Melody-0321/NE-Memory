import { runtime } from '../runtime.js';

var WORLD_BOOK_NAME = 'NE_Memory_State';

function getLorebookEntries(bookName) {
    return runtime.getLorebookEntries(bookName);
}

function setLorebookEntries(bookName, entries) {
    return runtime.setLorebookEntries(bookName, entries);
}

function createLorebookEntries(bookName, entries) {
    return runtime.createLorebookEntries(bookName, entries);
}

function deleteLorebookEntries(bookName, uids) {
    return runtime.deleteLorebookEntries(bookName, uids);
}

function getLorebooks() {
    return runtime.getLorebooks();
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

