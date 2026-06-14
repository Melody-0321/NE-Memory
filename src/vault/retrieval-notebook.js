// vault/retrieval-notebook.js — RetrievalNotebook: 检索工作区
//
// 检索会话内维持一个 mutable Notebook:
//   - map: Map<stm_id, UnifiedEntry>    — 去重后的统一条目
//   - threadIndex: {}                    — 线程注册表
//   - version: number                    — 单调递增
//   - diff: { addedIds, expandedIds, newThreadIds } — 上次 describe 后的增量
//
// 不持久化。检索会话结束后丢弃。

function RetrievalNotebook() {
    this.map = new Map();
    this.threadIndex = {};
    this.version = 0;
    this.lastDescribedVersion = 0;
    this._snapshot = { entryIds: [], threadIds: [], expandedIds: [] };
}

// ─── 写入 ───

RetrievalNotebook.prototype.addEntry = function(stmId, unifiedEntry) {
    this.map.set(stmId, unifiedEntry);
    this.version++;
};

RetrievalNotebook.prototype.addThread = function(threadId, threadDef) {
    this.threadIndex[threadId] = threadDef;
    this.version++;
};

RetrievalNotebook.prototype.extendThread = function(threadId, stmId) {
    var thread = this.threadIndex[threadId];
    if (!thread) return;
    if (thread.stmIds.indexOf(stmId) === -1) {
        thread.stmIds.push(stmId);
        var total = thread.stmIds.length;
        var entry = this.map.get(stmId);
        if (entry) {
            var existingThread = false;
            for (var i = 0; i < entry.threads.length; i++) {
                if (entry.threads[i].threadId === threadId) {
                    entry.threads[i].total = total;
                    existingThread = true;
                    break;
                }
            }
            if (!existingThread) {
                entry.threads.push({ threadId: threadId, position: total, total: total });
            }
        }
    }
    this.version++;
};

RetrievalNotebook.prototype.addChain = function(entityName, chainEntries) {
    var self = this;
    var threadId = 'chain:' + entityName;
    var stmIds = [];

    chainEntries.forEach(function(e, idx) {
        var id = e.id;
        if (!id) return;
        stmIds.push(id);

        var existing = self.map.get(id);
        if (existing) {
            var hasThread = false;
            for (var i = 0; i < existing.threads.length; i++) {
                if (existing.threads[i].threadId === threadId) {
                    hasThread = true;
                    break;
                }
            }
            if (!hasThread) {
                existing.threads.push({ threadId: threadId, position: idx + 1, total: chainEntries.length });
            }
            if (existing.sources.indexOf('chain:' + entityName) === -1) {
                existing.sources.push('chain:' + entityName);
            }
        } else {
            self.map.set(id, {
                entry: e,
                type: 'stm',
                bm25Score: 0,
                threads: [{ threadId: threadId, position: idx + 1, total: chainEntries.length }],
                sources: ['chain:' + entityName],
                _expanded: false,
                _lastDescribedVersion: 0
            });
        }
    });

    var timeRange = '';
    if (chainEntries.length > 0) {
        var first = chainEntries[0];
        var last = chainEntries[chainEntries.length - 1];
        var firstTime = first.period || first.time_label || '';
        var lastTime = last.period || last.time_label || '';
        if (firstTime && lastTime && firstTime !== lastTime) {
            timeRange = firstTime + ' → ' + lastTime;
        } else if (firstTime) {
            timeRange = firstTime;
        }
    }

    this.threadIndex[threadId] = {
        type: 'entity_chain',
        label: entityName,
        stmIds: stmIds,
        timeRange: timeRange,
        dagLayer: 1,
        parentThreadId: null
    };
    this.version++;
};

RetrievalNotebook.prototype.addDispersedThread = function(label, stmIds) {
    var self = this;
    var threadId = 'dispersed:' + label;
    var sortedIds = stmIds.slice();
    var validIds = [];

    sortedIds.forEach(function(id) {
        var entry = self.map.get(id);
        if (!entry) return;
        validIds.push(id);
        var hasThread = false;
        for (var i = 0; i < entry.threads.length; i++) {
            if (entry.threads[i].threadId === threadId) {
                hasThread = true;
                break;
            }
        }
        if (!hasThread) {
            entry.threads.push({ threadId: threadId, position: validIds.length, total: sortedIds.length });
        }
    });

    if (validIds.length === 0) return;

    this.threadIndex[threadId] = {
        type: 'dispersed',
        label: label,
        stmIds: validIds,
        dagLayer: 1,
        parentThreadId: null,
        id: null,
        persisted: false
    };
    this.version++;
};

RetrievalNotebook.prototype.expand = function(stmId) {
    var entry = this.map.get(stmId);
    if (entry) {
        entry._expanded = true;
        this.version++;
    }
};

// ─── 读取 ───

