// Seam: the map page as a phone user drives it (clicks, typing), against the fake dongle.
// The fake dongle always reports a GPS fix at Puerta del Sol, Madrid (UTM 30T 440290 4474257).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, openPage } = require('./browser');

const skip = !CHROME && 'Chrome not installed';
const TARGET = '30T 445000 4480000'; // ~7 km north-east of Sol

// Readout "UTM 30T 440290 4474257" -> [easting, northing]
async function readoutUtm(page) {
    const m = (await page.text('#rowUtm')).match(/UTM 30T (\d+) (\d+)/);
    return [Number(m[1]), Number(m[2])];
}

function assertNear([e, n], [expE, expN], label) {
    assert.ok(Math.abs(e - expE) <= 30 && Math.abs(n - expN) <= 30, `${label}: got ${e} ${n}, want ${expE} ${expN} ±30 m`);
}

async function goTo(page, text) {
    await page.click('#gotoBtn');
    await page.type('#gotoInput', text);
    await page.click('#gotoGo');
    await page.waitForText('#rowSource', /Map center/);
}

test('"Me" button is always there and brings the map back to the GPS position', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        assert.ok(await page.visible('#meBtn'), 'Me button visible');
        await goTo(page, TARGET);
        assertNear(await readoutUtm(page), [445000, 4480000], 'after Go to');
        await page.click('#meBtn');
        await page.waitForText('#rowSource', /📍 GPS/);
        assertNear(await readoutUtm(page), [440290, 4474257], 'after Me');
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('"Target" button appears once a target is set and brings the map to it', { skip }, async () => {
    const page = await openPage();
    try {
        await page.waitForText('#rowSource', /GPS/);
        assert.equal(await page.visible('#targetBtn'), false, 'no target yet');
        await goTo(page, TARGET);
        await page.click('#meBtn');
        await page.waitForText('#rowSource', /📍 GPS/);
        assert.ok(await page.visible('#targetBtn'), 'Target button visible');
        await page.click('#targetBtn');
        await page.waitForText('#rowSource', /Map center/);
        assertNear(await readoutUtm(page), [445000, 4480000], 'after Target');
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});
