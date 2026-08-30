/* Optional CI checks. The application and browser test page do not depend on Node.js. */
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testsDirectory, '..');
const failures = [];
let checkCount = 0;

function check(condition, message) {
    checkCount += 1;
    if (!condition) failures.push(message);
}

async function collectFiles(directory, extensions) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collectFiles(path, extensions));
        else if (extensions.has(extname(entry.name))) files.push(path);
    }
    return files;
}

async function checkJavaScriptSyntax() {
    const files = [
        ...await collectFiles(resolve(repositoryRoot, 'js'), new Set(['.js', '.mjs'])),
        ...await collectFiles(resolve(repositoryRoot, 'tests'), new Set(['.js', '.mjs'])),
    ].sort();
    files.forEach((path) => {
        const result = spawnSync(process.execPath, ['--check', path], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        });
        check(
            result.status === 0,
            `JavaScript syntax failed for ${path}:\n${result.stderr || result.stdout}`,
        );
    });
    console.log(`Checked JavaScript syntax in ${files.length} files.`);
}

function extractObjectKeys(source) {
    return [...source.matchAll(/^        ([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]);
}

function duplicateValues(values) {
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

async function checkDocumentStructure() {
    const [html, appSource, translations, css, testHtml, loaderSource] = await Promise.all([
        readFile(resolve(repositoryRoot, 'index.html'), 'utf8'),
        readFile(resolve(repositoryRoot, 'js/app.js'), 'utf8'),
        readFile(resolve(repositoryRoot, 'js/core/translations.js'), 'utf8'),
        readFile(resolve(repositoryRoot, 'css/style.css'), 'utf8'),
        readFile(resolve(repositoryRoot, 'tests/index.html'), 'utf8'),
        readFile(resolve(repositoryRoot, 'js/script.js'), 'utf8'),
    ]);

    const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const duplicateIds = duplicateValues(htmlIds);
    check(!duplicateIds.length, `Duplicate HTML IDs: ${duplicateIds.join(', ')}`);

    const cachedIdsBlock = appSource.match(/const ids = \[(.*?)\n    \];/s)?.[1] || '';
    const cachedIds = [...cachedIdsBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const htmlIdSet = new Set(htmlIds);
    const missingCachedIds = cachedIds.filter((id) => !htmlIdSet.has(id));
    check(!missingCachedIds.length, `DOM cache references missing IDs: ${missingCachedIds.join(', ')}`);

    const translationParts = translations.split('    en: {');
    check(translationParts.length === 2, 'Could not locate both translation dictionaries.');
    if (translationParts.length === 2) {
        const chineseKeys = extractObjectKeys(translationParts[0]);
        const englishKeys = extractObjectKeys(translationParts[1]);
        const duplicateChinese = duplicateValues(chineseKeys);
        const duplicateEnglish = duplicateValues(englishKeys);
        check(!duplicateChinese.length, `Duplicate Chinese translation keys: ${duplicateChinese.join(', ')}`);
        check(!duplicateEnglish.length, `Duplicate English translation keys: ${duplicateEnglish.join(', ')}`);
        const chineseSet = new Set(chineseKeys);
        const englishSet = new Set(englishKeys);
        const asymmetricKeys = [
            ...chineseKeys.filter((key) => !englishSet.has(key)),
            ...englishKeys.filter((key) => !chineseSet.has(key)),
        ];
        check(!asymmetricKeys.length, `Translation dictionaries differ: ${asymmetricKeys.join(', ')}`);

        const staticTranslationKeys = [...html.matchAll(
            /data-i18n(?:-[a-z-]+)?="([A-Za-z][A-Za-z0-9]*)"/g,
        )].map((match) => match[1]);
        const missingTranslations = [...new Set(staticTranslationKeys)]
            .filter((key) => !chineseSet.has(key));
        check(!missingTranslations.length, `HTML references missing translations: ${missingTranslations.join(', ')}`);
        console.log(`Checked ${chineseKeys.length} bilingual translation keys.`);
    }

    check(
        (css.match(/{/g) || []).length === (css.match(/}/g) || []).length,
        'CSS opening and closing brace counts differ.',
    );

    const productionVersions = [...html.matchAll(/[?&]v=([0-9-]+)/g)].map((match) => match[1]);
    const testVersions = [...testHtml.matchAll(/[?&]v=([0-9-]+)/g)].map((match) => match[1]);
    const loaderVersion = loaderSource.match(/const version = '([^']+)'/)?.[1] || '';
    const versions = [...productionVersions, ...testVersions, loaderVersion].filter(Boolean);
    check(versions.length > 0, 'No cache version markers were found.');
    check(new Set(versions).size === 1, `Cache versions are inconsistent: ${[...new Set(versions)].join(', ')}`);

    const localReferences = [
        ...[...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)]
            .map((match) => ({ base: repositoryRoot, value: match[1].split('?')[0] })),
        ...[...testHtml.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)]
            .map((match) => ({ base: testsDirectory, value: match[1].split('?')[0] })),
    ].filter(({ value }) => value && !/^(?:data:|https?:|#)/i.test(value));
    for (const { base, value: reference } of localReferences) {
        const path = resolve(base, reference);
        let exists = false;
        try {
            exists = (await stat(path)).isFile();
        } catch {
            exists = false;
        }
        check(exists, `Referenced local file does not exist: ${reference}`);
    }
    console.log(`Checked ${htmlIds.length} unique production HTML IDs and local asset references.`);
}

await checkJavaScriptSyntax();
await checkDocumentStructure();

if (failures.length) {
    console.error(`\n${failures.length} static check failure${failures.length === 1 ? '' : 's'}:`);
    failures.forEach((failure, index) => console.error(`\n${index + 1}. ${failure}`));
    process.exitCode = 1;
} else {
    console.log(`All ${checkCount} static checks passed.`);
}
