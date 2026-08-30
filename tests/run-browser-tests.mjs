/* Optional headless CI runner for tests/index.html. No npm packages are required. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testsDirectory, '..');
const testPageUrl = pathToFileURL(resolve(testsDirectory, 'index.html')).href;
const startupTimeoutMs = 20_000;
const testTimeoutMs = 90_000;

function sleep(milliseconds) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function browserCandidates() {
    const candidates = [process.env.CHROME_PATH, process.env.BROWSER_PATH].filter(Boolean);
    if (process.platform === 'win32') {
        candidates.push(
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'msedge',
            'chrome',
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            'google-chrome',
            'chromium',
        );
    } else {
        candidates.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            'google-chrome',
            'google-chrome-stable',
            'chromium',
            'chromium-browser',
        );
    }
    return [...new Set(candidates)];
}

function findBrowser() {
    for (const candidate of browserCandidates()) {
        const hasPathSeparator = /[\\/]/.test(candidate);
        if (hasPathSeparator) {
            if (!existsSync(candidate)) continue;
            return { executable: candidate, version: candidate };
        }
        const version = spawnSync(candidate, ['--version'], {
            encoding: 'utf8',
            timeout: 3_000,
        });
        if (version.status === 0) {
            const output = `${version.stdout || ''}\n${version.stderr || ''}`;
            const versionLabel = output.match(
                /(?:Google Chrome|Chromium|Microsoft Edge|HeadlessChrome)[^\r\n]*/i,
            )?.[0];
            return {
                executable: candidate,
                version: versionLabel || candidate,
            };
        }
    }
    throw new Error(
        'No Chrome, Chromium, or Edge executable was found. Set CHROME_PATH to run browser tests.',
    );
}

function findFreePort() {
    return new Promise((resolvePromise, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolvePromise(address.port));
        });
    });
}

async function waitForBrowserTarget(port, browserProcess, stderrLines) {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
        if (browserProcess.exitCode != null) {
            throw new Error(`Browser exited during startup (${browserProcess.exitCode}).\n${stderrLines.join('')}`);
        }
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            if (response.ok) {
                const targets = await response.json();
                const target = targets.find((entry) => (
                    entry.type === 'page' && entry.url.includes('/tests/index.html')
                )) || targets.find((entry) => entry.type === 'page');
                if (target?.webSocketDebuggerUrl) return target;
            }
        } catch {
            // The debugging endpoint is not ready yet.
        }
        await sleep(100);
    }
    throw new Error(`Browser did not expose a test page within ${startupTimeoutMs} ms.\n${stderrLines.join('')}`);
}

class DevToolsConnection {
    constructor(url) {
        if (typeof WebSocket !== 'function') {
            throw new Error('This runner requires Node.js 22 or newer for the built-in WebSocket client.');
        }
        this.socket = new WebSocket(url);
        this.nextId = 0;
        this.pending = new Map();
        this.exceptions = [];
    }

    async open() {
        await new Promise((resolvePromise, reject) => {
            this.socket.addEventListener('open', resolvePromise, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => this.handleMessage(event));
        this.socket.addEventListener('close', () => {
            this.pending.forEach(({ reject }) => reject(new Error('DevTools connection closed.')));
            this.pending.clear();
        });
        await this.send('Runtime.enable');
        await this.send('Page.enable');
    }

    handleMessage(event) {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown') {
            this.exceptions.push(message.params.exceptionDetails);
            return;
        }
        if (!message.id || !this.pending.has(message.id)) return;
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
    }

    send(method, params = {}) {
        return new Promise((resolvePromise, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve: resolvePromise, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (response.exceptionDetails) {
            throw new Error(
                response.exceptionDetails.exception?.description
                || response.exceptionDetails.text
                || 'Browser evaluation failed.',
            );
        }
        return response.result.value;
    }

    close() {
        try {
            this.socket.close();
        } catch {
            // Browser shutdown will close the socket if needed.
        }
    }
}

async function waitForTestResults(connection, browserProcess) {
    const deadline = Date.now() + testTimeoutMs;
    while (Date.now() < deadline) {
        if (browserProcess.exitCode != null) {
            throw new Error(`Browser exited before tests completed (${browserProcess.exitCode}).`);
        }
        const results = await connection.evaluate('globalThis.__TEST_RESULTS__ || null');
        if (results) return results;
        await sleep(100);
    }
    const exceptions = connection.exceptions.map((details) => (
        details.exception?.description || details.text
    )).join('\n');
    throw new Error(`Browser tests did not finish within ${testTimeoutMs} ms.${exceptions ? `\n${exceptions}` : ''}`);
}

async function removeTemporaryProfile(profilePath) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            await rm(profilePath, { recursive: true, force: true });
            return;
        } catch (error) {
            if (attempt === 5) {
                console.warn(`Unable to remove temporary browser profile: ${error.message}`);
                return;
            }
            await sleep(200);
        }
    }
}

const browser = findBrowser();
const port = await findFreePort();
const profilePath = await mkdtemp(join(tmpdir(), 'bookmark-manager-tests-'));
const stderrLines = [];
const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    '--window-size=1280,900',
    testPageUrl,
];
if (process.platform === 'linux') args.unshift('--no-sandbox');

console.log(`Browser: ${browser.version}`);
console.log(`Test page: ${testPageUrl}`);
const browserProcess = spawn(browser.executable, args, {
    cwd: repositoryRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
});
browserProcess.stderr.setEncoding('utf8');
browserProcess.stderr.on('data', (chunk) => {
    stderrLines.push(chunk);
    if (stderrLines.join('').length > 20_000) stderrLines.shift();
});

let connection;
try {
    const target = await waitForBrowserTarget(port, browserProcess, stderrLines);
    connection = new DevToolsConnection(target.webSocketDebuggerUrl);
    await connection.open();
    const results = await waitForTestResults(connection, browserProcess);

    console.log('');
    results.results.forEach((result) => {
        const marker = result.passed ? '✓' : '✗';
        console.log(`${marker} ${result.name} (${result.duration} ms)`);
        if (result.error) console.error(result.error);
    });
    console.log(`\n${results.passed}/${results.total} passed; ${results.failed} failed.`);
    if (results.failed) process.exitCode = 1;
} finally {
    connection?.close();
    const exited = new Promise((resolvePromise) => browserProcess.once('exit', resolvePromise));
    if (browserProcess.exitCode == null) browserProcess.kill();
    await Promise.race([exited, sleep(2_000)]);
    await removeTemporaryProfile(profilePath);
}
