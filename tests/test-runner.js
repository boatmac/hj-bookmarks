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

    assert(await backupDirectoryContainsPotentialSnapshots(root));
    const snapshots = await scanBackupSnapshotFiles(root);
    assertEqual(snapshots.length, 4);
    assertEqual(snapshots.filter((snapshot) => !snapshot.invalid).length, 2);
    assertEqual(snapshots[0].kind, 'latest');
    assertEqual(snapshots[0].bookmarks, 1);
    assertEqual(snapshots[0].folders, 1);
    assertEqual(snapshots.filter((snapshot) => snapshot.invalid).length, 2);
    assert(snapshots.some((snapshot) => snapshot.invalid && snapshot.error.includes('99')));
    const records = await readBackupSnapshotRecords(snapshots[0]);
    assertEqual(records.length, 2);
    assertEqual(records[1].parentKey, records[0].sourceKey);
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
