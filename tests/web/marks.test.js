// Marks and routes: the data model behind the map's markers (no map code, so it runs in node).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSdCardScripts } = require('./load');

const { Marks, Geo } = loadSdCardScripts('geo.js', 'marks.js');

const SOL = { lat: 40.4168, lon: -3.7038 };
const RETIRO = { lat: 40.4153, lon: -3.6845 };
const CIBELES = { lat: 40.4193, lon: -3.6931 };
const tags = route => Array.from(route.points, p => p.tag); // plain array: the scripts run in another realm

test('standalone marks keep their position, icon and tag', () => {
    const s = Marks.create();
    const id = Marks.addMark(s, { ...SOL, icon: '⛺', tag: 'Camp' });
    assert.deepEqual({ ...Marks.find(s, id) }, { id, kind: 'mark', ...SOL, icon: '⛺', tag: 'Camp' });
});

test('a route keeps its points in order; a point can be inserted in the middle', () => {
    const s = Marks.create();
    const r = Marks.addRoute(s, { name: 'Walk' });
    Marks.addPoint(s, r, { ...SOL, tag: 'Sol' });
    Marks.addPoint(s, r, { ...RETIRO, tag: 'Retiro' });
    Marks.addPoint(s, r, { ...CIBELES, tag: 'Cibeles' }, 1);
    assert.deepEqual(tags(Marks.find(s, r)), ['Sol', 'Cibeles', 'Retiro']);
});

test('points move up and down, and stay put at the ends', () => {
    const s = Marks.create();
    const r = Marks.addRoute(s, {});
    const [a, b, c] = ['A', 'B', 'C'].map(tag => Marks.addPoint(s, r, { ...SOL, tag }));
    Marks.move(s, c, -1);
    assert.deepEqual(tags(Marks.find(s, r)), ['A', 'C', 'B']);
    Marks.move(s, a, -1);
    Marks.move(s, b, 1);
    assert.deepEqual(tags(Marks.find(s, r)), ['A', 'C', 'B']);
});

test('remove one point, a whole route, a mark, or everything', () => {
    const s = Marks.create();
    const r = Marks.addRoute(s, {});
    const p = Marks.addPoint(s, r, { ...SOL, tag: 'A' });
    Marks.addPoint(s, r, { ...RETIRO, tag: 'B' });
    const m = Marks.addMark(s, { ...CIBELES });
    Marks.remove(s, p);
    assert.deepEqual(tags(Marks.find(s, r)), ['B']);
    Marks.remove(s, m);
    assert.equal(Marks.find(s, m), null);
    Marks.remove(s, r);
    assert.equal(s.items.length, 0);
    Marks.addMark(s, { ...SOL });
    Marks.addRoute(s, {});
    Marks.clear(s);
    assert.equal(s.items.length, 0);
});

test('icon, tag and route name can be changed', () => {
    const s = Marks.create();
    const r = Marks.addRoute(s, { name: 'Old' });
    const p = Marks.addPoint(s, r, { ...SOL });
    Marks.update(s, r, { name: 'New' });
    Marks.update(s, p, { icon: '💧', tag: 'Fuente' });
    assert.equal(Marks.find(s, r).name, 'New');
    assert.equal(Marks.find(s, p).icon, '💧');
    assert.equal(Marks.find(s, p).tag, 'Fuente');
});

test('legs give distance and true bearing between consecutive points, plus the total', () => {
    const s = Marks.create();
    const r = Marks.addRoute(s, {});
    [SOL, CIBELES, RETIRO].forEach(p => Marks.addPoint(s, r, p));
    const { legs, total } = Marks.legs(Marks.find(s, r));
    assert.equal(legs.length, 2);
    assert.equal(legs[0].distance, Geo.distanceMeters(SOL.lat, SOL.lon, CIBELES.lat, CIBELES.lon));
    assert.equal(legs[1].bearing, Geo.bearingDegrees(CIBELES.lat, CIBELES.lon, RETIRO.lat, RETIRO.lon));
    assert.equal(total, legs[0].distance + legs[1].distance);
});

test('saving to GeoJSON and loading it back gives the same marks and routes', () => {
    const s = Marks.create();
    Marks.addMark(s, { ...SOL, icon: '⛺', tag: 'Camp' });
    const r = Marks.addRoute(s, { name: 'Walk', icon: '🥾' });
    Marks.addPoint(s, r, { ...CIBELES, icon: '📍', tag: 'Cibeles' });
    Marks.addPoint(s, r, { ...RETIRO, tag: 'Retiro' });
    const text = JSON.stringify(Marks.toGeoJSON(s));
    const back = Marks.fromGeoJSON(JSON.parse(text));
    const strip = st => JSON.parse(JSON.stringify(st.items, (k, v) => (k === 'id' ? undefined : v)));
    assert.deepEqual(strip(back), strip(s));
    assert.equal(JSON.parse(text).type, 'FeatureCollection');
});

test('loading a file that is not ours explains why instead of failing silently', () => {
    assert.throws(() => Marks.fromGeoJSON({ hello: 1 }), /not a marks file/);
});

test('GPX export: marks become waypoints, routes become routes, with escaped names', () => {
    const s = Marks.create();
    Marks.addMark(s, { ...SOL, tag: 'Bar <Sol> & co' });
    const r = Marks.addRoute(s, { name: 'Walk' });
    Marks.addPoint(s, r, { ...CIBELES, tag: 'Cibeles' });
    const gpx = Marks.toGPX(s);
    assert.match(gpx, /<wpt lat="40\.4168" lon="-3\.7038"><name>Bar &lt;Sol&gt; &amp; co<\/name><\/wpt>/);
    assert.match(gpx, /<rte><name>Walk<\/name><rtept lat="40\.4193" lon="-3\.6931"><name>Cibeles<\/name><\/rtept><\/rte>/);
});
