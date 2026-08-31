/* Browser-native regression tests. No production data is accessed. */
'use strict';

const testCases = [];

function test(name, run) {
    testCases.push({ name, run });
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(message || `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, message = '') {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(message || `Expected ${expectedJson}, received ${actualJson}`);
    }
}

function makeSyncItem(overrides = {}) {
    return {
        syncId: 'item-1',
        parentSyncId: null,
        title: 'Base title',
        url: 'https://example.com/',
        description: 'Base description',
        tags: ['base'],
        isPinned: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        modifiedBy: 'device-base',
        ...overrides,
    };
}

function makeDataset(item, tombstones = [], devices = []) {
    return { items: item ? [item] : [], tombstones, devices };
}

function createMemoryDirectory(name = 'memory') {
    const entries = new Map();
    return {
        kind: 'directory',
        name,
        async getDirectoryHandle(childName, options = {}) {
            if (entries.has(childName)) return entries.get(childName);
            if (!options.create) throw new DOMException('Not found', 'NotFoundError');
            const directory = createMemoryDirectory(childName);
            entries.set(childName, directory);
            return directory;
        },
        async getFileHandle(fileName, options = {}) {
            if (entries.has(fileName)) return entries.get(fileName);
            if (!options.create) throw new DOMException('Not found', 'NotFoundError');
            let content = '';
            let lastModified = Date.now();
            const handle = {
                kind: 'file',
                name: fileName,
                async getFile() {
                    return {
                        size: new Blob([content]).size,
                        lastModified,
                        text: async () => content,
                    };
                },
                async createWritable() {
                    let nextContent = '';
                    return {
                        write: async (value) => { nextContent += String(value); },
                        close: async () => {
                            content = nextContent;
                            lastModified += 1;
                        },
                        abort: async () => {},
                    };
                },
            };
            entries.set(fileName, handle);
            return handle;
        },
        async removeEntry(childName) {
            if (!entries.has(childName)) throw new DOMException('Not found', 'NotFoundError');
            entries.delete(childName);
        },
        async *entries() {
            yield* entries.entries();
        },
    };
}

function deleteTestDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        let blockedTimer = null;
        request.onsuccess = () => {
            window.clearTimeout(blockedTimer);
            resolve();
        };
        request.onerror = () => {
            window.clearTimeout(blockedTimer);
            reject(request.error);
        };
        request.onblocked = () => {
            try {
                state.db?.close();
                state.db = null;
            } catch {
                // Wait for any test transaction that is already closing.
            }
            window.clearTimeout(blockedTimer);
            blockedTimer = window.setTimeout(
                () => reject(new Error('Test database deletion remained blocked')),
                2000,
            );
        };
    });
}

test('标签解析会去重并清理空白', () => {
    assertDeepEqual(parseTags(' docs, tools，docs, , later '), ['docs', 'tools', 'later']);
});

test('模态窗口中的警告提示会进入浏览器顶层', () => {
    const previousToast = ui.toast;
    const previousToastIconUse = ui.toastIconUse;
    const previousToastMessage = ui.toastMessage;
    const dialog = document.createElement('dialog');
    const toast = document.createElement('div');
    const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const message = document.createElement('span');
    toast.className = 'toast hidden';
    toast.setAttribute('popover', 'manual');
    toast.append(iconUse, message);
    document.body.append(dialog, toast);
    dialog.showModal();
    ui.toast = toast;
    ui.toastIconUse = iconUse;
    ui.toastMessage = message;

    try {
        showToast('权限请求结果', 'warning');
        assertEqual(message.textContent, '权限请求结果');
        assertEqual(toast.dataset.tone, 'warning');
        assertEqual(iconUse.getAttribute('href'), '#icon-alert');
        if (typeof toast.showPopover === 'function') {
            assert(toast.matches(':popover-open'), 'Toast did not enter the browser top layer');
        } else {
            assertEqual(toast.parentElement, dialog, 'Toast fallback was not mounted inside the dialog');
        }
    } finally {
        hideToast();
        if (dialog.open) dialog.close();
        toast.remove();
        dialog.remove();
        ui.toast = previousToast;
        ui.toastIconUse = previousToastIconUse;
        ui.toastMessage = previousToastMessage;
    }
});

test('URL 会自动补全 HTTPS 并拒绝危险协议', () => {
    assertEqual(normalizeUrl('example.com/path'), 'https://example.com/path');
    let rejected = false;
    try {
        normalizeUrl('javascript:alert(1)');
    } catch {
        rejected = true;
    }
    assert(rejected, 'javascript: URL should be rejected');
});

test('同步地址会规范化并识别 Koofr', () => {
    assertEqual(
        normalizeWebDavEndpoint('https://dav.example.com/bookmarks/'),
        'https://dav.example.com/bookmarks/bookmarks-sync.enc.json',
    );
    assert(isKoofrSyncEndpoint('https://app.koofr.net/dav/Koofr/Example-Bookmarks/'));
    assert(!isKoofrSyncEndpoint('https://dav.example.com/Koofr/Example-Bookmarks/'));
});

test('Azure Blob 地址支持全球 Azure、中国区和 SAS 本机拆分', () => {
    const globalContainer = 'https://exampleaccount.blob.core.windows.net/example-container/';
    const chinaContainer = 'https://exampleaccount.blob.core.chinacloudapi.cn/example-container/';
    const sas = 'sv=2023-11-03&sr=c&sp=rcw&se=2099-01-01T00%3A00%3A00Z&sig=example-signature';
    assert(isAzureBlobSyncEndpoint(globalContainer));
    assert(isAzureBlobSyncEndpoint(chinaContainer));
    assert(!isAzureBlobSyncEndpoint('https://blob.example.com/example-container/'));
    assertEqual(
        normalizeWebDavEndpoint(globalContainer),
        `${globalContainer}bookmarks-sync.enc.json`,
    );
    assertEqual(
        normalizeWebDavEndpoint(chinaContainer),
        `${chinaContainer}bookmarks-sync.enc.json`,
    );

    const separated = separateAzureBlobCredential(`${globalContainer}?${sas}`, '');
    assert(separated.isAzureBlob);
    assertEqual(separated.endpoint, globalContainer);
    assertEqual(separated.credential, sas);
    assert(!separated.endpoint.includes('sig='));
    assertEqual(validateAzureBlobSasToken(separated.credential), sas);
    assert(hasRemoteAccessCredential(separated.endpoint, '', separated.credential));
    assert(!hasRemoteAccessCredential(separated.endpoint, '', ''));

    let rejectedExpiredSas = false;
    try {
        validateAzureBlobSasToken('sv=2023-11-03&se=2020-01-01T00%3A00%3A00Z&sig=example-expired');
    } catch (error) {
        rejectedExpiredSas = error.message === t('azureBlobSasExpired');
    }
    assert(rejectedExpiredSas, 'Expired Azure SAS must be rejected');

    let rejectedInsecureUrl = false;
    try {
        normalizeWebDavEndpoint(globalContainer.replace('https:', 'http:'));
    } catch {
        rejectedInsecureUrl = true;
    }
    assert(rejectedInsecureUrl, 'Azure Blob must require HTTPS');
});

test('远端版本探测会使用条件请求并识别内容变化', async () => {
    const originalFetch = window.fetch;
    const previousUsername = state.sync.username;
    const previousPassword = state.sync.password;
    const requests = [];
    state.sync.username = 'shared-user';
    state.sync.password = 'shared-password';
    try {
        window.fetch = async (_url, options) => {
            requests.push(options);
            return new Response(null, { status: 304 });
        };
        const previousVersion = {
            provider: 'webdav',
            exists: true,
            etag: '"version-1"',
            lastModified: '',
            size: 20,
            contentHash: 'old-content',
        };
        const unchanged = await probeRemoteSyncVersion(
            'https://dav.example.com/bookmarks-sync.enc.json',
            { provider: 'webdav' },
            previousVersion,
        );
        assert(unchanged.unchanged);
        assertDeepEqual(unchanged.version, previousVersion);
        assertEqual(requests[0].headers.get('If-None-Match'), '"version-1"');

        window.fetch = async (_url, options) => {
            requests.push(options);
            return new Response('{"cipher":"changed"}', {
                status: 200,
                headers: {
                    ETag: '"version-2"',
                    'Last-Modified': 'Wed, 07 Jan 2026 00:00:00 GMT',
                    'Content-Length': '20',
                },
            });
        };
        const changed = await probeRemoteSyncVersion(
            'https://dav.example.com/bookmarks-sync.enc.json',
            { provider: 'webdav' },
            previousVersion,
        );
        assertEqual(changed.version.etag, '"version-2"');
        assert(!remoteSyncVersionsEquivalent(previousVersion, changed.version));
        assert(remoteSyncVersionsEquivalent(changed.version, { ...changed.version }));

        window.fetch = async (_url, options) => {
            requests.push(options);
            return new Response(null, { status: 204, headers: { ETag: '"version-3"' } });
        };
        const writeResult = await writeRemoteSyncFile(
            'https://dav.example.com/bookmarks-sync.enc.json',
            '{"encrypted":true}',
            { exists: true, etag: '"version-2"' },
            { provider: 'webdav' },
        );
        assertEqual(writeResult.status, 'written');
        assertEqual(writeResult.version.etag, '"version-3"');
        assertEqual(requests.at(-1).headers.get('If-Match'), '"version-2"');
        assert(remoteSyncVersionsEquivalent(
            { provider: 'koofr', exists: true, hash: 'hash-1', modified: 1, size: 10 },
            { provider: 'koofr', exists: true, hash: 'hash-1', modified: 2, size: 10 },
        ));
        assert(!remoteSyncVersionsEquivalent(
            { provider: 'koofr', exists: true, hash: 'hash-1', modified: 1, size: 10 },
            { provider: 'koofr', exists: true, hash: 'hash-2', modified: 2, size: 10 },
        ));

        window.fetch = async (_url, options) => {
            requests.push(options);
            return new Response(JSON.stringify({
                type: 'file',
                hash: 'koofr-hash',
                modified: 12345,
                size: 99,
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const koofr = await probeRemoteSyncVersion('', {
            provider: 'koofr',
            origin: 'https://app.koofr.net',
            mountId: 'mount-test',
            filePath: '/shared/bookmarks-sync.enc.json',
        });
        assertEqual(koofr.version.hash, 'koofr-hash');
        assertEqual(koofr.version.modified, 12345);
    } finally {
        window.fetch = originalFetch;
        state.sync.username = previousUsername;
        state.sync.password = previousPassword;
    }
});

test('Azure Blob 适配器使用 SAS、ETag 和 BlockBlob 条件写入', async () => {
    const originalFetch = window.fetch;
    const previousPassword = state.sync.password;
    const previousPassphrase = state.sync.passphrase;
    const endpoint = 'https://exampleaccount.blob.core.windows.net/example-container/bookmarks-sync.enc.json';
    const sas = 'sv=2023-11-03&sr=b&sp=rcw&se=2099-01-01T00%3A00%3A00Z&sig=example-signature';
    const passphrase = 'azure adapter test passphrase';
    const requests = [];
    try {
        state.sync.password = sas;
        state.sync.passphrase = passphrase;
        const context = await createSyncRemoteContext(endpoint, { silent: true });
        assertEqual(context.provider, 'azure-blob');
        assert(!JSON.stringify(context).includes('example-signature'));

        window.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(null, {
                status: 200,
                headers: {
                    ETag: '"azure-version-1"',
                    'Last-Modified': 'Wed, 07 Jan 2026 00:00:00 GMT',
                    'Content-Length': '120',
                },
            });
        };
        const observed = await probeRemoteSyncVersion(endpoint, context);
        assertEqual(observed.version.provider, 'azure-blob');
        assertEqual(observed.version.etag, '"azure-version-1"');
        assert(remoteSyncVersionsEquivalent(observed.version, { ...observed.version }));
        assert(!remoteSyncVersionsEquivalent(observed.version, {
            ...observed.version,
            etag: '"azure-version-other"',
        }));
        assertEqual(requests[0].options.method, 'HEAD');
        assertEqual(new URL(requests[0].url).searchParams.get('sig'), 'example-signature');
        assertEqual(requests[0].options.headers.get('x-ms-version'), AZURE_BLOB_API_VERSION);

        window.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(null, { status: 304 });
        };
        const unchanged = await probeRemoteSyncVersion(endpoint, context, observed.version);
        assert(unchanged.unchanged);
        assertEqual(requests.at(-1).options.headers.get('If-None-Match'), '"azure-version-1"');

        const encrypted = await encryptSyncData(makeDataset(makeSyncItem({ title: 'Azure item' })), passphrase);
        window.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(encrypted, {
                status: 200,
                headers: {
                    ETag: '"azure-version-2"',
                    'Last-Modified': 'Wed, 07 Jan 2026 00:01:00 GMT',
                    'Content-Length': String(encrypted.length),
                },
            });
        };
        const remote = await readRemoteSyncFile(endpoint, context);
        assert(remote.exists);
        assertEqual(remote.etag, '"azure-version-2"');
        assertEqual(remote.data.items[0].title, 'Azure item');

        window.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(null, {
                status: 201,
                headers: {
                    ETag: '"azure-version-3"',
                    'Last-Modified': 'Wed, 07 Jan 2026 00:02:00 GMT',
                },
            });
        };
        const written = await writeRemoteSyncFile(endpoint, encrypted, remote, context);
        const writeRequest = requests.at(-1);
        assertEqual(written.status, 'written');
        assertEqual(written.version.etag, '"azure-version-3"');
        assertEqual(writeRequest.options.method, 'PUT');
        assertEqual(writeRequest.options.headers.get('If-Match'), '"azure-version-2"');
        assertEqual(writeRequest.options.headers.get('x-ms-blob-type'), 'BlockBlob');
        assertEqual(writeRequest.options.credentials, 'omit');

        window.fetch = async (url, options) => {
            requests.push({ url, options });
            return new Response(null, {
                status: 201,
                headers: { ETag: '"azure-version-created"' },
            });
        };
        const created = await writeRemoteSyncFile(endpoint, encrypted, { exists: false }, context);
        assertEqual(created.status, 'written');
        assertEqual(requests.at(-1).options.headers.get('If-None-Match'), '*');

        window.fetch = async () => new Response(null, { status: 412 });
        const conflict = await writeRemoteSyncFile(endpoint, encrypted, remote, context);
        assertEqual(conflict.status, 'conflict');

        window.fetch = async () => new Response(null, { status: 200 });
        let missingEtag = false;
        try {
            await probeRemoteSyncVersion(endpoint, context);
        } catch (error) {
            missingEtag = error.message === t('azureBlobEtagUnavailable');
        }
        assert(missingEtag, 'Azure Blob must expose ETag through CORS');

        window.fetch = async () => new Response(null, { status: 403 });
        let accessDenied = false;
        try {
            await readRemoteSyncFile(endpoint, context);
        } catch (error) {
            accessDenied = error.message === t('azureBlobAccessDenied');
        }
        assert(accessDenied, 'Azure Blob access failures must use the SAS-specific message');

        window.fetch = async () => new Response(null, { status: 404 });
        let missingContainer = false;
        try {
            await writeRemoteSyncFile(endpoint, encrypted, { exists: false }, context);
        } catch (error) {
            missingContainer = error.message === t('azureBlobContainerMissing');
        }
        assert(missingContainer, 'Azure Blob cannot create a missing container');
    } finally {
        window.fetch = originalFetch;
        state.sync.password = previousPassword;
        state.sync.passphrase = previousPassphrase;
    }
});

test('远端检查只在版本变化时触发完整同步', async () => {
    const sync = state.sync;
    const watch = sync.remoteWatch;
    const previousSync = {
        initialized: sync.initialized,
        mode: sync.mode,
        supported: sync.supported,
        setupComplete: sync.setupComplete,
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        automatic: sync.automatic,
        unlocked: sync.unlocked,
        conflicts: sync.conflicts,
        running: sync.running,
        retryScheduled: sync.retryScheduled,
        error: sync.error,
        lastSyncAt: sync.lastSyncAt,
    };
    const previousWatch = { ...watch };
    const originalCreateContext = createSyncRemoteContext;
    const originalProbe = probeRemoteSyncVersion;
    const originalRunSync = runWebDavSync;
    let observedVersion = {
        provider: 'webdav',
        exists: true,
        etag: '"shared-1"',
        lastModified: '',
        size: 10,
        contentHash: 'content-1',
    };
    let fullSyncCount = 0;
    createSyncRemoteContext = async () => ({ provider: 'webdav' });
    probeRemoteSyncVersion = async () => ({ version: observedVersion, unchanged: false });
    runWebDavSync = async () => {
        fullSyncCount += 1;
        return true;
    };
    try {
        Object.assign(sync, {
            initialized: true,
            mode: 'remote',
            supported: true,
            setupComplete: true,
            endpoint: 'https://dav.example.com/shared/bookmarks-sync.enc.json',
            username: '',
            password: '',
            passphrase: 'shared library passphrase',
            automatic: true,
            unlocked: true,
            conflicts: [],
            running: false,
            retryScheduled: false,
            error: '',
            lastSyncAt: '2026-01-01T00:00:00.000Z',
        });
        Object.assign(watch, {
            endpointKey: syncEndpointKey(),
            version: { ...observedVersion },
            lastCheckedAt: '',
            lastChangeAt: '',
            error: '',
            retryCount: 0,
        });
        safeStorageSet(REMOTE_WATCH_STORAGE_KEY, '');
        const unchanged = await performRemoteSyncVersionCheck();
        assertEqual(unchanged.changed, false);
        assertEqual(fullSyncCount, 0);

        safeStorageSet(REMOTE_WATCH_STORAGE_KEY, '');
        observedVersion = { ...observedVersion, etag: '"shared-2"', contentHash: 'content-2' };
        const changed = await performRemoteSyncVersionCheck();
        assertEqual(changed.changed, true);
        assertEqual(fullSyncCount, 1);
    } finally {
        window.clearTimeout(watch.timer);
        safeStorageSet(REMOTE_WATCH_STORAGE_KEY, '');
        Object.assign(sync, previousSync);
        Object.assign(watch, previousWatch);
        createSyncRemoteContext = originalCreateContext;
        probeRemoteSyncVersion = originalProbe;
        runWebDavSync = originalRunSync;
    }
});

test('多个标签页的远端检查锁只允许一个探测任务', async () => {
    if (!navigator.locks?.request) return;
    let releaseFirst;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const hold = new Promise((resolve) => { releaseFirst = resolve; });
    const first = tryRemoteWatchLock(async () => {
        markStarted();
        await hold;
        return 'first';
    });
    await started;
    const second = await tryRemoteWatchLock(async () => 'second');
    assertEqual(second.acquired, false);
    releaseFirst();
    const firstResult = await first;
    assertEqual(firstResult.acquired, true);
    assertEqual(firstResult.value, 'first');
});

test('远端监视器会在页面可用时按计划执行检查', async () => {
    const sync = state.sync;
    const watch = sync.remoteWatch;
    const previousSync = {
        initialized: sync.initialized,
        mode: sync.mode,
        supported: sync.supported,
        setupComplete: sync.setupComplete,
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        automatic: sync.automatic,
        unlocked: sync.unlocked,
        conflicts: sync.conflicts,
        error: sync.error,
    };
    const previousWatch = { ...watch };
    const originalCheck = checkRemoteSyncVersion;
    let checks = 0;
    checkRemoteSyncVersion = async () => {
        checks += 1;
        return false;
    };
    try {
        Object.assign(sync, {
            initialized: true,
            mode: 'remote',
            supported: true,
            setupComplete: true,
            endpoint: 'https://dav.example.com/shared/bookmarks-sync.enc.json',
            username: '',
            password: '',
            passphrase: 'scheduled shared passphrase',
            automatic: true,
            unlocked: true,
            conflicts: [],
            error: '',
        });
        startRemoteSyncWatcher(10);
        await new Promise((resolve) => setTimeout(resolve, 90));
        assertEqual(checks, 1);
    } finally {
        stopRemoteSyncWatcher();
        Object.assign(sync, previousSync);
        Object.assign(watch, previousWatch);
        checkRemoteSyncVersion = originalCheck;
    }
});

test('自动同步超时会隐藏内部路径并安排渐进重试', async () => {
    const originalFetch = window.fetch;
    const sync = state.sync;
    const previous = {
        supported: sync.supported,
        mode: sync.mode,
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        automatic: sync.automatic,
        unlocked: sync.unlocked,
        conflicts: sync.conflicts,
        abortController: sync.abortController,
        timer: sync.timer,
        error: sync.error,
        retryScheduled: sync.retryScheduled,
        retryCount: sync.retryCount,
        retryAt: sync.retryAt,
        lastNotifiedError: sync.lastNotifiedError,
    };
    let timeoutError = null;
    window.fetch = (_url, options) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    try {
        try {
            await fetchWebDav('https://app.koofr.net/api/v2/mounts/private/files/info', { method: 'GET' });
        } catch (error) {
            timeoutError = error;
        }
        assertEqual(timeoutError?.code, 'SYNC_TIMEOUT');
        assert(!timeoutError.message.includes('koofr.net'));
        assert(!timeoutError.message.includes('/api/'));
        assert(!Object.hasOwn(timeoutError, 'requestTarget'));
        assert(!Object.hasOwn(timeoutError, 'cause'));

        Object.assign(sync, {
            supported: true,
            mode: 'remote',
            endpoint: 'https://app.koofr.net/dav/Koofr/Example-Bookmarks/',
            username: '',
            password: '',
            passphrase: 'test passphrase',
            automatic: true,
            unlocked: false,
            conflicts: [],
            abortController: null,
            error: timeoutError.message,
            retryScheduled: false,
            retryCount: 0,
            retryAt: 0,
            lastNotifiedError: timeoutError.message,
        });
        assertEqual(scheduleTransientSyncRetry(timeoutError), 5000);
        assert(sync.retryScheduled);
        assertEqual(sync.retryCount, 1);
        assert(sync.retryAt > Date.now());
        assertEqual(sync.error, '');
    } finally {
        window.clearTimeout(sync.timer);
        Object.assign(sync, previous);
        window.fetch = originalFetch;
    }
});

test('诊断日志会移除远端地址、本机路径、凭据和错误堆栈', () => {
    const genericRoot = 'https://app.koofr.net/dav/Koofr';
    const privateSegment = ['Private', 'Team'].join('-');
    const endpoint = `${genericRoot}/${privateSegment}/bookmarks-sync.enc.json`;
    const localPath = ['C:', 'Users', 'Example Person', 'Cloud Drive', 'bookmarks'].join('\\');
    const authorizationType = ['Bas', 'ic'].join('');
    const encodedCredential = ['dGVzdC11c2Vy', 'OnRlc3QtcGFzc3dvcmQ='].join('');
    const error = new Error(
        `Request to ${endpoint} failed at ${localPath}; ${authorizationType} ${encodedCredential}`,
    );
    error.name = 'NetworkError';
    error.code = 'SYNC_NETWORK';
    error.status = 503;
    error.requestTarget = endpoint;
    error.cause = new Error(`Underlying request failed for ${endpoint}`);
    error.stack = `NetworkError: ${endpoint}\n at ${localPath}`;

    const safe = safeErrorForLog(error);
    const originalConsoleError = console.error;
    let logged = [];
    try {
        console.error = (...values) => { logged = values; };
        logErrorSafely('error', 'Synthetic diagnostic failure.', error);
    } finally {
        console.error = originalConsoleError;
    }
    const serialized = JSON.stringify({ safe, logged });
    assertEqual(safe.code, 'SYNC_NETWORK');
    assertEqual(safe.status, 503);
    assert(!serialized.includes(privateSegment));
    assert(!serialized.includes('Example Person'));
    assert(!serialized.includes(encodedCredential));
    assert(!serialized.includes('requestTarget'));
    assert(!serialized.includes('cause'));
    assert(!serialized.includes('stack'));
    assert(serialized.includes('[redacted URL]'));
    assert(serialized.includes('[redacted local path]'));
    assert(serialized.includes('[redacted credential]'));
});

test('顶部同步快捷按钮会随状态切换操作', () => {
    const sync = state.sync;
    const previousSync = {
        initialized: sync.initialized,
        setupComplete: sync.setupComplete,
        mode: sync.mode,
        endpoint: sync.endpoint,
        passphrase: sync.passphrase,
        username: sync.username,
        password: sync.password,
        conflicts: sync.conflicts,
        running: sync.running,
    };
    const previousUi = {
        quickSyncButton: ui.quickSyncButton,
        quickSyncIconUse: ui.quickSyncIconUse,
        quickSyncLabel: ui.quickSyncLabel,
    };
    const button = document.createElement('button');
    const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const label = document.createElement('span');
    ui.quickSyncButton = button;
    ui.quickSyncIconUse = iconUse;
    ui.quickSyncLabel = label;

    try {
        Object.assign(sync, {
            initialized: true,
            setupComplete: true,
            mode: 'remote',
            endpoint: 'https://dav.example.com/bookmarks/',
            passphrase: 'test passphrase',
            username: '',
            password: '',
            conflicts: [],
            running: false,
        });
        renderQuickSyncButton('retry', t('syncRetryDetail'), false);
        assertEqual(label.textContent, t('quickRetrySync'));
        assertEqual(button.dataset.state, 'retry');
        assert(!button.disabled);

        sync.passphrase = '';
        renderQuickSyncButton('locked', t('syncLockedDetail'), false);
        assertEqual(label.textContent, t('quickUnlockSync'));

        sync.passphrase = 'test passphrase';
        sync.conflicts = [{ syncId: 'conflict' }];
        renderQuickSyncButton('conflict', t('syncConflictStatusTitle'), false);
        assertEqual(label.textContent, t('reviewConflicts'));
        assertEqual(iconUse.getAttribute('href'), '#icon-alert');
    } finally {
        Object.assign(sync, previousSync);
        Object.assign(ui, previousUi);
    }
});

test('加入共享书签库时不会在错误地址静默创建新库', () => {
    let rejected = false;
    try {
        assertRemoteSyncJoinTarget({ exists: false }, true);
    } catch (error) {
        rejected = error.message === t('sharedLibraryNotFound');
    }
    assert(rejected, 'Joining should reject a missing shared library');
    assertRemoteSyncJoinTarget({ exists: false }, false);
    assertRemoteSyncJoinTarget({ exists: true }, true);
});

test('设备名称元数据会按更新时间合并并兼容旧同步文件', () => {
    const older = {
        deviceId: 'shared-device',
        name: 'Old laptop name',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
        ...older,
        name: 'Design team laptop',
        updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const merged = mergeSyncDatasets(
        { items: [], tombstones: [], devices: [older] },
        { items: [], tombstones: [], devices: [newer] },
    );
    assertEqual(merged.devices.length, 1);
    assertEqual(merged.devices[0].name, 'Design team laptop');

    const threeWay = threeWayMergeSyncDatasets(
        { items: [], tombstones: [], devices: [older] },
        { items: [], tombstones: [], devices: [] },
        { items: [], tombstones: [], devices: [newer] },
    );
    assertEqual(threeWay.dataset.devices[0].name, 'Design team laptop');

    const legacy = parseRemoteSyncDataset({
        format: 'bookmark-manager-sync',
        version: 1,
        items: [],
        tombstones: [],
    });
    assertDeepEqual(legacy.devices, []);
    const current = parseRemoteSyncDataset({
        format: 'bookmark-manager-sync',
        version: 2,
        items: [],
        tombstones: [],
        devices: [newer, { deviceId: '', name: 'Invalid' }],
    });
    assertEqual(current.devices.length, 1);
    assertEqual(current.devices[0].name, 'Design team laptop');
});

test('JSON 导入保留父子层级与同步标识', () => {
    state.sync.deviceId = 'test-device';
    const parsed = parseJsonImport(JSON.stringify([
        { id: 10, syncId: 'folder-id', title: 'Folder', url: '', parentId: null },
        { id: 11, syncId: 'bookmark-id', title: 'Bookmark', url: 'https://example.com', parentId: 10 },
    ]));
    assertEqual(parsed.records.length, 2);
    assertEqual(parsed.records[0].syncId, 'folder-id');
    assertEqual(parsed.records[1].parentKey, 'json-0');
});

test('浏览器书签 HTML 导入保留文件夹', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
        <DL><p><DT><H3>Resources</H3><DL><p>
        <DT><A HREF="https://example.com" TAGS="docs,test">Example</A>
        </DL><p></DL><p>`;
    const parsed = parseHtmlImport(html);
    assertEqual(parsed.records.length, 2);
    assertEqual(parsed.records[0].url, '');
    assertEqual(parsed.records[1].parentKey, parsed.records[0].sourceKey);
    assertDeepEqual(parsed.records[1].tags, ['docs', 'test']);
});

