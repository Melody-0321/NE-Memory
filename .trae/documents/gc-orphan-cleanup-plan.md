# IndexedDB 孤儿数据 GC 计划（v2 — 纯手动，无自动）

> 目标：提供手动触发按钮清理 IndexedDB 中的孤儿 vault 和 snapshot 数据
> 日期：2026-06-28 | 版本：v2（基于源码深度探索后的最终方案）

---

## 一、设计结论

### 为什么不要 auto channel

auto channel 的根本缺陷（已论证）：
- 已删除的聊天永远无法成为 ST 的"当前上下文"
- `loadVault(chatId)` 仅在 chat 成为当前上下文时运行
- 由此：被删聊天的 IndexedDB 数据永远不会被 auto channel 检测到
- **结论：auto channel 是无用功，不实现**

### 为什么使用 `ctx.characters` + `ctx.groups` 做孤儿判定

ST 的 `SillyTavern.getContext()` 暴露了完整的角色 Map 和群组列表：

| 来源 | 提取方式 | 覆盖 |
|------|---------|------|
| `ctx.characters` | `Object.values(characters).map(c => c.chat)` | 所有单角色聊天的文件名 |
| `ctx.groups` | `groups.map(g => g.chat_id)` | 所有群组聊天的 chat_id |

这两个集合的并集 = **ST 中所有现存的聊天 ID**。与 IndexedDB 中存储的 key 做差集即得孤儿列表。

### 指纹格式兼容

你的 `getChatId()` 在旧 ST 下回退到 `ne_<characterId>_<firstMsgId>` 指纹。匹配策略：
- IndexedDB key 形如 `ne_charX_12345` → 提取 `charX` → 检查 `characters['charX']` 是否存在
- 角色存在 → 聊天存活（即使换了聊天文件，角色还在）

---

## 二、方案：手动按钮，在工具 Tab 的历史手风琴中

### 按钮位置

