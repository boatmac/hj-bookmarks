/* Application bootstrap, DOM binding, and localization. */
'use strict';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
} else {
    initialize();
}

async function initialize() {
    cacheElements();
    applyInitialTheme();
    applyLanguage(state.language);
    bindStaticEvents();
    initializeTabCoordination();

    try {
        state.db = await openDatabase();
        ui.storageStatus.textContent = t('dbConnected');
        await withDataWriteLock(async () => {
            await initializeSyncIdentity();
            await ensureSyncMetadata();
            await pruneExpiredRecycleBin();
        });
        await refreshData();
        await Promise.all([initializePersistentStorage(), initializeBackup(), initializeWebDavSync()]);
    } catch (error) {
        console.error('Unable to initialize bookmark manager:', error);
        showFatalError(error);
    }
}

function cacheElements() {
    const ids = [
        'sidebar', 'sidebar-backdrop', 'mobile-menu-button', 'brand-button',
        'all-view-button', 'favorites-view-button', 'recycle-bin-view-button',
        'all-count', 'favorites-count', 'recycle-bin-count',
        'sidebar-add-folder', 'folder-tree', 'tag-navigation', 'tags-count',
        'storage-status', 'language-select', 'help-button', 'theme-button',
        'search-input', 'clear-search-button',
        'tab-status', 'tab-status-text',
        'search-shortcut', 'import-file-input', 'sync-entry-button', 'export-menu',
        'quick-sync-button', 'quick-sync-icon-use', 'quick-sync-label',
        'backup-settings-button', 'backup-menu-status', 'restore-backup-menu-button',
        'sync-wizard-menu-button', 'sync-settings-button', 'sync-menu-status',
        'conflict-center-menu-button', 'conflict-menu-status',
        'import-menu-button', 'export-json-button',
        'export-html-button', 'clear-all-button',
        'add-bookmark-button', 'conflict-banner', 'sync-onboarding', 'conflict-banner-title',
        'conflict-banner-detail', 'open-conflict-center-button', 'breadcrumbs',
        'page-eyebrow', 'page-title',
        'page-description', 'result-count', 'add-folder-button', 'results-label',
        'sort-select', 'folder-grid', 'bookmark-grid', 'recovery-list', 'empty-state',
        'empty-icon-use', 'empty-title', 'empty-description', 'empty-action-button',
        'empty-action-icon', 'empty-action-label', 'empty-restore-button',
        'item-dialog', 'item-form',
        'item-id', 'item-kind', 'dialog-eyebrow', 'dialog-title',
        'dialog-close-button', 'dialog-cancel-button', 'dialog-submit-button',
        'item-title-input', 'item-url-input', 'item-description-input',
        'item-parent-select', 'item-tags-input', 'item-favorite-input',
        'form-error', 'help-dialog', 'help-dialog-close-button',
        'help-dialog-done-button', 'backup-dialog', 'backup-dialog-title',
        'backup-dialog-close-button', 'backup-dialog-cancel-button',
        'backup-status-card', 'backup-status-title', 'backup-status-detail',
        'auto-backup-toggle', 'backup-directory-name',
        'choose-backup-directory-button', 'backup-retention-select',
        'last-backup-value', 'persistence-status-value',
        'request-persistence-button', 'restore-backup-button',
        'disconnect-backup-button', 'backup-now-button',
        'backup-restore-dialog', 'backup-restore-title',
        'backup-restore-close-button', 'backup-restore-source-name',
        'backup-restore-source-detail', 'choose-restore-directory-button',
        'backup-restore-loading', 'backup-restore-loading-text',
        'backup-restore-empty', 'backup-restore-empty-title',
        'backup-restore-empty-detail', 'backup-snapshot-workspace',
        'backup-snapshot-count', 'backup-snapshot-list',
        'backup-preview-empty', 'backup-preview', 'backup-preview-kind',
        'backup-preview-title', 'backup-preview-time',
        'backup-preview-bookmark-count', 'backup-preview-folder-count',
        'backup-preview-item-count', 'backup-preview-items',
        'backup-comparison', 'backup-diff-hint',
        'backup-diff-add-count', 'backup-diff-update-count',
        'backup-diff-same-count', 'backup-diff-remove-count',
        'backup-restore-mode-section', 'backup-restore-impact', 'backup-replace-warning',
        'backup-selective-section', 'backup-selective-count',
        'backup-select-all-button', 'backup-clear-selection-button',
        'backup-selective-list', 'backup-selective-empty',
        'backup-restore-error', 'backup-restore-cancel-button',
        'backup-restore-apply-button',
        'sync-wizard-dialog', 'sync-wizard-title',
        'sync-wizard-close-button', 'sync-wizard-progress',
        'wizard-connection-hint', 'wizard-remote-fields',
        'wizard-local-folder-fields', 'wizard-local-folder-name',
        'wizard-choose-folder-button', 'wizard-connection-error',
        'wizard-endpoint-input', 'wizard-username-input', 'wizard-password-input',
        'wizard-passphrase-input', 'wizard-passphrase-confirm-input',
        'wizard-show-passwords', 'wizard-passphrase-error', 'wizard-auto-sync',
        'wizard-remember-session', 'wizard-create-directory-row',
        'wizard-create-directory', 'wizard-review', 'wizard-test-status',
        'wizard-test-title', 'wizard-test-detail', 'sync-wizard-cancel-button',
        'sync-wizard-back-button', 'sync-wizard-next-button',
        'sync-wizard-finish-button', 'sync-dialog', 'sync-dialog-title',
        'sync-dialog-close-button', 'sync-dialog-cancel-button',
        'sync-status-card', 'sync-status-title', 'sync-status-detail',
        'sync-mode-select', 'remote-sync-fields', 'local-folder-sync-fields',
        'local-sync-folder-name', 'choose-local-sync-folder-button',
        'auto-create-directory-row', 'sync-compatibility-note',
        'sync-endpoint-input', 'sync-username-input', 'sync-password-input',
        'sync-passphrase-input', 'auto-create-directory-toggle',
        'auto-sync-toggle', 'remember-session-credentials-toggle',
        'last-sync-value', 'conflict-protection-value',
        'disconnect-sync-button', 'sync-wizard-button',
        'sync-now-button', 'conflict-dialog', 'conflict-dialog-title',
        'conflict-dialog-close-button', 'conflict-progress-label',
        'conflict-detected-time', 'conflict-kind-label', 'conflict-item-title',
        'conflict-explanation', 'conflict-local-device', 'conflict-remote-device',
        'conflict-local-summary', 'conflict-remote-summary', 'field-merge-section',
        'conflict-fields', 'conflict-previous-button', 'conflict-next-button',
        'keep-both-button', 'keep-local-button', 'keep-remote-button',
        'apply-field-merge-button', 'toast', 'toast-icon-use', 'toast-message',
    ];

    for (const id of ids) ui[toCamelCase(id)] = document.getElementById(id);
    ui.bookmarkOnlyFields = Array.from(document.querySelectorAll('.bookmark-only-field'));
}

