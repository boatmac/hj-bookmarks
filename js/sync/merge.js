/* Sync dataset normalization, merge, and local application. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function createLocalSyncDataset() {
    const parentSyncIds = new Map(state.items.map((item) => [item.id, item.syncId]));
    const items = state.items.map((item) => ({
        syncId: item.syncId,
        parentSyncId: item.parentId == null ? null : (parentSyncIds.get(item.parentId) || null),
        title: item.title,
        url: item.url,
        description: item.description,
        tags: item.tags,
        isPinned: item.isPinned,
        createdAt: item.createdAt || item.updatedAt,
        updatedAt: item.updatedAt,
        modifiedBy: item.modifiedBy || state.sync.deviceId,
    }));
    const tombstones = (await getAllTombstones()).map(normalizeSyncTombstone).filter(Boolean);
    const ownDevice = {
        deviceId: state.sync.deviceId,
        name: state.sync.deviceName,
        updatedAt: state.sync.deviceNameUpdatedAt,
    };
    const devices = mergeSyncDeviceLists(
        state.sync.devices.filter((device) => device.deviceId !== state.sync.deviceId),
        [ownDevice],
    );
    state.sync.devices = devices;
    return {
        items: items.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        tombstones: tombstones.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        devices,
    };
}

function parseRemoteSyncDataset(input) {
    if (
        !input
        || input.format !== 'bookmark-manager-sync'
        || ![1, 2].includes(input.version)
        || !Array.isArray(input.items)
        || !Array.isArray(input.tombstones)
    ) {
        throw new Error(t('syncRemoteInvalid'));
    }
    try {
        const items = input.items.map(normalizeSyncItem);
        const tombstones = input.tombstones.map(normalizeSyncTombstone).filter(Boolean);
        const devices = Array.isArray(input.devices)
            ? input.devices.slice(0, 1000).map(normalizeSyncDevice).filter(Boolean)
            : [];
        return { items, tombstones, devices };
    } catch (error) {
        if (error?.message === t('syncRemoteInvalid')) throw error;
        throw new Error(t('syncRemoteInvalid'));
    }
}

function emptySyncDataset() {
    return { items: [], tombstones: [], devices: [] };
}

function normalizeStoredSyncDataset(input) {
    return {
        items: Array.isArray(input?.items) ? input.items.map(normalizeSyncItem) : [],
        tombstones: Array.isArray(input?.tombstones)
            ? input.tombstones.map(normalizeSyncTombstone).filter(Boolean)
            : [],
        devices: Array.isArray(input?.devices)
            ? input.devices.slice(0, 1000).map(normalizeSyncDevice).filter(Boolean)
            : [],
    };
}

function normalizeSyncDevice(input) {
    if (!input || typeof input.deviceId !== 'string' || !input.deviceId) return null;
    return {
        deviceId: input.deviceId,
        name: typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '',
        updatedAt: validDate(input.updatedAt) ? input.updatedAt : '1970-01-01T00:00:00.000Z',
    };
}

function mergeSyncDeviceLists(...lists) {
    const devices = new Map();
    lists.flat().forEach((input) => {
        const device = normalizeSyncDevice(input);
        if (!device) return;
        const current = devices.get(device.deviceId);
        if (
            !current
            || Date.parse(device.updatedAt) > Date.parse(current.updatedAt)
            || (
                device.updatedAt === current.updatedAt
                && device.name.localeCompare(current.name) > 0
            )
        ) devices.set(device.deviceId, device);
    });
    return [...devices.values()]
        .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
        .slice(0, 1000);
}

function normalizeSyncItem(input) {
    if (!input || typeof input !== 'object' || typeof input.syncId !== 'string' || !input.syncId) {
        throw new Error(t('syncRemoteInvalid'));
    }
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : t('untitled');
    const url = input.url ? normalizeUrl(input.url) : '';
    const updatedAt = validDate(input.updatedAt) ? input.updatedAt : '1970-01-01T00:00:00.000Z';
    return {
        syncId: input.syncId,
        parentSyncId: typeof input.parentSyncId === 'string' && input.parentSyncId ? input.parentSyncId : null,
        title,
        url,
        description: typeof input.description === 'string' ? input.description.trim() : '',
        tags: parseTags(input.tags),
        isPinned: input.isPinned === true,
        createdAt: validDate(input.createdAt) ? input.createdAt : updatedAt,
        updatedAt,
        modifiedBy: typeof input.modifiedBy === 'string' ? input.modifiedBy : '',
    };
}

function normalizeSyncTombstone(input) {
    if (!input || typeof input.syncId !== 'string' || !input.syncId || !validDate(input.deletedAt)) return null;
    let recoverableItem;
    if (input.item && typeof input.item === 'object') {
        try {
            recoverableItem = normalizeSyncItem({ ...input.item, syncId: input.syncId });
        } catch {
            recoverableItem = undefined;
        }
    }
    return {
        syncId: input.syncId,
        deletedAt: input.deletedAt,
        updatedAt: validDate(input.updatedAt) ? input.updatedAt : input.deletedAt,
        modifiedBy: typeof input.modifiedBy === 'string' ? input.modifiedBy : '',
        ...(recoverableItem ? { item: recoverableItem } : {}),
        ...(validDate(input.payloadPurgedAt) ? { payloadPurgedAt: input.payloadPurgedAt } : {}),
    };
}

function mergeSyncDatasets(local, remote) {
    const items = new Map();
    [...local.items, ...remote.items].forEach((item) => {
        const current = items.get(item.syncId);
        if (!current || compareSyncRecords(item, current, 'updatedAt') > 0) items.set(item.syncId, { ...item });
    });
    const tombstones = new Map();
    [...local.tombstones, ...remote.tombstones].forEach((tombstone) => {
        const current = tombstones.get(tombstone.syncId);
        if (!current || compareSyncRecords(tombstone, current, 'updatedAt') > 0) {
            tombstones.set(tombstone.syncId, { ...tombstone });
        }
    });

    const liveItems = [];
    const liveTombstones = [];
    const allSyncIds = new Set([...items.keys(), ...tombstones.keys()]);
    allSyncIds.forEach((syncId) => {
        const item = items.get(syncId);
        const tombstone = tombstones.get(syncId);
        if (!item) {
            if (tombstone) liveTombstones.push(tombstone);
            return;
        }
        if (tombstone && tombstoneWins(tombstone, item)) {
            liveTombstones.push(tombstone);
        } else {
            liveItems.push(item);
        }
    });

    sanitizeSyncHierarchy(liveItems);
    return {
        items: liveItems.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        tombstones: liveTombstones.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        devices: mergeSyncDeviceLists(local.devices || [], remote.devices || []),
    };
}

function threeWayMergeSyncDatasets(base, local, remote) {
    const baseEntities = createSyncEntityMap(base);
    const localEntities = createSyncEntityMap(local);
    const remoteEntities = createSyncEntityMap(remote);
    const syncIds = new Set([
        ...baseEntities.keys(),
        ...localEntities.keys(),
        ...remoteEntities.keys(),
    ]);
    const dataset = emptySyncDataset();
    const conflicts = [];

    syncIds.forEach((syncId) => {
        const baseEntity = baseEntities.get(syncId) || { kind: 'absent' };
        const localEntity = localEntities.get(syncId) || { kind: 'absent' };
        const remoteEntity = remoteEntities.get(syncId) || { kind: 'absent' };
        const localChanged = !syncEntitiesEquivalent(localEntity, baseEntity);
        const remoteChanged = !syncEntitiesEquivalent(remoteEntity, baseEntity);

        if (!localChanged && !remoteChanged) {
            appendSyncEntity(dataset, newerSyncEntity(localEntity, remoteEntity));
            return;
        }
        if (localChanged && !remoteChanged) {
            appendSyncEntity(dataset, localEntity);
            return;
        }
        if (!localChanged && remoteChanged) {
            appendSyncEntity(dataset, remoteEntity);
            return;
        }
        if (syncEntitiesEquivalent(localEntity, remoteEntity)) {
            appendSyncEntity(dataset, newerSyncEntity(localEntity, remoteEntity));
            return;
        }

        if (localEntity.kind === 'item' && remoteEntity.kind === 'item') {
            const fieldResult = mergeConcurrentSyncItems(
                baseEntity.kind === 'item' ? baseEntity.value : null,
                localEntity.value,
                remoteEntity.value,
            );
            if (!fieldResult.fields.length) {
                dataset.items.push(fieldResult.suggested);
                return;
            }
            conflicts.push({
                syncId,
                type: 'fields',
                base: cloneSyncEntity(baseEntity),
                local: cloneSyncEntity(localEntity),
                remote: cloneSyncEntity(remoteEntity),
                suggested: fieldResult.suggested,
                fields: fieldResult.fields,
            });
            dataset.items.push(fieldResult.suggested);
            return;
        }

        conflicts.push({
            syncId,
            type: 'delete-edit',
            base: cloneSyncEntity(baseEntity),
            local: cloneSyncEntity(localEntity),
            remote: cloneSyncEntity(remoteEntity),
            suggested: localEntity.kind === 'item'
                ? { ...localEntity.value }
                : remoteEntity.kind === 'item' ? { ...remoteEntity.value } : null,
            localRelated: localEntity.kind === 'item' && !localEntity.value.url
                ? collectSyncDescendants(local, syncId)
                : [],
            remoteRelated: remoteEntity.kind === 'item' && !remoteEntity.value.url
                ? collectSyncDescendants(remote, syncId)
                : [],
            fields: [],
        });
        appendSyncEntity(dataset, localEntity.kind === 'absent' ? remoteEntity : localEntity);
    });

    dataset.devices = mergeSyncDeviceLists(
        base?.devices || [],
        local?.devices || [],
        remote?.devices || [],
    );
    sanitizeSyncHierarchy(dataset.items);
    dataset.items.sort((left, right) => left.syncId.localeCompare(right.syncId));
    dataset.tombstones.sort((left, right) => left.syncId.localeCompare(right.syncId));
    return { dataset, conflicts };
}

function collectSyncDescendants(dataset, parentSyncId) {
    const result = [];
    const queue = [parentSyncId];
    const visited = new Set(queue);
    while (queue.length) {
        const current = queue.shift();
        (dataset?.items || []).forEach((item) => {
            if (item.parentSyncId !== current || visited.has(item.syncId)) return;
            visited.add(item.syncId);
            result.push({ ...item, tags: [...item.tags] });
            if (!item.url) queue.push(item.syncId);
        });
    }
    return result;
}

function createSyncEntityMap(dataset) {
    const entities = new Map();
    (dataset?.items || []).forEach((item) => entities.set(item.syncId, { kind: 'item', value: item }));
    (dataset?.tombstones || []).forEach((tombstone) => {
        const current = entities.get(tombstone.syncId);
        if (!current || current.kind !== 'item' || tombstoneWins(tombstone, current.value)) {
            entities.set(tombstone.syncId, { kind: 'deleted', value: tombstone });
        }
    });
    return entities;
}

function syncEntitiesEquivalent(left, right) {
    if (left.kind !== right.kind) return false;
    if (left.kind === 'absent' || left.kind === 'deleted') return true;
    return syncItemFields().every((field) => syncFieldValuesEqual(left.value[field], right.value[field]));
}

function syncItemFields() {
    return ['title', 'url', 'description', 'tags', 'isPinned', 'parentSyncId'];
}

function syncFieldValuesEqual(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
        const leftValues = parseTags(left).slice().sort();
        const rightValues = parseTags(right).slice().sort();
        return JSON.stringify(leftValues) === JSON.stringify(rightValues);
    }
    return (left ?? null) === (right ?? null);
}

function newerSyncEntity(left, right) {
    if (left.kind === 'absent') return right;
    if (right.kind === 'absent') return left;
    if (left.kind !== right.kind) return left;
    const dateField = 'updatedAt';
    return compareSyncRecords(left.value, right.value, dateField) >= 0 ? left : right;
}

function appendSyncEntity(dataset, entity) {
    if (entity.kind === 'item') dataset.items.push({ ...entity.value, tags: [...entity.value.tags] });
    if (entity.kind === 'deleted') dataset.tombstones.push({ ...entity.value });
}

function cloneSyncEntity(entity) {
    if (entity.kind === 'absent') return { kind: 'absent' };
    return {
        kind: entity.kind,
        value: {
            ...entity.value,
            ...(entity.kind === 'item' ? { tags: [...entity.value.tags] } : {}),
        },
    };
}

function mergeConcurrentSyncItems(base, local, remote) {
    const suggested = {
        ...local,
        tags: [...local.tags],
        createdAt: earliestSyncDate(local.createdAt, remote.createdAt),
    };
    const conflictFields = [];

    for (const field of syncItemFields()) {
        if (field === 'tags') {
            suggested.tags = mergeSyncTagSets(base?.tags || [], local.tags, remote.tags);
            continue;
        }
        const baseValue = base ? base[field] : undefined;
        const localValue = local[field];
        const remoteValue = remote[field];
        if (syncFieldValuesEqual(localValue, remoteValue)) {
            suggested[field] = localValue;
        } else if (base && syncFieldValuesEqual(localValue, baseValue)) {
            suggested[field] = remoteValue;
        } else if (base && syncFieldValuesEqual(remoteValue, baseValue)) {
            suggested[field] = localValue;
        } else {
            suggested[field] = localValue;
            conflictFields.push(field);
        }
    }

    const newest = compareSyncRecords(local, remote, 'updatedAt') >= 0 ? local : remote;
    suggested.updatedAt = newest.updatedAt;
    suggested.modifiedBy = newest.modifiedBy;
    return { suggested, fields: conflictFields };
}

function mergeSyncTagSets(base, local, remote) {
    const baseSet = new Set(parseTags(base));
    const localSet = new Set(parseTags(local));
    const remoteSet = new Set(parseTags(remote));
    const allTags = new Set([...baseSet, ...localSet, ...remoteSet]);
    const result = [];
    allTags.forEach((tag) => {
        const inBase = baseSet.has(tag);
        const inLocal = localSet.has(tag);
        const inRemote = remoteSet.has(tag);
        if (inLocal === inRemote ? inLocal : inLocal === inBase ? inRemote : inLocal) result.push(tag);
    });
    return result.sort((left, right) => left.localeCompare(right, currentLocale()));
}

function earliestSyncDate(left, right) {
    if (!validDate(left)) return right;
    if (!validDate(right)) return left;
    return Date.parse(left) <= Date.parse(right) ? left : right;
}

function compareSyncRecords(left, right, dateField) {
    const timeDifference = Date.parse(left[dateField]) - Date.parse(right[dateField]);
    if (timeDifference) return timeDifference;
    const deviceDifference = String(left.modifiedBy || '').localeCompare(String(right.modifiedBy || ''));
    if (deviceDifference) return deviceDifference;
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function tombstoneWins(tombstone, item) {
    const timeDifference = Date.parse(tombstone.deletedAt) - Date.parse(item.updatedAt);
    if (timeDifference) return timeDifference > 0;
    return String(tombstone.modifiedBy || '').localeCompare(String(item.modifiedBy || '')) >= 0;
}

function sanitizeSyncHierarchy(items) {
    const byId = new Map(items.map((item) => [item.syncId, item]));
    items.forEach((item) => {
        const parent = item.parentSyncId ? byId.get(item.parentSyncId) : null;
        if (!parent || parent.url || parent.syncId === item.syncId) item.parentSyncId = null;
    });

    const visited = new Set();
    const visiting = new Set();
    const visit = (item) => {
        if (visited.has(item.syncId)) return;
        if (visiting.has(item.syncId)) {
            item.parentSyncId = null;
            return;
        }
        visiting.add(item.syncId);
        const parent = item.parentSyncId ? byId.get(item.parentSyncId) : null;
        if (parent) visit(parent);
        visiting.delete(item.syncId);
        visited.add(item.syncId);
    };
    items.forEach(visit);
}

function replaceLocalSyncDataset(dataset) {
    const mergedDevices = mergeSyncDeviceLists(state.sync.devices, dataset.devices || []);
    state.sync.devices = mergeSyncDeviceLists(
        mergedDevices.filter((device) => device.deviceId !== state.sync.deviceId),
        [{
            deviceId: state.sync.deviceId,
            name: state.sync.deviceName,
            updatedAt: state.sync.deviceNameUpdatedAt,
        }],
    );
    const existingBySyncId = new Map(state.items.map((item) => [item.syncId, item]));
    const liveSyncIds = new Set(dataset.items.map((item) => item.syncId));
    const numericIds = new Map(
        state.items
            .filter((item) => liveSyncIds.has(item.syncId))
            .map((item) => [item.syncId, item.id]),
    );

    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
        const bookmarkStore = transaction.objectStore(STORE_NAME);
        const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const localRecords = [];
        let upsertIndex = 0;
        let parentIndex = 0;

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));

        state.items
            .filter((item) => !liveSyncIds.has(item.syncId))
            .forEach((item) => bookmarkStore.delete(item.id));

        const addTombstones = () => {
            dataset.tombstones.forEach((tombstone) => tombstoneStore.put(tombstone));
        };
        const updateParents = () => {
            if (parentIndex >= localRecords.length) {
                addTombstones();
                return;
            }
            const record = localRecords[parentIndex++];
            record.parentId = record.parentSyncId ? (numericIds.get(record.parentSyncId) || null) : null;
            delete record.parentSyncId;
            const request = bookmarkStore.put(record);
            request.onsuccess = updateParents;
        };
        const upsertItems = () => {
            if (upsertIndex >= dataset.items.length) {
                updateParents();
                return;
            }
            const item = dataset.items[upsertIndex++];
            const existing = existingBySyncId.get(item.syncId);
            const record = {
                ...(existing ? { id: existing.id } : {}),
                syncId: item.syncId,
                parentSyncId: item.parentSyncId,
                parentId: null,
                title: item.title,
                url: item.url,
                description: item.description,
                tags: item.tags,
                isPinned: item.isPinned,
                collapsed: existing?.collapsed === true,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                modifiedBy: item.modifiedBy,
            };
            const request = existing ? bookmarkStore.put(record) : bookmarkStore.add(record);
            request.onsuccess = () => {
                record.id = existing?.id ?? request.result;
                numericIds.set(item.syncId, record.id);
                localRecords.push(record);
                upsertItems();
            };
        };

        const clearTombstones = tombstoneStore.clear();
        clearTombstones.onsuccess = upsertItems;
    });
}