test('备份恢复会发现快照、预览内容并拒绝不兼容版本', async () => {
    const root = createMemoryDirectory('Backup');
    const history = await root.getDirectoryHandle('history', { create: true });
    const latestPayload = {
        format: 'bookmark-manager',
        version: 2,
        exportedAt: '2026-01-03T00:00:00.000Z',
        bookmarks: [
            { id: 1, syncId: 'restore-folder', title: 'Saved folder', url: '', parentId: null },
            { id: 2, syncId: 'restore-link', title: 'Saved link', url: 'https://example.com', parentId: 1 },
        ],
    };
    await writeBackupFile(root, 'bookmarks-latest.json', JSON.stringify(latestPayload));
    await writeBackupFile(
        history,
        'bookmarks-2026-01-02T00-00-00-000Z.json',
        JSON.stringify({ ...latestPayload, exportedAt: '2026-01-02T00:00:00.000Z' }),
    );
    await writeBackupFile(
        history,
        'bookmarks-2026-01-01T00-00-00-000Z.json',
        JSON.stringify({ ...latestPayload, version: 99 }),
    );
    await writeBackupFile(
        history,
        'bookmarks-2025-12-31T00-00-00-000Z.json',
        JSON.stringify({
            ...latestPayload,
            exportedAt: '2025-12-31T00:00:00.000Z',
            bookmarks: [{ id: 1, title: 'Unsafe', url: 'javascript:alert(1)', parentId: null }],
        }),
    );
    await writeBackupFile(
        history,
        'bookmarks-2025-12-30T00-00-00-000Z.json',
        JSON.stringify({
            ...latestPayload,
            exportedAt: '2025-12-30T00:00:00.000Z',
            bookmarks: [
                { id: 1, title: 'Not a folder', url: 'https://example.com/parent', parentId: null },
                { id: 2, title: 'Invalid child', url: 'https://example.com/child', parentId: 1 },
            ],
        }),
    );

    assert(await backupDirectoryContainsPotentialSnapshots(root));
    const snapshots = await scanBackupSnapshotFiles(root);
    assertEqual(snapshots.length, 5);
    assertEqual(snapshots.filter((snapshot) => !snapshot.invalid).length, 2);
    assertEqual(snapshots[0].kind, 'latest');
    assertEqual(snapshots[0].bookmarks, 1);
    assertEqual(snapshots[0].folders, 1);
    assertEqual(snapshots.filter((snapshot) => snapshot.invalid).length, 3);
    assert(snapshots.some((snapshot) => snapshot.invalid && snapshot.error.includes('99')));
    const records = await readBackupSnapshotRecords(snapshots[0]);
    assertEqual(records.length, 2);
    assertEqual(records[1].parentKey, records[0].sourceKey);
});

