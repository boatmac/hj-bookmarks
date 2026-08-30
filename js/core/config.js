/* Shared constants, translations, and application state. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

const DB_NAME = globalThis.BOOKMARK_TEST_DB_NAME || 'BookmarkDB_v3';
const DB_VERSION = 7;
const STORE_NAME = 'bookmarks';
const SETTINGS_STORE_NAME = 'settings';
const TOMBSTONE_STORE_NAME = 'tombstones';
const SYNC_BASELINE_STORE_NAME = 'syncBaselines';
const SYNC_CONFLICT_STORE_NAME = 'syncConflicts';
const BACKUP_HANDLE_KEY = 'backup-directory-handle';
const BACKUP_PREFERENCES_KEY = 'backup-preferences';
const BACKUP_SESSION_CREDENTIALS_KEY = 'bookmark-manager.backup-session-credentials';
const BACKUP_RESTORE_SESSION_CREDENTIALS_KEY = 'bookmark-manager.backup-restore-session-credentials';
const SYNC_PREFERENCES_KEY = 'webdav-sync-preferences';
const LOCAL_SYNC_HANDLE_KEY = 'local-sync-directory-handle';
const SYNC_SESSION_CREDENTIALS_KEY = 'bookmark-manager.sync-session-credentials';
const DEVICE_ID_KEY = 'sync-device-id';
const SYNC_FILE_NAME = 'bookmarks-sync.enc.json';
const PBKDF2_ITERATIONS = 250000;
const BACKUP_HEALTH_RECHECK_MS = 24 * 60 * 60 * 1000;
const SYNC_REQUEST_TIMEOUT_MS = Number(globalThis.BOOKMARK_TEST_SYNC_TIMEOUT_MS) || 20000;
const SYNC_INITIAL_AUTO_DELAY_MS = 1800;
const SYNC_RETRY_DELAYS_MS = [5000, 15000, 45000, 120000, 300000];
const RECYCLE_RETENTION_DAYS = 30;
const DATA_WRITE_LOCK_NAME = 'bookmark-manager-data-write-v1';
const BACKUP_FILE_LOCK_NAME = 'bookmark-manager-backup-file-write-v1';
const COORDINATION_CHANNEL_NAME = 'bookmark-manager-coordination-v1';
const COORDINATION_STORAGE_KEY = 'bookmark-manager.coordination-event';
const LOCAL_SYNC_POLL_INTERVAL_MS = 15000;
const THEME_KEY = 'bookmark-manager.theme';
const SORT_KEY = 'bookmark-manager.sort';
const LANGUAGE_KEY = 'bookmark-manager.language';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

const state = {
    db: null,
    items: [],
    recycleBin: [],
    recoverySelection: new Set(),
    view: { type: 'all', value: null },
    query: '',
    sort: safeStorageGet(SORT_KEY) || 'newest',
    language: getInitialLanguage(),
    persistence: 'checking',
    coordination: {
        tabId: '',
        channel: null,
        activeSyncTabs: new Map(),
        lockDepth: 0,
        initialized: false,
        refreshTimer: null,
        statusTimer: null,
        pendingExternalRefresh: false,
    },
    sync: {
        supported: typeof fetch === 'function' && Boolean(globalThis.crypto?.subtle),
        initialized: false,
        deviceId: '',
        mode: 'remote',
        endpoint: '',
        provider: '',
        localFolder: {
            supported: typeof window.showDirectoryPicker === 'function',
            handle: null,
            id: '',
            name: '',
            permission: 'unknown',
            lastSyncAt: '',
            signature: '',
            lastLocalHash: '',
            pollTimer: null,
        },
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
        setupComplete: false,
        unlocked: false,
        lastSyncAt: '',
        error: '',
        hasBaseline: false,
        conflicts: [],
        conflictEndpointKey: '',
        conflictIndex: 0,
        conflictSelections: {},
        phase: '',
        running: false,
        pending: false,
        cancelRequested: false,
        abortController: null,
        currentPromise: null,
        timer: null,
        retryScheduled: false,
        retryCount: 0,
        retryAt: 0,
        lastNotifiedError: '',
    },
    backup: {
        supported: typeof window.showDirectoryPicker === 'function',
        encryptionSupported: Boolean(globalThis.crypto?.subtle),
        handle: null,
        enabled: false,
        retention: 30,
        encryptionEnabled: false,
        encryptionProfileId: '',
        passphrase: '',
        passphraseConfirmed: false,
        passphraseNeedsVerification: false,
        passphraseChecking: false,
        passphraseCheckToken: '',
        passphraseError: '',
        rememberSession: false,
        sessionCredentialsRestored: false,
        lastBackupAt: '',
        lastHash: '',
        health: {
            status: 'unknown',
            lastVerifiedAt: '',
            lastVerifiedHash: '',
            format: '',
            snapshotCount: 0,
            error: '',
            running: false,
            currentPromise: null,
            timer: null,
        },
        permission: 'unknown',
        error: '',
        handleRemembered: true,
        running: false,
        pending: false,
        currentPromise: null,
        fileLockDepth: 0,
        permissionNoticeShown: false,
        lastNotifiedError: '',
        timer: null,
    },
    draggedId: null,
    toastTimer: null,
};

const ui = {};

function safeStorageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function getInitialLanguage() {
    const saved = safeStorageGet(LANGUAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
    const browserLanguage = navigator.languages?.[0] || navigator.language || 'en';
    return /^zh(?:-|$)/i.test(browserLanguage) ? 'zh' : 'en';
}

function t(key, variables = {}) {
    const value = TRANSLATIONS[state.language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
    return typeof value === 'function' ? value(variables) : value;
}

function currentLocale() {
    return state.language === 'zh' ? 'zh-CN' : 'en-US';
}