function toCamelCase(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function applyLanguage(language, persist = false) {
    state.language = language === 'zh' ? 'zh' : 'en';
    document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
    document.title = t('documentTitle');
    ui.languageSelect.value = state.language;

    document.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = t(element.dataset.i18n);
    });
    const translatedAttributes = [
        ['data-i18n-placeholder', 'placeholder'],
        ['data-i18n-title', 'title'],
        ['data-i18n-aria-label', 'aria-label'],
        ['data-i18n-content', 'content'],
    ];
    translatedAttributes.forEach(([dataAttribute, targetAttribute]) => {
        document.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
            element.setAttribute(targetAttribute, t(element.getAttribute(dataAttribute)));
        });
    });

    const rootOption = ui.itemParentSelect.querySelector('option[value="root"]');
    if (rootOption) rootOption.textContent = t('rootFolder');
    ui.storageStatus.textContent = state.db
        ? t('storageStatus', { count: state.items.length })
        : t('connectingDatabase');
    if (persist) safeStorageSet(LANGUAGE_KEY, state.language);
    const dialogItem = ui.itemId.value ? findItem(Number(ui.itemId.value)) : null;
    updateDialogLabels(ui.itemKind.value || 'bookmark', dialogItem);
    if (state.db) renderAll();
    if (ui.backupMenuStatus) renderBackupSettings();
    if (ui.syncMenuStatus) renderSyncSettings();
    if (ui.conflictBanner) renderConflictBanner();
    if (ui.conflictDialog?.open) renderConflictCenter();
    if (ui.syncWizardDialog?.open) renderSyncWizard();
    if (ui.backupRestoreDialog?.open) renderBackupRestoreDialog();
    renderTabCoordinationStatus();
}

