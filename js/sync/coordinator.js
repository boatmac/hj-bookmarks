/* Cloud sync lifecycle, credentials, and conflict UI. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function initializeWebDavSync() {
    renderSyncSettings();
    if (!state.sync.supported) return;
    try {
        const preferences = await getSetting(SYNC_PREFERENCES_KEY);
        if (preferences && typeof preferences === 'object') {
            state.sync.endpoint = typeof preferences.endpoint === 'string' ? preferences.endpoint : '';
            state.sync.username = typeof preferences.username === 'string' ? preferences.username : '';
            state.sync.koofrMountId = typeof preferences.koofrMountId === 'string' ? preferences.koofrMountId : '';
            state.sync.koofrMountName = typeof preferences.koofrMountName === 'string' ? preferences.koofrMountName : '';
            state.sync.koofrMountUser = typeof preferences.koofrMountUser === 'string' ? preferences.koofrMountUser : '';
            state.sync.createDirectory = preferences.createDirectory !== false;
            state.sync.automatic = preferences.automatic === true;
            state.sync.lastSyncAt = validDate(preferences.lastSyncAt) ? preferences.lastSyncAt : '';
        }
        ui.syncEndpointInput.value = state.sync.endpoint;
        ui.syncUsernameInput.value = state.sync.username;
        restoreSessionSyncCredentials();
        state.sync.hasBaseline = state.sync.endpoint
            ? Boolean(await getSyncBaseline(syncEndpointKey()))
            : false;
        await loadSyncConflicts();
    } catch (error) {
        console.error('Unable to restore WebDAV sync settings:', error);
        state.sync.error = error?.message || String(error);
    }
    renderSyncSettings();
    renderConflictBanner();
    if (
        state.sync.sessionCredentialsRestored
        && state.sync.automatic
        && !state.sync.conflicts.length
        && state.sync.password
        && state.sync.passphrase.length >= 8
    ) {
        window.setTimeout(() => runWebDavSync({ notify: false }), 180);
    }
}

function syncEndpointKey(endpoint = state.sync.endpoint, username = state.sync.username) {
    return `${String(username || '').trim().toLocaleLowerCase('en-US')}\u0000${String(endpoint || '').trim()}`;
}

function restoreSessionSyncCredentials() {
    if (!isPageReload()) {
        safeSessionStorageRemove(SYNC_SESSION_CREDENTIALS_KEY);
        return false;
    }
    const raw = safeSessionStorageGet(SYNC_SESSION_CREDENTIALS_KEY);
    if (!raw) return false;
    try {
        const saved = JSON.parse(raw);
        if (saved?.version !== 1 || saved.endpointKey !== syncEndpointKey()) {
            safeSessionStorageRemove(SYNC_SESSION_CREDENTIALS_KEY);
            return false;
        }
        state.sync.password = typeof saved.password === 'string' ? saved.password : '';
        state.sync.passphrase = typeof saved.passphrase === 'string' ? saved.passphrase : '';
        state.sync.rememberSession = true;
        state.sync.sessionCredentialsRestored = Boolean(state.sync.password || state.sync.passphrase);
        ui.syncPasswordInput.value = state.sync.password;
        ui.syncPassphraseInput.value = state.sync.passphrase;
        return state.sync.sessionCredentialsRestored;
    } catch {
        safeSessionStorageRemove(SYNC_SESSION_CREDENTIALS_KEY);
        return false;
    }
}

function isPageReload() {
    const navigationEntry = performance.getEntriesByType?.('navigation')?.[0];
    if (navigationEntry?.type) return navigationEntry.type === 'reload';
    return performance.navigation?.type === 1;
}

function saveSessionSyncCredentials() {
    if (!state.sync.rememberSession) return false;
    return safeSessionStorageSet(SYNC_SESSION_CREDENTIALS_KEY, JSON.stringify({
        version: 1,
        endpointKey: syncEndpointKey(),
        password: state.sync.password,
        passphrase: state.sync.passphrase,
        savedAt: new Date().toISOString(),
    }));
}

function clearSessionSyncCredentials() {
    safeSessionStorageRemove(SYNC_SESSION_CREDENTIALS_KEY);
    state.sync.sessionCredentialsRestored = false;
}

async function loadSyncConflicts() {
    const endpointKey = syncEndpointKey();
    if (!state.sync.endpoint) {
        state.sync.conflicts = [];
        state.sync.conflictEndpointKey = '';
    } else {
        state.sync.conflicts = await getSyncConflicts(endpointKey);
        state.sync.conflictEndpointKey = endpointKey;
    }
    state.sync.conflicts.sort((left, right) => Date.parse(left.detectedAt) - Date.parse(right.detectedAt));
    state.sync.conflictIndex = Math.min(
        state.sync.conflictIndex,
        Math.max(0, state.sync.conflicts.length - 1),
    );
    state.sync.conflictSelections = {};
    renderConflictBanner();
    renderSyncSettings();
}

function handleConflictCenterMenu() {
    closeExportMenu();
    if (state.sync.conflicts.length) {
        openConflictCenter();
    } else {
        showToast(t('noPendingConflicts'));
    }
}

function renderConflictBanner() {
    if (!ui.conflictBanner) return;
    const count = state.sync.conflicts.length;
    ui.conflictMenuStatus.textContent = count
        ? t('syncMenuConflicts', { count })
        : t('noPendingConflicts');
    ui.conflictCenterMenuButton.classList.toggle('has-conflicts', count > 0);
    ui.conflictBanner.classList.toggle('hidden', count === 0);
    if (!count) return;
    ui.conflictBannerTitle.textContent = t('conflictDetectedBanner', { count });
    ui.conflictBannerDetail.textContent = t('conflictBannerDetail');
}

function openConflictForItem(item) {
    if (!item?.syncId) return false;
    const index = state.sync.conflicts.findIndex((conflict) => conflict.syncId === item.syncId);
    if (index < 0) return false;
    state.sync.conflictIndex = index;
    openConflictCenter();
    return true;
}

function openConflictCenter() {
    if (!state.sync.conflicts.length) return;
    if (ui.syncDialog.open) ui.syncDialog.close();
    state.sync.conflictIndex = Math.min(
        state.sync.conflictIndex,
        state.sync.conflicts.length - 1,
    );
    renderConflictCenter();
    if (!ui.conflictDialog.open) ui.conflictDialog.showModal();
}

function closeConflictCenter() {
    if (ui.conflictDialog.open) ui.conflictDialog.close();
}

function navigateConflict(offset) {
    const count = state.sync.conflicts.length;
    if (!count) return;
    state.sync.conflictIndex = (state.sync.conflictIndex + offset + count) % count;
    renderConflictCenter();
}

function renderConflictCenter() {
    const conflicts = state.sync.conflicts;
    if (!conflicts.length) {
        closeConflictCenter();
        renderConflictBanner();
        return;
    }
    const conflict = conflicts[state.sync.conflictIndex] || conflicts[0];
    const localItem = conflict.local?.kind === 'item' ? conflict.local.value : null;
    const remoteItem = conflict.remote?.kind === 'item' ? conflict.remote.value : null;
    const displayItem = localItem || remoteItem || (conflict.base?.kind === 'item' ? conflict.base.value : null);
    const isFolderConflict = displayItem ? !displayItem.url : false;

    ui.conflictProgressLabel.textContent = `${state.sync.conflictIndex + 1} / ${conflicts.length}`;
    ui.conflictDetectedTime.textContent = formatConflictTime(conflict.detectedAt);
    ui.conflictKindLabel.textContent = t(isFolderConflict ? 'conflictKindFolder' : 'conflictKindBookmark');
    ui.conflictItemTitle.textContent = displayItem?.title || t('untitled');
    ui.conflictExplanation.textContent = t(
        conflict.type === 'delete-edit' ? 'conflictDeleteEditExplanation' : 'conflictFieldsExplanation',
    );

    renderConflictVersion(ui.conflictLocalSummary, conflict.local);
    renderConflictVersion(ui.conflictRemoteSummary, conflict.remote);
    ui.conflictLocalDevice.textContent = formatConflictDevice(conflict.local);
    ui.conflictRemoteDevice.textContent = formatConflictDevice(conflict.remote);

    const fieldConflict = conflict.type === 'fields';
    ui.fieldMergeSection.classList.toggle('hidden', !fieldConflict);
    ui.applyFieldMergeButton.classList.toggle('hidden', !fieldConflict);
    ui.keepBothButton.classList.toggle(
        'hidden',
        !(
            localItem
            && remoteItem
            && localItem.url
            && remoteItem.url
        ),
    );
    ui.keepLocalButton.textContent = t(localItem ? 'keepLocal' : 'keepDeletion');
    ui.keepRemoteButton.textContent = t(remoteItem ? 'keepRemote' : 'keepDeletion');
    ui.conflictPreviousButton.disabled = conflicts.length < 2;
    ui.conflictNextButton.disabled = conflicts.length < 2;

    ui.conflictFields.replaceChildren();
    if (fieldConflict) {
        const selections = state.sync.conflictSelections[conflict.id]
            || Object.fromEntries(conflict.fields.map((field) => [field, 'local']));
        state.sync.conflictSelections[conflict.id] = selections;
        conflict.fields.forEach((field) => {
            ui.conflictFields.append(createConflictFieldRow(conflict, field, selections));
        });
    }
}

function renderConflictVersion(container, entity) {
    container.replaceChildren();
    if (!entity || entity.kind !== 'item') {
        container.append(createElement('p', 'deleted-version', t('conflictDeletedVersion')));
        return;
    }
    const item = entity.value;
    const fields = [
        ['title', item.title],
        ['url', item.url],
        ['description', item.description],
        ['tags', item.tags],
        ['parentSyncId', item.parentSyncId],
        ['isPinned', item.isPinned],
    ];
    fields.forEach(([field, value]) => {
        const row = createElement('div', 'version-field');
        row.append(
            createElement('span', '', conflictFieldLabel(field)),
            createElement('strong', '', formatConflictValue(field, value)),
        );
        container.append(row);
    });
}

function createConflictFieldRow(conflict, field, selections) {
    const row = createElement('div', 'conflict-field-row');
    const label = conflictFieldLabel(field);
    row.append(createElement('strong', 'conflict-field-name', label));
    const options = createElement('div', 'conflict-field-options');
    const localButton = createElement(
        'button',
        `conflict-value-option${selections[field] === 'local' ? ' selected' : ''}`,
        formatConflictValue(field, conflict.local.value[field]),
    );
    localButton.type = 'button';
    localButton.setAttribute('aria-label', t('conflictChooseLocal', { field: label }));
    localButton.dataset.side = 'local';
    localButton.addEventListener('click', () => {
        selections[field] = 'local';
        renderConflictCenter();
    });
    const remoteButton = createElement(
        'button',
        `conflict-value-option${selections[field] === 'remote' ? ' selected' : ''}`,
        formatConflictValue(field, conflict.remote.value[field]),
    );
    remoteButton.type = 'button';
    remoteButton.setAttribute('aria-label', t('conflictChooseRemote', { field: label }));
    remoteButton.dataset.side = 'remote';
    remoteButton.addEventListener('click', () => {
        selections[field] = 'remote';
        renderConflictCenter();
    });
    options.append(localButton, remoteButton);
    row.append(options);
    return row;
}

function conflictFieldLabel(field) {
    const labels = {
        title: 'conflictFieldTitle',
        url: 'conflictFieldUrl',
        description: 'conflictFieldDescription',
        tags: 'conflictFieldTags',
        isPinned: 'conflictFieldFavorite',
        parentSyncId: 'conflictFieldParent',
    };
    return t(labels[field] || field);
}

function formatConflictValue(field, value) {
    if (field === 'tags') return parseTags(value).join(', ') || t('conflictValueEmpty');
    if (field === 'isPinned') return t(value ? 'conflictValueFavorite' : 'conflictValueNotFavorite');
    if (field === 'parentSyncId') {
        if (!value) return t('conflictRootFolder');
        const folder = state.items.find((item) => item.syncId === value);
        return folder?.title || String(value).slice(0, 8);
    }
    return String(value || '').trim() || t('conflictValueEmpty');
}

function formatConflictDevice(entity) {
    if (!entity || entity.kind === 'absent') return '';
    const value = entity.value;
    const time = formatConflictTime(entity.kind === 'deleted' ? value.deletedAt : value.updatedAt);
    const device = String(value.modifiedBy || '').slice(0, 8);
    return [
        device ? t('conflictDeviceId', { device }) : '',
        time ? t('conflictModifiedAt', { time }) : '',
    ].filter(Boolean).join(' · ');
}

function formatConflictTime(value) {
    if (!validDate(value)) return '';
    return new Intl.DateTimeFormat(currentLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

async function resolveCurrentConflict(strategy) {
    const conflict = state.sync.conflicts[state.sync.conflictIndex];
    if (!conflict) return;
    const endpointKey = conflict.endpointKey;
    await flushBackupBeforeDestructiveChange();

    if (strategy === 'both') {
        if (conflict.local?.kind === 'item') {
            await restoreResolvedSyncItems([
                conflict.local.value,
                ...(conflict.localRelated || []),
            ]);
        }
        if (conflict.remote?.kind === 'item') {
            const duplicate = {
                ...conflict.remote.value,
                syncId: createUuid(),
                title: `${conflict.remote.value.title} (${t('conflictCopySuffix')})`,
                parentSyncId: conflict.remote.value.parentSyncId,
                tags: [...conflict.remote.value.tags],
            };
            await restoreResolvedSyncItems([duplicate]);
        }
    } else {
        let entity = strategy === 'remote' ? conflict.remote : conflict.local;
        let related = strategy === 'remote' ? conflict.remoteRelated : conflict.localRelated;
        if (strategy === 'merge') {
            const selections = state.sync.conflictSelections[conflict.id] || {};
            const item = {
                ...conflict.suggested,
                tags: [...conflict.suggested.tags],
            };
            conflict.fields.forEach((field) => {
                const source = selections[field] === 'remote' ? conflict.remote.value : conflict.local.value;
                item[field] = Array.isArray(source[field]) ? [...source[field]] : source[field];
            });
            entity = { kind: 'item', value: item };
            related = [];
        }
        await applyResolvedConflictEntity(conflict.syncId, entity, related || []);
    }

    await deleteSyncConflict(conflict.id);
    state.sync.conflicts = state.sync.conflicts.filter((item) => item.id !== conflict.id);
    delete state.sync.conflictSelections[conflict.id];
    state.sync.conflictIndex = Math.min(
        state.sync.conflictIndex,
        Math.max(0, state.sync.conflicts.length - 1),
    );
    await refreshData();
    scheduleAutoBackup();
    renderConflictBanner();
    renderSyncSettings();

    if (state.sync.conflicts.length) {
        renderConflictCenter();
        showToast(t('conflictResolved'));
        return;
    }

    const pendingRemote = await getPendingSyncBaseline(endpointKey);
    if (pendingRemote) {
        await saveSyncBaseline(endpointKey, pendingRemote);
        state.sync.hasBaseline = true;
    }
    await deleteSyncBaseline(pendingSyncBaselineKey(endpointKey));
    closeConflictCenter();
    showToast(t('allConflictsResolved'));
    if (state.sync.password && state.sync.passphrase) {
        window.setTimeout(() => runWebDavSync({ notify: true }), 120);
    }
}

async function applyResolvedConflictEntity(syncId, entity, relatedItems) {
    if (entity?.kind === 'item') {
        await restoreResolvedSyncItems([
            { ...entity.value, syncId },
            ...relatedItems,
        ]);
        return;
    }
    const existing = state.items.find((item) => item.syncId === syncId);
    if (existing) {
        const descendantIds = isFolder(existing) ? getAllDescendantIds(existing.id) : [];
        const deletingIds = new Set([existing.id, ...descendantIds]);
        await deleteItems(state.items.filter((item) => deletingIds.has(item.id)));
    } else {
        await putResolvedTombstone(syncId);
    }
}

function putResolvedTombstone(syncId) {
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction(TOMBSTONE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const request = store.get(syncId);
        request.onsuccess = () => {
            const now = new Date().toISOString();
            store.put({
                ...request.result,
                syncId,
                deletedAt: request.result?.deletedAt || now,
                updatedAt: now,
                modifiedBy: state.sync.deviceId,
            });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
    });
}

function restoreResolvedSyncItems(items) {
    if (!items.length) return Promise.resolve();
    let uniqueItems = [...new Map(items.map((item) => [item.syncId, { ...item, tags: [...item.tags] }])).values()];
    const parentSyncIds = new Map(state.items.map((item) => [item.id, item.syncId]));
    const hierarchy = new Map(state.items.map((item) => [item.syncId, {
        syncId: item.syncId,
        url: item.url,
        parentSyncId: item.parentId == null ? null : (parentSyncIds.get(item.parentId) || null),
    }]));
    uniqueItems.forEach((item) => hierarchy.set(item.syncId, {
        syncId: item.syncId,
        url: item.url,
        parentSyncId: item.parentSyncId || null,
    }));
    const hierarchyItems = [...hierarchy.values()];
    sanitizeSyncHierarchy(hierarchyItems);
    const safeParents = new Map(hierarchyItems.map((item) => [item.syncId, item.parentSyncId]));
    uniqueItems = uniqueItems.map((item) => ({
        ...item,
        parentSyncId: safeParents.get(item.syncId) || null,
    }));
    const existingBySyncId = new Map(state.items.map((item) => [item.syncId, item]));
    const numericIds = new Map(state.items.map((item) => [item.syncId, item.id]));
    const now = new Date().toISOString();
    return new Promise((resolve, reject) => {
        const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
        const bookmarkStore = transaction.objectStore(STORE_NAME);
        const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
        const records = [];
        let upsertIndex = 0;
        let parentIndex = 0;

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));

        const updateParents = () => {
            if (parentIndex >= records.length) return;
            const record = records[parentIndex++];
            record.parentId = record.parentSyncId ? (numericIds.get(record.parentSyncId) || null) : null;
            delete record.parentSyncId;
            const request = bookmarkStore.put(record);
            request.onsuccess = updateParents;
        };
        const upsertNext = () => {
            if (upsertIndex >= uniqueItems.length) {
                updateParents();
                return;
            }
            const item = uniqueItems[upsertIndex++];
            const existing = existingBySyncId.get(item.syncId);
            const record = {
                ...(existing ? { id: existing.id } : {}),
                syncId: item.syncId,
                parentSyncId: item.parentSyncId || null,
                parentId: null,
                title: item.title,
                url: item.url,
                description: item.description || '',
                tags: parseTags(item.tags),
                isPinned: item.isPinned === true,
                collapsed: existing?.collapsed === true,
                createdAt: validDate(item.createdAt) ? item.createdAt : now,
                updatedAt: now,
                modifiedBy: state.sync.deviceId,
            };
            tombstoneStore.delete(item.syncId);
            const request = existing ? bookmarkStore.put(record) : bookmarkStore.add(record);
            request.onsuccess = () => {
                record.id = existing?.id ?? request.result;
                numericIds.set(item.syncId, record.id);
                records.push(record);
                upsertNext();
            };
        };
        upsertNext();
    });
}

async function saveSyncPreferences() {
    try {
        await saveSetting(SYNC_PREFERENCES_KEY, {
            endpoint: state.sync.endpoint,
            username: state.sync.username,
            koofrMountId: state.sync.koofrMountId,
            koofrMountName: state.sync.koofrMountName,
            koofrMountUser: state.sync.koofrMountUser,
            createDirectory: state.sync.createDirectory,
            automatic: state.sync.automatic,
            lastSyncAt: state.sync.lastSyncAt,
        });
        return true;
    } catch (error) {
        console.warn('Unable to save WebDAV sync preferences:', error);
        return false;
    }
}

function openSyncDialog() {
    closeExportMenu();
    ui.syncEndpointInput.value = state.sync.endpoint;
    ui.syncUsernameInput.value = state.sync.username;
    ui.syncPasswordInput.value = state.sync.password;
    ui.syncPassphraseInput.value = state.sync.passphrase;
    renderSyncSettings();
    ui.syncDialog.showModal();
}

function closeSyncDialog() {
    if (state.sync.running) {
        cancelWebDavSync();
        return;
    }
    updateSyncSecretsFromForm();
    saveSyncPreferences();
    if (ui.syncDialog.open) ui.syncDialog.close();
}

function cancelWebDavSync() {
    if (!state.sync.running) return;
    state.sync.cancelRequested = true;
    state.sync.pending = false;
    state.sync.phase = 'syncPhaseCanceling';
    window.clearTimeout(state.sync.timer);
    state.sync.abortController?.abort();
    renderSyncSettings();
}

function updateSyncSecretsFromForm() {
    const previousFingerprint = syncSessionFingerprint();
    const previousEndpoint = state.sync.endpoint;
    const previousEndpointKey = syncEndpointKey();
    state.sync.endpoint = ui.syncEndpointInput.value.trim();
    state.sync.username = ui.syncUsernameInput.value.trim();
    state.sync.password = ui.syncPasswordInput.value;
    state.sync.passphrase = ui.syncPassphraseInput.value;
    const nextEndpointKey = syncEndpointKey();
    if (previousEndpoint !== state.sync.endpoint) {
        state.sync.koofrMountId = '';
        state.sync.koofrMountName = '';
        state.sync.koofrMountUser = '';
    }
    if (previousEndpointKey !== nextEndpointKey) {
        state.sync.hasBaseline = false;
        state.sync.conflicts = [];
        state.sync.conflictEndpointKey = nextEndpointKey;
        state.sync.conflictIndex = 0;
        state.sync.conflictSelections = {};
        renderConflictBanner();
    }
    const credentialsChanged = previousFingerprint !== syncSessionFingerprint();
    if (credentialsChanged) state.sync.sessionCredentialsRestored = false;
    if (state.sync.unlocked && credentialsChanged) state.sync.unlocked = false;
    if (state.sync.rememberSession) saveSessionSyncCredentials();
    state.sync.error = '';
    renderSyncSettings();
}

function syncSessionFingerprint() {
    return [
        state.sync.endpoint,
        state.sync.username,
        state.sync.password,
        state.sync.passphrase,
    ].join('\u0000');
}

function renderSyncSettings() {
    if (!ui.syncMenuStatus) return;
    const sync = state.sync;
    let status = 'ready';
    if (!sync.supported) status = 'unsupported';
    else if (sync.running) status = 'running';
    else if (sync.conflicts.length) status = 'conflict';
    else if (sync.error) status = 'error';
    else if (!sync.endpoint) status = 'not-configured';
    else if (!sync.unlocked && sync.passphrase.length >= 8 && (!sync.username || sync.password)) status = 'credentials-ready';
    else if (!sync.unlocked) status = 'locked';

    const statusContent = {
        unsupported: [t('syncUnsupportedTitle'), t('syncUnsupportedDetail'), t('syncMenuUnsupported')],
        running: [t('syncRunningTitle'), sync.phase ? t(sync.phase) : t('syncRunningDetail'), t('syncMenuRunning')],
        error: [t('syncErrorTitle'), t('syncErrorDetail', { message: sync.error }), t('syncMenuError')],
        conflict: [
            t('syncConflictStatusTitle'),
            t('syncConflictStatusDetail', { count: sync.conflicts.length }),
            t('syncMenuConflicts', { count: sync.conflicts.length }),
        ],
        'not-configured': [t('syncNotConfiguredTitle'), t('syncNotConfiguredDetail'), t('syncMenuNotConfigured')],
        locked: [t('syncLockedTitle'), t('syncLockedDetail'), t('syncMenuLocked')],
        'credentials-ready': [
            t('syncCredentialsReadyTitle'),
            t('syncCredentialsReadyDetail'),
            t('syncMenuCredentialsReady'),
        ],
        ready: [
            t('syncReadyTitle'),
            t(sync.provider === 'koofr' ? 'syncReadyKoofrDetail' : 'syncReadyDetail'),
            t('syncMenuReady', { time: formatBackupTime(sync.lastSyncAt, true) }),
        ],
    }[status];

    ui.syncStatusCard.dataset.state = status;
    ui.syncSettingsButton.dataset.state = status;
    ui.exportMenu.dataset.syncState = status;
    ui.syncStatusTitle.textContent = statusContent[0];
    ui.syncStatusDetail.textContent = statusContent[1];
    ui.syncMenuStatus.textContent = statusContent[2];
    ui.lastSyncValue.textContent = formatBackupTime(sync.lastSyncAt) || t('syncLastNever');
    ui.conflictProtectionValue.textContent = t(
        sync.hasBaseline ? 'conflictBaselineReady' : 'conflictBaselinePending',
    );
    ui.autoCreateDirectoryToggle.checked = sync.createDirectory;
    ui.autoCreateDirectoryToggle.disabled = !sync.supported || sync.running;
    ui.autoSyncToggle.checked = sync.automatic;
    ui.autoSyncToggle.disabled = !sync.supported || sync.running;
    ui.rememberSessionCredentialsToggle.checked = sync.rememberSession;
    ui.rememberSessionCredentialsToggle.disabled = !sync.supported || sync.running;
    ui.syncNowButton.disabled = !sync.supported || sync.running;
    ui.syncNowButton.textContent = t(sync.conflicts.length ? 'reviewConflicts' : 'syncNow');
    ui.syncDialogCancelButton.textContent = t(sync.running ? 'cancelSync' : 'close');
    ui.syncDialogCloseButton.setAttribute('aria-label', t(sync.running ? 'cancelSync' : 'close'));
    ui.syncDialogCloseButton.title = t(sync.running ? 'cancelSync' : 'close');
    ui.syncEndpointInput.disabled = sync.running;
    ui.syncUsernameInput.disabled = sync.running;
    ui.syncPasswordInput.disabled = sync.running;
    ui.syncPassphraseInput.disabled = sync.running;
    ui.disconnectSyncButton.classList.toggle('hidden', !sync.endpoint && !sync.username);
    ui.disconnectSyncButton.disabled = sync.running;
}

async function handleRememberSessionCredentials() {
    const remember = ui.rememberSessionCredentialsToggle.checked;
    updateSyncSecretsFromForm();
    state.sync.rememberSession = remember;
    await saveSyncPreferences();
    if (remember) {
        if (!saveSessionSyncCredentials()) {
            state.sync.rememberSession = false;
            ui.rememberSessionCredentialsToggle.checked = false;
            showToast(t('sessionStorageUnavailable'));
            renderSyncSettings();
            return;
        }
        showToast(t('sessionCredentialsRemembered'));
    } else {
        clearSessionSyncCredentials();
        showToast(t('sessionCredentialsCleared'));
    }
    renderSyncSettings();
}

async function handleAutoCreateDirectoryToggle() {
    state.sync.createDirectory = ui.autoCreateDirectoryToggle.checked;
    await saveSyncPreferences();
    renderSyncSettings();
}

async function handleAutoSyncToggle() {
    const enabled = ui.autoSyncToggle.checked;
    updateSyncSecretsFromForm();
    state.sync.automatic = enabled;
    await saveSyncPreferences();
    renderSyncSettings();
    if (state.sync.automatic) {
        showToast(t('syncAutoEnabled'));
        if (state.sync.unlocked) scheduleWebDavSync(150);
    } else {
        window.clearTimeout(state.sync.timer);
        showToast(t('syncAutoPaused'));
    }
}

async function disconnectWebDavSync() {
    if (!window.confirm(t('confirmDisconnectSync'))) return;
    window.clearTimeout(state.sync.timer);
    clearSessionSyncCredentials();
    const endpointKey = syncEndpointKey();
    try {
        await deleteSetting(SYNC_PREFERENCES_KEY);
        if (state.sync.endpoint) await deleteSyncState(endpointKey);
    } catch (error) {
        console.warn('Unable to remove WebDAV sync preferences:', error);
    }
    Object.assign(state.sync, {
        endpoint: '',
        provider: '',
        koofrMountId: '',
        koofrMountName: '',
        koofrMountUser: '',
        username: '',
        password: '',
        passphrase: '',
        rememberSession: false,
        sessionCredentialsRestored: false,
        createDirectory: true,
        automatic: false,
        unlocked: false,
        lastSyncAt: '',
        error: '',
        hasBaseline: false,
        conflicts: [],
        conflictEndpointKey: '',
        conflictIndex: 0,
        conflictSelections: {},
        phase: '',
        pending: false,
        cancelRequested: false,
        abortController: null,
        lastNotifiedError: '',
    });
    ui.syncEndpointInput.value = '';
    ui.syncUsernameInput.value = '';
    ui.syncPasswordInput.value = '';
    ui.syncPassphraseInput.value = '';
    renderSyncSettings();
    renderConflictBanner();
    showToast(t('syncDisconnected'));
}

function scheduleWebDavSync(delay = 1800) {
    const sync = state.sync;
    if (!sync.supported || !sync.automatic || !sync.unlocked || !sync.endpoint || sync.conflicts.length) return;
    window.clearTimeout(sync.timer);
    sync.timer = window.setTimeout(() => runWebDavSync({ notify: false }), delay);
}

function scheduleDataProtection() {
    scheduleAutoBackup();
    scheduleWebDavSync();
}

function preventMutationDuringSync() {
    if (!state.sync.running) return false;
    showToast(t('syncMutationBlocked'));
    return true;
}

function handleSyncNow() {
    if (state.sync.conflicts.length) {
        openConflictCenter();
        return;
    }
    runWebDavSync({ notify: true });
}

function setSyncPhase(phase) {
    state.sync.phase = phase;
    renderSyncSettings();
}

async function runWebDavSync({ notify = false } = {}) {
    updateSyncSecretsFromForm();
    const sync = state.sync;
    if (!sync.supported) {
        if (notify) showToast(t('syncFailed', { message: t('syncUnsupportedDetail') }));
        return false;
    }
    if (sync.running) {
        sync.pending = true;
        return sync.currentPromise || false;
    }

    let endpoint;
    try {
        endpoint = normalizeWebDavEndpoint(sync.endpoint);
        if (sync.username && !sync.password) throw new Error(t('syncPasswordRequired'));
        if (sync.passphrase.length < 8) throw new Error(t('syncPassphraseRequired'));
    } catch (error) {
        sync.error = error.message;
        renderSyncSettings();
        if (notify) showToast(t('syncFailed', { message: sync.error }));
        return false;
    }

    sync.endpoint = endpoint;
    ui.syncEndpointInput.value = endpoint;
    const endpointKey = syncEndpointKey(endpoint, sync.username);
    if (sync.conflictEndpointKey !== endpointKey) await loadSyncConflicts();
    if (sync.conflicts.length) {
        openConflictCenter();
        return false;
    }
    sync.running = true;
    sync.error = '';
    sync.phase = 'syncPhasePreparing';
    sync.cancelRequested = false;
    sync.abortController = new AbortController();
    window.clearTimeout(sync.timer);
    document.body.classList.add('syncing');
    renderSyncSettings();
    await saveSyncPreferences();

    const operation = (async () => {
        const remoteContext = await createSyncRemoteContext(endpoint);
        sync.provider = remoteContext.provider;
        const storedBaseline = await getSyncBaseline(endpointKey);
        const baseline = storedBaseline ? normalizeStoredSyncDataset(storedBaseline) : null;
        sync.hasBaseline = Boolean(baseline);
        let merged = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            setSyncPhase(attempt ? 'syncPhaseRetrying' : 'syncPhaseReading');
            const remote = await readRemoteSyncFile(endpoint, remoteContext);
            if (!remote.exists && sync.createDirectory) {
                setSyncPhase('syncPhaseCreatingFolder');
                await ensureRemoteParentDirectory(endpoint, remoteContext);
            }
            setSyncPhase('syncPhaseMerging');
            await refreshData();
            const local = await createLocalSyncDataset();
            const mergeResult = baseline
                ? threeWayMergeSyncDatasets(baseline, local, remote.data)
                : { dataset: mergeSyncDatasets(local, remote.data), conflicts: [] };
            if (mergeResult.conflicts.length) {
                const detectedAt = new Date().toISOString();
                const conflicts = mergeResult.conflicts.map((conflict) => ({ ...conflict, detectedAt }));
                await replaceSyncConflicts(endpointKey, conflicts);
                await savePendingSyncBaseline(endpointKey, remote.data);
                await flushBackupBeforeDestructiveChange();
                await replaceLocalSyncDataset(mergeResult.dataset);
                await refreshData();
                scheduleAutoBackup();
                sync.conflicts = await getSyncConflicts(endpointKey);
                sync.conflictEndpointKey = endpointKey;
                sync.conflictIndex = 0;
                sync.conflictSelections = {};
                sync.unlocked = true;
                renderConflictBanner();
                renderSyncSettings();
                showToast(t('conflictDetectedToast', { count: sync.conflicts.length }));
                return 'conflicts';
            }
            merged = mergeResult.dataset;
            setSyncPhase('syncPhaseEncrypting');
            const encrypted = await encryptSyncData(merged, sync.passphrase);
            setSyncPhase('syncPhaseWriting');
            const writeResult = await writeRemoteSyncFile(endpoint, encrypted, remote, remoteContext);
            if (writeResult === 'conflict') {
                merged = null;
                continue;
            }
            break;
        }
        if (!merged) throw new Error(t('syncConflictRetryFailed'));

        setSyncPhase('syncPhaseApplying');
        const viewedFolder = state.view.type === 'folder' ? findItem(state.view.value) : null;
        const viewedFolderSyncId = viewedFolder?.syncId || '';
        await replaceLocalSyncDataset(merged);
        await refreshData();
        if (viewedFolderSyncId) {
            const replacement = state.items.find((item) => item.syncId === viewedFolderSyncId && isFolder(item));
            state.view = replacement
                ? { type: 'folder', value: replacement.id }
                : { type: 'all', value: null };
            renderAll();
        }

        sync.unlocked = true;
        sync.sessionCredentialsRestored = false;
        if (sync.rememberSession) saveSessionSyncCredentials();
        sync.lastSyncAt = new Date().toISOString();
        sync.lastNotifiedError = '';
        sync.conflicts = [];
        sync.conflictEndpointKey = endpointKey;
        await saveSyncBaseline(endpointKey, merged);
        sync.hasBaseline = true;
        await deleteSyncBaseline(pendingSyncBaselineKey(endpointKey));
        await replaceSyncConflicts(endpointKey, []);
        await saveSyncPreferences();
        scheduleAutoBackup();
        if (notify) showToast(t('syncComplete', {
            items: merged.items.length,
            deleted: merged.tombstones.length,
        }));
        return true;
    })();

    sync.currentPromise = operation;
    try {
        return await operation;
    } catch (error) {
        if (sync.cancelRequested) {
            sync.error = '';
            showToast(t('syncCanceled'));
            return false;
        }
        console.error('WebDAV synchronization failed:', error);
        sync.error = error?.message || String(error);
        if (notify || sync.lastNotifiedError !== sync.error) {
            showToast(t('syncFailed', { message: sync.error }));
            sync.lastNotifiedError = sync.error;
        }
        return false;
    } finally {
        const wasCanceled = sync.cancelRequested;
        sync.running = false;
        sync.currentPromise = null;
        sync.abortController = null;
        sync.cancelRequested = false;
        sync.phase = '';
        document.body.classList.remove('syncing');
        renderSyncSettings();
        if (sync.pending && !wasCanceled) {
            sync.pending = false;
            scheduleWebDavSync(200);
        } else {
            sync.pending = false;
        }
    }
}