test('加密备份隐藏明文并可与旧版明文快照混合恢复', async () => {
    const passphrase = 'encrypted backup passphrase';
    const payload = {
        format: 'bookmark-manager',
        version: 2,
        exportedAt: '2026-01-04T00:00:00.000Z',
        bookmarks: [{
            id: 1,
            syncId: 'encrypted-item',
            title: 'Private bookmark title',
            url: 'https://private.example/',
            parentId: null,
        }],
    };
    const encrypted = await createBackupFileContent(payload, { encrypted: true, passphrase });
    assert(!encrypted.includes('Private bookmark title'), 'Encrypted backup leaked a title');
    assert(!encrypted.includes('private.example'), 'Encrypted backup leaked a URL');
    assert(!encrypted.includes(payload.exportedAt), 'Encrypted backup leaked its payload timestamp');
    validateEncryptedBackupEnvelope(JSON.parse(encrypted));
    assertDeepEqual(await decryptBackupData(encrypted, passphrase), payload);

    let rejected = false;
    try {
        await decryptBackupData(encrypted, 'incorrect backup passphrase');
    } catch (error) {
        rejected = error?.code === 'BACKUP_DECRYPT_FAILED';
    }
    assert(rejected, 'Wrong backup passphrase should be rejected');

    const root = createMemoryDirectory('Mixed backup');
    await writeBackupFile(root, 'bookmarks-latest.enc.json', encrypted);
    await writeBackupFile(root, 'bookmarks-latest.json', JSON.stringify({
        ...payload,
        exportedAt: '2026-01-03T00:00:00.000Z',
        bookmarks: [{ ...payload.bookmarks[0], syncId: 'plain-item', title: 'Plain legacy item' }],
    }));
    const history = await root.getDirectoryHandle('history', { create: true });
    const damagedEnvelope = JSON.parse(encrypted);
    damagedEnvelope.cipher.data = 'not-base64';
    await writeBackupFile(
        history,
        'bookmarks-2026-01-02T00-00-00-000Z.enc.json',
        JSON.stringify(damagedEnvelope),
    );
    const snapshots = await scanBackupSnapshotFiles(root);
    assertEqual(snapshots.length, 3);
    assertEqual(snapshots.filter((snapshot) => snapshot.invalid).length, 1);
    const encryptedSnapshot = snapshots.find((snapshot) => snapshot.encrypted && !snapshot.invalid);
    const plaintextSnapshot = snapshots.find((snapshot) => !snapshot.encrypted && !snapshot.invalid);
    assert(encryptedSnapshot.locked);
    assertEqual(plaintextSnapshot.bookmarks, 1);
    const unlocked = await readBackupSnapshotData(encryptedSnapshot, passphrase);
    assertEqual(unlocked.records[0].title, 'Private bookmark title');
    assertEqual(unlocked.inspection.bookmarks, 1);

    const previousBackupHandle = state.backup.handle;
    state.backup.handle = root;
    try {
        assert(await verifyExistingBackupPassphrase(passphrase));
        let wrongUnlockRejected = false;
        try {
            await verifyExistingBackupPassphrase('wrong existing passphrase');
        } catch {
            wrongUnlockRejected = true;
        }
        assert(wrongUnlockRejected, 'Wrong existing passphrase should not be accepted');
        const unchangedLatest = await root.getFileHandle('bookmarks-latest.enc.json');
        assertEqual(await (await unchangedLatest.getFile()).text(), encrypted);
    } finally {
        state.backup.handle = previousBackupHandle;
    }

    await writeLatestBackupFile(root, encrypted, true);
    let plaintextLatestRemoved = false;
    try {
        await root.getFileHandle('bookmarks-latest.json');
    } catch (error) {
        plaintextLatestRemoved = error?.name === 'NotFoundError';
    }
    assert(plaintextLatestRemoved, 'Encrypted latest backup should replace the plaintext latest file');
});

