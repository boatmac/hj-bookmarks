(() => {
    'use strict';

    const DB_NAME = 'BookmarkDB_v3';
    const DB_VERSION = 6;
    const STORE_NAME = 'bookmarks';
    const SETTINGS_STORE_NAME = 'settings';
    const TOMBSTONE_STORE_NAME = 'tombstones';
    const BACKUP_HANDLE_KEY = 'backup-directory-handle';
    const BACKUP_PREFERENCES_KEY = 'backup-preferences';
    const SYNC_PREFERENCES_KEY = 'webdav-sync-preferences';
    const DEVICE_ID_KEY = 'sync-device-id';
    const SYNC_FILE_NAME = 'bookmarks-sync.enc.json';
    const PBKDF2_ITERATIONS = 250000;
    const THEME_KEY = 'bookmark-manager.theme';
    const SORT_KEY = 'bookmark-manager.sort';
    const LANGUAGE_KEY = 'bookmark-manager.language';
    const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:']);

    const TRANSLATIONS = {
        zh: {
            documentTitle: '书签库 · 本地书签管理器',
            metaDescription: '无需安装、数据留在本地的纯前端书签管理器。',
            sidebarLabel: '侧边栏',
            brandName: '书签库',
            brandSubtitle: '本地书签',
            primaryViewsLabel: '主要视图',
            allBookmarks: '全部书签',
            favorites: '我的收藏',
            folders: '文件夹',
            tags: '标签',
            newFolder: '新建文件夹',
            storageTooltip: '书签数据保存在当前浏览器的 IndexedDB 中',
            localOnly: '仅存储在此设备',
            connectingDatabase: '正在连接本地数据库…',
            languageTitle: '界面语言',
            themeToggle: '切换显示主题',
            closeSidebar: '关闭侧边栏',
            openSidebar: '打开侧边栏',
            searchBookmarks: '搜索书签',
            searchPlaceholder: '搜索标题、网址、描述或标签……',
            clearSearch: '清除搜索',
            importTooltip: '合并导入 JSON 或浏览器书签 HTML',
            import: '导入',
            exportTooltip: '导出备份',
            export: '导出',
            jsonBackup: 'JSON 备份',
            jsonBackupDescription: '保留全部应用数据',
            browserHtml: '浏览器 HTML',
            browserHtmlDescription: '可导入其他浏览器',
            automaticBackup: '自动本地备份',
            backupEyebrow: '数据保护',
            backupSettings: '自动备份设置',
            automaticBackupHint: '每次数据变化后自动更新最新备份并创建历史快照',
            backupDirectory: '备份目录',
            chooseFolder: '选择目录',
            historyRetention: '历史快照',
            historyRetentionHint: '自动清理更早的快照，最新备份始终保留',
            keep7Snapshots: '保留 7 份',
            keep30Snapshots: '保留 30 份',
            keep90Snapshots: '保留 90 份',
            lastBackup: '最近备份',
            persistentStorage: '浏览器持久存储',
            requestAgain: '重新请求',
            backupCompatibility: '自动写入目录需要 Edge 或 Chrome。其他浏览器仍可使用 JSON 手动导出。',
            disconnectBackup: '断开备份目录',
            backupNow: '立即备份',
            backupNotSelected: '尚未选择',
            lastBackupNever: '从未备份',
            persistenceChecking: '正在检查…',
            persistenceGranted: '已获得持久存储保护',
            persistenceNotGranted: '未获授权，浏览器仍可能清理站点数据',
            persistenceUnsupported: '当前浏览器不支持持久存储请求',
            backupMenuUnsupported: '仅支持手动导出',
            backupMenuNotConfigured: '尚未设置',
            backupMenuPaused: '自动备份已暂停',
            backupMenuPermission: '需要重新授权',
            backupMenuRunning: '正在备份…',
            backupMenuError: '上次备份失败',
            backupMenuReady: ({ time }) => time ? `上次：${time}` : '已启用',
            backupUnsupportedTitle: '当前浏览器不支持自动目录备份',
            backupUnsupportedDetail: '你仍可从导出菜单下载 JSON 备份。',
            backupNotConfiguredTitle: '尚未设置备份目录',
            backupNotConfiguredDetail: '选择一个本地文件夹后，数据变更时会自动写入备份。',
            backupPausedTitle: '自动备份已暂停',
            backupPausedDetail: '已有备份目录，开启开关即可继续自动备份。',
            backupPermissionTitle: '需要重新授权备份目录',
            backupPermissionDetail: '浏览器重启后可能需要再次确认权限；点击“立即备份”即可重新授权。',
            backupReadyTitle: '自动备份运行正常',
            backupReadyDetail: ({ name }) => `备份将写入“${name}”目录。`,
            backupRunningTitle: '正在写入备份',
            backupRunningDetail: '正在更新最新文件并创建历史快照…',
            backupErrorTitle: '上次备份失败',
            backupErrorDetail: ({ message }) => message || '请检查目录写入权限后重试。',
            backupPermissionDenied: '未获得备份目录写入权限',
            backupFolderSelected: ({ name }) => `已选择备份目录：${name}`,
            backupComplete: ({ count }) => `备份完成，共 ${count} 项`,
            backupUpToDate: '当前数据已经是最新备份',
            backupFailed: ({ message }) => `备份失败：${message}`,
            backupDisconnected: '已断开备份目录',
            confirmDisconnect: '确定断开当前备份目录吗？已有备份文件不会被删除。',
            autoBackupEnabled: '自动备份已开启',
            autoBackupPaused: '自动备份已暂停',
            persistenceGrantedToast: '浏览器持久存储保护已开启',
            persistenceDeniedToast: '浏览器未授予持久存储权限',
            backupHandleNotRemembered: '目录已可用于当前会话，但浏览器无法记住它；下次打开需要重新选择。',
            encryptedWebDavSync: 'WebDAV 加密同步',
            syncEyebrow: '跨设备同步',
            syncSettings: 'WebDAV 加密同步',
            webDavUrl: 'WebDAV 地址',
            webDavUrlHint: '可填写目录或完整 JSON 文件地址',
            webDavUrlPlaceholder: 'https://dav.example.com/bookmarks/',
            webDavUsername: '用户名',
            webDavUsernameHint: '地址和用户名会保存在本机',
            webDavPassword: '密码或应用密码',
            sessionOnly: '仅保留在当前页面内存中',
            encryptionPassphrase: '加密口令',
            encryptionPassphraseHint: '至少 8 个字符；遗失后无法解密远端数据',
            automaticSync: '页面打开时自动同步',
            automaticSyncHint: '解锁成功后，数据变化会自动同步至 WebDAV',
            lastSync: '最近同步',
            syncSecurityNote: '远端文件使用 PBKDF2 + AES-GCM 加密。WebDAV 密码和加密口令不会持久保存，重新打开页面后需要再次输入。',
            syncCorsNote: '跨域 WebDAV 必须允许 Origin、Authorization、GET、PUT 和条件请求标头；从本地文件打开时 Origin 通常为 null。',
            disconnectSync: '移除同步配置',
            syncNow: '立即同步',
            syncLastNever: '从未同步',
            syncMenuUnsupported: '当前环境不支持加密同步',
            syncMenuNotConfigured: '尚未设置',
            syncMenuLocked: '等待输入凭据',
            syncMenuRunning: '正在同步…',
            syncMenuError: '上次同步失败',
            syncMenuReady: ({ time }) => time ? `上次：${time}` : '已解锁',
            syncUnsupportedTitle: '当前环境不支持加密同步',
            syncUnsupportedDetail: '需要支持 Web Crypto 和 Fetch API 的现代浏览器。',
            syncNotConfiguredTitle: '尚未配置 WebDAV',
            syncNotConfiguredDetail: '填写远端地址和凭据后即可进行加密同步。',
            syncLockedTitle: '同步配置等待解锁',
            syncLockedDetail: '请输入 WebDAV 密码和加密口令，然后点击“立即同步”。',
            syncReadyTitle: 'WebDAV 同步已解锁',
            syncReadyDetail: '本页保持打开时，书签变更可以自动同步。',
            syncRunningTitle: '正在进行加密同步',
            syncRunningDetail: '正在读取远端数据、合并更改并安全写回…',
            syncErrorTitle: '上次同步失败',
            syncErrorDetail: ({ message }) => message || '请检查地址、凭据和 WebDAV 跨域配置。',
            syncUrlRequired: '请输入 WebDAV 地址。',
            syncUrlInvalid: '请输入有效的 http 或 https WebDAV 地址。',
            syncPasswordRequired: '填写用户名时必须输入密码或应用密码。',
            syncPassphraseRequired: '请输入至少 8 个字符的加密口令。',
            syncAuthFailed: 'WebDAV 身份验证失败，请检查用户名和密码。',
            syncNetworkError: '无法连接 WebDAV。请检查网络、证书及 CORS 设置。',
            syncReadFailed: ({ status }) => `读取远端文件失败（HTTP ${status}）。`,
            syncWriteFailed: ({ status }) => `写入远端文件失败（HTTP ${status}）。`,
            syncConflictRetryFailed: '远端文件在同步期间持续变化，请稍后重试。',
            syncDecryptFailed: '无法解密远端文件，请确认加密口令是否正确。',
            syncRemoteInvalid: '远端同步文件格式不正确。',
            syncComplete: ({ items, deleted }) => `同步完成：${items} 项，${deleted} 个删除记录`,
            syncFailed: ({ message }) => `同步失败：${message}`,
            syncAutoEnabled: '自动同步已开启；本次会话解锁后将自动运行',
            syncAutoPaused: '自动同步已暂停',
            syncDisconnected: '同步配置已移除，远端文件未被删除',
            confirmDisconnectSync: '确定移除本机的 WebDAV 同步配置吗？远端加密文件不会被删除。',
            syncSecretsSessionOnly: '敏感凭据只在本次页面打开期间使用',
            clearAll: '清空全部数据',
            irreversible: '此操作无法撤销',
            addBookmark: '添加书签',
            folderPathLabel: '文件夹路径',
            allDescription: '把散落在各处的好内容，整理成自己的知识入口。',
            eyebrowAll: '个人收藏库',
            eyebrowFavorites: '收藏',
            eyebrowTag: '标签合集',
            eyebrowFolder: '文件夹',
            itemsLabel: '项目',
            foundLabel: '找到',
            sort: '排序',
            newest: '最近添加',
            oldest: '最早添加',
            sortByTitle: '按标题',
            initialResults: '显示 0 条书签',
            bookmarksLabel: '书签',
            emptyFirstTitle: '从第一条书签开始',
            emptyFirstDescription: '所有数据只保存在你的浏览器中。',
            close: '关闭',
            fieldTitle: '标题',
            titlePlaceholder: '例如：设计灵感合集',
            fieldUrl: '链接',
            urlHint: '可以省略 https://；仅允许常规网页及本地文件链接',
            fieldDescription: '描述',
            descriptionPlaceholder: '写下一句备注，方便以后找到它……',
            parentFolder: '上级文件夹',
            fieldTags: '标签',
            tagsPlaceholder: '设计, 工具, 稍后阅读',
            tagsHint: '用逗号分隔多个标签',
            addFavorite: '加入收藏',
            favoriteHint: '在收藏视图中快速访问',
            cancel: '取消',
            dbConnected: 'IndexedDB 已连接',
            dbUnavailable: '当前浏览器不支持 IndexedDB。',
            dbOpenFailed: '无法打开本地数据库。',
            dbBlocked: '数据库升级被其他页面阻止，请关闭其他书签管理器页面后重试。',
            deleteCanceled: '删除操作已取消。',
            importTransactionFailed: '导入事务失败。',
            importTransactionCanceled: '导入事务已取消。',
            storageStatus: ({ count }) => `IndexedDB · ${count} 项`,
            untitled: '未命名',
            noFolders: '还没有文件夹',
            noTags: '添加标签后会显示在这里',
            expandFolder: '展开文件夹',
            collapseFolder: '折叠文件夹',
            editItem: ({ title }) => `编辑 ${title}`,
            deleteItem: ({ title }) => `删除 ${title}`,
            openItem: ({ title }) => `打开 ${title}`,
            breadcrumbAll: '全部',
            favoritesDescription: '留住你最常使用和最值得回看的链接。',
            tagDescription: ({ tag }) => `收录在“${tag}”标签下的链接。`,
            folderFallback: '文件夹',
            folderDescription: '浏览并整理这个文件夹中的内容。',
            folderCount: ({ count }) => `${count} 个文件夹`,
            bookmarkCount: ({ count }) => `${count} 条书签`,
            searchResults: ({ query, summary }) => `“${query}”的结果：${summary}`,
            showResults: ({ summary }) => `显示 ${summary}`,
            folderMeta: ({ folders, bookmarks }) => `${folders} 个文件夹 · ${bookmarks} 条书签`,
            unfavorite: '取消收藏',
            favorite: '加入收藏',
            unsupportedLink: '这个链接使用了不受支持的协议，请编辑后再打开',
            invalidLink: '无效链接',
            emptyNoMatch: '没有找到匹配的内容',
            emptyTryAgain: '试试其他关键词，或清除当前筛选条件。',
            clearFilters: '清除筛选',
            emptyLocalDescription: '数据保存在浏览器中，不需要服务器或账号。',
            dialogEditFolder: '编辑文件夹',
            dialogEditBookmark: '编辑书签',
            dialogAddFolder: '添加新文件夹',
            dialogAddBookmark: '添加新书签',
            eyebrowEditFolder: '编辑文件夹',
            eyebrowEditBookmark: '编辑书签',
            eyebrowAddFolder: '新建文件夹',
            eyebrowAddBookmark: '新建书签',
            saveChanges: '保存修改',
            addFolder: '添加文件夹',
            rootFolder: '/ 根目录',
            titleRequired: '请输入标题。',
            folderCycle: '文件夹不能移动到自身或其子文件夹中。',
            saved: '修改已保存',
            folderAdded: '文件夹已添加',
            bookmarkAdded: '书签已添加',
            saveFailed: '保存失败，请检查浏览器是否允许本地存储。',
            favoriteAdded: '已加入收藏',
            favoriteRemoved: '已取消收藏',
            confirmDelete: ({ title, count }) => `确定删除“${title}”${count ? `及其中的 ${count} 个项目` : ''}吗？此操作无法撤销。`,
            deleted: '已删除',
            cannotMove: '不能移动到这个文件夹',
            movedRoot: '已移动到根目录',
            movedFolder: '已移动到文件夹',
            reusedFolders: ({ count }) => `复用 ${count} 个文件夹`,
            skippedItems: ({ count }) => `跳过 ${count} 项`,
            imported: ({ count, details }) => `已导入 ${count} 项${details ? `，${details}` : ''}`,
            importFailed: ({ message }) => `导入失败：${message}`,
            jsonInvalid: 'JSON 文件格式不正确',
            jsonArrayMissing: '文件中没有可识别的书签数组',
            noValidItems: '没有找到有效的书签或文件夹',
            browserHtmlInvalid: '这不是有效的浏览器书签 HTML 文件',
            unnamedFolder: '未命名文件夹',
            unnamedBookmark: '未命名书签',
            htmlNoItems: 'HTML 文件中没有可导入的内容',
            exportedJson: ({ count }) => `已导出 ${count} 项 JSON 数据`,
            exportedHtml: ({ count }) => `已导出 ${count} 项浏览器书签`,
            nothingToClear: '当前没有可清空的数据',
            confirmClear: '确定清空全部书签和文件夹吗？建议先导出 JSON 备份。此操作无法撤销。',
            cleared: '全部数据已清空',
            urlRequired: '请输入链接。',
            urlInvalid: '请输入有效的链接。',
            urlProtocol: '仅支持 http、https、ftp 或本地文件链接。',
            localFile: '本地文件',
            historicalData: '历史数据',
            dbConnectionFailed: '本地数据库连接失败',
            fatalTitle: '无法打开本地数据库',
            fatalHint: '请使用最新版 Edge、Chrome、Firefox 或 Safari 打开本页面。',
            listSeparator: '，',
        },
        en: {
            documentTitle: 'Bookmarks · Local Bookmark Manager',
            metaDescription: 'A zero-install, local-first bookmark manager built with browser-native technologies.',
            sidebarLabel: 'Sidebar',
            brandName: 'Bookmarks',
            brandSubtitle: 'LOCAL BOOKMARKS',
            primaryViewsLabel: 'Primary views',
            allBookmarks: 'All bookmarks',
            favorites: 'Favorites',
            folders: 'Folders',
            tags: 'Tags',
            newFolder: 'New folder',
            storageTooltip: 'Bookmarks are stored in IndexedDB in this browser',
            localOnly: 'Stored on this device',
            connectingDatabase: 'Connecting to local database…',
            languageTitle: 'Interface language',
            themeToggle: 'Toggle color theme',
            closeSidebar: 'Close sidebar',
            openSidebar: 'Open sidebar',
            searchBookmarks: 'Search bookmarks',
            searchPlaceholder: 'Search titles, URLs, descriptions, or tags…',
            clearSearch: 'Clear search',
            importTooltip: 'Merge a JSON backup or browser bookmark HTML',
            import: 'Import',
            exportTooltip: 'Export backup',
            export: 'Export',
            jsonBackup: 'JSON backup',
            jsonBackupDescription: 'Preserves all application data',
            browserHtml: 'Browser HTML',
            browserHtmlDescription: 'Import into another browser',
            automaticBackup: 'Automatic local backup',
            backupEyebrow: 'DATA PROTECTION',
            backupSettings: 'Automatic backup settings',
            automaticBackupHint: 'Update the latest backup and create a snapshot after every data change',
            backupDirectory: 'Backup folder',
            chooseFolder: 'Choose folder',
            historyRetention: 'History snapshots',
            historyRetentionHint: 'Older snapshots are removed automatically; the latest backup is always kept',
            keep7Snapshots: 'Keep 7',
            keep30Snapshots: 'Keep 30',
            keep90Snapshots: 'Keep 90',
            lastBackup: 'Last backup',
            persistentStorage: 'Persistent browser storage',
            requestAgain: 'Request again',
            backupCompatibility: 'Automatic folder writes require Edge or Chrome. Other browsers can still export JSON manually.',
            disconnectBackup: 'Disconnect folder',
            backupNow: 'Back up now',
            backupNotSelected: 'Not selected',
            lastBackupNever: 'Never',
            persistenceChecking: 'Checking…',
            persistenceGranted: 'Protected by persistent browser storage',
            persistenceNotGranted: 'Not granted; the browser may still clear site data',
            persistenceUnsupported: 'Persistent storage requests are not supported',
            backupMenuUnsupported: 'Manual export only',
            backupMenuNotConfigured: 'Not configured',
            backupMenuPaused: 'Automatic backup paused',
            backupMenuPermission: 'Permission required',
            backupMenuRunning: 'Backing up…',
            backupMenuError: 'Last backup failed',
            backupMenuReady: ({ time }) => time ? `Last: ${time}` : 'Enabled',
            backupUnsupportedTitle: 'Automatic folder backup is not supported',
            backupUnsupportedDetail: 'You can still download JSON backups from the Export menu.',
            backupNotConfiguredTitle: 'No backup folder selected',
            backupNotConfiguredDetail: 'Choose a local folder to automatically back up every data change.',
            backupPausedTitle: 'Automatic backup is paused',
            backupPausedDetail: 'A backup folder is available. Turn the switch on to resume automatic backups.',
            backupPermissionTitle: 'Backup folder permission is required',
            backupPermissionDetail: 'The browser may require permission again after a restart; click “Back up now” to reauthorize.',
            backupReadyTitle: 'Automatic backup is running',
            backupReadyDetail: ({ name }) => `Backups will be written to “${name}”.`,
            backupRunningTitle: 'Writing backup',
            backupRunningDetail: 'Updating the latest file and creating a history snapshot…',
            backupErrorTitle: 'The last backup failed',
            backupErrorDetail: ({ message }) => message || 'Check folder write permission and try again.',
            backupPermissionDenied: 'Write permission for the backup folder was not granted',
            backupFolderSelected: ({ name }) => `Backup folder selected: ${name}`,
            backupComplete: ({ count }) => `Backup complete: ${count} item${count === 1 ? '' : 's'}`,
            backupUpToDate: 'The current data is already backed up',
            backupFailed: ({ message }) => `Backup failed: ${message}`,
            backupDisconnected: 'Backup folder disconnected',
            confirmDisconnect: 'Disconnect the current backup folder? Existing backup files will not be deleted.',
            autoBackupEnabled: 'Automatic backup enabled',
            autoBackupPaused: 'Automatic backup paused',
            persistenceGrantedToast: 'Persistent browser storage enabled',
            persistenceDeniedToast: 'The browser did not grant persistent storage',
            backupHandleNotRemembered: 'The folder is available for this session, but the browser could not remember it. Select it again next time.',
            encryptedWebDavSync: 'Encrypted WebDAV sync',
            syncEyebrow: 'CROSS-DEVICE SYNC',
            syncSettings: 'Encrypted WebDAV sync',
            webDavUrl: 'WebDAV URL',
            webDavUrlHint: 'Enter a folder URL or the complete JSON file URL',
            webDavUrlPlaceholder: 'https://dav.example.com/bookmarks/',
            webDavUsername: 'Username',
            webDavUsernameHint: 'The URL and username are stored on this device',
            webDavPassword: 'Password or app password',
            sessionOnly: 'Kept in memory for this page session only',
            encryptionPassphrase: 'Encryption passphrase',
            encryptionPassphraseHint: 'At least 8 characters; remote data cannot be recovered if this is lost',
            automaticSync: 'Sync automatically while open',
            automaticSyncHint: 'After unlocking, data changes are synchronized to WebDAV automatically',
            lastSync: 'Last sync',
            syncSecurityNote: 'Remote data is encrypted with PBKDF2 + AES-GCM. The WebDAV password and encryption passphrase are never persisted and must be entered again after reopening the page.',
            syncCorsNote: 'Cross-origin WebDAV must allow Origin, Authorization, GET, PUT, and conditional request headers. Pages opened from a local file usually send Origin: null.',
            disconnectSync: 'Remove sync configuration',
            syncNow: 'Sync now',
            syncLastNever: 'Never',
            syncMenuUnsupported: 'Encrypted sync unsupported',
            syncMenuNotConfigured: 'Not configured',
            syncMenuLocked: 'Credentials required',
            syncMenuRunning: 'Syncing…',
            syncMenuError: 'Last sync failed',
            syncMenuReady: ({ time }) => time ? `Last: ${time}` : 'Unlocked',
            syncUnsupportedTitle: 'Encrypted sync is not supported',
            syncUnsupportedDetail: 'A modern browser with Web Crypto and Fetch API support is required.',
            syncNotConfiguredTitle: 'WebDAV is not configured',
            syncNotConfiguredDetail: 'Enter the remote URL and credentials to start encrypted synchronization.',
            syncLockedTitle: 'Sync configuration is locked',
            syncLockedDetail: 'Enter the WebDAV password and encryption passphrase, then click “Sync now”.',
            syncReadyTitle: 'WebDAV sync is unlocked',
            syncReadyDetail: 'Bookmark changes can sync automatically while this page remains open.',
            syncRunningTitle: 'Encrypted synchronization in progress',
            syncRunningDetail: 'Reading remote data, merging changes, and writing them back securely…',
            syncErrorTitle: 'The last sync failed',
            syncErrorDetail: ({ message }) => message || 'Check the URL, credentials, and WebDAV CORS configuration.',
            syncUrlRequired: 'Enter a WebDAV URL.',
            syncUrlInvalid: 'Enter a valid http or https WebDAV URL.',
            syncPasswordRequired: 'A password or app password is required when a username is provided.',
            syncPassphraseRequired: 'Enter an encryption passphrase of at least 8 characters.',
            syncAuthFailed: 'WebDAV authentication failed. Check the username and password.',
            syncNetworkError: 'Could not connect to WebDAV. Check the network, certificate, and CORS settings.',
            syncReadFailed: ({ status }) => `Could not read the remote file (HTTP ${status}).`,
            syncWriteFailed: ({ status }) => `Could not write the remote file (HTTP ${status}).`,
            syncConflictRetryFailed: 'The remote file kept changing during synchronization. Try again later.',
            syncDecryptFailed: 'Could not decrypt the remote file. Check the encryption passphrase.',
            syncRemoteInvalid: 'The remote synchronization file has an invalid format.',
            syncComplete: ({ items, deleted }) => `Sync complete: ${items} item${items === 1 ? '' : 's'}, ${deleted} deletion record${deleted === 1 ? '' : 's'}`,
            syncFailed: ({ message }) => `Sync failed: ${message}`,
            syncAutoEnabled: 'Automatic sync enabled; it will run after this session is unlocked',
            syncAutoPaused: 'Automatic sync paused',
            syncDisconnected: 'Sync configuration removed; the remote file was not deleted',
            confirmDisconnectSync: 'Remove the WebDAV sync configuration from this device? The encrypted remote file will not be deleted.',
            syncSecretsSessionOnly: 'Sensitive credentials are used only while this page remains open',
            clearAll: 'Clear all data',
            irreversible: 'This action cannot be undone',
            addBookmark: 'Add bookmark',
            folderPathLabel: 'Folder path',
            allDescription: 'Turn useful links scattered across the web into your own knowledge gateway.',
            eyebrowAll: 'YOUR COLLECTION',
            eyebrowFavorites: 'FAVORITES',
            eyebrowTag: 'TAG COLLECTION',
            eyebrowFolder: 'FOLDER',
            itemsLabel: 'ITEMS',
            foundLabel: 'FOUND',
            sort: 'Sort',
            newest: 'Newest first',
            oldest: 'Oldest first',
            sortByTitle: 'By title',
            initialResults: 'Showing 0 bookmarks',
            bookmarksLabel: 'Bookmarks',
            emptyFirstTitle: 'Add your first bookmark',
            emptyFirstDescription: 'All data stays in your browser.',
            close: 'Close',
            fieldTitle: 'Title',
            titlePlaceholder: 'For example: Design inspiration',
            fieldUrl: 'URL',
            urlHint: 'You may omit https://; regular web and local file links are supported',
            fieldDescription: 'Description',
            descriptionPlaceholder: 'Add a note to make this easier to find later…',
            parentFolder: 'Parent folder',
            fieldTags: 'Tags',
            tagsPlaceholder: 'design, tools, read later',
            tagsHint: 'Separate multiple tags with commas',
            addFavorite: 'Add to favorites',
            favoriteHint: 'Quickly access it from the Favorites view',
            cancel: 'Cancel',
            dbConnected: 'IndexedDB connected',
            dbUnavailable: 'This browser does not support IndexedDB.',
            dbOpenFailed: 'Could not open the local database.',
            dbBlocked: 'Another page is blocking the database upgrade. Close other bookmark manager tabs and try again.',
            deleteCanceled: 'The delete operation was canceled.',
            importTransactionFailed: 'The import transaction failed.',
            importTransactionCanceled: 'The import transaction was canceled.',
            storageStatus: ({ count }) => `IndexedDB · ${count} item${count === 1 ? '' : 's'}`,
            untitled: 'Untitled',
            noFolders: 'No folders yet',
            noTags: 'Tags will appear here after you add them',
            expandFolder: 'Expand folder',
            collapseFolder: 'Collapse folder',
            editItem: ({ title }) => `Edit ${title}`,
            deleteItem: ({ title }) => `Delete ${title}`,
            openItem: ({ title }) => `Open ${title}`,
            breadcrumbAll: 'All',
            favoritesDescription: 'Keep your most useful and meaningful links within easy reach.',
            tagDescription: ({ tag }) => `Links filed under the “${tag}” tag.`,
            folderFallback: 'Folder',
            folderDescription: 'Browse and organize the contents of this folder.',
            folderCount: ({ count }) => `${count} folder${count === 1 ? '' : 's'}`,
            bookmarkCount: ({ count }) => `${count} bookmark${count === 1 ? '' : 's'}`,
            searchResults: ({ query, summary }) => `Results for “${query}”: ${summary}`,
            showResults: ({ summary }) => `Showing ${summary}`,
            folderMeta: ({ folders, bookmarks }) => `${folders} folder${folders === 1 ? '' : 's'} · ${bookmarks} bookmark${bookmarks === 1 ? '' : 's'}`,
            unfavorite: 'Remove from favorites',
            favorite: 'Add to favorites',
            unsupportedLink: 'This link uses an unsupported protocol. Edit it before opening.',
            invalidLink: 'Invalid link',
            emptyNoMatch: 'No matching items found',
            emptyTryAgain: 'Try another search, or clear the current filters.',
            clearFilters: 'Clear filters',
            emptyLocalDescription: 'Your data stays in the browser—no server or account required.',
            dialogEditFolder: 'Edit folder',
            dialogEditBookmark: 'Edit bookmark',
            dialogAddFolder: 'Add a new folder',
            dialogAddBookmark: 'Add a new bookmark',
            eyebrowEditFolder: 'EDIT FOLDER',
            eyebrowEditBookmark: 'EDIT BOOKMARK',
            eyebrowAddFolder: 'NEW FOLDER',
            eyebrowAddBookmark: 'NEW BOOKMARK',
            saveChanges: 'Save changes',
            addFolder: 'Add folder',
            rootFolder: '/ Root',
            titleRequired: 'Enter a title.',
            folderCycle: 'A folder cannot be moved into itself or one of its descendants.',
            saved: 'Changes saved',
            folderAdded: 'Folder added',
            bookmarkAdded: 'Bookmark added',
            saveFailed: 'Could not save. Check whether this browser allows local storage.',
            favoriteAdded: 'Added to favorites',
            favoriteRemoved: 'Removed from favorites',
            confirmDelete: ({ title, count }) => `Delete “${title}”${count ? ` and its ${count} nested item${count === 1 ? '' : 's'}` : ''}? This cannot be undone.`,
            deleted: 'Deleted',
            cannotMove: 'This item cannot be moved into that folder',
            movedRoot: 'Moved to the root folder',
            movedFolder: 'Moved to folder',
            reusedFolders: ({ count }) => `reused ${count} folder${count === 1 ? '' : 's'}`,
            skippedItems: ({ count }) => `skipped ${count} item${count === 1 ? '' : 's'}`,
            imported: ({ count, details }) => `Imported ${count} item${count === 1 ? '' : 's'}${details ? `, ${details}` : ''}`,
            importFailed: ({ message }) => `Import failed: ${message}`,
            jsonInvalid: 'The JSON file is not valid',
            jsonArrayMissing: 'No recognizable bookmark array was found in this file',
            noValidItems: 'No valid bookmarks or folders were found',
            browserHtmlInvalid: 'This is not a valid browser bookmark HTML file',
            unnamedFolder: 'Untitled folder',
            unnamedBookmark: 'Untitled bookmark',
            htmlNoItems: 'No importable items were found in the HTML file',
            exportedJson: ({ count }) => `Exported ${count} item${count === 1 ? '' : 's'} as JSON`,
            exportedHtml: ({ count }) => `Exported ${count} browser bookmark item${count === 1 ? '' : 's'}`,
            nothingToClear: 'There is no data to clear',
            confirmClear: 'Clear all bookmarks and folders? Export a JSON backup first if needed. This cannot be undone.',
            cleared: 'All data cleared',
            urlRequired: 'Enter a URL.',
            urlInvalid: 'Enter a valid URL.',
            urlProtocol: 'Only http, https, ftp, and local file links are supported.',
            localFile: 'Local file',
            historicalData: 'Legacy data',
            dbConnectionFailed: 'Local database connection failed',
            fatalTitle: 'Could not open the local database',
            fatalHint: 'Open this page in the latest Edge, Chrome, Firefox, or Safari.',
            listSeparator: ', ',
        },
    };

    const state = {
        db: null,
        items: [],
        view: { type: 'all', value: null },
        query: '',
        sort: safeStorageGet(SORT_KEY) || 'newest',
        language: getInitialLanguage(),
        persistence: 'checking',
        sync: {
            supported: typeof fetch === 'function' && Boolean(globalThis.crypto?.subtle),
            deviceId: '',
            endpoint: '',
            username: '',
            password: '',
            passphrase: '',
            automatic: false,
            unlocked: false,
            lastSyncAt: '',
            error: '',
            running: false,
            pending: false,
            currentPromise: null,
            timer: null,
            lastNotifiedError: '',
        },
        backup: {
            supported: typeof window.showDirectoryPicker === 'function',
            handle: null,
            enabled: false,
            retention: 30,
            lastBackupAt: '',
            lastHash: '',
            permission: 'unknown',
            error: '',
            handleRemembered: true,
            running: false,
            pending: false,
            currentPromise: null,
            permissionNoticeShown: false,
            lastNotifiedError: '',
            timer: null,
        },
        draggedId: null,
        toastTimer: null,
    };

    const ui = {};

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        cacheElements();
        applyInitialTheme();
        applyLanguage(state.language);
        bindStaticEvents();

        try {
            state.db = await openDatabase();
            ui.storageStatus.textContent = t('dbConnected');
            await initializeSyncIdentity();
            await ensureSyncMetadata();
            await refreshData();
            await Promise.all([initializePersistentStorage(), initializeBackup(), initializeWebDavSync()]);
        } catch (error) {
            console.error('Unable to initialize bookmark manager:', error);
            showFatalError(error);
        }
    }

    function cacheElements() {
        const ids = [
            'app', 'sidebar', 'sidebar-backdrop', 'mobile-menu-button', 'brand-button',
            'all-view-button', 'favorites-view-button', 'all-count', 'favorites-count',
            'sidebar-add-folder', 'folder-tree', 'tag-navigation', 'tags-count',
            'storage-status', 'language-select', 'theme-button', 'search-input', 'clear-search-button',
            'search-shortcut', 'import-file-input', 'import-button', 'export-menu',
            'backup-settings-button', 'backup-menu-status', 'sync-settings-button',
            'sync-menu-status', 'export-json-button', 'export-html-button', 'clear-all-button',
            'add-bookmark-button', 'breadcrumbs', 'page-eyebrow', 'page-title',
            'page-description', 'result-count', 'add-folder-button', 'results-label',
            'sort-select', 'folder-grid', 'bookmark-grid', 'empty-state',
            'empty-icon-use', 'empty-title', 'empty-description', 'empty-action-button',
            'empty-action-icon', 'empty-action-label', 'item-dialog', 'item-form',
            'item-id', 'item-kind', 'dialog-eyebrow', 'dialog-title',
            'dialog-close-button', 'dialog-cancel-button', 'dialog-submit-button',
            'item-title-input', 'item-url-input', 'item-description-input',
            'item-parent-select', 'item-tags-input', 'item-favorite-input',
            'form-error', 'backup-dialog', 'backup-dialog-title',
            'backup-dialog-close-button', 'backup-dialog-cancel-button',
            'backup-status-card', 'backup-status-title', 'backup-status-detail',
            'auto-backup-toggle', 'backup-directory-name',
            'choose-backup-directory-button', 'backup-retention-select',
            'last-backup-value', 'persistence-status-value',
            'request-persistence-button', 'disconnect-backup-button',
            'backup-now-button', 'sync-dialog', 'sync-dialog-title',
            'sync-dialog-close-button', 'sync-dialog-cancel-button',
            'sync-status-card', 'sync-status-title', 'sync-status-detail',
            'sync-endpoint-input', 'sync-username-input', 'sync-password-input',
            'sync-passphrase-input', 'auto-sync-toggle', 'last-sync-value',
            'disconnect-sync-button', 'sync-now-button', 'toast', 'toast-message',
        ];

        for (const id of ids) ui[toCamelCase(id)] = document.getElementById(id);
        ui.bookmarkOnlyFields = Array.from(document.querySelectorAll('.bookmark-only-field'));
    }

    function toCamelCase(value) {
        return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    }

    function getInitialLanguage() {
        const saved = safeStorageGet(LANGUAGE_KEY);
        if (saved === 'zh' || saved === 'en') return saved;
        const browserLanguage = navigator.languages?.[0] || navigator.language || 'en';
        return /^zh(?:-|$)/i.test(browserLanguage) ? 'zh' : 'en';
    }

    function t(key, variables = {}) {
        const value = TRANSLATIONS[state.language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
        return typeof value === 'function' ? value(variables) : value;
    }

    function currentLocale() {
        return state.language === 'zh' ? 'zh-CN' : 'en-US';
    }

    function applyLanguage(language, persist = false) {
        state.language = language === 'zh' ? 'zh' : 'en';
        document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : 'en';
        document.title = t('documentTitle');
        ui.languageSelect.value = state.language;

        document.querySelectorAll('[data-i18n]').forEach((element) => {
            element.textContent = t(element.dataset.i18n);
        });
        const translatedAttributes = [
            ['data-i18n-placeholder', 'placeholder'],
            ['data-i18n-title', 'title'],
            ['data-i18n-aria-label', 'aria-label'],
            ['data-i18n-content', 'content'],
        ];
        translatedAttributes.forEach(([dataAttribute, targetAttribute]) => {
            document.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
                element.setAttribute(targetAttribute, t(element.getAttribute(dataAttribute)));
            });
        });

        const rootOption = ui.itemParentSelect.querySelector('option[value="root"]');
        if (rootOption) rootOption.textContent = t('rootFolder');
        ui.storageStatus.textContent = state.db
            ? t('storageStatus', { count: state.items.length })
            : t('connectingDatabase');
        if (persist) safeStorageSet(LANGUAGE_KEY, state.language);
        const dialogItem = ui.itemId.value ? findItem(Number(ui.itemId.value)) : null;
        updateDialogLabels(ui.itemKind.value || 'bookmark', dialogItem);
        if (state.db) renderAll();
        if (ui.backupMenuStatus) renderBackupSettings();
        if (ui.syncMenuStatus) renderSyncSettings();
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
        ui.backupSettingsButton.addEventListener('click', openBackupDialog);
        ui.syncSettingsButton.addEventListener('click', openSyncDialog);
        ui.exportJsonButton.addEventListener('click', exportJson);
        ui.exportHtmlButton.addEventListener('click', exportHtml);
        ui.clearAllButton.addEventListener('click', clearAllData);

        ui.languageSelect.addEventListener('change', () => applyLanguage(ui.languageSelect.value, true));
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

        ui.backupDialogCloseButton.addEventListener('click', closeBackupDialog);
        ui.backupDialogCancelButton.addEventListener('click', closeBackupDialog);
        ui.backupDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeBackupDialog();
        });
        ui.backupDialog.addEventListener('mousedown', (event) => {
            if (event.target === ui.backupDialog) closeBackupDialog();
        });
        ui.autoBackupToggle.addEventListener('change', handleAutoBackupToggle);
        ui.chooseBackupDirectoryButton.addEventListener('click', chooseBackupDirectory);
        ui.backupRetentionSelect.addEventListener('change', handleBackupRetentionChange);
        ui.requestPersistenceButton.addEventListener('click', () => requestPersistentStorage(true));
        ui.disconnectBackupButton.addEventListener('click', disconnectBackupDirectory);
        ui.backupNowButton.addEventListener('click', handleBackupNow);

        ui.syncDialogCloseButton.addEventListener('click', closeSyncDialog);
        ui.syncDialogCancelButton.addEventListener('click', closeSyncDialog);
        ui.syncDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeSyncDialog();
        });
        ui.syncDialog.addEventListener('mousedown', (event) => {
            if (event.target === ui.syncDialog) closeSyncDialog();
        });
        ui.syncEndpointInput.addEventListener('input', updateSyncSecretsFromForm);
        ui.syncUsernameInput.addEventListener('input', updateSyncSecretsFromForm);
        ui.syncEndpointInput.addEventListener('change', saveSyncPreferences);
        ui.syncUsernameInput.addEventListener('change', saveSyncPreferences);
        ui.syncPasswordInput.addEventListener('input', updateSyncSecretsFromForm);
        ui.syncPassphraseInput.addEventListener('input', updateSyncSecretsFromForm);
        ui.autoSyncToggle.addEventListener('change', handleAutoSyncToggle);
        ui.disconnectSyncButton.addEventListener('click', disconnectWebDavSync);
        ui.syncNowButton.addEventListener('click', () => runWebDavSync({ notify: true }));

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
                reject(new Error(t('dbUnavailable')));
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
                if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                    database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
                }
                if (!database.objectStoreNames.contains(TOMBSTONE_STORE_NAME)) {
                    database.createObjectStore(TOMBSTONE_STORE_NAME, { keyPath: 'syncId' });
                }
            };

            request.onerror = () => reject(request.error || new Error(t('dbOpenFailed')));
            request.onblocked = () => reject(new Error(t('dbBlocked')));
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

    function deleteItems(items) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
            const bookmarkStore = transaction.objectStore(STORE_NAME);
            const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
            const deletedAt = new Date().toISOString();
            items.forEach((item) => {
                bookmarkStore.delete(item.id);
                if (item.syncId) {
                    tombstoneStore.put({
                        syncId: item.syncId,
                        deletedAt,
                        modifiedBy: state.sync.deviceId,
                    });
                }
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('deleteCanceled')));
        });
    }

    function clearDatabase(items = state.items) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
            const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
            const deletedAt = new Date().toISOString();
            transaction.objectStore(STORE_NAME).clear();
            items.forEach((item) => {
                if (item.syncId) {
                    tombstoneStore.put({
                        syncId: item.syncId,
                        deletedAt,
                        modifiedBy: state.sync.deviceId,
                    });
                }
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('deleteCanceled')));
        });
    }

    function getSetting(key) {
        return new Promise((resolve, reject) => {
            const request = state.db.transaction(SETTINGS_STORE_NAME, 'readonly')
                .objectStore(SETTINGS_STORE_NAME)
                .get(key);
            request.onsuccess = () => resolve(request.result?.value ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    function saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction(SETTINGS_STORE_NAME, 'readwrite');
            try {
                transaction.objectStore(SETTINGS_STORE_NAME).put({ key, value });
            } catch (error) {
                reject(error);
                return;
            }
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
        });
    }

    function deleteSetting(key) {
        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction(SETTINGS_STORE_NAME, 'readwrite');
            transaction.objectStore(SETTINGS_STORE_NAME).delete(key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
        });
    }

    function getAllTombstones() {
        return new Promise((resolve, reject) => {
            const request = state.db.transaction(TOMBSTONE_STORE_NAME, 'readonly')
                .objectStore(TOMBSTONE_STORE_NAME)
                .getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async function initializeSyncIdentity() {
        const storedId = await getSetting(DEVICE_ID_KEY);
        state.sync.deviceId = typeof storedId === 'string' && storedId
            ? storedId
            : createUuid();
        if (storedId !== state.sync.deviceId) await saveSetting(DEVICE_ID_KEY, state.sync.deviceId);
    }

    async function ensureSyncMetadata() {
        const items = await getAllItems();
        const now = new Date().toISOString();
        let changed = false;
        items.forEach((item) => {
            if (typeof item.syncId !== 'string' || !item.syncId) {
                item.syncId = createUuid();
                changed = true;
            }
            if (!validDate(item.updatedAt)) {
                item.updatedAt = validDate(item.createdAt) ? item.createdAt : now;
                changed = true;
            }
            if (typeof item.modifiedBy !== 'string' || !item.modifiedBy) {
                item.modifiedBy = state.sync.deviceId;
                changed = true;
            }
        });
        if (!changed) return;

        await new Promise((resolve, reject) => {
            const transaction = state.db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            items.forEach((item) => store.put(item));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));
        });
    }

    function addImportedRecords(records) {
        return new Promise((resolve, reject) => {
            if (!records.length) {
                resolve(0);
                return;
            }

            const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
            const insertedIds = new Map();
            const usedSyncIds = new Set(state.items.map((item) => item.syncId).filter(Boolean));
            let index = 0;
            let insertedCount = 0;

            transaction.oncomplete = () => resolve(insertedCount);
            transaction.onerror = () => reject(transaction.error || new Error(t('importTransactionFailed')));
            transaction.onabort = () => reject(transaction.error || new Error(t('importTransactionCanceled')));

            const addNext = () => {
                while (index < records.length && records[index].existingId != null) {
                    const existing = records[index++];
                    insertedIds.set(existing.sourceKey, existing.existingId);
                }
                if (index >= records.length) return;

                const source = records[index++];
                const preferredSyncId = typeof source.syncId === 'string' ? source.syncId : '';
                const syncId = preferredSyncId && !usedSyncIds.has(preferredSyncId)
                    ? preferredSyncId
                    : createUuid();
                usedSyncIds.add(syncId);
                const item = {
                    syncId,
                    title: source.title,
                    url: source.url,
                    description: source.description,
                    tags: source.tags,
                    parentId: source.parentKey ? (insertedIds.get(source.parentKey) ?? null) : null,
                    isPinned: source.isPinned,
                    collapsed: false,
                    createdAt: source.createdAt,
                    updatedAt: source.updatedAt,
                    modifiedBy: typeof source.modifiedBy === 'string' && source.modifiedBy
                        ? source.modifiedBy
                        : state.sync.deviceId,
                };
                tombstoneStore.delete(syncId);
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
        ui.storageStatus.textContent = t('storageStatus', { count: state.items.length });
    }

    async function initializePersistentStorage() {
        if (!navigator.storage?.persisted || !navigator.storage?.persist) {
            state.persistence = 'unsupported';
            renderBackupSettings();
            return;
        }

        try {
            if (await navigator.storage.persisted()) {
                state.persistence = 'granted';
            } else {
                state.persistence = await navigator.storage.persist() ? 'granted' : 'not-granted';
            }
        } catch {
            state.persistence = 'not-granted';
        }
        renderBackupSettings();
    }

    async function requestPersistentStorage(notify = false) {
        if (!navigator.storage?.persist) {
            state.persistence = 'unsupported';
            renderBackupSettings();
            return false;
        }

        try {
            state.persistence = await navigator.storage.persist() ? 'granted' : 'not-granted';
        } catch {
            state.persistence = 'not-granted';
        }
        renderBackupSettings();
        if (notify) showToast(t(state.persistence === 'granted' ? 'persistenceGrantedToast' : 'persistenceDeniedToast'));
        return state.persistence === 'granted';
    }

    async function initializeBackup() {
        renderBackupSettings();
        if (!state.backup.supported) return;

        try {
            const [handle, preferences] = await Promise.all([
                getSetting(BACKUP_HANDLE_KEY),
                getSetting(BACKUP_PREFERENCES_KEY),
            ]);
            if (handle?.kind === 'directory') state.backup.handle = handle;
            if (preferences && typeof preferences === 'object') {
                state.backup.enabled = preferences.enabled === true;
                state.backup.retention = [7, 30, 90].includes(Number(preferences.retention))
                    ? Number(preferences.retention)
                    : 30;
                state.backup.lastBackupAt = validDate(preferences.lastBackupAt) ? preferences.lastBackupAt : '';
                state.backup.lastHash = typeof preferences.lastHash === 'string' ? preferences.lastHash : '';
            }
            if (state.backup.handle) {
                state.backup.permission = await getBackupPermission(state.backup.handle, false);
            }
        } catch (error) {
            console.error('Unable to restore automatic backup settings:', error);
            state.backup.error = error?.message || String(error);
        }

        renderBackupSettings();
        if (state.backup.enabled && state.backup.permission === 'granted') scheduleAutoBackup(250);
    }

    async function saveBackupPreferences() {
        try {
            await saveSetting(BACKUP_PREFERENCES_KEY, {
                enabled: state.backup.enabled,
                retention: state.backup.retention,
                lastBackupAt: state.backup.lastBackupAt,
                lastHash: state.backup.lastHash,
            });
            return true;
        } catch (error) {
            console.warn('Unable to save automatic backup preferences:', error);
            return false;
        }
    }

    function openBackupDialog() {
        closeExportMenu();
        renderBackupSettings();
        ui.backupDialog.showModal();
    }

    function closeBackupDialog() {
        if (ui.backupDialog.open) ui.backupDialog.close();
    }

    function renderBackupSettings() {
        if (!ui.backupMenuStatus) return;
        const backup = state.backup;
        let status = 'ready';
        if (!backup.supported) status = 'unsupported';
        else if (backup.running) status = 'running';
        else if (backup.error) status = 'error';
        else if (!backup.handle) status = 'not-configured';
        else if (!backup.enabled) status = 'paused';
        else if (backup.permission !== 'granted') status = 'permission';

        const statusContent = {
            unsupported: [t('backupUnsupportedTitle'), t('backupUnsupportedDetail'), t('backupMenuUnsupported')],
            running: [t('backupRunningTitle'), t('backupRunningDetail'), t('backupMenuRunning')],
            error: [t('backupErrorTitle'), t('backupErrorDetail', { message: backup.error }), t('backupMenuError')],
            'not-configured': [t('backupNotConfiguredTitle'), t('backupNotConfiguredDetail'), t('backupMenuNotConfigured')],
            paused: [t('backupPausedTitle'), t('backupPausedDetail'), t('backupMenuPaused')],
            permission: [t('backupPermissionTitle'), t('backupPermissionDetail'), t('backupMenuPermission')],
            ready: [
                t('backupReadyTitle'),
                backup.handleRemembered === false
                    ? t('backupHandleNotRemembered')
                    : t('backupReadyDetail', { name: backup.handle?.name || t('backupNotSelected') }),
                t('backupMenuReady', { time: formatBackupTime(backup.lastBackupAt, true) }),
            ],
        }[status];

        ui.backupStatusCard.dataset.state = status;
        ui.exportMenu.dataset.backupState = status;
        ui.backupStatusTitle.textContent = statusContent[0];
        ui.backupStatusDetail.textContent = statusContent[1];
        ui.backupMenuStatus.textContent = statusContent[2];
        ui.backupDirectoryName.textContent = backup.handle?.name || t('backupNotSelected');
        ui.lastBackupValue.textContent = formatBackupTime(backup.lastBackupAt) || t('lastBackupNever');
        ui.autoBackupToggle.checked = backup.enabled;
        ui.autoBackupToggle.disabled = !backup.supported || backup.running;
        ui.backupRetentionSelect.value = String(backup.retention);
        ui.backupRetentionSelect.disabled = !backup.supported || !backup.handle || backup.running;
        ui.chooseBackupDirectoryButton.disabled = !backup.supported || backup.running;
        ui.backupNowButton.disabled = backup.running;
        ui.backupNowButton.textContent = backup.supported ? t('backupNow') : t('jsonBackup');
        ui.disconnectBackupButton.classList.toggle('hidden', !backup.handle);
        ui.disconnectBackupButton.disabled = backup.running;

        const persistenceText = {
            checking: t('persistenceChecking'),
            granted: t('persistenceGranted'),
            'not-granted': t('persistenceNotGranted'),
            unsupported: t('persistenceUnsupported'),
        }[state.persistence] || t('persistenceChecking');
        ui.persistenceStatusValue.textContent = persistenceText;
        ui.requestPersistenceButton.classList.toggle(
            'hidden',
            state.persistence === 'granted' || state.persistence === 'unsupported' || state.persistence === 'checking',
        );
    }

    async function handleAutoBackupToggle() {
        if (!state.backup.supported) {
            ui.autoBackupToggle.checked = false;
            return;
        }
        if (ui.autoBackupToggle.checked && !state.backup.handle) {
            ui.autoBackupToggle.checked = false;
            await chooseBackupDirectory();
            return;
        }

        if (ui.autoBackupToggle.checked) {
            const permission = await getBackupPermission(state.backup.handle, true);
            state.backup.permission = permission;
            if (permission !== 'granted') {
                state.backup.enabled = false;
                ui.autoBackupToggle.checked = false;
                renderBackupSettings();
                showToast(t('backupPermissionDenied'));
                return;
            }
            state.backup.enabled = true;
            state.backup.error = '';
            state.backup.permissionNoticeShown = false;
            await saveBackupPreferences();
            renderBackupSettings();
            showToast(t('autoBackupEnabled'));
            await runAutomaticBackup({ force: false, notify: false });
        } else {
            state.backup.enabled = false;
            window.clearTimeout(state.backup.timer);
            await saveBackupPreferences();
            renderBackupSettings();
            showToast(t('autoBackupPaused'));
        }
    }

    async function chooseBackupDirectory() {
        if (!state.backup.supported) return;
        try {
            const handle = await window.showDirectoryPicker({
                id: 'bookmark-manager-backup',
                mode: 'readwrite',
            });
            const permission = await getBackupPermission(handle, true);
            if (permission !== 'granted') {
                showToast(t('backupPermissionDenied'));
                return;
            }

            state.backup.handle = handle;
            state.backup.permission = permission;
            state.backup.enabled = true;
            state.backup.error = '';
            state.backup.permissionNoticeShown = false;
            state.backup.lastNotifiedError = '';
            state.backup.lastHash = '';
            state.backup.handleRemembered = true;
            try {
                await saveSetting(BACKUP_HANDLE_KEY, handle);
            } catch (error) {
                console.warn('The browser could not persist the directory handle:', error);
                state.backup.handleRemembered = false;
            }
            await saveBackupPreferences();
            renderBackupSettings();
            await runAutomaticBackup({ force: true, notify: true });
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('Unable to select backup directory:', error);
            state.backup.error = error?.message || String(error);
            renderBackupSettings();
            showToast(t('backupFailed', { message: state.backup.error }));
        }
    }

    async function handleBackupRetentionChange() {
        const retention = Number(ui.backupRetentionSelect.value);
        state.backup.retention = [7, 30, 90].includes(retention) ? retention : 30;
        await saveBackupPreferences();
        if (state.backup.handle && state.backup.permission === 'granted') {
            try {
                const history = await state.backup.handle.getDirectoryHandle('history', { create: true });
                await pruneBackupHistory(history, state.backup.retention);
            } catch (error) {
                console.warn('Unable to prune backup history:', error);
            }
        }
        renderBackupSettings();
    }

    async function disconnectBackupDirectory() {
        if (!state.backup.handle || !window.confirm(t('confirmDisconnect'))) return;
        window.clearTimeout(state.backup.timer);
        try {
            await deleteSetting(BACKUP_HANDLE_KEY);
        } catch (error) {
            console.warn('Unable to remove stored directory handle:', error);
        }
        state.backup.handle = null;
        state.backup.enabled = false;
        state.backup.permission = 'unknown';
        state.backup.error = '';
        state.backup.permissionNoticeShown = false;
        state.backup.lastNotifiedError = '';
        state.backup.lastHash = '';
        state.backup.lastBackupAt = '';
        state.backup.handleRemembered = true;
        await saveBackupPreferences();
        renderBackupSettings();
        showToast(t('backupDisconnected'));
    }

    async function handleBackupNow() {
        if (!state.backup.supported) {
            closeBackupDialog();
            exportJson();
            return;
        }
        if (!state.backup.handle) {
            await chooseBackupDirectory();
            return;
        }
        state.backup.permission = await getBackupPermission(state.backup.handle, true);
        if (state.backup.permission !== 'granted') {
            renderBackupSettings();
            showToast(t('backupPermissionDenied'));
            return;
        }
        await runAutomaticBackup({ force: true, notify: true, allowWhenPaused: true });
    }

    async function getBackupPermission(handle, requestPermission) {
        if (!handle) return 'unknown';
        if (typeof handle.queryPermission !== 'function') return 'granted';
        try {
            let permission = await handle.queryPermission({ mode: 'readwrite' });
            if (permission === 'prompt' && requestPermission && typeof handle.requestPermission === 'function') {
                permission = await handle.requestPermission({ mode: 'readwrite' });
            }
            return permission;
        } catch {
            return 'denied';
        }
    }

    function scheduleAutoBackup(delay = 900) {
        if (!state.backup.supported || !state.backup.enabled || !state.backup.handle) return;
        window.clearTimeout(state.backup.timer);
        state.backup.timer = window.setTimeout(() => {
            runAutomaticBackup({ force: false, notify: false });
        }, delay);
    }

    async function flushBackupBeforeDestructiveChange() {
        if (!state.backup.enabled || !state.backup.handle) return;
        window.clearTimeout(state.backup.timer);
        await runAutomaticBackup({ force: false, notify: false });
    }

    async function runAutomaticBackup({ force = false, notify = false, allowWhenPaused = false } = {}) {
        const backup = state.backup;
        if (!backup.supported || (!backup.enabled && !allowWhenPaused) || !backup.handle) return false;
        if (backup.running) {
            backup.pending = true;
            return backup.currentPromise || false;
        }

        backup.running = true;
        backup.error = '';
        window.clearTimeout(backup.timer);
        renderBackupSettings();

        const operation = (async () => {
            backup.permission = await getBackupPermission(backup.handle, false);
            if (backup.permission !== 'granted') {
                if (notify || !backup.permissionNoticeShown) showToast(t('backupPermissionDenied'));
                backup.permissionNoticeShown = true;
                return false;
            }
            backup.permissionNoticeShown = false;

            const stableContent = JSON.stringify(state.items.map(toStorageRecord));
            const contentHash = `${hashString(stableContent)}-${stableContent.length}`;
            if (!force && contentHash === backup.lastHash) {
                if (notify) showToast(t('backupUpToDate'));
                return true;
            }

            const payload = createBackupPayload();
            const content = `${JSON.stringify(payload, null, 2)}\n`;
            await writeBackupFile(backup.handle, 'bookmarks-latest.json', content);
            const history = await backup.handle.getDirectoryHandle('history', { create: true });
            const snapshotName = `bookmarks-${fileTimestamp(new Date())}.json`;
            await writeBackupFile(history, snapshotName, content);
            try {
                await pruneBackupHistory(history, backup.retention);
            } catch (error) {
                console.warn('Unable to prune backup history:', error);
            }

            backup.lastHash = contentHash;
            backup.lastBackupAt = payload.exportedAt;
            backup.lastNotifiedError = '';
            try {
                await saveBackupPreferences();
            } catch (error) {
                console.warn('Unable to save backup metadata:', error);
            }
            if (notify) showToast(t('backupComplete', { count: state.items.length }));
            return true;
        })();

        backup.currentPromise = operation;
        try {
            return await operation;
        } catch (error) {
            console.error('Automatic backup failed:', error);
            backup.error = error?.message || String(error);
            if (notify || backup.lastNotifiedError !== backup.error) {
                showToast(t('backupFailed', { message: backup.error }));
                backup.lastNotifiedError = backup.error;
            }
            return false;
        } finally {
            backup.running = false;
            backup.currentPromise = null;
            renderBackupSettings();
            if (backup.pending) {
                backup.pending = false;
                scheduleAutoBackup(150);
            }
        }
    }

    async function writeBackupFile(directory, filename, content) {
        const fileHandle = await directory.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(content);
            await writable.close();
        } catch (error) {
            try {
                await writable.abort();
            } catch {
                // Ignore a secondary abort failure and preserve the original error.
            }
            throw error;
        }
    }

    async function pruneBackupHistory(directory, retention) {
        const snapshots = [];
        for await (const [name, handle] of directory.entries()) {
            if (handle.kind === 'file' && /^bookmarks-\d{4}-\d{2}-\d{2}T.*\.json$/.test(name)) snapshots.push(name);
        }
        snapshots.sort().reverse();
        await Promise.all(snapshots.slice(retention).map((name) => directory.removeEntry(name)));
    }

    function createBackupPayload() {
        return {
            format: 'bookmark-manager',
            version: 2,
            exportedAt: new Date().toISOString(),
            bookmarks: state.items.map(toStorageRecord),
        };
    }

    function fileTimestamp(date) {
        return date.toISOString().replace(/[:.]/g, '-');
    }

    function formatBackupTime(value, compact = false) {
        if (!validDate(value)) return '';
        const options = compact
            ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { dateStyle: 'medium', timeStyle: 'short' };
        return new Intl.DateTimeFormat(currentLocale(), options).format(new Date(value));
    }

    async function initializeWebDavSync() {
        renderSyncSettings();
        if (!state.sync.supported) return;
        try {
            const preferences = await getSetting(SYNC_PREFERENCES_KEY);
            if (preferences && typeof preferences === 'object') {
                state.sync.endpoint = typeof preferences.endpoint === 'string' ? preferences.endpoint : '';
                state.sync.username = typeof preferences.username === 'string' ? preferences.username : '';
                state.sync.automatic = preferences.automatic === true;
                state.sync.lastSyncAt = validDate(preferences.lastSyncAt) ? preferences.lastSyncAt : '';
            }
            ui.syncEndpointInput.value = state.sync.endpoint;
            ui.syncUsernameInput.value = state.sync.username;
        } catch (error) {
            console.error('Unable to restore WebDAV sync settings:', error);
            state.sync.error = error?.message || String(error);
        }
        renderSyncSettings();
    }

    async function saveSyncPreferences() {
        try {
            await saveSetting(SYNC_PREFERENCES_KEY, {
                endpoint: state.sync.endpoint,
                username: state.sync.username,
                automatic: state.sync.automatic,
                lastSyncAt: state.sync.lastSyncAt,
            });
            return true;
        } catch (error) {
            console.warn('Unable to save WebDAV sync preferences:', error);
            return false;
        }
    }

    function openSyncDialog() {
        closeExportMenu();
        ui.syncEndpointInput.value = state.sync.endpoint;
        ui.syncUsernameInput.value = state.sync.username;
        ui.syncPasswordInput.value = state.sync.password;
        ui.syncPassphraseInput.value = state.sync.passphrase;
        renderSyncSettings();
        ui.syncDialog.showModal();
    }

    function closeSyncDialog() {
        updateSyncSecretsFromForm();
        saveSyncPreferences();
        if (ui.syncDialog.open) ui.syncDialog.close();
    }

    function updateSyncSecretsFromForm() {
        const previousFingerprint = syncSessionFingerprint();
        state.sync.endpoint = ui.syncEndpointInput.value.trim();
        state.sync.username = ui.syncUsernameInput.value.trim();
        state.sync.password = ui.syncPasswordInput.value;
        state.sync.passphrase = ui.syncPassphraseInput.value;
        if (state.sync.unlocked && previousFingerprint !== syncSessionFingerprint()) {
            state.sync.unlocked = false;
        }
        state.sync.error = '';
        renderSyncSettings();
    }

    function syncSessionFingerprint() {
        return [
            state.sync.endpoint,
            state.sync.username,
            state.sync.password,
            state.sync.passphrase,
        ].join('\u0000');
    }

    function renderSyncSettings() {
        if (!ui.syncMenuStatus) return;
        const sync = state.sync;
        let status = 'ready';
        if (!sync.supported) status = 'unsupported';
        else if (sync.running) status = 'running';
        else if (sync.error) status = 'error';
        else if (!sync.endpoint) status = 'not-configured';
        else if (!sync.unlocked) status = 'locked';

        const statusContent = {
            unsupported: [t('syncUnsupportedTitle'), t('syncUnsupportedDetail'), t('syncMenuUnsupported')],
            running: [t('syncRunningTitle'), t('syncRunningDetail'), t('syncMenuRunning')],
            error: [t('syncErrorTitle'), t('syncErrorDetail', { message: sync.error }), t('syncMenuError')],
            'not-configured': [t('syncNotConfiguredTitle'), t('syncNotConfiguredDetail'), t('syncMenuNotConfigured')],
            locked: [t('syncLockedTitle'), t('syncLockedDetail'), t('syncMenuLocked')],
            ready: [
                t('syncReadyTitle'),
                t('syncReadyDetail'),
                t('syncMenuReady', { time: formatBackupTime(sync.lastSyncAt, true) }),
            ],
        }[status];

        ui.syncStatusCard.dataset.state = status;
        ui.exportMenu.dataset.syncState = status;
        ui.syncStatusTitle.textContent = statusContent[0];
        ui.syncStatusDetail.textContent = statusContent[1];
        ui.syncMenuStatus.textContent = statusContent[2];
        ui.lastSyncValue.textContent = formatBackupTime(sync.lastSyncAt) || t('syncLastNever');
        ui.autoSyncToggle.checked = sync.automatic;
        ui.autoSyncToggle.disabled = !sync.supported || sync.running;
        ui.syncNowButton.disabled = !sync.supported || sync.running;
        ui.syncEndpointInput.disabled = sync.running;
        ui.syncUsernameInput.disabled = sync.running;
        ui.syncPasswordInput.disabled = sync.running;
        ui.syncPassphraseInput.disabled = sync.running;
        ui.disconnectSyncButton.classList.toggle('hidden', !sync.endpoint && !sync.username);
        ui.disconnectSyncButton.disabled = sync.running;
    }

    async function handleAutoSyncToggle() {
        const enabled = ui.autoSyncToggle.checked;
        updateSyncSecretsFromForm();
        state.sync.automatic = enabled;
        await saveSyncPreferences();
        renderSyncSettings();
        if (state.sync.automatic) {
            showToast(t('syncAutoEnabled'));
            if (state.sync.unlocked) scheduleWebDavSync(150);
        } else {
            window.clearTimeout(state.sync.timer);
            showToast(t('syncAutoPaused'));
        }
    }

    async function disconnectWebDavSync() {
        if (!window.confirm(t('confirmDisconnectSync'))) return;
        window.clearTimeout(state.sync.timer);
        try {
            await deleteSetting(SYNC_PREFERENCES_KEY);
        } catch (error) {
            console.warn('Unable to remove WebDAV sync preferences:', error);
        }
        Object.assign(state.sync, {
            endpoint: '',
            username: '',
            password: '',
            passphrase: '',
            automatic: false,
            unlocked: false,
            lastSyncAt: '',
            error: '',
            pending: false,
            lastNotifiedError: '',
        });
        ui.syncEndpointInput.value = '';
        ui.syncUsernameInput.value = '';
        ui.syncPasswordInput.value = '';
        ui.syncPassphraseInput.value = '';
        renderSyncSettings();
        showToast(t('syncDisconnected'));
    }

    function scheduleWebDavSync(delay = 1800) {
        const sync = state.sync;
        if (!sync.supported || !sync.automatic || !sync.unlocked || !sync.endpoint) return;
        window.clearTimeout(sync.timer);
        sync.timer = window.setTimeout(() => runWebDavSync({ notify: false }), delay);
    }

    function scheduleDataProtection() {
        scheduleAutoBackup();
        scheduleWebDavSync();
    }

    async function runWebDavSync({ notify = false } = {}) {
        updateSyncSecretsFromForm();
        const sync = state.sync;
        if (!sync.supported) {
            if (notify) showToast(t('syncFailed', { message: t('syncUnsupportedDetail') }));
            return false;
        }
        if (sync.running) {
            sync.pending = true;
            return sync.currentPromise || false;
        }

        let endpoint;
        try {
            endpoint = normalizeWebDavEndpoint(sync.endpoint);
            if (sync.username && !sync.password) throw new Error(t('syncPasswordRequired'));
            if (sync.passphrase.length < 8) throw new Error(t('syncPassphraseRequired'));
        } catch (error) {
            sync.error = error.message;
            renderSyncSettings();
            if (notify) showToast(t('syncFailed', { message: sync.error }));
            return false;
        }

        sync.endpoint = endpoint;
        ui.syncEndpointInput.value = endpoint;
        sync.running = true;
        sync.error = '';
        window.clearTimeout(sync.timer);
        ui.app.inert = true;
        document.body.classList.add('syncing');
        renderSyncSettings();
        await saveSyncPreferences();

        const operation = (async () => {
            let merged = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const remote = await readRemoteSyncFile(endpoint);
                await refreshData();
                const local = await createLocalSyncDataset();
                merged = mergeSyncDatasets(local, remote.data);
                const encrypted = await encryptSyncData(merged, sync.passphrase);
                const writeResult = await writeRemoteSyncFile(endpoint, encrypted, remote);
                if (writeResult === 'conflict') {
                    merged = null;
                    continue;
                }
                break;
            }
            if (!merged) throw new Error(t('syncConflictRetryFailed'));

            const viewedFolder = state.view.type === 'folder' ? findItem(state.view.value) : null;
            const viewedFolderSyncId = viewedFolder?.syncId || '';
            await replaceLocalSyncDataset(merged);
            await refreshData();
            if (viewedFolderSyncId) {
                const replacement = state.items.find((item) => item.syncId === viewedFolderSyncId && isFolder(item));
                state.view = replacement
                    ? { type: 'folder', value: replacement.id }
                    : { type: 'all', value: null };
                renderAll();
            }

            sync.unlocked = true;
            sync.lastSyncAt = new Date().toISOString();
            sync.lastNotifiedError = '';
            await saveSyncPreferences();
            scheduleAutoBackup();
            if (notify) showToast(t('syncComplete', {
                items: merged.items.length,
                deleted: merged.tombstones.length,
            }));
            return true;
        })();

        sync.currentPromise = operation;
        try {
            return await operation;
        } catch (error) {
            console.error('WebDAV synchronization failed:', error);
            sync.error = error?.message || String(error);
            if (notify || sync.lastNotifiedError !== sync.error) {
                showToast(t('syncFailed', { message: sync.error }));
                sync.lastNotifiedError = sync.error;
            }
            return false;
        } finally {
            sync.running = false;
            sync.currentPromise = null;
            ui.app.inert = false;
            document.body.classList.remove('syncing');
            renderSyncSettings();
            if (sync.pending) {
                sync.pending = false;
                scheduleWebDavSync(200);
            }
        }
    }

    function normalizeWebDavEndpoint(value) {
        const input = String(value || '').trim();
        if (!input) throw new Error(t('syncUrlRequired'));
        let url;
        try {
            url = new URL(input);
        } catch {
            throw new Error(t('syncUrlInvalid'));
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error(t('syncUrlInvalid'));
        }
        if (!url.pathname.toLowerCase().endsWith('.json')) {
            if (!url.pathname.endsWith('/')) url.pathname += '/';
            url.pathname += SYNC_FILE_NAME;
        }
        url.hash = '';
        return url.toString();
    }

    function createWebDavHeaders(includeContentType = false) {
        const headers = new Headers({ Accept: 'application/json' });
        if (includeContentType) headers.set('Content-Type', 'application/json; charset=utf-8');
        if (state.sync.username) {
            const credentials = new TextEncoder().encode(`${state.sync.username}:${state.sync.password}`);
            headers.set('Authorization', `Basic ${bytesToBase64(credentials)}`);
        }
        return headers;
    }

    async function readRemoteSyncFile(endpoint) {
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'GET',
                headers: createWebDavHeaders(),
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'follow',
            });
        } catch {
            throw new Error(t('syncNetworkError'));
        }

        if (response.status === 404) return { exists: false, etag: '', data: emptySyncDataset() };
        if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
        if (!response.ok) throw new Error(t('syncReadFailed', { status: response.status }));
        const text = await response.text();
        const data = text.trim()
            ? parseRemoteSyncDataset(await decryptSyncData(text, state.sync.passphrase))
            : emptySyncDataset();
        return {
            exists: true,
            etag: response.headers.get('ETag') || '',
            data,
        };
    }

    async function writeRemoteSyncFile(endpoint, content, remote) {
        const headers = createWebDavHeaders(true);
        if (remote.exists && remote.etag) headers.set('If-Match', remote.etag);
        else if (!remote.exists) headers.set('If-None-Match', '*');

        let response;
        try {
            response = await fetch(endpoint, {
                method: 'PUT',
                headers,
                body: content,
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'follow',
            });
        } catch {
            throw new Error(t('syncNetworkError'));
        }
        if (response.status === 412) return 'conflict';
        if (response.status === 401 || response.status === 403) throw new Error(t('syncAuthFailed'));
        if (!response.ok) throw new Error(t('syncWriteFailed', { status: response.status }));
        return 'written';
    }

    async function encryptSyncData(dataset, passphrase) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveSyncKey(passphrase, salt, PBKDF2_ITERATIONS, ['encrypt']);
        const plaintext = new TextEncoder().encode(JSON.stringify({
            format: 'bookmark-manager-sync',
            version: 1,
            updatedAt: new Date().toISOString(),
            items: dataset.items,
            tombstones: dataset.tombstones,
        }));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
        return `${JSON.stringify({
            format: 'bookmark-manager-encrypted-sync',
            version: 1,
            kdf: {
                name: 'PBKDF2',
                hash: 'SHA-256',
                iterations: PBKDF2_ITERATIONS,
                salt: bytesToBase64(salt),
            },
            cipher: {
                name: 'AES-GCM',
                iv: bytesToBase64(iv),
                data: bytesToBase64(new Uint8Array(ciphertext)),
            },
        }, null, 2)}\n`;
    }

    async function decryptSyncData(content, passphrase) {
        let envelope;
        try {
            envelope = JSON.parse(content);
        } catch {
            throw new Error(t('syncRemoteInvalid'));
        }
        const iterations = Number(envelope?.kdf?.iterations);
        if (
            envelope?.format !== 'bookmark-manager-encrypted-sync'
            || envelope?.version !== 1
            || envelope?.kdf?.name !== 'PBKDF2'
            || envelope?.cipher?.name !== 'AES-GCM'
            || !Number.isInteger(iterations)
            || iterations < 10000
            || iterations > 1000000
        ) {
            throw new Error(t('syncRemoteInvalid'));
        }

        try {
            const salt = base64ToBytes(envelope.kdf.salt);
            const iv = base64ToBytes(envelope.cipher.iv);
            const ciphertext = base64ToBytes(envelope.cipher.data);
            if (salt.length < 16 || iv.length !== 12 || !ciphertext.length) throw new Error('invalid encrypted data');
            const key = await deriveSyncKey(passphrase, salt, iterations, ['decrypt']);
            const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return JSON.parse(new TextDecoder().decode(plaintext));
        } catch {
            throw new Error(t('syncDecryptFailed'));
        }
    }

    async function deriveSyncKey(passphrase, salt, iterations, usages) {
        const material = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(String(passphrase).normalize('NFKC')),
            'PBKDF2',
            false,
            ['deriveKey'],
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            usages,
        );
    }

    function bytesToBase64(value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(String(value || ''));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }

    async function createLocalSyncDataset() {
        const parentSyncIds = new Map(state.items.map((item) => [item.id, item.syncId]));
        const items = state.items.map((item) => ({
            syncId: item.syncId,
            parentSyncId: item.parentId == null ? null : (parentSyncIds.get(item.parentId) || null),
            title: item.title,
            url: item.url,
            description: item.description,
            tags: item.tags,
            isPinned: item.isPinned,
            createdAt: item.createdAt || item.updatedAt,
            updatedAt: item.updatedAt,
            modifiedBy: item.modifiedBy || state.sync.deviceId,
        }));
        const tombstones = (await getAllTombstones()).map(normalizeSyncTombstone).filter(Boolean);
        return {
            items: items.sort((left, right) => left.syncId.localeCompare(right.syncId)),
            tombstones: tombstones.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        };
    }

    function parseRemoteSyncDataset(input) {
        if (
            !input
            || input.format !== 'bookmark-manager-sync'
            || input.version !== 1
            || !Array.isArray(input.items)
            || !Array.isArray(input.tombstones)
        ) {
            throw new Error(t('syncRemoteInvalid'));
        }
        try {
            const items = input.items.map(normalizeSyncItem);
            const tombstones = input.tombstones.map(normalizeSyncTombstone).filter(Boolean);
            return { items, tombstones };
        } catch (error) {
            if (error?.message === t('syncRemoteInvalid')) throw error;
            throw new Error(t('syncRemoteInvalid'));
        }
    }

    function emptySyncDataset() {
        return { items: [], tombstones: [] };
    }

    function normalizeSyncItem(input) {
        if (!input || typeof input !== 'object' || typeof input.syncId !== 'string' || !input.syncId) {
            throw new Error(t('syncRemoteInvalid'));
        }
        const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : t('untitled');
        const url = input.url ? normalizeUrl(input.url) : '';
        const updatedAt = validDate(input.updatedAt) ? input.updatedAt : '1970-01-01T00:00:00.000Z';
        return {
            syncId: input.syncId,
            parentSyncId: typeof input.parentSyncId === 'string' && input.parentSyncId ? input.parentSyncId : null,
            title,
            url,
            description: typeof input.description === 'string' ? input.description.trim() : '',
            tags: parseTags(input.tags),
            isPinned: input.isPinned === true,
            createdAt: validDate(input.createdAt) ? input.createdAt : updatedAt,
            updatedAt,
            modifiedBy: typeof input.modifiedBy === 'string' ? input.modifiedBy : '',
        };
    }

    function normalizeSyncTombstone(input) {
        if (!input || typeof input.syncId !== 'string' || !input.syncId || !validDate(input.deletedAt)) return null;
        return {
            syncId: input.syncId,
            deletedAt: input.deletedAt,
            modifiedBy: typeof input.modifiedBy === 'string' ? input.modifiedBy : '',
        };
    }

    function mergeSyncDatasets(local, remote) {
        const items = new Map();
        [...local.items, ...remote.items].forEach((item) => {
            const current = items.get(item.syncId);
            if (!current || compareSyncRecords(item, current, 'updatedAt') > 0) items.set(item.syncId, { ...item });
        });
        const tombstones = new Map();
        [...local.tombstones, ...remote.tombstones].forEach((tombstone) => {
            const current = tombstones.get(tombstone.syncId);
            if (!current || compareSyncRecords(tombstone, current, 'deletedAt') > 0) {
                tombstones.set(tombstone.syncId, { ...tombstone });
            }
        });

        const liveItems = [];
        const liveTombstones = [];
        const allSyncIds = new Set([...items.keys(), ...tombstones.keys()]);
        allSyncIds.forEach((syncId) => {
            const item = items.get(syncId);
            const tombstone = tombstones.get(syncId);
            if (!item) {
                if (tombstone) liveTombstones.push(tombstone);
                return;
            }
            if (tombstone && tombstoneWins(tombstone, item)) {
                liveTombstones.push(tombstone);
            } else {
                liveItems.push(item);
            }
        });

        sanitizeSyncHierarchy(liveItems);
        return {
            items: liveItems.sort((left, right) => left.syncId.localeCompare(right.syncId)),
            tombstones: liveTombstones.sort((left, right) => left.syncId.localeCompare(right.syncId)),
        };
    }

    function compareSyncRecords(left, right, dateField) {
        const timeDifference = Date.parse(left[dateField]) - Date.parse(right[dateField]);
        if (timeDifference) return timeDifference;
        const deviceDifference = String(left.modifiedBy || '').localeCompare(String(right.modifiedBy || ''));
        if (deviceDifference) return deviceDifference;
        return JSON.stringify(left).localeCompare(JSON.stringify(right));
    }

    function tombstoneWins(tombstone, item) {
        const timeDifference = Date.parse(tombstone.deletedAt) - Date.parse(item.updatedAt);
        if (timeDifference) return timeDifference > 0;
        return String(tombstone.modifiedBy || '').localeCompare(String(item.modifiedBy || '')) >= 0;
    }

    function sanitizeSyncHierarchy(items) {
        const byId = new Map(items.map((item) => [item.syncId, item]));
        items.forEach((item) => {
            const parent = item.parentSyncId ? byId.get(item.parentSyncId) : null;
            if (!parent || parent.url || parent.syncId === item.syncId) item.parentSyncId = null;
        });

        const visited = new Set();
        const visiting = new Set();
        const visit = (item) => {
            if (visited.has(item.syncId)) return;
            if (visiting.has(item.syncId)) {
                item.parentSyncId = null;
                return;
            }
            visiting.add(item.syncId);
            const parent = item.parentSyncId ? byId.get(item.parentSyncId) : null;
            if (parent) visit(parent);
            visiting.delete(item.syncId);
            visited.add(item.syncId);
        };
        items.forEach(visit);
    }

    function replaceLocalSyncDataset(dataset) {
        const existingBySyncId = new Map(state.items.map((item) => [item.syncId, item]));
        const liveSyncIds = new Set(dataset.items.map((item) => item.syncId));
        const numericIds = new Map(
            state.items
                .filter((item) => liveSyncIds.has(item.syncId))
                .map((item) => [item.syncId, item.id]),
        );

        return new Promise((resolve, reject) => {
            const transaction = state.db.transaction([STORE_NAME, TOMBSTONE_STORE_NAME], 'readwrite');
            const bookmarkStore = transaction.objectStore(STORE_NAME);
            const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE_NAME);
            const localRecords = [];
            let upsertIndex = 0;
            let parentIndex = 0;

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error(t('dbOpenFailed')));

            state.items
                .filter((item) => !liveSyncIds.has(item.syncId))
                .forEach((item) => bookmarkStore.delete(item.id));

            const addTombstones = () => {
                dataset.tombstones.forEach((tombstone) => tombstoneStore.put(tombstone));
            };
            const updateParents = () => {
                if (parentIndex >= localRecords.length) {
                    addTombstones();
                    return;
                }
                const record = localRecords[parentIndex++];
                record.parentId = record.parentSyncId ? (numericIds.get(record.parentSyncId) || null) : null;
                delete record.parentSyncId;
                const request = bookmarkStore.put(record);
                request.onsuccess = updateParents;
            };
            const upsertItems = () => {
                if (upsertIndex >= dataset.items.length) {
                    updateParents();
                    return;
                }
                const item = dataset.items[upsertIndex++];
                const existing = existingBySyncId.get(item.syncId);
                const record = {
                    ...(existing ? { id: existing.id } : {}),
                    syncId: item.syncId,
                    parentSyncId: item.parentSyncId,
                    parentId: null,
                    title: item.title,
                    url: item.url,
                    description: item.description,
                    tags: item.tags,
                    isPinned: item.isPinned,
                    collapsed: existing?.collapsed === true,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    modifiedBy: item.modifiedBy,
                };
                const request = existing ? bookmarkStore.put(record) : bookmarkStore.add(record);
                request.onsuccess = () => {
                    record.id = existing?.id ?? request.result;
                    numericIds.set(item.syncId, record.id);
                    localRecords.push(record);
                    upsertItems();
                };
            };

            const clearTombstones = tombstoneStore.clear();
            clearTombstones.onsuccess = upsertItems;
        });
    }

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

        const toggle = createElement('button', `folder-toggle${children.length ? '' : ' is-placeholder'}`);
        toggle.type = 'button';
        toggle.setAttribute('aria-label', t(folder.collapsed ? 'expandFolder' : 'collapseFolder'));
        if (children.length) {
            toggle.append(createIcon('chevron-right', 14));
            toggle.classList.toggle('expanded', !folder.collapsed);
            toggle.addEventListener('click', async (event) => {
                event.stopPropagation();
                folder.collapsed = !folder.collapsed;
                await saveItem(toStorageRecord(folder));
                scheduleAutoBackup();
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
            await saveItem(record);
            closeItemDialog();
            await refreshData();
            scheduleDataProtection();
            showToast(existing ? t('saved') : t(kind === 'folder' ? 'folderAdded' : 'bookmarkAdded'));
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
        const updated = toStorageRecord(bookmark);
        updated.isPinned = !bookmark.isPinned;
        updated.updatedAt = new Date().toISOString();
        updated.modifiedBy = state.sync.deviceId;
        await saveItem(updated);
        await refreshData();
        scheduleDataProtection();
        showToast(t(updated.isPinned ? 'favoriteAdded' : 'favoriteRemoved'));
    }

    async function deleteItem(item) {
        const descendantIds = isFolder(item) ? getAllDescendantIds(item.id) : [];
        if (!window.confirm(t('confirmDelete', { title: item.title, count: descendantIds.length }))) return;

        await flushBackupBeforeDestructiveChange();
        const deletingIds = new Set([item.id, ...descendantIds]);
        await deleteItems(state.items.filter((candidate) => deletingIds.has(candidate.id)));
        if (state.view.type === 'folder' && (state.view.value === item.id || descendantIds.includes(state.view.value))) {
            state.view = { type: 'all', value: null };
        }
        await refreshData();
        scheduleDataProtection();
        showToast(t('deleted'));
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
            showToast(t('cannotMove'));
            clearDragState();
            return;
        }

        const updated = toStorageRecord(item);
        updated.parentId = parentId;
        updated.updatedAt = new Date().toISOString();
        updated.modifiedBy = state.sync.deviceId;
        await saveItem(updated);
        clearDragState();
        await refreshData();
        scheduleDataProtection();
        showToast(t(parentId == null ? 'movedRoot' : 'movedFolder'));
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
        if (state.sort === 'title') return left.title.localeCompare(right.title, currentLocale());
        const difference = itemTimestamp(left) - itemTimestamp(right);
        return state.sort === 'oldest' ? difference : -difference;
    }

    function sortByTitle(items) {
        return items.slice().sort((left, right) => left.title.localeCompare(right.title, currentLocale()));
    }

    function sortTreeItems(items) {
        return items.slice().sort((left, right) => {
            if (isFolder(left) !== isFolder(right)) return isFolder(left) ? -1 : 1;
            return left.title.localeCompare(right.title, currentLocale());
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
            syncId: item.syncId || createUuid(),
            title: item.title,
            url: item.url,
            description: item.description || '',
            tags: parseTags(item.tags),
            parentId: item.parentId == null ? null : item.parentId,
            isPinned: item.isPinned === true,
            collapsed: item.collapsed === true,
            createdAt: item.createdAt || '',
            updatedAt: item.updatedAt || '',
            modifiedBy: item.modifiedBy || state.sync.deviceId,
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
        if (!input) throw new Error(t('urlRequired'));
        const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
        let url;
        try {
            url = new URL(withProtocol);
        } catch {
            throw new Error(t('urlInvalid'));
        }
        if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error(t('urlProtocol'));
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
            if (url.protocol === 'file:') return t('localFile');
            return url.hostname.replace(/^www\./, '') || url.protocol.replace(':', '');
        } catch {
            return value;
        }
    }

    function getSiteInitial(hostname) {
        return (hostname || '·').trim().slice(0, 1).toUpperCase();
    }

    function createUuid() {
        if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
        if (!validDate(value)) return t('historicalData');
        return new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: 'numeric' }).format(new Date(value));
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
        ui.storageStatus.textContent = t('dbConnectionFailed');
        ui.bookmarkGrid.replaceChildren();
        ui.folderGrid.replaceChildren();
        const panel = createElement('section', 'fatal-error');
        panel.append(
            createIcon('database', 30),
            createElement('h2', '', t('fatalTitle')),
            createElement('p', '', error?.message || t('fatalHint')),
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
