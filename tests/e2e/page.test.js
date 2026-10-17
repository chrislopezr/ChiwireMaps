// Seam: the map page as a phone sees it. A fake dongle (fake_dongle.py, same routes as routes.h) serves the
// real index.h and SD card files; headless Chrome loads the page; we check for script errors and the readout.
// Skipped when Chrome is not installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].find(
    bin => spawnSync('which', [bin]).status === 0);

function startFakeDongle(port) {
    const proc = spawn('python3', ['-I', path.join(__dirname, 'fake_dongle.py'), REPO, String(port)], { stdio: 'ignore' });
    return new Promise(resolve => setTimeout(() => resolve(proc), 800));
}

function loadPage(url) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-chrome-'));
    const run = spawnSync(CHROME, [
        '--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${profile}`, '--window-size=412,860',
        '--enable-logging=stderr', '--v=0', '--virtual-time-budget=6000', '--dump-dom', url,
    ], { encoding: 'utf8', timeout: 60000 });
    fs.rmSync(profile, { recursive: true, force: true });
    const consoleErrors = run.stderr.split('\n').filter(l => /CONSOLE/.test(l) && /Uncaught|Error/.test(l));
    return { dom: run.stdout, consoleErrors };
}

test('map page starts without script errors and shows the GPS position in UTM', { skip: !CHROME && 'Chrome not installed' }, async () => {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const dongle = await startFakeDongle(port);
    try {
        const { dom, consoleErrors } = loadPage(`http://127.0.0.1:${port}/`);
        assert.deepEqual(consoleErrors, []);
        // The fake dongle reports a fix at Puerta del Sol, Madrid: zone 30T
        assert.match(dom, /UTM 30T 4402\d\d 44742\d\d/);
        assert.match(dom, /📍 GPS · 9 🛰️/);
    } finally {
        dongle.kill();
    }
});
