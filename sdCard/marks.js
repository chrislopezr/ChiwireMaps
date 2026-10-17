// Marks and routes for the Chiwire Maps map (runs on the phone). Pure data, no map code:
// standalone marks, and routes made of connected points, each with an icon and a tag.
// Saved as GeoJSON (our own files) and exported as GPX (for other apps).
(function (root) {
    'use strict';

    // State: { items: [mark | route], nextId }
    //   mark:  { id, kind: 'mark', lat, lon, icon, tag }
    //   route: { id, kind: 'route', name, icon, points: [{ id, kind: 'point', lat, lon, icon, tag }] }
    function create() {
        return { items: [], nextId: 1 };
    }

    const point = (s, kind, p) => ({ id: s.nextId++, kind, lat: p.lat, lon: p.lon, icon: p.icon || '', tag: p.tag || '' });

    function addMark(s, p) {
        const m = point(s, 'mark', p);
        s.items.push(m);
        return m.id;
    }

    function addRoute(s, r) {
        const route = { id: s.nextId++, kind: 'route', name: r.name || '', icon: r.icon || '', points: [] };
        s.items.push(route);
        return route.id;
    }

    // Inserts at `index` (default: the end) and returns the new point's id
    function addPoint(s, routeId, p, index) {
        const route = find(s, routeId);
        const pt = point(s, 'point', p);
        route.points.splice(index === undefined ? route.points.length : index, 0, pt);
        return pt.id;
    }

    // { item, list } for any id: list is the array holding it (items, or a route's points)
    function locate(s, id) {
        for (const item of s.items) {
            if (item.id === id) return { item, list: s.items };
            if (item.kind === 'route') {
                const pt = item.points.find(p => p.id === id);
                if (pt) return { item: pt, list: item.points };
            }
        }
        return null;
    }

    function find(s, id) {
        const found = locate(s, id);
        return found ? found.item : null;
    }

    // Moves a route point one place (delta -1 = earlier, +1 = later); no change at the ends
    // (moving the last one later re-inserts it at the end)
    function move(s, id, delta) {
        const { item, list } = locate(s, id);
        const i = list.indexOf(item), j = i + delta;
        if (j < 0) return;
        list.splice(i, 1);
        list.splice(j, 0, item);
    }

    function remove(s, id) {
        const found = locate(s, id);
        if (found) found.list.splice(found.list.indexOf(found.item), 1);
    }

    function clear(s) {
        s.items.length = 0;
    }

    function update(s, id, changes) {
        const item = find(s, id);
        ['icon', 'tag', 'name'].forEach(k => { if (changes[k] !== undefined) item[k] = changes[k]; });
    }

    function legs(route) {
        const out = [];
        for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i];
            out.push({
                from: a, to: b,
                distance: root.Geo.distanceMeters(a.lat, a.lon, b.lat, b.lon),
                bearing: root.Geo.bearingDegrees(a.lat, a.lon, b.lat, b.lon),
            });
        }
        return { legs: out, total: out.reduce((sum, l) => sum + l.distance, 0) };
    }

    // GeoJSON: marks are Points; routes are LineStrings whose per-point icon/tag live in properties.points
    function toGeoJSON(s) {
        return {
            type: 'FeatureCollection',
            features: s.items.map(item => item.kind === 'mark'
                ? { type: 'Feature', geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
                    properties: { kind: 'mark', icon: item.icon, tag: item.tag } }
                : { type: 'Feature', geometry: { type: 'LineString', coordinates: item.points.map(p => [p.lon, p.lat]) },
                    properties: { kind: 'route', name: item.name, icon: item.icon,
                        points: item.points.map(p => ({ icon: p.icon, tag: p.tag })) } }),
        };
    }

    function fromGeoJSON(json) {
        if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
            throw new Error('This is not a marks file (expected GeoJSON saved by Chiwire Maps)');
        }
        const s = create();
        json.features.forEach(f => {
            const props = f.properties || {};
            if (f.geometry.type === 'Point') {
                const [lon, lat] = f.geometry.coordinates;
                addMark(s, { lat, lon, icon: props.icon, tag: props.tag });
            } else if (f.geometry.type === 'LineString') {
                const r = addRoute(s, { name: props.name, icon: props.icon });
                f.geometry.coordinates.forEach(([lon, lat], i) =>
                    addPoint(s, r, { lat, lon, ...((props.points || [])[i] || {}) }));
            }
        });
        return s;
    }

    const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const named = (tag, lat, lon, name) => `<${tag} lat="${lat}" lon="${lon}">${name ? `<name>${xml(name)}</name>` : ''}</${tag}>`;

    function toGPX(s) {
        const body = s.items.map(item => item.kind === 'mark'
            ? named('wpt', item.lat, item.lon, item.tag)
            : `<rte>${item.name ? `<name>${xml(item.name)}</name>` : ''}` +
              item.points.map(p => named('rtept', p.lat, p.lon, p.tag)).join('') + '</rte>').join('\n');
        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<gpx version="1.1" creator="Chiwire Maps" xmlns="http://www.topografix.com/GPX/1/1">\n' +
            body + '\n</gpx>\n';
    }

    const Marks = { create, addMark, addRoute, addPoint, find, move, remove, clear, update, legs, toGeoJSON, fromGeoJSON, toGPX };
    if (typeof module !== 'undefined' && module.exports) module.exports = Marks;
    root.Marks = Marks;
})(typeof window !== 'undefined' ? window : globalThis);
