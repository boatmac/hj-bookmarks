/* Lightweight remote WebDAV change detection for shared bookmark libraries. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

const REMOTE_WATCH_FOCUS_MIN_AGE_MS = 5000;
const REMOTE_WATCH_SHARED_FRESHNESS_RATIO = 0.75;

function normalizeRemoteSyncVersion(input) {
    if (!input || typeof input !== 'object') return null;
    const provider = input.provider === 'koofr' ? 'koofr' : input.provider === 'webdav' ? 'webdav' : '';
    if (!provider || typeof input.exists !== 'boolean') return null;
    if (!input.exists) return { provider, exists: false };
    if (provider === 'koofr') {
        return {
            provider,
            exists: true,
            hash: typeof input.hash === 'string' ? input.hash : '',
            modified: Number.isFinite(Number(input.modified)) ? Number(input.modified) : null,
            size: Number.isFinite(Number(input.size)) ? Number(input.size) : null,
        };
    }
    return {
        provider,
        exists: true,
        etag: typeof input.etag === 'string' ? input.etag : '',
        lastModified: typeof input.lastModified === 'string' ? input.lastModified : '',
        size: Number.isFinite(Number(input.size)) ? Number(input.size) : null,
        contentHash: typeof input.contentHash === 'string' ? input.contentHash : '',
    };
}

function remoteSyncVersionsEquivalent(leftInput, rightInput) {
    const left = normalizeRemoteSyncVersion(leftInput);
    const right = normalizeRemoteSyncVersion(rightInput);
    if (!left || !right || left.provider !== right.provider || left.exists !== right.exists) return false;
    if (!left.exists) return true;
    if (left.provider === 'koofr') {
        if (left.hash && right.hash) return left.hash === right.hash;
        return left.modified !== null
            && right.modified !== null
            && left.modified === right.modified
            && left.size === right.size;
    }
    if (left.etag && right.etag && left.etag !== right.etag) return false;
    if (left.contentHash && right.contentHash) return left.contentHash === right.contentHash;
    if (left.etag && right.etag) return true;
    return Boolean(
        left.lastModified
        && right.lastModified
        && left.lastModified === right.lastModified
        && left.size === right.size
    );
}

function remoteWatchEndpointHash(endpointKey = syncEndpointKey()) {
    const value = String(endpointKey || '');
    const reversed = [...value].reverse().join('');
    return `${hashString(value)}-${hashString(reversed)}-${value.length}`;
}

function readSharedRemoteWatchState(endpointHash) {
    const raw = safeStorageGet(REMOTE_WATCH_STORAGE_KEY);
    if (!raw) return null;
    try {
        const shared = JSON.parse(raw);
        if (
            shared?.version !== 1
            || shared.endpointHash !== endpointHash
            || !Number.isFinite(Number(shared.checkedAt))
        ) return null;
        return {
            checkedAt: Number(shared.checkedAt),
            remoteVersion: normalizeRemoteSyncVersion(shared.remoteVersion),
            changed: shared.changed === true,
        };
    } catch {
        return null;
    }
}

function writeSharedRemoteWatchState(endpointHash, remoteVersion, changed, checkedAt) {
    const payload = {
        version: 1,
        endpointHash,
        checkedAt,
        remoteVersion: normalizeRemoteSyncVersion(remoteVersion),
        changed: changed === true,
    };
    safeStorageSet(REMOTE_WATCH_STORAGE_KEY, JSON.stringify(payload));
    if (state.coordination.initialized) {
        postCoordinationMessage('remote-watch', payload);
    }
}

function noteRemoteSyncVersion(endpointKey, version, checkedAt = Date.now()) {
    const watch = state.sync.remoteWatch;
    const normalized = normalizeRemoteSyncVersion(version);
    if (!normalized) return false;
    watch.endpointKey = endpointKey;
    watch.version = normalized;
    watch.lastCheckedAt = new Date(checkedAt).toISOString();
    watch.error = '';
    watch.retryCount = 0;
    watch.deferUntil = 0;
    writeSharedRemoteWatchState(remoteWatchEndpointHash(endpointKey), normalized, false, checkedAt);
    return true;
}

function resetRemoteSyncWatcher({ clearVersion = true } = {}) {
    const watch = state.sync.remoteWatch;
    window.clearTimeout(watch.timer);
    watch.timer = null;
    watch.running = false;
    watch.error = '';
    watch.retryCount = 0;
    watch.deferUntil = 0;
    if (clearVersion) {
        watch.endpointKey = '';
        watch.version = null;
        watch.lastCheckedAt = '';
        watch.lastChangeAt = '';
    }
    renderRemoteWatchStatus();
}

function remoteSyncWatcherConfigured() {
    const sync = state.sync;
    return sync.initialized
        && sync.mode === 'remote'
        && sync.supported
        && sync.setupComplete
        && Boolean(sync.endpoint)
        && sync.automatic
        && sync.unlocked
        && hasUsableCurrentSyncCredentials()
        && !sync.conflicts.length
        && !sync.error;
}

function canCheckRemoteSyncNow() {
    return remoteSyncWatcherConfigured()
        && document.visibilityState === 'visible'
        && navigator.onLine !== false
        && !state.sync.running
        && !state.sync.retryScheduled
        && !hasOtherTabSyncing();
}

function stopRemoteSyncWatcher() {
    window.clearTimeout(state.sync.remoteWatch.timer);
    state.sync.remoteWatch.timer = null;
}

function startRemoteSyncWatcher(delay = REMOTE_SYNC_POLL_INTERVAL_MS) {
    const watch = state.sync.remoteWatch;
    stopRemoteSyncWatcher();
    if (
        !remoteSyncWatcherConfigured()
        || document.visibilityState !== 'visible'
        || navigator.onLine === false
    ) {
        renderRemoteWatchStatus();
        return;
    }
    watch.timer = window.setTimeout(() => {
        watch.timer = null;
        checkRemoteSyncVersion({ trigger: 'timer' });
    }, Math.max(50, Number(delay) || REMOTE_SYNC_POLL_INTERVAL_MS));
    renderRemoteWatchStatus();
}

function scheduleRemoteWatchForActivity() {
    if (!remoteSyncWatcherConfigured() || document.visibilityState !== 'visible') return;
    const checkedAt = Date.parse(state.sync.remoteWatch.lastCheckedAt || '');
    const age = Number.isFinite(checkedAt) ? Date.now() - checkedAt : Infinity;
    startRemoteSyncWatcher(age >= REMOTE_WATCH_FOCUS_MIN_AGE_MS
        ? 150
        : Math.max(150, REMOTE_WATCH_FOCUS_MIN_AGE_MS - age));
}

function initializeRemoteSyncWatcher() {
    const watch = state.sync.remoteWatch;
    if (!watch.listenerBound) {
        document.addEventListener('visibilitychange', handleRemoteWatchVisibilityChange);
        window.addEventListener('focus', scheduleRemoteWatchForActivity);
        window.addEventListener('online', handleRemoteWatchOnline);
        window.addEventListener('pagehide', stopRemoteSyncWatcher);
        window.addEventListener('pageshow', handleRemoteWatchPageShow);
        watch.listenerBound = true;
    }
    watch.initialized = true;
    startRemoteSyncWatcher();
}

function handleRemoteWatchVisibilityChange() {
    if (document.visibilityState === 'visible') scheduleRemoteWatchForActivity();
    else stopRemoteSyncWatcher();
    renderRemoteWatchStatus();
}

function handleRemoteWatchOnline() {
    if (
        !state.sync.retryScheduled
        && Date.now() >= state.sync.remoteWatch.deferUntil
    ) scheduleRemoteWatchForActivity();
}

function handleRemoteWatchPageShow(event) {
    if (event.persisted) scheduleRemoteWatchForActivity();
}

function handleRemoteWatchCoordinationMessage(message) {
    const watch = state.sync.remoteWatch;
    if (!watch.initialized || message.endpointHash !== remoteWatchEndpointHash()) return;
    const checkedAt = Number(message.checkedAt);
    if (Number.isFinite(checkedAt)) watch.lastCheckedAt = new Date(checkedAt).toISOString();
    const version = normalizeRemoteSyncVersion(message.remoteVersion);
    if (!message.changed && version) {
        watch.endpointKey = syncEndpointKey();
        watch.version = version;
    }
    if (message.changed) startRemoteSyncWatcher(1800);
    renderRemoteWatchStatus();
}

async function tryRemoteWatchLock(task) {
    if (!navigator.locks?.request) return { acquired: true, value: await task() };
    return navigator.locks.request(
        REMOTE_WATCH_LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
            if (!lock) return { acquired: false, value: null };
            return { acquired: true, value: await task() };
        },
    );
}

async function performRemoteSyncVersionCheck() {
    const sync = state.sync;
    const watch = sync.remoteWatch;
    const endpoint = normalizeWebDavEndpoint(sync.endpoint);
    const endpointKey = syncEndpointKey(endpoint, sync.username);
    const endpointHash = remoteWatchEndpointHash(endpointKey);
    const now = Date.now();
    const shared = readSharedRemoteWatchState(endpointHash);
    const sharedFreshness = Math.max(
        1000,
        Math.round(REMOTE_SYNC_POLL_INTERVAL_MS * REMOTE_WATCH_SHARED_FRESHNESS_RATIO),
    );
    if (shared && now - shared.checkedAt < sharedFreshness) {
        watch.lastCheckedAt = new Date(shared.checkedAt).toISOString();
        if (!shared.changed && shared.remoteVersion) {
            watch.endpointKey = endpointKey;
            watch.version = shared.remoteVersion;
        }
        return { skipped: true, nextDelay: Math.max(1000, REMOTE_SYNC_POLL_INTERVAL_MS - (now - shared.checkedAt)) };
    }

    const previousVersion = watch.endpointKey === endpointKey ? watch.version : null;
    const context = await createSyncRemoteContext(endpoint, { silent: true });
    const observation = await probeRemoteSyncVersion(endpoint, context, previousVersion);
    const observedVersion = normalizeRemoteSyncVersion(observation.version);
    const changed = Boolean(
        observedVersion
        && previousVersion
        && !remoteSyncVersionsEquivalent(previousVersion, observedVersion)
    );
    const needsInitialRefresh = Boolean(observedVersion && !previousVersion && sync.lastSyncAt);
    const remoteChanged = changed || needsInitialRefresh;
    watch.lastCheckedAt = new Date(now).toISOString();
    watch.error = '';
    watch.retryCount = 0;
    sync.lastNotifiedError = '';
    if (remoteChanged) watch.lastChangeAt = watch.lastCheckedAt;
    else if (observedVersion) {
        watch.endpointKey = endpointKey;
        watch.version = observedVersion;
    }
    writeSharedRemoteWatchState(endpointHash, observedVersion, remoteChanged, now);
    if (state.db) await saveSyncPreferences();

    if (remoteChanged) {
        const synchronized = await runWebDavSync({
            notify: false,
            automatic: true,
            remoteWatch: true,
        });
        return {
            skipped: false,
            changed: true,
            nextDelay: synchronized ? REMOTE_SYNC_POLL_INTERVAL_MS : 2000,
        };
    }
    return { skipped: false, changed: false, nextDelay: REMOTE_SYNC_POLL_INTERVAL_MS };
}

async function checkRemoteSyncVersion({ trigger = 'manual' } = {}) {
    const watch = state.sync.remoteWatch;
    if (watch.running) return false;
    if (!canCheckRemoteSyncNow()) {
        if (
            remoteSyncWatcherConfigured()
            && document.visibilityState === 'visible'
            && navigator.onLine !== false
        ) startRemoteSyncWatcher(5000);
        else stopRemoteSyncWatcher();
        return false;
    }

    watch.running = true;
    watch.error = '';
    renderRemoteWatchStatus();
    let nextDelay = REMOTE_SYNC_POLL_INTERVAL_MS;
    let shouldSchedule = true;
    try {
        const locked = await tryRemoteWatchLock(performRemoteSyncVersionCheck);
        if (!locked.acquired) {
            nextDelay = 2000;
            return false;
        }
        nextDelay = locked.value?.nextDelay || REMOTE_SYNC_POLL_INTERVAL_MS;
        return locked.value?.changed === true;
    } catch (error) {
        if (isTransientSyncError(error)) {
            const delayIndex = Math.min(watch.retryCount, SYNC_RETRY_DELAYS_MS.length - 1);
            nextDelay = SYNC_RETRY_DELAYS_MS[delayIndex];
            watch.retryCount += 1;
            watch.error = t('remoteWatchRetrying', { seconds: Math.ceil(nextDelay / 1000) });
            logErrorSafely('warn', `Remote sync check (${trigger}) will retry after a transient error.`, error);
            return false;
        }
        shouldSchedule = false;
        watch.error = error?.message || t('remoteWatchFailed');
        state.sync.error = watch.error;
        logErrorSafely('error', `Remote sync check (${trigger}) failed.`, error);
        if (state.sync.lastNotifiedError !== watch.error) {
            showToast(t('remoteWatchFailedToast', { message: watch.error }), 'warning');
            state.sync.lastNotifiedError = watch.error;
        }
        renderSyncSettings();
        return false;
    } finally {
        watch.running = false;
        renderRemoteWatchStatus();
        if (shouldSchedule && !state.sync.retryScheduled) startRemoteSyncWatcher(nextDelay);
    }
}

function renderRemoteWatchStatus() {
    if (!ui.remoteWatchStatusRow) return;
    const sync = state.sync;
    const watch = sync.remoteWatch;
    const remoteMode = sync.mode === 'remote';
    ui.remoteWatchStatusRow.classList.toggle('hidden', !remoteMode);
    if (!remoteMode) return;

    let stateName = 'disabled';
    let text = t('remoteWatchDisabled');
    if (!sync.automatic) {
        stateName = 'disabled';
        text = t('remoteWatchDisabled');
    } else if (!sync.unlocked || !hasUsableCurrentSyncCredentials()) {
        stateName = 'locked';
        text = t('remoteWatchLocked');
    } else if (watch.running) {
        stateName = 'checking';
        text = t('remoteWatchChecking');
    } else if (watch.error) {
        stateName = 'retry';
        text = watch.error;
    } else if (validDate(watch.lastCheckedAt)) {
        stateName = 'ready';
        text = t('remoteWatchLastChecked', { time: formatBackupTime(watch.lastCheckedAt) });
    } else {
        stateName = 'ready';
        text = t('remoteWatchWaiting');
    }
    ui.remoteWatchStatusRow.dataset.state = stateName;
    ui.remoteWatchStatusValue.textContent = text;
}
