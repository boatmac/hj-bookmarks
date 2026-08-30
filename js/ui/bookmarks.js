/* Bookmark dialogs and interactive operations. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function renderEmptyState(content) {
    const empty = content.folders.length === 0 && content.bookmarks.length === 0;
    ui.emptyState.classList.toggle('hidden', !empty);
    if (!empty) return;

    const hasAnyData = state.items.length > 0;
    const hasFilter = Boolean(state.query || state.view.type !== 'all');
    if (hasAnyData && hasFilter) {
        ui.emptyIconUse.setAttribute('href', '#icon-search');
        ui.emptyTitle.textContent = t('emptyNoMatch');
        ui.emptyDescription.textContent = t('emptyTryAgain');
        ui.emptyActionIcon.setAttribute('href', '#icon-x');
        ui.emptyActionLabel.textContent = t('clearFilters');
        ui.emptyActionButton.dataset.action = 'clear';
    } else {
        ui.emptyIconUse.setAttribute('href', '#icon-bookmark');
        ui.emptyTitle.textContent = t('emptyFirstTitle');
        ui.emptyDescription.textContent = t('emptyLocalDescription');
        ui.emptyActionIcon.setAttribute('href', '#icon-plus');
        ui.emptyActionLabel.textContent = t('addBookmark');
        ui.emptyActionButton.dataset.action = 'add';
    }
}

function handleEmptyAction() {
    const action = ui.emptyActionButton.dataset.action;
    if (action === 'clear') {
        clearSearch();
        setView('all');
    } else if (action === 'all') {
        setView('all');
    } else {
        openItemDialog('bookmark');
    }
}

function openItemDialog(kind, item = null) {
    if (preventMutationDuringSync()) return;
    if (item && openConflictForItem(item)) return;
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

    updateDialogLabels(kind, item);
    ui.itemDialog.showModal();
    window.setTimeout(() => ui.itemTitleInput.focus(), 0);
}

function updateDialogLabels(kind, item) {
    const isFolderItem = kind === 'folder';
    ui.dialogEyebrow.textContent = t(item
        ? isFolderItem ? 'eyebrowEditFolder' : 'eyebrowEditBookmark'
        : isFolderItem ? 'eyebrowAddFolder' : 'eyebrowAddBookmark');
    ui.dialogTitle.textContent = item
        ? t(isFolderItem ? 'dialogEditFolder' : 'dialogEditBookmark')
        : t(isFolderItem ? 'dialogAddFolder' : 'dialogAddBookmark');
    ui.dialogSubmitButton.textContent = item
        ? t('saveChanges')
        : t(isFolderItem ? 'addFolder' : 'addBookmark');
}

function closeItemDialog() {
    if (ui.itemDialog.open) ui.itemDialog.close();
    ui.itemForm.reset();
    ui.formError.classList.add('hidden');
}

function populateParentSelect(item, kind) {
    ui.itemParentSelect.replaceChildren();
    const root = createElement('option', '', t('rootFolder'));
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
        .sort((left, right) => left.path.localeCompare(right.path, currentLocale()));

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
    if (preventMutationDuringSync()) return;
    const title = ui.itemTitleInput.value.trim();
    const kind = ui.itemKind.value;
    const id = ui.itemId.value ? Number(ui.itemId.value) : null;
    const existing = id == null ? null : findItem(id);
    const parentId = ui.itemParentSelect.value === 'root' ? null : Number(ui.itemParentSelect.value);

    if (!title) {
        showFormError(t('titleRequired'));
        ui.itemTitleInput.focus();
        return;
    }
    if (kind === 'folder' && id != null && (parentId === id || getAllDescendantIds(id).includes(parentId))) {
        showFormError(t('folderCycle'));
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
        syncId: existing?.syncId || createUuid(),
        title,
        url,
        description: kind === 'bookmark' ? ui.itemDescriptionInput.value.trim() : '',
        tags: kind === 'bookmark' ? parseTags(ui.itemTagsInput.value) : [],
        parentId,
        isPinned: kind === 'bookmark' && ui.itemFavoriteInput.checked,
        collapsed: existing?.collapsed || false,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        modifiedBy: state.sync.deviceId,
    };
    if (id != null) record.id = id;

    try {
        await runUserDataMutation(async () => {
            await saveItem(record);
            closeItemDialog();
            await refreshData();
            scheduleDataProtection();
            showToast(existing ? t('saved') : t(kind === 'folder' ? 'folderAdded' : 'bookmarkAdded'));
        });
    } catch (error) {
        console.error(error);
        showFormError(t('saveFailed'));
    }
}

function showFormError(message) {
    ui.formError.textContent = message;
    ui.formError.classList.remove('hidden');
}

async function toggleFavorite(bookmark) {
    if (preventMutationDuringSync()) return;
    if (openConflictForItem(bookmark)) return;
    await runUserDataMutation(async () => {
        const updated = toStorageRecord(bookmark);
        updated.isPinned = !bookmark.isPinned;
        updated.updatedAt = new Date().toISOString();
        updated.modifiedBy = state.sync.deviceId;
        await saveItem(updated);
        await refreshData();
        scheduleDataProtection();
        showToast(t(updated.isPinned ? 'favoriteAdded' : 'favoriteRemoved'));
    });
}

async function deleteItem(item) {
    if (preventMutationDuringSync()) return;
    if (openConflictForItem(item)) return;
    const descendantIds = isFolder(item) ? getAllDescendantIds(item.id) : [];
    if (!window.confirm(t('confirmDelete', { title: item.title, count: descendantIds.length }))) return;

    await flushBackupBeforeDestructiveChange();
    await runUserDataMutation(async () => {
        const deletingIds = new Set([item.id, ...descendantIds]);
        await deleteItems(state.items.filter((candidate) => deletingIds.has(candidate.id)));
        if (state.view.type === 'folder' && (state.view.value === item.id || descendantIds.includes(state.view.value))) {
            state.view = { type: 'all', value: null };
        }
        await refreshData();
        scheduleDataProtection();
        showToast(t('deleted'));
    });
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
    if (preventMutationDuringSync()) {
        clearDragState();
        return;
    }
    const item = findItem(itemId);
    if (openConflictForItem(item)) {
        clearDragState();
        return;
    }
    if (!item || item.parentId === parentId) {
        clearDragState();
        return;
    }
    if (parentId != null && !canMoveItem(itemId, parentId)) {
        showToast(t('cannotMove'));
        clearDragState();
        return;
    }

    await runUserDataMutation(async () => {
        const updated = toStorageRecord(item);
        updated.parentId = parentId;
        updated.updatedAt = new Date().toISOString();
        updated.modifiedBy = state.sync.deviceId;
        await saveItem(updated);
        clearDragState();
        await refreshData();
        scheduleDataProtection();
        showToast(t(parentId == null ? 'movedRoot' : 'movedFolder'));
    });
}

function clearDragState() {
    state.draggedId = null;
    document.querySelectorAll('.drag-over, .is-dragging').forEach((element) => {
        element.classList.remove('drag-over', 'is-dragging');
    });
}
