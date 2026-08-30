/* Persistent storage and local automatic backups. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function initializePersistentStorage() {
    if (!navigator.storage?.persisted || !navigator.storage?.persist) {
        state.persistence = 'unsupported';
        renderBackupSettings();
        return;
    }

    try {
        if (await navigator.storage.persisted()) {
            state.persistence = 'granted';
        } else {
            state.persistence = await navigator.storage.persist() ? 'granted' : 'not-granted';
        }
    } catch {
        state.persistence = 'not-granted';
    }
    renderBackupSettings();
}

async function requestPersistentStorage(notify = false) {
    if (!navigator.storage?.persist) {
        state.persistence = 'unsupported';
        renderBackupSettings();
        return false;
    }

    try {
        state.persistence = await navigator.storage.persist() ? 'granted' : 'not-granted';
    } catch {
        state.persistence = 'not-granted';
    }
    renderBackupSettings();
    if (notify) {
        const granted = state.persistence === 'granted';
        showToast(t(granted ? 'persistenceGrantedToast' : 'persistenceDeniedToast'), granted ? 'success' : 'warning');
    }
    return state.persistence === 'granted';
}

function backupEncryptionReady() {
    return !state.backup.encryptionEnabled || (
        state.backup.encryptionSupported
        && state.backup.passphrase.length >= 8
        && state.backup.passphraseConfirmed
    );
}

function getCurrentBackupEncryptionContext() {
    if (!state.backup.encryptionEnabled) return { encrypted: false, passphrase: '' };
    if (!state.backup.encryptionSupported) {
        const error = new Error(t('backupEncryptionUnavailable'));
        error.code = 'BACKUP_ENCRYPTION_UNSUPPORTED';
        throw error;
    }
    if (!backupEncryptionReady()) {
        const error = new Error(t('backupPassphraseRequired'));
        error.code = 'BACKUP_PASSPHRASE_REQUIRED';
        throw error;
    }
    return { encrypted: true, passphrase: state.backup.passphrase };
}

function populateBackupEncryptionInputs() {
    if (!ui.backupPassphraseInput) return;
    ui.backupPassphraseInput.value = state.backup.passphrase;
    ui.backupPassphraseConfirmInput.value = state.backup.passphraseConfirmed
        ? state.backup.passphrase
        : '';
    ui.backupRememberSessionToggle.checked = state.backup.rememberSession;
}

function restoreSessionBackupCredentials() {
    if (!state.backup.encryptionEnabled || !state.backup.encryptionSupported || !isPageReload()) {
        clearSessionBackupCredentials();
        return false;
    }
    const raw = safeSessionStorageGet(BACKUP_SESSION_CREDENTIALS_KEY);
    if (!raw) return false;
    try {
        const saved = JSON.parse(raw);
        if (
            saved?.version !== 1
            || saved.profileId !== state.backup.encryptionProfileId
            || typeof saved.passphrase !== 'string'
            || saved.passphrase.length < 8
        ) {
            clearSessionBackupCredentials();
            return false;
        }
        state.backup.passphrase = saved.passphrase;
        state.backup.passphraseConfirmed = true;
        state.backup.rememberSession = true;
        state.backup.sessionCredentialsRestored = true;
        return true;
    } catch {
        clearSessionBackupCredentials();
        return false;
    }
}

function saveSessionBackupCredentials() {
    if (!state.backup.rememberSession || !backupEncryptionReady()) return false;
    const saved = safeSessionStorageSet(BACKUP_SESSION_CREDENTIALS_KEY, JSON.stringify({
        version: 1,
        profileId: state.backup.encryptionProfileId,
        passphrase: state.backup.passphrase,
        savedAt: new Date().toISOString(),
    }));
    state.backup.sessionCredentialsRestored = saved;
    return saved;
}

function clearSessionBackupCredentials() {
    safeSessionStorageRemove(BACKUP_SESSION_CREDENTIALS_KEY);
    state.backup.sessionCredentialsRestored = false;
}

function handleBackupHistoryRestore(event) {
    if (!event.persisted) return;
    window.clearTimeout(state.backup.timer);
    state.backup.passphrase = '';
    state.backup.passphraseConfirmed = false;
    state.backup.rememberSession = false;
    clearSessionBackupCredentials();
    safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    if (typeof clearBackupRestoreCredentialsAfterHistoryRestore === 'function') {
        clearBackupRestoreCredentialsAfterHistoryRestore();
    }
    populateBackupEncryptionInputs();
    renderBackupSettings();
}

async function handleBackupEncryptionToggle() {
    const backup = state.backup;
    const enable = ui.backupEncryptionToggle.checked;
    if (enable && !backup.encryptionSupported) {
        ui.backupEncryptionToggle.checked = false;
        showToast(t('backupEncryptionUnavailable'), 'warning');
        return;
    }
    if (!enable && backup.encryptionEnabled && !window.confirm(t('confirmDisableBackupEncryption'))) {
        ui.backupEncryptionToggle.checked = true;
        return;
    }

    window.clearTimeout(backup.timer);
    backup.encryptionEnabled = enable;
    backup.encryptionProfileId = enable ? createUuid() : '';
    backup.passphrase = '';
    backup.passphraseConfirmed = false;
    backup.rememberSession = false;
    backup.lastHash = '';
    backup.error = '';
    clearSessionBackupCredentials();
    if (!enable) {
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
        if (typeof clearBackupRestoreMemoryCredentials === 'function') {
            clearBackupRestoreMemoryCredentials();
        }
    }
    await saveBackupPreferences();
    populateBackupEncryptionInputs();
    renderBackupSettings();
    if (enable) {
        showToast(t('backupEncryptionEnabled'));
        window.requestAnimationFrame(() => ui.backupPassphraseInput.focus());
    } else {
        showToast(t('backupEncryptionDisabled'), 'warning');
        if (backup.enabled && backup.handle) scheduleAutoBackup(150);
    }
}

async function handleBackupEncryptionInput() {
    const backup = state.backup;
    const wasReady = backupEncryptionReady();
    const previousPassphrase = backup.passphrase;
    backup.passphrase = ui.backupPassphraseInput.value;
    backup.passphraseConfirmed = backup.passphrase.length >= 8
        && ui.backupPassphraseConfirmInput.value === backup.passphrase;
    const changed = previousPassphrase !== backup.passphrase;
    if (changed || (wasReady && !backup.passphraseConfirmed)) {
        clearSessionBackupCredentials();
        backup.lastHash = '';
    }
    const ready = backupEncryptionReady();
    const credentialsChangedAndReady = ready && (!wasReady || changed);
    if (credentialsChangedAndReady) {
        backup.encryptionProfileId = createUuid();
        backup.lastHash = '';
        await saveBackupPreferences();
    }
    if (backup.rememberSession && ready) saveSessionBackupCredentials();
    backup.error = '';
    renderBackupSettings();
    if (credentialsChangedAndReady && backup.enabled && backup.handle) scheduleAutoBackup(900);
}

function handleBackupRememberSession() {
    const backup = state.backup;
    const remember = ui.backupRememberSessionToggle.checked;
    if (remember && !backupEncryptionReady()) {
        ui.backupRememberSessionToggle.checked = false;
        showToast(t('backupPassphraseRequired'), 'warning');
        return;
    }
    backup.rememberSession = remember;
    if (remember) {
        if (!saveSessionBackupCredentials()) {
            backup.rememberSession = false;
            ui.backupRememberSessionToggle.checked = false;
            showToast(t('sessionStorageUnavailable'), 'warning');
            renderBackupSettings();
            return;
        }
        showToast(t('backupSessionPassphraseRemembered'));
    } else {
        clearSessionBackupCredentials();
        showToast(t('backupSessionPassphraseCleared'));
    }
    renderBackupSettings();
}

async function initializeBackup() {
    if (!isPageReload()) {
        clearSessionBackupCredentials();
        safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    }
    renderBackupSettings();
    if (!state.backup.supported) return;

    let preferencesChanged = false;
    try {
        const [handle, preferences] = await Promise.all([
            getSetting(BACKUP_HANDLE_KEY),
            getSetting(BACKUP_PREFERENCES_KEY),
        ]);
        if (handle?.kind === 'directory') state.backup.handle = handle;
        if (preferences && typeof preferences === 'object') {
            state.backup.enabled = preferences.enabled === true;
            state.backup.retention = [7, 30, 90].includes(Number(preferences.retention))
                ? Number(preferences.retention)
                : 30;
            state.backup.encryptionEnabled = preferences.encryptionEnabled === true;
            state.backup.encryptionProfileId = typeof preferences.encryptionProfileId === 'string'
                ? preferences.encryptionProfileId
                : '';
            state.backup.lastBackupAt = validDate(preferences.lastBackupAt) ? preferences.lastBackupAt : '';
            state.backup.lastHash = typeof preferences.lastHash === 'string' ? preferences.lastHash : '';
        }
        if (
            state.backup.encryptionEnabled
            && state.backup.encryptionSupported
            && !state.backup.encryptionProfileId
        ) {
            state.backup.encryptionProfileId = createUuid();
            preferencesChanged = true;
        }
        restoreSessionBackupCredentials();
        if (state.backup.handle) {
            state.backup.permission = await getBackupPermission(state.backup.handle, false);
        }
        if (preferencesChanged) await saveBackupPreferences();
    } catch (error) {
        console.error('Unable to restore automatic backup settings:', error);
        state.backup.error = error?.message || String(error);
    }

    renderBackupSettings();
    if (
        state.backup.enabled
        && state.backup.permission === 'granted'
        && backupEncryptionReady()
    ) scheduleAutoBackup(250);
}

async function saveBackupPreferences() {
    try {
        await saveSetting(BACKUP_PREFERENCES_KEY, {
            enabled: state.backup.enabled,
            retention: state.backup.retention,
            encryptionEnabled: state.backup.encryptionEnabled,
            encryptionProfileId: state.backup.encryptionProfileId,
            lastBackupAt: state.backup.lastBackupAt,
            lastHash: state.backup.lastHash,
        });
        return true;
    } catch (error) {
        console.warn('Unable to save automatic backup preferences:', error);
        return false;
    }
}

function openBackupDialog() {
    closeExportMenu();
    populateBackupEncryptionInputs();
    renderBackupSettings();
    ui.backupDialog.showModal();
}

function closeBackupDialog() {
    if (ui.backupDialog.open) ui.backupDialog.close();
}

function renderBackupSettings() {
    if (!ui.backupMenuStatus) return;
    const backup = state.backup;
    let status = 'ready';
    if (!backup.supported) status = 'unsupported';
    else if (backup.running) status = 'running';
    else if (backup.error) status = 'error';
    else if (!backup.handle) status = 'not-configured';
    else if (backup.permission !== 'granted') status = 'permission';
    else if (backup.encryptionEnabled && !backup.encryptionSupported) status = 'encryption-unsupported';
    else if (backup.encryptionEnabled && !backupEncryptionReady()) status = 'locked';
    else if (!backup.enabled) status = 'paused';

    const statusContent = {
        unsupported: [t('backupUnsupportedTitle'), t('backupUnsupportedDetail'), t('backupMenuUnsupported')],
        'encryption-unsupported': [
            t('backupEncryptionUnsupportedTitle'),
            t('backupEncryptionUnsupportedDetail'),
            t('backupMenuEncryptionUnsupported'),
        ],
        running: [
            t('backupRunningTitle'),
            t(backup.encryptionEnabled ? 'backupRunningEncryptedDetail' : 'backupRunningDetail'),
            t('backupMenuRunning'),
        ],
        error: [t('backupErrorTitle'), t('backupErrorDetail', { message: backup.error }), t('backupMenuError')],
        'not-configured': [t('backupNotConfiguredTitle'), t('backupNotConfiguredDetail'), t('backupMenuNotConfigured')],
        paused: [t('backupPausedTitle'), t('backupPausedDetail'), t('backupMenuPaused')],
        permission: [t('backupPermissionTitle'), t('backupPermissionDetail'), t('backupMenuPermission')],
        locked: [t('backupEncryptionLockedTitle'), t('backupEncryptionLockedDetail'), t('backupMenuLocked')],
        ready: [
            t('backupReadyTitle'),
            backup.handleRemembered === false
                ? t('backupHandleNotRemembered')
                : t(backup.encryptionEnabled ? 'backupReadyEncryptedDetail' : 'backupReadyDetail', {
                    name: backup.handle?.name || t('backupNotSelected'),
                }),
            t('backupMenuReady', { time: formatBackupTime(backup.lastBackupAt, true) }),
        ],
    }[status];

    ui.backupStatusCard.dataset.state = status;
    ui.backupSettingsButton.dataset.state = status;
    ui.exportMenu.dataset.backupState = status;
    ui.backupStatusTitle.textContent = statusContent[0];
    ui.backupStatusDetail.textContent = statusContent[1];
    ui.backupMenuStatus.textContent = statusContent[2];
    ui.backupDirectoryName.textContent = backup.handle?.name || t('backupNotSelected');
    ui.lastBackupValue.textContent = formatBackupTime(backup.lastBackupAt) || t('lastBackupNever');
    ui.autoBackupToggle.checked = backup.enabled;
    ui.autoBackupToggle.disabled = !backup.supported || backup.running;
    ui.backupEncryptionToggle.checked = backup.encryptionEnabled;
    ui.backupEncryptionToggle.disabled = !backup.supported
        || backup.running
        || (!backup.encryptionSupported && !backup.encryptionEnabled);
    ui.backupEncryptionFields.classList.toggle('hidden', !backup.encryptionEnabled);
    ui.backupPassphraseInput.disabled = !backup.supported || backup.running || !backup.encryptionSupported;
    ui.backupPassphraseConfirmInput.disabled = !backup.supported || backup.running || !backup.encryptionSupported;
    ui.backupRememberSessionToggle.checked = backup.rememberSession;
    ui.backupRememberSessionToggle.disabled = !backup.supported
        || backup.running
        || !backup.encryptionSupported
        || !backupEncryptionReady();
    const encryptionState = !backup.encryptionEnabled
        ? 'off'
        : !backup.encryptionSupported
            ? 'unsupported'
            : backupEncryptionReady()
                ? 'ready'
                : backup.passphrase.length < 8 ? 'required' : 'mismatch';
    ui.backupEncryptionStatus.dataset.state = encryptionState;
    ui.backupEncryptionStatus.textContent = t({
        off: 'backupEncryptionOff',
        unsupported: 'backupEncryptionUnavailable',
        ready: 'backupEncryptionReady',
        required: 'backupPassphraseRequired',
        mismatch: 'backupPassphraseMismatch',
    }[encryptionState]);
    ui.backupRetentionSelect.value = String(backup.retention);
    ui.backupRetentionSelect.disabled = !backup.supported || !backup.handle || backup.running;
    ui.chooseBackupDirectoryButton.disabled = !backup.supported || backup.running;
    ui.restoreBackupButton.disabled = !backup.supported || backup.running;
    ui.backupNowButton.disabled = backup.running;
    ui.backupNowButton.textContent = backup.supported ? t('backupNow') : t('jsonBackup');
    ui.disconnectBackupButton.classList.toggle('hidden', !backup.handle);
    ui.disconnectBackupButton.disabled = backup.running;

    const persistenceText = {
        checking: t('persistenceChecking'),
        granted: t('persistenceGranted'),
        'not-granted': t('persistenceNotGranted'),
        unsupported: t('persistenceUnsupported'),
    }[state.persistence] || t('persistenceChecking');
    ui.persistenceStatusValue.textContent = persistenceText;
    ui.requestPersistenceButton.classList.toggle(
        'hidden',
        state.persistence === 'granted' || state.persistence === 'unsupported' || state.persistence === 'checking',
    );
}

async function handleAutoBackupToggle() {
    if (!state.backup.supported) {
        ui.autoBackupToggle.checked = false;
        return;
    }
    if (ui.autoBackupToggle.checked && !state.backup.handle) {
        ui.autoBackupToggle.checked = false;
        await chooseBackupDirectory();
        return;
    }

    if (ui.autoBackupToggle.checked) {
        const permission = await getBackupPermission(state.backup.handle, true);
        state.backup.permission = permission;
        if (permission !== 'granted') {
            state.backup.enabled = false;
            ui.autoBackupToggle.checked = false;
            renderBackupSettings();
            showToast(t('backupPermissionDenied'));
            return;
        }
        state.backup.enabled = true;
        state.backup.error = '';
        state.backup.permissionNoticeShown = false;
        await saveBackupPreferences();
        renderBackupSettings();
        showToast(t('autoBackupEnabled'));
        await runAutomaticBackup({ force: false, notify: false });
    } else {
        state.backup.enabled = false;
        window.clearTimeout(state.backup.timer);
        await saveBackupPreferences();
        renderBackupSettings();
        showToast(t('autoBackupPaused'));
    }
}

async function chooseBackupDirectory() {
    if (!state.backup.supported) return;
    try {
        const handle = await window.showDirectoryPicker({
            id: 'bookmark-manager-backup',
            mode: 'readwrite',
        });
        const permission = await getBackupPermission(handle, true);
        if (permission !== 'granted') {
            showToast(t('backupPermissionDenied'));
            return;
        }
        if (!state.items.length && await backupDirectoryContainsPotentialSnapshots(handle)) {
            await openBackupRestoreDialog({ handle, returnToBackupDialog: ui.backupDialog.open });
            return;
        }

        state.backup.handle = handle;
        state.backup.permission = permission;
        state.backup.enabled = true;
        state.backup.error = '';
        state.backup.permissionNoticeShown = false;
        state.backup.lastNotifiedError = '';
        state.backup.lastHash = '';
        state.backup.handleRemembered = true;
        try {
            await saveSetting(BACKUP_HANDLE_KEY, handle);
        } catch (error) {
            console.warn('The browser could not persist the directory handle:', error);
            state.backup.handleRemembered = false;
        }
        await saveBackupPreferences();
        renderBackupSettings();
        await runAutomaticBackup({ force: true, notify: true });
    } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error('Unable to select backup directory:', error);
        state.backup.error = error?.message || String(error);
        renderBackupSettings();
        showToast(t('backupFailed', { message: state.backup.error }));
    }
}

async function handleBackupRetentionChange() {
    const retention = Number(ui.backupRetentionSelect.value);
    state.backup.retention = [7, 30, 90].includes(retention) ? retention : 30;
    await saveBackupPreferences();
    if (state.backup.handle && state.backup.permission === 'granted') {
        try {
            const history = await state.backup.handle.getDirectoryHandle('history', { create: true });
            await pruneBackupHistory(history, state.backup.retention);
        } catch (error) {
            console.warn('Unable to prune backup history:', error);
        }
    }
    renderBackupSettings();
}

async function disconnectBackupDirectory() {
    if (!state.backup.handle || !window.confirm(t('confirmDisconnect'))) return;
    window.clearTimeout(state.backup.timer);
    try {
        await deleteSetting(BACKUP_HANDLE_KEY);
    } catch (error) {
        console.warn('Unable to remove stored directory handle:', error);
    }
    state.backup.handle = null;
    state.backup.enabled = false;
    state.backup.permission = 'unknown';
    state.backup.error = '';
    state.backup.permissionNoticeShown = false;
    state.backup.lastNotifiedError = '';
    state.backup.lastHash = '';
    state.backup.lastBackupAt = '';
    state.backup.encryptionEnabled = false;
    state.backup.encryptionProfileId = '';
    state.backup.passphrase = '';
    state.backup.passphraseConfirmed = false;
    state.backup.rememberSession = false;
    state.backup.handleRemembered = true;
    clearSessionBackupCredentials();
    safeSessionStorageRemove(BACKUP_RESTORE_SESSION_CREDENTIALS_KEY);
    if (typeof clearBackupRestoreMemoryCredentials === 'function') {
        clearBackupRestoreMemoryCredentials();
    }
    populateBackupEncryptionInputs();
    await saveBackupPreferences();
    renderBackupSettings();
    showToast(t('backupDisconnected'));
}

async function handleBackupNow() {
    if (!state.backup.supported) {
        closeBackupDialog();
        exportJson();
        return;
    }
    if (!state.backup.handle) {
        await chooseBackupDirectory();
        return;
    }
    state.backup.permission = await getBackupPermission(state.backup.handle, true);
    if (state.backup.permission !== 'granted') {
        renderBackupSettings();
        showToast(t('backupPermissionDenied'));
        return;
    }
    await runAutomaticBackup({ force: true, notify: true, allowWhenPaused: true });
}

async function getBackupPermission(handle, requestPermission) {
    if (!handle) return 'unknown';
    if (typeof handle.queryPermission !== 'function') return 'granted';
    try {
        let permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'prompt' && requestPermission && typeof handle.requestPermission === 'function') {
            permission = await handle.requestPermission({ mode: 'readwrite' });
        }
        return permission;
    } catch {
        return 'denied';
    }
}

function scheduleAutoBackup(delay = 900) {
    if (
        !state.backup.supported
        || !state.backup.enabled
        || !state.backup.handle
        || !backupEncryptionReady()
    ) return;
    window.clearTimeout(state.backup.timer);
    state.backup.timer = window.setTimeout(() => {
        runAutomaticBackup({ force: false, notify: false });
    }, delay);
}

async function flushBackupBeforeDestructiveChange() {
    if (!state.backup.enabled || !state.backup.handle) return;
    window.clearTimeout(state.backup.timer);
    await runAutomaticBackup({ force: false, notify: false });
}

async function runAutomaticBackup({ force = false, notify = false, allowWhenPaused = false } = {}) {
    const backup = state.backup;
    if (!backup.supported || (!backup.enabled && !allowWhenPaused) || !backup.handle) return false;
    if (backup.encryptionEnabled && !backupEncryptionReady()) {
        if (notify) {
            showToast(t(backup.encryptionSupported
                ? 'backupPassphraseRequired'
                : 'backupEncryptionUnavailable'), 'warning');
            if (ui.backupDialog?.open && backup.encryptionSupported) {
                window.requestAnimationFrame(() => ui.backupPassphraseInput.focus());
            }
        }
        renderBackupSettings();
        return false;
    }
    if (backup.running) {
        backup.pending = true;
        return backup.currentPromise || false;
    }

    backup.running = true;
    backup.error = '';
    window.clearTimeout(backup.timer);
    renderBackupSettings();

    const operation = (async () => {
        backup.permission = await getBackupPermission(backup.handle, false);
        if (backup.permission !== 'granted') {
            if (notify || !backup.permissionNoticeShown) showToast(t('backupPermissionDenied'));
            backup.permissionNoticeShown = true;
            return false;
        }
        backup.permissionNoticeShown = false;

        const stableContent = JSON.stringify(state.items.map(toStorageRecord));
        const protectionFingerprint = backup.encryptionEnabled
            ? `encrypted:${backup.encryptionProfileId}`
            : 'plaintext';
        const hashInput = `${protectionFingerprint}\u0000${stableContent}`;
        const contentHash = `${hashString(hashInput)}-${hashInput.length}`;
        if (!force && contentHash === backup.lastHash) {
            if (notify) showToast(t('backupUpToDate'));
            return true;
        }

        const payload = createBackupPayload();
        const encryption = getCurrentBackupEncryptionContext();
        const content = await createBackupFileContent(payload, encryption);
        await writeLatestBackupFile(backup.handle, content, encryption.encrypted, false);
        const history = await backup.handle.getDirectoryHandle('history', { create: true });
        const snapshotName = backupSnapshotFilename(new Date(), encryption.encrypted);
        await writeBackupFile(history, snapshotName, content);
        await removeBackupFileIfExists(backup.handle, backupLatestFilename(!encryption.encrypted));
        try {
            await pruneBackupHistory(history, backup.retention);
        } catch (error) {
            console.warn('Unable to prune backup history:', error);
        }

        backup.lastHash = contentHash;
        backup.lastBackupAt = payload.exportedAt;
        backup.lastNotifiedError = '';
        try {
            await saveBackupPreferences();
        } catch (error) {
            console.warn('Unable to save backup metadata:', error);
        }
        if (notify) showToast(t(backup.encryptionEnabled ? 'encryptedBackupComplete' : 'backupComplete', {
            count: state.items.length,
        }));
        return true;
    })();

    backup.currentPromise = operation;
    try {
        return await operation;
    } catch (error) {
        console.error('Automatic backup failed:', error);
        backup.error = error?.message || String(error);
        if (notify || backup.lastNotifiedError !== backup.error) {
            showToast(t('backupFailed', { message: backup.error }));
            backup.lastNotifiedError = backup.error;
        }
        return false;
    } finally {
        backup.running = false;
        backup.currentPromise = null;
        renderBackupSettings();
        if (backup.pending) {
            backup.pending = false;
            scheduleAutoBackup(150);
        }
    }
}

async function createBackupFileContent(payload, encryption = getCurrentBackupEncryptionContext()) {
    if (!encryption.encrypted) return `${JSON.stringify(payload, null, 2)}\n`;
    if (!state.backup.encryptionSupported || typeof encryptBackupData !== 'function') {
        throw new Error(t('backupEncryptionUnavailable'));
    }
    if (typeof encryption.passphrase !== 'string' || encryption.passphrase.length < 8) {
        throw new Error(t('backupPassphraseRequired'));
    }
    return encryptBackupData(payload, encryption.passphrase);
}

function backupLatestFilename(encrypted) {
    return encrypted ? 'bookmarks-latest.enc.json' : 'bookmarks-latest.json';
}

function backupSnapshotFilename(date, encrypted) {
    return `bookmarks-${fileTimestamp(date)}${encrypted ? '.enc' : ''}.json`;
}

function backupEmergencyFilename(date, encrypted) {
    return `bookmarks-before-restore-${fileTimestamp(date)}${encrypted ? '.enc' : ''}.json`;
}

async function writeLatestBackupFile(directory, content, encrypted, removeAlternative = true) {
    const filename = backupLatestFilename(encrypted);
    await writeBackupFile(directory, filename, content);
    if (removeAlternative) {
        await removeBackupFileIfExists(directory, backupLatestFilename(!encrypted));
    }
    return filename;
}

async function removeBackupFileIfExists(directory, filename) {
    try {
        await directory.removeEntry(filename);
    } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
    }
}

async function writeBackupFile(directory, filename, content) {
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(content);
        await writable.close();
    } catch (error) {
        try {
            await writable.abort();
        } catch {
            // Ignore a secondary abort failure and preserve the original error.
        }
        throw error;
    }
}

async function pruneBackupHistory(directory, retention) {
    const snapshots = [];
    for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'file' && /^bookmarks-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/.test(name)) snapshots.push(name);
    }
    snapshots.sort().reverse();
    await Promise.all(snapshots.slice(retention).map((name) => directory.removeEntry(name)));
}

function createBackupPayload() {
    const bookmarks = state.items.map(toStorageRecord);
    const folderCount = bookmarks.filter((item) => !item.url).length;
    return {
        format: 'bookmark-manager',
        version: 2,
        exportedAt: new Date().toISOString(),
        summary: {
            items: bookmarks.length,
            bookmarks: bookmarks.length - folderCount,
            folders: folderCount,
        },
        bookmarks,
    };
}

function fileTimestamp(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function formatBackupTime(value, compact = false) {
    if (!validDate(value)) return '';
    const options = compact
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { dateStyle: 'medium', timeStyle: 'short' };
    return new Intl.DateTimeFormat(currentLocale(), options).format(new Date(value));
}
