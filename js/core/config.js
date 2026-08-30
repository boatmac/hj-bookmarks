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
const SYNC_PREFERENCES_KEY = 'webdav-sync-preferences';
const SYNC_SESSION_CREDENTIALS_KEY = 'bookmark-manager.sync-session-credentials';
const DEVICE_ID_KEY = 'sync-device-id';
const SYNC_FILE_NAME = 'bookmarks-sync.enc.json';
const PBKDF2_ITERATIONS = 250000;
const SYNC_REQUEST_TIMEOUT_MS = 20000;
const RECYCLE_RETENTION_DAYS = 30;
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
    sync: {
        supported: typeof fetch === 'function' && Boolean(globalThis.crypto?.subtle),
        deviceId: '',
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
        running: false,
        pending: false,
        cancelRequested: false,
        abortController: null,
        currentPromise: null,
        timer: null,
        lastNotifiedError: '',
    },
    backup: {
        supported: typeof window.showDirectoryPicker === 'function',
        handle: null,
        enabled: false,
        retention: 30,
        lastBackupAt: '',
        lastHash: '',
        permission: 'unknown',
        error: '',
        handleRemembered: true,
        running: false,
        pending: false,
        currentPromise: null,
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
