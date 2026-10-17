// Seam 1: the public functions of sdCard/geo.js. Expected values come from independent sources
// (NOAA official test values, published UTM examples, known day lengths), never from geo.js itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadSdCardScripts } = require('./load');

const { Geo, WMM_MODEL } = loadSdCardScripts('wmm.js', 'geo.js');

const near = (actual, expected, tolerance, label) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test('declination and inclination match all NOAA WMM2025 official test values', () => {
    const lines = fs.readFileSync(path.join(__dirname, 'fixtures', 'WMM2025_TestValues.txt'), 'utf8')
        .split('\n').filter(l => l.trim() && !l.startsWith('#'));
    assert.equal(lines.length, 100);
    for (const line of lines) {
        const [year, altKm, lat, lon, decl, incl] = line.trim().split(/\s+/).map(Number);
        const field = Geo.magneticField(lat, lon, altKm, year, WMM_MODEL);
        near(field.declination, decl, 0.01, `D at ${lat},${lon},${year}`);
        near(field.inclination, incl, 0.01, `I at ${lat},${lon},${year}`);
    }
});

test('declination reports the model validity so expiry can be shown', () => {
    const field = Geo.magneticField(40.4, -3.7, 0.6, 2026.8, WMM_MODEL);
    assert.equal(field.modelName, 'WMM-2025');
    assert.equal(field.validUntil, 2030);
});

test('lat/lon to UTM matches the published Eiffel Tower example', () => {
    // Example from the movable-type.co.uk UTM reference implementation
    const u = Geo.toUtm(48.8582, 2.2945);
    assert.equal(u.zone, 31);
    assert.equal(u.band, 'U');
    near(u.easting, 448251.795, 0.005, 'easting');
    near(u.northing, 5411932.678, 0.005, 'northing');
});

test('UTM origin: equator on a central meridian is 500000 E, 0 N', () => {
    const u = Geo.toUtm(0, -3);
    assert.equal(u.zone, 30);
    near(u.easting, 500000, 0.001, 'easting');
    near(u.northing, 0, 0.001, 'northing');
});

test('southern hemisphere uses the 10 000 000 m false northing', () => {
    const u = Geo.toUtm(-0.000001, -3);
    assert.equal(u.north, false);
    near(u.northing, 10000000, 1, 'northing');
});

test('UTM to lat/lon inverts the forward conversion everywhere in peninsular Spain (< 1 mm)', () => {
    for (let lat = 36; lat <= 44; lat += 0.25) {
        for (let lon = -9.5; lon <= 3.5; lon += 0.25) {
            const u = Geo.toUtm(lat, lon);
            const back = Geo.fromUtm(u.zone, u.easting, u.northing, u.north);
            near(back.lat, lat, 1e-8, 'lat');
            near(back.lon, lon, 1e-8, 'lon');
        }
    }
});

test('UTM zones for Spain: Galicia 29, Madrid 30, Catalonia 31', () => {
    assert.equal(Geo.utmZone(-8.4), 29);
    assert.equal(Geo.utmZone(-3.7), 30);
    assert.equal(Geo.utmZone(2.2), 31);
});

test('grid convergence matches the direction of grid north measured on the projection', () => {
    // Independent check: move 1 m due north and measure the angle of that step in the UTM grid
    for (const [lat, lon] of [[43.3, -8.4], [40.4, -3.7], [42.0, 2.8], [37.0, -0.1]]) {
        const zone = Geo.utmZone(lon);
        const a = Geo.toUtm(lat, lon, zone);
        const b = Geo.toUtm(lat + 1e-5, lon, zone);
        const trueNorthInGrid = Math.atan2(b.easting - a.easting, b.northing - a.northing) * 180 / Math.PI;
        near(Geo.gridConvergence(lat, lon), -trueNorthInGrid, 0.01, `convergence at ${lat},${lon}`);
    }
});

test('grid convergence equals GeographicLib\'s exact values to a billionth of a degree (60 points across Spain)', () => {
    const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'geographiclib_tm_spain.json'), 'utf8'));
    for (const r of ref.rows) {
        const lat = Number(r.lat), lon = -3 + Number(r.dlon); // zone 30: central meridian 3° W
        near(Geo.gridConvergence(lat, lon, 30), Number(r.convergence), 1e-9, `convergence at ${r.lat},${r.dlon}`);
    }
});

