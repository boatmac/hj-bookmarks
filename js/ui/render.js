/* Main navigation and bookmark rendering. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function normalizeItem(input) {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    return {
        id: input.id,
        syncId: typeof input.syncId === 'string' && input.syncId ? input.syncId : createUuid(),
        title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : t('untitled'),
        url,
        description: typeof input.description === 'string' ? input.description.trim() : '',
        tags: parseTags(input.tags),
        parentId: input.parentId == null || input.parentId === 'root' ? null : Number(input.parentId),
        isPinned: input.isPinned === true || input.favorite === true,
        collapsed: input.collapsed === true,
        createdAt: validDate(input.createdAt) ? input.createdAt : '',
        updatedAt: validDate(input.updatedAt) ? input.updatedAt : '',
        modifiedBy: typeof input.modifiedBy === 'string' && input.modifiedBy
            ? input.modifiedBy
            : state.sync.deviceId,
    };
}

function renderAll() {
    renderSidebar();
    renderBreadcrumbs();
    renderContent();
    renderConflictBanner();
}

function renderSidebar() {
    const bookmarks = state.items.filter(isBookmark);
    const folders = state.items.filter(isFolder);
    ui.allCount.textContent = String(bookmarks.length);
    ui.favoritesCount.textContent = String(bookmarks.filter((item) => item.isPinned).length);
    ui.recycleBinCount.textContent = String(state.recycleBin.length);
    ui.tagsCount.textContent = String(getTagCounts().size);

    ui.allViewButton.classList.toggle('active', state.view.type === 'all');
    ui.favoritesViewButton.classList.toggle('active', state.view.type === 'favorites');
    ui.recycleBinViewButton.classList.toggle('active', state.view.type === 'trash');

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
    if (!folders.length) ui.folderTree.append(createSidebarHint(t('noFolders')));

    ui.tagNavigation.replaceChildren();
    const tagCounts = [...getTagCounts().entries()].sort((left, right) => left[0].localeCompare(right[0], currentLocale()));
    for (const [tag, count] of tagCounts) {
        const button = createElement('button', `nav-item tag-nav-item${state.view.type === 'tag' && state.view.value === tag ? ' active' : ''}`);
        button.type = 'button';
        button.append(createIcon('tag', 16), createElement('span', '', tag), createElement('span', 'nav-count', String(count)));
        button.addEventListener('click', () => setView('tag', tag));
        ui.tagNavigation.append(button);
    }
    if (!tagCounts.length) ui.tagNavigation.append(createSidebarHint(t('noTags')));
}

function createFolderTreeNode(folder, childrenMap, visited, ancestors) {
    const wrapper = createElement('div', 'folder-tree-node');
    if (ancestors.has(folder.id)) return wrapper;
    visited.add(folder.id);

    const children = (childrenMap.get(folder.id) || []).filter((child) => !ancestors.has(child.id));
    const row = createElement('div', `folder-tree-row${state.view.type === 'folder' && state.view.value === folder.id ? ' active' : ''}`);
    row.dataset.id = String(folder.id);
    row.classList.toggle('has-conflict', state.sync.conflicts.some((conflict) => conflict.syncId === folder.syncId));

    const toggle = createElement('button', `folder-toggle${children.length ? '' : ' is-placeholder'}`);
    toggle.type = 'button';
    toggle.setAttribute('aria-label', t(folder.collapsed ? 'expandFolder' : 'collapseFolder'));
    if (children.length) {
        toggle.append(createIcon('chevron-right', 14));
        toggle.classList.toggle('expanded', !folder.collapsed);
        toggle.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (preventMutationDuringSync()) return;
            await runUserDataMutation(async () => {
                folder.collapsed = !folder.collapsed;
                await saveItem(toStorageRecord(folder));
                scheduleAutoBackup();
                broadcastDataChanged('folder-state');
                renderSidebar();
            });
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
    editButton.title = t('editItem', { title: folder.title });
    editButton.setAttribute('aria-label', t('editItem', { title: folder.title }));
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

    const rootButton = createElement('button', '', t('breadcrumbAll'));
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
    ui.folderGrid.replaceChildren();
    ui.bookmarkGrid.replaceChildren();
    if (state.view.type === 'trash') {
        ui.folderGrid.classList.add('hidden');
        ui.bookmarkGrid.classList.add('hidden');
        ui.recoveryList.classList.remove('hidden');
        ui.addFolderButton.classList.add('hidden');
        renderRecoveryView();
        return;
    }

    ui.recoveryList.classList.add('hidden');
    ui.addFolderButton.classList.remove('hidden');
    const content = getVisibleContent();
    renderHeading(content);

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

    const query = state.query.toLocaleLowerCase(currentLocale());
    if (query) {
        visibleFolders = visibleFolders.filter((folder) => folder.title.toLocaleLowerCase(currentLocale()).includes(query));
        visibleBookmarks = visibleBookmarks.filter((bookmark) => [
            bookmark.title,
            bookmark.url,
            bookmark.description,
            ...bookmark.tags,
        ].some((value) => value.toLocaleLowerCase(currentLocale()).includes(query)));
    }

    visibleFolders = sortByTitle(visibleFolders);
    visibleBookmarks = visibleBookmarks.slice().sort(compareBookmarks);
    return { folders: visibleFolders, bookmarks: visibleBookmarks };
}

function renderHeading(content) {
    let title = t('allBookmarks');
    let eyebrow = t('eyebrowAll');
    let description = t('allDescription');

    if (state.view.type === 'favorites') {
        title = t('favorites');
        eyebrow = t('eyebrowFavorites');
        description = t('favoritesDescription');
    } else if (state.view.type === 'tag') {
        title = `# ${state.view.value}`;
        eyebrow = t('eyebrowTag');
        description = t('tagDescription', { tag: state.view.value });
    } else if (state.view.type === 'folder') {
        const folder = findItem(state.view.value);
        title = folder ? folder.title : t('folderFallback');
        eyebrow = t('eyebrowFolder');
        description = t('folderDescription');
    }

    ui.pageTitle.textContent = title;
    ui.pageEyebrow.textContent = eyebrow;
    ui.pageDescription.textContent = description;
    const total = content.folders.length + content.bookmarks.length;
    ui.resultCount.textContent = String(total).padStart(2, '0');

    const parts = [];
    if (content.folders.length) parts.push(t('folderCount', { count: content.folders.length }));
    parts.push(t('bookmarkCount', { count: content.bookmarks.length }));
    const summary = parts.join(t('listSeparator'));
    ui.resultsLabel.textContent = state.query
        ? t('searchResults', { query: state.query, summary })
        : t('showResults', { summary });
}

function createFolderCard(folder) {
    const card = createElement('article', 'folder-card');
    card.dataset.id = String(folder.id);
    card.classList.toggle('has-conflict', state.sync.conflicts.some((conflict) => conflict.syncId === folder.syncId));

    const openButton = createElement('button', 'folder-card-main');
    openButton.type = 'button';
    const iconBox = createElement('span', 'folder-card-icon');
    iconBox.append(createIcon('folder', 24));
    const copy = createElement('span', 'folder-card-copy');
    copy.append(createElement('strong', '', folder.title));
    const directChildren = state.items.filter((item) => item.parentId === folder.id);
    const childFolders = directChildren.filter(isFolder).length;
    const childBookmarks = directChildren.filter(isBookmark).length;
    copy.append(createElement('small', '', t('folderMeta', { folders: childFolders, bookmarks: childBookmarks })));
    openButton.append(iconBox, copy, createIcon('chevron-right', 17));
    openButton.addEventListener('click', () => setView('folder', folder.id));

    const actions = createElement('div', 'folder-card-actions');
    actions.append(
        createActionButton('edit', t('editItem', { title: folder.title }), () => openItemDialog('folder', folder)),
        createActionButton('trash', t('deleteItem', { title: folder.title }), () => deleteItem(folder), true),
    );
    card.append(openButton, actions);
    makeDraggable(card, folder.id);
    installFolderDropTarget(card, folder.id);
    return card;
}

function createBookmarkCard(bookmark) {
    const card = createElement('article', 'bookmark-card');
    card.dataset.id = String(bookmark.id);
    card.classList.toggle('has-conflict', state.sync.conflicts.some((conflict) => conflict.syncId === bookmark.syncId));
    const href = getSafeHref(bookmark.url);
    const hostname = getHostname(href || bookmark.url);

    const top = createElement('div', 'card-topline');
    const mark = href ? createElement('a', 'site-mark', getSiteInitial(hostname)) : createElement('span', 'site-mark', getSiteInitial(hostname));
    mark.style.setProperty('--mark-hue', String(hashString(hostname) % 360));
    if (href) {
        mark.href = href;
        mark.target = '_blank';
        mark.rel = 'noopener noreferrer';
        mark.setAttribute('aria-label', t('openItem', { title: bookmark.title }));
    }

    const actions = createElement('div', 'card-actions');
    const favorite = createActionButton('star', t(bookmark.isPinned ? 'unfavorite' : 'favorite'), () => toggleFavorite(bookmark));
    favorite.classList.add('favorite-button');
    favorite.classList.toggle('is-favorite', bookmark.isPinned);
    actions.append(
        favorite,
        createActionButton('edit', t('editItem', { title: bookmark.title }), () => openItemDialog('bookmark', bookmark), false, true),
        createActionButton('trash', t('deleteItem', { title: bookmark.title }), () => deleteItem(bookmark), true, true),
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
        titleElement.title = t('unsupportedLink');
    }
    body.append(titleElement, createElement('p', 'bookmark-domain', hostname || t('invalidLink')));
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
