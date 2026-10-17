// Seam: marks and routes as the phone user drives them, against the fake dongle (GPS fix at Puerta del Sol).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, openPage, waitFor } = require('./browser');

const skip = !CHROME && 'Chrome not installed';

// Go to a UTM position and wait until the map has finished moving there: the readout is within 30 m
// (the map centre snaps to whole screen pixels, ~15 m at zoom 13)
async function goTo(page, text) {
    const [, e, n] = text.split(' ').map(Number);
    await page.click('#gotoBtn');
    await page.type('#gotoInput', text);
    await page.click('#gotoGo');
    await waitFor(async () => {
        const m = (await page.text('#rowUtm')).match(/UTM 30T (\d+) (\d+)/);
        return m && Math.abs(m[1] - e) <= 30 && Math.abs(m[2] - n) <= 30;
    });
}

// Texts of the list rows, e.g. ['📍 Camp', '🚩 Walk · 1.23 km', '1 ...']
const rows = page => page.eval(`Array.from(document.querySelectorAll('#marksList [data-id]'), r => r.dataset.label)`);
const clickIn = (page, label, cls) => page.eval(
    `Array.from(document.querySelectorAll('#marksList [data-id]')).find(r => r.dataset.label === ${JSON.stringify(label)})` +
    `.querySelector('.${cls}').click()`);
const setTag = (page, label, cls, value) => page.eval(
    `(i => { i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change')); })(` +
    `Array.from(document.querySelectorAll('#marksList [data-id]')).find(r => r.dataset.label === ${JSON.stringify(label)})` +
    `.querySelector('.${cls}'))`);
const markersOnMap = page => page.eval(`document.querySelectorAll('.mark-icon').length`);

test('standalone mark: add where the map is, change icon and tag, still there after reload', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#marksBtn');
        await page.click('#marksAddMark');
        assert.deepEqual(await rows(page), ['📍 Mark 1']);
        await clickIn(page, '📍 Mark 1', 'm-icon');          // next icon in the palette
        await setTag(page, '⛺ Mark 1', 'm-tag', 'Camp');
        assert.deepEqual(await rows(page), ['⛺ Camp']);
        assert.equal(await markersOnMap(page), 1);
        await page.eval('location.reload()');
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#marksBtn');
        assert.deepEqual(await rows(page), ['⛺ Camp']);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('route: connected points in order, reorder, remove one, distances shown, clear all', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#marksBtn');
        await page.click('#marksAddRoute');
        await page.click('#marksAddPoint');                     // at the GPS position (Sol)
        await goTo(page, '30T 441290 4474257');                 // 1 km east
        await page.click('#marksAddPoint');
        await goTo(page, '30T 441290 4475257');                 // then 1 km north
        await page.click('#marksAddPoint');
        let list = await rows(page);
        assert.match(list[0], /^🚩 Route 1 · (1\.9[6-9]|2\.0[0-4]) km$/, '1 km east + 1 km north, ±30 m per point');
        assert.deepEqual(list.slice(1), ['1 Point 1', '2 Point 2', '3 Point 3']);
        assert.equal(await page.eval(`document.querySelector('#marksList .m-dist').textContent`), list[0].split(' · ')[1],
            'total distance visible on the route row');
        assert.equal(await page.eval(`document.querySelectorAll('.route-line').length`), 1);
        await clickIn(page, '1 Point 1', 'm-down');
        assert.deepEqual((await rows(page)).slice(1), ['1 Point 2', '2 Point 1', '3 Point 3']);
        await clickIn(page, '2 Point 1', 'm-del');
        list = await rows(page);
        assert.match(list[0], /^🚩 Route 1 · (9[6-9]\d m|1\.0[0-4] km)$/);
        assert.deepEqual(list.slice(1), ['1 Point 2', '2 Point 3']);
        await page.eval('window.confirm = () => true');
        await page.click('#marksClear');
        assert.deepEqual(await rows(page), []);
        assert.equal(await markersOnMap(page), 0);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('save to a file and load it back (GeoJSON), and export GPX for other apps', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        // Capture downloads instead of saving them
        await page.eval(`window.__saved = []; URL.createObjectURL = b => { window.__saved.push(b); return 'blob:x'; }`);
        await page.click('#marksBtn');
        await page.click('#marksAddMark');
        await page.click('#marksAddRoute');
        await page.click('#marksAddPoint');
        await page.click('#marksSave');
        await page.click('#marksSaveGpx');
        const [json, gpx] = await page.eval(`Promise.all(window.__saved.map(b => b.text()))`);
        assert.equal(JSON.parse(json).features.length, 2);
        assert.match(gpx, /<wpt lat="40\.4168" lon="-3\.7038"><name>Mark 1<\/name><\/wpt>/);
        await page.eval('window.confirm = () => true');
        await page.click('#marksClear');
        await page.eval(`(input => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(json)}], 'marks.json'));
            input.files = dt.files; input.dispatchEvent(new Event('change')); })(document.getElementById('marksLoad'))`);
        await waitFor(async () => (await rows(page)).length === 3);
        assert.deepEqual(await rows(page), ['📍 Mark 1', '🚩 Route 1 · 0 m', '1 Point 1']);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});
