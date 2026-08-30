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

function makeDataset(item, tombstones = []) {
    return { items: item ? [item] : [], tombstones };
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
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Test database deletion was blocked'));
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
    assert(isKoofrSyncEndpoint('https://app.koofr.net/dav/Koofr/Bookmarks/'));
    assert(!isKoofrSyncEndpoint('https://dav.example.com/Koofr/Bookmarks/'));
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

        Object.assign(sync, {
            supported: true,
            mode: 'remote',
            endpoint: 'https://app.koofr.net/dav/Koofr/Bookmarks/',
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

test('同步数据和回收站快照加密后不包含书签明文', async () => {
    const deletedAt = '2026-01-02T00:00:00.000Z';
    const dataset = makeDataset(makeSyncItem({ title: 'Secret bookmark' }), [{
        syncId: 'deleted-item',
        deletedAt,
        updatedAt: deletedAt,
        modifiedBy: 'device-base',
        item: makeSyncItem({ syncId: 'deleted-item', title: 'Deleted secret' }),
    }]);
    const encrypted = await encryptSyncData(dataset, 'browser test passphrase');
    assert(!encrypted.includes('Secret bookmark'), 'Encrypted payload leaked plaintext');
    assert(!encrypted.includes('Deleted secret'), 'Encrypted recycle payload leaked plaintext');
    const decrypted = await decryptSyncData(encrypted, 'browser test passphrase');
    assertEqual(decrypted.version, 2);
    const normalized = parseRemoteSyncDataset(decrypted);
    assertEqual(normalized.items[0].title, 'Secret bookmark');
    assertEqual(normalized.tombstones[0].item.title, 'Deleted secret');
});

test('本地同步目录按设备写入独立加密文件', async () => {
    const root = createMemoryDirectory('Cloud Drive');
    state.sync.deviceId = 'device-a';
    await writeLocalSyncDeviceFile(
        root,
        makeDataset(makeSyncItem({ syncId: 'item-a', title: 'From A' })),
        'local folder passphrase',
    );
    state.sync.deviceId = 'device-b';
    await writeLocalSyncDeviceFile(
        root,
        makeDataset(makeSyncItem({ syncId: 'item-b', title: 'From B' })),
        'local folder passphrase',
    );
    const fileSet = await listLocalSyncDeviceFiles(root);
    assertEqual(fileSet.files.length, 2);
    assert(fileSet.files.some((entry) => entry.name === 'device-a.enc.json'));
    assert(fileSet.files.some((entry) => entry.name === 'device-b.enc.json'));
    const aggregate = await readLocalSyncDeviceFiles(fileSet.files, 'local folder passphrase');
    assertDeepEqual(aggregate.items.map((item) => item.title).sort(), ['From A', 'From B']);
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

test('IndexedDB、回收站恢复、基线和冲突记录可用', async () => {
    await deleteTestDatabase();
    state.db = await openDatabase();
    assert(state.db.objectStoreNames.contains(STORE_NAME));
    assert(state.db.objectStoreNames.contains(TOMBSTONE_STORE_NAME));
    assert(state.db.objectStoreNames.contains(SYNC_BASELINE_STORE_NAME));
    assert(state.db.objectStoreNames.contains(SYNC_CONFLICT_STORE_NAME));

    await initializeSyncIdentity();
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
