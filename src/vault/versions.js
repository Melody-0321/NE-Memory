/**
 * vault/versions.js — 版本快照管理
 *
 * 替代 Python vault_store.py 中的历史快照逻辑。
 * IndexedDB 独立 store 存储快照，上限 30。
 */
import { openDB } from './store.js';

const SNAPSHOT_STORE = 'snapshots';

export async function saveSnapshot(chatId, vault) {
    const db = await openDB();
    const version = vault.version || 0;
    const snapshot = {
        id: chatId + '_v' + version,
        chat_id: chatId,
        version: version,
        updated_at: vault.updated_at || new Date().toISOString(),
        data: JSON.parse(JSON.stringify(vault))
    };
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        const store = tx.objectStore(SNAPSHOT_STORE);
        store.put(snapshot);
        tx.oncomplete = () => {
            pruneOldSnapshots(db, chatId).then(() => resolve());
        };
        tx.onerror = () => reject(tx.error);
    });
}

async function pruneOldSnapshots(db, chatId) {
    const all = await listSnapshots(chatId);
    if (all.length <= 30) return;
    const toDelete = all.slice(30);
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOT_STORE);
    toDelete.forEach(s => store.delete(s.id));
    return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
}

export async function listSnapshots(chatId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const store = tx.objectStore(SNAPSHOT_STORE);
        const idx = store.index('chat_id');
        const req = idx.getAll(chatId);
        req.onsuccess = () => {
            const results = req.result || [];
            results.sort((a, b) => b.version - a.version);
            resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function restoreSnapshot(chatId, version) {
    const db = await openDB();
    const snapshotId = chatId + '_v' + version;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
        const store = tx.objectStore(SNAPSHOT_STORE);
        const req = store.get(snapshotId);
        req.onsuccess = async () => {
            if (!req.result) { resolve(null); return; }
            const vault = req.result.data;
            const { write } = await import('./store.js');
            await write(chatId, vault);
            resolve(vault);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function deleteSnapshot(chatId, version) {
    const db = await openDB();
    const snapshotId = chatId + '_v' + version;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        const store = tx.objectStore(SNAPSHOT_STORE);
        store.delete(snapshotId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
