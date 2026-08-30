/* Guided first-time synchronization setup. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

let syncWizardDraft = null;
let syncWizardStep = 1;
let syncWizardFinished = false;
let syncWizardTesting = false;
let syncWizardOutcome = 'ready';
let syncWizardErrorMessage = '';

function openSyncWizard() {
    if (state.sync.running) return;
    resetSyncRetryState(true);
    if (ui.syncDialog.open) ui.syncDialog.close();
    syncWizardDraft = {
        mode: state.sync.mode,
        endpoint: state.sync.endpoint,
        username: state.sync.username,
        password: state.sync.password,
        localHandle: state.sync.localFolder.handle,
        localFolderId: state.sync.localFolder.id,
        localFolderName: state.sync.localFolder.name,
        passphrase: state.sync.passphrase,
        passphraseConfirm: state.sync.passphrase,
        automatic: state.sync.automatic,
        rememberSession: state.sync.rememberSession,
        createDirectory: state.sync.createDirectory,
    };
    syncWizardStep = 1;
    syncWizardFinished = false;
    syncWizardTesting = false;
    syncWizardOutcome = 'ready';
    syncWizardErrorMessage = '';
    populateSyncWizardInputs();
    clearSyncWizardErrors();
    renderSyncWizard();
    if (!ui.syncWizardDialog.open) ui.syncWizardDialog.showModal();
}

function closeSyncWizard() {
    if (syncWizardTesting || state.sync.running) {
        cancelWebDavSync();
        return;
    }
    if (ui.syncWizardDialog.open) ui.syncWizardDialog.close();
    if (syncWizardDraft) {
        syncWizardDraft.password = '';
        syncWizardDraft.passphrase = '';
        syncWizardDraft.passphraseConfirm = '';
    }
    ui.wizardPasswordInput.value = '';
    ui.wizardPassphraseInput.value = '';
    ui.wizardPassphraseConfirmInput.value = '';
    syncWizardDraft = null;
}

function populateSyncWizardInputs() {
    document.querySelectorAll('input[name="wizard-sync-mode"]').forEach((input) => {
        input.checked = input.value === syncWizardDraft.mode;
    });
    ui.wizardEndpointInput.value = syncWizardDraft.endpoint;
    ui.wizardUsernameInput.value = syncWizardDraft.username;
    ui.wizardPasswordInput.value = syncWizardDraft.password;
    ui.wizardPassphraseInput.value = syncWizardDraft.passphrase;
    ui.wizardPassphraseConfirmInput.value = syncWizardDraft.passphraseConfirm;
    ui.wizardAutoSync.checked = syncWizardDraft.automatic;
    ui.wizardRememberSession.checked = syncWizardDraft.rememberSession;
    ui.wizardCreateDirectory.checked = syncWizardDraft.createDirectory;
    ui.wizardShowPasswords.checked = false;
    setSyncWizardPasswordVisibility(false);
}

function collectSyncWizardInputs() {
    const selectedMode = document.querySelector('input[name="wizard-sync-mode"]:checked');
    syncWizardDraft.mode = selectedMode?.value === 'local-folder' ? 'local-folder' : 'remote';
    syncWizardDraft.endpoint = ui.wizardEndpointInput.value.trim();
    syncWizardDraft.username = ui.wizardUsernameInput.value.trim();
    syncWizardDraft.password = ui.wizardPasswordInput.value;
    syncWizardDraft.passphrase = ui.wizardPassphraseInput.value;
    syncWizardDraft.passphraseConfirm = ui.wizardPassphraseConfirmInput.value;
    syncWizardDraft.automatic = ui.wizardAutoSync.checked;
    syncWizardDraft.rememberSession = ui.wizardRememberSession.checked;
    syncWizardDraft.createDirectory = ui.wizardCreateDirectory.checked;
}

function clearSyncWizardErrors() {
    [ui.wizardConnectionError, ui.wizardPassphraseError].forEach((element) => {
        element.textContent = '';
        element.classList.add('hidden');
    });
}

function showSyncWizardError(element, message) {
    element.textContent = message;
    element.classList.remove('hidden');
}

function validateSyncWizardStep(step) {
    collectSyncWizardInputs();
    clearSyncWizardErrors();
    if (step === 2) {
        if (syncWizardDraft.mode === 'local-folder') {
            if (!syncWizardDraft.localHandle) {
                showSyncWizardError(ui.wizardConnectionError, t('wizardFolderRequired'));
                return false;
            }
        } else {
            try {
                normalizeWebDavEndpoint(syncWizardDraft.endpoint);
            } catch (error) {
                showSyncWizardError(ui.wizardConnectionError, error.message);
                return false;
            }
            if (syncWizardDraft.username && !syncWizardDraft.password) {
                showSyncWizardError(ui.wizardConnectionError, t('syncPasswordRequired'));
                return false;
            }
        }
    }
    if (step === 3) {
        if (syncWizardDraft.passphrase.length < 8) {
            showSyncWizardError(ui.wizardPassphraseError, t('syncPassphraseRequired'));
            return false;
        }
        if (syncWizardDraft.passphrase !== syncWizardDraft.passphraseConfirm) {
            showSyncWizardError(ui.wizardPassphraseError, t('passphraseMismatch'));
            return false;
        }
    }
    return true;
}

function goToNextSyncWizardStep() {
    if (!validateSyncWizardStep(syncWizardStep)) return;
    syncWizardStep = Math.min(5, syncWizardStep + 1);
    renderSyncWizard();
}

function goToPreviousSyncWizardStep() {
    collectSyncWizardInputs();
    clearSyncWizardErrors();
    syncWizardStep = Math.max(1, syncWizardStep - 1);
    renderSyncWizard();
}

function renderSyncWizard() {
    if (!syncWizardDraft) return;
    document.querySelectorAll('.sync-wizard-step').forEach((section) => {
        section.classList.toggle('hidden', Number(section.dataset.wizardStep) !== syncWizardStep);
    });
    const progressSteps = [...ui.syncWizardProgress.querySelectorAll('span')];
    progressSteps.forEach((element, index) => {
        element.classList.toggle('active', index + 1 === syncWizardStep);
        element.classList.toggle('complete', index + 1 < syncWizardStep || syncWizardFinished);
    });

    const localMode = syncWizardDraft.mode === 'local-folder';
    ui.wizardRemoteFields.classList.toggle('hidden', localMode);
    ui.wizardLocalFolderFields.classList.toggle('hidden', !localMode);
    ui.wizardCreateDirectoryRow.classList.toggle('hidden', localMode);
    ui.wizardConnectionHint.textContent = t(
        localMode ? 'wizardLocalConnectionHint' : 'wizardRemoteConnectionHint',
    );
    ui.wizardLocalFolderName.textContent = syncWizardDraft.localHandle
        ? t('localSyncFolderSelected', { name: syncWizardDraft.localFolderName })
        : t('localSyncFolderNotSelected');

    ui.syncWizardBackButton.classList.toggle('hidden', syncWizardStep === 1 || syncWizardFinished);
    ui.syncWizardNextButton.classList.toggle('hidden', syncWizardStep === 5 || syncWizardFinished);
    ui.syncWizardFinishButton.classList.toggle('hidden', syncWizardStep !== 5 || syncWizardFinished);
    ui.syncWizardCancelButton.textContent = t(syncWizardFinished ? 'gotIt' : 'cancel');
    ui.syncWizardCancelButton.disabled = syncWizardTesting;
    ui.syncWizardBackButton.disabled = syncWizardTesting;
    ui.syncWizardNextButton.disabled = syncWizardTesting;
    ui.syncWizardFinishButton.disabled = syncWizardTesting;

    if (syncWizardStep === 5) {
        renderSyncWizardReview();
        renderSyncWizardTestStatus();
    }
}

function renderSyncWizardTestStatus() {
    const stateName = syncWizardTesting ? 'running' : syncWizardOutcome;
    ui.wizardTestStatus.dataset.state = stateName === 'ready'
        ? ''
        : (stateName === 'conflicts' ? 'success' : stateName);
    if (stateName === 'running') {
        ui.wizardTestTitle.textContent = t('verifyingSync');
        renderSyncWizardProgress();
    } else if (stateName === 'success' || stateName === 'conflicts') {
        const needsReview = stateName === 'conflicts';
        ui.wizardTestTitle.textContent = t(needsReview ? 'syncSetupNeedsReview' : 'syncSetupComplete');
        ui.wizardTestDetail.textContent = needsReview
            ? t('syncSetupNeedsReviewHint', { count: state.sync.conflicts.length })
            : t('syncSetupCompleteHint');
    } else if (stateName === 'error') {
        ui.wizardTestTitle.textContent = t('syncSetupFailed');
        ui.wizardTestDetail.textContent = syncWizardErrorMessage || t('syncErrorDetail', { message: '' });
    } else {
        ui.wizardTestTitle.textContent = t('readyToVerify');
        ui.wizardTestDetail.textContent = t('readyToVerifyHint');
    }
}

function renderSyncWizardReview() {
    ui.wizardReview.replaceChildren();
    const localMode = syncWizardDraft.mode === 'local-folder';
    const rows = [
        [t('reviewMethod'), t(localMode ? 'localFolderMode' : 'remoteServiceMode')],
        [t('reviewLocation'), localMode ? syncWizardDraft.localFolderName : syncWizardDraft.endpoint],
        [t('reviewAutoSync'), t(syncWizardDraft.automatic ? 'enabledLabel' : 'disabledLabel')],
        [t('reviewCredentialPolicy'), t(syncWizardDraft.rememberSession ? 'enabledLabel' : 'disabledLabel')],
    ];
    rows.forEach(([label, value]) => {
        const row = createElement('div', 'wizard-review-row');
        row.append(createElement('span', '', label), createElement('strong', '', value || t('conflictValueEmpty')));
        ui.wizardReview.append(row);
    });
}

async function chooseSyncWizardLocalFolder() {
    if (typeof window.showDirectoryPicker !== 'function') {
        showSyncWizardError(ui.wizardConnectionError, t('localFolderUnsupportedDetail'));
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({
            id: 'bookmark-manager-local-sync',
            mode: 'readwrite',
        });
        const permission = await getBackupPermission(handle, true);
        if (permission !== 'granted') {
            showSyncWizardError(ui.wizardConnectionError, t('backupPermissionDenied'));
            return;
        }
        let sameDirectory = false;
        if (syncWizardDraft.localHandle && typeof syncWizardDraft.localHandle.isSameEntry === 'function') {
            try {
                sameDirectory = await syncWizardDraft.localHandle.isSameEntry(handle);
            } catch {
                sameDirectory = false;
            }
        }
        syncWizardDraft.localHandle = handle;
        syncWizardDraft.localFolderName = handle.name;
        if (!sameDirectory || !syncWizardDraft.localFolderId) syncWizardDraft.localFolderId = createUuid();
        clearSyncWizardErrors();
        renderSyncWizard();
    } catch (error) {
        if (error?.name !== 'AbortError') {
            showSyncWizardError(ui.wizardConnectionError, error?.message || t('backupPermissionDenied'));
        }
    }
}

function toggleSyncWizardPasswordVisibility() {
    setSyncWizardPasswordVisibility(ui.wizardShowPasswords.checked);
}

function setSyncWizardPasswordVisibility(visible) {
    const type = visible ? 'text' : 'password';
    ui.wizardPasswordInput.type = type;
    ui.wizardPassphraseInput.type = type;
    ui.wizardPassphraseConfirmInput.type = type;
}

async function finishSyncWizard() {
    for (const step of [2, 3]) {
        if (!validateSyncWizardStep(step)) {
            syncWizardStep = step;
            renderSyncWizard();
            return;
        }
    }
    collectSyncWizardInputs();
    const previousConfiguration = snapshotSyncWizardConfiguration();
    syncWizardTesting = true;
    syncWizardOutcome = 'running';
    syncWizardErrorMessage = '';
    renderSyncWizard();

    const previousKey = syncEndpointKey();
    state.sync.mode = syncWizardDraft.mode;
    state.sync.endpoint = syncWizardDraft.endpoint;
    state.sync.username = syncWizardDraft.username;
    state.sync.password = syncWizardDraft.mode === 'remote' ? syncWizardDraft.password : '';
    state.sync.passphrase = syncWizardDraft.passphrase;
    state.sync.createDirectory = syncWizardDraft.createDirectory;
    state.sync.automatic = syncWizardDraft.automatic;
    state.sync.setupComplete = false;
    state.sync.rememberSession = syncWizardDraft.rememberSession;
    state.sync.unlocked = false;
    state.sync.error = '';
    state.sync.provider = syncWizardDraft.mode === 'local-folder' ? 'local-folder' : '';

    if (syncWizardDraft.mode === 'local-folder') {
        const local = state.sync.localFolder;
        local.handle = syncWizardDraft.localHandle;
        local.id = syncWizardDraft.localFolderId || createUuid();
        local.name = syncWizardDraft.localFolderName;
        local.permission = await getBackupPermission(local.handle, false);
        local.signature = '';
        local.lastLocalHash = '';
        try {
            await saveSetting(LOCAL_SYNC_HANDLE_KEY, local.handle);
        } catch (error) {
            console.warn('Unable to persist wizard local folder handle:', error);
        }
    }

    const nextKey = syncEndpointKey();
    if (previousKey !== nextKey) {
        state.sync.conflicts = [];
        state.sync.conflictEndpointKey = nextKey;
        state.sync.conflictIndex = 0;
        state.sync.conflictSelections = {};
    }
    syncCurrentSettingsInputs();
    await saveSyncPreferences();
    clearSessionSyncCredentials();
    state.sync.hasBaseline = isSyncModeConfigured()
        ? Boolean(await getSyncBaseline(nextKey))
        : false;
    await loadSyncConflicts();

    const result = await runWebDavSync({ notify: false });
    syncWizardTesting = false;
    if (result) {
        state.sync.setupComplete = true;
        if (state.sync.rememberSession) saveSessionSyncCredentials();
        await saveSyncPreferences();
        renderSyncSettings();
        syncWizardFinished = true;
        syncWizardOutcome = result === 'conflicts' ? 'conflicts' : 'success';
        startLocalFolderPolling();
    } else {
        syncWizardErrorMessage = state.sync.error || t('syncErrorDetail', { message: '' });
        await restoreSyncWizardConfiguration(previousConfiguration);
        syncWizardOutcome = 'error';
    }
    renderSyncWizard();
}

function snapshotSyncWizardConfiguration() {
    const sync = state.sync;
    return {
        mode: sync.mode,
        endpoint: sync.endpoint,
        provider: sync.provider,
        koofrMountId: sync.koofrMountId,
        koofrMountName: sync.koofrMountName,
        koofrMountUser: sync.koofrMountUser,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        rememberSession: sync.rememberSession,
        sessionCredentialsRestored: sync.sessionCredentialsRestored,
        createDirectory: sync.createDirectory,
        automatic: sync.automatic,
        setupComplete: sync.setupComplete,
        unlocked: sync.unlocked,
        lastSyncAt: sync.lastSyncAt,
        error: sync.error,
        hasBaseline: sync.hasBaseline,
        conflicts: sync.conflicts,
        conflictEndpointKey: sync.conflictEndpointKey,
        conflictIndex: sync.conflictIndex,
        conflictSelections: { ...sync.conflictSelections },
        localFolder: {
            handle: sync.localFolder.handle,
            id: sync.localFolder.id,
            name: sync.localFolder.name,
            permission: sync.localFolder.permission,
            lastSyncAt: sync.localFolder.lastSyncAt,
            signature: sync.localFolder.signature,
            lastLocalHash: sync.localFolder.lastLocalHash,
        },
    };
}

async function restoreSyncWizardConfiguration(previous) {
    const localFolder = state.sync.localFolder;
    Object.assign(state.sync, {
        mode: previous.mode,
        endpoint: previous.endpoint,
        provider: previous.provider,
        koofrMountId: previous.koofrMountId,
        koofrMountName: previous.koofrMountName,
        koofrMountUser: previous.koofrMountUser,
        username: previous.username,
        password: previous.password,
        passphrase: previous.passphrase,
        rememberSession: previous.rememberSession,
        sessionCredentialsRestored: previous.sessionCredentialsRestored,
        createDirectory: previous.createDirectory,
        automatic: previous.automatic,
        setupComplete: previous.setupComplete,
        unlocked: previous.unlocked,
        lastSyncAt: previous.lastSyncAt,
        error: previous.error,
        hasBaseline: previous.hasBaseline,
        conflicts: previous.conflicts,
        conflictEndpointKey: previous.conflictEndpointKey,
        conflictIndex: previous.conflictIndex,
        conflictSelections: previous.conflictSelections,
    });
    Object.assign(localFolder, previous.localFolder);
    try {
        if (localFolder.handle) await saveSetting(LOCAL_SYNC_HANDLE_KEY, localFolder.handle);
        else await deleteSetting(LOCAL_SYNC_HANDLE_KEY);
    } catch (error) {
        console.warn('Unable to restore the previous local sync handle:', error);
    }
    if (state.sync.rememberSession) saveSessionSyncCredentials();
    else clearSessionSyncCredentials();
    await saveSyncPreferences();
    syncCurrentSettingsInputs();
    renderSyncSettings();
    renderConflictBanner();
    startLocalFolderPolling();
}

function syncCurrentSettingsInputs() {
    ui.syncModeSelect.value = state.sync.mode;
    ui.syncEndpointInput.value = state.sync.endpoint;
    ui.syncUsernameInput.value = state.sync.username;
    ui.syncPasswordInput.value = state.sync.password;
    ui.syncPassphraseInput.value = state.sync.passphrase;
    ui.autoCreateDirectoryToggle.checked = state.sync.createDirectory;
    ui.autoSyncToggle.checked = state.sync.automatic;
    ui.rememberSessionCredentialsToggle.checked = state.sync.rememberSession;
}

function renderSyncWizardProgress() {
    if (!ui.syncWizardDialog?.open || !syncWizardTesting) return;
    ui.wizardTestDetail.textContent = state.sync.phase ? t(state.sync.phase) : t('syncPhasePreparing');
}
