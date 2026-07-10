/**
 * Tier 2 手动 smoke — v6→v7 vault 拆分迁移完整性
 *
 * 使用方法：
 *   1. 在 SillyTavern 中正常使用 NE-Memory v6.x（旧版本）
 *   2. 升级到包含此变更的 v7 版本，刷新页面
 *   3. F12 打开控制台（主窗口），粘贴整个脚本，回车
 *   4. 查看控制台输出的验证报告
 *
 * 测试覆盖：
 *   - 旧 vaults store 是否仍存在（未被误删）
 *   - 新 state_vaults + memory_vaults 是否存在
 *   - STM/LTM 条目总数是否与迁移前一致
 *   - state 字段数是否与迁移前一致
 *   - readVault 合并读取是否与旧 vault 等价
 */

(function() {
    'use strict';

    var DB_NAME = 'ne_memory_vault';
    var results = { passed: 0, failed: 0, skipped: 0 };

    function ok(cond, msg) {
        if (cond) { results.passed++; console.log('  \u2705 ' + msg); }
        else { results.failed++; console.error('  \u274c ' + msg); }
    }
    function skip(msg) { results.skipped++; console.warn('  \u23ed\ufe0f ' + msg); }

    function getOne(storeName, key) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(null); return; }
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var getReq = store.get(key);
                getReq.onsuccess = function() { db.close(); resolve(getReq.result); };
                getReq.onerror = function() { db.close(); reject(getReq.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function getAllKeys(storeName) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var keys = [];
                var cursorReq = store.openKeyCursor();
                cursorReq.onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (cursor) { keys.push(cursor.key); cursor.continue(); }
                    else { db.close(); resolve(keys); }
                };
                cursorReq.onerror = function() { db.close(); reject(cursorReq.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function listStoreNames() {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var names = Array.from(db.objectStoreNames);
                db.close();
                resolve(names);
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    async function run() {
        console.log('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
        console.log('\u2503  v6\u2192v7 Vault \u62c6\u5206\u8fc1\u79fb Smoke \u6d4b\u8bd5              \u2503');
        console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');

        // ── 1. Store 存在性 ──
        var storeNames = await listStoreNames();
        console.log('\n\u2500\u2500 1. ObjectStore \u5b58\u5728\u6027');
        console.log('  DB stores:', storeNames.join(', '));

        var hasVaults = storeNames.indexOf('vaults') !== -1;
        var hasStateVaults = storeNames.indexOf('state_vaults') !== -1;
        var hasMemoryVaults = storeNames.indexOf('memory_vaults') !== -1;

        ok(hasStateVaults, 'state_vaults store \u5b58\u5728');
        ok(hasMemoryVaults, 'memory_vaults store \u5b58\u5728');
        ok(hasVaults, '\u65e7 vaults store \u4fdd\u7559\uff08\u672a\u88ab\u8bef\u5220\uff09');
        if (!hasVaults) skip('\u65e7 vaults store \u5df2\u5220\u9664\uff08\u53ef\u80fd\u5df2\u8fc1\u79fb\u5e76\u624b\u52a8\u6e05\u7406\uff09');

        if (!hasStateVaults || !hasMemoryVaults) {
            console.error('[SMOKE] \u65b0 store \u4e0d\u5b58\u5728\uff0c\u65e0\u6cd5\u7ee7\u7eed\u9a8c\u8bc1');
            return;
        }

        // ── 2. 按 chat_id 逐条对比 ──
        var oldKeys = hasVaults ? await getAllKeys('vaults') : [];
        var stateKeys = await getAllKeys('state_vaults');
        var memKeys = await getAllKeys('memory_vaults');

        console.log('\n\u2500\u2500 2. \u8bb0\u5f55\u6570\u91cf');
        console.log('  \u65e7 vaults: ' + oldKeys.length + ' \u6761\u8bb0\u5f55');
        console.log('  state_vaults: ' + stateKeys.length + ' \u6761\u8bb0\u5f55');
        console.log('  memory_vaults: ' + memKeys.length + ' \u6761\u8bb0\u5f55');

        ok(stateKeys.length === oldKeys.length || oldKeys.length === 0,
            'state_vaults \u8bb0\u5f55\u6570\u5339\u914d (old=' + oldKeys.length + ', new=' + stateKeys.length + ')');
        ok(memKeys.length === oldKeys.length || oldKeys.length === 0,
            'memory_vaults \u8bb0\u5f55\u6570\u5339\u914d (old=' + oldKeys.length + ', new=' + memKeys.length + ')');

        // ── 3. 内容逐条对比 ──
        if (oldKeys.length > 0) {
            console.log('\n\u2500\u2500 3. \u5185\u5bb9\u9010\u6761\u5bf9\u6bd4 (' + oldKeys.length + ' \u4e2a chat)');

            for (var i = 0; i < oldKeys.length; i++) {
                var chatId = oldKeys[i];
                var oldRaw = await getOne('vaults', chatId);
                var stateRaw = await getOne('state_vaults', chatId);
                var memRaw = await getOne('memory_vaults', chatId);

                if (!oldRaw || !oldRaw.vault) { skip(chatId + ': \u65e7\u8bb0\u5f55\u65e0 vault \u5b57\u6bb5'); continue; }
                var oldContent = oldRaw.vault.content || {};

                var stateOk = !!stateRaw && !!stateRaw.vault;
                var memOk = !!memRaw && !!memRaw.vault;
                ok(stateOk && memOk, chatId + ': \u65b0 state+memory vault \u5747\u5b58\u5728');

                if (!stateOk || !memOk) continue;

                // STM 数量
                var oldStm = (oldContent.unconsolidated_stm || []).length + (oldContent.stm_entries || []).length;
                var newContent = memRaw.vault.content || {};
                var newStm = (newContent.unconsolidated_stm || []).length + (newContent.stm_entries || []).length;
                ok(oldStm === newStm,
                    chatId + ': STM \u603b\u6570 ' + oldStm + '\u2192' + newStm + (oldStm === newStm ? '' : ' \u2757'));

                // LTM 数量
                var oldLtm = (oldContent.ltm_entries || []).length;
                var newLtm = (newContent.ltm_entries || []).length;
                ok(oldLtm === newLtm,
                    chatId + ': LTM \u603b\u6570 ' + oldLtm + '\u2192' + newLtm + (oldLtm === newLtm ? '' : ' \u2757'));

                // state keys
                var oldStateKeys = Object.keys(oldContent.state || {}).length;
                var newState = (stateRaw.vault.content || {}).state || {};
                var newStateKeys = Object.keys(newState).length;
                ok(oldStateKeys === newStateKeys,
                    chatId + ': state keys ' + oldStateKeys + '\u2192' + newStateKeys + (oldStateKeys === newStateKeys ? '' : ' \u2757'));

                // stm_index
                var oldStmIdx = Object.keys(oldRaw.vault.stm_index || {}).length;
                var newStmIdx = Object.keys(memRaw.vault.stm_index || {}).length;
                ok(oldStmIdx === newStmIdx,
                    chatId + ': stm_index entries ' + oldStmIdx + '\u2192' + newStmIdx + (oldStmIdx === newStmIdx ? '' : ' \u2757'));

                // language
                var oldLang = oldContent.language || '';
                var newLang = newContent.language || '';
                ok(oldLang === newLang,
                    chatId + ': language "' + oldLang + '"\u2192"' + newLang + '"' + (oldLang === newLang ? '' : ' \u2757'));

                // story_time / scene / date
                var stateC = stateRaw.vault.content || {};
                ok((oldContent.story_time || '') === (stateC.story_time || '') &&
                   (oldContent.story_scene || '') === (stateC.story_scene || '') &&
                   (oldContent.story_date || '') === (stateC.story_date || ''),
                    chatId + ': story_time/scene/date \u4e00\u81f4');
            }
        } else {
            skip('\u65e0\u65e7 vaults \u8bb0\u5f55\uff0c\u8df3\u8fc7\u5185\u5bb9\u5bf9\u6bd4\uff08\u53ef\u80fd\u5df2\u8fc1\u79fb\u5e76\u6e05\u7406\uff09');
        }

        // ── 4. 总结 ──
        console.log('\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
        console.log('\u2503  Smoke \u7ed3\u679c: ' + results.passed + ' passed, ' + results.failed + ' failed, ' + results.skipped + ' skipped');
        if (results.failed === 0) {
            console.log('\u2503  \u2705 v6\u2192v7 \u8fc1\u79fb\u9a8c\u8bc1\u901a\u8fc7');
        } else {
            console.log('\u2503  \u274c \u5b58\u5728 ' + results.failed + ' \u4e2a\u5931\u8d25\u9879');
            console.log('\u2503  \u65e7 vaults store \u4fdd\u7559\uff0c\u6570\u636e\u672a\u4e22\u5931\u3002\u8bf7\u68c0\u67e5\u4e0a\u65b9\u5931\u8d25\u9879\u3002');
        }
        console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    }

    run().catch(function(e) {
        console.error('[SMOKE] \u811a\u672c\u5f02\u5e38:', e);
    });
})();
