// Seam: offline search and points of interest as the phone user drives them. The search data is built from the
// hand-made OSM sample (tests/search/fixtures/tiny.osm): two towns, Villa Alta (40.000, -3.000) and Villa Baja.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CHROME, openPage, waitFor } = require('./browser');

const REPO = path.join(__dirname, '..', '..');
const PYTHON = path.join(REPO, 'tools', '.venv', 'bin', 'python');
const skip = (!CHROME && 'Chrome not installed') || (!fs.existsSync(PYTHON) && 'tools/.venv not set up');

let searchDir = null;
test.before(() => {
    if (skip) return;
    searchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-search-e2e-'));
    const run = spawnSync(PYTHON, [path.join(REPO, 'tools', 'build_search.py'),
        path.join(REPO, 'tests', 'search', 'fixtures', 'tiny.osm'), searchDir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
});
test.after(() => { if (searchDir) fs.rmSync(searchDir, { recursive: true, force: true }); });

async function search(page, text) {
    await page.click('#searchBtn');
    await page.eval(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })(document.getElementById('searchInput'))`);
    await waitFor(async () => /result/.test(await page.text('#searchStatus')));
}
const results = page => page.eval(`Array.from(document.querySelectorAll('#searchResults [data-index]'), r => r.textContent)`);
const tap = (page, i) => page.eval(`document.querySelectorAll('#searchResults [data-index]')[${i}].click()`);
const centre = page => page.eval(`(t => t.split(' · ')[0].split(', ').map(Number))(document.getElementById('rowLatLon').textContent)`);

test('street search: one result per town, tap to preview the whole street, then go there', { skip }, async () => {
    const page = await openPage('/', { BB_SEARCH_DIR: searchDir });
    try {
        await page.waitForText('#rowSource', /GPS/);
        await search(page, 'calle mayor');
        const list = await results(page);
        assert.equal(list.length, 2);                          // sorted by distance from the GPS (Madrid in the fake)
        const alta = list.findIndex(r => /Calle Mayor.*Villa Alta/.test(r));
        const baja = list.findIndex(r => /Calle Mayor.*Villa Baja/.test(r));
        assert.ok(alta >= 0 && baja >= 0, list.join(' | '));
        await tap(page, baja);                                 // preview Villa Baja's street
        await waitFor(async () => (await page.eval(`document.querySelectorAll('.search-highlight').length`)) === 1);
        const [lat, lon] = await centre(page);
        assert.ok(Math.abs(lat - 40.101) < 0.002 && Math.abs(lon - -3.1005) < 0.002, `map at ${lat}, ${lon}`);
        await tap(page, alta);                                 // change of mind: Villa Alta (2 pieces of street)
        await waitFor(async () => (await page.eval(`document.querySelectorAll('.search-highlight').length`)) === 2);
        await page.click('#searchGo');
        await page.waitForText('#rowTarget', /🎯/);
        assert.equal(await page.visible('#searchBox'), false);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('house number search marks the exact door, and a result can be kept as a mark', { skip }, async () => {
    const page = await openPage('/', { BB_SEARCH_DIR: searchDir });
    try {
        await page.waitForText('#rowSource', /GPS/);
        await search(page, 'calle mayor 14b');
        assert.match((await results(page))[0], /Calle Mayor 14B.*Villa Alta/);
        await tap(page, 0);
        await waitFor(async () => (await page.eval(`document.querySelectorAll('.search-number').length`)) === 1);
        await page.click('#searchMark');
        await page.click('#marksBtn');
        assert.deepEqual(await page.eval(`Array.from(document.querySelectorAll('#marksList [data-id]'), r => r.dataset.label)`),
            ['📍 Calle Mayor 14B']);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('points of interest layer shows metro, police and bunkers around you', { skip }, async () => {
    const page = await openPage('/', { BB_SEARCH_DIR: searchDir });
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#gotoBtn');
        await page.type('#gotoInput', '40.002, -3.001');
        await page.click('#gotoGo');
        await page.eval(`Array.from(document.querySelectorAll('.leaflet-control-layers-overlays label'))
            .find(l => /Points of interest/.test(l.textContent)).querySelector('input').click()`);
        await waitFor(async () => (await page.eval(`document.querySelectorAll('.poi-icon').length`)) >= 3);
        const icons = await page.eval(`Array.from(document.querySelectorAll('.poi-icon'), e => e.textContent).join('')`);
        for (const icon of ['🚇', '👮', '🛡️']) assert.ok(icons.includes(icon), `${icon} in ${icons}`);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('without search data on the card the search says so instead of failing', { skip: !CHROME && 'Chrome not installed' }, async () => {
    const page = await openPage('/');
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#searchBtn');
        await page.eval(`(i => { i.value = 'mayor'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })(document.getElementById('searchInput'))`);
        await page.waitForText('#searchStatus', /No search data on the card/);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});
