/* Prepare a portable/static-hosting directory without npm or a build tool. */
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, '..');
const requestedOutput = process.argv[2] || 'dist/site';
const outputDirectory = isAbsolute(requestedOutput)
    ? resolve(requestedOutput)
    : resolve(repositoryRoot, requestedOutput);
const outputRelativePath = relative(repositoryRoot, outputDirectory);

if (
    outputRelativePath !== 'dist'
    && !outputRelativePath.startsWith(`dist${sep}`)
) {
    throw new Error('The package output directory must be dist or one of its child directories.');
}

const requiredEntries = [
    ['index.html', 'index.html'],
    ['css', 'css'],
    ['js', 'js'],
    ['README.md', 'README.md'],
    ['LICENSE', 'LICENSE'],
    ['docs', 'docs'],
    ['tests/index.html', 'tests/index.html'],
    ['tests/styles.css', 'tests/styles.css'],
    ['tests/test-runner.js', 'tests/test-runner.js'],
];
const optionalEntries = [
    ['LICENSE.md', 'LICENSE.md'],
];

async function copyEntry(sourceRelativePath, targetRelativePath, required) {
    const source = resolve(repositoryRoot, sourceRelativePath);
    const target = resolve(outputDirectory, targetRelativePath);
    try {
        await stat(source);
    } catch {
        if (required) throw new Error(`Required package entry is missing: ${sourceRelativePath}`);
        return false;
    }
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
    return true;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const [source, target] of requiredEntries) await copyEntry(source, target, true);
for (const [source, target] of optionalEntries) await copyEntry(source, target, false);
await writeFile(resolve(outputDirectory, '.nojekyll'), '', 'utf8');

const sourceUrl = process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`
    : '';
const revision = process.env.GITHUB_REF_TYPE === 'tag'
    ? process.env.GITHUB_REF_NAME
    : (process.env.GITHUB_SHA || '').slice(0, 12);
const packageTitle = process.env.GITHUB_REPOSITORY?.split('/').pop() || 'HJ Bookmarks';
const metadata = [
    revision ? `Revision: ${revision}` : '',
    sourceUrl ? `Source: ${sourceUrl}` : '',
].filter(Boolean);
const buildInformation = [
    `${packageTitle} portable package`,
    ...metadata,
    '',
    'Open index.html in a modern browser. No installation or build step is required.',
].join('\n');
await writeFile(resolve(outputDirectory, 'BUILD-INFO.txt'), `${buildInformation}\n`, 'utf8');

const packagedIndex = await readFile(resolve(outputDirectory, 'index.html'), 'utf8');
if (!packagedIndex.includes('js/app.js') || !packagedIndex.includes('css/style.css')) {
    throw new Error('The packaged index.html does not reference the application assets.');
}

console.log(`Prepared static package: ${outputRelativePath}`);
console.log('Included application files, documentation, and dependency-free browser tests.');