test('备份写入后会重新读取并拒绝不一致内容', async () => {
    const payload = {
        format: 'bookmark-manager',
        version: 2,
        exportedAt: '2026-01-05T00:00:00.000Z',
        summary: { items: 1, bookmarks: 1, folders: 0 },
        bookmarks: [{
            id: 1,
            syncId: 'verified-item',
            title: 'Verified item',
            url: 'https://verified.example/',
            parentId: null,
        }],
    };
    const root = createMemoryDirectory('Verification');
    const plaintext = await createBackupFileContent(payload, { encrypted: false, passphrase: '' });
    await writeBackupFile(root, 'bookmarks-latest.json', plaintext);
    const verifiedPlaintext = await verifyWrittenBackupFile(
        root,
        'bookmarks-latest.json',
        plaintext,
        payload,
        { encrypted: false, passphrase: '' },
    );
    assertEqual(verifiedPlaintext.bookmarks[0].title, 'Verified item');

    await writeBackupFile(root, 'bookmarks-latest.json', `${plaintext} `);
    let mismatchRejected = false;
    try {
        await verifyWrittenBackupFile(
            root,
            'bookmarks-latest.json',
            plaintext,
            payload,
            { encrypted: false, passphrase: '' },
        );
    } catch (error) {
        mismatchRejected = error?.code === 'BACKUP_HEALTH_FAILED';
    }
    assert(mismatchRejected, 'Read-back mismatch should fail verification');

    const encrypted = await createBackupFileContent(payload, {
        encrypted: true,
        passphrase: 'verification passphrase',
    });
    await writeBackupFile(root, 'bookmarks-latest.enc.json', encrypted);
    const verifiedEncrypted = await verifyWrittenBackupFile(
        root,
        'bookmarks-latest.enc.json',
        encrypted,
        payload,
        { encrypted: true, passphrase: 'verification passphrase' },
    );
    assertEqual(verifiedEncrypted.bookmarks[0].title, 'Verified item');
});

