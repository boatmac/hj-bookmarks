/* Compatibility loader for cached copies of index.html that referenced js/script.js. */
'use strict';

(() => {
    const version = '20260829-33';
    const modules = [
        'core/translations.js',
        'core/config.js',
        'core/coordination.js',
        'core/storage.js',
        'sync/backup.js',
        'sync/local-folder.js',
        'sync/coordinator.js',
        'sync/providers.js',
        'sync/remote-watch.js',
        'sync/crypto.js',
        'sync/backup-passphrase.js',
        'sync/merge.js',
        'ui/recovery.js',
        'ui/help.js',
        'ui/backup-restore.js',
        'ui/sync-wizard.js',
        'ui/render.js',
        'ui/bookmarks.js',
        'data/transfer.js',
        'core/utils.js',
        'app.js',
    ];
    const baseUrl = new URL('.', document.currentScript.src);

    function loadNext(index) {
        if (index >= modules.length) return;
        const script = document.createElement('script');
        script.src = new URL(`${modules[index]}?v=${version}`, baseUrl).toString();
        script.async = false;
        script.addEventListener('load', () => loadNext(index + 1), { once: true });
        script.addEventListener('error', () => {
            console.error(`Unable to load bookmark manager module: ${modules[index]}`);
        }, { once: true });
        document.head.append(script);
    }

    loadNext(0);
})();