test('UTM coordinates equal GeographicLib\'s exact values to a millimetre (same 60 points)', () => {
    const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'geographiclib_tm_spain.json'), 'utf8'));
    for (const r of ref.rows) {
        const u = Geo.toUtm(Number(r.lat), -3 + Number(r.dlon), 30);
        near(u.easting, 500000 + Number(r.x), 0.001, `easting at ${r.lat},${r.dlon}`);
        near(u.northing, Number(r.y), 0.001, `northing at ${r.lat},${r.dlon}`);
    }
});

test('grid convergence is zero on the central meridian', () => {
    assert.equal(Geo.gridConvergence(40, -3), 0);
});

test('one degree of latitude is about 111.2 km', () => {
    near(Geo.distanceMeters(40, -3, 41, -3), 111195, 5, 'distance');
});

test('bearing: due north 0°, due east at the equator 90°, due west 270°', () => {
    near(Geo.bearingDegrees(40, -3, 41, -3), 0, 1e-9, 'north');
    near(Geo.bearingDegrees(0, 0, 0, 1), 90, 1e-9, 'east');
    near(Geo.bearingDegrees(0, 1, 0, 0), 270, 1e-9, 'west');
});

test('day length: ~12 h 7 min at the equator on the March equinox', () => {
    const { sunrise, sunset } = Geo.sunTimes(new Date('2026-03-20T12:00:00Z'), 0, 0);
    near((sunset - sunrise) / 60000, 727, 4, 'minutes of daylight');
});

test('day length: ~15 h 4 min in Madrid on the June solstice', () => {
    const { sunrise, sunset } = Geo.sunTimes(new Date('2026-06-21T12:00:00Z'), 40.4168, -3.7038);
    near((sunset - sunrise) / 60000, 904, 4, 'minutes of daylight');
});

test('polar night returns no sunrise or sunset', () => {
    const { sunrise, sunset } = Geo.sunTimes(new Date('2026-12-21T12:00:00Z'), 80, 0);
    assert.equal(sunrise, null);
    assert.equal(sunset, null);
});

test('formats degrees-minutes-seconds with hemisphere letters', () => {
    assert.equal(Geo.formatDms(40.416805555, true), `40°25'00.5"N`);
    assert.equal(Geo.formatDms(-3.703805555, false), `3°42'13.7"W`);
});

test('DMS seconds that round to 60 carry into the minutes', () => {
    assert.equal(Geo.formatDms(40.99999, true), `41°00'00.0"N`);
});

test('formats UTM as zone+band, easting, northing in whole metres', () => {
    assert.equal(Geo.formatUtm({ zone: 30, band: 'T', easting: 440290.4, northing: 4474256.6 }), '30T 440290 4474257');
});

test('parses decimal, hemisphere-letter, DMS and Spanish "O" coordinates', () => {
    const cases = [
        ['40.4168, -3.7038', 40.4168, -3.7038],
        ['40.4168N 3.7038W', 40.4168, -3.7038],
        [`40°25'00.5"N 3°42'13.7"W`, 40.416806, -3.703806],
        ['40 25 0.5 N 3 42 13.7 O', 40.416806, -3.703806],
        ['3.7038W 40.4168N', 40.4168, -3.7038],
    ];
    for (const [text, lat, lon] of cases) {
        const p = Geo.parseCoordinate(text);
        near(p.lat, lat, 1e-6, `lat of ${text}`);
        near(p.lon, lon, 1e-6, `lon of ${text}`);
    }
});

test('parses UTM with or without the latitude band', () => {
    for (const text of ['30T 440291 4474257', '30 440291 4474257', '30T 440291E 4474257N']) {
        const p = Geo.parseCoordinate(text);
        near(p.lat, 40.4168, 0.00002, `lat of ${text}`);
        near(p.lon, -3.7038, 0.00002, `lon of ${text}`);
    }
});

test('rejects text that is not a coordinate', () => {
    for (const text of ['hello', '', '95, 10', '40.1', '40 70 0 N 3 0 0 W', '61 440291 4474257']) {
        assert.equal(Geo.parseCoordinate(text), null, text);
    }
});