工具 Tab 的 Data 卡片目前有 3 个按钮（[panel.js:L1574-L1578](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js#L1574-L1578)）：
```
Export JSON  |  Import JSON  |  Embed into Chat
```

新增第四个按钮：
```
Export JSON  |  Import JSON  |  Embed into Chat  |  Clean Orphan Data
```

点击后弹窗显示扫描结果，用户确认后执行清理。

### 交互流程

```
用户点击 "Clean Orphan Data"
  → 第一步：扫描
      1. 通过 window.parent.SillyTavern.getContext() 获取 ctx
      2. 从 ctx.characters 提取所有 .chat 属性
      3. 从 ctx.groups 提取所有 .chat_id
      4. 获取当前 chatId（运行时 fingerprint 兼容）
      5. 遍历 IndexedDB vaults store 所有 key
      6. 对每个 key 判定状态:
         - 在 ST 现存集合中 → "active"
         - 是指纹格式且有角色匹配 → "alive (fingerprint)"
         - 其他 → "orphan"
      7. 弹 confirm 对话框，显示各状态的条目数

  → 第二步：确认后清理
      对每个 orphan 条目：
        1. IndexedDB vaults store → remove(key)
        2. IndexedDB snapshots store → 按 chat_id 索引批量删除
        3. localStorage ne_chat_stats → delete entries
        4. localStorage ne_ph_<chatId> → removeItem
        5. localStorage ne_collapse_<chatId> → removeItem

  → 第三步：刷新 History 列表
      renderHistory(_currentGetChatId)
```

---

## 三、实现文件

### 3.1 新增文件

**`src/core/vault/garbage-collector.js`** — GC 核心逻辑

### 3.2 修改文件

| 文件 | 改动 | 行数估计 |
|------|------|:---:|
| `src/core/vault/store.js` | 新增 `listAllChatIds()` + `removeSnapshotsForChat(chatId)` | ~30 |
| `src/core/engine/chat-telemetry.js` | 新增 `listAllKnownChatIds()` | ~5 |
| `src/adapter/panel.js` | 按钮 HTML + onclick 绑定 + 弹窗确认 + 扫描结果展示 | ~50 |
| `src/adapter/index.js` | `_buildDebugApi` 中新增 `gc()`、`purgeChat()` | ~15 |

---

### 3.3 `garbage-collector.js` 详细设计

```javascript
// src/core/vault/garbage-collector.js

import { read, remove, openDB } from './store.js';
import { listSnapshots } from './versions.js';
import { clearChatStats } from '../engine/chat-telemetry.js';

/**
 * 从 ST context 中收集所有现存的聊天 ID
 * 依赖 window.parent.SillyTavern.getContext()
 */
export function collectSTChatIds() {
    const ids = new Set();
    try {
        const ctx = window.parent.SillyTavern.getContext();
        // 单角色聊天
        if (ctx.characters) {
            Object.values(ctx.characters).forEach(c => {
                if (c && typeof c.chat === 'string' && c.chat) ids.add(c.chat);
            });
        }
        // 群组聊天
        if (ctx.groups && Array.isArray(ctx.groups)) {
            ctx.groups.forEach(g => {
                if (g && typeof g.chat_id === 'string' && g.chat_id) ids.add(g.chat_id);
            });
        }
        // 当前聊天（额外保险）
        if (ctx.chatId && typeof ctx.chatId === 'string' && ctx.chatId !== 'default') ids.add(ctx.chatId);
    } catch (e) {
        console.warn('[NE-GC] collectSTChatIds failed:', e.message);
    }
    return ids;
}

/**
 * 检查 fingerprint 格式的 key 是否匹配已知角色
 */
function fingerprintMatchesAnyCharacter(key, characters) {
    // "ne_<chid>_<msgId>" → 提取 chid 部分
    const match = key.match(/^ne_(.+)_(\d+|[a-f0-9-]{8,})$/);
    if (!match) return false;
    const chid = match[1];
    return Object.prototype.hasOwnProperty.call(characters, chid);
}

/**
 * 扫描 IndexedDB，标记各条目的状态
 */
export async function scanOrphans() {
    const stIds = collectSTChatIds();
    const ctx = window.parent.SillyTavern.getContext();
    const characters = ctx.characters || {};
    const currentChatId = ctx.chatId;
    
    // 从 IndexedDB 收集 vault 条目
    const allKeys = await listAllChatIds();
    
    const results = [];
    for (const key of allKeys) {
        let status = 'orphan';
        let reason = '';
        
        if (stIds.has(key)) {
            status = 'active';
            reason = 'exists in ST';
        } else if (fingerprintMatchesAnyCharacter(key, characters)) {
            status = 'alive';
            reason = 'fingerprint matches known character';
        }
        
        const vault = await read(key);
        results.push({
            chat_id: key,
            version: vault ? vault.version : 0,
            stm: vault && vault.content ? (vault.content.unconsolidated_stm || []).length : 0,
            ltm: vault && vault.content ? (vault.content.ltm_entries || []).length : 0,
            status: status,
            reason: reason
        });
    }
    return results;
}

/**
 * 清理指定 chat_id 的全部数据
 */
export async function purgeOrphanChatData(chatId) {
    const purgeLog = [];
    
    // 1. IndexedDB: vaults store
    await remove(chatId);
    purgeLog.push('vaults:' + chatId);

    // 2. IndexedDB: snapshots store
    const snapshots = await listSnapshots(chatId);
    if (snapshots.length > 0) {
        const db = await openDB();
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        snapshots.forEach(s => store.delete(s.id));
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
        purgeLog.push('snapshots:' + snapshots.length);
    }

    // 3. localStorage: ne_chat_stats
    try {
        const stats = JSON.parse(localStorage.getItem('ne_chat_stats') || '{}');
        if (stats[chatId]) { delete stats[chatId]; localStorage.setItem('ne_chat_stats', JSON.stringify(stats)); purgeLog.push('ne_chat_stats'); }
    } catch (e) {}

    // 4. localStorage: ne_ph_<chatId>
    try { const k = 'ne_ph_' + chatId; if (localStorage.getItem(k)) { localStorage.removeItem(k); purgeLog.push(k); } } catch (e) {}

    // 5. localStorage: ne_collapse_<chatId>
    try { const k = 'ne_collapse_' + chatId; if (localStorage.getItem(k)) { localStorage.removeItem(k); purgeLog.push(k); } } catch (e) {}

    console.log('[NE-GC] purged orphan chat:', chatId, '→', purgeLog.join(', '));
    return purgeLog;
}
```

### 3.4 `store.js` 新增函数

```javascript
// 遍历 vaults store 所有 key
export async function listAllChatIds() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('vaults', 'readonly');
        const req = tx.objectStore('vaults').getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// 删除 snapshots store 中某 chat 的全部快照
export async function removeSnapshotsForChat(chatId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const idx = tx.objectStore('snapshots').index('chat_id');
        const req = idx.openCursor(IDBKeyRange.only(chatId));
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
            else { tx.oncomplete = resolve; tx.onerror = reject; }
        };
    });
}
```

### 3.5 `panel.js` UI 改动

**A. 新增按钮 HTML**，放在 Data 卡片中，Embed into Chat 按钮之后：

```javascript
'<button id="narrative_vault_clean_orphans" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" '
  + 'title="' + t('Scan and remove IndexedDB data for deleted chats') + '">'
  + t('Clean Orphan Data') + '</button>'
```

**B. 按钮绑定**（参考 `embedBtn.onclick` 模式）：

```javascript
var cleanOrphansBtn = byId('narrative_vault_clean_orphans');
if (cleanOrphansBtn) {
    cleanOrphansBtn.onclick = async function () {
        try {
            // 扫描
            var results = await scanOrphans();
            var active = results.filter(r => r.status === 'active').length;
            var alive = results.filter(r => r.status === 'alive').length;
            var orphans = results.filter(r => r.status === 'orphan');
            
            if (orphans.length === 0) {
                alert(t('No orphan data found. All IndexedDB entries are linked to existing chats.'));
                return;
            }
            
            var msg = t('Orphan data scan results:') + '\n\n';
            msg += t('Active chats:') + ' ' + active + '\n';
            msg += t('Fingerprint matches:') + ' ' + alive + '\n';
            msg += t('Orphan entries:') + ' ' + orphans.length + '\n\n';
            msg += t('Orphan chat IDs:') + '\n';
            orphans.forEach(function(o) {
                msg += '  - ' + o.chat_id + ' (v' + o.version + ', stm=' + o.stm + ', ltm=' + o.ltm + ')\n';
            });
            msg += '\n' + t('Delete these orphan vaults and all their snapshots?');
            
            if (!confirm(msg)) return;
            
            // 逐个清理
            for (var i = 0; i < orphans.length; i++) {
                await purgeOrphanChatData(orphans[i].chat_id);
            }
            
            alert(t('Cleaned') + ' ' + orphans.length + ' ' + t('orphan entries') + '.');
            
            // 刷新 History 列表
            var getChatId = _currentGetChatId;
            if (getChatId) renderHistory(getChatId);
        } catch (e) {
            console.error('[NE] Clean orphans failed:', e);
            alert(t('Clean Orphan Data') + ' failed: ' + e.message);
        }
    };
}
```

### 3.6 `index.js` debug API 补充

```javascript
// _buildDebugApi 中新增:
gc: async function() { return await scanOrphans(); },
purgeChat: async function(chatId) { return await purgeOrphanChatData(chatId); },
```

---

## 四、安全性保障

| 场景 | 判为 | 处理 |
|------|------|------|
| ST `ctx.characters[chid].chat` = `"Alice - 今天"`，IndexedDB key = `"Alice - 今天"` | active | 不清理 |
| ST 角色存在，IndexedDB key = `"ne_chid_12345"`（旧指纹） | alive | 不清理 |
| IndexedDB key = `"Bob - 昨天"`，ST 的 characters + groups 中无匹配 | **orphan** | 清理 |
| IndexedDB key = `"ne_unknown_99999"`，无匹配角色 | **orphan** | 清理 |

**额外保护**：
- 扫描结果以 `confirm()` 对话框展示完整列表
- 每个 orphan 都列出版本号+STM/LTM数量
- 用户逐一确认后才执行删除
- 当前活跃聊天不会被标记为 orphan（它必定在 ST 集合中）

---

## 五、数据流

```
用户在工具 Tab 点击 "Clean Orphan Data"
  │
  ├─ scanOrphans()
  │   ├─ window.parent.SillyTavern.getContext()
  │   │   ├─ ctx.characters → 每个角色.chat                       → stIds
  │   │   ├─ ctx.groups     → 每组.chat_id                        → stIds
  │   │   └─ ctx.chatId     (额外保险)                            → stIds
  │   │
  │   ├─ IndexedDB.listAllChatIds()                                → dbIds
  │   │
  │   └─ dbIds 逐一判定:
  │       ├─ key ∈ stIds                     → "active"
  │       ├─ key 是指纹 ∧ 角色存在             → "alive"
  │       └─ 其他                              → "orphan"
  │
  ├─ confirm 对话框列出所有 orphan
  │
  └─ 用户确认 → 逐个 purgeOrphanChatData(chatId)
      ├─ IndexedDB: remove(chatId)
      ├─ IndexedDB: 遍历 snapshots 表按 chat_id 索引逐条 delete
      ├─ localStorage: delete ne_chat_stats[chatId]
      ├─ localStorage: removeItem('ne_ph_' + chatId)
      └─ localStorage: removeItem('ne_collapse_' + chatId)
```

---

## 六、验证步骤

1. `npm run build` 零错误
2. 打开一个正常聊天 → 工具 Tab → Clean Orphan Data → 应显示 "No orphan data found"（该聊天在 ST 集合中）
3. 在 ST 中删除一个测试聊天 → 刷新页面 → 工具 Tab → Clean Orphan Data → 应列出该聊天的 orphan 条目
4. 点击确认 → 清理完成 → 刷新 History 列表
5. `__ne_debug.gc()` → console 输出扫描结果
6. `__ne_debug.purgeChat('具体chat_id')` → confirm 后定向清理

---

## 七、文件变更清单

| 操作 | 文件 | 说明 |
|:---:|------|------|
| 新增 | `src/core/vault/garbage-collector.js` | `collectSTChatIds`、`scanOrphans`、`purgeOrphanChatData` |
| 修改 | `src/core/vault/store.js` | 新增 `listAllChatIds`、`removeSnapshotsForChat` |
| 修改 | [panel.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel.js) | Data 卡片中新增按钮 + onclick 绑定 |
| 修改 | [index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js) | `_buildDebugApi` 中新增 `gc`、`purgeChat` |