test('更换备份口令会先验证新副本并保留无法解锁的旧快照', async () => {
    await deleteTestDatabase();
    state.db = await openDatabase();
    await initializeSyncIdentity();
    const previousItems = state.items;
    const previousBackup = {
        ...state.backup,
        health: { ...state.backup.health },
    };
    const originalRenderBackupSettings = renderBackupSettings;
    renderBackupSettings = () => {};
    const oldPassphrase = 'current backup passphrase';
    const newPassphrase = 'new backup passphrase';
    const otherPassphrase = 'older unrelated passphrase';
    const now = '2026-01-07T00:00:00.000Z';
    state.items = [{
        id: 1,
        syncId: 'passphrase-change-item',
        title: 'Passphrase change item',
        url: 'https://passphrase-change.example/',
        description: '',
        tags: [],
        parentId: null,
        isPinned: false,
        collapsed: false,
        createdAt: now,
        updatedAt: now,
        modifiedBy: state.sync.deviceId,
    }];
    const root = createMemoryDirectory('Passphrase change');
    const payload = createBackupPayload();
    const oldEncrypted = await createBackupFileContent(payload, {
        encrypted: true,
        passphrase: oldPassphrase,
    });
    const otherEncrypted = await createBackupFileContent(payload, {
        encrypted: true,
        passphrase: otherPassphrase,
    });
    const plaintext = await createBackupFileContent(payload, { encrypted: false, passphrase: '' });
    const history = await root.getDirectoryHandle('history', { create: true });
    const emergency = await root.getDirectoryHandle('emergency', { create: true });
    const oldHistoryName = 'bookmarks-2026-01-06T00-00-00-000Z.enc.json';
    const otherHistoryName = 'bookmarks-2026-01-05T00-00-00-000Z.enc.json';
    const plainEmergencyName = 'bookmarks-before-restore-2026-01-04T00-00-00-000Z.json';
    await writeBackupFile(root, 'bookmarks-latest.enc.json', oldEncrypted);
    await writeBackupFile(history, oldHistoryName, oldEncrypted);
    await writeBackupFile(history, otherHistoryName, otherEncrypted);
    await writeBackupFile(emergency, plainEmergencyName, plaintext);

    Object.assign(state.backup, {
        supported: true,
        encryptionSupported: true,
        handle: root,
        enabled: false,
        retention: 30,
        encryptionEnabled: true,
        encryptionProfileId: 'old-profile',
        passphrase: oldPassphrase,
        passphraseConfirmed: true,
        rememberSession: false,
        permission: 'granted',
        error: '',
        lastHash: '',
        running: false,
        pending: false,
        currentPromise: null,
        timer: null,
    });
    Object.assign(state.backup.health, {
        status: 'unknown',
        lastVerifiedAt: '',
        lastVerifiedHash: '',
        format: '',
        snapshotCount: 0,
        error: '',
        running: false,
        currentPromise: null,
        timer: null,
    });

    try {
        const result = await changeBackupPassphraseSafely({
            oldPassphrase,
            newPassphrase,
            migrateExisting: true,
        });
        assertEqual(result.migrated, 3);
        assertEqual(result.skipped, 1);
        assertEqual(result.cleanupFailed, 0);
        assertEqual(state.backup.passphrase, newPassphrase);
        assertEqual(state.backup.health.status, 'verified');

        const latest = await root.getFileHandle('bookmarks-latest.enc.json');
        const latestPayload = await decryptBackupData(
            await (await latest.getFile()).text(),
            newPassphrase,
        );
        assertEqual(latestPayload.bookmarks[0].title, 'Passphrase change item');

        let oldHistoryRemoved = false;
        try {
            await history.getFileHandle(oldHistoryName);
        } catch (error) {
            oldHistoryRemoved = error?.name === 'NotFoundError';
        }
        assert(oldHistoryRemoved, 'Converted history source should be removed after verification');
        const untouchedOldHistory = await history.getFileHandle(otherHistoryName);
        assertEqual(
            (await decryptBackupData(await (await untouchedOldHistory.getFile()).text(), otherPassphrase))
                .bookmarks[0].title,
            'Passphrase change item',
        );

        let plaintextEmergencyRemoved = false;
        try {
            await emergency.getFileHandle(plainEmergencyName);
        } catch (error) {
            plaintextEmergencyRemoved = error?.name === 'NotFoundError';
        }
        assert(plaintextEmergencyRemoved, 'Converted plaintext emergency source should be removed');
        const emergencyNames = [];
        for await (const [name] of emergency.entries()) emergencyNames.push(name);
        assert(emergencyNames.some((name) => name.endsWith('.enc.json')));

        const futurePassphrase = 'future only passphrase';
        const futureResult = await changeBackupPassphraseSafely({
            oldPassphrase: newPassphrase,
            newPassphrase: futurePassphrase,
            migrateExisting: false,
        });
        assertEqual(futureResult.migrated, 0);
        assertEqual(futureResult.archived, 1);
        assertEqual(futureResult.skipped, 0);
        const futureLatest = await root.getFileHandle('bookmarks-latest.enc.json');
        assertEqual(
            (await decryptBackupData(await (await futureLatest.getFile()).text(), futurePassphrase))
                .bookmarks[0].title,
            'Passphrase change item',
        );
        const retainedHistoryNames = [];
        for await (const [name] of history.entries()) retainedHistoryNames.push(name);
        assert(retainedHistoryNames.some((name) => name.includes('before-passphrase-change')));

        const currentPreferences = await getSetting(BACKUP_PREFERENCES_KEY);
        state.backup.encryptionProfileId = 'stale-other-tab-profile';
        state.backup.passphrase = 'stale other tab passphrase';
        state.backup.passphraseConfirmed = true;
        assertEqual(await ensureBackupProtectionProfileCurrent(), false);
        assertEqual(state.backup.encryptionProfileId, currentPreferences.encryptionProfileId);
        assertEqual(state.backup.passphrase, '');
        assert(state.backup.passphraseNeedsVerification);
    } finally {
        window.clearTimeout(state.backup.timer);
        window.clearTimeout(state.backup.health.timer);
        renderBackupSettings = originalRenderBackupSettings;
        state.items = previousItems;
        const previousHealth = previousBackup.health;
        delete previousBackup.health;
        Object.assign(state.backup, previousBackup);
        Object.assign(state.backup.health, previousHealth);
        state.db.close();
        state.db = null;
        await deleteTestDatabase();
    }
});

test('恢复前紧急备份会保存当前状态', async () => {
    const previousItems = state.items;
    const previousDeviceId = state.sync.deviceId;
    state.sync.deviceId = 'restore-safety-device';
    state.items = [{
        id: 1,
        syncId: 'safety-item',
        title: 'Before restore',
        url: 'https://before.example/',
        description: '',
        tags: [],
        parentId: null,
        isPinned: false,
        collapsed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        modifiedBy: 'restore-safety-device',
    }];
    try {
        const root = createMemoryDirectory('Backup');
        const filename = await writeRestoreEmergencyBackup(root);
        assert(filename.startsWith('bookmarks-before-restore-'));
        const emergency = await root.getDirectoryHandle('emergency');
        const file = await emergency.getFileHandle(filename);
        const payload = JSON.parse(await (await file.getFile()).text());
        assertEqual(payload.reason, 'before-restore');
        assertEqual(payload.bookmarks[0].title, 'Before restore');

        const encryptedName = await writeRestoreEmergencyBackup(root, {
            encrypted: true,
            passphrase: 'emergency backup passphrase',
        });
        assert(encryptedName.endsWith('.enc.json'));
        const encryptedFile = await emergency.getFileHandle(encryptedName);
        const encryptedContent = await (await encryptedFile.getFile()).text();
        assert(!encryptedContent.includes('Before restore'));
        const encryptedPayload = await decryptBackupData(
            encryptedContent,
            'emergency backup passphrase',
        );
        assertEqual(encryptedPayload.reason, 'before-restore');
        assertEqual(encryptedPayload.bookmarks[0].title, 'Before restore');
    } finally {
        state.items = previousItems;
        state.sync.deviceId = previousDeviceId;
    }
});