RetrievalNotebook.prototype.describe = function() {
    var self = this;
    var threadKeys = Object.keys(this.threadIndex);
    var parts = [];
    var totalEntries = 0;
    var bm25HitCount = 0;
    var ltmDirCount = 0;

    this.map.forEach(function(entry) {
        totalEntries++;
        if (entry.bm25Score > 0) bm25HitCount++;
        if (entry.type === 'ltm' && entry.sources && entry.sources.indexOf('ltm_dir') !== -1) ltmDirCount++;
    });

    threadKeys.forEach(function(tid) {
        var t = self.threadIndex[tid];
        var stmCount = t.stmIds ? t.stmIds.length : 0;
        if (stmCount === 0) return;
        var bm25InThread = 0;
        t.stmIds.forEach(function(id) {
            var e = self.map.get(id);
            if (e && e.bm25Score > 0) bm25InThread++;
        });
        var extra = bm25InThread > 0 ? ' [其中' + bm25InThread + '条BM25命中]' : '';
        parts.push(t.label + ' ' + stmCount + '条' + extra);
    });

    var summary = threadKeys.length + ' 线程: ' + parts.join(', ');
    summary += '\n共 ' + totalEntries + ' 条, 含 ' + bm25HitCount + ' 条 BM25 命中, ' + ltmDirCount + ' 条 LTM 目录';

    this._snapshot = {
        entryIds: Array.from(this.map.keys()),
        threadIds: Object.keys(this.threadIndex),
        expandedIds: this._getExpandedIds()
    };
    this.lastDescribedVersion = this.version;

    return summary;
};

RetrievalNotebook.prototype._getExpandedIds = function() {
    var ids = [];
    this.map.forEach(function(entry, id) {
        if (entry._expanded) ids.push(id);
    });
    return ids;
};

RetrievalNotebook.prototype.diff = function() {
    var lines = [];
    var currentEntryIds = Array.from(this.map.keys());
    var currentThreadIds = Object.keys(this.threadIndex);
    var currentExpandedIds = this._getExpandedIds();

    // 新增条目
    var newEntries = currentEntryIds.filter(function(id) {
        return this._snapshot.entryIds.indexOf(id) === -1;
    }, this);
    if (newEntries.length > 0) {
        lines.push('新增条目: ' + newEntries.length + ' 条 (' + newEntries.slice(0, 10).join(', ') + (newEntries.length > 10 ? '...' : '') + ')');
    }

    // 新展开条目
    var newExpanded = currentExpandedIds.filter(function(id) {
        return this._snapshot.expandedIds.indexOf(id) === -1;
    }, this);
    newExpanded.forEach(function(id) {
        var entry = this.map.get(id);
        if (entry) {
            var text = (entry.entry && (entry.entry.title || entry.entry.event)) ? (entry.entry.title || entry.entry.event).substring(0, 60) : '';
            lines.push(id + ' 已展开' + (text ? ' (' + text + '...)' : ''));
        }
    }, this);

    // 新增线程
    var newThreads = currentThreadIds.filter(function(tid) {
        return this._snapshot.threadIds.indexOf(tid) === -1;
    }, this);
    newThreads.forEach(function(tid) {
        var t = this.threadIndex[tid];
        if (t) {
            lines.push('新增线程: ' + t.label + ' ' + (t.stmIds ? t.stmIds.length : 0) + '条');
        }
    }, this);

    if (lines.length === 0) {
        lines.push('无变化');
    }

    return lines.join('\n');
};

RetrievalNotebook.prototype.getEntry = function(stmId) {
    return this.map.get(stmId) || null;
};

RetrievalNotebook.prototype.getThread = function(threadId) {
    return this.threadIndex[threadId] || null;
};

RetrievalNotebook.prototype.toPromptEntries = function() {
    var entries = [];
    this.map.forEach(function(entry, id) {
        entries.push(entry);
    });

    // 排序: bm25 命中优先（降序），然后按第一条线程的 position
    entries.sort(function(a, b) {
        if (a.bm25Score > 0 && b.bm25Score === 0) return -1;
        if (a.bm25Score === 0 && b.bm25Score > 0) return 1;
        var aPos = a.threads.length > 0 ? a.threads[0].position : 9999;
        var bPos = b.threads.length > 0 ? b.threads[0].position : 9999;
        return aPos - bPos;
    });

    return entries;
};

// ─── 跳跃计算 ───

RetrievalNotebook.prototype.jumpGapBetween = function(stmIdA, stmIdB, threadId) {
    var thread = this.threadIndex[threadId];
    if (!thread || !thread.stmIds) return 0;
    var posA = thread.stmIds.indexOf(stmIdA);
    var posB = thread.stmIds.indexOf(stmIdB);
    if (posA === -1 || posB === -1) return 0;
    return Math.abs(posB - posA) - 1;
};

RetrievalNotebook.prototype.threadBoundaryMark = function(stmIdA, stmIdB) {
    var entryA = this.map.get(stmIdA);
    var entryB = this.map.get(stmIdB);
    if (!entryA || !entryB) return null;
    var threadsA = entryA.threads.map(function(t) { return t.threadId; });
    var threadsB = entryB.threads.map(function(t) { return t.threadId; });
    // 找出两者共享的线程
    var shared = [];
    for (var i = 0; i < threadsA.length; i++) {
        if (threadsB.indexOf(threadsA[i]) !== -1) shared.push(threadsA[i]);
    }
    if (shared.length === 0) return 'thread_boundary';
    return null;
};

export { RetrievalNotebook };
