// Offline search on the phone (sdCard/search.js). The data comes from tools/build_search.py: the last tests build
// it from the hand-made OSM sample and search it, so the builder and the phone are tested together.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { loadSdCardScripts } = require('./load');

const { Search } = loadSdCardScripts('geo.js', 'search.js');
const REPO = path.join(__dirname, '..', '..');
const CASES = require('../search/fixtures/normalize_cases.json').cases;
const plain = v => JSON.parse(JSON.stringify(v)); // the scripts run in another realm

test('normalising and search words match the builder (shared cases)', () => {
    for (const [name, text, words] of CASES) {
        assert.equal(Search.normalize(name), text, name);
        assert.deepEqual(plain(Search.searchWords(name)), words, name);
    }
});

test('a query: words that pick the files, all words that must match, and an optional house number', () => {
    assert.deepEqual(plain(Search.parseQuery('Calle Mayor 14B')), { words: ['mayor'], tokens: ['calle', 'mayor'], number: '14b' });
    assert.deepEqual(plain(Search.parseQuery('peñalara')), { words: ['penalara'], tokens: ['penalara'], number: null });
    // A street called "1": the number is its name, not a house number
    assert.deepEqual(plain(Search.parseQuery('Calle 1')), { words: ['1'], tokens: ['calle', '1'], number: null });
});

test('the town can follow the street, and the house number can sit between them', () => {
    assert.deepEqual(plain(Search.parseQuery('Carrer de Balmes 100, Barcelona')),
        { words: ['balmes', 'barcelona'], tokens: ['carrer', 'de', 'balmes', 'barcelona'], number: '100' });
    // A number with no name word before it is part of the name ("Avenida 1 de Mayo")
    assert.equal(Search.parseQuery('Avenida 1 de Mayo').number, null);
    assert.equal(Search.parseQuery('Gran Vía 28 Madrid').number, '28');  // "vía" is a street word, "gran" is not
});

test('words of the town narrow the results; at least one word must be in the name itself', () => {
    const rows = [
        ['Carrer de Balmes', 'street', 'Barcelona', 4139600, 215000, 1],
        ['Carrer de Balmes', 'street', 'Llíria', 3962000, -59000, 2],
        ['Barcelona', 'place', '', 4138700, 216900, -1],
    ];
    const results = plain(Search.rank(rows, Search.parseQuery('balmes barcelona'), { lat: 40.4, lon: -3.7 }));
    assert.deepEqual(results.map(r => `${r.name}|${r.place}`), ['Carrer de Balmes|Barcelona']);
    assert.ok(results[0].exact);
    // The town alone finds the town, not every street in it
    assert.deepEqual(plain(Search.rank(rows, Search.parseQuery('barcelona'), null)).map(r => r.name), ['Barcelona']);
});

test('a short street name with a longer town name still loads the street\'s name file', async () => {
    const files = {
        '/search/manifest.json': { block: 256, poiZoom: 10, shards: ['bal', 'bar'] },
        '/search/n/bal.json': [['Carrer de Balmes', 'street', 'Barcelona', 4139600, 215000, -1]],
        '/search/n/bar.json': [['Barcelona', 'place', '', 4138700, 216900, -1]],
    };
    const search = Search.create(async url => { if (!files[url]) throw new Error('404'); return files[url]; });
    assert.deepEqual(plain(await search.query('Balmes Barcelona', null)).map(r => r.name), ['Carrer de Balmes']);
});

test('the right name files are picked for a typed word', () => {
    const shards = ['may', 'pen', 'sol', 'sanj', 'sant', 'sa$', 'mayor$'];
    assert.deepEqual(plain(Search.shardsFor('mayor', shards)), ['may', 'mayor$']);
    assert.deepEqual(plain(Search.shardsFor('san', shards)), ['sanj', 'sant']);
    assert.deepEqual(plain(Search.shardsFor('sa', shards)), ['sa$']);
    assert.deepEqual(plain(Search.shardsFor('xyz', shards)), []);
});

test('results: every word must match the start of a word in the name; closer results first', () => {
    const rows = [
        ['Calle Mayor', 'street', 'Far Town', 4100000, -300000, 1],
        ['Calle Mayor', 'street', 'Near Town', 4000100, -300000, 2],
        ['Plaza Mayor', 'street', 'Near Town', 4000200, -300000, 3],
        ['Mayorga', 'place', '', 4200000, -500000, -1],
    ];
    const results = plain(Search.rank(rows, Search.parseQuery('calle mayor'), { lat: 40.0, lon: -3.0 }));
    assert.deepEqual(results.map(r => `${r.name}|${r.place}`), ['Calle Mayor|Near Town', 'Calle Mayor|Far Town']);
    const prefix = plain(Search.rank(rows, Search.parseQuery('mayo'), { lat: 40.0, lon: -3.0 }));
    assert.equal(prefix.length, 4);
    assert.ok(prefix.every((r, i) => i === 0 || r.distance >= prefix[i - 1].distance));
});

