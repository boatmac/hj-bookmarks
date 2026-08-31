/* Audit repository history or a prepared package for credentials and private endpoint examples. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsDirectory, '..');
const argumentsList = process.argv.slice(2);
const includeHistory = argumentsList.includes('--history');
const positionalArguments = argumentsList.filter((argument) => !argument.startsWith('--'));
if (positionalArguments.length > 1) throw new Error('Provide at most one directory to audit.');
if (includeHistory && positionalArguments.length) {
    throw new Error('History auditing applies to the repository root and cannot use a package directory.');
}

const auditRoot = positionalArguments.length
    ? resolve(repositoryRoot, positionalArguments[0])
    : repositoryRoot;
const auditRelativePath = relative(repositoryRoot, auditRoot);
if (auditRelativePath.startsWith(`..${sep}`) || auditRelativePath === '..') {
    throw new Error('The audit directory must be inside the repository.');
}

const maximumFileSize = 10 * 1024 * 1024;
const ignoredRepositoryDirectories = new Set(['.git', 'dist', 'node_modules']);
const textExtensions = new Set([
    '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.xml', '.yaml', '.yml',
]);
const textBasenames = new Set(['LICENSE', '.gitignore', '.nojekyll']);
const approvedPublicHosts = new Set([
    'app.koofr.net',
    'boatmac.github.io',
    'developers.cloudflare.com',
    'docs.github.com',
    'docs.netlify.com',
    'exampleaccount.blob.core.chinacloudapi.cn',
    'exampleaccount.blob.core.windows.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'github.com',
    'keepachangelog.com',
    'learn.microsoft.com',
    'raw.githubusercontent.com',
    'semver.org',
    'support.github.com',
    'www.w3.org',
]);
const findings = [];
let currentFileCount = 0;
let historicalBlobCount = 0;

const credentialRules = [
    {
        id: 'literal-basic-authorization',
        pattern: /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{12,}={0,2}\b/gi,
    },
    {
        id: 'literal-bearer-authorization',
        pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    },
    {
        id: 'github-classic-token',
        pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    },
    {
        id: 'github-fine-grained-token',
        pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
    },
    {
        id: 'aws-access-key',
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    },
    {
        id: 'private-key-material',
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    },
    {
        id: 'credential-in-url',
        pattern: /\bhttps?:\/\/[^\s/"'`<>:@]+:[^\s/"'`<>@]+@/gi,
    },
    {
        id: 'secret-in-query-string',
        pattern: /[?&](?:access_token|api_key|client_secret|password|token)=[A-Za-z0-9._~+/=-]{8,}/gi,
    },
];

function normalizedLocation(path) {
    return path.split(sep).join('/');
}

function lineNumberAt(source, index) {
    let line = 1;
    for (let offset = 0; offset < index; offset += 1) {
        if (source.charCodeAt(offset) === 10) line += 1;
    }
    return line;
}

function addFinding(rule, location, source = '', index = 0) {
    const line = source ? lineNumberAt(source, index) : 0;
    const key = `${rule}\u0000${location}\u0000${line}`;
    if (findings.some((finding) => finding.key === key)) return;
    findings.push({ key, rule, location, line });
}

function printableAscii(buffer) {
    return (buffer.toString('latin1').match(/[\x20-\x7e]{8,}/g) || []).join('\n');
}

function inspectCredentials(source, location) {
    for (const rule of credentialRules) {
        const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
        const match = pattern.exec(source);
        if (match) addFinding(rule.id, location, source, match.index);
    }
}

function inspectLocalPaths(source, location) {
    const patterns = [
        /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/](?!Example(?:[\\/]|$)|Public(?:[\\/]|$))[^\s"'`<>]+/gi,
        /\/(?:Users|home)\/(?!example(?:\/|$)|public(?:\/|$))[^\s"'`<>]+/gi,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(source);
        if (match) addFinding('personal-local-path', location, source, match.index);
    }
}

function trimUrlPunctuation(value) {
    return value.replace(/[.,;:!?]+$/, '');
}

function inspectRemoteUrls(source, location, { allowLegacyExamples = false } = {}) {
    const genericKoofrRoot = 'https://app.koofr.net/dav/Koofr';
    const pattern = /\bhttps?:\/\/[^\s"'`<>{}\[\])]+/gi;
    for (const match of source.matchAll(pattern)) {
        const raw = trimUrlPunctuation(match[0]);
        let url;
        try {
            url = new URL(raw);
        } catch {
            continue;
        }
        if (url.username || url.password) {
            addFinding('credential-in-url', location, source, match.index);
            continue;
        }
        const sasSignature = url.searchParams.get('sig');
        if (sasSignature && !/^example(?:-|$)/i.test(sasSignature)) {
            addFinding('azure-sas-signature', location, source, match.index);
        }
        const hostname = url.hostname.toLocaleLowerCase('en-US');
        const exampleHost = hostname === 'example.com'
            || hostname.endsWith('.example.com')
            || hostname.endsWith('.example');
        const placeholderHost = raw.includes('$') || !/^[\x20-\x7e]+$/.test(raw);
        if (!placeholderHost && !exampleHost && !approvedPublicHosts.has(hostname)) {
            addFinding('unapproved-public-url-host', location, source, match.index);
        }
        if (
            /\.blob\.core\.(?:windows\.net|chinacloudapi\.cn)$/i.test(hostname)
            && !approvedPublicHosts.has(hostname)
        ) {
            addFinding('non-example-azure-blob-endpoint', location, source, match.index);
        }
        if (/^(?:10|127)\./.test(url.hostname)
            || /^192\.168\./.test(url.hostname)
            || /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)) {
            addFinding('private-network-url', location, source, match.index);
        }
        if (hostname === 'app.koofr.net') {
            if (/^\/dav(?:\/|$)/i.test(url.pathname)) {
                const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
                const knownLegacyExample = allowLegacyExamples && (
                    /\/dav\/\.\.\.$/.test(match[0])
                    || normalized === `${genericKoofrRoot}/Bookmarks`
                );
                if (
                    !knownLegacyExample
                    && normalized !== genericKoofrRoot
                    && !normalized.startsWith(`${genericKoofrRoot}/Example-`)
                ) {
                    addFinding('non-example-koofr-endpoint', location, source, match.index);
                }
            }
            continue;
        }
        if (/^dav\./i.test(url.hostname) || /^\/dav(?:\/|$)/i.test(url.pathname)) {
            if (url.hostname !== 'dav.example.com' && !url.hostname.endsWith('.example.com')) {
                addFinding('non-example-webdav-endpoint', location, source, match.index);
            }
        }
    }
}

function inspectContent(buffer, location, path = '', options = {}) {
    const extension = extname(path).toLocaleLowerCase('en-US');
    const basename = path.split(/[\\/]/).pop() || '';
    const isText = textExtensions.has(extension) || textBasenames.has(basename);
    const source = isText ? buffer.toString('utf8') : printableAscii(buffer);
    if (!source) return;
    inspectCredentials(source, location);
    inspectLocalPaths(source, location);
    inspectRemoteUrls(source, location, options);
    if (
        !options.allowLegacyExamples
        && normalizedLocation(location).startsWith('js/')
        && !['js/core/utils.js', 'js/script.js'].includes(normalizedLocation(location))
    ) {
        const directLog = /\bconsole\.(?:error|warn)\s*\(/.exec(source);
        if (directLog) addFinding('unsanitized-production-log', location, source, directLog.index);
    }
}

async function collectCurrentFiles(directory, root = directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
            entry.isDirectory()
            && root === repositoryRoot
            && ignoredRepositoryDirectories.has(entry.name)
        ) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) files.push(...await collectCurrentFiles(path, root));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

async function auditCurrentFiles() {
    const rootStatus = await stat(auditRoot);
    if (!rootStatus.isDirectory()) throw new Error('The audit target must be a directory.');
    const files = await collectCurrentFiles(auditRoot);
    for (const path of files) {
        const fileStatus = await stat(path);
        if (fileStatus.size > maximumFileSize) {
            addFinding('file-exceeds-audit-size-limit', normalizedLocation(relative(auditRoot, path)));
            continue;
        }
        currentFileCount += 1;
        inspectContent(
            await readFile(path),
            normalizedLocation(relative(auditRoot, path)),
            path,
        );
    }

    if (auditRoot !== repositoryRoot) {
        const relativeFiles = new Set(files.map((path) => normalizedLocation(relative(auditRoot, path))));
        for (const required of ['index.html', 'README.md', 'LICENSE', 'BUILD-INFO.txt']) {
            if (!relativeFiles.has(required)) addFinding('required-package-file-missing', required);
        }
        const forbiddenRoots = ['.git/', '.github/', 'scripts/'];
        for (const path of relativeFiles) {
            if (forbiddenRoots.some((prefix) => path.startsWith(prefix))) {
                addFinding('maintenance-file-in-public-package', path);
            }
        }
    }
}

function gitOutput(argumentsForGit, options = {}) {
    return execFileSync('git', argumentsForGit, {
        cwd: repositoryRoot,
        encoding: options.encoding,
        maxBuffer: 32 * 1024 * 1024,
    });
}

function auditReachableHistory() {
    const objectLines = String(gitOutput(['rev-list', '--objects', '--all'], { encoding: 'utf8' }))
        .split(/\r?\n/)
        .filter(Boolean);
    const objectPaths = new Map();
    for (const line of objectLines) {
        const separator = line.indexOf(' ');
        if (separator < 0) continue;
        const objectId = line.slice(0, separator);
        if (!objectPaths.has(objectId)) objectPaths.set(objectId, line.slice(separator + 1));
    }
    const objectIds = [...objectPaths.keys()];
    const typeResult = spawnSync(
        'git',
        ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
        {
            cwd: repositoryRoot,
            input: `${objectIds.join('\n')}\n`,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        },
    );
    if (typeResult.status !== 0) {
        throw new Error(typeResult.stderr || 'Unable to inspect Git history objects.');
    }
    for (const line of typeResult.stdout.split(/\r?\n/).filter(Boolean)) {
        const [objectId, type, rawSize] = line.split(' ');
        if (type !== 'blob') continue;
        const path = objectPaths.get(objectId) || 'unknown';
        const size = Number(rawSize);
        if (!Number.isFinite(size) || size > maximumFileSize) {
            addFinding('historical-file-exceeds-audit-size-limit', `history:${objectId.slice(0, 12)}:${path}`);
            continue;
        }
        historicalBlobCount += 1;
        inspectContent(
            gitOutput(['cat-file', 'blob', objectId]),
            `history:${objectId.slice(0, 12)}:${normalizedLocation(path)}`,
            path,
            { allowLegacyExamples: true },
        );
    }
}

function runRuleSelfTest() {
    const initialLength = findings.length;
    const root = 'https://app.koofr.net/dav/Koofr';
    const authorizationName = ['Author', 'ization'].join('');
    const basicName = ['Bas', 'ic'].join('');
    const bearerName = ['Bear', 'er'].join('');
    const samples = [
        `${authorizationName}: ${basicName} ${['dGVzdC11c2Vy', 'OnRlc3QtcGFzc3dvcmQ='].join('')}`,
        `${authorizationName}: ${bearerName} ${['example', '-bearer-value'].join('')}`,
        ['gh', 'p_exampletokenvalue1234567890'].join(''),
        ['github', '_pat_exampletokenvalue123456789012345678901234567890'].join(''),
        ['AKIA', 'EXAMPLEKEY123456'].join(''),
        ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
        `${'https'}://${'example-user'}:${'example-password'}@dav.example.com/Example-Bookmarks/`,
        `https://dav.example.com/Example-Bookmarks/?${['access_', 'token'].join('')}=${['example', 'value1234'].join('')}`,
        `${root}/Example-Bookmarks/?${['s', 'ig'].join('')}=${['sensitive', 'signature1234'].join('-')}`,
        ['C:', 'Users', 'Private Person', 'Bookmarks'].join('\\'),
        `${'https'}://${['192', '168', '1', '10'].join('.')}/${['d', 'av'].join('')}/Example-Bookmarks/`,
        `${root}/${['Private', 'Folder'].join('-')}/`,
        `${'https'}://${['private', 'account'].join('')}.${['blob', 'core', 'windows', 'net'].join('.')}/example-container/`,
    ].join('\n');
    inspectContent(Buffer.from(samples), 'audit-rule-self-test.txt', 'audit-rule-self-test.txt');
    const detected = new Set(findings.slice(initialLength).map((finding) => finding.rule));
    const expected = [
        'literal-basic-authorization',
        'literal-bearer-authorization',
        'github-classic-token',
        'github-fine-grained-token',
        'aws-access-key',
        'private-key-material',
        'credential-in-url',
        'secret-in-query-string',
        'azure-sas-signature',
        'personal-local-path',
        'private-network-url',
        'unapproved-public-url-host',
        'non-example-koofr-endpoint',
        'non-example-azure-blob-endpoint',
    ];
    const missing = expected.filter((rule) => !detected.has(rule));
    findings.splice(initialLength);
    if (missing.length) throw new Error(`Public audit rule self-test failed: ${missing.join(', ')}`);
}

runRuleSelfTest();
await auditCurrentFiles();
if (includeHistory) auditReachableHistory();

if (findings.length) {
    console.error(`Public content audit failed with ${findings.length} finding${findings.length === 1 ? '' : 's'}:`);
    findings.forEach((finding, index) => {
        const suffix = finding.line ? `:${finding.line}` : '';
        console.error(`${index + 1}. [${finding.rule}] ${finding.location}${suffix}`);
    });
    console.error('Matched values are intentionally omitted from logs.');
    process.exitCode = 1;
} else {
    const historyMessage = includeHistory ? ` and ${historicalBlobCount} reachable historical blobs` : '';
    console.log(`Public content audit passed for ${currentFileCount} current files${historyMessage}.`);
}
