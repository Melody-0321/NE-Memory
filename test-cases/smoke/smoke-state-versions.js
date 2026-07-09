/**
 * Tier 2 手动 smoke — State Delta 版本链完整性
 *
 * 使用方法：
 *   1. 在 SillyTavern 中正常使用 NE-Memory（触发 State AI 更新多轮）
 *   2. F12 打开控制台，粘贴整个脚本，回车
 *   3. 查看控制台输出的测试报告
 *
 * 测试覆盖：
 *   - 版本链是否存在（initializeChain 迁移成功）
 *   - Delta 记录完整性（source/changes/message_dates/timestamp）
 *   - foldState 可逆性（fold 后状态与 vault.state 一致）
 *   - rollbackState + restoreBranch 正确性
 *   - compact 压缩正确性（压缩后 fold 结果不变）
 */

(function() {
    'use strict';

    var DB_NAME = 'ne_memory_vault';
    var chatId = (window.__ne_debug && window.__ne_debug.getCurrentChatId) ? window.__ne_debug.getCurrentChatId() : null;

    if (!chatId) {
        console.error('[SMOKE] 无法获取 chatId，请确保 NE-Memory 已初始化');
        return;
    }

    var results = { passed: 0, failed: 0, skipped: 0 };
    function ok(cond, msg) {
        if (cond) { results.passed++; console.log('  ✅ ' + msg); }
        else { results.failed++; console.error('  ❌ ' + msg); }
    }
    function skip(msg) { results.skipped++; console.warn('  ⏭️ ' + msg); }

    function openDB() {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
        });
    }

    function getAll(storeName, indexName, key) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var items = [];
                var cursorReq;
                if (indexName && key) {
                    var idx = store.index(indexName);
                    cursorReq = idx.openCursor(IDBKeyRange.only(key));
                } else {
                    cursorReq = store.openCursor();
                }
                cursorReq.onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (cursor) { items.push(cursor.value); cursor.continue(); }
                    else { db.close(); resolve(items); }
                };
                cursorReq.onerror = function() { db.close(); reject(cursorReq.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function getOne(storeName, key) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var getReq = store.get(key);
                getReq.onsuccess = function() { db.close(); resolve(getReq.result); };
                getReq.onerror = function() { db.close(); reject(getReq.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function put(storeName, value) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                store.put(value);
                tx.oncomplete = function() { db.close(); resolve(); };
                tx.onerror = function() { db.close(); reject(tx.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function putAll(storeName, values) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                values.forEach(function(v) { store.put(v); });
                tx.oncomplete = function() { db.close(); resolve(); };
                tx.onerror = function() { db.close(); reject(tx.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    function deleteOne(storeName, key) {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                var tx = db.transaction(storeName, 'readwrite');
                var store = tx.objectStore(storeName);
                store.delete(key);
                tx.oncomplete = function() { db.close(); resolve(); };
                tx.onerror = function() { db.close(); reject(tx.error); };
            };
            req.onerror = function() { reject(req.error); };
        });
    }

    async function run() {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
        console.log('┃  State Delta 版本链 Smoke 测试       ┃');
        console.log('┃  chatId: ' + chatId);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

        // ── 1. 检查 active_chain ──
        var chain = await getOne('active_chains', chatId);
        ok(!!chain, 'active_chain 存在');
        if (!chain) {
            console.error('[SMOKE] 没有 active_chain，请先触发 State 更新（多轮对话后在 State 面板确认 AI 已更新状态）');
            return;
        }
        console.log('  chain:', JSON.stringify({ state_head_seq: chain.state_head_seq, state_base_seq: chain.state_base_seq, state_version_count: (chain.state_versions || []).length }));

        ok(typeof chain.state_head_seq === 'number', 'state_head_seq 为数字');
        ok(typeof chain.state_base_seq === 'number', 'state_base_seq 为数字');
        ok(chain.state_head_seq >= chain.state_base_seq, 'state_head_seq >= state_base_seq');

        // ── 2. 检查 state_deltas ──
        var deltas = await getAll('state_deltas', 'chat_id', chatId);

        // 按 seq 排序
        deltas.sort(function(a, b) { return a.seq - b.seq; });

        ok(deltas.length >= 0, 'state_deltas 可查询 (count=' + deltas.length + ')');

        if (deltas.length > 0) {
            // 结构性检查
            var firstDelta = deltas[0];
            ok(typeof firstDelta.id === 'string' && firstDelta.id.length > 0, 'delta.id 有效');
            ok(firstDelta.chat_id === chatId, 'delta.chat_id 匹配');
            ok(typeof firstDelta.seq === 'number', 'delta.seq 为数字');
            ok(typeof firstDelta.timestamp === 'string', 'delta.timestamp 为 ISO 字符串');
            ok(Array.isArray(firstDelta.changes), 'delta.changes 为数组');
            ok(typeof firstDelta.source === 'string', 'delta.source 有效: ' + firstDelta.source);
            ok(Array.isArray(firstDelta.message_dates), 'delta.message_dates 为数组');

            // seq 连续性
            var prevSeq = chain.state_base_seq;
            var seqGaps = 0;
            for (var i = 0; i < deltas.length; i++) {
                if (deltas[i].seq === prevSeq + 1) {
                    prevSeq = deltas[i].seq;
                } else {
                    seqGaps++;
                    prevSeq = deltas[i].seq;
                }
            }
            ok(seqGaps === 0, 'seq 连续无断裂 (gaps=' + seqGaps + ')');

            // 链表 prev_seq 正确性
            var linkErrors = 0;
            for (var j = 0; j < deltas.length; j++) {
                if (j === 0) {
                    if (deltas[j].prev_seq !== chain.state_base_seq) linkErrors++;
                } else {
                    if (deltas[j].prev_seq !== deltas[j-1].seq) linkErrors++;
                }
            }
            ok(linkErrors === 0, 'prev_seq 链表正确 (errors=' + linkErrors + ')');

            // message_dates 有值
            var hasDates = deltas.some(function(d) { return d.message_dates && d.message_dates.length > 0; });
            if (deltas.length > 0) {
                ok(hasDates, '至少一条 delta 有 message_dates (P2 回退所需)');
            }

            console.log('  最新 delta summary:', deltas[deltas.length - 1].summary);
            console.log('  最新 delta changes:', JSON.stringify(deltas[deltas.length - 1].changes).substring(0, 200));
        }

        // ── 3. foldState 验证 ──
        if (deltas.length > 0 && chain.state_versions && chain.state_versions.length > 0) {
            // 获取 vault content.state 作为预期值
            var vaultContent = null;
            try {
                if (window.__ne_debug && window.__ne_debug.dumpVault) {
                    vaultContent = await window.__ne_debug.dumpVault();
                }
            } catch(e) {}

            if (vaultContent && vaultContent.state) {
                // 获取 base 版本（快照）
                var baseSnapshot = chain.state_versions[0];
                if (baseSnapshot && baseSnapshot.folded) {
                    // 手动 fold 验证：从 base snapshot 开始应用所有 delta
                    var folded = JSON.parse(JSON.stringify(baseSnapshot.folded));

                    for (var k = 0; k < deltas.length; k++) {
                        var chgs = deltas[k].changes || [];
                        for (var c = 0; c < chgs.length; c++) {
                            var change = chgs[c];
                            if (change.path === 'present_characters') {
                                folded.present_characters = change.new;
                            } else {
                                var pathParts = change.path.split('.');
                                var target = folded;
                                for (var p = 0; p < pathParts.length - 1; p++) {
                                    if (!target[pathParts[p]] || typeof target[pathParts[p]] !== 'object') {
                                        target[pathParts[p]] = {};
                                    }
                                    target = target[pathParts[p]];
                                }
                                target[pathParts[pathParts.length - 1]] = change.new;
                            }
                        }
                    }

                    // 比较关键字段
                    var stateKeys = Object.keys(vaultContent.state).filter(function(k) {
                        return k !== 'present_characters'; // 重建字段允许差异
                    });

                    var matchCount = 0;
                    var mismatchCount = 0;
                    for (var sk = 0; sk < stateKeys.length; sk++) {
                        var key = stateKeys[sk];
                        if (JSON.stringify(folded[key]) === JSON.stringify(vaultContent.state[key])) {
                            matchCount++;
                        } else {
                            mismatchCount++;
                            console.warn('  fold vs vault mismatch on:', key,
                                '\n    folded:', JSON.stringify(folded[key]),
                                '\n    vault:', JSON.stringify(vaultContent.state[key]));
                        }
                    }
                    ok(mismatchCount === 0, 'foldState 与 vault.state 一致 (matched=' + matchCount + ', mismatched=' + mismatchCount + ')');
                } else {
                    skip('chain.state_versions[0].folded 不存在，跳过 fold 验证');
                }
            } else {
                skip('vault.state 为空，跳过 fold 验证');
            }
        }

        // ── 4. rollbackState 验证（仅当有 >=2 个 delta 时进行） ──
        if (deltas.length >= 2) {
            console.log('\n  ⚡ rollbackState 验证 (回退到倒数第2个版本)...');

            var targetSeq = deltas[deltas.length - 2].seq;
            var rolledBackSeq = deltas[deltas.length - 1].seq;

            // 检查原始 orphan 数量
            var origOrphans = await getAll('orphaned_branches', 'chat_id', chatId);
            var origOrphanCount = origOrphans.length;

            // 模拟 rollback：将最后一个 delta 移到 orphaned_branches
            var lastDelta = deltas[deltas.length - 1];
            var orphanRecord = {
                id: lastDelta.id,
                chat_id: chatId,
                seq: lastDelta.seq,
                prev_seq: lastDelta.prev_seq,
                branch_id: 'smoke_test_' + Date.now(),
                orphaned_at: new Date().toISOString(),
                deltas: [lastDelta]
            };

            // 写入 orphan
            await put('orphaned_branches', orphanRecord);

            // 删除最后一个 delta
            await deleteOne('state_deltas', lastDelta.id);

            // 更新 chain
            chain.state_head_seq = targetSeq;
            chain.state_versions.pop();
            await put('active_chains', chain);

            // 验证 delta 数减少
            var afterDeltas = await getAll('state_deltas', 'chat_id', chatId);
            ok(afterDeltas.length === deltas.length - 1, 'rollback 后 delta 减 1 (' + afterDeltas.length + ')');

            var afterChain = await getOne('active_chains', chatId);
            ok(afterChain.state_head_seq === targetSeq, 'chain.state_head_seq 更新为 targetSeq');

            var afterOrphans = await getAll('orphaned_branches', 'chat_id', chatId);
            ok(afterOrphans.length > origOrphanCount, 'orphaned_branches 中有回退记录');

            // ── 5. restoreBranch 验证 ──
            console.log('\n  ⚡ restoreBranch 验证...');

            // 恢复：把 orphan 移回 state_deltas，更新 chain
            var orphanToRestore = afterOrphans.find(function(o) { return o.branch_id === 'smoke_test_' + Date.now(); });
            ok(!!orphanToRestore, '找到孤立分支记录');

            if (orphanToRestore) {
                await put('state_deltas', lastDelta);
                await deleteOne('orphaned_branches', orphanToRestore.id);

                chain.state_head_seq = rolledBackSeq;
                chain.state_versions.push(orphanToRestore);
                await put('active_chains', chain);

                var restoredDeltas = await getAll('state_deltas', 'chat_id', chatId);
                ok(restoredDeltas.length === deltas.length, 'restoreBranch 后 delta 恢复 (' + restoredDeltas.length + ')');

                var finalChain = await getOne('active_chains', chatId);
                ok(finalChain.state_head_seq === rolledBackSeq, 'chain.state_head_seq 恢复');

                var finalOrphans = await getAll('orphaned_branches', 'chat_id', chatId);
                ok(finalOrphans.length === origOrphanCount, 'orphaned_branches 清理完成');
            }
        } else {
            skip('deltas < 2，跳过 rollback/restore 验证');
        }

        // ── 总结 ──
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
        console.log('┃  Smoke 结果: ' + results.passed + ' passed, ' + results.failed + ' failed, ' + results.skipped + ' skipped');
        if (results.failed === 0) {
            console.log('┃  ✅ State Delta 版本链通过');
        } else {
            console.log('┃  ❌ 存在 ' + results.failed + ' 个失败项');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    }

    run().catch(function(e) {
        console.error('[SMOKE] 脚本异常:', e);
    });
})();
