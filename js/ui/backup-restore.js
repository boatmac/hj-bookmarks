/* Backup discovery, preview, and safe restore workflow. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

const MAX_RESTORE_BACKUP_BYTES = 80 * 1024 * 1024;
const EMERGENCY_BACKUP_RETENTION = 10;
let backupRestoreSession = null;
let backupRestoreMemoryPassphrase = '';
let backupRestoreMemoryRememberSession = false;
let backupRestoreMemoryValidated = false;

function getInitialBackupRestoreCredentials() {
    if (state.backup.encryptionEnabled && backupEncryptionReady()) {
        return {
            passphrase: state.backup.passphrase,
            rememberSession: state.backup.rememberSession,
            validated: false,
        };
    }
    if (backupRestoreMemoryPassphrase) {
        return {
            passphrase: backupRestoreMemoryPassphrase,
            rememberSession: backupRestoreMemoryRememberSession,
            validated: backupRestoreMemoryValidated,
        };
    }
    if (!isPageReload()) {
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
        return { passphrase: '', rememberSession: false, validated: false };
    }
    const raw = safeSessionStorageGet(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    if (!raw) return { passphrase: '', rememberSession: false, validated: false };
    try {
        const saved = JSON.parse(raw);
        if (saved?.version !== 1 || typeof saved.passphrase !== 'string' || saved.passphrase.length < 8) {
            throw new Error('invalid restore credentials');
        }
        backupRestoreMemoryPassphrase = saved.passphrase;
        backupRestoreMemoryRememberSession = true;
        backupRestoreMemoryValidated = true;
        return { passphrase: saved.passphrase, rememberSession: true, validated: true };
    } catch {
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
        return { passphrase: '', rememberSession: false, validated: false };
    }
}

function clearBackupRestoreMemoryCredentials() {
    backupRestoreMemoryPassphrase = '';
    backupRestoreMemoryRememberSession = false;
    backupRestoreMemoryValidated = false;
    safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
}

function clearBackupRestoreCredentialsAfterHistoryRestore() {
    clearBackupRestoreMemoryCredentials();
    const session = backupRestoreSession;
    if (!session || session.applying) return;
    session.passphrase = '';
    session.passphraseValidated = false;
    session.rememberSession = false;
    ui.backupRestorePassphraseInput.value = '';
    ui.backupRestoreRememberToggle.checked = false;
    const snapshot = session.snapshots.find((entry) => entry.id === session.selectedId);
    if (snapshot?.encrypted) {
        snapshot.locked = true;
        session.selectedRecords = null;
        session.diff = null;
        session.selectedKeys.clear();
        session.selectedLoading = false;
        session.needsUnlock = true;
        session.unlockError = t('backupRestoreHistoryCredentialsCleared');
        renderBackupRestoreDialog();
    }
}

function saveBackupRestoreSessionCredentials(session) {
    backupRestoreMemoryPassphrase = session.passphrase;
    backupRestoreMemoryRememberSession = session.rememberSession;
    backupRestoreMemoryValidated = session.passphraseValidated;
    if (!session.rememberSession || session.passphrase.length < 8 || !session.passphraseValidated) {
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
        return !session.rememberSession;
    }
    const saved = safeSessionStorageSet(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY, JSON.stringify({
        version: 1,
        passphrase: session.passphrase,
        savedAt: new Date().toISOString(),
    }));
    if (!saved) backupRestoreMemoryRememberSession = false;
    return saved;
}

async function openBackupRestoreDialog(options = {}) {
    closeExportMenu();
    if (state.backup.running || state.backup.health.running || preventMutationDuringSync()) return;
    if (!state.backup.supported) {
        showToast(t('restoreFolderUnsupported'), 'warning');
        ui.importFileInput.click();
        return;
    }

    const returnToBackupDialog = options.returnToBackupDialog === true || ui.backupDialog.open;
    const credentials = getInitialBackupRestoreCredentials();
    window.clearTimeout(state.backup.timer);
    if (ui.backupDialog.open) ui.backupDialog.close();
    backupRestoreSession = {
        handle: options.handle || state.backup.handle || null,
        returnToBackupDialog,
        snapshots: [],
        selectedId: '',
        selectedRecords: null,
        diff: null,
        selectedKeys: new Set(),
        mode: 'merge',
        passphrase: credentials.passphrase,
        passphraseValidated: credentials.validated,
        rememberSession: credentials.rememberSession,
        needsUnlock: false,
        unlockError: '',
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
    ui.backupRestorePassphraseInput.value = credentials.passphrase;
    ui.backupRestoreRememberToggle.checked = credentials.rememberSession;
    renderBackupRestoreDialog();
    if (!ui.backupRestoreDialog.open) ui.backupRestoreDialog.showModal();
    if (backupRestoreSession.handle) {
        await scanBackupRestoreDirectory(backupRestoreSession.handle);
    }
}

function closeBackupRestoreDialog(reopenBackupDialog = true) {
    if (backupRestoreSession?.applying) return;
    const shouldReopen = reopenBackupDialog && backupRestoreSession?.returnToBackupDialog;
    if (backupRestoreSession) saveBackupRestoreSessionCredentials(backupRestoreSession);
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
    session.selectionToken = '';
    session.handle = handle;
    session.snapshots = [];
    session.selectedId = '';
    session.selectedRecords = null;
    session.diff = null;
    session.selectedKeys.clear();
    session.needsUnlock = false;
    session.unlockError = '';
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
                encrypted: candidate.name.endsWith('.enc.json'),
                locked: false,
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
    for (const name of ['bookmarks-latest.enc.json', 'bookmarks-latest.json']) {
        try {
            const latest = await directory.getFileHandle(name);
            candidates.push({
                id: `latest/${name}`,
                name,
                relativeName: name,
                kind: 'latest',
                fileHandle: latest,
            });
        } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
        }
    }

    await collectBackupDirectoryCandidates(
        directory,
        'history',
        'history',
        /^bookmarks-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/,
        candidates,
    );
    await collectBackupDirectoryCandidates(
        directory,
        'emergency',
        'emergency',
        /^bookmarks-before-restore-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/,
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
    const documentObject = parseBackupJsonDocument(content);
    if (documentObject?.format === 'bookmark-manager-encrypted-backup') {
        validateEncryptedBackupEnvelope(documentObject);
        return {
            ...candidate,
            encrypted: true,
            locked: true,
            invalid: false,
            error: '',
            exportedAt: new Date(file.lastModified).toISOString(),
            size: file.size,
            bookmarks: 0,
            folders: 0,
            items: 0,
            previewItems: [],
        };
    }

    const inspection = inspectBackupPayloadObject(documentObject);
    return {
        ...candidate,
        encrypted: false,
        locked: false,
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

function parseBackupJsonDocument(content) {
    try {
        return JSON.parse(content);
    } catch {
        throw new Error(t('backupSnapshotJsonInvalid'));
    }
}

function inspectBackupPayload(content) {
    return inspectBackupPayloadObject(parseBackupJsonDocument(content));
}

function inspectBackupPayloadObject(payload) {
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
    const itemKindById = new Map();
    const parentReferences = [];
    let bookmarks = 0;
    let folders = 0;
    const previewItems = [];
    payload.bookmarks.forEach((item) => {
        if (!item || typeof item !== 'object' || typeof item.title !== 'string' || !item.title.trim()) {
            throw new Error(t('backupSnapshotDamagedItems'));
        }
        let itemId = null;
        if (item.id != null) {
            itemId = String(item.id);
            if (seenIds.has(itemId)) throw new Error(t('backupSnapshotDamagedItems'));
            seenIds.add(itemId);
            if (item.parentId != null) parentById.set(itemId, String(item.parentId));
        }
        if (item.parentId != null) {
            parentReferences.push({ itemId, parentId: String(item.parentId) });
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
        if (itemId != null) itemKindById.set(itemId, rawUrl ? 'bookmark' : 'folder');
        if (previewItems.length < 8) {
            previewItems.push({ title: item.title.trim(), folder: !rawUrl });
        }
    });
    parentReferences.forEach(({ itemId, parentId }) => {
        if (!seenIds.has(parentId) || itemKindById.get(parentId) !== 'folder' || itemId === parentId) {
            throw new Error(t('backupSnapshotDamagedItems'));
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

async function readBackupSnapshotData(snapshot, passphrase = '') {
    const file = await snapshot.fileHandle.getFile();
    if (file.size > MAX_RESTORE_BACKUP_BYTES) throw new Error(t('backupSnapshotTooLarge'));
    const content = await file.text();
    const documentObject = parseBackupJsonDocument(content);
    const encrypted = documentObject?.format === 'bookmark-manager-encrypted-backup';
    let payload = documentObject;
    if (encrypted) {
        validateEncryptedBackupEnvelope(documentObject);
        if (!state.backup.encryptionSupported) {
            const error = new Error(t('backupEncryptionUnavailable'));
            error.code = 'BACKUP_ENCRYPTION_UNSUPPORTED';
            throw error;
        }
        if (typeof passphrase !== 'string' || passphrase.length < 8) {
            const error = new Error(t('backupRestorePassphraseRequired'));
            error.code = 'BACKUP_PASSPHRASE_REQUIRED';
            throw error;
        }
        payload = await decryptBackupData(content, passphrase);
    }
    const inspection = inspectBackupPayloadObject(payload);
    const parsed = parseJsonImport(JSON.stringify(payload));
    if (parsed.skipped || parsed.records.length !== inspection.source.length) {
        throw new Error(t('backupSnapshotDamagedItems'));
    }
    return { records: parsed.records, inspection, encrypted };
}

async function readBackupSnapshotRecords(snapshot, passphrase = '') {
    return (await readBackupSnapshotData(snapshot, passphrase)).records;
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
    session.diff = null;
    session.selectedKeys.clear();
    session.needsUnlock = false;
    session.unlockError = '';
    session.selectedLoading = false;
    session.error = '';
    if (snapshot.encrypted && !state.backup.encryptionSupported) {
        snapshot.locked = true;
        session.needsUnlock = true;
        session.unlockError = t('backupEncryptionUnavailable');
        renderBackupRestoreDialog();
        return;
    }
    if (snapshot.encrypted && session.passphrase.length < 8) {
        snapshot.locked = true;
        session.needsUnlock = true;
        renderBackupRestoreDialog();
        focusBackupRestorePassphrase();
        return;
    }
    await loadSelectedBackupSnapshot(session, snapshot, token);
}

async function loadSelectedBackupSnapshot(session, snapshot, token) {
    session.selectedLoading = true;
    session.needsUnlock = snapshot.encrypted;
    session.unlockError = '';
    renderBackupRestoreDialog();
    try {
        const data = await readBackupSnapshotData(snapshot, session.passphrase);
        if (backupRestoreSession !== session || session.selectionToken !== token) return;
        const { records, inspection } = data;
        session.selectedRecords = records;
        session.diff = createBackupRestoreDiff(records, state.items);
        session.selectedKeys = new Set(
            session.diff.entries
                .filter((entry) => entry.category !== 'same')
                .map((entry) => entry.key),
        );
        session.selectedLoading = false;
        session.needsUnlock = false;
        session.unlockError = '';
        snapshot.encrypted = data.encrypted;
        snapshot.locked = false;
        snapshot.exportedAt = validDate(inspection.payload.exportedAt)
            ? inspection.payload.exportedAt
            : snapshot.exportedAt;
        snapshot.items = records.length;
        snapshot.bookmarks = inspection.bookmarks;
        snapshot.folders = inspection.folders;
        snapshot.previewItems = inspection.previewItems;
        if (data.encrypted) {
            session.passphraseValidated = true;
            if (!saveBackupRestoreSessionCredentials(session) && session.rememberSession) {
                session.rememberSession = false;
                ui.backupRestoreRememberToggle.checked = false;
                saveBackupRestoreSessionCredentials(session);
                showToast(t('sessionStorageUnavailable'), 'warning');
            }
        }
    } catch (error) {
        if (backupRestoreSession !== session || session.selectionToken !== token) return;
        session.selectedLoading = false;
        session.selectedRecords = null;
        session.diff = null;
        session.selectedKeys.clear();
        if ([
            'BACKUP_ENCRYPTION_UNSUPPORTED',
            'BACKUP_PASSPHRASE_REQUIRED',
            'BACKUP_DECRYPT_FAILED',
        ].includes(error?.code)) {
            snapshot.encrypted = true;
            snapshot.locked = true;
            session.passphraseValidated = false;
            saveBackupRestoreSessionCredentials(session);
            session.needsUnlock = true;
            session.unlockError = error?.message || t('backupDecryptFailed');
            renderBackupRestoreDialog();
            focusBackupRestorePassphrase();
            return;
        }
        snapshot.invalid = true;
        snapshot.locked = false;
        snapshot.error = error?.message || t('backupSnapshotInvalid');
        session.selectedId = '';
        session.needsUnlock = false;
        session.error = snapshot.error;
    }
    renderBackupRestoreDialog();
}

function focusBackupRestorePassphrase() {
    window.requestAnimationFrame(() => {
        if (backupRestoreSession?.needsUnlock) {
            ui.backupRestorePassphraseInput.focus();
            ui.backupRestorePassphraseInput.select();
        }
    });
}

async function handleBackupRestoreUnlock(event) {
    event.preventDefault();
    const session = backupRestoreSession;
    if (!session || session.applying || session.selectedLoading) return;
    if (!state.backup.encryptionSupported) {
        session.unlockError = t('backupEncryptionUnavailable');
        renderBackupRestoreDialog();
        return;
    }
    const snapshot = session.snapshots.find((entry) => entry.id === session.selectedId && !entry.invalid);
    if (!snapshot?.encrypted) return;
    session.passphrase = ui.backupRestorePassphraseInput.value;
    session.rememberSession = ui.backupRestoreRememberToggle.checked;
    if (session.passphrase.length < 8) {
        session.unlockError = t('backupRestorePassphraseRequired');
        renderBackupRestoreDialog();
        focusBackupRestorePassphrase();
        return;
    }
    session.passphraseValidated = false;
    backupRestoreMemoryPassphrase = session.passphrase;
    backupRestoreMemoryRememberSession = session.rememberSession;
    backupRestoreMemoryValidated = false;
    safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    const token = createUuid();
    session.selectionToken = token;
    await loadSelectedBackupSnapshot(session, snapshot, token);
}

function handleBackupRestorePassphraseInput() {
    const session = backupRestoreSession;
    if (!session) return;
    session.passphrase = ui.backupRestorePassphraseInput.value;
    session.passphraseValidated = false;
    session.unlockError = '';
    backupRestoreMemoryPassphrase = session.passphrase;
    backupRestoreMemoryRememberSession = session.rememberSession;
    backupRestoreMemoryValidated = false;
    safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    ui.backupRestoreUnlockError.classList.add('hidden');
}

function handleBackupRestoreRememberToggle() {
    const session = backupRestoreSession;
    if (!session) return;
    const remember = ui.backupRestoreRememberToggle.checked;
    if (remember && session.passphrase.length < 8) {
        ui.backupRestoreRememberToggle.checked = false;
        session.rememberSession = false;
        session.unlockError = t('backupRestorePassphraseRequired');
        renderBackupRestoreDialog();
        return;
    }
    session.rememberSession = remember;
    backupRestoreMemoryRememberSession = remember;
    if (session.passphraseValidated && !saveBackupRestoreSessionCredentials(session)) {
        session.rememberSession = false;
        ui.backupRestoreRememberToggle.checked = false;
        saveBackupRestoreSessionCredentials(session);
        showToast(t('sessionStorageUnavailable'), 'warning');
    } else if (!remember) {
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    }
    renderBackupRestoreDialog();
}

function handleBackupRestoreModeChange(event) {
    if (!backupRestoreSession || !event.target.matches('input[name="backup-restore-mode"]')) return;
    backupRestoreSession.mode = ['merge', 'selective', 'replace'].includes(event.target.value)
        ? event.target.value
        : 'merge';
    renderBackupRestoreDialog();
}

function handleBackupRestoreSnapshotChange(event) {
    if (!event.target.matches('input[name="backup-restore-snapshot"]')) return;
    selectBackupRestoreSnapshot(event.target.value);
}

function handleBackupRestoreSelectionChange(event) {
    const session = backupRestoreSession;
    if (!session || session.applying || !event.target.matches('input[name="backup-restore-item"]')) return;
    if (event.target.checked) session.selectedKeys.add(event.target.value);
    else session.selectedKeys.delete(event.target.value);
    event.target.closest('.backup-selective-item')?.classList.toggle('selected', event.target.checked);
    updateBackupRestoreSelectionControls();
}

function selectAllBackupRestoreItems() {
    const session = backupRestoreSession;
    if (!session?.diff || session.applying) return;
    session.selectedKeys = new Set(
        session.diff.entries
            .filter((entry) => entry.category !== 'same')
            .map((entry) => entry.key),
    );
    ui.backupSelectiveList.querySelectorAll('input[name="backup-restore-item"]').forEach((input) => {
        input.checked = true;
        input.closest('.backup-selective-item')?.classList.add('selected');
    });
    updateBackupRestoreSelectionControls();
}

function clearBackupRestoreSelection() {
    const session = backupRestoreSession;
    if (!session || session.applying) return;
    session.selectedKeys.clear();
    ui.backupSelectiveList.querySelectorAll('input[name="backup-restore-item"]').forEach((input) => {
        input.checked = false;
        input.closest('.backup-selective-item')?.classList.remove('selected');
    });
    updateBackupRestoreSelectionControls();
}

function renderBackupRestoreDialog() {
    const session = backupRestoreSession;
    if (!ui.backupRestoreDialog || !session) return;
    const validSnapshots = session.snapshots.filter((snapshot) => !snapshot.invalid);
    const selected = session.snapshots.find((snapshot) => snapshot.id === session.selectedId) || null;
    const hasHandle = Boolean(session.handle);
    const noSnapshots = hasHandle && !session.loading && !session.snapshots.length;
    const onlyInvalid = hasHandle && !session.loading && session.snapshots.length > 0 && !validSnapshots.length;
    const ready = Boolean(selected && !selected.invalid && session.selectedRecords && session.diff);
    const plan = ready
        ? createBackupRestorePlan(session.diff, session.mode, session.selectedKeys)
        : emptyBackupRestorePlan();

    ui.backupRestoreSourceName.textContent = session.handle?.name || t('backupRestoreNoFolder');
    ui.backupRestoreSourceDetail.textContent = session.loading
        ? t('backupRestoreScanning')
        : hasHandle
            ? t('backupRestoreFound', { count: validSnapshots.length })
            : t('backupRestoreChooseFolderHint');
    ui.chooseRestoreDirectoryButton.disabled = session.loading || session.applying;
    ui.backupRestoreUnlockForm.classList.toggle('hidden', !session.needsUnlock || session.applying);
    ui.backupRestorePassphraseInput.disabled = !state.backup.encryptionSupported
        || session.selectedLoading
        || session.applying;
    ui.backupRestoreUnlockButton.disabled = !state.backup.encryptionSupported
        || session.selectedLoading
        || session.applying;
    ui.backupRestoreUnlockButton.textContent = t(session.selectedLoading
        ? 'unlockingBackup'
        : 'unlockBackup');
    ui.backupRestoreRememberToggle.checked = session.rememberSession;
    ui.backupRestoreRememberToggle.disabled = !state.backup.encryptionSupported
        || session.selectedLoading
        || session.applying;
    ui.backupRestoreUnlockError.textContent = session.unlockError;
    ui.backupRestoreUnlockError.classList.toggle('hidden', !session.unlockError);
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
    renderBackupRestoreComparison();

    ui.backupRestoreModeSection.classList.toggle('hidden', session.applying || !ready);
    ui.backupReplaceWarning.classList.toggle('hidden', session.applying || session.mode !== 'replace' || !ready);
    ui.backupSelectiveSection.classList.toggle('hidden', session.applying || session.mode !== 'selective' || !ready);
    document.querySelectorAll('input[name="backup-restore-mode"]').forEach((input) => {
        input.checked = input.value === session.mode;
        input.disabled = session.applying;
    });
    renderBackupRestoreImpact(plan);
    renderBackupRestoreSelection();

    ui.backupRestoreError.textContent = session.error;
    ui.backupRestoreError.classList.toggle('hidden', !session.error);
    ui.backupRestoreCancelButton.disabled = session.applying;
    ui.backupRestoreApplyButton.disabled = session.loading
        || session.selectedLoading
        || session.applying
        || !ready
        || plan.actionCount === 0;
    const actionKey = {
        merge: 'backupRestoreMergeAction',
        selective: 'backupRestoreSelectiveAction',
        replace: 'backupRestoreReplaceAction',
    }[session.mode] || 'backupRestoreMergeAction';
    ui.backupRestoreApplyButton.textContent = t(actionKey);
}

function renderBackupRestoreSnapshotList() {
    const session = backupRestoreSession;
    ui.backupSnapshotList.replaceChildren();
    session.snapshots.forEach((snapshot) => {
        const label = createElement(
            'label',
            `backup-snapshot-card${snapshot.encrypted ? ' encrypted' : ''}${snapshot.invalid ? ' invalid' : ''}`,
        );
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'backup-restore-snapshot';
        input.value = snapshot.id;
        input.checked = snapshot.id === session.selectedId;
        input.disabled = snapshot.invalid || session.applying;
        const icon = createElement('span', 'backup-snapshot-icon');
        icon.append(createIcon(snapshot.invalid
            ? 'alert'
            : snapshot.encrypted ? 'lock' : (snapshot.kind === 'latest' ? 'database' : 'upload')));
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
                : snapshot.encrypted && snapshot.locked
                    ? t('backupRestoreEncryptedLocked')
                    : t('backupRestoreCounts', { bookmarks: snapshot.bookmarks, folders: snapshot.folders })),
            createElement('small', 'backup-snapshot-file', `${snapshot.relativeName} · ${formatBackupFileSize(snapshot.size)}`),
        );
        label.append(input, icon, copy);
        ui.backupSnapshotList.append(label);
    });
}

function renderBackupRestorePreview(snapshot) {
    const session = backupRestoreSession;
    const visible = Boolean(snapshot && !snapshot.invalid && !snapshot.locked);
    ui.backupPreviewEmpty.classList.toggle('hidden', visible);
    ui.backupPreview.classList.toggle('hidden', !visible);
    if (!visible) {
        ui.backupPreviewEmpty.textContent = session.selectedLoading
            ? t('backupRestoreLoadingPreview')
            : snapshot?.encrypted && snapshot.locked
                ? t('backupRestoreUnlockToPreview')
                : t('backupRestoreSelectSnapshot');
        return;
    }

    const kind = t(snapshot.kind === 'latest'
        ? 'backupRestoreLatest'
        : (snapshot.kind === 'emergency' ? 'backupRestoreEmergency' : 'backupRestoreHistory'));
    ui.backupPreviewKind.textContent = snapshot.encrypted
        ? `${kind} · ${t('encryptedBackupBadge')}`
        : kind;
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

function renderBackupRestoreComparison() {
    const diff = backupRestoreSession?.diff;
    ui.backupComparison.classList.toggle('hidden', !diff);
    if (!diff) return;
    ui.backupDiffAddCount.textContent = String(diff.counts.add);
    ui.backupDiffUpdateCount.textContent = String(diff.counts.update);
    ui.backupDiffSameCount.textContent = String(diff.counts.same);
    ui.backupDiffRemoveCount.textContent = String(diff.counts.remove);
    ui.backupDiffHint.textContent = t('backupDiffHint');
}

function renderBackupRestoreImpact(plan) {
    const session = backupRestoreSession;
    if (!session?.diff) {
        ui.backupRestoreImpact.textContent = '';
        return;
    }
    const counts = session.diff.counts;
    if (!plan.actionCount) {
        ui.backupRestoreImpact.textContent = t(session.mode === 'selective'
            ? 'backupRestoreSelectAtLeastOne'
            : 'backupRestoreNoChanges');
        return;
    }
    if (session.mode === 'replace') {
        ui.backupRestoreImpact.textContent = t('backupRestoreReplaceImpact', {
            add: counts.add,
            update: counts.update,
            remove: counts.remove,
        });
        return;
    }
    if (session.mode === 'selective') {
        ui.backupRestoreImpact.textContent = t('backupRestoreSelectiveImpact', {
            selected: plan.requestedCount,
            count: plan.entries.length,
            automatic: plan.autoIncludedCount,
            current: counts.remove,
        });
        return;
    }
    ui.backupRestoreImpact.textContent = t('backupRestoreMergeImpact', {
        count: plan.entries.length,
        changed: counts.update,
        current: counts.remove,
        duplicates: plan.duplicateCount,
        folders: plan.reusedFolderCount,
    });
}

function renderBackupRestoreSelection() {
    const session = backupRestoreSession;
    ui.backupSelectiveList.replaceChildren();
    if (!session?.diff || session.mode !== 'selective') {
        ui.backupSelectiveCount.textContent = '';
        ui.backupSelectiveEmpty.classList.remove('hidden');
        return;
    }

    const entries = session.diff.entries.filter((entry) => entry.category !== 'same');
    ui.backupSelectiveEmpty.classList.toggle('hidden', entries.length > 0);
    entries.forEach((entry) => {
        const selected = session.selectedKeys.has(entry.key);
        const label = createElement(
            'label',
            `backup-selective-item is-${entry.category}${selected ? ' selected' : ''}`,
        );
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'backup-restore-item';
        input.value = entry.key;
        input.checked = selected;
        input.disabled = session.applying;
        input.setAttribute('aria-label', entry.record.title);

        const icon = createElement('span', 'backup-selective-icon');
        icon.append(createIcon(entry.folder ? 'folder' : 'bookmark', 15));
        const copy = createElement('span', 'backup-selective-copy');
        const heading = createElement('span', 'backup-selective-heading');
        heading.append(
            createElement('strong', '', entry.record.title),
            createElement('small', `backup-change-badge is-${entry.category}`, t(entry.category === 'add'
                ? 'backupDiffAdd'
                : 'backupDiffUpdate')),
        );
        const details = [t('backupRestoreLocation', { path: backupRestoreEntryPath(entry) })];
        if (entry.category === 'update') {
            details.push(t('backupRestoreChangedFields', {
                fields: backupRestoreChangedFieldLabels(entry.changedFields),
            }));
        }
        copy.append(heading, createElement('small', 'backup-selective-detail', details.join(' · ')));
        label.append(input, icon, copy);
        ui.backupSelectiveList.append(label);
    });
    updateBackupRestoreSelectionControls();
}

function updateBackupRestoreSelectionControls() {
    const session = backupRestoreSession;
    if (!session?.diff || session.mode !== 'selective') return;
    const entries = session.diff.entries.filter((entry) => entry.category !== 'same');
    const selectedCount = entries.filter((entry) => session.selectedKeys.has(entry.key)).length;
    ui.backupSelectiveCount.textContent = t('backupRestoreSelectedCount', {
        selected: selectedCount,
        total: entries.length,
    });
    ui.backupSelectAllButton.disabled = session.applying || !entries.length || selectedCount === entries.length;
    ui.backupClearSelectionButton.disabled = session.applying || selectedCount === 0;
    const plan = createBackupRestorePlan(session.diff, session.mode, session.selectedKeys);
    renderBackupRestoreImpact(plan);
    ui.backupRestoreApplyButton.disabled = session.applying || !plan.actionCount;
}

function backupRestoreEntryPath(entry) {
    return entry.pathTitles.length ? `/ ${entry.pathTitles.join(' / ')}` : t('rootFolder');
}

function backupRestoreChangedFieldLabels(fields) {
    const translationKeys = {
        title: 'conflictFieldTitle',
        url: 'conflictFieldUrl',
        description: 'conflictFieldDescription',
        tags: 'conflictFieldTags',
        isPinned: 'conflictFieldFavorite',
        parentSyncId: 'conflictFieldParent',
    };
    return fields.map((field) => t(translationKeys[field] || field)).join(t('listSeparator'));
}

function createBackupRestoreDiff(records, currentItems = state.items) {
    const currentParentSyncIds = new Map(
        currentItems.map((item) => [item.id, item.syncId || null]),
    );
    const currentBySyncId = new Map();
    const currentBookmarksByUrl = new Map();
    const currentFoldersByLocation = new Map();
    currentItems.forEach((item) => {
        if (item.syncId && !currentBySyncId.has(item.syncId)) currentBySyncId.set(item.syncId, item);
        if (item.url) {
            const url = canonicalUrl(item.url);
            if (!currentBookmarksByUrl.has(url)) currentBookmarksByUrl.set(url, []);
            currentBookmarksByUrl.get(url).push(item);
        } else {
            const key = backupRestoreFolderMatchKey(item.parentId, item.title);
            if (!currentFoldersByLocation.has(key)) currentFoldersByLocation.set(key, []);
            currentFoldersByLocation.get(key).push(item);
        }
    });

    const matchedCurrentItems = new Set();
    const reservedSyncIds = new Set(currentItems.map((item) => item.syncId).filter(Boolean));
    const usedEffectiveSyncIds = new Set();
    const entries = [];
    const entriesByKey = new Map();

    records.forEach((record) => {
        const folder = !record.url;
        const preferredSyncId = typeof record.syncId === 'string' ? record.syncId : '';
        let current = null;
        let matchType = 'none';
        if (preferredSyncId) {
            const candidate = currentBySyncId.get(preferredSyncId);
            if (
                candidate
                && Boolean(candidate.url) === Boolean(record.url)
                && !matchedCurrentItems.has(candidate)
            ) {
                current = candidate;
                matchType = 'syncId';
            }
        } else if (record.url) {
            current = takeUnmatchedBackupRestoreItem(
                currentBookmarksByUrl.get(canonicalUrl(record.url)),
                matchedCurrentItems,
            );
            if (current) matchType = 'url';
        } else {
            const parentEntry = record.parentKey ? entriesByKey.get(record.parentKey) : null;
            const canMatchParent = !record.parentKey || Boolean(parentEntry?.current);
            if (canMatchParent) {
                const parentId = parentEntry?.current?.id ?? null;
                current = takeUnmatchedBackupRestoreItem(
                    currentFoldersByLocation.get(backupRestoreFolderMatchKey(parentId, record.title)),
                    matchedCurrentItems,
                );
                if (current) matchType = 'folder';
            }
        }
        if (current) matchedCurrentItems.add(current);

        let effectiveSyncId = current?.syncId || '';
        if (!effectiveSyncId && preferredSyncId && !reservedSyncIds.has(preferredSyncId)) {
            effectiveSyncId = preferredSyncId;
        }
        while (!effectiveSyncId || usedEffectiveSyncIds.has(effectiveSyncId)) effectiveSyncId = createUuid();
        usedEffectiveSyncIds.add(effectiveSyncId);

        const parentEntry = record.parentKey ? entriesByKey.get(record.parentKey) : null;
        const parentEffectiveSyncId = parentEntry?.effectiveSyncId || null;
        const changedFields = current
            ? getBackupRestoreChangedFields(record, current, parentEffectiveSyncId, currentParentSyncIds)
            : [];
        const entry = {
            key: record.sourceKey,
            record,
            current,
            matchType,
            folder,
            effectiveSyncId,
            parentEffectiveSyncId,
            pathTitles: parentEntry
                ? [...parentEntry.pathTitles, parentEntry.record.title]
                : [],
            changedFields,
            category: current ? (changedFields.length ? 'update' : 'same') : 'add',
        };
        entries.push(entry);
        entriesByKey.set(entry.key, entry);
    });

    const currentOnly = currentItems.filter((item) => !matchedCurrentItems.has(item));
    return {
        entries,
        entriesByKey,
        currentItems,
        currentOnly,
        currentSignature: createBackupRestoreCurrentSignature(currentItems),
        counts: {
            add: entries.filter((entry) => entry.category === 'add').length,
            update: entries.filter((entry) => entry.category === 'update').length,
            same: entries.filter((entry) => entry.category === 'same').length,
            remove: currentOnly.length,
        },
    };
}

function backupRestoreFolderMatchKey(parentId, title) {
    return `${parentId == null ? 'root' : String(parentId)}\u0000${String(title || '').trim().toLocaleLowerCase('en-US')}`;
}

function takeUnmatchedBackupRestoreItem(candidates = [], matchedItems) {
    return candidates.find((item) => !matchedItems.has(item)) || null;
}

function getBackupRestoreChangedFields(record, current, parentSyncId, currentParentSyncIds) {
    const changed = [];
    if (record.title !== current.title) changed.push('title');
    if (backupRestoreComparableUrl(record.url) !== backupRestoreComparableUrl(current.url)) changed.push('url');
    if ((record.description || '') !== (current.description || '')) changed.push('description');
    const backupTags = parseTags(record.tags).slice().sort();
    const currentTags = parseTags(current.tags).slice().sort();
    if (JSON.stringify(backupTags) !== JSON.stringify(currentTags)) changed.push('tags');
    if ((record.isPinned === true) !== (current.isPinned === true)) changed.push('isPinned');
    const currentParentSyncId = current.parentId == null
        ? null
        : (currentParentSyncIds.get(current.parentId) || null);
    if (parentSyncId !== currentParentSyncId) changed.push('parentSyncId');
    return changed;
}

function backupRestoreComparableUrl(value) {
    if (!value) return '';
    try {
        return normalizeUrl(value);
    } catch {
        return String(value).trim();
    }
}

function createBackupRestoreCurrentSignature(items) {
    const records = items.map((item) => ({
        id: item.id ?? null,
        syncId: item.syncId || '',
        parentId: item.parentId ?? null,
        title: item.title,
        url: item.url || '',
        description: item.description || '',
        tags: parseTags(item.tags),
        isPinned: item.isPinned === true,
        collapsed: item.collapsed === true,
        createdAt: item.createdAt || '',
        updatedAt: item.updatedAt || '',
        modifiedBy: item.modifiedBy || '',
    }));
    records.sort((left, right) => (
        String(left.syncId || left.id).localeCompare(String(right.syncId || right.id))
    ));
    return JSON.stringify(records);
}

function emptyBackupRestorePlan() {
    return {
        entries: [],
        requestedCount: 0,
        autoIncludedCount: 0,
        duplicateCount: 0,
        reusedFolderCount: 0,
        parentSyncIdOverrides: new Map(),
        addCount: 0,
        updateCount: 0,
        removeCount: 0,
        actionCount: 0,
    };
}

function createBackupRestorePlan(diff, mode, selectedKeys = new Set()) {
    if (!diff) return emptyBackupRestorePlan();
    if (mode === 'replace') {
        const actionCount = diff.counts.add + diff.counts.update + diff.counts.remove;
        return {
            ...emptyBackupRestorePlan(),
            entries: diff.entries,
            requestedCount: diff.entries.length,
            addCount: diff.counts.add,
            updateCount: diff.counts.update,
            removeCount: diff.counts.remove,
            actionCount,
        };
    }

    let requestedEntries = [];
    let duplicateCount = 0;
    let reusedFolderCount = 0;
    let parentSyncIdOverrides = new Map();
    if (mode === 'selective') {
        requestedEntries = diff.entries.filter((entry) => (
            entry.category !== 'same' && selectedKeys.has(entry.key)
        ));
    } else {
        const safeMerge = createSafeMergeRestoreEntries(diff);
        requestedEntries = safeMerge.entries;
        duplicateCount = safeMerge.duplicateCount;
        reusedFolderCount = safeMerge.reusedFolderCount;
        parentSyncIdOverrides = safeMerge.parentSyncIdOverrides;
    }

    const requestedKeys = new Set(requestedEntries.map((entry) => entry.key));
    const expandedKeys = mode === 'selective'
        ? expandBackupRestoreEntryKeys(diff, requestedKeys)
        : requestedKeys;
    const entries = diff.entries.filter((entry) => expandedKeys.has(entry.key));
    return {
        ...emptyBackupRestorePlan(),
        entries,
        requestedCount: requestedEntries.length,
        autoIncludedCount: entries.filter((entry) => !requestedKeys.has(entry.key)).length,
        duplicateCount,
        reusedFolderCount,
        parentSyncIdOverrides,
        addCount: entries.filter((entry) => entry.category === 'add').length,
        updateCount: entries.filter((entry) => entry.category === 'update').length,
        actionCount: entries.length,
    };
}

function createSafeMergeRestoreEntries(diff) {
    const knownUrls = new Set(
        diff.currentItems
            .map((item) => item.url)
            .filter(Boolean)
            .map(canonicalUrl)
            .filter(Boolean),
    );
    const currentFolders = new Map();
    diff.currentItems.filter((item) => !item.url).forEach((folder) => {
        const key = backupRestoreFolderMatchKey(folder.parentId, folder.title);
        if (!currentFolders.has(key)) currentFolders.set(key, []);
        currentFolders.get(key).push(folder);
    });

    const entries = [];
    const resolutions = new Map();
    const parentSyncIdOverrides = new Map();
    let duplicateCount = 0;
    let reusedFolderCount = 0;
    diff.entries.forEach((entry) => {
        if (entry.current) {
            resolutions.set(entry.key, { existing: entry.current });
            return;
        }
        const parentResolution = entry.record.parentKey
            ? resolutions.get(entry.record.parentKey)
            : { existing: null };
        if (!entry.record.url && parentResolution && Object.hasOwn(parentResolution, 'existing')) {
            const parentId = parentResolution.existing?.id ?? null;
            const match = (currentFolders.get(backupRestoreFolderMatchKey(parentId, entry.record.title)) || [])[0];
            if (match) {
                resolutions.set(entry.key, { existing: match });
                reusedFolderCount += 1;
                return;
            }
        }
        if (entry.record.url) {
            const url = canonicalUrl(entry.record.url);
            if (url && knownUrls.has(url)) {
                duplicateCount += 1;
                return;
            }
            if (url) knownUrls.add(url);
        }
        entries.push(entry);
        resolutions.set(entry.key, { entry });
        if (parentResolution?.existing?.syncId) {
            parentSyncIdOverrides.set(entry.key, parentResolution.existing.syncId);
        }
    });
    return { entries, duplicateCount, reusedFolderCount, parentSyncIdOverrides };
}

function expandBackupRestoreEntryKeys(diff, selectedKeys) {
    const expanded = new Set(selectedKeys);
    const queue = [...expanded];
    while (queue.length) {
        const entry = diff.entriesByKey.get(queue.shift());
        const parent = entry?.record.parentKey
            ? diff.entriesByKey.get(entry.record.parentKey)
            : null;
        if (!parent || parent.current || expanded.has(parent.key)) continue;
        expanded.add(parent.key);
        queue.push(parent.key);
    }
    return expanded;
}

function backupRestoreEntryToSyncItem(entry, parentSyncIdOverride) {
    const source = entry.record;
    return {
        syncId: entry.effectiveSyncId,
        parentSyncId: parentSyncIdOverride === undefined
            ? entry.parentEffectiveSyncId
            : parentSyncIdOverride,
        title: source.title,
        url: source.url,
        description: source.description || '',
        tags: parseTags(source.tags),
        isPinned: source.isPinned === true,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        modifiedBy: source.modifiedBy || state.sync.deviceId,
    };
}

function recordsForFullBackupRestore(diff) {
    return diff.entries.map((entry) => ({
        ...entry.record,
        syncId: entry.effectiveSyncId,
    }));
}

function refreshOpenBackupRestoreComparison() {
    const session = backupRestoreSession;
    if (!session?.selectedRecords || !session.diff || session.applying) return;
    const signature = createBackupRestoreCurrentSignature(state.items);
    if (signature === session.diff.currentSignature) return;
    rebaseBackupRestoreComparison(state.items, t('backupRestoreDataChanged'));
    renderBackupRestoreDialog();
}

function rebaseBackupRestoreComparison(currentItems, message = '') {
    const session = backupRestoreSession;
    if (!session?.selectedRecords) return;
    const previousSelection = new Set(session.selectedKeys);
    session.diff = createBackupRestoreDiff(session.selectedRecords, currentItems);
    const actionableKeys = new Set(
        session.diff.entries
            .filter((entry) => entry.category !== 'same')
            .map((entry) => entry.key),
    );
    session.selectedKeys = new Set(
        [...previousSelection].filter((key) => actionableKeys.has(key)),
    );
    if (message) session.error = message;
}

async function applySelectedBackupRestore() {
    const session = backupRestoreSession;
    if (
        !session
        || session.applying
        || session.selectedLoading
        || !session.selectedRecords
        || !session.diff
    ) return;
    if (preventMutationDuringSync()) return;
    const snapshot = session.snapshots.find((entry) => entry.id === session.selectedId && !entry.invalid);
    if (!snapshot) return;
    const previewPlan = createBackupRestorePlan(session.diff, session.mode, session.selectedKeys);
    if (!previewPlan.actionCount) return;
    if (
        session.mode === 'replace'
        && !window.confirm(t('backupRestoreReplaceConfirm', {
            add: session.diff.counts.add,
            update: session.diff.counts.update,
            remove: session.diff.counts.remove,
        }))
    ) return;

    session.applying = true;
    session.error = '';
    renderBackupRestoreDialog();
    try {
        const mutation = await runUserDataMutation(async () => {
            const latestItems = (await getAllItems()).map(normalizeItem);
            const latestSignature = createBackupRestoreCurrentSignature(latestItems);
            if (latestSignature !== session.diff.currentSignature) {
                await refreshData();
                rebaseBackupRestoreComparison(state.items, t('backupRestoreDataChanged'));
                session.applying = false;
                renderBackupRestoreDialog();
                return { stale: true };
            }

            const plan = createBackupRestorePlan(session.diff, session.mode, session.selectedKeys);
            if (!plan.actionCount) {
                session.applying = false;
                renderBackupRestoreDialog();
                return { noAction: true };
            }

            const emergencyEncryption = getRestoreEmergencyEncryptionContext(session, snapshot);
            const emergencyName = await writeRestoreEmergencyBackup(
                session.handle,
                emergencyEncryption,
            );
            let restoredCount = 0;
            if (session.mode === 'replace') {
                restoredCount = await replaceItemsFromRestore(
                    recordsForFullBackupRestore(session.diff),
                    state.items,
                );
            } else {
                await restoreResolvedSyncItems(plan.entries.map((entry) => backupRestoreEntryToSyncItem(
                    entry,
                    plan.parentSyncIdOverrides.get(entry.key),
                )));
                restoredCount = plan.entries.length;
            }

            state.view = { type: 'all', value: null };
            state.query = '';
            ui.searchInput.value = '';
            ui.clearSearchButton.classList.add('hidden');
            ui.searchShortcut.classList.remove('hidden');
            await refreshData();
            await adoptBackupRestoreDirectory(session.handle, snapshot.exportedAt, {
                encrypted: snapshot.encrypted,
                passphrase: snapshot.encrypted ? session.passphrase : '',
                rememberSession: snapshot.encrypted && session.rememberSession,
            });
            scheduleDataProtection();
            return {
                mode: session.mode,
                restoredCount,
                duplicateCount: plan.duplicateCount,
                reusedFolderCount: plan.reusedFolderCount,
                autoIncludedCount: plan.autoIncludedCount,
                emergencyName,
            };
        });
        if (!mutation.applied) {
            session.applying = false;
            renderBackupRestoreDialog();
            return;
        }
        const result = mutation.value;
        if (result.stale || result.noAction) return;
        session.applying = false;
        closeBackupRestoreDialog(false);
        const toastKey = {
            merge: 'backupRestoreMerged',
            selective: 'backupRestoreSelected',
            replace: 'backupRestoreReplaced',
        }[result.mode];
        showToast(t(toastKey, {
            count: result.restoredCount,
            duplicates: result.duplicateCount,
            folders: result.reusedFolderCount,
            automatic: result.autoIncludedCount,
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

function getRestoreEmergencyEncryptionContext(session, snapshot) {
    if (snapshot.encrypted) {
        if (session.passphrase.length < 8) {
            const error = new Error(t('backupRestorePassphraseRequired'));
            error.code = 'BACKUP_PASSPHRASE_REQUIRED';
            throw error;
        }
        return { encrypted: true, passphrase: session.passphrase };
    }
    return getCurrentBackupEncryptionContext();
}

async function writeRestoreEmergencyBackup(
    directory,
    encryption = getCurrentBackupEncryptionContext(),
    fileLockHeld = false,
) {
    if (!fileLockHeld) {
        return withBackupFileLock(() => writeRestoreEmergencyBackup(
            directory,
            encryption,
            true,
        ));
    }
    if (!await ensureBackupProtectionProfileCurrent()) {
        throw new Error(t('backupSettingsChangedOtherTab'));
    }
    const permission = await getBackupPermission(directory, true);
    if (permission !== 'granted') throw new Error(t('backupRestoreEmergencyPermission'));
    const emergency = await directory.getDirectoryHandle('emergency', { create: true });
    const filename = backupEmergencyFilename(new Date(), encryption.encrypted);
    const payload = { ...createBackupPayload(), reason: 'before-restore' };
    const content = await createBackupFileContent(payload, encryption);
    await writeBackupFile(emergency, filename, content);
    try {
        await pruneNamedBackupFiles(
            emergency,
            /^bookmarks-before-restore-.*(?:\.enc)?\.json$/,
            EMERGENCY_BACKUP_RETENTION,
        );
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

async function adoptBackupRestoreDirectory(handle, lastBackupAt, options = {}) {
    state.backup.handle = handle;
    state.backup.permission = 'granted';
    state.backup.enabled = true;
    state.backup.error = '';
    if (options.encrypted) {
        const passphraseChanged = !state.backup.encryptionEnabled
            || state.backup.passphrase !== options.passphrase;
        state.backup.encryptionEnabled = true;
        state.backup.passphrase = options.passphrase;
        state.backup.passphraseConfirmed = true;
        state.backup.passphraseNeedsVerification = false;
        state.backup.passphraseChecking = false;
        state.backup.passphraseCheckToken = '';
        state.backup.passphraseError = '';
        state.backup.rememberSession = options.rememberSession === true;
        if (passphraseChanged || !state.backup.encryptionProfileId) {
            state.backup.encryptionProfileId = createUuid();
        }
        if (state.backup.rememberSession) saveSessionBackupCredentials();
        else clearSessionBackupCredentials();
    }
    state.backup.permissionNoticeShown = false;
    state.backup.lastNotifiedError = '';
    state.backup.lastHash = '';
    invalidateBackupHealth();
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
    for (const name of ['bookmarks-latest.enc.json', 'bookmarks-latest.json']) {
        try {
            await directory.getFileHandle(name);
            return true;
        } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
        }
    }
    for (const [directoryName, pattern] of [
        ['history', /^bookmarks-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/],
        ['emergency', /^bookmarks-before-restore-.*(?:\.enc)?\.json$/],
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
