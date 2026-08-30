/* Backup discovery, preview, and safe restore workflow. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

const MAX_RESTORE_BACKUP_BYTES = 50 * 1024 * 1024;
const EMERGENCY_BACKUP_RETENTION = 10;
let backupRestoreSession = null;

async function openBackupRestoreDialog(options = {}) {
    closeExportMenu();
    if (state.backup.running || preventMutationDuringSync()) return;
    if (!state.backup.supported) {
        showToast(t('restoreFolderUnsupported'), 'warning');
        ui.importFileInput.click();
        return;
    }

    const returnToBackupDialog = options.returnToBackupDialog === true || ui.backupDialog.open;
    window.clearTimeout(state.backup.timer);
    if (ui.backupDialog.open) ui.backupDialog.close();
    backupRestoreSession = {
        handle: options.handle || state.backup.handle || null,
        returnToBackupDialog,
        snapshots: [],
        selectedId: '',
        selectedRecords: null,
        mode: 'merge',
        loading: false,
        selectedLoading: false,
        applying: false,
        error: '',
        scanToken: '',
        selectionToken: '',
    };
    document.querySelectorAll('input[name="backup-restore-mode"]').forEach((input) => {
        input.checked = input.value === 'merge';
    });
    renderBackupRestoreDialog();
    if (!ui.backupRestoreDialog.open) ui.backupRestoreDialog.showModal();
    if (backupRestoreSession.handle) {
        await scanBackupRestoreDirectory(backupRestoreSession.handle);
    }
}

function closeBackupRestoreDialog(reopenBackupDialog = true) {
    if (backupRestoreSession?.applying) return;
    const shouldReopen = reopenBackupDialog && backupRestoreSession?.returnToBackupDialog;
    if (ui.backupRestoreDialog.open) ui.backupRestoreDialog.close();
    backupRestoreSession = null;
    if (state.backup.enabled) scheduleAutoBackup();
    if (shouldReopen) openBackupDialog();
}

async function chooseBackupRestoreDirectory() {
    const session = backupRestoreSession;
    if (!session || typeof window.showDirectoryPicker !== 'function') return;
    try {
        const handle = await window.showDirectoryPicker({
            id: 'bookmark-manager-restore',
            mode: 'readwrite',
        });
        await scanBackupRestoreDirectory(handle);
    } catch (error) {
        if (error?.name === 'AbortError' || backupRestoreSession !== session) return;
        session.error = error?.message || t('backupRestoreReadFailed');
        renderBackupRestoreDialog();
    }
}

async function scanBackupRestoreDirectory(handle) {
    const session = backupRestoreSession;
    if (!session) return;
    const token = createUuid();
    session.scanToken = token;
    session.handle = handle;
    session.snapshots = [];
    session.selectedId = '';
    session.selectedRecords = null;
    session.loading = true;
    session.selectedLoading = false;
    session.error = '';
    renderBackupRestoreDialog();

    try {
        const permission = await getBackupPermission(handle, true);
        if (permission !== 'granted') throw new Error(t('backupRestorePermissionRequired'));
        const snapshots = await scanBackupSnapshotFiles(handle, () => (
            backupRestoreSession === session && session.scanToken === token
        ));
        if (backupRestoreSession !== session || session.scanToken !== token) return;
        session.snapshots = snapshots;
        session.loading = false;
        const firstValid = snapshots.find((snapshot) => !snapshot.invalid);
        renderBackupRestoreDialog();
        if (firstValid) await selectBackupRestoreSnapshot(firstValid.id);
    } catch (error) {
        if (backupRestoreSession !== session || session.scanToken !== token) return;
        session.loading = false;
        session.error = error?.message || t('backupRestoreReadFailed');
        renderBackupRestoreDialog();
    }
}

async function scanBackupSnapshotFiles(directory, shouldContinue = () => true) {
    const candidates = await collectBackupSnapshotCandidates(directory);
    const snapshots = [];
    for (const candidate of candidates) {
        if (!shouldContinue()) break;
        try {
            snapshots.push(await inspectBackupSnapshot(candidate));
        } catch (error) {
            let file = null;
            try {
                file = await candidate.fileHandle.getFile();
            } catch {
                // Keep the original validation error.
            }
            snapshots.push({
                ...candidate,
                invalid: true,
                error: error?.message || t('backupSnapshotInvalid'),
                exportedAt: file?.lastModified ? new Date(file.lastModified).toISOString() : '',
                size: file?.size || 0,
                bookmarks: 0,
                folders: 0,
                items: 0,
                previewItems: [],
            });
        }
        await yieldToBrowser();
    }
    return snapshots.sort(compareBackupSnapshots);
}

async function collectBackupSnapshotCandidates(directory) {
    const candidates = [];
    try {
        const latest = await directory.getFileHandle('bookmarks-latest.json');
        candidates.push({
            id: 'latest/bookmarks-latest.json',
            name: 'bookmarks-latest.json',
            relativeName: 'bookmarks-latest.json',
            kind: 'latest',
            fileHandle: latest,
        });
    } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
    }

    await collectBackupDirectoryCandidates(
        directory,
        'history',
        'history',
        /^bookmarks-\d{4}-\d{2}-\d{2}T.*\.json$/,
        candidates,
    );
    await collectBackupDirectoryCandidates(
        directory,
        'emergency',
        'emergency',
        /^bookmarks-before-restore-\d{4}-\d{2}-\d{2}T.*\.json$/,
        candidates,
    );
    return candidates;
}

async function collectBackupDirectoryCandidates(root, directoryName, kind, pattern, candidates) {
    let directory;
    try {
        directory = await root.getDirectoryHandle(directoryName);
    } catch (error) {
        if (error?.name === 'NotFoundError') return;
        throw error;
    }
    for await (const [name, handle] of directory.entries()) {
        if (handle.kind !== 'file' || !pattern.test(name)) continue;
        candidates.push({
            id: `${directoryName}/${name}`,
            name,
            relativeName: `${directoryName}/${name}`,
            kind,
            fileHandle: handle,
        });
    }
}

async function inspectBackupSnapshot(candidate) {
    const file = await candidate.fileHandle.getFile();
    if (file.size > MAX_RESTORE_BACKUP_BYTES) throw new Error(t('backupSnapshotTooLarge'));
    const content = await file.text();
    const inspection = inspectBackupPayload(content);
    return {
        ...candidate,
        invalid: false,
        error: '',
        exportedAt: validDate(inspection.payload.exportedAt)
            ? inspection.payload.exportedAt
            : new Date(file.lastModified).toISOString(),
        size: file.size,
        bookmarks: inspection.bookmarks,
        folders: inspection.folders,
        items: inspection.source.length,
        previewItems: inspection.previewItems,
    };
}

function inspectBackupPayload(content) {
    let payload;
    try {
        payload = JSON.parse(content);
    } catch {
        throw new Error(t('backupSnapshotJsonInvalid'));
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(t('backupSnapshotInvalid'));
    }
    if (payload.format !== 'bookmark-manager') throw new Error(t('backupSnapshotWrongFormat'));
    const version = Number(payload.version);
    if (!Number.isInteger(version) || ![1, 2].includes(version)) {
        throw new Error(t('backupSnapshotUnsupportedVersion', { version: payload.version ?? '?' }));
    }
    if (!Array.isArray(payload.bookmarks)) throw new Error(t('backupSnapshotItemsMissing'));

    const seenIds = new Set();
    const seenSyncIds = new Set();
    const parentById = new Map();
    let bookmarks = 0;
    let folders = 0;
    const previewItems = [];
    payload.bookmarks.forEach((item) => {
        if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !item.title.trim()) {
            throw new Error(t('backupSnapshotDamagedItems'));
        }
        if (item.id != null) {
            const id = String(item.id);
            if (seenIds.has(id)) throw new Error(t('backupSnapshotDamagedItems'));
            seenIds.add(id);
            if (item.parentId != null) parentById.set(id, String(item.parentId));
        }
        if (typeof item.syncId === 'string' && item.syncId) {
            if (seenSyncIds.has(item.syncId)) throw new Error(t('backupSnapshotDamagedItems'));
            seenSyncIds.add(item.syncId);
        }
        const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
        if (rawUrl) {
            try {
                normalizeUrl(rawUrl);
            } catch {
                throw new Error(t('backupSnapshotDamagedItems'));
            }
            bookmarks += 1;
        } else {
            folders += 1;
        }
        if (previewItems.length < 8) {
            previewItems.push({ title: item.title.trim(), folder: !rawUrl });
        }
    });
    parentById.forEach((_, startId) => {
        const path = new Set();
        let currentId = startId;
        while (parentById.has(currentId) && seenIds.has(currentId)) {
            if (path.has(currentId)) throw new Error(t('backupSnapshotDamagedItems'));
            path.add(currentId);
            currentId = parentById.get(currentId);
        }
    });
    return { payload, source: payload.bookmarks, bookmarks, folders, previewItems };
}

async function readBackupSnapshotRecords(snapshot) {
    const file = await snapshot.fileHandle.getFile();
    if (file.size > MAX_RESTORE_BACKUP_BYTES) throw new Error(t('backupSnapshotTooLarge'));
    const content = await file.text();
    const inspection = inspectBackupPayload(content);
    const parsed = parseJsonImport(content);
    if (parsed.skipped || parsed.records.length !== inspection.source.length) {
        throw new Error(t('backupSnapshotDamagedItems'));
    }
    return parsed.records;
}

function compareBackupSnapshots(left, right) {
    if (left.kind === 'latest' && right.kind !== 'latest') return -1;
    if (right.kind === 'latest' && left.kind !== 'latest') return 1;
    const dateDifference = Date.parse(right.exportedAt || 0) - Date.parse(left.exportedAt || 0);
    if (dateDifference) return dateDifference;
    return right.name.localeCompare(left.name);
}

async function selectBackupRestoreSnapshot(id) {
    const session = backupRestoreSession;
    if (!session || session.applying) return;
    const snapshot = session.snapshots.find((entry) => entry.id === id && !entry.invalid);
    if (!snapshot) return;
    const token = createUuid();
    session.selectionToken = token;
    session.selectedId = id;
    session.selectedRecords = null;
    session.selectedLoading = true;
    session.error = '';
    renderBackupRestoreDialog();
    try {
        const records = await readBackupSnapshotRecords(snapshot);
        if (backupRestoreSession !== session || session.selectionToken !== token) return;
        session.selectedRecords = records;
        session.selectedLoading = false;
        snapshot.items = records.length;
        snapshot.bookmarks = records.filter((record) => Boolean(record.url)).length;
        snapshot.folders = records.length - snapshot.bookmarks;
    } catch (error) {
        if (backupRestoreSession !== session || session.selectionToken !== token) return;
        session.selectedLoading = false;
        snapshot.invalid = true;
        snapshot.error = error?.message || t('backupSnapshotInvalid');
        session.selectedId = '';
        session.error = snapshot.error;
    }
    renderBackupRestoreDialog();
}

function handleBackupRestoreModeChange(event) {
    if (!backupRestoreSession || !event.target.matches('input[name="backup-restore-mode"]')) return;
    backupRestoreSession.mode = event.target.value === 'replace' ? 'replace' : 'merge';
    renderBackupRestoreDialog();
}

function handleBackupRestoreSnapshotChange(event) {
    if (!event.target.matches('input[name="backup-restore-snapshot"]')) return;
    selectBackupRestoreSnapshot(event.target.value);
}

function renderBackupRestoreDialog() {
    const session = backupRestoreSession;
    if (!ui.backupRestoreDialog || !session) return;
    const validSnapshots = session.snapshots.filter((snapshot) => !snapshot.invalid);
    const selected = session.snapshots.find((snapshot) => snapshot.id === session.selectedId) || null;
    const hasHandle = Boolean(session.handle);
    const noSnapshots = hasHandle && !session.loading && !session.snapshots.length;
    const onlyInvalid = hasHandle && !session.loading && session.snapshots.length > 0 && !validSnapshots.length;

    ui.backupRestoreSourceName.textContent = session.handle?.name || t('backupRestoreNoFolder');
    ui.backupRestoreSourceDetail.textContent = session.loading
        ? t('backupRestoreScanning')
        : hasHandle
            ? t('backupRestoreFound', { count: validSnapshots.length })
            : t('backupRestoreChooseFolderHint');
    ui.chooseRestoreDirectoryButton.disabled = session.loading || session.applying;
    ui.backupRestoreLoading.classList.toggle('hidden', !session.loading && !session.applying);
    ui.backupRestoreLoadingText.textContent = session.applying
        ? t('backupRestoreApplying')
        : t('backupRestoreScanning');
    ui.backupRestoreEmpty.classList.toggle('hidden', session.loading || session.applying || (hasHandle && !noSnapshots && !onlyInvalid));
    ui.backupRestoreEmptyTitle.textContent = t(!hasHandle
        ? 'backupRestoreNoFolderTitle'
        : (onlyInvalid ? 'backupRestoreNoValidTitle' : 'backupRestoreNoSnapshotsTitle'));
    ui.backupRestoreEmptyDetail.textContent = t(!hasHandle
        ? 'backupRestoreNoFolderDetail'
        : (onlyInvalid ? 'backupRestoreNoValidDetail' : 'backupRestoreNoSnapshotsDetail'));
    ui.backupSnapshotWorkspace.classList.toggle('hidden', session.loading || session.applying || !session.snapshots.length);
    ui.backupSnapshotCount.textContent = t('backupRestoreSnapshotCount', { count: validSnapshots.length });
    renderBackupRestoreSnapshotList();
    renderBackupRestorePreview(selected);

    ui.backupRestoreModeSection.classList.toggle('hidden', session.applying || !selected || selected.invalid);
    ui.backupReplaceWarning.classList.toggle('hidden', session.applying || session.mode !== 'replace' || !selected);
    document.querySelectorAll('input[name="backup-restore-mode"]').forEach((input) => {
        input.checked = input.value === session.mode;
        input.disabled = session.applying;
    });
    ui.backupRestoreError.textContent = session.error;
    ui.backupRestoreError.classList.toggle('hidden', !session.error);
    ui.backupRestoreCancelButton.disabled = session.applying;
    ui.backupRestoreApplyButton.disabled = session.loading
        || session.selectedLoading
        || session.applying
        || !selected
        || selected.invalid
        || !session.selectedRecords;
    ui.backupRestoreApplyButton.textContent = t(session.mode === 'replace'
        ? 'backupRestoreReplaceAction'
        : 'backupRestoreMergeAction');
}

function renderBackupRestoreSnapshotList() {
    const session = backupRestoreSession;
    ui.backupSnapshotList.replaceChildren();
    session.snapshots.forEach((snapshot) => {
        const label = createElement('label', `backup-snapshot-card${snapshot.invalid ? ' invalid' : ''}`);
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'backup-restore-snapshot';
        input.value = snapshot.id;
        input.checked = snapshot.id === session.selectedId;
        input.disabled = snapshot.invalid || session.applying;
        const icon = createElement('span', 'backup-snapshot-icon');
        icon.append(createIcon(snapshot.invalid ? 'alert' : (snapshot.kind === 'latest' ? 'database' : 'upload')));
        const copy = createElement('span', 'backup-snapshot-copy');
        const heading = createElement('span', 'backup-snapshot-heading');
        heading.append(
            createElement('strong', '', t(snapshot.kind === 'latest'
                ? 'backupRestoreLatest'
                : (snapshot.kind === 'emergency' ? 'backupRestoreEmergency' : 'backupRestoreHistory'))),
            createElement('small', '', snapshot.exportedAt ? formatBackupTime(snapshot.exportedAt) : t('backupRestoreUnknownTime')),
        );
        copy.append(
            heading,
            createElement('small', 'backup-snapshot-summary', snapshot.invalid
                ? snapshot.error
                : t('backupRestoreCounts', { bookmarks: snapshot.bookmarks, folders: snapshot.folders })),
            createElement('small', 'backup-snapshot-file', `${snapshot.relativeName} · ${formatBackupFileSize(snapshot.size)}`),
        );
        label.append(input, icon, copy);
        ui.backupSnapshotList.append(label);
    });
}

function renderBackupRestorePreview(snapshot) {
    const session = backupRestoreSession;
    const visible = Boolean(snapshot && !snapshot.invalid);
    ui.backupPreviewEmpty.classList.toggle('hidden', visible);
    ui.backupPreview.classList.toggle('hidden', !visible);
    if (!visible) {
        ui.backupPreviewEmpty.textContent = session.selectedLoading
            ? t('backupRestoreLoadingPreview')
            : t('backupRestoreSelectSnapshot');
        return;
    }

    ui.backupPreviewKind.textContent = t(snapshot.kind === 'latest'
        ? 'backupRestoreLatest'
        : (snapshot.kind === 'emergency' ? 'backupRestoreEmergency' : 'backupRestoreHistory'));
    ui.backupPreviewTitle.textContent = snapshot.name;
    ui.backupPreviewTime.textContent = formatBackupTime(snapshot.exportedAt) || t('backupRestoreUnknownTime');
    ui.backupPreviewBookmarkCount.textContent = String(snapshot.bookmarks);
    ui.backupPreviewFolderCount.textContent = String(snapshot.folders);
    ui.backupPreviewItemCount.textContent = String(snapshot.items);
    ui.backupPreviewItems.replaceChildren();
    snapshot.previewItems.forEach((item) => {
        const row = createElement('li');
        row.append(createIcon(item.folder ? 'folder' : 'bookmark', 15), createElement('span', '', item.title));
        ui.backupPreviewItems.append(row);
    });
    if (!snapshot.previewItems.length) {
        ui.backupPreviewItems.append(createElement('li', 'backup-preview-no-items', t('backupRestoreEmptySnapshot')));
    } else if (snapshot.items > snapshot.previewItems.length) {
        ui.backupPreviewItems.append(createElement(
            'li',
            'backup-preview-more',
            t('backupRestoreMoreItems', { count: snapshot.items - snapshot.previewItems.length }),
        ));
    }
}

async function applySelectedBackupRestore() {
    const session = backupRestoreSession;
    if (!session || session.applying || session.selectedLoading || !session.selectedRecords) return;
    if (preventMutationDuringSync()) return;
    const snapshot = session.snapshots.find((entry) => entry.id === session.selectedId && !entry.invalid);
    if (!snapshot) return;
    if (session.mode === 'replace' && !window.confirm(t('backupRestoreReplaceConfirm'))) return;

    session.applying = true;
    session.error = '';
    renderBackupRestoreDialog();
    try {
        const mutation = await runUserDataMutation(async () => {
            let emergencyName = '';
            let restoredCount = 0;
            let duplicateCount = 0;
            if (session.mode === 'replace') {
                if (state.items.length) emergencyName = await writeRestoreEmergencyBackup(session.handle);
                restoredCount = await replaceItemsFromRestore(session.selectedRecords, state.items);
            } else {
                const prepared = prepareImportMerge(session.selectedRecords);
                const restoredAt = new Date().toISOString();
                const records = prepared.records.map((record) => record.existingId != null
                    ? record
                    : { ...record, updatedAt: restoredAt, modifiedBy: state.sync.deviceId });
                restoredCount = await addImportedRecords(records);
                duplicateCount = prepared.duplicateCount;
            }

            state.view = { type: 'all', value: null };
            state.query = '';
            ui.searchInput.value = '';
            ui.clearSearchButton.classList.add('hidden');
            ui.searchShortcut.classList.remove('hidden');
            await refreshData();
            await adoptBackupRestoreDirectory(session.handle, snapshot.exportedAt);
            scheduleDataProtection();
            return { restoredCount, duplicateCount, emergencyName };
        });
        if (!mutation.applied) {
            session.applying = false;
            renderBackupRestoreDialog();
            return;
        }
        const result = mutation.value;
        const mode = session.mode;
        session.applying = false;
        closeBackupRestoreDialog(false);
        showToast(t(mode === 'replace' ? 'backupRestoreReplaced' : 'backupRestoreMerged', {
            count: result.restoredCount,
            skipped: result.duplicateCount,
        }));
    } catch (error) {
        console.error('Backup restore failed:', error);
        if (backupRestoreSession !== session) return;
        session.applying = false;
        session.error = t('backupRestoreFailed', { message: error?.message || String(error) });
        renderBackupRestoreDialog();
        showToast(session.error, 'error');
    }
}

async function writeRestoreEmergencyBackup(directory) {
    const permission = await getBackupPermission(directory, true);
    if (permission !== 'granted') throw new Error(t('backupRestoreEmergencyPermission'));
    const emergency = await directory.getDirectoryHandle('emergency', { create: true });
    const filename = `bookmarks-before-restore-${fileTimestamp(new Date())}.json`;
    const payload = { ...createBackupPayload(), reason: 'before-restore' };
    await writeBackupFile(emergency, filename, `${JSON.stringify(payload, null, 2)}\n`);
    try {
        await pruneNamedBackupFiles(emergency, /^bookmarks-before-restore-.*\.json$/, EMERGENCY_BACKUP_RETENTION);
    } catch (error) {
        console.warn('Unable to prune pre-restore emergency backups:', error);
    }
    return filename;
}

async function pruneNamedBackupFiles(directory, pattern, retention) {
    const names = [];
    for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'file' && pattern.test(name)) names.push(name);
    }
    names.sort().reverse();
    await Promise.all(names.slice(retention).map((name) => directory.removeEntry(name)));
}

async function adoptBackupRestoreDirectory(handle, lastBackupAt) {
    state.backup.handle = handle;
    state.backup.permission = 'granted';
    state.backup.enabled = true;
    state.backup.error = '';
    state.backup.permissionNoticeShown = false;
    state.backup.lastNotifiedError = '';
    state.backup.lastHash = '';
    state.backup.lastBackupAt = validDate(lastBackupAt) ? lastBackupAt : state.backup.lastBackupAt;
    state.backup.handleRemembered = true;
    try {
        await saveSetting(BACKUP_HANDLE_KEY, handle);
    } catch (error) {
        console.warn('The browser could not persist the restored backup directory handle:', error);
        state.backup.handleRemembered = false;
    }
    await saveBackupPreferences();
    renderBackupSettings();
}

async function backupDirectoryContainsPotentialSnapshots(directory) {
    try {
        await directory.getFileHandle('bookmarks-latest.json');
        return true;
    } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
    }
    for (const [directoryName, pattern] of [
        ['history', /^bookmarks-\d{4}-\d{2}-\d{2}T.*\.json$/],
        ['emergency', /^bookmarks-before-restore-.*\.json$/],
    ]) {
        try {
            const child = await directory.getDirectoryHandle(directoryName);
            for await (const [name, handle] of child.entries()) {
                if (handle.kind === 'file' && pattern.test(name)) return true;
            }
        } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
        }
    }
    return false;
}

function formatBackupFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return t('backupRestoreBytes', { count: value });
    if (value < 1024 * 1024) return t('backupRestoreKilobytes', { count: Math.max(1, Math.round(value / 1024)) });
    return t('backupRestoreMegabytes', { count: (value / (1024 * 1024)).toFixed(1) });
}

function yieldToBrowser() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
}
