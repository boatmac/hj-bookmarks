document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBAL VARIABLES ---
    let db;
    let allBookmarks = [];
    
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
            html += `<li class="${isFolder ? 'tree-item-folder' : 'tree-item-file'}"><div class="item-content" data-id="${node.id}">`;
            html += isFolder ? `<span class="folder-title">${node.title}</span>` : `<a href="${node.url}" target="_blank" rel="noopener noreferrer">${node.title}</a>`;
            html += `<div class="item-actions">`;
            if (!isFolder) html += `<button class="pin-btn ${node.isPinned ? 'pinned' : ''}" title="Pin Item">📌</button>`;
            html += `<button class="delete-btn" title="Delete Item">&times;</button></div></div>`;
            if (isFolder && node.children.length > 0) { 
                html += buildTreeHtml(node.children);
            }
            html += `</li>`;
        }
        return html + '</ul>';
    }
    
    function renderTagsWall(bookmarks) { /* Minimal for now */ }

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
            if (bm.title?.toLowerCase().includes(lowerFilter) || bm.url?.toLowerCase().includes(lowerFilter)) {
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
    }
    
    async function refreshAllData() {
        allBookmarks = await dbOps.getAll();
        renderAll();
    }

    async function handleAddSubmit(e) {
        e.preventDefault();
        const title = document.getElementById('title').value.trim();
        if (!title) { alert("Title is required."); return; }
        await dbOps.add({
            title: title,
            url: document.getElementById('url').value.trim(),
            parentId: ui.parentSelect.value === 'root' ? null : parseInt(ui.parentSelect.value),
            isPinned: false
        });
        ui.form.reset();
        await refreshAllData();
    }

    async function handleTreeClick(e) {
        const itemContent = e.target.closest('.item-content');
        if (!itemContent) return;
        const id = parseInt(itemContent.dataset.id);
        if (e.target.matches('.folder-title')) {
            const childrenList = itemContent.nextElementSibling;
            if (childrenList && childrenList.tagName === 'UL') {
                childrenList.classList.toggle('hidden');
            }
        } else if (e.target.matches('.pin-btn')) {
            const bookmark = allBookmarks.find(bm => bm.id === id);
            if (bookmark) {
                bookmark.isPinned = !bookmark.isPinned;
                await dbOps.update(bookmark);
                await refreshAllData();
            }
        } else if (e.target.matches('.delete-btn')) {
            if (confirm('Delete this item and all its children? This cannot be undone.')) {
                const idsToDelete = [id, ...getAllChildrenIds(id, allBookmarks)];
                await Promise.all(idsToDelete.map(i => dbOps.delete(i)));
                await refreshAllData();
            }
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
