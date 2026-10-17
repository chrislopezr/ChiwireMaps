// Seam: the project's name and capybara icon as the phone shows them (tab, home-screen shortcut, map panel).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, openPage, waitFor } = require('./browser');

const skip = !CHROME && 'Chrome not installed';

test('the map page is called Chiwire Maps and shows the capybara in the tab, on the home screen and in the panel', { skip }, async () => {
    const page = await openPage();
    try {
        assert.equal(await page.eval('document.title'), 'Chiwire Maps');
        const links = await page.eval(`Array.from(document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]'),
            l => l.rel + ' ' + l.getAttribute('href')).sort()`);
        assert.deepEqual(links, ['apple-touch-icon /icon-192.png', 'icon /favicon.ico', 'icon /icon-192.png']);
        const served = await page.eval(`Promise.all(['/favicon.ico', '/icon-192.png'].map(u => fetch(u).then(r => r.status + ' ' + r.headers.get('content-type'))))`);
        assert.match(served[0], /^200 image\/(x-icon|vnd\.microsoft\.icon)/);
        assert.equal(served[1], '200 image/png');
        await waitFor(async () => (await page.eval(`(i => i.complete && i.naturalWidth)(document.getElementById('logo'))`)) === 192);
        assert.equal(await page.visible('#logo'), true);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});
