// Seam: the info panel as the phone shows it, against the fake dongle (GPS fix at Puerta del Sol, Madrid).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, openPage } = require('./browser');

const skip = !CHROME && 'Chrome not installed';

test('the map cannot be moved away from the area that has maps (a far-off centre gave wrong sun times)', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.click('#gotoBtn');
        await page.type('#gotoInput', '-67.5, 82'); // Antarctica: the only place with sunrise 00:49, sunset 15:49 in October
        await page.click('#gotoGo');
        await page.waitForText('#rowSource', /Map center/);
        const [lat, lon] = (await page.text('#rowLatLon')).split(' · ')[0].split(', ').map(Number);
        assert.ok(lat > 34 && lat < 46 && lon > -12 && lon < 6, `map centre ${lat}, ${lon} should stay over Spain`);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('the sun row says which day its times are for (a wrong phone date shows at a glance)', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        const today = await page.eval(`new Date().toLocaleDateString([], { day: 'numeric', month: 'short' })`);
        assert.ok((await page.text('#rowSun')).includes(today), `sun row should include "${today}"`);
    } finally {
        await page.close();
    }
});

test('north box: grid and magnetic north to 0.01°, drawn to scale, with the reference and zone used', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        // Puerta del Sol (fake GPS): exact values computed by the page's own tested maths
        const gn = await page.eval('Geo.gridConvergence(40.4168, -3.7038, 30)');
        const text = await page.text('#northText');
        assert.ok(text.includes(`GN ${Math.abs(gn).toFixed(2)}°${gn >= 0 ? 'E' : 'W'}`), `GN in "${text}"`);
        assert.match(text, /MN \d+\.\d\d°[EW] ±0\.4°/);
        assert.match(text, /GPS · zone 30/);
        const angle = await page.eval(`document.getElementById('arrowGrid').getAttribute('transform')`);
        assert.equal(angle, `rotate(${gn.toFixed(2)})`, 'grid arrow drawn at the real angle');
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('zone lock: choosing zone 31 shows Madrid in zone 31 (UTM, grid north) and is remembered', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        await page.eval(`(s => { s.value = '31'; s.dispatchEvent(new Event('change')); })(document.getElementById('zoneLock'))`);
        await page.waitForText('#rowUtm', /UTM 31T/);
        const gn = await page.eval('Geo.gridConvergence(40.4168, -3.7038, 31)');
        assert.ok((await page.text('#northText')).includes(`GN ${Math.abs(gn).toFixed(2)}°W`), 'GN for zone 31');
        await page.eval('location.reload()');
        await page.waitForText('#rowUtm', /UTM 31T/);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});