test('合并恢复会复用文件夹并跳过已有网址', () => {
    const previousItems = state.items;
    state.items = [
        { id: 1, syncId: 'existing-folder', title: 'Research', url: '', parentId: null },
        { id: 2, syncId: 'existing-link', title: 'Existing', url: 'https://example.com/docs', parentId: 1 },
    ];
    try {
        const records = parseJsonImport(JSON.stringify([
            { id: 10, syncId: 'backup-folder', title: 'Research', url: '', parentId: null },
            { id: 11, syncId: 'backup-existing', title: 'Duplicate', url: 'https://example.com/docs', parentId: 10 },
            { id: 12, syncId: 'backup-new', title: 'New link', url: 'https://example.com/new', parentId: 10 },
        ])).records;
        const prepared = prepareImportMerge(records);
        assertEqual(prepared.duplicateCount, 1);
        assertEqual(prepared.mergedFolderCount, 1);
        assertEqual(prepared.records.length, 2);
        assertEqual(prepared.records[0].existingId, 1);
    } finally {
        state.items = previousItems;
    }
});

test('备份差异预览和选择恢复计划会保护当前内容', () => {
    const currentItems = [
        {
            id: 1,
            syncId: 'folder-1',
            title: 'Work',
            url: '',
            description: '',
            tags: [],
            parentId: null,
            isPinned: false,
            collapsed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            modifiedBy: 'device-current',
        },
        {
            id: 2,
            syncId: 'same-link',
            title: 'Same',
            url: 'https://same.example/',
            description: '',
            tags: ['docs'],
            parentId: 1,
            isPinned: false,
            collapsed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            modifiedBy: 'device-current',
        },
        {
            id: 3,
            syncId: 'changed-link',
            title: 'Changed',
            url: 'https://changed.example/',
            description: 'Current note',
            tags: [],
            parentId: 1,
            isPinned: false,
            collapsed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            modifiedBy: 'device-current',
        },
        {
            id: 4,
            syncId: 'current-only',
            title: 'Keep me',
            url: 'https://current.example/',
            description: '',
            tags: [],
            parentId: null,
            isPinned: false,
            collapsed: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
            modifiedBy: 'device-current',
        },
    ];
    const records = parseJsonImport(JSON.stringify([
        { id: 10, syncId: 'folder-1', title: 'Work', url: '', parentId: null },
        { id: 11, syncId: 'same-link', title: 'Same', url: 'https://same.example/', tags: ['docs'], parentId: 10 },
        { id: 12, syncId: 'changed-link', title: 'Changed', url: 'https://changed.example/', description: 'Saved note', parentId: 10 },
        { id: 13, syncId: 'new-folder', title: 'Archive', url: '', parentId: 10 },
        { id: 14, syncId: 'new-link', title: 'Recovered', url: 'https://new.example/', parentId: 13 },
        { id: 15, syncId: 'duplicate-link', title: 'Duplicate URL', url: 'https://same.example/', parentId: null },
    ])).records;

    const diff = createBackupRestoreDiff(records, currentItems);
    assertDeepEqual(diff.counts, { add: 3, update: 1, same: 2, remove: 1 });
    assertDeepEqual(
        diff.entries.find((entry) => entry.effectiveSyncId === 'changed-link').changedFields,
        ['description'],
    );

    const mergePlan = createBackupRestorePlan(diff, 'merge');
    assertEqual(mergePlan.entries.length, 2);
    assertEqual(mergePlan.duplicateCount, 1);
    assert(mergePlan.entries.some((entry) => entry.effectiveSyncId === 'new-folder'));
    assert(mergePlan.entries.some((entry) => entry.effectiveSyncId === 'new-link'));

    const newLink = diff.entries.find((entry) => entry.effectiveSyncId === 'new-link');
    const selectivePlan = createBackupRestorePlan(diff, 'selective', new Set([newLink.key]));
    assertEqual(selectivePlan.requestedCount, 1);
    assertEqual(selectivePlan.entries.length, 2);
    assertEqual(selectivePlan.autoIncludedCount, 1);
    assertEqual(selectivePlan.entries[0].effectiveSyncId, 'new-folder');
    assertEqual(selectivePlan.entries[1].parentEffectiveSyncId, 'new-folder');

    const replacePlan = createBackupRestorePlan(diff, 'replace');
    assertEqual(replacePlan.entries.length, 6);
    assertEqual(replacePlan.removeCount, 1);
    assertEqual(replacePlan.actionCount, 5);

    const semanticRecords = parseJsonImport(JSON.stringify([
        { id: 20, syncId: 'another-work-folder', title: 'Work', url: '', parentId: null },
        { id: 21, syncId: 'semantic-child', title: 'Child', url: 'https://semantic.example/', parentId: 20 },
    ])).records;
    const semanticDiff = createBackupRestoreDiff(semanticRecords, currentItems);
    const semanticMerge = createBackupRestorePlan(semanticDiff, 'merge');
    assertEqual(semanticMerge.entries.length, 1);
    assertEqual(semanticMerge.reusedFolderCount, 1);
    assertEqual(
        semanticMerge.parentSyncIdOverrides.get(semanticMerge.entries[0].key),
        'folder-1',
    );
});

test('备份导出和同步密文不会包含连接配置或凭据', async () => {
    const previousItems = state.items;
    const sync = state.sync;
    const previousSync = {
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
    };
    const endpoint = 'https://dav.example.com/Example-Bookmarks/';
    const username = 'example-member@example.com';
    const password = 'test remote password';
    const passphrase = 'test encryption passphrase';
    const item = makeSyncItem({ title: 'Exported bookmark' });
    try {
        state.items = [{ ...item, parentId: null, collapsed: false }];
        Object.assign(sync, { endpoint, username, password, passphrase });
        const backup = createBackupPayload();
        const serializedBackup = JSON.stringify(backup);
        assert(serializedBackup.includes('Exported bookmark'));
        assert(!Object.hasOwn(backup, 'sync'));
        for (const value of [endpoint, username, password, passphrase]) {
            assert(!serializedBackup.includes(value), 'Backup leaked a connection setting');
        }

        const envelope = await encryptSyncData(makeDataset(item), passphrase);
        for (const value of [endpoint, username, password, passphrase, item.title]) {
            assert(!envelope.includes(value), 'Encrypted envelope leaked plaintext metadata');
        }
    } finally {
        state.items = previousItems;
        Object.assign(sync, previousSync);
    }
});

test('远端检查协调记录不会保存原始地址或用户名', () => {
    const previousSharedState = safeStorageGet(REMOTE_WATCH_STORAGE_KEY);
    const previousInitialized = state.coordination.initialized;
    const endpoint = 'https://dav.example.com/Example-Bookmarks/';
    const username = 'example-member@example.com';
    try {
        state.coordination.initialized = false;
        const endpointHash = remoteWatchEndpointHash(syncEndpointKey(endpoint, username));
        writeSharedRemoteWatchState(endpointHash, {
            provider: 'webdav',
            exists: true,
            etag: '"example-version"',
            lastModified: '',
            size: 100,
            contentHash: '',
        }, false, Date.now());
        const stored = safeStorageGet(REMOTE_WATCH_STORAGE_KEY) || '';
        assert(stored.includes(endpointHash));
        assert(!stored.includes(endpoint));
        assert(!stored.includes(username));
    } finally {
        state.coordination.initialized = previousInitialized;
        try {
            if (previousSharedState === null) localStorage.removeItem(REMOTE_WATCH_STORAGE_KEY);
            else localStorage.setItem(REMOTE_WATCH_STORAGE_KEY, previousSharedState);
        } catch {
            // Storage is optional in restricted test environments.
        }
    }
});

test('同步凭据仅在明确选择后写入标签页存储', () => {
    const sync = state.sync;
    const previous = {
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        mode: sync.mode,
        rememberSession: sync.rememberSession,
        sessionCredentialsRestored: sync.sessionCredentialsRestored,
    };
    const previousStored = safeSessionStorageGet(SYNC_SESSION_CREDENTIALS_KEY);
    try {
        Object.assign(sync, {
            mode: 'remote',
            endpoint: 'https://dav.example.com/Example-Bookmarks/',
            username: 'example-member@example.com',
            password: 'test remote password',
            passphrase: 'test encryption passphrase',
            rememberSession: false,
        });
        clearSessionSyncCredentials();
        assertEqual(saveSessionSyncCredentials(), false);
        assertEqual(safeSessionStorageGet(SYNC_SESSION_CREDENTIALS_KEY), null);

        sync.rememberSession = true;
        assertEqual(saveSessionSyncCredentials(), true);
        const explicitlyStored = safeSessionStorageGet(SYNC_SESSION_CREDENTIALS_KEY) || '';
        assert(explicitlyStored.includes(sync.password));
        assert(explicitlyStored.includes(sync.passphrase));
        clearSessionSyncCredentials();
        assertEqual(safeSessionStorageGet(SYNC_SESSION_CREDENTIALS_KEY), null);
    } finally {
        Object.assign(sync, previous);
        try {
            if (previousStored === null) sessionStorage.removeItem(SYNC_SESSION_CREDENTIALS_KEY);
            else sessionStorage.setItem(SYNC_SESSION_CREDENTIALS_KEY, previousStored);
        } catch {
            // Session storage is optional in restricted test environments.
        }
    }
});

