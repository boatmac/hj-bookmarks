/* Standard WebDAV and Koofr provider adapters. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function isKoofrSyncEndpoint(value) {
    try {
        const url = new URL(value);
        return /(^|\.)koofr\.net$/i.test(url.hostname) && /^\/dav\//i.test(url.pathname);
    } catch {
        return false;
    }
}

function normalizeWebDavEndpoint(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error(t('syncUrlRequired'));
    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error(t('syncUrlInvalid'));
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(t('syncUrlInvalid'));
    }
    if (!url.pathname.toLowerCase().endsWith('.json')) {
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        url.pathname += SYNC_FILE_NAME;
    }
    url.hash = '';
    return url.toString();
}

function createWebDavHeaders(includeContentType = false) {
    const headers = new Headers({ Accept: 'application/json' });
    if (includeContentType) headers.set('Content-Type', 'application/json; charset=utf-8');
    if (state.sync.username) {
        const credentials = new TextEncoder().encode(`${state.sync.username}:${state.sync.password}`);
        headers.set('Authorization', `Basic ${bytesToBase64(credentials)}`);
    }
    return headers;
}

async function fetchWebDav(url, options) {
    const requestController = new AbortController();
    const method = String(options?.method || 'GET').toUpperCase();
    let target = 'remote';
    try {
        const parsedUrl = new URL(url);
        target = `${parsedUrl.host}${parsedUrl.pathname}`;
    } catch {
        // Keep the generic target for malformed URLs.
    }
    const sessionSignal = state.sync.abortController?.signal;
    if (sessionSignal?.aborted) throw new Error(t('syncCanceled'));
    let timedOut = false;
    const cancelRequest = () => requestController.abort();
    sessionSignal?.addEventListener('abort', cancelRequest, { once: true });
    const timeout = window.setTimeout(() => {
        timedOut = true;
        requestController.abort();
    }, SYNC_REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, { ...options, signal: requestController.signal });
    } catch {
        if (sessionSignal?.aborted) throw new Error(t('syncCanceled'));
        if (timedOut) throw new Error(t('syncTimeout', { method, target }));
        throw new Error(t('syncNetworkError', { method, target }));
    } finally {
        window.clearTimeout(timeout);
        sessionSignal?.removeEventListener('abort', cancelRequest);
    }
}

async function createSyncRemoteContext(endpoint) {
    const url = new URL(endpoint);
    if (!isKoofrSyncEndpoint(endpoint)) return { provider: 'webdav' };

    const segments = url.pathname.split('/').filter(Boolean).map((segment) => {
        try {
            return decodeURIComponent(segment);
        } catch {
            throw new Error(t('syncUrlInvalid'));
        }
    });
    if (segments.length < 3 || segments[0].toLowerCase() !== 'dav' || segments.some((segment) => segment.includes('/'))) {
        throw new Error(t('syncUrlInvalid'));
    }

    const mountName = segments[1];
    const normalizedName = mountName.toLocaleLowerCase('en-US');
    const normalizedUser = state.sync.username.toLocaleLowerCase('en-US');
    const cachedMountMatches = Boolean(
        state.sync.koofrMountId
        && state.sync.koofrMountName.toLocaleLowerCase('en-US') === normalizedName
        && (
            !state.sync.koofrMountUser
            || state.sync.koofrMountUser.toLocaleLowerCase('en-US') === normalizedUser
        )
    );
    if (cachedMountMatches) {
        if (state.sync.koofrMountUser !== state.sync.username) {
            state.sync.koofrMountUser = state.sync.username;
            await saveSyncPreferences();
        }
        return buildKoofrContext(url, state.sync.koofrMountId, mountName, segments, true);
    }

    setSyncPhase('syncPhaseResolvingKoofr');
    const mountsUrl = new URL('/api/v2/mounts', url.origin);
    const response = await fetchWebDav(mountsUrl.toString(), {
        method: 'GET',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
    if (!response.ok) throw new Error(t('syncReadFailed', { status: response.status }));

    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error(t('koofrApiInvalid'));
    }
    const mounts = Array.isArray(payload?.mounts) ? payload.mounts : [];
    const mount = mounts.find((candidate) => String(candidate?.name || '').toLocaleLowerCase('en-US') === normalizedName)
        || (normalizedName === 'koofr' ? mounts.find((candidate) => candidate?.isPrimary === true) : null);
    if (!mount?.id) throw new Error(t('koofrMountNotFound', { name: mountName }));

    state.sync.koofrMountId = String(mount.id);
    state.sync.koofrMountName = mountName;
    state.sync.koofrMountUser = state.sync.username;
    await saveSyncPreferences();
    return buildKoofrContext(url, state.sync.koofrMountId, mountName, segments, false);
}

function buildKoofrContext(url, mountId, mountName, segments, mountCached) {
    const pathSegments = segments.slice(2);
    const fileName = pathSegments.pop();
    const directoryPath = pathSegments.length ? `/${pathSegments.join('/')}` : '/';
    const filePath = directoryPath === '/' ? `/${fileName}` : `${directoryPath}/${fileName}`;
    return {
        provider: 'koofr',
        origin: url.origin,
        mountId,
        mountName,
        mountCached,
        directoryPath,
        fileName,
        filePath,
    };
}

function createKoofrApiUrl(context, action, { content = false, path = null, parameters = {} } = {}) {
    const prefix = content ? '/content/api/v2' : '/api/v2';
    const url = new URL(`${prefix}/mounts/${encodeURIComponent(context.mountId)}/files/${action}`, context.origin);
    if (path !== null) url.searchParams.set('path', path);
    Object.entries(parameters).forEach(([name, value]) => {
        if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, String(value));
    });
    return url.toString();
}

async function readRemoteSyncFile(endpoint, context) {
    if (context.provider === 'koofr') return readKoofrSyncFile(context);
    const response = await fetchWebDav(endpoint, {
        method: 'GET',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });

    if (response.status === 404) return { exists: false, etag: '', data: emptySyncDataset() };
    if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
    if (!response.ok) throw new Error(t('syncReadFailed', { status: response.status }));
    const text = await response.text();
    const data = text.trim()
        ? parseRemoteSyncDataset(await decryptSyncData(text, state.sync.passphrase))
        : emptySyncDataset();
    return {
        exists: true,
        etag: response.headers.get('ETag') || '',
        data,
    };
}

async function readKoofrSyncFile(context) {
    const infoResponse = await fetchWebDav(createKoofrApiUrl(context, 'info', { path: context.filePath }), {
        method: 'GET',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (infoResponse.status === 404) return { exists: false, token: null, data: emptySyncDataset() };
    if (infoResponse.status === 401 || infoResponse.status === 403) throw new Error(t('syncAuthFailed'));
    if (!infoResponse.ok) throw new Error(t('syncReadFailed', { status: infoResponse.status }));

    let info;
    try {
        info = await infoResponse.json();
    } catch {
        throw new Error(t('koofrApiInvalid'));
    }
    if (info?.type !== 'file') throw new Error(t('koofrApiInvalid'));

    const contentResponse = await fetchWebDav(createKoofrApiUrl(context, 'get', {
        content: true,
        path: context.filePath,
    }), {
        method: 'GET',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (contentResponse.status === 404) return { exists: false, token: null, data: emptySyncDataset() };
    if (contentResponse.status === 401 || contentResponse.status === 403) throw new Error(t('syncAuthFailed'));
    if (!contentResponse.ok) throw new Error(t('syncReadFailed', { status: contentResponse.status }));
    const text = await contentResponse.text();
    const data = text.trim()
        ? parseRemoteSyncDataset(await decryptSyncData(text, state.sync.passphrase))
        : emptySyncDataset();
    return {
        exists: true,
        token: {
            hash: typeof info.hash === 'string' ? info.hash : '',
            modified: Number.isFinite(Number(info.modified)) ? Number(info.modified) : null,
        },
        data,
    };
}

async function ensureRemoteParentDirectory(endpoint, context) {
    if (context.provider === 'koofr') return ensureKoofrParentDirectory(context);
    const directory = new URL(endpoint);
    directory.pathname = directory.pathname.slice(0, directory.pathname.lastIndexOf('/') + 1);
    if (directory.pathname === '/') return false;

    const response = await fetchWebDav(directory.toString(), {
        method: 'MKCOL',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });

    if ([200, 201, 204, 405].includes(response.status)) return response.status === 201;
    if (response.status === 401) throw new Error(t('syncAuthFailed'));
    if (response.status === 404 || response.status === 409) throw new Error(t('syncParentDirectoryMissing'));
    throw new Error(t('syncCreateDirectoryFailed', { status: response.status }));
}

async function ensureKoofrParentDirectory(context) {
    if (context.directoryPath === '/') return false;
    const infoUrl = createKoofrApiUrl(context, 'info', { path: context.directoryPath });
    const infoResponse = await fetchWebDav(infoUrl, {
        method: 'GET',
        headers: createWebDavHeaders(),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (infoResponse.ok) {
        let info;
        try {
            info = await infoResponse.json();
        } catch {
            throw new Error(t('koofrApiInvalid'));
        }
        if (info?.type !== 'dir') throw new Error(t('syncCreateDirectoryFailed', { status: 409 }));
        return false;
    }
    if (infoResponse.status === 401 || infoResponse.status === 403) throw new Error(t('syncAuthFailed'));
    if (infoResponse.status !== 404) throw new Error(t('syncCreateDirectoryFailed', { status: infoResponse.status }));

    const parts = context.directoryPath.split('/').filter(Boolean);
    const name = parts.pop();
    const parentPath = parts.length ? `/${parts.join('/')}` : '/';
    const createResponse = await fetchWebDav(createKoofrApiUrl(context, 'folder', { path: parentPath }), {
        method: 'POST',
        headers: createWebDavHeaders(true),
        body: JSON.stringify({ name }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if ([200, 201, 204].includes(createResponse.status)) return true;
    if (createResponse.status === 401 || createResponse.status === 403) throw new Error(t('syncAuthFailed'));
    if (createResponse.status === 404) throw new Error(t('syncParentDirectoryMissing'));
    if (createResponse.status === 409) {
        const retryInfo = await fetchWebDav(infoUrl, {
            method: 'GET',
            headers: createWebDavHeaders(),
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'follow',
        });
        if (retryInfo.ok) return false;
        throw new Error(t('syncParentDirectoryMissing'));
    }
    throw new Error(t('syncCreateDirectoryFailed', { status: createResponse.status }));
}

async function writeRemoteSyncFile(endpoint, content, remote, context) {
    if (context.provider === 'koofr') return writeKoofrSyncFile(content, remote, context);
    const headers = createWebDavHeaders(true);
    if (remote.exists && remote.etag) headers.set('If-Match', remote.etag);
    else if (!remote.exists) headers.set('If-None-Match', '*');

    const response = await fetchWebDav(endpoint, {
        method: 'PUT',
        headers,
        body: content,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (response.status === 412) return 'conflict';
    if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
    if (response.status === 409) throw new Error(t('syncParentDirectoryMissing'));
    if (!response.ok) throw new Error(t('syncWriteFailed', { status: response.status }));
    return 'written';
}

async function writeKoofrSyncFile(content, remote, context) {
    const parameters = {
        path: context.directoryPath,
        info: true,
        filename: context.fileName,
        overwrite: true,
        autorename: false,
    };
    if (remote.exists && remote.token?.hash) parameters.overwriteIfHash = remote.token.hash;
    if (remote.exists && remote.token?.modified !== null) parameters.overwriteIfModified = remote.token.modified;
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'application/json' }), context.fileName);
    const response = await fetchWebDav(createKoofrApiUrl(context, 'put', {
        content: true,
        parameters,
    }), {
        method: 'POST',
        headers: createWebDavHeaders(),
        body: form,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
    });
    if (response.status === 409 && remote.exists) return 'conflict';
    if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
    if (response.status === 404 || response.status === 409) throw new Error(t('syncParentDirectoryMissing'));
    if (!response.ok) throw new Error(t('syncWriteFailed', { status: response.status }));
    return 'written';
}
