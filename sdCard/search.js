// Offline search for the Chiwire Maps map (runs on the phone). The data on the SD card (/search/...) is
// built by tools/build_search.py from OpenStreetMap; the dongle only serves files, the phone does the searching.
// Pure logic plus a loader that is given a fetchJson(url) function, so it runs in node tests too.
(function (root) {
    'use strict';

    // Same rules as tools/build_search.py (tests/search/fixtures/normalize_cases.json checks both)
    const STOP = new Set(`calle c cl avenida avda av plaza placa pl paseo pg passeig camino cami carretera ctra travesia
ronda glorieta rua carrer via ruta senda sendero cuesta calleja callejon pasaje urbanizacion urb barrio
kalea bidea etorbidea enparantza de del la las el los l d y i e a en o san santa santo sant nuestra senora`.split(/\s+/));

    function normalize(text) {
        return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function searchWords(name) {
        const words = normalize(name).split(' ').filter(Boolean);
        const useful = words.filter(w => !STOP.has(w));
        const long = useful.filter(w => w.length >= 3);
        return long.length ? long : useful.length ? useful : words;
    }

    // { words: pick the files, tokens: must all match, number: house number or null }. The house number is the
    // last number with a name word somewhere before it: "Gran Vía 28 Madrid" yes, "Calle 1", "Avenida 1 de Mayo" no.
    function parseQuery(text) {
        const tokens = normalize(text).split(' ').filter(Boolean);
        const isNumber = t => /^\d+[a-z]?$/.test(t);
        const firstName = tokens.findIndex(t => !STOP.has(t) && !isNumber(t));
        let number = null;
        for (let i = tokens.length - 1; firstName >= 0 && i > firstName; i--) {
            if (isNumber(tokens[i])) { number = tokens.splice(i, 1)[0]; break; }
        }
        return { words: searchWords(tokens.join(' ')), tokens, number };
    }

    // Name files (keys from the manifest) that can hold names with this word. Keys are prefixes, or a whole
    // short word followed by '$'.
    function shardsFor(word, shards) {
        return shards.filter(k => k.endsWith('$')
            ? k.slice(0, -1).startsWith(word)
            : word.startsWith(k) || (word.length >= 3 && k.startsWith(word)));
    }

    // Rows [name, kind, place, lat*1e5, lon*1e5, ref] -> results whose words all match the start of a word in the
    // name or the town, at least one in the name; whole-word matches first, then nearest to `ref` ({lat, lon} or null)
    function rank(rows, query, ref) {
        const seen = new Set();
        const out = [];
        for (const [name, kind, place, lat5, lon5, sref] of rows) {
            const key = `${name}|${kind}|${lat5}|${lon5}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const named = normalize(name).split(' ');
            const words = named.concat(normalize(place).split(' '));
            if (!query.tokens.every(t => words.some(w => w.startsWith(t)))) continue;
            if (!query.tokens.some(t => named.some(w => w.startsWith(t)))) continue;
            const lat = lat5 / 1e5, lon = lon5 / 1e5;
            out.push({
                name, kind, place, lat, lon, ref: sref,
                exact: query.tokens.every(t => words.includes(t)),
                distance: ref ? root.Geo.distanceMeters(ref.lat, ref.lon, lat, lon) : 0,
            });
        }
        return out.sort((a, b) => (b.exact - a.exact) || (a.distance - b.distance));
    }

    // One building can carry a list ("5, 7") or a range of one side of the street ("91-97" = 91, 93, 95, 97)
    function covers(text, number) {
        const n = parseInt(number, 10);
        return text.split(/[,;]/).some(part => {
            const range = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
            if (!range) return normalize(part) === number;
            const [a, b] = [+range[1], +range[2]].sort((x, y) => x - y);
            return String(n) === number && n >= a && n <= b && (n - a) % 2 === 0;
        });
    }

    function numberRow(street, number) {
        return street.numbers.find(n => normalize(n[0]) === number) || street.numbers.find(n => covers(n[0], number)) || null;
    }

    function findNumber(street, number) {
        const row = numberRow(street, number);
        return row ? { lat: row[1] / 1e5, lon: row[2] / 1e5 } : null;
    }

    const MAX_FILES = 6, MAX_WORDS = 3, MAX_RESULTS = 50, MAX_NUMBER_LOOKUPS = 10;

    function create(fetchJson) {
        let manifest = null;
        const cache = new Map();
        const load = url => {
            if (!cache.has(url)) cache.set(url, fetchJson(url).catch(() => null));
            return cache.get(url);
        };
        const getManifest = async () => manifest || (manifest = await fetchJson('/search/manifest.json'));

        async function street(ref) {
            const m = await getManifest();
            const block = await load(`/search/g/${Math.floor(ref / m.block)}.json`);
            const s = block && block[ref];
            if (!s) return null;
            const pairs = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] / 1e5, flat[i + 1] / 1e5]); return out; };
            return { lines: s.lines.map(pairs), numbers: s.numbers };
        }

        async function query(text, ref) {
            const q = parseQuery(text);
            // Names are filed under their own words only; the longest words may be the town, so take a few
            const words = q.words.slice().sort((a, b) => b.length - a.length).slice(0, MAX_WORDS);
            if (!words.length || (words[0].length < 3 && !/^\d+$/.test(words[0]))) return [];
            const m = await getManifest();
            const keys = new Set(words.flatMap(w => shardsFor(w, m.shards).slice(0, MAX_FILES)));
            const files = await Promise.all([...keys].map(k => load(`/search/n/${k}.json`)));
            const results = rank(files.filter(Boolean).flat(), q, ref).slice(0, MAX_RESULTS);
            if (q.number) {
                const streets = results.filter(r => r.ref >= 0).slice(0, MAX_NUMBER_LOOKUPS);
                for (const r of streets) {
                    const s = await street(r.ref);
                    const row = s && numberRow(s, q.number);
                    if (row) r.number = { text: row[0], lat: row[1] / 1e5, lon: row[2] / 1e5 };
                }
                results.sort((a, b) => (!!b.number - !!a.number));
            }
            return results;
        }

        // Points of interest in one zoom-10 map tile: [kind, name, lat*1e5, lon*1e5]
        async function poiTile(x, y) {
            const m = await getManifest();
            return (await load(`/search/poi/${m.poiZoom}_${x}_${y}.json`)) || [];
        }

        return { query, street, poiTile, manifest: getManifest };
    }

    const Search = { normalize, searchWords, parseQuery, shardsFor, rank, findNumber, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = Search;
    root.Search = Search;
})(typeof window !== 'undefined' ? window : globalThis);
