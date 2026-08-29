(() => {
    'use strict';

    const DB_NAME = 'BookmarkDB_v3';
    const DB_VERSION = 4;
    const STORE_NAME = 'bookmarks';
    const THEME_KEY = 'bookmark-manager.theme';
    const SORT_KEY = 'bookmark-manager.sort';
    const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

    const state = {
        db: null,
        items: [],
        view: { type: 'all', value: null },
        query: '',
        sort: safeStorageGet(SORT_KEY) || 'newest',
        draggedId: null,
        toastTimer: null,
    };

    const ui = {};

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        cacheElements();
        applyInitialTheme();
        bindStaticEvents();

        try {
            state.db = await openDatabase();
            ui.storageStatus.textContent = 'IndexedDB 已连接';
            await refreshData();
        } catch (error) {
            console.error('Unable to initialize bookmark manager:', error);
            showFatalError(error);
        }
    }

    function cacheElements() {
        const ids = [
            'sidebar', 'sidebar-backdrop', 'mobile-menu-button', 'brand-button',
            'all-view-button', 'favorites-view-button', 'all-count', 'favorites-count',
            'sidebar-add-folder', 'folder-tree', 'tag-navigation', 'tags-count',
            'storage-status', 'theme-button', 'search-input', 'clear-search-button',
            'search-shortcut', 'import-file-input', 'import-button', 'export-menu',
            'export-json-button', 'export-html-button', 'clear-all-button',
            'add-bookmark-button', 'breadcrumbs', 'page-eyebrow', 'page-title',
            'page-description', 'result-count', 'add-folder-button', 'results-label',
            'sort-select', 'folder-grid', 'bookmark-grid', 'empty-state',
            'empty-icon-use', 'empty-title', 'empty-description', 'empty-action-button',
            'empty-action-icon', 'empty-action-label', 'item-dialog', 'item-form',
            'item-id', 'item-kind', 'dialog-eyebrow', 'dialog-title',
            'dialog-close-button', 'dialog-cancel-button', 'dialog-submit-button',
            'item-title-input', 'item-url-input', 'item-description-input',
            'item-parent-select', 'item-tags-input', 'item-favorite-input',
            'form-error', 'toast', 'toast-message',
        ];

        for (const id of ids) ui[toCamelCase(id)] = document.getElementById(id);
        ui.bookmarkOnlyFields = Array.from(document.querySelectorAll('.bookmark-only-field'));
    }

    function toCamelCase(value) {
        return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    }

    function bindStaticEvents() {
        ui.brandButton.addEventListener('click', () => setView('all'));
        ui.allViewButton.addEventListener('click', () => setView('all'));
        ui.favoritesViewButton.addEventListener('click', () => setView('favorites'));
        ui.sidebarAddFolder.addEventListener('click', () => openItemDialog('folder'));
        ui.addFolderButton.addEventListener('click', () => openItemDialog('folder'));
        ui.addBookmarkButton.addEventListener('click', () => openItemDialog('bookmark'));

        ui.searchInput.addEventListener('input', () => {
            state.query = ui.searchInput.value.trim();
            ui.clearSearchButton.classList.toggle('hidden', !state.query);
            ui.searchShortcut.classList.toggle('hidden', Boolean(state.query));
            renderContent();
        });
        ui.clearSearchButton.addEventListener('click', clearSearch);

        ui.sortSelect.value = ['newest', 'oldest', 'title'].includes(state.sort) ? state.sort : 'newest';
        ui.sortSelect.addEventListener('change', () => {
            state.sort = ui.sortSelect.value;
            safeStorageSet(SORT_KEY, state.sort);
            renderContent();
        });

        ui.importButton.addEventListener('click', () => ui.importFileInput.click());
        ui.importFileInput.addEventListener('change', handleImport);
        ui.exportJsonButton.addEventListener('click', exportJson);
        ui.exportHtmlButton.addEventListener('click', exportHtml);
        ui.clearAllButton.addEventListener('click', clearAllData);

        ui.themeButton.addEventListener('click', toggleTheme);
        ui.mobileMenuButton.addEventListener('click', openSidebar);
        ui.sidebarBackdrop.addEventListener('click', closeSidebar);

        ui.itemForm.addEventListener('submit', handleItemSubmit);
        ui.dialogCloseButton.addEventListener('click', closeItemDialog);
        ui.dialogCancelButton.addEventListener('click', closeItemDialog);
        ui.itemDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeItemDialog();
        });
        ui.itemDialog.addEventListener('mousedown', (event) => {
            if (event.target === ui.itemDialog) closeItemDialog();
        });
        ui.emptyActionButton.addEventListener('click', handleEmptyAction);

        document.addEventListener('keydown', handleGlobalKeydown);
        document.addEventListener('click', (event) => {
            if (ui.exportMenu.open && !ui.exportMenu.contains(event.target)) ui.exportMenu.open = false;
        });
        document.addEventListener('dragend', clearDragState);

        installRootDropTarget(ui.allViewButton);
        installRootDropTarget(ui.brandButton);
    }

    function handleGlobalKeydown(event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            ui.searchInput.focus();
            ui.searchInput.select();
        }
        if (event.key === 'Escape' && ui.sidebar.classList.contains('open')) closeSidebar();
    }

    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('当前浏览器不支持 IndexedDB。'));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const database = request.result;
                let store;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                } else {
                    store = request.transaction.objectStore(STORE_NAME);
                }
                if (!store.indexNames.contains('parentId')) store.createIndex('parentId', 'parentId', { unique: false });
                if (!store.indexNames.contains('isPinned')) store.createIndex('isPinned', 'isPinned', { unique: false });
            };

            request.onerror = () => reject(request.error || new Error('无法打开本地数据库。'));
            request.onblocked = () => reject(new Error('数据库升级被其他页面阻止，请关闭其他书签管理器页面后重试。'));
            request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => database.close();
                resolve(database);
            };
        });
    }

    function getAllItems() {
        return new Promise((resolve, reject) => {
            const request = state.db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    function saveItem(item) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = item.id == null ? store.add(item) : store.put(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function deleteItems(ids) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            for (const id of ids) store.delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('删除操作已取消。'));
        });
    }

    function clearDatabase() {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    function addImportedRecords(records) {
        return new Promise((resolve, reject) => {
            if (!records.length) {
                resolve(0);
                return;
            }

            const transaction = state.db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const insertedIds = new Map();
            let index = 0;
            let insertedCount = 0;

            transaction.oncomplete = () => resolve(insertedCount);
            transaction.onerror = () => reject(transaction.error || new Error('导入事务失败。'));
            transaction.onabort = () => reject(transaction.error || new Error('导入事务已取消。'));

            const addNext = () => {
                while (index < records.length && records[index].existingId != null) {
                    const existing = records[index++];
                    insertedIds.set(existing.sourceKey, existing.existingId);
                }
                if (index >= records.length) return;

                const source = records[index++];
                const item = {
                    title: source.title,
                    url: source.url,
                    description: source.description,
                    tags: source.tags,
                    parentId: source.parentKey ? (insertedIds.get(source.parentKey) ?? null) : null,
                    isPinned: source.isPinned,
                    collapsed: false,
                    createdAt: source.createdAt,
                    updatedAt: source.updatedAt,
                };
                const request = store.add(item);
                request.onsuccess = () => {
                    insertedCount += 1;
                    insertedIds.set(source.sourceKey, request.result);
                    addNext();
                };
            };

            addNext();
        });
    }

    async function refreshData() {
        const records = await getAllItems();
        state.items = records.map(normalizeItem);
        renderAll();
        ui.storageStatus.textContent = `IndexedDB · ${state.items.length} 项`;
    }

    function normalizeItem(input) {
        const url = typeof input.url === 'string' ? input.url.trim() : '';
        return {
            id: input.id,
            title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '未命名',
            url,
            description: typeof input.description === 'string' ? input.description.trim() : '',
            tags: parseTags(input.tags),
            parentId: input.parentId == null || input.parentId === 'root' ? null : Number(input.parentId),
            isPinned: input.isPinned === true || input.favorite === true,
            collapsed: input.collapsed === true,
            createdAt: validDate(input.createdAt) ? input.createdAt : '',
            updatedAt: validDate(input.updatedAt) ? input.updatedAt : '',
        };
    }

    function renderAll() {
        renderSidebar();
        renderBreadcrumbs();
        renderContent();
    }

    function renderSidebar() {
        const bookmarks = state.items.filter(isBookmark);
        const folders = state.items.filter(isFolder);
        ui.allCount.textContent = String(bookmarks.length);
        ui.favoritesCount.textContent = String(bookmarks.filter((item) => item.isPinned).length);
        ui.tagsCount.textContent = String(getTagCounts().size);

        ui.allViewButton.classList.toggle('active', state.view.type === 'all');
        ui.favoritesViewButton.classList.toggle('active', state.view.type === 'favorites');

        ui.folderTree.replaceChildren();
        const childrenMap = makeFolderChildrenMap(folders);
        const folderIds = new Set(folders.map((folder) => folder.id));
        const roots = folders.filter((folder) => folder.parentId == null || !folderIds.has(folder.parentId));
        const visited = new Set();

        for (const folder of sortByTitle(roots)) {
            ui.folderTree.append(createFolderTreeNode(folder, childrenMap, visited, new Set()));
        }
        for (const folder of sortByTitle(folders)) {
            if (!visited.has(folder.id)) ui.folderTree.append(createFolderTreeNode(folder, childrenMap, visited, new Set()));
        }
        if (!folders.length) ui.folderTree.append(createSidebarHint('还没有文件夹'));

        ui.tagNavigation.replaceChildren();
        const tagCounts = [...getTagCounts().entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
        for (const [tag, count] of tagCounts) {
            const button = createElement('button', `nav-item tag-nav-item${state.view.type === 'tag' && state.view.value === tag ? ' active' : ''}`);
            button.type = 'button';
            button.append(createIcon('tag', 16), createElement('span', '', tag), createElement('span', 'nav-count', String(count)));
            button.addEventListener('click', () => setView('tag', tag));
            ui.tagNavigation.append(button);
        }
        if (!tagCounts.length) ui.tagNavigation.append(createSidebarHint('添加标签后会显示在这里'));
    }

    function createFolderTreeNode(folder, childrenMap, visited, ancestors) {
        const wrapper = createElement('div', 'folder-tree-node');
        if (ancestors.has(folder.id)) return wrapper;
        visited.add(folder.id);

        const children = (childrenMap.get(folder.id) || []).filter((child) => !ancestors.has(child.id));
        const row = createElement('div', `folder-tree-row${state.view.type === 'folder' && state.view.value === folder.id ? ' active' : ''}`);
        row.dataset.id = String(folder.id);

        const toggle = createElement('button', `folder-toggle${children.length ? '' : ' is-placeholder'}`);
        toggle.type = 'button';
        toggle.setAttribute('aria-label', folder.collapsed ? '展开文件夹' : '折叠文件夹');
        if (children.length) {
            toggle.append(createIcon('chevron-right', 14));
            toggle.classList.toggle('expanded', !folder.collapsed);
            toggle.addEventListener('click', async (event) => {
                event.stopPropagation();
                folder.collapsed = !folder.collapsed;
                await saveItem(toStorageRecord(folder));
                renderSidebar();
            });
        }

        const openButton = createElement('button', 'folder-tree-open');
        openButton.type = 'button';
        openButton.append(createIcon('folder', 16), createElement('span', '', folder.title));
        const count = createElement('span', 'folder-item-count', String(countBookmarksBelow(folder.id)));
        openButton.append(count);
        openButton.addEventListener('click', () => setView('folder', folder.id));

        const editButton = createElement('button', 'folder-tree-edit');
        editButton.type = 'button';
        editButton.title = '编辑文件夹';
        editButton.setAttribute('aria-label', `编辑 ${folder.title}`);
        editButton.append(createIcon('edit', 14));
        editButton.addEventListener('click', () => openItemDialog('folder', folder));

        row.append(toggle, openButton, editButton);
        makeDraggable(row, folder.id);
        installFolderDropTarget(row, folder.id);
        wrapper.append(row);

        if (children.length) {
            const branch = createElement('div', 'folder-tree-children');
            branch.classList.toggle('hidden', folder.collapsed);
            const nextAncestors = new Set(ancestors);
            nextAncestors.add(folder.id);
            for (const child of sortByTitle(children)) {
                branch.append(createFolderTreeNode(child, childrenMap, visited, nextAncestors));
            }
            wrapper.append(branch);
        }
        return wrapper;
    }

    function createSidebarHint(text) {
        return createElement('p', 'sidebar-hint', text);
    }

    function renderBreadcrumbs() {
        ui.breadcrumbs.replaceChildren();
        if (state.view.type !== 'folder') {
            ui.breadcrumbs.classList.add('hidden');
            return;
        }

        const path = getFolderPath(state.view.value);
        if (!path.length) {
            ui.breadcrumbs.classList.add('hidden');
            return;
        }

        const rootButton = createElement('button', '', '全部');
        rootButton.type = 'button';
        rootButton.addEventListener('click', () => setView('all'));
        ui.breadcrumbs.append(rootButton, createIcon('chevron-right', 13));

        path.forEach((folder, index) => {
            if (index === path.length - 1) {
                ui.breadcrumbs.append(createElement('span', '', folder.title));
            } else {
                const button = createElement('button', '', folder.title);
                button.type = 'button';
                button.addEventListener('click', () => setView('folder', folder.id));
                ui.breadcrumbs.append(button, createIcon('chevron-right', 13));
            }
        });
        ui.breadcrumbs.classList.remove('hidden');
    }

    function renderContent() {
        const content = getVisibleContent();
        renderHeading(content);
        ui.folderGrid.replaceChildren();
        ui.bookmarkGrid.replaceChildren();

        for (const folder of content.folders) ui.folderGrid.append(createFolderCard(folder));
        for (const bookmark of content.bookmarks) ui.bookmarkGrid.append(createBookmarkCard(bookmark));

        ui.folderGrid.classList.toggle('hidden', content.folders.length === 0);
        ui.bookmarkGrid.classList.toggle('hidden', content.bookmarks.length === 0);
        renderEmptyState(content);
    }

    function getVisibleContent() {
        const folders = state.items.filter(isFolder);
        const bookmarks = state.items.filter(isBookmark);
        let visibleFolders = [];
        let visibleBookmarks = [];

        if (state.view.type === 'folder') {
            visibleFolders = folders.filter((item) => item.parentId === state.view.value);
            visibleBookmarks = bookmarks.filter((item) => item.parentId === state.view.value);
        } else if (state.view.type === 'favorites') {
            visibleBookmarks = bookmarks.filter((item) => item.isPinned);
        } else if (state.view.type === 'tag') {
            visibleBookmarks = bookmarks.filter((item) => item.tags.includes(state.view.value));
        } else {
            visibleFolders = state.query
                ? folders
                : folders.filter((item) => item.parentId == null);
            visibleBookmarks = bookmarks;
        }

        const query = state.query.toLocaleLowerCase('zh-CN');
        if (query) {
            visibleFolders = visibleFolders.filter((folder) => folder.title.toLocaleLowerCase('zh-CN').includes(query));
            visibleBookmarks = visibleBookmarks.filter((bookmark) => [
                bookmark.title,
                bookmark.url,
                bookmark.description,
                ...bookmark.tags,
            ].some((value) => value.toLocaleLowerCase('zh-CN').includes(query)));
        }

        visibleFolders = sortByTitle(visibleFolders);
        visibleBookmarks = visibleBookmarks.slice().sort(compareBookmarks);
        return { folders: visibleFolders, bookmarks: visibleBookmarks };
    }

    function renderHeading(content) {
        let title = '全部书签';
        let eyebrow = 'YOUR COLLECTION';
        let description = '把散落在各处的好内容，整理成自己的知识入口。';

        if (state.view.type === 'favorites') {
            title = '我的收藏';
            eyebrow = 'FAVORITES';
            description = '留住你最常使用和最值得回看的链接。';
        } else if (state.view.type === 'tag') {
            title = `# ${state.view.value}`;
            eyebrow = 'TAG COLLECTION';
            description = `收录在“${state.view.value}”标签下的链接。`;
        } else if (state.view.type === 'folder') {
            const folder = findItem(state.view.value);
            title = folder ? folder.title : '文件夹';
            eyebrow = 'FOLDER';
            description = '浏览并整理这个文件夹中的内容。';
        }

        ui.pageTitle.textContent = title;
        ui.pageEyebrow.textContent = eyebrow;
        ui.pageDescription.textContent = description;
        const total = content.folders.length + content.bookmarks.length;
        ui.resultCount.textContent = String(total).padStart(2, '0');

        const parts = [];
        if (content.folders.length) parts.push(`${content.folders.length} 个文件夹`);
        parts.push(`${content.bookmarks.length} 条书签`);
        ui.resultsLabel.textContent = state.query
            ? `“${state.query}”的结果：${parts.join('，')}`
            : `显示 ${parts.join('，')}`;
    }

    function createFolderCard(folder) {
        const card = createElement('article', 'folder-card');
        card.dataset.id = String(folder.id);

        const openButton = createElement('button', 'folder-card-main');
        openButton.type = 'button';
        const iconBox = createElement('span', 'folder-card-icon');
        iconBox.append(createIcon('folder', 24));
        const copy = createElement('span', 'folder-card-copy');
        copy.append(createElement('strong', '', folder.title));
        const directChildren = state.items.filter((item) => item.parentId === folder.id);
        const childFolders = directChildren.filter(isFolder).length;
        const childBookmarks = directChildren.filter(isBookmark).length;
        copy.append(createElement('small', '', `${childFolders} 个文件夹 · ${childBookmarks} 条书签`));
        openButton.append(iconBox, copy, createIcon('chevron-right', 17));
        openButton.addEventListener('click', () => setView('folder', folder.id));

        const actions = createElement('div', 'folder-card-actions');
        actions.append(
            createActionButton('edit', `编辑 ${folder.title}`, () => openItemDialog('folder', folder)),
            createActionButton('trash', `删除 ${folder.title}`, () => deleteItem(folder), true),
        );
        card.append(openButton, actions);
        makeDraggable(card, folder.id);
        installFolderDropTarget(card, folder.id);
        return card;
    }

    function createBookmarkCard(bookmark) {
        const card = createElement('article', 'bookmark-card');
        card.dataset.id = String(bookmark.id);
        const href = getSafeHref(bookmark.url);
        const hostname = getHostname(href || bookmark.url);

        const top = createElement('div', 'card-topline');
        const mark = href ? createElement('a', 'site-mark', getSiteInitial(hostname)) : createElement('span', 'site-mark', getSiteInitial(hostname));
        mark.style.setProperty('--mark-hue', String(hashString(hostname) % 360));
        if (href) {
            mark.href = href;
            mark.target = '_blank';
            mark.rel = 'noopener noreferrer';
            mark.setAttribute('aria-label', `打开 ${bookmark.title}`);
        }

        const actions = createElement('div', 'card-actions');
        const favorite = createActionButton('star', bookmark.isPinned ? '取消收藏' : '加入收藏', () => toggleFavorite(bookmark));
        favorite.classList.add('favorite-button');
        favorite.classList.toggle('is-favorite', bookmark.isPinned);
        actions.append(
            favorite,
            createActionButton('edit', `编辑 ${bookmark.title}`, () => openItemDialog('bookmark', bookmark), false, true),
            createActionButton('trash', `删除 ${bookmark.title}`, () => deleteItem(bookmark), true, true),
        );
        top.append(mark, actions);

        const body = createElement('div', 'card-body');
        let titleElement;
        if (href) {
            titleElement = createElement('a', 'bookmark-title');
            titleElement.href = href;
            titleElement.target = '_blank';
            titleElement.rel = 'noopener noreferrer';
            titleElement.append(createElement('span', '', bookmark.title), createIcon('external', 15));
        } else {
            titleElement = createElement('span', 'bookmark-title invalid-link', bookmark.title);
            titleElement.title = '这个链接使用了不受支持的协议，请编辑后再打开';
        }
        body.append(titleElement, createElement('p', 'bookmark-domain', hostname || '无效链接'));
        if (bookmark.description) body.append(createElement('p', 'bookmark-description', bookmark.description));

        const footer = createElement('footer', 'card-footer');
        const tags = createElement('div', 'tag-list');
        bookmark.tags.slice(0, 3).forEach((tag) => {
            const button = createElement('button', 'tag-chip', tag);
            button.type = 'button';
            button.addEventListener('click', () => setView('tag', tag));
            tags.append(button);
        });
        if (bookmark.tags.length > 3) tags.append(createElement('span', 'extra-tags', `+${bookmark.tags.length - 3}`));
        const time = createElement('time', '', formatItemDate(bookmark));
        if (bookmark.createdAt) time.dateTime = bookmark.createdAt;
        footer.append(tags, time);

        card.append(top, body, footer);
        makeDraggable(card, bookmark.id);
        return card;
    }

    function createActionButton(iconName, label, handler, danger = false, subtle = false) {
        const button = createElement('button', 'icon-button');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        if (danger) button.classList.add('danger-action');
        if (subtle) button.classList.add('subtle-action');
        button.append(createIcon(iconName, 17));
        button.addEventListener('click', handler);
        return button;
    }

    function renderEmptyState(content) {
        const empty = content.folders.length === 0 && content.bookmarks.length === 0;
        ui.emptyState.classList.toggle('hidden', !empty);
        if (!empty) return;

        const hasAnyData = state.items.length > 0;
        const hasFilter = Boolean(state.query || state.view.type !== 'all');
        if (hasAnyData && hasFilter) {
            ui.emptyIconUse.setAttribute('href', '#icon-search');
            ui.emptyTitle.textContent = '没有找到匹配的内容';
            ui.emptyDescription.textContent = '试试其他关键词，或清除当前筛选条件。';
            ui.emptyActionIcon.setAttribute('href', '#icon-x');
            ui.emptyActionLabel.textContent = '清除筛选';
            ui.emptyActionButton.dataset.action = 'clear';
        } else {
            ui.emptyIconUse.setAttribute('href', '#icon-bookmark');
            ui.emptyTitle.textContent = '从第一条书签开始';
            ui.emptyDescription.textContent = '数据保存在浏览器中，不需要服务器或账号。';
            ui.emptyActionIcon.setAttribute('href', '#icon-plus');
            ui.emptyActionLabel.textContent = '添加书签';
            ui.emptyActionButton.dataset.action = 'add';
        }
    }

    function handleEmptyAction() {
        if (ui.emptyActionButton.dataset.action === 'clear') {
            clearSearch();
            setView('all');
        } else {
            openItemDialog('bookmark');
        }
    }

    function openItemDialog(kind, item = null) {
        const isFolderItem = kind === 'folder';
        ui.itemId.value = item ? String(item.id) : '';
        ui.itemKind.value = kind;
        ui.itemTitleInput.value = item?.title || '';
        ui.itemUrlInput.value = item?.url || '';
        ui.itemDescriptionInput.value = item?.description || '';
        ui.itemTagsInput.value = item?.tags.join(', ') || '';
        ui.itemFavoriteInput.checked = item?.isPinned || false;
        ui.formError.textContent = '';
        ui.formError.classList.add('hidden');

        ui.bookmarkOnlyFields.forEach((field) => field.classList.toggle('hidden', isFolderItem));
        ui.itemUrlInput.required = !isFolderItem;
        populateParentSelect(item, kind);

        const mode = item ? 'EDIT' : 'NEW';
        ui.dialogEyebrow.textContent = `${mode} ${isFolderItem ? 'FOLDER' : 'BOOKMARK'}`;
        ui.dialogTitle.textContent = item
            ? `编辑${isFolderItem ? '文件夹' : '书签'}`
            : `添加新${isFolderItem ? '文件夹' : '书签'}`;
        ui.dialogSubmitButton.textContent = item
            ? '保存修改'
            : `添加${isFolderItem ? '文件夹' : '书签'}`;

        ui.itemDialog.showModal();
        window.setTimeout(() => ui.itemTitleInput.focus(), 0);
    }

    function closeItemDialog() {
        if (ui.itemDialog.open) ui.itemDialog.close();
        ui.itemForm.reset();
        ui.formError.classList.add('hidden');
    }

    function populateParentSelect(item, kind) {
        ui.itemParentSelect.replaceChildren();
        const root = createElement('option', '', '/ 根目录');
        root.value = 'root';
        ui.itemParentSelect.append(root);

        const excluded = new Set();
        if (item && kind === 'folder') {
            excluded.add(item.id);
            getAllDescendantIds(item.id).forEach((id) => excluded.add(id));
        }

        const folders = state.items
            .filter(isFolder)
            .filter((folder) => !excluded.has(folder.id))
            .map((folder) => ({ folder, path: getFolderPathLabel(folder.id) }))
            .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));

        for (const { folder, path } of folders) {
            const option = createElement('option', '', path);
            option.value = String(folder.id);
            ui.itemParentSelect.append(option);
        }

        const defaultParent = item
            ? item.parentId
            : state.view.type === 'folder' ? state.view.value : null;
        ui.itemParentSelect.value = defaultParent == null ? 'root' : String(defaultParent);
        if (!ui.itemParentSelect.value) ui.itemParentSelect.value = 'root';
    }

    async function handleItemSubmit(event) {
        event.preventDefault();
        const title = ui.itemTitleInput.value.trim();
        const kind = ui.itemKind.value;
        const id = ui.itemId.value ? Number(ui.itemId.value) : null;
        const existing = id == null ? null : findItem(id);
        const parentId = ui.itemParentSelect.value === 'root' ? null : Number(ui.itemParentSelect.value);

        if (!title) {
            showFormError('请输入标题。');
            ui.itemTitleInput.focus();
            return;
        }
        if (kind === 'folder' && id != null && (parentId === id || getAllDescendantIds(id).includes(parentId))) {
            showFormError('文件夹不能移动到自身或其子文件夹中。');
            return;
        }

        let url = '';
        if (kind === 'bookmark') {
            try {
                url = normalizeUrl(ui.itemUrlInput.value);
            } catch (error) {
                showFormError(error.message);
                ui.itemUrlInput.focus();
                return;
            }
        }

        const now = new Date().toISOString();
        const record = {
            ...(existing ? toStorageRecord(existing) : {}),
            title,
            url,
            description: kind === 'bookmark' ? ui.itemDescriptionInput.value.trim() : '',
            tags: kind === 'bookmark' ? parseTags(ui.itemTagsInput.value) : [],
            parentId,
            isPinned: kind === 'bookmark' && ui.itemFavoriteInput.checked,
            collapsed: existing?.collapsed || false,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        if (id != null) record.id = id;

        try {
            await saveItem(record);
            closeItemDialog();
            await refreshData();
            showToast(existing ? '修改已保存' : `${kind === 'folder' ? '文件夹' : '书签'}已添加`);
        } catch (error) {
            console.error(error);
            showFormError('保存失败，请检查浏览器是否允许本地存储。');
        }
    }

    function showFormError(message) {
        ui.formError.textContent = message;
        ui.formError.classList.remove('hidden');
    }

    async function toggleFavorite(bookmark) {
        const updated = toStorageRecord(bookmark);
        updated.isPinned = !bookmark.isPinned;
        updated.updatedAt = new Date().toISOString();
        await saveItem(updated);
        await refreshData();
        showToast(updated.isPinned ? '已加入收藏' : '已取消收藏');
    }

    async function deleteItem(item) {
        const descendantIds = isFolder(item) ? getAllDescendantIds(item.id) : [];
        const suffix = descendantIds.length ? `及其中的 ${descendantIds.length} 个项目` : '';
        if (!window.confirm(`确定删除“${item.title}”${suffix}吗？此操作无法撤销。`)) return;

        await deleteItems([item.id, ...descendantIds]);
        if (state.view.type === 'folder' && (state.view.value === item.id || descendantIds.includes(state.view.value))) {
            state.view = { type: 'all', value: null };
        }
        await refreshData();
        showToast('已删除');
    }

    function makeDraggable(element, id) {
        element.draggable = true;
        element.addEventListener('dragstart', (event) => {
            state.draggedId = id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(id));
            window.setTimeout(() => element.classList.add('is-dragging'), 0);
        });
        element.addEventListener('dragend', clearDragState);
    }

    function installFolderDropTarget(element, folderId) {
        element.addEventListener('dragover', (event) => {
            if (!canMoveItem(state.draggedId, folderId)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            element.classList.add('drag-over');
        });
        element.addEventListener('dragleave', (event) => {
            if (!element.contains(event.relatedTarget)) element.classList.remove('drag-over');
        });
        element.addEventListener('drop', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            element.classList.remove('drag-over');
            const draggedId = state.draggedId ?? Number(event.dataTransfer.getData('text/plain'));
            await moveItem(draggedId, folderId);
        });
    }

    function installRootDropTarget(element) {
        element.addEventListener('dragover', (event) => {
            const item = findItem(state.draggedId);
            if (!item || item.parentId == null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            element.classList.add('drag-over');
        });
        element.addEventListener('dragleave', () => element.classList.remove('drag-over'));
        element.addEventListener('drop', async (event) => {
            event.preventDefault();
            element.classList.remove('drag-over');
            const draggedId = state.draggedId ?? Number(event.dataTransfer.getData('text/plain'));
            await moveItem(draggedId, null);
        });
    }

    function canMoveItem(itemId, targetFolderId) {
        if (itemId == null || itemId === targetFolderId) return false;
        const item = findItem(itemId);
        const target = findItem(targetFolderId);
        if (!item || !target || !isFolder(target)) return false;
        return !isFolder(item) || !getAllDescendantIds(item.id).includes(targetFolderId);
    }

    async function moveItem(itemId, parentId) {
        const item = findItem(itemId);
        if (!item || item.parentId === parentId) {
            clearDragState();
            return;
        }
        if (parentId != null && !canMoveItem(itemId, parentId)) {
            showToast('不能移动到这个文件夹');
            clearDragState();
            return;
        }

        const updated = toStorageRecord(item);
        updated.parentId = parentId;
        updated.updatedAt = new Date().toISOString();
        await saveItem(updated);
        clearDragState();
        await refreshData();
        showToast(parentId == null ? '已移动到根目录' : '已移动到文件夹');
    }

    function clearDragState() {
        state.draggedId = null;
        document.querySelectorAll('.drag-over, .is-dragging').forEach((element) => {
            element.classList.remove('drag-over', 'is-dragging');
        });
    }

    async function handleImport(event) {
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
            const skipped = parsed.skipped + prepared.duplicateCount;
            const details = [
                prepared.mergedFolderCount ? `复用 ${prepared.mergedFolderCount} 个文件夹` : '',
                skipped ? `跳过 ${skipped} 项` : '',
            ].filter(Boolean).join('，');
            showToast(`已导入 ${importedCount} 项${details ? `，${details}` : ''}`);
        } catch (error) {
            console.error('Import failed:', error);
            showToast(`导入失败：${error.message}`);
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
        return `${parent}\u0000${title.trim().toLocaleLowerCase('zh-CN')}`;
    }

    function parseJsonImport(content) {
        let payload;
        try {
            payload = JSON.parse(content);
        } catch {
            throw new Error('JSON 文件格式不正确');
        }

        const source = Array.isArray(payload)
            ? payload
            : payload && typeof payload === 'object' && Array.isArray(payload.bookmarks)
                ? payload.bookmarks
                : payload && typeof payload === 'object' && Array.isArray(payload.items)
                    ? payload.items
                    : null;
        if (!source) throw new Error('文件中没有可识别的书签数组');

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
                title,
                url,
                description: typeof input.description === 'string' ? input.description.trim() : '',
                tags: parseTags(input.tags),
                isPinned: input.isPinned === true || input.favorite === true,
                createdAt: validDate(input.createdAt) ? input.createdAt : new Date().toISOString(),
                updatedAt: validDate(input.updatedAt) ? input.updatedAt : new Date().toISOString(),
            });
        });

        if (!records.length && source.length) throw new Error('没有找到有效的书签或文件夹');
        return { records: orderParentsFirst(records), skipped };
    }

    function parseHtmlImport(content) {
        const documentObject = new DOMParser().parseFromString(content, 'text/html');
        const root = documentObject.querySelector('dl');
        if (!root) throw new Error('这不是有效的浏览器书签 HTML 文件');

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
                    const title = folderHeader.textContent.trim() || '未命名文件夹';
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
                const title = link.textContent.trim() || link.getAttribute('href') || '未命名书签';
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
        if (!records.length) throw new Error('HTML 文件中没有可导入的内容');
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
        const payload = {
            format: 'bookmark-manager',
            version: 2,
            exportedAt: new Date().toISOString(),
            bookmarks: state.items.map(toStorageRecord),
        };
        downloadFile(
            JSON.stringify(payload, null, 2),
            'application/json',
            `bookmarks-${today()}.json`,
        );
        showToast(`已导出 ${state.items.length} 项 JSON 数据`);
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
        showToast(`已导出 ${state.items.length} 项浏览器书签`);
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
        if (!state.items.length) {
            showToast('当前没有可清空的数据');
            return;
        }
        if (!window.confirm('确定清空全部书签和文件夹吗？建议先导出 JSON 备份。此操作无法撤销。')) return;
        await clearDatabase();
        state.view = { type: 'all', value: null };
        clearSearch();
        await refreshData();
        showToast('全部数据已清空');
    }

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
        if (state.sort === 'title') return left.title.localeCompare(right.title, 'zh-CN');
        const difference = itemTimestamp(left) - itemTimestamp(right);
        return state.sort === 'oldest' ? difference : -difference;
    }

    function sortByTitle(items) {
        return items.slice().sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
    }

    function sortTreeItems(items) {
        return items.slice().sort((left, right) => {
            if (isFolder(left) !== isFolder(right)) return isFolder(left) ? -1 : 1;
            return left.title.localeCompare(right.title, 'zh-CN');
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
            title: item.title,
            url: item.url,
            description: item.description || '',
            tags: parseTags(item.tags),
            parentId: item.parentId == null ? null : item.parentId,
            isPinned: item.isPinned === true,
            collapsed: item.collapsed === true,
            createdAt: item.createdAt || '',
            updatedAt: item.updatedAt || '',
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
        if (!input) throw new Error('请输入链接。');
        const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
        let url;
        try {
            url = new URL(withProtocol);
        } catch {
            throw new Error('请输入有效的链接。');
        }
        if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error('仅支持 http、https、ftp 或本地文件链接。');
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
            if (url.protocol === 'file:') return '本地文件';
            return url.hostname.replace(/^www\./, '') || url.protocol.replace(':', '');
        } catch {
            return value;
        }
    }

    function getSiteInitial(hostname) {
        return (hostname || '·').trim().slice(0, 1).toUpperCase();
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
        if (!validDate(value)) return '历史数据';
        return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
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
        ui.storageStatus.textContent = '本地数据库连接失败';
        ui.bookmarkGrid.replaceChildren();
        ui.folderGrid.replaceChildren();
        const panel = createElement('section', 'fatal-error');
        panel.append(
            createIcon('database', 30),
            createElement('h2', '', '无法打开本地数据库'),
            createElement('p', '', error?.message || '请使用最新版 Edge、Chrome、Firefox 或 Safari 打开本页面。'),
        );
        ui.bookmarkGrid.append(panel);
    }

    function safeStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function safeStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // Theme and sorting preferences are non-critical.
        }
    }
})();
