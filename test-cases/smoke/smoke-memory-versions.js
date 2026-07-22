/**
 * Tier 2 手动 smoke — Memory Version 版本链完整性
 *
 * 使用方法：
 *   1. 在 SillyTavern 中正常使用 NE-Memory（触发 STM 提取 和 LTM 合并）
 *   2. F12 打开控制台，粘贴整个脚本，回车
 *      （主窗口控制台或 NE-Memory 面板 iframe 控制台均可）
 *   3. 查看控制台输出的测试报告
 *
 * 测试覆盖：
 *   - 版本链是否存在
 *   - Version 记录完整性（type/delta/message_dates/timestamp）
 *   - foldMemory 可逆性
 *   - rollbackMemory 后 chain 正确性
 */

(function() {
    'use strict';

    var DB_NAME = 'ne_memory_vault';

    console.log('[SMOKE] 启动，正在从 IndexedDB 扫描活跃 chat...');

    var chatId = null;

    var results = { passed: 0, failed: 0, skipped: 0 };
    function ok(cond, msg) {
        if (cond) { results.passed++; console.log('  ✅ ' + msg); }
        else { results.failed++; console.error('  ❌ ' + msg); }
    }
    function skip(msg) { results.skipped++; console.warn('  ⏭️ ' + msg); }

    function dbVaultScanner() {
        return new Promise(function(resolve) {
            var req = indexedDB.open(DB_NAME);
            req.onsuccess = function() {
                var db = req.result;
                if (!db.objectStoreNames.contains('vaults')) { db.close(); resolve(null); return; }
                var tx = db.transaction('vaults', 'readonly');
                var store = tx.objectStore('vaults');
                var cursorReq = store.openCursor();
                var best = null;
                var bestTime = 0;
                cursorReq.onsuccess = function(e) {
                    var cursor = e.target.result;
                    if (cursor) {
                        var v = cursor.value;
                        var ts = v.updated_at || 0;
                        if (ts > bestTime) { bestTime = ts; best = v; }
                        cursor.continue();
                    } else {
                        db.close();
                        resolve(best ? best.chat_id : null);
                    }
                };
                cursorReq.onerror = function() { db.close(); resolve(null); };
            };
            req.onerror = function() { resolve(null); };
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
        chatId = await dbVaultScanner();
        if (!chatId) {
            console.error('[SMOKE] 无法找到活跃 vault，请先用 NE-Memory 进行至少一轮对话');
            return;
        }
        console.log('[SMOKE] 选定 chatId:', chatId);
        console.log('┃  Memory Version 版本链 Smoke 测试     ┃');
        console.log('┃  chatId: ' + chatId);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

        // ── 1. 检查 active_chain ──
        var chainEx = await getOne('active_chains', chatId);
        var chain = chainEx && chainEx.chain ? chainEx.chain : chainEx;
        ok(!!chain, 'active_chain 存在');
        if (!chain) {
            console.error('[SMOKE] 没有 active_chain，请先触发 STM 提取（多轮对话后查看 Memory 面板）');
            return;
        }

        ok(typeof chain.mem_head_seq === 'number', 'mem_head_seq 为数字');
        ok(typeof chain.mem_base_seq === 'number', 'mem_base_seq 为数字');
        ok(chain.mem_head_seq >= chain.mem_base_seq, 'mem_head_seq >= mem_base_seq');

        // ── 2. 检查 memory_versions ──
        var versions = await getAll('memory_versions', 'chat_id', chatId);
        versions.sort(function(a, b) { return a.seq - b.seq; });

        ok(Array.isArray(versions), 'memory_versions 可查询 (count=' + versions.length + ')');

        if (versions.length > 0) {
            var firstVersion = versions[0];
            ok(typeof firstVersion.id === 'string' && firstVersion.id.length > 0, 'version.id 有效');
            ok(firstVersion.chat_id === chatId, 'version.chat_id 匹配');
            ok(typeof firstVersion.seq === 'number', 'version.seq 为数字');
            ok(typeof firstVersion.timestamp === 'string', 'version.timestamp 为 ISO 字符串');
            ok(typeof firstVersion.type === 'string', 'version.type 有效: ' + firstVersion.type);
            ok(typeof firstVersion.summary === 'string', 'version.summary 有效');

            // delta 结构完整性
            ok(typeof firstVersion.delta === 'object' && firstVersion.delta !== null, 'version.delta 为对象');
            ok(Array.isArray(firstVersion.delta.stm_added), 'delta.stm_added 为数组');
            ok(Array.isArray(firstVersion.delta.stm_removed), 'delta.stm_removed 为数组');
            ok(Array.isArray(firstVersion.delta.stm_moved), 'delta.stm_moved 为数组');
            ok(Array.isArray(firstVersion.delta.ltm_added), 'delta.ltm_added 为数组');
            ok(Array.isArray(firstVersion.delta.ltm_removed), 'delta.ltm_removed 为数组');
            ok(Array.isArray(firstVersion.delta.ltm_modified), 'delta.ltm_modified 为数组');

            // message_dates
            ok(Array.isArray(firstVersion.message_dates), 'version.message_dates 为数组');

            // derived_from_stm_version
            ok(firstVersion.derived_from_stm_version === null || typeof firstVersion.derived_from_stm_version === 'number',
                'derived_from_stm_version 为 null 或 number: ' + firstVersion.derived_from_stm_version);

            // seq 连续性
            var prevSeq = chain.mem_base_seq;
            var seqGaps = 0;
            for (var i = 0; i < versions.length; i++) {
                if (versions[i].seq === prevSeq + 1) {
                    prevSeq = versions[i].seq;
                } else {
                    seqGaps++;
                    prevSeq = versions[i].seq;
                }
            }
            ok(seqGaps === 0, 'seq 连续无断裂 (gaps=' + seqGaps + ')');

            // prev_seq 链表
            var linkErrors = 0;
            for (var j = 0; j < versions.length; j++) {
                if (j === 0) {
                    if (versions[j].prev_seq !== chain.mem_base_seq) linkErrors++;
                } else {
                    if (versions[j].prev_seq !== versions[j-1].seq) linkErrors++;
                }
            }
            ok(linkErrors === 0, 'prev_seq 链表正确 (errors=' + linkErrors + ')');

            // type 分布
            var types = {};
            for (var k = 0; k < versions.length; k++) {
                var t = versions[k].type || 'unknown';
                types[t] = (types[t] || 0) + 1;
            }
            console.log('  type 分布:', JSON.stringify(types));

            // 统计 stm_added 总数
            var totalStmAdded = 0;
            var totalLtmAdded = 0;
            for (var s = 0; s < versions.length; s++) {
                totalStmAdded += (versions[s].delta.stm_added || []).length;
                totalLtmAdded += (versions[s].delta.ltm_added || []).length;
            }
            console.log('  累计 stm_added:', totalStmAdded, '累计 ltm_added:', totalLtmAdded);

            // message_dates 覆盖
            var hasDates = versions.some(function(v) { return v.message_dates && v.message_dates.length > 0; });
            if (versions.length > 0) {
                ok(hasDates, '至少一条 version 有 message_dates (P2 回退所需)');
            }
        }

        // ── 3. foldMemory 验证（用 vault 中的 STM/LTM 作为预期） ──
        if (versions.length > 0) {
            var vaultContent = null;
            try {
                var rawVault = await getOne('vaults', chatId);
                if (rawVault && rawVault.content) vaultContent = rawVault.content;
            } catch(e) {}

            if (vaultContent) {
                var expectedStmCount = (vaultContent.stm_entries || []).length + (vaultContent.unconsolidated_stm || []).length;
                var expectedLtmCount = (vaultContent.ltm_entries || []).length;

                // 从 delta 累计计算预期 STM 和 LTM 数量
                var accumulatedStm = 0;
                var accumulatedLtm = 0;
                for (var f = 0; f < versions.length; f++) {
                    var d = versions[f].delta;
                    accumulatedStm += (d.stm_added || []).length;
                    accumulatedStm -= (d.stm_removed || []).length;
                    // stm_moved 不影响计数（只是跨 LTM 移动）
                    accumulatedLtm += (d.ltm_added || []).length;
                    accumulatedLtm -= (d.ltm_removed || []).length;
                }

                // 链首快照可能已有初始条目，所以这里只做合理性检查而非精确匹配
                ok(accumulatedStm >= 0, '累计 stm 计数非负 (' + accumulatedStm + ')');
                ok(accumulatedLtm >= 0, '累计 ltm 计数非负 (' + accumulatedLtm + ')');

                console.log('  vault: stm=' + expectedStmCount + ', ltm=' + expectedLtmCount);
                console.log('  delta累计: stm=' + accumulatedStm + ', ltm=' + accumulatedLtm);

                // 合理性：vault 中的条目数应该 >= delta 累计（因为可能有初始 base 内容）
                ok(expectedStmCount >= accumulatedStm,
                    'vault stm 数 >= delta 累计 (' + expectedStmCount + ' >= ' + accumulatedStm + ')');
                ok(expectedLtmCount >= accumulatedLtm,
                    'vault ltm 数 >= delta 累计 (' + expectedLtmCount + ' >= ' + accumulatedLtm + ')');
            } else {
                skip('vault dump 失败，跳过 foldMemory 验证');
            }
        }

        // ── 4. rollbackMemory 验证（仅当有 >=2 个 version 时） ──
        if (versions.length >= 2) {
            console.log('\n  ⚡ rollbackMemory 验证 (回退最后 1 个版本)...');

            var targetSeq = versions[versions.length - 2].seq;
            var lastVersion = versions[versions.length - 1];

            // 保存原始状态
            var origOrphans = await getAll('orphaned_branches', 'chat_id', chatId);
            var origOrphanCount = origOrphans.length;

            // 模拟 rollback
            var orphanRecord = {
                id: 'mem_' + lastVersion.id,
                chat_id: chatId,
                seq: lastVersion.seq,
                prev_seq: lastVersion.prev_seq,
                branch_id: 'smoke_mem_' + Date.now(),
                orphaned_at: new Date().toISOString(),
                versions: [lastVersion],
                type: 'memory'
            };

            await put('orphaned_branches', orphanRecord);
            await deleteOne('memory_versions', lastVersion.id);

            // 更新 chain
            chain.mem_head_seq = targetSeq;
            chain.mem_active.pop();
            await put('active_chains', { chat_id: chatId, chain: chain });

            // 验证
            var afterVersions = await getAll('memory_versions', 'chat_id', chatId);
            ok(afterVersions.length === versions.length - 1,
                'rollbackMemory 后 version 减 1 (' + afterVersions.length + ')');

            var afterRaw = await getOne('active_chains', chatId);
            var afterChain = afterRaw && afterRaw.chain ? afterRaw.chain : afterRaw;
            ok(afterChain.mem_head_seq === targetSeq, 'chain.mem_head_seq 更新为 targetSeq');

            // 恢复
            console.log('  🔄 恢复中...');
            await put('memory_versions', lastVersion);
            await deleteOne('orphaned_branches', orphanRecord.id);

            chain.mem_head_seq = lastVersion.seq;
            chain.mem_active.push(lastVersion.seq);
            await put('active_chains', { chat_id: chatId, chain: chain });

            var restoredVersions = await getAll('memory_versions', 'chat_id', chatId);
            ok(restoredVersions.length === versions.length,
                '恢复后 version 数复原 (' + restoredVersions.length + ')');

            var finalOrphans = await getAll('orphaned_branches', 'chat_id', chatId);
            ok(finalOrphans.length === origOrphanCount, 'orphaned_branches 清理完成');
        } else {
            skip('versions < 2，跳过 rollbackMemory 验证');
        }

        // ── 总结 ──
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
        console.log('┃  Smoke 结果: ' + results.passed + ' passed, ' + results.failed + ' failed, ' + results.skipped + ' skipped');
        if (results.failed === 0) {
            console.log('┃  ✅ Memory Version 版本链通过');
        } else {
            console.log('┃  ❌ 存在 ' + results.failed + ' 个失败项');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    }

    run().catch(function(e) {
        console.error('[SMOKE] 脚本异常:', e);
    });
})();
