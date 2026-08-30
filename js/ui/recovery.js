/* Recycle bin rendering and recovery operations. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

function renderRecoveryView() {
    const items = getVisibleRecoveryItems();
    ui.recoveryList.replaceChildren();
    ui.pageTitle.textContent = t('recycleBin');
    ui.pageEyebrow.textContent = t('recycleEyebrow');
    ui.pageDescription.textContent = t('recycleDescription');
    ui.resultCount.textContent = String(items.length).padStart(2, '0');
    const summary = t('recycleItemCount', { count: items.length });
    ui.resultsLabel.textContent = state.query
        ? t('searchResults', { query: state.query, summary })
        : t('showResults', { summary });

    if (!items.length) {
        renderEmptyRecoveryState();
        return;
    }

    ui.emptyState.classList.add('hidden');
    ui.recoveryList.append(createRecoveryToolbar(items));
    const grid = createElement('div', 'recovery-grid');
    items.forEach((tombstone) => grid.append(createRecoveryCard(tombstone)));
    ui.recoveryList.append(grid);
}

function getVisibleRecoveryItems() {
    const query = state.query.trim().toLocaleLowerCase(currentLocale());
    const items = state.recycleBin.filter((tombstone) => {
        if (!query) return true;
        const item = tombstone.item;
        return [item.title, item.url, item.description, ...parseTags(item.tags)]
            .some((value) => String(value || '').toLocaleLowerCase(currentLocale()).includes(query));
    });
    return items.slice().sort((left, right) => {
        if (state.sort === 'title') {
            return left.item.title.localeCompare(right.item.title, currentLocale());
        }
        const difference = Date.parse(left.deletedAt) - Date.parse(right.deletedAt);
        return state.sort === 'oldest' ? difference : -difference;
    });
}

function renderEmptyRecoveryState() {
    ui.emptyState.classList.remove('hidden');
    ui.emptyIconUse.setAttribute('href', '#icon-trash');
    ui.emptyTitle.textContent = t('recycleEmptyTitle');
    ui.emptyDescription.textContent = t('recycleEmptyDescription');
    ui.emptyActionIcon.setAttribute('href', '#icon-grid');
    ui.emptyActionLabel.textContent = t('backToBookmarks');
    ui.emptyActionButton.dataset.action = 'all';
}

function createRecoveryToolbar(items) {
    const toolbar = createElement('div', 'recovery-toolbar');
    const visibleIds = items.map((item) => item.syncId);
    const selectedIds = visibleIds.filter((syncId) => state.recoverySelection.has(syncId));
    const selectedCount = selectedIds.length;

    const selectLabel = createElement('label', 'recovery-select-all');
    const checkbox = createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedCount === visibleIds.length && visibleIds.length > 0;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleIds.length;
    checkbox.addEventListener('change', () => {
        visibleIds.forEach((syncId) => {
            if (checkbox.checked) state.recoverySelection.add(syncId);
            else state.recoverySelection.delete(syncId);
        });
        renderRecoveryView();
    });
    selectLabel.append(checkbox, createElement('span', '', t('selectAll')));

    const count = createElement('span', 'recovery-selection-count', t('selectedItems', { count: selectedCount }));
    const actions = createElement('div', 'recovery-batch-actions');
    const restore = createElement('button', 'button button-secondary', t('restoreSelected'));
    restore.type = 'button';
    restore.disabled = selectedCount === 0;
    restore.addEventListener('click', () => restoreDeletedItems(selectedIds));
    const remove = createElement('button', 'button button-danger-quiet', t('deleteSelected'));
    remove.type = 'button';
    remove.disabled = selectedCount === 0;
    remove.addEventListener('click', () => permanentlyDeleteRecoveryItems(selectedIds));
    actions.append(restore, remove);
    toolbar.append(selectLabel, count, actions);
    return toolbar;
}

function createRecoveryCard(tombstone) {
    const item = tombstone.item;
    const folder = !item.url;
    const card = createElement('article', 'recovery-card');
    card.classList.toggle('selected', state.recoverySelection.has(tombstone.syncId));

    const selection = createElement('label', 'recovery-card-select');
    const checkbox = createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.recoverySelection.has(tombstone.syncId);
    checkbox.setAttribute('aria-label', item.title);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.recoverySelection.add(tombstone.syncId);
        else state.recoverySelection.delete(tombstone.syncId);
        renderRecoveryView();
    });
    selection.append(checkbox);

    const icon = createElement('span', 'recovery-card-icon');
    icon.append(createIcon(folder ? 'folder' : 'bookmark', 20));
    const copy = createElement('div', 'recovery-card-copy');
    copy.append(createElement('strong', '', item.title));
    if (item.url) copy.append(createElement('span', 'recovery-card-url', getHostname(item.url)));
    if (item.description) copy.append(createElement('p', '', item.description));
    const tags = createElement('div', 'recovery-card-tags');
    parseTags(item.tags).slice(0, 3).forEach((tag) => tags.append(createElement('span', '', tag)));
    if (tags.childElementCount) copy.append(tags);

    const meta = createElement('div', 'recovery-card-meta');
    meta.append(
        createRecoveryMeta(t('deletedAtLabel'), formatRecoveryDate(tombstone.deletedAt)),
        createRecoveryMeta(t('deletedByLabel'), String(tombstone.modifiedBy || '').slice(0, 8) || t('conflictValueEmpty')),
        createElement('span', 'recovery-expiry', t('expiresInDays', { count: recoveryDaysRemaining(tombstone) })),
    );

    const actions = createElement('div', 'recovery-card-actions');
    const restore = createElement('button', 'button button-secondary compact-button', t('restore'));
    restore.type = 'button';
    restore.addEventListener('click', () => restoreDeletedItems([tombstone.syncId]));
    const remove = createElement('button', 'button button-danger-quiet compact-button', t('permanentlyDelete'));
    remove.type = 'button';
    remove.addEventListener('click', () => permanentlyDeleteRecoveryItems([tombstone.syncId]));
    actions.append(restore, remove);

    card.append(selection, icon, copy, meta, actions);
    return card;
}

function createRecoveryMeta(label, value) {
    const meta = createElement('span');
    meta.append(createElement('small', '', label), createElement('strong', '', value));
    return meta;
}

function formatRecoveryDate(value) {
    if (!validDate(value)) return t('historicalData');
    return new Intl.DateTimeFormat(currentLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}

function recoveryDaysRemaining(tombstone) {
    const expiresAt = Date.parse(tombstone.deletedAt) + RECYCLE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

function expandRecoverySelection(syncIds) {
    const selected = new Set(syncIds);
    const byParent = new Map();
    state.recycleBin.forEach((tombstone) => {
        const parentSyncId = tombstone.item?.parentSyncId || null;
        if (!byParent.has(parentSyncId)) byParent.set(parentSyncId, []);
        byParent.get(parentSyncId).push(tombstone);
    });
    const queue = [...selected];
    while (queue.length) {
        const parent = queue.shift();
        (byParent.get(parent) || []).forEach((child) => {
            if (selected.has(child.syncId)) return;
            selected.add(child.syncId);
            queue.push(child.syncId);
        });
    }
    return [...selected];
}

async function restoreDeletedItems(syncIds) {
    if (preventMutationDuringSync()) return;
    const expandedIds = expandRecoverySelection(syncIds);
    const selected = new Set(expandedIds);
    const items = state.recycleBin
        .filter((tombstone) => selected.has(tombstone.syncId))
        .map((tombstone) => ({ ...tombstone.item, tags: [...parseTags(tombstone.item.tags)] }));
    if (!items.length) return;

    await flushBackupBeforeDestructiveChange();
    await restoreResolvedSyncItems(items);
    expandedIds.forEach((syncId) => state.recoverySelection.delete(syncId));
    await refreshData();
    scheduleDataProtection();
    showToast(t('restoredItems', { count: items.length }));
}

async function permanentlyDeleteRecoveryItems(syncIds) {
    if (preventMutationDuringSync()) return;
    const expandedIds = expandRecoverySelection(syncIds);
    if (!expandedIds.length) return;
    if (!window.confirm(t('confirmPermanentDelete', { count: expandedIds.length }))) return;

    await purgeTombstonePayloads(expandedIds);
    expandedIds.forEach((syncId) => state.recoverySelection.delete(syncId));
    await refreshData();
    scheduleDataProtection();
    showToast(t('permanentlyDeletedItems', { count: expandedIds.length }));
}
