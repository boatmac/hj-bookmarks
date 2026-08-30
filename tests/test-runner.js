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

test('同步数据加密后不包含书签明文', async () => {
    const dataset = makeDataset(makeSyncItem({ title: 'Secret bookmark' }));
    const encrypted = await encryptSyncData(dataset, 'browser test passphrase');
    assert(!encrypted.includes('Secret bookmark'), 'Encrypted payload leaked plaintext');
    const decrypted = await decryptSyncData(encrypted, 'browser test passphrase');
    const normalized = parseRemoteSyncDataset(decrypted);
    assertEqual(normalized.items[0].title, 'Secret bookmark');
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

test('IndexedDB schema、墓碑、基线和冲突记录可用', async () => {
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

    await deleteItems([record]);
    assertEqual((await getAllItems()).length, 0);
    assertEqual((await getAllTombstones()).length, 1);

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
