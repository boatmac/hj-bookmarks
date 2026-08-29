document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL VARIABLES ---
    let db;
    let allBookmarks = [];
    let editingId = null;
    
    // UI Elements
    const ui = {
        pinned: document.getElementById('pinned-bookmarks'),
        tree: document.getElementById('bookmarks-tree'),
        tags: document.getElementById('tags-wall'),
        form: document.getElementById('add-form'),
        parentSelect: document.getElementById('parent'),
        searchInput: document.getElementById('search-input'),
        exportBtn: document.getElementById('export-btn'),
        importInput: document.getElementById('import-file-input'),
        clearBtn: document.getElementById('clear-all-btn'),
        addFormTitle: document.getElementById('add-form-title'),
    };

    // ===================================================================================
    //  MAIN INITIALIZATION
    // ===================================================================================

    async function main() {
        try {
            console.log("1. Initializing Database...");
            await initDB();
            console.log("2. Database Initialized. Fetching data...");
            await refreshAllData();
            console.log("3. Data fetched and rendered. Attaching event listeners...");
            attachEventListeners();
            console.log("4. Bookmark manager setup complete.");
        } catch (error) {
            console.error('FATAL INITIALIZATION ERROR:', error);
            document.body.innerHTML = `<div style="text-align:center; padding:50px; color:red;"><h1>Application Error</h1><p>Could not initialize the application. Please check the browser's developer console for details.</p><p><b>Error:</b> ${error.message}</p></div>`;
        }
    }
    
    main();

    // ===================================================================================
    //  DATABASE FUNCTIONS
    // ===================================================================================

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('BookmarkDB_v3', 3);
            request.onerror = e => reject(e.target.error);
            request.onupgradeneeded = e => {
                const store = e.target.result.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
                store.createIndex('parentId', 'parentId', { unique: false });
                store.createIndex('isPinned', 'isPinned', { unique: false });
            };
            request.onsuccess = e => { db = e.target.result; resolve(); };
        });
    }

    const dbOps = {
        getStore: (mode) => db.transaction('bookmarks', mode, {durability: "relaxed"}).objectStore('bookmarks'),
        wrap: (request) => new Promise((resolve, reject) => {
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e.target.error);
        }),
        getAll: function() { return this.wrap(this.getStore('readonly').getAll()) },
        add: function(item) { return this.wrap(this.getStore('readwrite').add(item)) },
        update: function(item) { return this.wrap(this.getStore('readwrite').put(item)) },
        delete: function(id) { return this.wrap(this.getStore('readwrite').delete(id)) },
        clear: function() { return this.wrap(this.getStore('readwrite').clear()) },
    };

    // ===================================================================================
    //  RENDERING LOGIC
    // ===================================================================================

    function renderAll() {
        const filter = ui.searchInput.value.toLowerCase();
        const filteredBookmarks = filterBookmarks(allBookmarks, filter);
        renderPinnedBookmarks(allBookmarks);
        renderBookmarksTree(filteredBookmarks);
        renderTagsWall(allBookmarks);
        updateParentCategoryDropdown(allBookmarks);
    }
    
    function renderPinnedBookmarks(bookmarks) {
        const pinned = bookmarks.filter(bm => bm.isPinned && bm.url);
        ui.pinned.innerHTML = pinned.length > 0 ? pinned.map(bm => `<div class="pinned-item"><a href="${bm.url}" target="_blank" rel="noopener noreferrer">${bm.title}</a></div>`).join('') : '<p>Click the 📌 icon on an item to pin it here.</p>';
    }

    function renderBookmarksTree(bookmarks) {
        const map = new Map(bookmarks.map(bm => [bm.id, { ...bm, children: [] }]));
        const tree = [];
        for (const item of map.values()) {
            if (item.parentId && map.has(item.parentId)) {
                map.get(item.parentId).children.push(item);
            } 
            else { 
                tree.push(item);
            }
        }
        ui.tree.innerHTML = tree.length > 0 ? buildTreeHtml(tree) : '<p>No bookmarks found. Add one or import from a file.</p>';
    }

    function buildTreeHtml(nodes) {
        let html = '<ul>';
        nodes.sort((a, b) => {
            if (!a.url && b.url) return -1;
            if (a.url && !b.url) return 1;
            return a.title.localeCompare(b.title);
        });
        for (const node of nodes) {
            const isFolder = !node.url;
            html += `<li class="${isFolder ? 'tree-item-folder' : 'tree-item-file'}"><div class="item-content" data-id="${node.id}" draggable="true">`;
            html += isFolder
                ? `<span class="folder-title" style="cursor:pointer;">${node.title}</span>`
                : `<a href="${node.url}" target="_blank" rel="noopener noreferrer">${node.title}</a>`;
            // Show tags for bookmarks
            if (!isFolder && node.tags) {
                node.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
                    html += ` <span class="tag" style="color:#888;font-size:0.9em;cursor:pointer;">${tag}</span>`;
                });
            }
            html += `<div class="item-actions">`;
            if (!isFolder) html += `<button class="pin-btn ${node.isPinned ? 'pinned' : ''}" title="Pin Item">📌</button>`;
            html += `<button class="delete-btn" title="Delete Item">&times;</button></div></div>`;
            if (isFolder && node.children.length > 0) {
                html += `<ul${node.collapsed ? ' class="hidden"' : ''}>${buildTreeHtml(node.children)}</ul>`;
            }
            html += `</li>`;
        }
        return html + '</ul>';
    }
    
    function renderTagsWall(bookmarks) {
        // Simple tag wall: show all unique tags
        const tags = new Set();
        for (const bm of bookmarks) {
            if (bm.tags) {
                bm.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
            }
        }
        ui.tags.innerHTML = tags.size
            ? Array.from(tags).map(tag => `<span class="tag">${tag}</span>`).join(' ')
            : '<span style="color:#888;">No tags yet.</span>';
    }

    function updateParentCategoryDropdown(bookmarks) {
        const folders = bookmarks.filter(bm => !bm.url);
        const folderMap = new Map(folders.map(f => [f.id, f]));
        const getFolderPath = (folderId) => {
            let pathParts = [];
            let current = folderMap.get(folderId);
            while (current) {
                pathParts.unshift(current.title);
                current = current.parentId ? folderMap.get(current.parentId) : null;
            }
            return `/ ${pathParts.join(' / ')}`;
        };
        let optionsHtml = '<option value="root">/ (Root)</option>';
        optionsHtml += folders.map(f => `<option value="${f.id}">${getFolderPath(f.id)}</option>`).join('');
        ui.parentSelect.innerHTML = optionsHtml;
    }

    function filterBookmarks(bookmarks, filter) {
        if (!filter) return bookmarks;
        const lowerFilter = filter.toLowerCase();
        const matchedIds = new Set();
        const bookmarkMap = new Map(bookmarks.map(bm => [bm.id, bm]));
        for (const bm of bookmarks) {
            // Check title and url as substring
            const titleMatch = bm.title?.toLowerCase().includes(lowerFilter);
            const urlMatch = bm.url?.toLowerCase().includes(lowerFilter);
            // Check tags as exact match for any tag
            let tagMatch = false;
            if (bm.tags) {
                tagMatch = bm.tags
                    .split(',')
                    .map(t => t.trim().toLowerCase())
                    .includes(lowerFilter);
            }
            if (titleMatch || urlMatch || tagMatch) {
                matchedIds.add(bm.id);
                let current = bm;
                while (current && current.parentId) {
                    matchedIds.add(current.parentId);
                    current = bookmarkMap.get(current.parentId);
                }
            }
        }
        return bookmarks.filter(bm => matchedIds.has(bm.id));
    }

    // ===================================================================================
    //  EVENT HANDLERS & LOGIC
    // ===================================================================================

    function attachEventListeners() {
        ui.form.addEventListener('submit', handleAddSubmit);
        ui.tree.addEventListener('click', handleTreeClick);
        ui.searchInput.addEventListener('input', () => renderAll());
        ui.exportBtn.addEventListener('click', handleExport);
        ui.importInput.addEventListener('change', handleImport);
        ui.clearBtn.addEventListener('click', handleClearAll);
        ui.tree.addEventListener('dragstart', e => {
            const item = e.target.closest('.item-content');
            if (item) e.dataTransfer.setData('text/plain', item.dataset.id);
        });
        // Allow dropping onto folders and the empty tree area (for root)
        ui.tree.addEventListener('dragover', e => {
            const item = e.target.closest('.item-content');
            // Allow drop if over a folder, or over the tree container itself (for root)
            if (
                (item && !allBookmarks.find(bm => bm.id === parseInt(item.dataset.id))?.url) ||
                (!item && e.target === ui.tree)
            ) {
                e.preventDefault();
            }
        });
        ui.tree.addEventListener('dragenter', e => {
            const item = e.target.closest('.item-content');
            if (item && !allBookmarks.find(bm => bm.id === parseInt(item.dataset.id))?.url) {
                item.classList.add('drag-over');
            }
        });
        ui.tree.addEventListener('dragleave', e => {
            const item = e.target.closest('.item-content');
            if (item) item.classList.remove('drag-over');
        });
        ui.tree.addEventListener('drop', async e => {
            const item = e.target.closest('.item-content');
            if (item) item.classList.remove('drag-over');
            e.preventDefault();
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            const dragged = allBookmarks.find(bm => bm.id === draggedId);
            if (!dragged) return;

            let newParentId = null;

            if (item) {
                const targetId = parseInt(item.dataset.id);
                const targetBm = allBookmarks.find(bm => bm.id === targetId);
                // Only allow dropping onto folders
                if (!targetBm || targetBm.url) return;
                // Prevent moving into itself or its descendants
                if (draggedId === targetId || getAllChildrenIds(draggedId, allBookmarks).includes(targetId)) return;
                newParentId = targetId;
            }
            // If dropped on tree container (not on an item), move to root
            dragged.parentId = newParentId;
            await dbOps.update(dragged);
            await refreshAllData();
        });
        ui.tags.addEventListener('click', e => {
            if (e.target.classList.contains('tag')) {
                const tag = e.target.textContent.trim();
                ui.searchInput.value = tag;
                renderAll();
            }
        });
    }
    
    async function refreshAllData() {
        allBookmarks = await dbOps.getAll();
        renderAll();
    }

    async function handleAddSubmit(e) {
        e.preventDefault();
        const title = document.getElementById('title').value.trim();
        if (!title) { alert("Title is required."); return; }
        const url = document.getElementById('url').value.trim();
        const tags = document.getElementById('tags').value.trim();
        const parentId = ui.parentSelect.value === 'root' ? null : parseInt(ui.parentSelect.value);

        if (editingId) {
            // Update existing
            const bm = allBookmarks.find(bm => bm.id === editingId);
            bm.title = title;
            bm.url = url;
            bm.tags = tags;
            bm.parentId = parentId;
            await dbOps.update(bm);
            editingId = null;
            ui.form.querySelector('button[type="submit"]').textContent = 'Add Item';
            ui.addFormTitle.textContent = 'Add New'; // <-- Reset section title
        } else {
            // Add new
            await dbOps.add({ title, url, tags, parentId, isPinned: false });
        }
        ui.form.reset();
        await refreshAllData();
    }

    async function handleTreeClick(e) {
        const itemContent = e.target.closest('.item-content');
        if (!itemContent) return;
        const id = parseInt(itemContent.dataset.id);
        const bookmark = allBookmarks.find(bm => bm.id === id);
        if (!bookmark) return;

        // If not clicking on a button or title, enter edit mode
        if (!e.target.matches('.folder-title,.pin-btn,.delete-btn,.move-btn,.edit-btn')) {
            editingId = id;
            document.getElementById('title').value = bookmark.title;
            document.getElementById('url').value = bookmark.url || '';
            document.getElementById('tags').value = bookmark.tags || '';
            ui.parentSelect.value = bookmark.parentId ?? 'root';
            ui.form.querySelector('button[type="submit"]').textContent = 'Update Item';
            ui.addFormTitle.textContent = 'Update Item'; // <-- Change section title
            return;
        }

        if (e.target.matches('.folder-title')) {
            const childrenList = itemContent.nextElementSibling;
            if (childrenList && childrenList.tagName === 'UL') {
                childrenList.classList.toggle('hidden');
                // Optionally persist collapse state in DB
                bookmark.collapsed = childrenList.classList.contains('hidden');
                await dbOps.update(bookmark);
            }
        } else if (e.target.matches('.pin-btn')) {
            bookmark.isPinned = !bookmark.isPinned;
            await dbOps.update(bookmark);
            await refreshAllData();
        } else if (e.target.matches('.delete-btn')) {
            if (confirm('Delete this item and all its children? This cannot be undone.')) {
                const idsToDelete = [id, ...getAllChildrenIds(id, allBookmarks)];
                await Promise.all(idsToDelete.map(i => dbOps.delete(i)));
                await refreshAllData();
            }
        } else if (e.target.matches('.move-btn')) {
            // Move to another folder/root
            const folders = allBookmarks.filter(bm => !bm.url && bm.id !== id && !getAllChildrenIds(id, allBookmarks).includes(bm.id));
            const folderOptions = folders.map(f => `${f.id}: ${f.title}`).join('\n');
            const newParent = prompt(
                `Enter new parent folder ID (or "root" for top-level):\n${folderOptions}`,
                bookmark.parentId ?? 'root'
            );
            if (newParent === null) return;
            bookmark.parentId = newParent === 'root' ? null : parseInt(newParent);
            await dbOps.update(bookmark);
            await refreshAllData();
        } else if (e.target.matches('.edit-btn')) {
            // Edit title, url, tags
            const newTitle = prompt('Edit title:', bookmark.title);
            if (newTitle === null) return;
            let newUrl = bookmark.url;
            if (bookmark.url !== undefined) {
                newUrl = prompt('Edit URL:', bookmark.url) ?? bookmark.url;
            }
            const newTags = prompt('Edit tags (comma separated):', bookmark.tags ?? '') ?? (bookmark.tags ?? '');
            bookmark.title = newTitle;
            bookmark.url = newUrl;
            bookmark.tags = newTags;
            await dbOps.update(bookmark);
            await refreshAllData();
        }
    }

    function handleExport() {
        if (allBookmarks.length === 0) return alert('No bookmarks to export.');
        const blob = new Blob([JSON.stringify(allBookmarks, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: `bookmarks-backup-${new Date().toISOString().slice(0,10)}.json` });
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    // --- REWRITTEN IMPORT LOGIC (v6 - Definitive) ---
    async function handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!confirm(`DANGER! This will clear ALL existing bookmarks and import from '${file.name}'. This action cannot be undone. Continue?`)) {
            ui.importInput.value = '';
            return;
        }
        
        try {
            console.log("--- Starting Import Process v6 ---");
            document.body.style.cursor = 'wait';
            
            await dbOps.clear();
            allBookmarks = [];

            const content = await file.text();
            const doc = new DOMParser().parseFromString(content, 'text/html');

            // Always process the first <DL> as the root container
            const rootEl = doc.querySelector('dl');
            if (!rootEl) {
                alert('Import failed: Could not find a valid <DL> element in the file.');
                console.error("Import Aborted: No '<dl>' element found.");
                return;
            }
            console.log("Importing everything under the first <DL> as root...");
            await processContainer(rootEl, null);

            alert(`Import successful!`);
            await refreshAllData();

        } catch (error) {
            console.error("A critical error occurred during import:", error);
            alert("A critical error occurred during import. Please check the developer console for details.");
        } finally {
            ui.importInput.value = '';
            document.body.style.cursor = 'default';
            console.log("--- Import Process Finished ---");
        }
    }

    /**
     * The definitive, robust, recursive function for processing bookmark containers.
     * Uses a `while` loop to reliably traverse sibling nodes.
     * @param {HTMLElement} container - The element whose children need to be processed (e.g., a <DL> or <P>).
     * @param {number|null} parentId - The database ID of the parent folder for the items in this container.
     */
    async function processContainer(container, parentId) {
        let node = container.firstElementChild;
        while (node) {
            const nodeName = node.tagName;

            if (nodeName === 'P') {
                await processContainer(node, parentId);
                node = node.nextElementSibling;
            } else if (nodeName === 'DT') {
                const folderHeader = node.querySelector('h3');
                const link = node.querySelector('a');

                if (folderHeader) {
                    const title = folderHeader.textContent.trim();
                    console.log(`-> FOLDER: "${title}" (Parent ID: ${parentId})`);
                    const newFolderId = await dbOps.add({ title, url: '', parentId, isPinned: false });

                    // The folder's content is in a <DL> child node, not a sibling
                    const childDL = node.querySelector('dl');
                    if (childDL) {
                        await processContainer(childDL, newFolderId);
                    }
                } else if (link) {
                    const title = link.textContent.trim() || link.href;
                    console.log(`-> BOOKMARK: "${title}" (Parent ID: ${parentId})`);
                    await dbOps.add({ title, url: link.href, parentId, isPinned: false });
                }
                node = node.nextElementSibling;
            } else {
                node = node.nextElementSibling;
            }
        }
    }
    
    async function handleClearAll() {
        if (confirm('DANGER! This will delete ALL bookmarks. Are you sure? This cannot be undone.')) {
            await dbOps.clear();
            await refreshAllData();
        }
    }

    function getAllChildrenIds(parentId, bookmarks) {
        const children = bookmarks.filter(bm => bm.parentId === parentId);
        return children.reduce((acc, child) => [...acc, child.id, ...getAllChildrenIds(child.id, bookmarks)], []);
    }
});
