// Seam: the Files page (list, free space, upload to /serve) as the phone uses it, against the fake dongle.
// The fake dongle's card has 10 MB free (see fake_dongle.py), so "too big" is cheap to test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, openPage, waitFor } = require('./browser');

const skip = !CHROME && 'Chrome not installed';

// Puts a generated file of `bytes` into the upload input, as if the user had picked it
const pickFile = (page, name, bytes) => page.eval(`(input => { const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(${bytes})], ${JSON.stringify(name)})); input.files = dt.files;
    input.dispatchEvent(new Event('change')); })(document.getElementById('uploadFile'))`);
const uploadsSeen = page => page.eval(`fetch('/__test/uploads').then(r => r.json())`);

test('Files page shows the free space in GB/MB/KB and percent', { skip }, async () => {
    const page = await openPage('/files');
    try {
        await page.waitForText('#storage', /10\.0 MB free of 59\.5 GB \(0\.0%\)/);
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('a file bigger than the free space is refused before anything is sent', { skip }, async () => {
    const page = await openPage('/files');
    try {
        await page.waitForText('#storage', /free/);
        await pickFile(page, 'big.zip', 11 * 1024 * 1024);
        await page.click('#uploadGo');
        await page.waitForText('#uploadStatus', /too big: 11\.0 MB, only 10\.0 MB free/i);
        assert.deepEqual(await uploadsSeen(page), []);
    } finally {
        await page.close();
    }
});

test('upload a file into a /serve folder: it appears in the list and the free space goes down', { skip }, async () => {
    const page = await openPage('/files?dir=Rutas');
    try {
        await page.waitForText('#storage', /10\.0 MB free/);
        await pickFile(page, 'track ñ.gpx', 200 * 1024);
        await page.click('#uploadGo');
        await page.waitForText('.file-list', /track ñ\.gpx \(200\.0 KB\)/);
        assert.deepEqual(await uploadsSeen(page), ['Rutas/track ñ.gpx']);
        await page.waitForText('#storage', /9\.8 MB free/); // 10 MB - 200 KB
        assert.deepEqual(page.errors, []);
    } finally {
        await page.close();
    }
});

test('a file with the same name is not overwritten', { skip }, async () => {
    const page = await openPage('/files');
    try {
        await page.waitForText('#storage', /free/);
        await pickFile(page, 'notes.txt', 10);
        await page.click('#uploadGo');
        await page.waitForText('.file-list', /notes\.txt/);
        await pickFile(page, 'notes.txt', 20);
        await page.click('#uploadGo');
        await page.waitForText('#uploadStatus', /already exists/i);
        assert.equal((await uploadsSeen(page)).length, 1);
    } finally {
        await page.close();
    }
});
