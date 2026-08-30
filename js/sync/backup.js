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

async function initializeBackup() {
    renderBackupSettings();
    if (!state.backup.supported) return;

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
            state.backup.lastBackupAt = validDate(preferences.lastBackupAt) ? preferences.lastBackupAt : '';
            state.backup.lastHash = typeof preferences.lastHash === 'string' ? preferences.lastHash : '';
        }
        if (state.backup.handle) {
            state.backup.permission = await getBackupPermission(state.backup.handle, false);
        }
    } catch (error) {
        console.error('Unable to restore automatic backup settings:', error);
        state.backup.error = error?.message || String(error);
    }

    renderBackupSettings();
    if (state.backup.enabled && state.backup.permission === 'granted') scheduleAutoBackup(250);
}

async function saveBackupPreferences() {
    try {
        await saveSetting(BACKUP_PREFERENCES_KEY, {
            enabled: state.backup.enabled,
            retention: state.backup.retention,
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
    else if (!backup.enabled) status = 'paused';
    else if (backup.permission !== 'granted') status = 'permission';

    const statusContent = {
        unsupported: [t('backupUnsupportedTitle'), t('backupUnsupportedDetail'), t('backupMenuUnsupported')],
        running: [t('backupRunningTitle'), t('backupRunningDetail'), t('backupMenuRunning')],
        error: [t('backupErrorTitle'), t('backupErrorDetail', { message: backup.error }), t('backupMenuError')],
        'not-configured': [t('backupNotConfiguredTitle'), t('backupNotConfiguredDetail'), t('backupMenuNotConfigured')],
        paused: [t('backupPausedTitle'), t('backupPausedDetail'), t('backupMenuPaused')],
        permission: [t('backupPermissionTitle'), t('backupPermissionDetail'), t('backupMenuPermission')],
        ready: [
            t('backupReadyTitle'),
            backup.handleRemembered === false
                ? t('backupHandleNotRemembered')
                : t('backupReadyDetail', { name: backup.handle?.name || t('backupNotSelected') }),
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
    ui.backupRetentionSelect.value = String(backup.retention);
    ui.backupRetentionSelect.disabled = !backup.supported || !backup.handle || backup.running;
    ui.chooseBackupDirectoryButton.disabled = !backup.supported || backup.running;
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
    state.backup.handleRemembered = true;
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
    if (!state.backup.supported || !state.backup.enabled || !state.backup.handle) return;
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
        const contentHash = `${hashString(stableContent)}-${stableContent.length}`;
        if (!force && contentHash === backup.lastHash) {
            if (notify) showToast(t('backupUpToDate'));
            return true;
        }

        const payload = createBackupPayload();
        const content = `${JSON.stringify(payload, null, 2)}\n`;
        await writeBackupFile(backup.handle, 'bookmarks-latest.json', content);
        const history = await backup.handle.getDirectoryHandle('history', { create: true });
        const snapshotName = `bookmarks-${fileTimestamp(new Date())}.json`;
        await writeBackupFile(history, snapshotName, content);
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
        if (notify) showToast(t('backupComplete', { count: state.items.length }));
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
        if (handle.kind === 'file' && /^bookmarks-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name)) snapshots.push(name);
    }
    snapshots.sort().reverse();
    await Promise.all(snapshots.slice(retention).map((name) => directory.removeEntry(name)));
}

function createBackupPayload() {
    return {
        format: 'bookmark-manager',
        version: 2,
        exportedAt: new Date().toISOString(),
        bookmarks: state.items.map(toStorageRecord),
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
