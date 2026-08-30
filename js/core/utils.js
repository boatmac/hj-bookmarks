/* Shared view, hierarchy, formatting, and browser helpers. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function setView(type, value = null) {
    state.view = { type, value };
    closeSidebar();
    renderAll();
}

function clearSearch() {
    state.query = '';
    ui.searchInput.value = '';
    ui.clearSearchButton.classList.add('hidden');
    ui.searchShortcut.classList.remove('hidden');
    renderContent();
}

function openSidebar() {
    ui.sidebar.classList.add('open');
    ui.sidebarBackdrop.classList.add('visible');
}

function closeSidebar() {
    ui.sidebar.classList.remove('open');
    ui.sidebarBackdrop.classList.remove('visible');
}

function applyInitialTheme() {
    const saved = safeStorageGet(THEME_KEY);
    const theme = saved === 'dark' || saved === 'light'
        ? saved
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    updateThemeColor(theme);
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    safeStorageSet(THEME_KEY, next);
    updateThemeColor(next);
}

function updateThemeColor(theme) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151a16' : '#eef0e9');
}

function getTagCounts() {
    const counts = new Map();
    state.items.filter(isBookmark).forEach((item) => {
        item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    return counts;
}

function makeFolderChildrenMap(folders) {
    const map = new Map();
    folders.forEach((folder) => {
        if (!map.has(folder.parentId)) map.set(folder.parentId, []);
        map.get(folder.parentId).push(folder);
    });
    return map;
}

function getFolderPath(folderId) {
    const path = [];
    const visited = new Set();
    let current = findItem(folderId);
    while (current && isFolder(current) && !visited.has(current.id)) {
        visited.add(current.id);
        path.unshift(current);
        current = current.parentId == null ? null : findItem(current.parentId);
    }
    return path;
}

function getFolderPathLabel(folderId) {
    return `/ ${getFolderPath(folderId).map((folder) => folder.title).join(' / ')}`;
}

function getAllDescendantIds(parentId) {
    const result = [];
    const visited = new Set([parentId]);
    const queue = [parentId];
    while (queue.length) {
        const current = queue.shift();
        state.items.filter((item) => item.parentId === current).forEach((child) => {
            if (visited.has(child.id)) return;
            visited.add(child.id);
            result.push(child.id);
            queue.push(child.id);
        });
    }
    return result;
}

function countBookmarksBelow(folderId) {
    const ids = new Set([folderId, ...getAllDescendantIds(folderId)]);
    return state.items.filter((item) => isBookmark(item) && ids.has(item.parentId)).length;
}

function compareBookmarks(left, right) {
    if (state.sort === 'title') return left.title.localeCompare(right.title, currentLocale());
    const difference = itemTimestamp(left) - itemTimestamp(right);
    return state.sort === 'oldest' ? difference : -difference;
}

function sortByTitle(items) {
    return items.slice().sort((left, right) => left.title.localeCompare(right.title, currentLocale()));
}

function sortTreeItems(items) {
    return items.slice().sort((left, right) => {
        if (isFolder(left) !== isFolder(right)) return isFolder(left) ? -1 : 1;
        return left.title.localeCompare(right.title, currentLocale());
    });
}

function findItem(id) {
    return state.items.find((item) => item.id === Number(id));
}

function isFolder(item) {
    return !item.url;
}

function isBookmark(item) {
    return Boolean(item.url);
}

function toStorageRecord(item) {
    return {
        ...(item.id != null ? { id: item.id } : {}),
        syncId: item.syncId || createUuid(),
        title: item.title,
        url: item.url,
        description: item.description || '',
        tags: parseTags(item.tags),
        parentId: item.parentId == null ? null : item.parentId,
        isPinned: item.isPinned === true,
        collapsed: item.collapsed === true,
        createdAt: item.createdAt || '',
        updatedAt: item.updatedAt || '',
        modifiedBy: item.modifiedBy || state.sync.deviceId,
    };
}

function parseTags(value) {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string' ? value.split(/[,，]/) : [];
    return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))];
}

function normalizeUrl(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error(t('urlRequired'));
    const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
    let url;
    try {
        url = new URL(withProtocol);
    } catch {
        throw new Error(t('urlInvalid'));
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error(t('urlProtocol'));
    return url.toString();
}

function getSafeHref(value) {
    try {
        return normalizeUrl(value);
    } catch {
        return '';
    }
}

function canonicalUrl(value) {
    try {
        const url = new URL(normalizeUrl(value));
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function getHostname(value) {
    try {
        const url = new URL(value);
        if (url.protocol === 'file:') return t('localFile');
        return url.hostname.replace(/^www\./, '') || url.protocol.replace(':', '');
    } catch {
        return value;
    }
}

function getSiteInitial(hostname) {
    return (hostname || '·').trim().slice(0, 1).toUpperCase();
}

function createUuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hashString(value) {
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
}

function validDate(value) {
    return typeof value === 'string' && value && !Number.isNaN(Date.parse(value));
}

function itemTimestamp(item) {
    const value = item.createdAt || item.updatedAt;
    return validDate(value) ? Date.parse(value) : 0;
}

function formatItemDate(item) {
    const value = item.createdAt || item.updatedAt;
    if (!validDate(value)) return t('historicalData');
    return new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: 'numeric' }).format(new Date(value));
}

function dateFromBookmarkAttribute(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000).toISOString()
        : new Date().toISOString();
}

function dateToSeconds(value) {
    return validDate(value) ? Math.floor(Date.parse(value) / 1000) : Math.floor(Date.now() / 1000);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function createElement(tagName, className = '', text = null) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== null) element.textContent = text;
    return element;
}

function createIcon(name, size = 18) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
}

function downloadFile(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function closeExportMenu() {
    ui.exportMenu.open = false;
}

function showToast(message) {
    window.clearTimeout(state.toastTimer);
    ui.toastMessage.textContent = message;
    ui.toast.classList.remove('hidden');
    state.toastTimer = window.setTimeout(() => ui.toast.classList.add('hidden'), 3200);
}

function showFatalError(error) {
    ui.storageStatus.textContent = t('dbConnectionFailed');
    ui.bookmarkGrid.replaceChildren();
    ui.folderGrid.replaceChildren();
    const panel = createElement('section', 'fatal-error');
    panel.append(
        createIcon('database', 30),
        createElement('h2', '', t('fatalTitle')),
        createElement('p', '', error?.message || t('fatalHint')),
    );
    ui.bookmarkGrid.append(panel);
}

function safeStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Theme and sorting preferences are non-critical.
    }
}

function safeSessionStorageGet(key) {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeSessionStorageSet(key, value) {
    try {
        sessionStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

function safeSessionStorageRemove(key) {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // Session credential retention is optional.
    }
}
