// Geodesy helpers for the Chiwire Maps map (runs on the phone, not the dongle).
// UTM (ETRS89/WGS84, Krüger series), World Magnetic Model declination, grid convergence,
// sunrise/sunset, distance/bearing and coordinate parsing/formatting.
(function (root) {
    'use strict';

    const RAD = Math.PI / 180;
    const DEG = 180 / Math.PI;

    // GRS80/WGS84 ellipsoid (they differ by < 0.1 mm for these purposes)
    const A = 6378137;
    const F = 1 / 298.257223563;

    // ---------------------------------------------------------------- UTM
    const K0 = 0.9996;
    const N3 = F / (2 - F); // third flattening
    const A_RECT = A / (1 + N3) * (1 + N3 * N3 / 4 + Math.pow(N3, 4) / 64);
    const ALPHA = [
        N3 / 2 - 2 * N3 * N3 / 3 + 5 * Math.pow(N3, 3) / 16,
        13 * N3 * N3 / 48 - 3 * Math.pow(N3, 3) / 5,
        61 * Math.pow(N3, 3) / 240,
    ];
    const BETA = [
        N3 / 2 - 2 * N3 * N3 / 3 + 37 * Math.pow(N3, 3) / 96,
        N3 * N3 / 48 + Math.pow(N3, 3) / 15,
        17 * Math.pow(N3, 3) / 480,
    ];
    const DELTA = [
        2 * N3 - 2 * N3 * N3 / 3 - 2 * Math.pow(N3, 3),
        7 * N3 * N3 / 3 - 8 * Math.pow(N3, 3) / 5,
        56 * Math.pow(N3, 3) / 15,
    ];
    const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

    function utmZone(lon) {
        return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
    }

    function centralMeridian(zone) {
        return (zone - 1) * 6 - 180 + 3;
    }

    function latBand(lat) {
        if (lat < -80 || lat > 84) return '';
        return BANDS.charAt(Math.floor((lat + 80) / 8));
    }

    // Krüger series (Karney 2011) for a point: transverse Mercator xi, eta and the exact grid convergence (radians)
    function kruger(lat, lon, zone) {
        const phi = lat * RAD;
        const lam = (lon - centralMeridian(zone)) * RAD;
        const c = 2 * Math.sqrt(N3) / (1 + N3);
        const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
        const xiP = Math.atan2(t, Math.cos(lam));
        const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
        let xi = xiP, eta = etaP, p = 1, q = 0;
        for (let j = 1; j <= 3; j++) {
            xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
            eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
            p += 2 * j * ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.cosh(2 * j * etaP);
            q += 2 * j * ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.sinh(2 * j * etaP);
        }
        const gamma = Math.atan2(t * Math.sin(lam), Math.sqrt(1 + t * t) * Math.cos(lam)) + Math.atan2(q, p);
        return { xi, eta, gamma };
    }

    // Lat/lon (degrees) -> {zone, band, easting, northing, north}; zone may be forced (grid drawing)
    function toUtm(lat, lon, forceZone) {
        const zone = forceZone || utmZone(lon);
        const { xi, eta } = kruger(lat, lon, zone);
        const north = lat >= 0;
        return {
            zone: zone,
            band: latBand(lat),
            easting: 500000 + K0 * A_RECT * eta,
            northing: (north ? 0 : 10000000) + K0 * A_RECT * xi,
            north: north,
        };
    }

    // UTM -> {lat, lon} in degrees
    function fromUtm(zone, easting, northing, north) {
        const xi = (northing - (north === false ? 10000000 : 0)) / (K0 * A_RECT);
        const eta = (easting - 500000) / (K0 * A_RECT);
        let xiP = xi, etaP = eta;
        for (let j = 1; j <= 3; j++) {
            xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
            etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
        }
        const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
        let phi = chi;
        for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
        const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
        return { lat: phi * DEG, lon: centralMeridian(zone) + lam * DEG };
    }

    // Grid convergence: angle from true north to grid north (degrees, + = grid north east of true north).
    // Exact on the ellipsoid (Karney 2011), not the spherical approximation.
    function gridConvergence(lat, lon, forceZone) {
        return kruger(lat, lon, forceZone || utmZone(lon)).gamma * DEG;
    }

    // ---------------------------------------------------------------- World Magnetic Model
    const WMM_RE = 6371.2; // Geomagnetic reference radius (km)
    let wmmCache = null;

    function wmmPrepare(model) {
        const maxN = model.coefs.reduce((m, c) => Math.max(m, c[0]), 0);
        const g = [], h = [], gd = [], hd = [];
        for (let n = 0; n <= maxN; n++) {
            g.push(new Array(n + 1).fill(0)); h.push(new Array(n + 1).fill(0));
            gd.push(new Array(n + 1).fill(0)); hd.push(new Array(n + 1).fill(0));
        }
        model.coefs.forEach(([n, m, gv, hv, gdv, hdv]) => {
            g[n][m] = gv; h[n][m] = hv; gd[n][m] = gdv; hd[n][m] = hdv;
        });
        return { model, maxN, g, h, gd, hd };
    }

    // Returns {declination, inclination} in degrees (declination + = east) or null if no model loaded.
    // lat/lon in degrees, altKm above the ellipsoid, year as decimal year (e.g. 2026.78).
    function magneticField(lat, lon, altKm, year, model) {
        model = model || root.WMM_MODEL;
        if (!model) return null;
        if (!wmmCache || wmmCache.model !== model) wmmCache = wmmPrepare(model);
        const { maxN, g, h, gd, hd } = wmmCache;
        const dt = year - model.epoch;

        // Geodetic -> geocentric spherical
        const aKm = A / 1000;
        const e2 = F * (2 - F);
        const phi = lat * RAD;
        const sinPhi = Math.sin(phi);
        const rc = aKm / Math.sqrt(1 - e2 * sinPhi * sinPhi);
        const p = (rc + altKm) * Math.cos(phi);
        const z = (rc * (1 - e2) + altKm) * sinPhi;
        const r = Math.sqrt(p * p + z * z);
        const phiC = Math.asin(z / r);
        const theta = Math.PI / 2 - phiC; // geocentric colatitude
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const lam = lon * RAD;

        // Schmidt semi-normalised associated Legendre functions and their theta derivatives
        const P = [], dP = [];
        for (let n = 0; n <= maxN; n++) { P.push(new Array(n + 1).fill(0)); dP.push(new Array(n + 1).fill(0)); }
        P[0][0] = 1;
        for (let n = 1; n <= maxN; n++) {
            for (let m = 0; m <= n; m++) {
                if (n === m) {
                    const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
                    P[n][m] = k * sinT * P[n - 1][m - 1];
                    dP[n][m] = k * (sinT * dP[n - 1][m - 1] + cosT * P[n - 1][m - 1]);
                } else {
                    const k1 = (2 * n - 1) / Math.sqrt(n * n - m * m);
                    const k2 = n >= 2 && m <= n - 2 ? Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m)) : 0;
                    const pPrev2 = n >= 2 && m <= n - 2 ? P[n - 2][m] : 0;
                    const dPPrev2 = n >= 2 && m <= n - 2 ? dP[n - 2][m] : 0;
                    P[n][m] = k1 * cosT * P[n - 1][m] - k2 * pPrev2;
                    dP[n][m] = k1 * (cosT * dP[n - 1][m] - sinT * P[n - 1][m]) - k2 * dPPrev2;
                }
            }
        }

        let bx = 0, by = 0, bz = 0;
        for (let n = 1; n <= maxN; n++) {
            const ar = Math.pow(WMM_RE / r, n + 2);
            for (let m = 0; m <= n; m++) {
                const gt = g[n][m] + dt * gd[n][m];
                const ht = h[n][m] + dt * hd[n][m];
                const cosM = Math.cos(m * lam), sinM = Math.sin(m * lam);
                bx += ar * (gt * cosM + ht * sinM) * dP[n][m];
                by += ar * m * (gt * sinM - ht * cosM) * P[n][m];
                bz -= ar * (n + 1) * (gt * cosM + ht * sinM) * P[n][m];
            }
        }
        by /= sinT;

        // Rotate from geocentric to geodetic frame
        const psi = phiC - phi;
        const x = bx * Math.cos(psi) - bz * Math.sin(psi);
        const zz = bx * Math.sin(psi) + bz * Math.cos(psi);
        const hComp = Math.sqrt(x * x + by * by);
        return {
            declination: Math.atan2(by, x) * DEG,
            inclination: Math.atan2(zz, hComp) * DEG,
            modelName: model.name,
            validUntil: model.epoch + 5,
        };
    }

    function decimalYear(date) {
        const y = date.getUTCFullYear();
        const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
        return y + (date.getTime() - start) / (end - start);
    }

    // ---------------------------------------------------------------- Distance and bearing
    function distanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371008.8;
        const dPhi = (lat2 - lat1) * RAD, dLam = (lon2 - lon1) * RAD;
        const s = Math.sin(dPhi / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLam / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(s));
    }

    // Initial true bearing (degrees 0-360)
    function bearingDegrees(lat1, lon1, lat2, lon2) {
        const p1 = lat1 * RAD, p2 = lat2 * RAD, dLam = (lon2 - lon1) * RAD;
        const y = Math.sin(dLam) * Math.cos(p2);
        const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLam);
        return (Math.atan2(y, x) * DEG + 360) % 360;
    }

    // ---------------------------------------------------------------- Sunrise / sunset (NOAA solar calculator)
    // Sun declination (degrees) and equation of time (minutes) at a Julian day, NOAA's full series.
    function solarPosition(jd) {
        const t = (jd - 2451545) / 36525; // Julian centuries since J2000
        const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
        const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
        const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
        const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
            Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
        const omega = 125.04 - 1934.136 * t;
        const apparentLong = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
        const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
        const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
        const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLong * RAD)) * DEG;
        const y = Math.tan(obliquity * RAD / 2) ** 2;
        const eqTime = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
            4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) -
            1.25 * e * e * Math.sin(2 * M * RAD));
        return { declination, eqTime };
    }

    // Returns {sunrise, sunset} as Date objects (null if polar day/night) for the calendar day of `date`
    // on the device's clock (in Spain, just after midnight already shows the new day).
    function sunTimes(date, lat, lon) {
        const dayStart = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); // ms, 00:00 UTC
        const jd0 = dayStart / 86400000 + 2440587.5;
        // Minutes after 00:00 UTC of sunrise (sign -1) or sunset (+1); evaluated twice, at the event itself
        const event = sign => {
            let minutes = 720 - 4 * lon;
            for (let i = 0; i < 2; i++) {
                const { declination, eqTime } = solarPosition(jd0 + minutes / 1440);
                const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(declination * RAD)) -
                    Math.tan(lat * RAD) * Math.tan(declination * RAD);
                if (cosH < -1 || cosH > 1) return null;
                minutes = 720 - 4 * lon - eqTime + sign * 4 * Math.acos(cosH) * DEG;
            }
            return new Date(dayStart + minutes * 60000);
        };
        const sunrise = event(-1), sunset = event(1);
        return sunrise && sunset ? { sunrise, sunset } : { sunrise: null, sunset: null };
    }

    // ---------------------------------------------------------------- Map tiles
    // Ancestor tile `depth` levels up, and the square (in its pixels) that covers tile z/x/y
    function parentTile(z, x, y, depth, tileSize) {
        const size = tileSize / (1 << depth);
        const px = x >> depth, py = y >> depth;
        return { z: z - depth, x: px, y: py, sx: (x - (px << depth)) * size, sy: (y - (py << depth)) * size, size };
    }

    // ---------------------------------------------------------------- Formatting
    function formatDms(value, isLat) {
        const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
        let v = Math.abs(value);
        let d = Math.floor(v);
        let m = Math.floor((v - d) * 60);
        let s = ((v - d) * 60 - m) * 60;
        if (s >= 59.95) { s = 0; m += 1; }
        if (m >= 60) { m = 0; d += 1; }
        return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${hemi}`;
    }

    function formatUtm(u) {
        return `${u.zone}${u.band} ${Math.round(u.easting)} ${Math.round(u.northing)}`;
    }

    // ---------------------------------------------------------------- Parsing user input
    // Accepts: "40.4168, -3.7038" | "40.4168N 3.7038W" | "40°25'00.5\"N 3°42'13.7\"W" | "40 25 0.5 N 3 42 13.7 O"
    //          UTM: "30T 440300 4474260" | "30 440300 4474260" | "30T 440300E 4474260N"
    // Returns {lat, lon} or null.
    function parseCoordinate(text) {
        const s = text.trim().toUpperCase();

        const utm = s.match(/^(\d{1,2})\s*([C-HJ-NP-X])?\s+(\d{3,7}(?:\.\d+)?)\s*(?:M\s*)?E?\s*[,;\s]\s*(\d{5,8}(?:\.\d+)?)\s*(?:M\s*)?N?$/);
        if (utm) {
            const zone = parseInt(utm[1], 10);
            if (zone < 1 || zone > 60) return null;
            const north = utm[2] ? utm[2] >= 'N' : true;
            return fromUtm(zone, parseFloat(utm[3]), parseFloat(utm[4]), north);
        }

        // Lat/lon: split numbers into two groups using hemisphere letters (O = Oeste = West) or counts
        const tokens = s.replace(/[°º'′"″]/g, ' ').match(/-?\d+(?:\.\d+)?|[NSEWO]/g);
        if (!tokens) return null;
        const groups = [];
        let current = [];
        tokens.forEach(tok => {
            if (/^[NSEWO]$/.test(tok)) {
                if (current.length) { groups.push({ nums: current, hemi: tok }); current = []; }
                else if (groups.length && !groups[groups.length - 1].hemi) groups[groups.length - 1].hemi = tok;
            } else {
                current.push(parseFloat(tok));
            }
        });
        if (current.length) groups.push({ nums: current, hemi: null });

        let parts = groups;
        if (parts.length === 1 && !parts[0].hemi) {
            const nums = parts[0].nums;
            if (nums.length % 2 !== 0 || nums.length > 6) return null;
            const half = nums.length / 2;
            parts = [{ nums: nums.slice(0, half), hemi: null }, { nums: nums.slice(half), hemi: null }];
        }
        if (parts.length !== 2) return null;

        const toDeg = part => {
            const [d, m = 0, sec = 0] = part.nums;
            if (part.nums.length > 3 || m < 0 || m >= 60 || sec < 0 || sec >= 60) return NaN;
            const sign = d < 0 ? -1 : 1;
            let v = Math.abs(d) + m / 60 + sec / 3600;
            if (part.hemi === 'S' || part.hemi === 'W' || part.hemi === 'O') v = -v;
            return sign * v;
        };
        let first = parts[0], second = parts[1];
        // Allow "3.7W 40.4N" (longitude given first)
        if (first.hemi && 'EWO'.includes(first.hemi)) [first, second] = [second, first];
        const lat = toDeg(first), lon = toDeg(second);
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        return { lat, lon };
    }

    const Geo = {
        toUtm, fromUtm, utmZone, centralMeridian, latBand, gridConvergence,
        magneticField, decimalYear, distanceMeters, bearingDegrees, sunTimes, parentTile,
        formatDms, formatUtm, parseCoordinate,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
    root.Geo = Geo;
})(typeof window !== 'undefined' ? window : globalThis);
