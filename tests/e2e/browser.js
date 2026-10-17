// Test helper: drives headless Chrome over the DevTools protocol (Node's built-in WebSocket, no dependencies),
// against the fake dongle. Lets tests click buttons and read the page like a user would.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].find(bin => spawnSync('which', [bin]).status === 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        try { const v = await fn(); if (v) return v; } catch (e) { /* not ready yet */ }
        if (Date.now() > end) throw new Error('timed out waiting');
        await sleep(100);
    }
}

async function openPage(pathname = '/', env = {}) {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const debugPort = 19000 + Math.floor(Math.random() * 1000);
    const dongle = spawn('python3', ['-I', path.join(__dirname, 'fake_dongle.py'), REPO, String(port)],
        { stdio: 'ignore', env: { ...process.env, ...env } });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-chrome-'));
    const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${profile}`,
        '--window-size=412,860', `--remote-debugging-port=${debugPort}`, 'about:blank'], { stdio: 'ignore' });
    const targets = await waitFor(async () => {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        return list.find(t => t.type === 'page');
    });
    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = msg => {
        const data = JSON.parse(msg.data);
        if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
        if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description);
    };
    const send = (method, params = {}) => new Promise(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
    await send('Runtime.enable');
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/ping`).catch(() => null)) !== null);
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${pathname}` });

    const page = {
        errors,
        async eval(expression) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
            return r.result.result.value;
        },
        text: selector => page.eval(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`),
        visible: selector => page.eval(`(e => !!e && !e.hidden && e.offsetParent !== null)(document.querySelector(${JSON.stringify(selector)}))`),
        click: selector => page.eval(`document.querySelector(${JSON.stringify(selector)}).click()`),
        type: (selector, value) => page.eval(`document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`),
        waitForText: (selector, pattern, ms) => waitFor(async () => pattern.test((await page.text(selector)) || ''), ms),
        // Saves a PNG of what the phone would show (for looking at layouts while developing)
        async screenshot(file) {
            const r = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        },
        async close() {
            ws.close();
            chrome.kill();
            dongle.kill();
            await sleep(200);
            fs.rmSync(profile, { recursive: true, force: true });
        },
    };
    return page;
}

module.exports = { CHROME, openPage, waitFor };