test('同步数据和回收站快照加密后不包含书签明文', async () => {
    const deletedAt = '2026-01-02T00:00:00.000Z';
    const dataset = makeDataset(makeSyncItem({ title: 'Secret bookmark' }), [{
        syncId: 'deleted-item',
        deletedAt,
        updatedAt: deletedAt,
        modifiedBy: 'device-base',
        item: makeSyncItem({ syncId: 'deleted-item', title: 'Deleted secret' }),
    }], [{
        deviceId: 'named-device',
        name: 'Private device name',
        updatedAt: deletedAt,
    }]);
    const encrypted = await encryptSyncData(dataset, 'browser test passphrase');
    assert(!encrypted.includes('Secret bookmark'), 'Encrypted payload leaked plaintext');
    assert(!encrypted.includes('Deleted secret'), 'Encrypted recycle payload leaked plaintext');
    assert(!encrypted.includes('Private device name'), 'Encrypted payload leaked a device name');
    const decrypted = await decryptSyncData(encrypted, 'browser test passphrase');
    assertEqual(decrypted.version, 2);
    const normalized = parseRemoteSyncDataset(decrypted);
    assertEqual(normalized.items[0].title, 'Secret bookmark');
    assertEqual(normalized.tombstones[0].item.title, 'Deleted secret');
    assertEqual(normalized.devices[0].name, 'Private device name');
});

test('本地同步目录按设备写入独立加密文件', async () => {
    const root = createMemoryDirectory('Cloud Drive');
    state.sync.deviceId = 'device-a';
    await writeLocalSyncDeviceFile(
        root,
        makeDataset(makeSyncItem({ syncId: 'item-a', title: 'From A' }), [], [{
            deviceId: 'device-a',
            name: 'Laptop A',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }]),
        'local folder passphrase',
    );
    state.sync.deviceId = 'device-b';
    await writeLocalSyncDeviceFile(
        root,
        makeDataset(makeSyncItem({ syncId: 'item-b', title: 'From B' }), [], [{
            deviceId: 'device-b',
            name: 'Laptop B',
            updatedAt: '2026-01-02T00:00:00.000Z',
        }]),
        'local folder passphrase',
    );
    const fileSet = await listLocalSyncDeviceFiles(root);
    assertEqual(fileSet.files.length, 2);
    assert(fileSet.files.some((entry) => entry.name === 'device-a.enc.json'));
    assert(fileSet.files.some((entry) => entry.name === 'device-b.enc.json'));
    const aggregate = await readLocalSyncDeviceFiles(fileSet.files, 'local folder passphrase');
    assertDeepEqual(aggregate.items.map((item) => item.title).sort(), ['From A', 'From B']);
    assertDeepEqual(aggregate.devices.map((device) => device.name).sort(), ['Laptop A', 'Laptop B']);
});

test('旧版同步 payload v1 会安全升级墓碑字段', () => {
    const legacy = parseRemoteSyncDataset({
        format: 'bookmark-manager-sync',
        version: 1,
        items: [],
        tombstones: [{
            syncId: 'legacy-deletion',
            deletedAt: '2026-01-01T00:00:00.000Z',
            modifiedBy: 'legacy-device',
        }],
    });
    assertEqual(legacy.tombstones.length, 1);
    assertEqual(legacy.tombstones[0].updatedAt, legacy.tombstones[0].deletedAt);
});

test('错误加密口令无法解密远端数据', async () => {
    const encrypted = await encryptSyncData(makeDataset(makeSyncItem()), 'correct passphrase');
    let rejected = false;
    try {
        await decryptSyncData(encrypted, 'incorrect passphrase');
    } catch {
        rejected = true;
    }
    assert(rejected, 'Wrong passphrase should fail');
});

test('不同字段的并发修改会自动合并', () => {
    const baseItem = makeSyncItem();
    const localItem = makeSyncItem({
        title: 'Local title',
        updatedAt: '2026-01-02T00:00:00.000Z',
        modifiedBy: 'device-local',
    });
    const remoteItem = makeSyncItem({
        description: 'Remote description',
        updatedAt: '2026-01-03T00:00:00.000Z',
        modifiedBy: 'device-remote',
    });
    const result = threeWayMergeSyncDatasets(
        makeDataset(baseItem),
        makeDataset(localItem),
        makeDataset(remoteItem),
    );
    assertEqual(result.conflicts.length, 0);
    assertEqual(result.dataset.items[0].title, 'Local title');
    assertEqual(result.dataset.items[0].description, 'Remote description');
});

test('标签集合会执行三方合并', () => {
    const result = threeWayMergeSyncDatasets(
        makeDataset(makeSyncItem({ tags: ['base', 'remove'] })),
        makeDataset(makeSyncItem({ tags: ['base', 'local'] })),
        makeDataset(makeSyncItem({ tags: ['base', 'remove', 'remote'] })),
    );
    assertEqual(result.conflicts.length, 0);
    assertDeepEqual(result.dataset.items[0].tags, ['base', 'local', 'remote']);
});

test('同一字段的不同修改会进入冲突中心', () => {
    const result = threeWayMergeSyncDatasets(
        makeDataset(makeSyncItem()),
        makeDataset(makeSyncItem({ title: 'Local', updatedAt: '2026-01-02T00:00:00.000Z' })),
        makeDataset(makeSyncItem({ title: 'Remote', updatedAt: '2026-01-03T00:00:00.000Z' })),
    );
    assertEqual(result.conflicts.length, 1);
    assertEqual(result.conflicts[0].type, 'fields');
    assertDeepEqual(result.conflicts[0].fields, ['title']);
});

test('删除与编辑并发会保留双方等待确认', () => {
    const result = threeWayMergeSyncDatasets(
        makeDataset(makeSyncItem()),
        makeDataset(null, [{
            syncId: 'item-1',
            deletedAt: '2026-01-02T00:00:00.000Z',
            modifiedBy: 'device-local',
        }]),
        makeDataset(makeSyncItem({
            description: 'Edited remotely',
            updatedAt: '2026-01-03T00:00:00.000Z',
            modifiedBy: 'device-remote',
        })),
    );
    assertEqual(result.conflicts.length, 1);
    assertEqual(result.conflicts[0].type, 'delete-edit');
    assertEqual(result.conflicts[0].local.kind, 'deleted');
    assertEqual(result.conflicts[0].remote.kind, 'item');
});

test('备份文件锁会串行执行并发目录操作', async () => {
    if (!navigator.locks?.request) return;
    const order = [];
    await Promise.all([
        withBackupFileLock(async () => {
            order.push('backup-first-start');
            await new Promise((resolve) => setTimeout(resolve, 25));
            order.push('backup-first-end');
        }),
        withBackupFileLock(async () => {
            order.push('backup-second-start');
            order.push('backup-second-end');
        }),
    ]);
    assertDeepEqual(order, [
        'backup-first-start',
        'backup-first-end',
        'backup-second-start',
        'backup-second-end',
    ]);
    assertEqual(state.backup.fileLockDepth, 0);
});