function bindStaticEvents() {
    ui.brandButton.addEventListener('click', () => setView('all'));
    ui.allViewButton.addEventListener('click', () => setView('all'));
    ui.favoritesViewButton.addEventListener('click', () => setView('favorites'));
    ui.recycleBinViewButton.addEventListener('click', () => setView('trash'));
    ui.sidebarAddFolder.addEventListener('click', () => openItemDialog('folder'));
    ui.addFolderButton.addEventListener('click', () => openItemDialog('folder'));
    ui.addBookmarkButton.addEventListener('click', () => openItemDialog('bookmark'));

    ui.searchInput.addEventListener('input', () => {
        state.query = ui.searchInput.value.trim();
        ui.clearSearchButton.classList.toggle('hidden', !state.query);
        ui.searchShortcut.classList.toggle('hidden', Boolean(state.query));
        renderContent();
    });
    ui.clearSearchButton.addEventListener('click', clearSearch);

    ui.sortSelect.value = ['newest', 'oldest', 'title'].includes(state.sort) ? state.sort : 'newest';
    ui.sortSelect.addEventListener('change', () => {
        state.sort = ui.sortSelect.value;
        safeStorageSet(SORT_KEY, state.sort);
        renderContent();
    });

    ui.importMenuButton.addEventListener('click', () => {
        closeExportMenu();
        ui.importFileInput.click();
    });
    ui.importFileInput.addEventListener('change', handleImport);
    ui.backupSettingsButton.addEventListener('click', openBackupDialog);
    ui.restoreBackupMenuButton.addEventListener('click', () => openBackupRestoreDialog());
    ui.quickSyncButton.addEventListener('click', handleQuickSync);
    ui.syncEntryButton.addEventListener('click', openSyncDialog);
    ui.syncWizardMenuButton.addEventListener('click', () => {
        closeExportMenu();
        openSyncWizard();
    });
    ui.syncSettingsButton.addEventListener('click', openSyncDialog);
    ui.conflictCenterMenuButton.addEventListener('click', handleConflictCenterMenu);
    ui.exportJsonButton.addEventListener('click', exportJson);
    ui.exportHtmlButton.addEventListener('click', exportHtml);
    ui.clearAllButton.addEventListener('click', clearAllData);

    ui.languageSelect.addEventListener('change', () => applyLanguage(ui.languageSelect.value, true));
    ui.helpButton.addEventListener('click', openHelpDialog);
    ui.helpDialogCloseButton.addEventListener('click', closeHelpDialog);
    ui.helpDialogDoneButton.addEventListener('click', closeHelpDialog);
    ui.helpDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeHelpDialog();
    });
    ui.helpDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.helpDialog) closeHelpDialog();
    });
    ui.themeButton.addEventListener('click', toggleTheme);
    window.addEventListener('online', retryScheduledSyncWhenOnline);
    ui.mobileMenuButton.addEventListener('click', openSidebar);
    ui.sidebarBackdrop.addEventListener('click', closeSidebar);

    ui.itemForm.addEventListener('submit', handleItemSubmit);
    ui.dialogCloseButton.addEventListener('click', closeItemDialog);
    ui.dialogCancelButton.addEventListener('click', closeItemDialog);
    ui.itemDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeItemDialog();
    });
    ui.itemDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.itemDialog) closeItemDialog();
    });

    ui.backupDialogCloseButton.addEventListener('click', closeBackupDialog);
    ui.backupDialogCancelButton.addEventListener('click', closeBackupDialog);
    ui.backupDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeBackupDialog();
    });
    ui.backupDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.backupDialog) closeBackupDialog();
    });
    ui.autoBackupToggle.addEventListener('change', handleAutoBackupToggle);
    ui.chooseBackupDirectoryButton.addEventListener('click', chooseBackupDirectory);
    ui.backupRetentionSelect.addEventListener('change', handleBackupRetentionChange);
    ui.requestPersistenceButton.addEventListener('click', () => requestPersistentStorage(true));
    ui.restoreBackupButton.addEventListener('click', () => openBackupRestoreDialog({ returnToBackupDialog: true }));
    ui.disconnectBackupButton.addEventListener('click', disconnectBackupDirectory);
    ui.backupNowButton.addEventListener('click', handleBackupNow);

    ui.backupRestoreCloseButton.addEventListener('click', () => closeBackupRestoreDialog());
    ui.backupRestoreCancelButton.addEventListener('click', () => closeBackupRestoreDialog());
    ui.chooseRestoreDirectoryButton.addEventListener('click', chooseBackupRestoreDirectory);
    ui.backupSnapshotList.addEventListener('change', handleBackupRestoreSnapshotChange);
    ui.backupRestoreModeSection.addEventListener('change', handleBackupRestoreModeChange);
    ui.backupSelectiveList.addEventListener('change', handleBackupRestoreSelectionChange);
    ui.backupSelectAllButton.addEventListener('click', selectAllBackupRestoreItems);
    ui.backupClearSelectionButton.addEventListener('click', clearBackupRestoreSelection);
    ui.backupRestoreApplyButton.addEventListener('click', applySelectedBackupRestore);
    ui.backupRestoreDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeBackupRestoreDialog();
    });
    ui.backupRestoreDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.backupRestoreDialog) closeBackupRestoreDialog();
    });

    ui.syncWizardButton.addEventListener('click', openSyncWizard);
    ui.syncWizardCloseButton.addEventListener('click', closeSyncWizard);
    ui.syncWizardCancelButton.addEventListener('click', closeSyncWizard);
    ui.syncWizardBackButton.addEventListener('click', goToPreviousSyncWizardStep);
    ui.syncWizardNextButton.addEventListener('click', goToNextSyncWizardStep);
    ui.syncWizardFinishButton.addEventListener('click', finishSyncWizard);
    ui.wizardChooseFolderButton.addEventListener('click', chooseSyncWizardLocalFolder);
    ui.wizardShowPasswords.addEventListener('change', toggleSyncWizardPasswordVisibility);
    document.querySelectorAll('input[name="wizard-sync-mode"]').forEach((input) => {
        input.addEventListener('change', () => {
            collectSyncWizardInputs();
            renderSyncWizard();
        });
    });
    ui.syncWizardDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeSyncWizard();
    });
    ui.syncWizardDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.syncWizardDialog) closeSyncWizard();
    });

    ui.syncDialogCloseButton.addEventListener('click', closeSyncDialog);
    ui.syncDialogCancelButton.addEventListener('click', closeSyncDialog);
    ui.syncDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeSyncDialog();
    });
    ui.syncDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.syncDialog) closeSyncDialog();
    });
    ui.syncModeSelect.addEventListener('change', handleSyncModeChange);
    ui.chooseLocalSyncFolderButton.addEventListener('click', chooseLocalSyncDirectory);
    ui.syncEndpointInput.addEventListener('input', updateSyncSecretsFromForm);
    ui.syncUsernameInput.addEventListener('input', updateSyncSecretsFromForm);
    ui.syncEndpointInput.addEventListener('change', saveSyncPreferences);
    ui.syncUsernameInput.addEventListener('change', saveSyncPreferences);
    ui.syncPasswordInput.addEventListener('input', updateSyncSecretsFromForm);
    ui.syncPassphraseInput.addEventListener('input', updateSyncSecretsFromForm);
    ui.autoCreateDirectoryToggle.addEventListener('change', handleAutoCreateDirectoryToggle);
    ui.autoSyncToggle.addEventListener('change', handleAutoSyncToggle);
    ui.rememberSessionCredentialsToggle.addEventListener('change', handleRememberSessionCredentials);
    ui.disconnectSyncButton.addEventListener('click', disconnectWebDavSync);
    ui.syncNowButton.addEventListener('click', handleSyncNow);

    ui.openConflictCenterButton.addEventListener('click', openConflictCenter);
    ui.conflictDialogCloseButton.addEventListener('click', closeConflictCenter);
    ui.conflictDialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeConflictCenter();
    });
    ui.conflictDialog.addEventListener('mousedown', (event) => {
        if (event.target === ui.conflictDialog) closeConflictCenter();
    });
    ui.conflictPreviousButton.addEventListener('click', () => navigateConflict(-1));
    ui.conflictNextButton.addEventListener('click', () => navigateConflict(1));
    ui.keepLocalButton.addEventListener('click', () => resolveCurrentConflict('local'));
    ui.keepRemoteButton.addEventListener('click', () => resolveCurrentConflict('remote'));
    ui.keepBothButton.addEventListener('click', () => resolveCurrentConflict('both'));
    ui.applyFieldMergeButton.addEventListener('click', () => resolveCurrentConflict('merge'));

    ui.emptyActionButton.addEventListener('click', handleEmptyAction);
    ui.emptyRestoreButton.addEventListener('click', () => openBackupRestoreDialog());

    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('click', (event) => {
        if (ui.exportMenu.open && !ui.exportMenu.contains(event.target)) ui.exportMenu.open = false;
    });
    document.addEventListener('dragend', clearDragState);

    installRootDropTarget(ui.allViewButton);
    installRootDropTarget(ui.brandButton);
}

function handleGlobalKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ui.searchInput.focus();
        ui.searchInput.select();
    }
    if (event.key === 'Escape' && ui.sidebar.classList.contains('open')) closeSidebar();
}