test('a whole-word match beats a closer partial match, and a name loaded twice is listed once', () => {
    const rows = [
        ['Mayorga', 'place', '', 4000010, -300000, -1],               // right here, but only starts with "mayor"
        ['Calle Mayor', 'street', 'Far Town', 4100000, -300000, 1],
        ['Calle Mayor', 'street', 'Far Town', 4100000, -300000, 1],   // same row from a second name file
    ];
    const results = plain(Search.rank(rows, Search.parseQuery('mayor'), { lat: 40.0, lon: -3.0 }));
    assert.deepEqual(results.map(r => r.name), ['Calle Mayor', 'Mayorga']);
});

test('house numbers are found whatever the letter case', () => {
    const street = { numbers: [['12', 4000120, -300000], ['14B', 4000170, -299900]] };
    assert.deepEqual(plain(Search.findNumber(street, '14b')), { lat: 40.0017, lon: -2.999 });
    assert.equal(Search.findNumber(street, '99'), null);
});

test('a number inside a range or a list of one building is found; an exact number wins', () => {
    const street = { numbers: [['100-98', 4000100, -300000], ['91-97', 4000200, -300000], ['5, 7', 4000300, -300000],
        ['95', 4000400, -300000]] };
    assert.deepEqual(plain(Search.findNumber(street, '100')), { lat: 40.001, lon: -3 });
    assert.deepEqual(plain(Search.findNumber(street, '93')), { lat: 40.002, lon: -3 });
    assert.equal(Search.findNumber(street, '94'), null);                 // other side of the street
    assert.deepEqual(plain(Search.findNumber(street, '7')), { lat: 40.003, lon: -3 });
    assert.deepEqual(plain(Search.findNumber(street, '95')), { lat: 40.004, lon: -3 });
});

// ---------------------------------------------------------------- builder + phone together
const PYTHON = path.join(REPO, 'tools', '.venv', 'bin', 'python');
const skipBuild = !fs.existsSync(PYTHON) && 'tools/.venv not set up (see tools/build_search.py)';

function buildSample() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-search-'));
    const run = spawnSync(PYTHON, [path.join(REPO, 'tools', 'build_search.py'),
        path.join(REPO, 'tests', 'search', 'fixtures', 'tiny.osm'), out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    // Serves the built files like the dongle would (the browser un-gzips them)
    const fetchJson = async url => {
        const file = path.join(out, url.replace(/^\/search\//, ''));
        const raw = fs.existsSync(file) ? fs.readFileSync(file) : zlib.gunzipSync(fs.readFileSync(file + '.gz'));
        return JSON.parse(raw.toString('utf8'));
    };
    return { out, fetchJson };
}

test('searching the built sample: a street in two towns, each with its whole line', { skip: skipBuild }, async () => {
    const { out, fetchJson } = buildSample();
    try {
        const search = Search.create(fetchJson);
        const results = plain(await search.query('calle mayor', { lat: 40.0, lon: -3.0 }));
        assert.deepEqual(results.map(r => r.place), ['Villa Alta', 'Villa Baja']);
        const street = plain(await search.street(results[0].ref));
        assert.equal(street.lines.length, 2);
        assert.deepEqual(street.lines[0][0], [40.001, -3.001]);
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test('searching the built sample: a house number gives its exact spot', { skip: skipBuild }, async () => {
    const { out, fetchJson } = buildSample();
    try {
        const search = Search.create(fetchJson);
        const [first] = plain(await search.query('Calle Mayor 12', { lat: 40.0, lon: -3.0 }));
        assert.equal(first.place, 'Villa Alta');
        assert.deepEqual(first.number, { text: '12', lat: 40.0012, lon: -3.0 });
        // Number 3 only exists in Villa Baja, 11 km away: that street comes first even though Villa Alta is nearer
        const [withThree] = plain(await search.query('Calle Mayor 3', { lat: 40.0, lon: -3.0 }));
        assert.equal(withThree.place, 'Villa Baja');
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test('searching the built sample: street, number and town, far from you', { skip: skipBuild }, async () => {
    const { out, fetchJson } = buildSample();
    try {
        const search = Search.create(fetchJson);
        const results = plain(await search.query('Calle Mayor 3, Villa Baja', { lat: 43.0, lon: -8.0 }));
        assert.deepEqual(results.map(r => r.place), ['Villa Baja']);
        assert.deepEqual(results[0].number, { text: '3', lat: 40.1012, lon: -3.1005 });
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test('searching the built sample: metro, police and peaks by name', { skip: skipBuild }, async () => {
    const { out, fetchJson } = buildSample();
    try {
        const search = Search.create(fetchJson);
        const kinds = plain(await search.query('sol', { lat: 40.0, lon: -3.0 })).map(r => r.kind).sort();
        assert.deepEqual(kinds, ['metro_entrance', 'metro_station']);
        assert.equal(plain(await search.query('comisaria', { lat: 40, lon: -3 }))[0].kind, 'police');
        assert.equal(plain(await search.query('penalara', { lat: 40, lon: -3 })).length, 2);
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});
