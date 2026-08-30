/* Encrypted synchronization through a desktop cloud drive folder. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function initializeLocalFolderSync() {
    const local = state.sync.localFolder;
    if (!local.visibilityListenerBound) {
        document.addEventListener('visibilitychange', handleLocalFolderVisibilityChange);
        local.visibilityListenerBound = true;
    }
    if (!local.supported) return;
    try {
        const handle = await getSetting(LOCAL_SYNC_HANDLE_KEY);
        if (handle?.kind === 'directory') {
            local.handle = handle;
            local.name = handle.name;
            local.permission = await getBackupPermission(handle, false);
        }
    } catch (error) {
        console.warn('Unable to restore local sync directory:', error);
    }
    startLocalFolderPolling();
}

async function chooseLocalSyncDirectory() {
    updateSyncSecretsFromForm();
    const local = state.sync.localFolder;
    if (!local.supported) {
        showToast(t('localFolderUnsupportedDetail'));
        return false;
    }
    try {
        const handle = await window.showDirectoryPicker({
            id: 'bookmark-manager-local-sync',
            mode: 'readwrite',
        });
        const permission = await getBackupPermission(handle, true);
        if (permission !== 'granted') {
            showToast(t('backupPermissionDenied'));
            return false;
        }

        let sameDirectory = false;
        if (local.handle && typeof local.handle.isSameEntry === 'function') {
            try {
                sameDirectory = await local.handle.isSameEntry(handle);
            } catch {
                sameDirectory = false;
            }
        }
        local.handle = handle;
        local.name = handle.name;
        local.permission = permission;
        local.signature = '';
        local.lastLocalHash = '';
        if (!sameDirectory || !local.id) {
            local.id = createUuid();
            local.lastSyncAt = '';
        }
        state.sync.mode = 'local-folder';
        state.sync.provider = 'local-folder';
        state.sync.error = '';
        state.sync.unlocked = false;

        try {
            await saveSetting(LOCAL_SYNC_HANDLE_KEY, handle);
        } catch (error) {
            console.warn('The browser could not persist the local sync directory handle:', error);
        }
        await saveSyncPreferences();
        if (state.sync.rememberSession) saveSessionSyncCredentials();
        state.sync.hasBaseline = Boolean(await getSyncBaseline(syncEndpointKey()));
        await loadSyncConflicts();
        renderSyncSettings();
        if (state.sync.passphrase.length >= 8) {
            await runWebDavSync({ notify: true });
        }
        return true;
    } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.error('Unable to select local sync directory:', error);
        state.sync.error = error?.message || String(error);
        renderSyncSettings();
        return false;
    }
}

async function disconnectLocalSyncDirectory() {
    const local = state.sync.localFolder;
    window.clearInterval(local.pollTimer);
    try {
        await deleteSetting(LOCAL_SYNC_HANDLE_KEY);
    } catch (error) {
        console.warn('Unable to remove local sync directory handle:', error);
    }
    local.handle = null;
    local.id = '';
    local.name = '';
    local.permission = 'unknown';
    local.lastSyncAt = '';
    local.signature = '';
    local.lastLocalHash = '';
    state.sync.unlocked = false;
    state.sync.provider = '';
    state.sync.hasBaseline = false;
    await saveSyncPreferences();
    renderSyncSettings();
    showToast(t('localFolderDisconnected'));
}

function startLocalFolderPolling() {
    const local = state.sync.localFolder;
    window.clearInterval(local.pollTimer);
    local.pollTimer = null;
    if (
        state.sync.mode !== 'local-folder'
        || !state.sync.automatic
        || !state.sync.unlocked
        || state.sync.conflicts.length
        || !local.handle
    ) return;
    local.pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible' && !state.sync.running) {
            runWebDavSync({ notify: false });
        }
    }, LOCAL_SYNC_POLL_INTERVAL_MS);
}

function handleLocalFolderVisibilityChange() {
    if (
        document.visibilityState === 'visible'
        && state.sync.mode === 'local-folder'
        && state.sync.automatic
        && state.sync.unlocked
        && !state.sync.conflicts.length
    ) {
        runWebDavSync({ notify: false });
    }
}

async function runLocalFolderSyncUnlocked({ notify = false } = {}) {
    updateSyncSecretsFromForm();
    const sync = state.sync;
    const localFolder = sync.localFolder;
    if (!localFolder.supported) {
        sync.error = t('localFolderUnsupportedDetail');
        renderSyncSettings();
        if (notify) showToast(t('syncFailed', { message: sync.error }));
        return false;
    }
    if (!localFolder.handle) {
        sync.error = t('localFolderNotConfiguredDetail');
        renderSyncSettings();
        if (notify) showToast(t('syncFailed', { message: sync.error }));
        return false;
    }
    if (sync.passphrase.length < 8) {
        sync.error = t('syncPassphraseRequired');
        renderSyncSettings();
        if (notify) showToast(t('syncFailed', { message: sync.error }));
        return false;
    }

    localFolder.permission = await getBackupPermission(localFolder.handle, notify);
    if (localFolder.permission !== 'granted') {
        sync.error = t('localFolderPermissionDetail');
        renderSyncSettings();
        if (notify) showToast(t('syncFailed', { message: sync.error }));
        return false;
    }

    const endpointKey = syncEndpointKey();
    if (sync.conflictEndpointKey !== endpointKey) await loadSyncConflicts();
    if (sync.conflicts.length) {
        openConflictCenter();
        return false;
    }

    sync.running = true;
    sync.provider = 'local-folder';
    sync.error = '';
    sync.cancelRequested = false;
    document.body.classList.add('syncing');
    renderSyncSettings();

    const operation = (async () => {
        setSyncPhase('syncPhaseReadingLocalFolder');
        const fileSet = await listLocalSyncDeviceFiles(localFolder.handle);
        ensureLocalSyncNotCanceled();
        await refreshData();
        const localDataset = await createLocalSyncDataset();
        const localHash = hashSyncDataset(localDataset);
        if (
            !notify
            && fileSet.signature === localFolder.signature
            && localHash === localFolder.lastLocalHash
        ) {
            return true;
        }

        const remoteDataset = await readLocalSyncDeviceFiles(fileSet.files, sync.passphrase);
        ensureLocalSyncNotCanceled();
        const storedBaseline = await getSyncBaseline(endpointKey);
        const baseline = storedBaseline ? normalizeStoredSyncDataset(storedBaseline) : null;
        sync.hasBaseline = Boolean(baseline);
        setSyncPhase('syncPhaseMerging');
        const mergeResult = baseline
            ? threeWayMergeSyncDatasets(baseline, localDataset, remoteDataset)
            : { dataset: mergeSyncDatasets(localDataset, remoteDataset), conflicts: [] };

        if (mergeResult.conflicts.length) {
            const detectedAt = new Date().toISOString();
            const conflicts = mergeResult.conflicts.map((conflict) => ({ ...conflict, detectedAt }));
            await replaceSyncConflicts(endpointKey, conflicts);
            await savePendingSyncBaseline(endpointKey, remoteDataset);
            await flushBackupBeforeDestructiveChange();
            await replaceLocalSyncDataset(mergeResult.dataset);
            await refreshData();
            scheduleAutoBackup();
            broadcastDataChanged('local-folder-conflict');
            sync.conflicts = await getSyncConflicts(endpointKey);
            sync.conflictEndpointKey = endpointKey;
            sync.conflictIndex = 0;
            sync.conflictSelections = {};
            sync.unlocked = true;
            renderConflictBanner();
            showToast(t('conflictDetectedToast', { count: sync.conflicts.length }));
            return 'conflicts';
        }

        ensureLocalSyncNotCanceled();
        setSyncPhase('syncPhaseWritingLocalFolder');
        await writeLocalSyncDeviceFile(localFolder.handle, mergeResult.dataset, sync.passphrase);
        setSyncPhase('syncPhaseApplying');
        const viewedFolder = state.view.type === 'folder' ? findItem(state.view.value) : null;
        const viewedFolderSyncId = viewedFolder?.syncId || '';
        await replaceLocalSyncDataset(mergeResult.dataset);
        await refreshData();
        if (viewedFolderSyncId) {
            const replacement = state.items.find((item) => item.syncId === viewedFolderSyncId && isFolder(item));
            state.view = replacement
                ? { type: 'folder', value: replacement.id }
                : { type: 'all', value: null };
            renderAll();
        }

        await saveSyncBaseline(endpointKey, mergeResult.dataset);
        await deleteSyncBaseline(pendingSyncBaselineKey(endpointKey));
        await replaceSyncConflicts(endpointKey, []);
        sync.hasBaseline = true;
        sync.conflicts = [];
        sync.conflictEndpointKey = endpointKey;
        sync.unlocked = true;
        sync.sessionCredentialsRestored = false;
        localFolder.lastSyncAt = new Date().toISOString();
        if (sync.rememberSession) saveSessionSyncCredentials();
        await saveSyncPreferences();
        const refreshedFileSet = await listLocalSyncDeviceFiles(localFolder.handle);
        localFolder.signature = refreshedFileSet.signature;
        const refreshedLocal = await createLocalSyncDataset();
        localFolder.lastLocalHash = hashSyncDataset(refreshedLocal);
        scheduleAutoBackup();
        broadcastDataChanged('local-folder-sync');
        if (notify) showToast(t('syncComplete', {
            items: mergeResult.dataset.items.length,
            deleted: mergeResult.dataset.tombstones.length,
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
        console.error('Local folder synchronization failed:', error);
        sync.error = error?.message || String(error);
        if (notify || sync.lastNotifiedError !== sync.error) {
            showToast(t('syncFailed', { message: sync.error }));
            sync.lastNotifiedError = sync.error;
        }
        return false;
    } finally {
        sync.running = false;
        sync.currentPromise = null;
        sync.cancelRequested = false;
        sync.phase = '';
        document.body.classList.remove('syncing');
        renderSyncSettings();
        startLocalFolderPolling();
        if (sync.pending) {
            sync.pending = false;
            scheduleWebDavSync(200);
        }
    }
}

function ensureLocalSyncNotCanceled() {
    if (state.sync.cancelRequested) throw new Error(t('syncCanceled'));
}

async function listLocalSyncDeviceFiles(rootHandle) {
    const devices = await rootHandle.getDirectoryHandle('devices', { create: true });
    const files = [];
    const signatureParts = [];
    for await (const [name, handle] of devices.entries()) {
        if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.enc.json')) continue;
        const file = await handle.getFile();
        files.push({ name, file });
        signatureParts.push(`${name}:${file.size}:${file.lastModified}`);
    }
    return {
        devices,
        files,
        signature: signatureParts.sort().join('|'),
    };
}

async function readLocalSyncDeviceFiles(files, passphrase) {
    let aggregate = emptySyncDataset();
    for (const entry of files) {
        try {
            const content = await entry.file.text();
            if (!content.trim()) continue;
            const decrypted = await decryptSyncData(content, passphrase);
            const dataset = parseRemoteSyncDataset(decrypted);
            aggregate = mergeSyncDatasets(aggregate, dataset);
        } catch (error) {
            console.error(`Unable to read local sync file ${entry.name}:`, error);
            throw new Error(t('localFolderReadFailed', { name: entry.name }));
        }
    }
    return aggregate;
}

async function writeLocalSyncDeviceFile(rootHandle, dataset, passphrase) {
    try {
        const devices = await rootHandle.getDirectoryHandle('devices', { create: true });
        const content = await encryptSyncData(dataset, passphrase);
        await writeBackupFile(devices, `${state.sync.deviceId}.enc.json`, content);
    } catch (error) {
        console.error('Unable to write local sync device file:', error);
        throw new Error(t('localFolderWriteFailed'));
    }
}

function hashSyncDataset(dataset) {
    const content = JSON.stringify({
        items: dataset.items,
        tombstones: dataset.tombstones,
    });
    return `${hashString(content)}-${content.length}`;
}
