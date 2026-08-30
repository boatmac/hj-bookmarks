/* Import, export, and destructive data actions. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function handleImport(event) {
    if (preventMutationDuringSync()) {
        event.target.value = '';
        return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    document.body.classList.add('busy');

    try {
        const content = await file.text();
        const looksLikeJson = /\.json$/i.test(file.name) || /^\s*(?:\{|\[)/.test(content);
        const parsed = looksLikeJson
            ? parseJsonImport(content)
            : parseHtmlImport(content);

        const prepared = prepareImportMerge(parsed.records);
        const importedCount = await addImportedRecords(prepared.records);
        await refreshData();
        scheduleDataProtection();
        const skipped = parsed.skipped + prepared.duplicateCount;
        const details = [
            prepared.mergedFolderCount ? t('reusedFolders', { count: prepared.mergedFolderCount }) : '',
            skipped ? t('skippedItems', { count: skipped }) : '',
        ].filter(Boolean).join(t('listSeparator'));
        showToast(t('imported', { count: importedCount, details }));
    } catch (error) {
        console.error('Import failed:', error);
        showToast(t('importFailed', { message: error.message }));
    } finally {
        event.target.value = '';
        document.body.classList.remove('busy');
    }
}

function prepareImportMerge(records) {
    const existingUrls = new Set(
        state.items.filter(isBookmark).map((item) => canonicalUrl(item.url)).filter(Boolean),
    );
    let duplicateCount = 0;
    const uniqueRecords = records.filter((record) => {
        if (!record.url) return true;
        const canonical = canonicalUrl(record.url);
        if (canonical && existingUrls.has(canonical)) {
            duplicateCount += 1;
            return false;
        }
        if (canonical) existingUrls.add(canonical);
        return true;
    });

    const existingFolders = new Map();
    state.items.filter(isFolder).forEach((folder) => {
        const key = folderMergeKey(folder.parentId, folder.title);
        if (!existingFolders.has(key)) existingFolders.set(key, folder.id);
    });

    const resolutions = new Map();
    let mergedFolderCount = 0;
    const prepared = uniqueRecords.map((record) => {
        if (record.url) return record;

        const parentResolution = record.parentKey
            ? resolutions.get(record.parentKey)
            : { existingId: null };
        if (parentResolution && Object.hasOwn(parentResolution, 'existingId')) {
            const match = existingFolders.get(folderMergeKey(parentResolution.existingId, record.title));
            if (match != null) {
                mergedFolderCount += 1;
                resolutions.set(record.sourceKey, { existingId: match });
                return { ...record, existingId: match };
            }
        }

        resolutions.set(record.sourceKey, { sourceKey: record.sourceKey });
        return record;
    });

    return { records: prepared, duplicateCount, mergedFolderCount };
}

function folderMergeKey(parentId, title) {
    const parent = parentId == null ? 'root' : String(parentId);
    return `${parent}\u0000${title.trim().toLocaleLowerCase(currentLocale())}`;
}

function parseJsonImport(content) {
    let payload;
    try {
        payload = JSON.parse(content);
    } catch {
        throw new Error(t('jsonInvalid'));
    }

    const source = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray(payload.bookmarks)
            ? payload.bookmarks
            : payload && typeof payload === 'object' && Array.isArray(payload.items)
                ? payload.items
                : null;
    if (!source) throw new Error(t('jsonArrayMissing'));

    const idMap = new Map();
    source.forEach((item, index) => {
        if (item && item.id != null && !idMap.has(String(item.id))) idMap.set(String(item.id), `json-${index}`);
    });

    let skipped = 0;
    const records = [];
    source.forEach((input, index) => {
        if (!input || typeof input !== 'object') {
            skipped += 1;
            return;
        }
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!title) {
            skipped += 1;
            return;
        }

        const rawUrl = typeof input.url === 'string' ? input.url.trim() : '';
        let url = '';
        if (rawUrl) {
            try {
                url = normalizeUrl(rawUrl);
            } catch {
                skipped += 1;
                return;
            }
        }

        records.push({
            sourceKey: `json-${index}`,
            parentKey: input.parentId == null ? null : (idMap.get(String(input.parentId)) || null),
            syncId: typeof input.syncId === 'string' ? input.syncId : '',
            title,
            url,
            description: typeof input.description === 'string' ? input.description.trim() : '',
            tags: parseTags(input.tags),
            isPinned: input.isPinned === true || input.favorite === true,
            createdAt: validDate(input.createdAt) ? input.createdAt : new Date().toISOString(),
            updatedAt: validDate(input.updatedAt) ? input.updatedAt : new Date().toISOString(),
            modifiedBy: typeof input.modifiedBy === 'string' ? input.modifiedBy : state.sync.deviceId,
        });
    });

    if (!records.length && source.length) throw new Error(t('noValidItems'));
    return { records: orderParentsFirst(records), skipped };
}

function parseHtmlImport(content) {
    const documentObject = new DOMParser().parseFromString(content, 'text/html');
    const root = documentObject.querySelector('dl');
    if (!root) throw new Error(t('browserHtmlInvalid'));

    const records = [];
    const visitedContainers = new WeakSet();
    let counter = 0;
    let skipped = 0;

    const walk = (container, parentKey) => {
        if (!container || visitedContainers.has(container)) return;
        visitedContainers.add(container);
        const children = Array.from(container.children);

        children.forEach((node, index) => {
            const tagName = node.tagName.toLowerCase();
            if (tagName === 'p' || tagName === 'dl') {
                walk(node, parentKey);
                return;
            }
            if (tagName !== 'dt') return;

            const folderHeader = node.querySelector('h3');
            if (folderHeader) {
                const title = folderHeader.textContent.trim() || t('unnamedFolder');
                const sourceKey = `html-${++counter}`;
                records.push({
                    sourceKey,
                    parentKey,
                    title,
                    url: '',
                    description: '',
                    tags: [],
                    isPinned: false,
                    createdAt: dateFromBookmarkAttribute(folderHeader.getAttribute('add_date')),
                    updatedAt: new Date().toISOString(),
                });
                const nested = findNestedList(node) || findAdjacentList(children[index + 1]);
                walk(nested, sourceKey);
                return;
            }

            const link = node.querySelector('a');
            if (!link) return;
            const title = link.textContent.trim() || link.getAttribute('href') || t('unnamedBookmark');
            try {
                records.push({
                    sourceKey: `html-${++counter}`,
                    parentKey,
                    title,
                    url: normalizeUrl(link.getAttribute('href') || ''),
                    description: '',
                    tags: parseTags(link.getAttribute('tags') || ''),
                    isPinned: false,
                    createdAt: dateFromBookmarkAttribute(link.getAttribute('add_date')),
                    updatedAt: new Date().toISOString(),
                });
            } catch {
                skipped += 1;
            }
        });
    };

    walk(root, null);
    if (!records.length) throw new Error(t('htmlNoItems'));
    return { records: orderParentsFirst(records), skipped };
}

function findNestedList(node) {
    return Array.from(node.children).find((child) => child.tagName.toLowerCase() === 'dl')
        || node.querySelector('dl');
}

function findAdjacentList(node) {
    if (!node) return null;
    if (node.tagName.toLowerCase() === 'dl') return node;
    return node.querySelector?.('dl') || null;
}

function orderParentsFirst(records) {
    const byKey = new Map(records.map((record) => [record.sourceKey, record]));
    const ordered = [];
    const visiting = new Set();
    const visited = new Set();

    const visit = (record) => {
        if (visited.has(record.sourceKey)) return;
        if (visiting.has(record.sourceKey)) {
            record.parentKey = null;
            return;
        }
        visiting.add(record.sourceKey);
        const parent = record.parentKey ? byKey.get(record.parentKey) : null;
        if (parent) visit(parent);
        visiting.delete(record.sourceKey);
        visited.add(record.sourceKey);
        ordered.push(record);
    };
    records.forEach(visit);
    return ordered;
}

function exportJson() {
    closeExportMenu();
    const payload = createBackupPayload();
    downloadFile(
        JSON.stringify(payload, null, 2),
        'application/json',
        `bookmarks-${today()}.json`,
    );
    showToast(t('exportedJson', { count: state.items.length }));
}

function exportHtml() {
    closeExportMenu();
    const lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>',
        '<H1>Bookmarks</H1>',
        '<DL><p>',
    ];
    const visited = new Set();
    const itemIds = new Set(state.items.map((item) => item.id));
    const roots = state.items.filter((item) => item.parentId == null || !itemIds.has(item.parentId));
    appendHtmlNodes(lines, sortTreeItems(roots), 1, visited, new Set());
    const remaining = state.items.filter((item) => !visited.has(item.id));
    appendHtmlNodes(lines, sortTreeItems(remaining), 1, visited, new Set());
    lines.push('</DL><p>');

    downloadFile(lines.join('\n'), 'text/html;charset=utf-8', `bookmarks-${today()}.html`);
    showToast(t('exportedHtml', { count: state.items.length }));
}

function appendHtmlNodes(lines, items, depth, visited, ancestors) {
    const indent = '    '.repeat(depth);
    for (const item of items) {
        if (visited.has(item.id) || ancestors.has(item.id)) continue;
        visited.add(item.id);
        if (isFolder(item)) {
            lines.push(`${indent}<DT><H3 ADD_DATE="${dateToSeconds(item.createdAt)}">${escapeHtml(item.title)}</H3>`);
            lines.push(`${indent}<DL><p>`);
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(item.id);
            const children = state.items.filter((child) => child.parentId === item.id);
            appendHtmlNodes(lines, sortTreeItems(children), depth + 1, visited, nextAncestors);
            lines.push(`${indent}</DL><p>`);
        } else {
            const tags = item.tags.length ? ` TAGS="${escapeHtml(item.tags.join(','))}"` : '';
            lines.push(`${indent}<DT><A HREF="${escapeHtml(item.url)}" ADD_DATE="${dateToSeconds(item.createdAt)}"${tags}>${escapeHtml(item.title)}</A>`);
        }
    }
}

async function clearAllData() {
    closeExportMenu();
    if (preventMutationDuringSync()) return;
    if (!state.items.length) {
        showToast(t('nothingToClear'));
        return;
    }
    if (!window.confirm(t('confirmClear'))) return;
    await flushBackupBeforeDestructiveChange();
    await clearDatabase();
    state.view = { type: 'all', value: null };
    clearSearch();
    await refreshData();
    scheduleDataProtection();
    showToast(t('cleared'));
}
