// Sunrise / sunset against the US Naval Observatory, and on the right calendar day.
process.env.TZ = 'Europe/Madrid'; // the phone's clock in Spain; set before any Date is made
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/usno_sun_2026.json');
const { loadSdCardScripts } = require('./load');

const { Geo } = loadSdCardScripts('geo.js');

const utcMinutes = date => date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
const hhmm = text => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };

test('sunrise and sunset match the US Naval Observatory to the minute (5 Spanish places, 4 dates)', () => {
    for (const row of fixture.rows) {
        const { sunrise, sunset } = Geo.sunTimes(new Date(`${row.date}T12:00:00Z`), row.lat, row.lon);
        // USNO rounds to the whole minute (±0.5); 0.1 min more catches a single-pass (less exact) calculation
        assert.ok(Math.abs(utcMinutes(sunrise) - hhmm(row.riseUtc)) <= 0.6, `${row.place} ${row.date} sunrise`);
        assert.ok(Math.abs(utcMinutes(sunset) - hhmm(row.setUtc)) <= 0.6, `${row.place} ${row.date} sunset`);
    }
});

test('just after midnight in Spain it shows the times of the day that has just started', () => {
    // 00:30 on 16 Oct in Madrid is still 15 Oct in UTC
    const { sunrise } = Geo.sunTimes(new Date('2026-10-15T22:30:00Z'), 40.4168, -3.7038);
    assert.equal(sunrise.getDate(), 16);
});