test('Web Locks 会串行执行同一标签页的并发写入', async () => {
    if (!navigator.locks?.request) return;
    const order = [];
    await Promise.all([
        withDataWriteLock(async () => {
            order.push('first-start');
            await new Promise((resolve) => setTimeout(resolve, 30));
            order.push('first-end');
        }),
        withDataWriteLock(async () => {
            order.push('second-start');
            order.push('second-end');
        }),
    ]);
    assertDeepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('长期设置只保存必要连接信息而不保存密码或加密口令', async () => {
    state.db = await openDatabase();
    const previousSyncPreferences = await getSetting(SYNC_PREFERENCES_KEY);
    const previousBackupPreferences = await getSetting(BACKUP_PREFERENCES_KEY);
    const sync = state.sync;
    const backup = state.backup;
    const previousSync = {
        mode: sync.mode,
        endpoint: sync.endpoint,
        username: sync.username,
        password: sync.password,
        passphrase: sync.passphrase,
        setupComplete: sync.setupComplete,
    };
    const previousRemoteWatchEndpointKey = sync.remoteWatch.endpointKey;
    const previousBackupPassphrase = backup.passphrase;
    const endpoint = 'https://dav.example.com/Example-Bookmarks/';
    const username = 'example-member@example.com';
    const password = 'test remote password';
    const syncPassphrase = 'test sync passphrase';
    const backupPassphrase = 'test backup passphrase';
    try {
        Object.assign(sync, {
            mode: 'remote',
            endpoint,
            username,
            password,
            passphrase: syncPassphrase,
            setupComplete: true,
        });
        sync.remoteWatch.endpointKey = syncEndpointKey(endpoint, username);
        backup.passphrase = backupPassphrase;
        assert(await saveSyncPreferences());
        assert(await saveBackupPreferences());

        const storedSync = await getSetting(SYNC_PREFERENCES_KEY);
        const storedBackup = await getSetting(BACKUP_PREFERENCES_KEY);
        const serialized = JSON.stringify({ storedSync, storedBackup });
        assertEqual(storedSync.endpoint, endpoint);
        assertEqual(storedSync.username, username);
        assert(!Object.hasOwn(storedSync, 'password'));
        assert(!Object.hasOwn(storedSync, 'passphrase'));
        assert(!Object.hasOwn(storedBackup, 'passphrase'));
        assert(!serialized.includes(password));
        assert(!serialized.includes(syncPassphrase));
        assert(!serialized.includes(backupPassphrase));

        const azureBase = 'https://exampleaccount.blob.core.chinacloudapi.cn/example-container/';
        const azureSas = 'sv=2023-11-03&sr=c&sp=rcw&se=2099-01-01T00%3A00%3A00Z&sig=example-signature';
        sync.endpoint = `${azureBase}?${azureSas}`;
        sync.username = 'must-be-cleared@example.com';
        sync.password = '';
        sync.remoteWatch.endpointKey = syncEndpointKey();
        assert(await saveSyncPreferences());
        const storedAzure = await getSetting(SYNC_PREFERENCES_KEY);
        const serializedAzure = JSON.stringify(storedAzure);
        assertEqual(storedAzure.endpoint, azureBase);
        assertEqual(storedAzure.username, '');
        assertEqual(sync.password, azureSas);
        assert(!serializedAzure.includes('sig='));
        assert(!serializedAzure.includes('example-signature'));
        assert(!serializedAzure.includes('must-be-cleared'));
    } finally {
        if (previousSyncPreferences === null) await deleteSetting(SYNC_PREFERENCES_KEY);
        else await saveSetting(SYNC_PREFERENCES_KEY, previousSyncPreferences);
        if (previousBackupPreferences === null) await deleteSetting(BACKUP_PREFERENCES_KEY);
        else await saveSetting(BACKUP_PREFERENCES_KEY, previousBackupPreferences);
        Object.assign(sync, previousSync);
        sync.remoteWatch.endpointKey = previousRemoteWatchEndpointKey;
        backup.passphrase = previousBackupPassphrase;
        state.db.close();
        state.db = null;
    }
});

test('IndexedDB、回收站恢复、基线和冲突记录可用', async () => {
    await deleteTestDatabase();
    state.db = await openDatabase();
    assert(state.db.objectStoreNames.contains(STORE_NAME));
    assert(state.db.objectStoreNames.contains(TOMBSTONE_STORE_NAME));
    assert(state.db.objectStoreNames.contains(SYNC_BASELINE_STORE_NAME));
    assert(state.db.objectStoreNames.contains(SYNC_CONFLICT_STORE_NAME));

    await initializeSyncIdentity();
    assert(state.sync.deviceName.includes(state.sync.deviceId.slice(0, 4)));
    assertEqual(await getSetting(DEVICE_NAME_KEY), state.sync.deviceName);
    assert(validDate(await getSetting(DEVICE_NAME_UPDATED_AT_KEY)));
    const previousBackupState = {
        enabled: state.backup.enabled,
        retention: state.backup.retention,
        encryptionEnabled: state.backup.encryptionEnabled,
        encryptionProfileId: state.backup.encryptionProfileId,
        passphrase: state.backup.passphrase,
        passphraseConfirmed: state.backup.passphraseConfirmed,
    };
    const previousBackupHealth = { ...state.backup.health };
    Object.assign(state.backup, {
        enabled: true,
        retention: 30,
        encryptionEnabled: true,
        encryptionProfileId: 'test-backup-profile',
        passphrase: 'must not enter indexeddb',
        passphraseConfirmed: true,
    });
    Object.assign(state.backup.health, {
        status: 'verified',
        lastVerifiedAt: '2026-01-06T00:00:00.000Z',
        lastVerifiedHash: 'verified-health-hash',
        format: 'encrypted',
        snapshotCount: 4,
    });
    assert(await saveBackupPreferences());
    const storedBackupPreferences = await getSetting(BACKUP_PREFERENCES_KEY);
    assertEqual(storedBackupPreferences.encryptionEnabled, true);
    assertEqual(storedBackupPreferences.encryptionProfileId, 'test-backup-profile');
    assertEqual(storedBackupPreferences.lastVerifiedHash, 'verified-health-hash');
    assertEqual(storedBackupPreferences.lastVerifiedFormat, 'encrypted');
    assertEqual(storedBackupPreferences.lastVerifiedSnapshotCount, 4);
    assert(!Object.hasOwn(storedBackupPreferences, 'passphrase'));
    Object.assign(state.backup, previousBackupState);
    Object.assign(state.backup.health, previousBackupHealth);

    const record = {
        syncId: 'db-item',
        title: 'Database test',
        url: 'https://example.com/db',
        description: '',
        tags: [],
        parentId: null,
        isPinned: false,
        collapsed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        modifiedBy: state.sync.deviceId,
    };
    record.id = await saveItem(record);
    assertEqual((await getAllItems()).length, 1);

    state.items = [record];
    await deleteItems([record]);
    assertEqual((await getAllItems()).length, 0);
    let tombstones = await getAllTombstones();
    assertEqual(tombstones.length, 1);
    assertEqual(tombstones[0].item.title, 'Database test');
    assert(validDate(tombstones[0].updatedAt));

    await restoreResolvedSyncItems([tombstones[0].item]);
    let restored = await getAllItems();
    assertEqual(restored.length, 1);
    assertEqual((await getAllTombstones()).length, 0);

    state.items = restored;
    await deleteItems(restored);
    tombstones = await getAllTombstones();
    await purgeTombstonePayloads(tombstones.map((item) => item.syncId));
    tombstones = await getAllTombstones();
    assertEqual(tombstones.length, 1);
    assert(!tombstones[0].item, 'Permanent deletion should remove recoverable payload');

    await new Promise((resolve, reject) => {
        const transaction = state.db.transaction(TOMBSTONE_STORE_NAME, 'readwrite');
        transaction.objectStore(TOMBSTONE_STORE_NAME).put({
            ...tombstones[0],
            deletedAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
            item: makeSyncItem({ syncId: tombstones[0].syncId }),
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
    assertEqual(await pruneExpiredRecycleBin(), 1);
    assert(!(await getAllTombstones())[0].item, 'Expired recovery payload should be purged');

    const currentBeforeRestore = {
        ...record,
        syncId: 'current-before-restore',
        title: 'Current before restore',
    };
    delete currentBeforeRestore.id;
    currentBeforeRestore.id = await saveItem(currentBeforeRestore);
    state.items = [currentBeforeRestore];
    const restoreRecords = parseJsonImport(JSON.stringify([
        { id: 20, syncId: 'restored-folder', title: 'Restored folder', url: '', parentId: null },
        { id: 21, syncId: 'restored-link', title: 'Restored link', url: 'https://example.com/restored', parentId: 20 },
    ])).records;
    assertEqual(await replaceItemsFromRestore(restoreRecords, state.items), 2);
    const restoredSnapshot = await getAllItems();
    assertEqual(restoredSnapshot.length, 2);
    const restoredFolder = restoredSnapshot.find((item) => item.syncId === 'restored-folder');
    const restoredLink = restoredSnapshot.find((item) => item.syncId === 'restored-link');
    assertEqual(restoredLink.parentId, restoredFolder.id);
    assertEqual(restoredLink.modifiedBy, state.sync.deviceId);
    assert((await getAllTombstones()).some((item) => item.syncId === 'current-before-restore'));

    const baseline = { items: [makeSyncItem()], tombstones: [] };
    await saveSyncBaseline('test-endpoint', baseline);
    assertDeepEqual(await getSyncBaseline('test-endpoint'), baseline);

    await replaceSyncConflicts('test-endpoint', [{
        syncId: 'item-1',
        type: 'fields',
        detectedAt: new Date().toISOString(),
        fields: ['title'],
    }]);
    assertEqual((await getSyncConflicts('test-endpoint')).length, 1);

    state.db.close();
    state.db = null;
    await deleteTestDatabase();
});

async function runTests() {
    const list = document.getElementById('test-list');
    const passedCount = document.getElementById('passed-count');
    const failedCount = document.getElementById('failed-count');
    const totalCount = document.getElementById('total-count');
    document.getElementById('test-database-name').textContent = `Test DB: ${DB_NAME}`;
    document.getElementById('rerun-button').addEventListener('click', () => location.reload());
    list.replaceChildren();

    const results = [];
    let passed = 0;
    for (const testCase of testCases) {
        const startedAt = performance.now();
        let error = null;
        try {
            await testCase.run();
            passed += 1;
        } catch (reason) {
            error = reason instanceof Error ? reason : new Error(String(reason));
            console.error(`Test failed: ${testCase.name}`, error);
        }
        const result = {
            name: testCase.name,
            passed: !error,
            duration: Math.round(performance.now() - startedAt),
            error: error?.stack || error?.message || '',
        };
        results.push(result);
        list.append(renderTestResult(result));
        passedCount.textContent = String(passed);
        failedCount.textContent = String(results.length - passed);
        totalCount.textContent = String(testCases.length);
    }

    window.__TEST_RESULTS__ = {
        passed,
        failed: results.length - passed,
        total: results.length,
        results,
    };
    document.body.dataset.testStatus = passed === results.length ? 'passed' : 'failed';
}

function renderTestResult(result) {
    const row = document.createElement('article');
    row.className = `test-result${result.passed ? '' : ' failed'}`;
    const icon = document.createElement('span');
    icon.className = 'test-icon';
    icon.textContent = result.passed ? '✓' : '×';
    const copy = document.createElement('div');
    copy.className = 'test-copy';
    const name = document.createElement('strong');
    name.textContent = result.name;
    copy.append(name);
    if (result.error) {
        const error = document.createElement('pre');
        error.textContent = result.error;
        copy.append(error);
    }
    const duration = document.createElement('span');
    duration.className = 'test-duration';
    duration.textContent = `${result.duration} ms`;
    row.append(icon, copy, duration);
    return row;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runTests, { once: true });
} else {
    runTests();
}
