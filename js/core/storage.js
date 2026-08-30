/* IndexedDB schema and persistence operations. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            reject(new Error(t('dbUnavailable')));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            let store;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            } else {
                store = request.transaction.objectStore(STORE_NAME);
            }
            if (!store.indexNames.contains('parentId')) store.createIndex('parentId', 'parentId', { unique: false });
            if (!store.indexNames.contains('isPinned')) store.createIndex('isPinned', 'isPinned', { unique: false });
            if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(TOMBSTONE_STORE_NAME)) {
                database.createObjectStore(TOMBSTONE_STORE_NAME, { keyPath: 'syncId' });
            }
            if (!database.objectStoreNames.contains(SYNC_BASELINE_STORE_NAME)) {
                database.createObjectStore(SYNC_BASELINE_STORE_NAME, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(SYNC_CONFLICT_STORE_NAME)) {
                const conflicts = database.createObjectStore(SYNC_CONFLICT_STORE_NAME, { keyPath: 'id' });
                conflicts.createIndex('endpointKey', 'endpointKey', { unique: false });
            }
        };

        request.onerror = () => reject(request.error || new Error(t('dbOpenFailed')));
        request.onblocked = () => reject(new Error(t('dbBlocked')));
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => database.close();
            resolve(database);
        };
    });
}

function getAllItems() {
    return new Promise((resolve, reject) => {
        const request = state.db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function saveItem(item) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = item.id == null ? store.add(item) : store.put(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteItems(items) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
        const bookmarkStore = transaction.objectStore(STORE_NAME);
        const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const deletedAt = new Date().toISOString();
        const parentSyncIds = new Map(state.items.map((item) => [item.id, item.syncId]));
        items.forEach((item) => {
            bookmarkStore.delete(item.id);
            if (item.syncId) {
                tombstoneStore.put({
                    syncId: item.syncId,
                    deletedAt,
                    updatedAt: deletedAt,
                    modifiedBy: state.sync.deviceId,
                    item: createDeletedItemSnapshot(item, parentSyncIds),
                });
            }
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('deleteCanceled')));
    });
}

function clearDatabase(items = state.items) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
        const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const deletedAt = new Date().toISOString();
        const parentSyncIds = new Map(items.map((item) => [item.id, item.syncId]));
        transaction.objectStore(STORE_NAME).clear();
        items.forEach((item) => {
            if (item.syncId) {
                tombstoneStore.put({
                    syncId: item.syncId,
                    deletedAt,
                    updatedAt: deletedAt,
                    modifiedBy: state.sync.deviceId,
                    item: createDeletedItemSnapshot(item, parentSyncIds),
                });
            }
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('deleteCanceled')));
    });
}

function createDeletedItemSnapshot(item, parentSyncIds) {
    return {
        syncId: item.syncId,
        parentSyncId: item.parentId == null ? null : (parentSyncIds.get(item.parentId) || null),
        title: item.title,
        url: item.url,
        description: item.description || '',
        tags: parseTags(item.tags),
        isPinned: item.isPinned === true,
        createdAt: item.createdAt || item.updatedAt,
        updatedAt: item.updatedAt,
        modifiedBy: item.modifiedBy || state.sync.deviceId,
    };
}

function getSetting(key) {
    return new Promise((resolve, reject) => {
        const request = state.db.transaction(SETTINGS_STORE_NAME, 'readonly')
            .objectStore(SETTINGS_STORE_NAME)
            .get(key);
        request.onsuccess = () => resolve(request.result?.value ?? null);
        request.onerror = () => reject(request.error);
    });
}

function saveSetting(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        try {
            transaction.objectStore(SETTINGS_STORE_NAME).put({ key, value });
        } catch (error) {
            reject(error);
            return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function deleteSetting(key) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SETTINGS_STORE_NAME, 'readwrite');
        transaction.objectStore(SETTINGS_STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function getAllTombstones() {
    return new Promise((resolve, reject) => {
        const request = state.db.transaction(TOMBSTONE_STORE_NAME, 'readonly')
            .objectStore(TOMBSTONE_STORE_NAME)
            .getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function pruneExpiredRecycleBin() {
    const tombstones = await getAllTombstones();
    const cutoff = Date.now() - RECYCLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const expired = tombstones.filter((tombstone) => (
        tombstone.item
        && validDate(tombstone.deletedAt)
        && Date.parse(tombstone.deletedAt) < cutoff
    ));
    if (!expired.length) return 0;
    await purgeTombstonePayloads(expired.map((tombstone) => tombstone.syncId));
    return expired.length;
}

function purgeTombstonePayloads(syncIds) {
    const ids = new Set(syncIds);
    if (!ids.size) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(TOMBSTONE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const updatedAt = new Date().toISOString();
            request.result.filter((tombstone) => ids.has(tombstone.syncId)).forEach((tombstone) => {
                const minimal = { ...tombstone };
                delete minimal.item;
                minimal.updatedAt = updatedAt;
                minimal.payloadPurgedAt = updatedAt;
                minimal.modifiedBy = state.sync.deviceId;
                store.put(minimal);
            });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function getSyncBaseline(endpointKey) {
    return new Promise((resolve, reject) => {
        const request = state.db.transaction(SYNC_BASELINE_STORE_NAME, 'readonly')
            .objectStore(SYNC_BASELINE_STORE_NAME)
            .get(endpointKey);
        request.onsuccess = () => resolve(request.result?.dataset ?? null);
        request.onerror = () => reject(request.error);
    });
}

function saveSyncBaseline(endpointKey, dataset) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SYNC_BASELINE_STORE_NAME, 'readwrite');
        transaction.objectStore(SYNC_BASELINE_STORE_NAME).put({
            key: endpointKey,
            savedAt: new Date().toISOString(),
            dataset,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function pendingSyncBaselineKey(endpointKey) {
    return `${endpointKey}\u0000pending-remote`;
}

function getPendingSyncBaseline(endpointKey) {
    return getSyncBaseline(pendingSyncBaselineKey(endpointKey));
}

function savePendingSyncBaseline(endpointKey, dataset) {
    return saveSyncBaseline(pendingSyncBaselineKey(endpointKey), dataset);
}

function deleteSyncBaseline(key) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SYNC_BASELINE_STORE_NAME, 'readwrite');
        transaction.objectStore(SYNC_BASELINE_STORE_NAME).delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function getSyncConflicts(endpointKey) {
    return new Promise((resolve, reject) => {
        const request = state.db.transaction(SYNC_CONFLICT_STORE_NAME, 'readonly')
            .objectStore(SYNC_CONFLICT_STORE_NAME)
            .index('endpointKey')
            .getAll(endpointKey);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

async function replaceSyncConflicts(endpointKey, conflicts) {
    const existing = await getSyncConflicts(endpointKey);
    await new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SYNC_CONFLICT_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SYNC_CONFLICT_STORE_NAME);
        existing.forEach((conflict) => store.delete(conflict.id));
        conflicts.forEach((conflict) => store.put({
            ...conflict,
            id: `${endpointKey}\u0000${conflict.syncId}`,
            endpointKey,
        }));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function deleteSyncConflict(id) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(SYNC_CONFLICT_STORE_NAME, 'readwrite');
        transaction.objectStore(SYNC_CONFLICT_STORE_NAME).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

async function deleteSyncState(endpointKey) {
    const conflicts = await getSyncConflicts(endpointKey);
    await new Promise((resolve, reject) => {
        const transaction = state.db.transaction(
            [SYNC_BASELINE_STORE_NAME, SYNC_CONFLICT_STORE_NAME],
            'readwrite',
        );
        const baselineStore = transaction.objectStore(SYNC_BASELINE_STORE_NAME);
        baselineStore.delete(endpointKey);
        baselineStore.delete(pendingSyncBaselineKey(endpointKey));
        const conflictStore = transaction.objectStore(SYNC_CONFLICT_STORE_NAME);
        conflicts.forEach((conflict) => conflictStore.delete(conflict.id));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

async function initializeSyncIdentity() {
    const storedId = await getSetting(DEVICE_ID_KEY);
    state.sync.deviceId = typeof storedId === 'string' && storedId
        ? storedId
        : createUuid();
    if (storedId !== state.sync.deviceId) await saveSetting(DEVICE_ID_KEY, state.sync.deviceId);
}

async function ensureSyncMetadata() {
    const items = await getAllItems();
    const now = new Date().toISOString();
    let changed = false;
    items.forEach((item) => {
        if (typeof item.syncId !== 'string' || !item.syncId) {
            item.syncId = createUuid();
            changed = true;
        }
        if (!validDate(item.updatedAt)) {
            item.updatedAt = validDate(item.createdAt) ? item.createdAt : now;
            changed = true;
        }
        if (typeof item.modifiedBy !== 'string' || !item.modifiedBy) {
            item.modifiedBy = state.sync.deviceId;
            changed = true;
        }
    });
    if (!changed) return;

    await new Promise((resolve, reject) => {
        const transaction = state.db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        items.forEach((item) => store.put(item));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function addImportedRecords(records) {
    return new Promise((resolve, reject) => {
        if (!records.length) {
            resolve(0);
            return;
        }

        const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const insertedIds = new Map();
        const usedSyncIds = new Set(state.items.map((item) => item.syncId).filter(Boolean));
        let index = 0;
        let insertedCount = 0;

        transaction.oncomplete = () => resolve(insertedCount);
        transaction.onerror = () => reject(transaction.error || new Error(t('importTransactionFailed')));
        transaction.onabort = () => reject(transaction.error || new Error(t('importTransactionCanceled')));

        const addNext = () => {
            while (index < records.length && records[index].existingId != null) {
                const existing = records[index++];
                insertedIds.set(existing.sourceKey, existing.existingId);
            }
            if (index >= records.length) return;

            const source = records[index++];
            const preferredSyncId = typeof source.syncId === 'string' ? source.syncId : '';
            const syncId = preferredSyncId && !usedSyncIds.has(preferredSyncId)
                ? preferredSyncId
                : createUuid();
            usedSyncIds.add(syncId);
            const item = {
                syncId,
                title: source.title,
                url: source.url,
                description: source.description,
                tags: source.tags,
                parentId: source.parentKey ? (insertedIds.get(source.parentKey) ?? null) : null,
                isPinned: source.isPinned,
                collapsed: false,
                createdAt: source.createdAt,
                updatedAt: source.updatedAt,
                modifiedBy: typeof source.modifiedBy === 'string' && source.modifiedBy
                    ? source.modifiedBy
                    : state.sync.deviceId,
            };
            tombstoneStore.delete(syncId);
            const request = store.add(item);
            request.onsuccess = () => {
                insertedCount += 1;
                insertedIds.set(source.sourceKey, request.result);
                addNext();
            };
        };

        addNext();
    });
}

async function refreshData() {
    const [records, tombstones] = await Promise.all([getAllItems(), getAllTombstones()]);
    state.items = records.map(normalizeItem);
    state.recycleBin = tombstones
        .filter((tombstone) => tombstone.item && validDate(tombstone.deletedAt))
        .sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt));
    const recoverableIds = new Set(state.recycleBin.map((tombstone) => tombstone.syncId));
    state.recoverySelection = new Set(
        [...state.recoverySelection].filter((syncId) => recoverableIds.has(syncId)),
    );
    renderAll();
    ui.storageStatus.textContent = t('storageStatus', { count: state.items.length });
}
