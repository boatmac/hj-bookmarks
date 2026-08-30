/* Cross-tab write locking and state change notifications. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function initializeTabCoordination() {
    const coordination = state.coordination;
    if (coordination.initialized) return;
    coordination.initialized = true;
    coordination.tabId = createUuid();
    coordination.statusMessage = '';

    if (typeof BroadcastChannel === 'function') {
        try {
            coordination.channel = new BroadcastChannel(COORDINATION_CHANNEL_NAME);
            coordination.channel.addEventListener('message', (event) => {
                handleCoordinationMessage(event.data);
            });
        } catch {
            coordination.channel = null;
        }
    }

    window.addEventListener('storage', handleCoordinationStorageEvent);
    window.addEventListener('pagehide', shutdownTabCoordination);
    window.addEventListener('pageshow', restoreTabCoordination);
    coordination.cleanupTimer = window.setInterval(() => {
        if (pruneExpiredSyncTabs()) renderTabCoordinationStatus();
    }, 2000);
    postCoordinationMessage('tab-ready');
}

function handleCoordinationStorageEvent(event) {
    if (event.key !== COORDINATION_STORAGE_KEY || !event.newValue) return;
    try {
        handleCoordinationMessage(JSON.parse(event.newValue));
    } catch {
        // Ignore malformed coordination messages.
    }
}

function restoreTabCoordination(event) {
    if (!event.persisted) return;
    state.coordination.initialized = false;
    initializeTabCoordination();
    scheduleExternalDataRefresh();
}

function shutdownTabCoordination() {
    announceSyncEnded();
    postCoordinationMessage('tab-closing');
    state.coordination.channel?.close();
    state.coordination.channel = null;
    state.coordination.initialized = false;
    window.clearInterval(state.coordination.cleanupTimer);
}

function postCoordinationMessage(type, payload = {}) {
    const message = {
        type,
        source: state.coordination.tabId,
        timestamp: Date.now(),
        nonce: createUuid(),
        ...payload,
    };
    try {
        state.coordination.channel?.postMessage(message);
    } catch {
        // localStorage remains available as a fallback transport.
    }
    safeStorageSet(COORDINATION_STORAGE_KEY, JSON.stringify(message));
}

function handleCoordinationMessage(message) {
    if (!message || message.source === state.coordination.tabId) return;
    if (message.type === 'sync-start' || message.type === 'sync-heartbeat') {
        state.coordination.activeSyncTabs.set(
            message.source,
            Number(message.expiresAt) || Date.now() + 6500,
        );
        renderTabCoordinationStatus();
        renderSyncSettings();
        return;
    }
    if (message.type === 'sync-end' || message.type === 'tab-closing') {
        state.coordination.activeSyncTabs.delete(message.source);
        renderTabCoordinationStatus();
        renderSyncSettings();
        processPendingExternalRefresh();
        return;
    }
    if (message.type === 'data-changed') scheduleExternalDataRefresh();
}

function announceSyncStarted() {
    const coordination = state.coordination;
    const announce = () => postCoordinationMessage('sync-heartbeat', {
        expiresAt: Date.now() + 6500,
    });
    postCoordinationMessage('sync-start', { expiresAt: Date.now() + 6500 });
    window.clearInterval(coordination.syncHeartbeatTimer);
    coordination.syncHeartbeatTimer = window.setInterval(announce, 2000);
}

function announceSyncEnded() {
    const coordination = state.coordination;
    window.clearInterval(coordination.syncHeartbeatTimer);
    coordination.syncHeartbeatTimer = null;
    if (coordination.tabId) postCoordinationMessage('sync-end');
}

function pruneExpiredSyncTabs() {
    let changed = false;
    const now = Date.now();
    state.coordination.activeSyncTabs.forEach((expiresAt, tabId) => {
        if (expiresAt <= now) {
            state.coordination.activeSyncTabs.delete(tabId);
            changed = true;
        }
    });
    return changed;
}

function hasOtherTabSyncing() {
    pruneExpiredSyncTabs();
    return state.coordination.activeSyncTabs.size > 0;
}

function broadcastDataChanged(reason = 'mutation') {
    if (!state.coordination.initialized) return;
    postCoordinationMessage('data-changed', { reason });
}

function scheduleExternalDataRefresh() {
    const coordination = state.coordination;
    window.clearTimeout(coordination.refreshTimer);
    coordination.refreshTimer = window.setTimeout(async () => {
        if (!state.db || state.sync.running || coordination.lockDepth > 0) {
            coordination.pendingExternalRefresh = true;
            return;
        }
        try {
            await refreshData();
            showTabCoordinationMessage('externalChangesApplied');
        } catch (error) {
            console.error('Unable to refresh changes from another tab:', error);
        }
    }, 120);
}

function processPendingExternalRefresh() {
    const coordination = state.coordination;
    if (!coordination.pendingExternalRefresh || state.sync.running || coordination.lockDepth > 0) return;
    coordination.pendingExternalRefresh = false;
    scheduleExternalDataRefresh();
}

function showTabCoordinationMessage(translationKey, duration = 2400) {
    const coordination = state.coordination;
    coordination.statusMessage = translationKey;
    window.clearTimeout(coordination.statusTimer);
    coordination.statusTimer = window.setTimeout(() => {
        coordination.statusMessage = '';
        renderTabCoordinationStatus();
    }, duration);
    renderTabCoordinationStatus();
}

function renderTabCoordinationStatus() {
    if (!ui.tabStatus) return;
    const otherSync = hasOtherTabSyncing();
    const message = otherSync
        ? t('otherTabSyncing')
        : state.coordination.statusMessage ? t(state.coordination.statusMessage) : '';
    ui.tabStatus.classList.toggle('hidden', !message);
    ui.tabStatus.classList.toggle('is-syncing', otherSync);
    ui.tabStatusText.textContent = message;
    ui.tabStatus.title = message;
}

async function withDataWriteLock(task) {
    const coordination = state.coordination;
    if (!navigator.locks?.request) return task();
    return navigator.locks.request(DATA_WRITE_LOCK_NAME, { mode: 'exclusive' }, async () => {
        coordination.lockDepth += 1;
        try {
            return await task();
        } finally {
            coordination.lockDepth -= 1;
            processPendingExternalRefresh();
        }
    });
}

async function runUserDataMutation(task) {
    const locked = await tryDataWriteLock(task);
    if (!locked.acquired) {
        showTabCoordinationMessage('otherTabWriting');
        showToast(t('dataBusyOtherTab'));
        return { applied: false, value: undefined };
    }
    return { applied: true, value: locked.value };
}

async function tryDataWriteLock(task) {
    const coordination = state.coordination;
    if (!navigator.locks?.request) {
        return { acquired: true, value: await task() };
    }
    return navigator.locks.request(
        DATA_WRITE_LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
            if (!lock) return { acquired: false, value: undefined };
            coordination.lockDepth += 1;
            try {
                return { acquired: true, value: await task() };
            } finally {
                coordination.lockDepth -= 1;
                processPendingExternalRefresh();
            }
        },
    );
}
