/* Safe backup passphrase changes and optional retained-snapshot re-encryption. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

const MAX_PASSPHRASE_CHANGE_FILE_BYTES = 80 * 1024 * 1024;
let backupPassphraseChangeSession = null;

function openBackupPassphraseDialog() {
    const backup = state.backup;
    closeExportMenu();
    if (
        !backup.supported
        || !backup.handle
        || !backup.encryptionEnabled
        || !backupEncryptionReady()
        || backup.running
        || backup.health.running
        || preventMutationDuringSync()
    ) {
        showToast(t('backupPassphraseChangeUnavailable'), 'warning');
        return;
    }

    window.clearTimeout(backup.timer);
    window.clearTimeout(backup.health.timer);
    backup.health.timer = null;
    if (ui.backupDialog.open) ui.backupDialog.close();
    backupPassphraseChangeSession = {
        applying: false,
        progress: 0,
        total: 1,
        progressKey: 'backupPassphrasePreparing',
        progressName: '',
        error: '',
        returnToBackupDialog: true,
    };
    ui.currentBackupPassphraseInput.value = '';
    ui.newBackupPassphraseInput.value = '';
    ui.confirmNewBackupPassphraseInput.value = '';
    document.querySelectorAll('input[name="backup-passphrase-change-mode"]').forEach((input) => {
        input.checked = input.value === 'future';
    });
    renderBackupPassphraseDialog();
    if (!ui.backupPassphraseDialog.open) ui.backupPassphraseDialog.showModal();
    window.requestAnimationFrame(() => ui.currentBackupPassphraseInput.focus());
}

function closeBackupPassphraseDialog(reopenBackupDialog = true) {
    const session = backupPassphraseChangeSession;
    if (session?.applying) return;
    const shouldReopen = reopenBackupDialog && session?.returnToBackupDialog;
    if (ui.backupPassphraseDialog.open) ui.backupPassphraseDialog.close();
    ui.currentBackupPassphraseInput.value = '';
    ui.newBackupPassphraseInput.value = '';
    ui.confirmNewBackupPassphraseInput.value = '';
    backupPassphraseChangeSession = null;
    scheduleBackupHealthRecheck();
    if (shouldReopen) openBackupDialog();
}

function renderBackupPassphraseDialog() {
    const session = backupPassphraseChangeSession;
    if (!session) return;
    const disabled = session.applying;
    ui.currentBackupPassphraseInput.disabled = disabled;
    ui.newBackupPassphraseInput.disabled = disabled;
    ui.confirmNewBackupPassphraseInput.disabled = disabled;
    document.querySelectorAll('input[name="backup-passphrase-change-mode"]').forEach((input) => {
        input.disabled = disabled;
    });
    ui.backupPassphraseProgress.classList.toggle('hidden', !session.applying);
    ui.backupPassphraseProgressBar.max = Math.max(1, session.total);
    ui.backupPassphraseProgressBar.value = Math.min(session.progress, session.total);
    ui.backupPassphraseProgressText.textContent = t(session.progressKey, {
        current: session.progress,
        total: session.total,
        name: session.progressName,
    });
    ui.backupPassphraseError.textContent = session.error;
    ui.backupPassphraseError.classList.toggle('hidden', !session.error);
    ui.backupPassphraseCloseButton.disabled = disabled;
    ui.backupPassphraseCancelButton.disabled = disabled;
    ui.backupPassphraseApplyButton.disabled = disabled;
    ui.backupPassphraseApplyButton.textContent = t(disabled
        ? 'changingBackupPassphrase'
        : 'changePassphrase');
}

function normalizedBackupPassphrase(value) {
    return String(value || '').normalize('NFKC');
}

function validateBackupPassphraseChangeInputs() {
    const currentPassphrase = ui.currentBackupPassphraseInput.value;
    const newPassphrase = ui.newBackupPassphraseInput.value;
    const confirmation = ui.confirmNewBackupPassphraseInput.value;
    if (normalizedBackupPassphrase(currentPassphrase) !== normalizedBackupPassphrase(state.backup.passphrase)) {
        throw new Error(t('currentBackupPassphraseIncorrect'));
    }
    if (newPassphrase.length < 8) throw new Error(t('newBackupPassphraseRequired'));
    if (newPassphrase !== confirmation) throw new Error(t('newBackupPassphraseMismatch'));
    if (normalizedBackupPassphrase(newPassphrase) === normalizedBackupPassphrase(currentPassphrase)) {
        throw new Error(t('newBackupPassphraseMustDiffer'));
    }
    return { currentPassphrase, newPassphrase };
}

async function handleBackupPassphraseChange(event) {
    event.preventDefault();
    const session = backupPassphraseChangeSession;
    if (!session || session.applying) return;

    let credentials;
    try {
        credentials = validateBackupPassphraseChangeInputs();
    } catch (error) {
        session.error = error?.message || String(error);
        renderBackupPassphraseDialog();
        return;
    }
    const migrateExisting = document.querySelector(
        'input[name="backup-passphrase-change-mode"]:checked',
    )?.value === 'existing';
    if (
        migrateExisting
        && !window.confirm(t('confirmReencryptExistingBackups'))
    ) return;

    session.applying = true;
    session.error = '';
    renderBackupPassphraseDialog();
    try {
        const mutation = await runUserDataMutation(() => changeBackupPassphraseSafely({
            oldPassphrase: credentials.currentPassphrase,
            newPassphrase: credentials.newPassphrase,
            migrateExisting,
            onProgress: (progress) => {
                if (backupPassphraseChangeSession !== session) return;
                Object.assign(session, progress);
                renderBackupPassphraseDialog();
            },
        }));
        if (!mutation.applied) {
            session.applying = false;
            renderBackupPassphraseDialog();
            return;
        }
        const result = mutation.value;
        session.applying = false;
        closeBackupPassphraseDialog(true);
        showToast(t('backupPassphraseChanged', result), result.skipped || result.cleanupFailed
            ? 'warning'
            : 'success');
    } catch (error) {
        console.error('Backup passphrase change failed:', error);
        if (backupPassphraseChangeSession !== session) return;
        session.applying = false;
        session.error = t('backupPassphraseChangeFailed', {
            message: error?.message || String(error),
        });
        renderBackupPassphraseDialog();
    }
}

async function collectBackupPassphraseCandidates(root, includeRetainedSnapshots) {
    const candidates = [];
    for (const name of ['bookmarks-latest.enc.json', 'bookmarks-latest.json']) {
        try {
            const fileHandle = await root.getFileHandle(name);
            candidates.push({
                kind: 'latest',
                directory: root,
                name,
                fileHandle,
            });
        } catch (error) {
            if (error?.name !== 'NotFoundError') throw error;
        }
    }
    if (!includeRetainedSnapshots) return candidates;

    await collectBackupPassphraseDirectoryCandidates(
        root,
        'history',
        'history',
        /^bookmarks-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/,
        candidates,
    );
    await collectBackupPassphraseDirectoryCandidates(
        root,
        'emergency',
        'emergency',
        /^bookmarks-before-restore-\d{4}-\d{2}-\d{2}T.*(?:\.enc)?\.json$/,
        candidates,
    );
    return candidates;
}

async function collectBackupPassphraseDirectoryCandidates(
    root,
    directoryName,
    kind,
    pattern,
    candidates,
) {
    let directory;
    try {
        directory = await root.getDirectoryHandle(directoryName);
    } catch (error) {
        if (error?.name === 'NotFoundError') return;
        throw error;
    }
    for await (const [name, fileHandle] of directory.entries()) {
        if (fileHandle.kind !== 'file' || !pattern.test(name)) continue;
        candidates.push({ kind, directory, name, fileHandle });
    }
}

async function readBackupPassphraseCandidate(candidate, oldPassphrase) {
    try {
        const file = await candidate.fileHandle.getFile();
        if (!file.size || file.size > MAX_PASSPHRASE_CHANGE_FILE_BYTES) {
            throw new Error(t('backupPassphraseFileSizeInvalid'));
        }
        const content = await file.text();
        let documentObject;
        try {
            documentObject = JSON.parse(content);
        } catch {
            throw new Error(t('backupSnapshotJsonInvalid'));
        }
        const encrypted = documentObject?.format === 'bookmark-manager-encrypted-backup';
        const payload = encrypted
            ? await decryptBackupData(content, oldPassphrase)
            : documentObject;
        validateBackupPayloadForHealth(payload);
        if (typeof inspectBackupPayloadObject === 'function') inspectBackupPayloadObject(payload);
        return { content, payload, encrypted };
    } catch (error) {
        const requiredLatest = candidate.kind === 'latest'
            && candidate.name === backupLatestFilename(state.backup.encryptionEnabled);
        if (requiredLatest) {
            throw new Error(t('backupPassphraseLatestUnreadable', {
                name: candidate.name,
                message: error?.message || String(error),
            }));
        }
        return {
            skipped: true,
            error: error?.message || String(error),
        };
    }
}

function passphraseChangeTargetName(candidate, payload, operationId, index, encrypted) {
    const extension = encrypted ? '.enc.json' : '.json';
    if (candidate.kind === 'latest') {
        const exportedAt = validDate(payload.exportedAt) ? new Date(payload.exportedAt) : new Date();
        return `bookmarks-${fileTimestamp(exportedAt)}-before-passphrase-change-${operationId}-${index}${extension}`;
    }
    const base = candidate.name.replace(/(?:\.enc)?\.json$/i, '');
    return `${base}-passphrase-change-${operationId}-${index}${extension}`;
}

async function removePassphraseChangeTarget(target) {
    try {
        await target.directory.removeEntry(target.name);
    } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
    }
}

async function cleanupPassphraseChangeTargets(targets) {
    let failures = 0;
    for (const target of targets) {
        try {
            await removePassphraseChangeTarget(target);
        } catch (error) {
            failures += 1;
            console.warn('Unable to remove a staged passphrase-change file:', error);
        }
    }
    return failures;
}

function snapshotBackupPassphraseState() {
    return {
        passphrase: state.backup.passphrase,
        passphraseConfirmed: state.backup.passphraseConfirmed,
        passphraseNeedsVerification: state.backup.passphraseNeedsVerification,
        passphraseChecking: false,
        passphraseCheckToken: '',
        passphraseError: state.backup.passphraseError,
        encryptionProfileId: state.backup.encryptionProfileId,
        lastHash: state.backup.lastHash,
        lastBackupAt: state.backup.lastBackupAt,
        error: state.backup.error,
        lastNotifiedError: state.backup.lastNotifiedError,
        health: {
            ...state.backup.health,
            running: false,
            currentPromise: null,
            timer: null,
        },
    };
}

async function restoreBackupPassphraseState(snapshot) {
    window.clearTimeout(state.backup.health.timer);
    Object.assign(state.backup, {
        passphrase: snapshot.passphrase,
        passphraseConfirmed: snapshot.passphraseConfirmed,
        passphraseNeedsVerification: snapshot.passphraseNeedsVerification,
        passphraseChecking: false,
        passphraseCheckToken: '',
        passphraseError: snapshot.passphraseError,
        encryptionProfileId: snapshot.encryptionProfileId,
        lastHash: snapshot.lastHash,
        lastBackupAt: snapshot.lastBackupAt,
        error: snapshot.error,
        lastNotifiedError: snapshot.lastNotifiedError,
    });
    Object.assign(state.backup.health, snapshot.health);
    clearSessionBackupCredentials();
    if (state.backup.rememberSession) saveSessionBackupCredentials();
    await saveBackupPreferences();
    populateBackupEncryptionInputs();
    renderBackupSettings();
    scheduleBackupHealthRecheck();
}

async function applyNewBackupPassphrase(newPassphrase) {
    window.clearTimeout(state.backup.timer);
    window.clearTimeout(state.backup.health.timer);
    state.backup.passphrase = newPassphrase;
    state.backup.passphraseConfirmed = true;
    state.backup.passphraseNeedsVerification = false;
    state.backup.passphraseChecking = false;
    state.backup.passphraseCheckToken = '';
    state.backup.passphraseError = '';
    state.backup.encryptionProfileId = createUuid();
    state.backup.lastHash = '';
    state.backup.error = '';
    state.backup.lastNotifiedError = '';
    invalidateBackupHealth();
    clearSessionBackupCredentials();
    if (state.backup.rememberSession) saveSessionBackupCredentials();
    await saveBackupPreferences();
}

async function changeBackupPassphraseSafely(options) {
    if (options.fileLockHeld !== true) {
        return withBackupFileLock(() => changeBackupPassphraseSafely({
            ...options,
            fileLockHeld: true,
        }));
    }
    const {
        oldPassphrase,
        newPassphrase,
        migrateExisting,
        onProgress = () => {},
    } = options;
    const backup = state.backup;
    if (!await ensureBackupProtectionProfileCurrent()) {
        throw new Error(t('backupSettingsChangedOtherTab'));
    }
    if (!backup.handle || !backup.encryptionEnabled || !backupEncryptionReady()) {
        throw new Error(t('backupPassphraseChangeUnavailable'));
    }
    const permission = await getBackupPermission(backup.handle, true);
    if (permission !== 'granted') throw new Error(t('backupPermissionDenied'));

    window.clearTimeout(backup.timer);
    window.clearTimeout(backup.health.timer);
    const candidates = await collectBackupPassphraseCandidates(backup.handle, migrateExisting);
    const operationId = `${fileTimestamp(new Date())}-${createUuid().slice(0, 8)}`;
    const history = await backup.handle.getDirectoryHandle('history', { create: true });
    const stagedTargets = [];
    let skipped = 0;
    let migrated = 0;
    let archived = 0;
    const total = Math.max(1, candidates.length + 2);

    try {
        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            onProgress({
                progress: index,
                total,
                progressKey: 'backupPassphraseReadingFile',
                progressName: candidate.name,
            });
            const source = await readBackupPassphraseCandidate(candidate, oldPassphrase);
            if (source.skipped) {
                skipped += 1;
                continue;
            }

            const targetEncrypted = migrateExisting || source.encrypted;
            const targetDirectory = candidate.kind === 'latest' ? history : candidate.directory;
            const targetName = passphraseChangeTargetName(
                candidate,
                source.payload,
                operationId,
                index,
                targetEncrypted,
            );
            const targetEncryption = targetEncrypted
                ? { encrypted: true, passphrase: migrateExisting ? newPassphrase : oldPassphrase }
                : { encrypted: false, passphrase: '' };
            const targetContent = migrateExisting
                ? await createBackupFileContent(source.payload, targetEncryption)
                : source.content;
            onProgress({
                progress: index,
                total,
                progressKey: migrateExisting
                    ? 'backupPassphraseEncryptingFile'
                    : 'backupPassphraseArchivingLatest',
                progressName: candidate.name,
            });
            await writeBackupFile(targetDirectory, targetName, targetContent);
            await verifyWrittenBackupFile(
                targetDirectory,
                targetName,
                targetContent,
                source.payload,
                targetEncryption,
            );
            stagedTargets.push({
                directory: targetDirectory,
                name: targetName,
                sourceDirectory: candidate.directory,
                sourceName: candidate.name,
                removeSource: migrateExisting && candidate.kind !== 'latest',
            });
            if (migrateExisting) migrated += 1;
            else archived += 1;
        }
    } catch (error) {
        await cleanupPassphraseChangeTargets(stagedTargets);
        throw error;
    }

    const previousState = snapshotBackupPassphraseState();
    onProgress({
        progress: candidates.length,
        total,
        progressKey: 'backupPassphraseWritingCurrent',
        progressName: '',
    });
    await applyNewBackupPassphrase(newPassphrase);
    const backedUp = await runAutomaticBackup({
        force: true,
        notify: false,
        allowWhenPaused: true,
        skipPrune: true,
        fileLockHeld: true,
    });
    if (!backedUp) {
        await restoreBackupPassphraseState(previousState);
        throw new Error(t('backupPassphraseCurrentBackupFailed'));
    }

    onProgress({
        progress: candidates.length + 1,
        total,
        progressKey: 'backupPassphraseCleaningUp',
        progressName: '',
    });
    let cleanupFailed = 0;
    for (const target of stagedTargets) {
        if (!target.removeSource) continue;
        try {
            await removeBackupFileIfExists(target.sourceDirectory, target.sourceName);
        } catch (error) {
            cleanupFailed += 1;
            console.warn('Unable to remove an old passphrase backup after migration:', error);
        }
    }
    try {
        backup.health.snapshotCount = await countBackupHistoryFiles(backup.handle);
    } catch (error) {
        cleanupFailed += 1;
        console.warn('Unable to recount history after changing the backup passphrase:', error);
    }
    await saveBackupPreferences();
    populateBackupEncryptionInputs();
    renderBackupSettings();
    scheduleBackupHealthRecheck();
    onProgress({
        progress: total,
        total,
        progressKey: 'backupPassphraseComplete',
        progressName: '',
    });
    return { migrated, archived, skipped, cleanupFailed };
}
