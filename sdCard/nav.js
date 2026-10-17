// Chiwire Maps map application (served from the SD card, runs on the phone).
// Layers: IGN MTN topographic, PNOA aerial, IGN Base (raster tiles on the SD card) and IGN vector tiles.
// Tools: UTM grid, coordinate readout, "go to coordinate", north overlay (true / grid / magnetic), sun times.
(function () {
    'use strict';

    const CONFIG = {
        start: { lat: 40.4168, lon: -3.7038, zoom: 11 },   // Madrid, used until the GPS has a fix
        minZoom: 5,
        bounds: [[34.5, -11.5], [45, 5.5]], // Peninsula + margin: the map can't be dragged where there are no maps
        maxZoom: 18,              // Beyond the stored zoom the deepest available tile is enlarged
        maxNativeZoom: 16,        // Deepest zoom stored on the SD card
        fallbackLevels: 6,        // How many zoom levels to step back when a tile is missing
        maxParallelTiles: 2,      // Keeps the dongle from being flooded with requests
        pollMs: 2500,
        rasterLayers: [
            { id: 'mtn', name: 'Topographic (MTN)', ext: 'jpg' },
            { id: 'pnoa', name: 'Aerial (PNOA)', ext: 'jpg' },
            { id: 'base', name: 'Streets (IGN Base)', ext: 'jpg' },
        ],
        vector: { name: 'Vector (IGN)', style: '/vector/style.json' },
        attribution: '© Instituto Geográfico Nacional de España · CC BY 4.0',
    };

    const $ = id => document.getElementById(id);
    const store = {
        get(key) { try { return JSON.parse(localStorage.getItem('bb.' + key)); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem('bb.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
    };

    function notify(message) {
        const box = $('toast');
        box.textContent = message;
        box.hidden = false;
        clearTimeout(notify.timer);
        notify.timer = setTimeout(() => { box.hidden = true; }, 6000);
    }

    // ------------------------------------------------------------ Tile loading queue
    // The dongle serves one SD file at a time well; a small queue keeps the map responsive without
    // triggering the low-memory guard. 404 = tile not on the card (try a lower zoom); other errors retry.
    const queue = [];
    let activeLoads = 0;
    const missingTiles = new Set();
    const imageCache = new Map(); // Small LRU of decoded parent tiles reused by overzoomed children
    const IMAGE_CACHE_SIZE = 48;

    function cacheImage(url, bitmap) {
        imageCache.delete(url);
        imageCache.set(url, bitmap);
        if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
    }

    function fetchTile(url, isCancelled) {
        if (imageCache.has(url)) {
            const bitmap = imageCache.get(url);
            cacheImage(url, bitmap);
            return Promise.resolve(bitmap);
        }
        return new Promise((resolve, reject) => {
            queue.push({ url, isCancelled, resolve, reject, retries: 0 });
            pumpQueue();
        });
    }

    function pumpQueue() {
        while (activeLoads < CONFIG.maxParallelTiles && queue.length) {
            const job = queue.shift();
            if (job.isCancelled()) { job.reject('cancelled'); continue; }
            activeLoads++;
            fetch(job.url)
                .then(response => {
                    if (response.status === 404) throw { missing: true };
                    if (!response.ok) throw { retry: true };
                    return response.blob();
                })
                .then(blob => createImageBitmap(blob))
                .then(bitmap => { cacheImage(job.url, bitmap); job.resolve(bitmap); })
                .catch(err => {
                    if (err && err.missing) { job.reject('missing'); return; }
                    if (job.retries < 3 && !job.isCancelled()) {
                        job.retries++;
                        setTimeout(() => { queue.push(job); pumpQueue(); }, 800 * job.retries);
                    } else {
                        job.reject('failed');
                    }
                })
                .finally(() => { activeLoads--; pumpQueue(); });
        }
    }

    // Raster layer that draws SD-card tiles on canvases and falls back to an enlarged parent tile
    // when a tile is missing (areas only stored to zoom 14) or beyond the stored zoom.
    const SdTileLayer = L.GridLayer.extend({
        options: { layerId: 'mtn', ext: 'jpg', maxNativeZoom: CONFIG.maxNativeZoom },

        initialize(options) {
            L.GridLayer.prototype.initialize.call(this, options);
            this.on('tileunload', e => { e.tile.cancelled = true; });
        },

        createTile(coords, done) {
            const tile = document.createElement('canvas');
            const size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;
            tile.cancelled = false;
            const startDepth = Math.max(0, coords.z - this.options.maxNativeZoom);

            const attempt = depth => {
                if (tile.cancelled) return;
                const z = coords.z - depth;
                if (depth > startDepth + CONFIG.fallbackLevels || z < 0) {
                    drawMissing(tile);
                    done(null, tile);
                    return;
                }
                const src = Geo.parentTile(coords.z, coords.x, coords.y, depth, 256);
                const url = `/tiles/${this.options.layerId}/${z}/${src.x}/${src.y}.${this.options.ext}`;
                if (missingTiles.has(url)) { attempt(depth + 1); return; }
                fetchTile(url, () => tile.cancelled).then(bitmap => {
                    if (tile.cancelled) return;
                    const scale = bitmap.width / 256; // Tiles are 256 px; scale covers 512 px tiles too
                    tile.getContext('2d').drawImage(bitmap, src.sx * scale, src.sy * scale,
                        src.size * scale, src.size * scale, 0, 0, tile.width, tile.height);
                    done(null, tile);
                }, reason => {
                    if (reason === 'cancelled') return;
                    if (reason === 'missing') missingTiles.add(url);
                    attempt(depth + 1);
                });
            };
            attempt(startDepth);
            return tile;
        },
    });

    function drawMissing(tile) {
        const ctx = tile.getContext('2d');
        ctx.fillStyle = '#eceae4';
        ctx.fillRect(0, 0, tile.width, tile.height);
        ctx.strokeStyle = '#d6d3ca';
        for (let i = -tile.width; i < tile.width; i += 16) {
            ctx.beginPath(); ctx.moveTo(i, tile.height); ctx.lineTo(i + tile.height, 0); ctx.stroke();
        }
    }

    // ------------------------------------------------------------ Vector layer (MapLibre, loaded on demand)
    function hasWebGL() {
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.onload = resolve;
            el.onerror = () => reject(new Error('could not load ' + src));
            document.head.appendChild(el);
        });
    }

    let vectorLibs = null;
    function ensureVectorLibs() {
        if (!vectorLibs) {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = '/lib/maplibre-gl.css';
            document.head.appendChild(css);
            vectorLibs = loadScript('/lib/maplibre-gl.js')
                .then(() => loadScript('/lib/leaflet-maplibre-gl.js'))
                .catch(err => { vectorLibs = null; throw err; });
        }
        return vectorLibs;
    }

    const VectorLayer = L.Layer.extend({
        onAdd(map) {
            this.active = true;
            if (!hasWebGL()) {
                this.fallBack(map, 'this phone/browser cannot draw vector maps (no WebGL)');
                return;
            }
            notify('Loading vector map…');
            Promise.all([
                ensureVectorLibs(),
                fetch(CONFIG.vector.style)
                    .then(r => { if (!r.ok) throw new Error('vector style not on SD card'); return r.text(); })
                    // MapLibre needs absolute URLs; the style uses {origin} as a placeholder for this dongle
                    .then(text => JSON.parse(text.split('{origin}').join(location.origin))),
            ]).then(([, style]) => {
                if (!this.active) return;
                this.gl = L.maplibreGL({ style, attribution: CONFIG.attribution, interactive: false });
                this.gl.addTo(map);
                $('toast').hidden = true;
            }).catch(err => this.fallBack(map, err.message));
        },
        onRemove(map) {
            this.active = false;
            if (this.gl) { map.removeLayer(this.gl); this.gl = null; }
        },
        fallBack(map, reason) {
            notify(`Vector map unavailable: ${reason}. Showing the topographic map instead.`);
            // Deferred: Leaflet is still inside onAdd/addLayer when this runs synchronously
            setTimeout(() => {
                map.removeLayer(this);
                baseLayers[CONFIG.rasterLayers[0].name].addTo(map);
            }, 0);
        },
    });

    // ------------------------------------------------------------ UTM grid overlay
    const GRID_STEPS = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    const GRID_MAX_LINES = 12;
    let gridInterval = null;

    const UtmGrid = L.Layer.extend({
        onAdd(map) {
            this.group = L.layerGroup().addTo(map);
            this.renderer = L.canvas({ padding: 0.2 });
            map.on('moveend resize', this.redraw, this);
            this.redraw();
        },
        onRemove(map) {
            map.off('moveend resize', this.redraw, this);
            map.removeLayer(this.group);
            gridInterval = null;
            updateReadout();
        },
        redraw() {
            const map = this._map;
            this.group.clearLayers();
            if (map.getZoom() < 7) { gridInterval = null; return; }
            const bounds = map.getBounds(), center = map.getCenter();
            const zone = activeZone(center.lng);
            const corners = [bounds.getSouthWest(), bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthEast()]
                .map(p => Geo.toUtm(p.lat, p.lng, zone));
            const minE = Math.min(...corners.map(c => c.easting)), maxE = Math.max(...corners.map(c => c.easting));
            const minN = Math.min(...corners.map(c => c.northing)), maxN = Math.max(...corners.map(c => c.northing));
            const interval = GRID_STEPS.find(s => (maxE - minE) / s <= GRID_MAX_LINES) || GRID_STEPS[GRID_STEPS.length - 1];
            gridInterval = { interval, zone };
            const major = interval * (interval < 1000 ? 1000 / interval : 10);
            const style = v => ({
                renderer: this.renderer, interactive: false, color: '#b0006e',
                weight: v % major === 0 ? 2 : 1, opacity: 0.75,
            });
            const steps = 16;
            const label = v => interval < 1000 ? (v / 1000).toFixed(1) : String(Math.round(v / 1000));
            // Labels sit on the visible edges: where each line crosses the map's centre line, moved to the edge
            const size = map.getSize();
            const mid = Geo.toUtm(center.lat, center.lng, zone);
            const onScreen = (e, n) => { const p = Geo.fromUtm(zone, e, n, true); return map.latLngToContainerPoint([p.lat, p.lon]); };

            for (let e = Math.ceil(minE / interval) * interval; e <= maxE; e += interval) {
                const pts = [];
                for (let k = 0; k <= steps; k++) {
                    const p = Geo.fromUtm(zone, e, minN + (maxN - minN) * k / steps, true);
                    pts.push([p.lat, p.lon]);
                }
                L.polyline(pts, style(e)).addTo(this.group);
                this.addLabel(map.containerPointToLatLng([onScreen(e, mid.northing).x, size.y - 30]), label(e));
            }
            for (let n = Math.ceil(minN / interval) * interval; n <= maxN; n += interval) {
                const pts = [];
                for (let k = 0; k <= steps; k++) {
                    const p = Geo.fromUtm(zone, minE + (maxE - minE) * k / steps, n, true);
                    pts.push([p.lat, p.lon]);
                }
                L.polyline(pts, style(n)).addTo(this.group);
                this.addLabel(map.containerPointToLatLng([4, onScreen(mid.easting, n).y]), label(n), [0, 7]);
            }
            // UTM zone boundaries (every 6° of longitude) inside the view
            for (let lon = Math.ceil((bounds.getWest() + 180) / 6) * 6 - 180; lon <= bounds.getEast(); lon += 6) {
                L.polyline([[bounds.getSouth(), lon], [bounds.getNorth(), lon]], {
                    renderer: this.renderer, interactive: false, color: '#000', weight: 2, dashArray: '8 6', opacity: 0.7,
                }).addTo(this.group);
                this.addLabel([center.lat, lon], `Zone ${Geo.utmZone(lon - 0.1)} | ${Geo.utmZone(lon + 0.1)}`);
            }
            updateReadout();
        },
        addLabel(latlng, text, anchor = [24, 14]) {
            L.marker(latlng, {
                interactive: false, keyboard: false,
                icon: L.divIcon({ className: 'grid-label', html: text, iconSize: [48, 14], iconAnchor: anchor }),
            }).addTo(this.group);
        },
    });

    // ------------------------------------------------------------ State (declared before the map: the grid reads it as soon as it is added)
    let gps = null;              // Last /location response
    let gpsFix = false;
    let followGps = true;        // Map follows the GPS until the user pans away
    let firstFix = true;
    let userMarker = null;
    let target = store.get('target'); // {lat, lon, text}
    let zoneLock = store.get('zone');  // null = zone from the longitude; 29/30/31 = keep one zone across zone lines
    const activeZone = lon => zoneLock || Geo.utmZone(lon);
    let targetMarker = null, targetLine = null;

    // "Me" and "Target" buttons, added next to "Go to" (built here so older index.h pages get them too)
    if ($('centerBtn')) $('centerBtn').remove();
    for (const [id, label] of [['marksBtn', '🚩 Marks'], ['targetBtn', '🎯 Target'], ['meBtn', '📍 Me'], ['searchBtn', '🔍 Search']]) {
        const button = document.createElement('button');
        button.id = id;
        button.textContent = label;
        $('gotoBtn').after(button);
    }
    $('targetBtn').hidden = true;

    // ------------------------------------------------------------ Map setup
    const map = L.map('map', {
        minZoom: CONFIG.minZoom, maxZoom: CONFIG.maxZoom, zoomControl: true, attributionControl: true,
        maxBounds: CONFIG.bounds, maxBoundsViscosity: 1,
    }).setView([CONFIG.start.lat, CONFIG.start.lon], CONFIG.start.zoom);
    map.attributionControl.setPrefix(false);
    if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('map'));

    const baseLayers = {};
    CONFIG.rasterLayers.forEach(l => {
        baseLayers[l.name] = new SdTileLayer({
            layerId: l.id, ext: l.ext, attribution: CONFIG.attribution, maxZoom: CONFIG.maxZoom,
        });
    });
    baseLayers[CONFIG.vector.name] = new VectorLayer();
    const grid = new UtmGrid();

    const savedLayer = store.get('layer');
    (baseLayers[savedLayer] || baseLayers[CONFIG.rasterLayers[0].name]).addTo(map);

    const layersControl = L.control.layers(baseLayers, { 'UTM grid': grid }, { collapsed: true }).addTo(map);
    const layersToggle = document.querySelector('.leaflet-control-layers-toggle');
    layersToggle.textContent = '🗺️';
    Object.assign(layersToggle.style, {
        backgroundImage: 'none', fontSize: '24px', lineHeight: '44px', textAlign: 'center', textDecoration: 'none',
    });
    L.control.scale({ imperial: false, maxWidth: 140 }).addTo(map);
    map.on('baselayerchange', e => store.set('layer', e.name));
    map.on('overlayadd overlayremove', e => { if (e.layer === grid) store.set('grid', e.type === 'overlayadd'); });

    // North overlay (top right): true north up, grid and magnetic north at their real angles, values in text
    const NorthControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
            const div = L.DomUtil.create('div', 'north-box');
            div.innerHTML =
                '<svg viewBox="-40 -58 80 70" width="80" height="70" aria-hidden="true">' +
                '<g id="arrowTrue"><line x1="0" y1="8" x2="0" y2="-38" stroke="#000" stroke-width="2"/>' +
                '<text x="0" y="-40" text-anchor="middle" font-size="10">★</text></g>' +
                '<g id="arrowGrid"><line x1="0" y1="8" x2="0" y2="-24" stroke="#b0006e" stroke-width="2"/>' +
                '<text x="0" y="-26" text-anchor="middle" font-size="8" fill="#b0006e">GN</text></g>' +
                '<g id="arrowMag"><line x1="0" y1="8" x2="0" y2="-46" stroke="#d00" stroke-width="2" stroke-dasharray="4 2"/>' +
                '<text x="0" y="-48" text-anchor="middle" font-size="8" fill="#d00">MN</text></g>' +
                '</svg><div id="northText">…</div>' +
                '<select id="zoneLock" aria-label="UTM zone"><option value="">Zone auto</option>' +
                '<option value="29">Zone 29</option><option value="30">Zone 30</option><option value="31">Zone 31</option></select>';
            L.DomEvent.disableClickPropagation(div);
            const select = div.querySelector('#zoneLock');
            select.value = zoneLock || '';
            select.onchange = () => {
                zoneLock = Number(select.value) || null;
                store.set('zone', zoneLock);
                if (map.hasLayer(grid)) grid.redraw(); else updateReadout();
            };
            return div;
        },
    });
    new NorthControl().addTo(map);
    // Grid last: drawing it refreshes the readout and the north box, which must exist by now
    if (store.get('grid') !== false) grid.addTo(map);

    // ------------------------------------------------------------ Readout

    const pinIcon = L.divIcon({ className: 'emoji-icon', html: '📍', iconAnchor: [15, 30] });
    const targetIcon = L.divIcon({ className: 'emoji-icon', html: '🎯', iconAnchor: [15, 15] });

    function referencePoint() {
        if (gpsFix && followGps) return { lat: gps.latitude, lon: gps.longitude, source: 'gps' };
        const c = map.getCenter();
        return { lat: c.lat, lon: c.lng, source: 'center' };
    }

    function fmtDeg(v) {
        return `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
    }

    function fmtTime(date) {
        return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
    }

    function fmtDistance(m) {
        return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
    }

    function updateReadout() {
        const ref = referencePoint();
        const zone = activeZone(ref.lon);
        const utm = Geo.toUtm(ref.lat, ref.lon, zone);
        const now = new Date();
        const mag = Geo.magneticField(ref.lat, ref.lon, ((gps && gps.altitude) || 600) / 1000, Geo.decimalYear(now));
        const conv = Geo.gridConvergence(ref.lat, ref.lon, zone);
        const decl = mag ? mag.declination : 0;

        $('crosshair').hidden = ref.source !== 'center';
        $('targetBtn').hidden = !target;

        let source;
        if (ref.source === 'gps') {
            source = `📍 GPS · ${gps.satellites} 🛰️ · ±${Math.round((gps.hdop || 1) * 5)} m`;
        } else if (gps && gps.satellites > 0 && !gpsFix) {
            source = `✛ Map center · GPS searching (${gps.satellites} 🛰️)`;
        } else {
            source = gpsFix ? '✛ Map center · GPS ok' : '✛ Map center · no GPS fix';
        }
        $('rowSource').textContent = source;
        $('rowUtm').textContent = `UTM ${Geo.formatUtm(utm)}`;
        $('rowLatLon').textContent =
            `${ref.lat.toFixed(5)}, ${ref.lon.toFixed(5)} · ${Geo.formatDms(ref.lat, true)} ${Geo.formatDms(ref.lon, false)}`;

        const motion = [];
        if (gpsFix && gps.altitude) motion.push(`🏔️ ${Math.round(gps.altitude)} m`);
        if (gpsFix && gps.speed_kmh > 1) motion.push(`🚶 ${gps.speed_kmh.toFixed(1)} km/h → ${Math.round(gps.course)}°`);
        if (gridInterval) motion.push(`▦ ${fmtDistance(gridInterval.interval)} squares, zone ${gridInterval.zone}`);
        $('rowMotion').textContent = motion.join(' · ');
        $('rowMotion').hidden = motion.length === 0;

        const sun = Geo.sunTimes(now, ref.lat, ref.lon);
        let sunText = `🌅 ${now.toLocaleDateString([], { day: 'numeric', month: 'short' })}: ` +
            `${fmtTime(sun.sunrise)} – ${fmtTime(sun.sunset)}`;
        if (sun.sunset && now < sun.sunset && (!sun.sunrise || now > sun.sunrise)) {
            const mins = Math.round((sun.sunset - now) / 60000);
            sunText += ` · ${Math.floor(mins / 60)} h ${mins % 60} min of light left`;
        } else if (sun.sunset && now > sun.sunset) {
            sunText += ' · after sunset';
        }
        $('rowSun').textContent = sunText;

        // North overlay: arrows at their real angles; exact values in the text. ±0.4° is the World Magnetic
        // Model's own uncertainty at Spain's latitudes (local iron or power lines can add more).
        document.getElementById('arrowGrid').setAttribute('transform', `rotate(${conv.toFixed(2)})`);
        document.getElementById('arrowMag').setAttribute('transform', `rotate(${decl.toFixed(2)})`);
        $('northText').innerHTML =
            `<b>★</b> true north (map up)<br><span style="color:#b0006e">GN ${fmtDeg(conv)}</span> · ` +
            `<span style="color:#d00">MN ${mag ? fmtDeg(decl) + ' ±0.4°' : 'n/a'}</span>` +
            `<br><small>${mag ? mag.modelName + (Geo.decimalYear(now) > mag.validUntil ? ' EXPIRED' : '') + ' · ' : ''}` +
            `${ref.source === 'gps' ? 'GPS' : 'map centre'} · zone ${zone}</small>`;

        // Target
        if (target) {
            const dist = Geo.distanceMeters(ref.lat, ref.lon, target.lat, target.lon);
            const brg = Geo.bearingDegrees(ref.lat, ref.lon, target.lat, target.lon);
            const tu = Geo.toUtm(target.lat, target.lon, zone);
            const norm = v => Math.round((v + 360) % 360);
            const sq = gridInterval ? gridInterval.interval : 1000;
            const sqE = Math.floor(tu.easting / sq) * sq / 1000, sqN = Math.floor(tu.northing / sq) * sq / 1000;
            $('rowTarget').innerHTML =
                `🎯 ${fmtDistance(dist)} · ${norm(brg)}° true · ${norm(brg - decl)}° mag · ${norm(brg - conv)}° grid` +
                `<br><small>Target UTM ${Geo.formatUtm(tu)} · square E${sqE} N${sqN}</small>`;
            $('rowTarget').hidden = false;
            if (targetLine) targetLine.setLatLngs([[ref.lat, ref.lon], [target.lat, target.lon]]);
        } else {
            $('rowTarget').hidden = true;
        }
    }

    function setTarget(t, zoomTo) {
        if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
        if (targetLine) { map.removeLayer(targetLine); targetLine = null; }
        target = t;
        store.set('target', t);
        if (t) {
            targetMarker = L.marker([t.lat, t.lon], { icon: targetIcon, interactive: false }).addTo(map);
            targetLine = L.polyline([], { color: '#d00', weight: 3, dashArray: '6 6', interactive: false }).addTo(map);
            if (zoomTo) {
                followGps = false;
                // No animation: closing the Go-to box resizes the map at the same moment, which would cut it short
                map.setView([t.lat, t.lon], Math.max(map.getZoom(), 13), { animate: false });
            }
        }
        updateReadout();
    }

    // ------------------------------------------------------------ Go-to dialog
    $('gotoBtn').addEventListener('click', () => {
        $('gotoBox').hidden = !$('gotoBox').hidden;
        if (!$('gotoBox').hidden) $('gotoInput').focus();
    });
    $('gotoGo').addEventListener('click', () => {
        const text = $('gotoInput').value;
        const p = Geo.parseCoordinate(text);
        if (!p) { $('gotoError').textContent = 'Could not read that coordinate. See the examples below.'; return; }
        $('gotoError').textContent = '';
        $('gotoBox').hidden = true;
        setTarget({ lat: p.lat, lon: p.lon, text }, true);
    });
    $('gotoInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('gotoGo').click(); });
    $('gotoClear').addEventListener('click', () => { setTarget(null); $('gotoBox').hidden = true; });
    $('gotoHere').addEventListener('click', () => {
        const ref = referencePoint();
        $('gotoInput').value = Geo.formatUtm(Geo.toUtm(ref.lat, ref.lon, activeZone(ref.lon)));
    });

    $('meBtn').addEventListener('click', () => {
        if (!gpsFix) {
            notify('No GPS fix yet. After power-up the GPS can need a few minutes, faster outdoors with open sky.');
            return;
        }
        followGps = true;
        map.setView([gps.latitude, gps.longitude], Math.max(map.getZoom(), 14));
        updateReadout();
    });
    $('targetBtn').addEventListener('click', () => {
        if (!target) return;
        followGps = false;
        map.setView([target.lat, target.lon], Math.max(map.getZoom(), 13));
        updateReadout();
    });

    // Stop following the GPS when the user drags the map
    map.on('dragstart', () => { followGps = false; });
    map.on('moveend', updateReadout);

    // ------------------------------------------------------------ GPS polling
    async function poll() {
        try {
            const response = await fetch('/location', { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            gps = await response.json();
            gpsFix = !!gps.fix;
            $('panel').classList.remove('error');
            if (gpsFix) {
                const ll = [gps.latitude, gps.longitude];
                if (!userMarker) userMarker = L.marker(ll, { icon: pinIcon, interactive: false }).addTo(map);
                userMarker.setLatLng(ll);
                // No animation: a "Go to" during the zoom animation would be undone when it finishes
                if (firstFix) { map.setView(ll, Math.max(map.getZoom(), 14), { animate: false }); firstFix = false; }
                else if (followGps) map.panTo(ll, { animate: false });
            }
        } catch (e) {
            $('panel').classList.add('error');
        }
        updateReadout();
    }

    // ------------------------------------------------------------ Marks and routes (data model: marks.js)
    const ICONS = ['📍', '⛺', '💧', '🏠', '⚠️', '🅿️', '⭐', '🥾', '🚗', '⛰️', '🆘', '🚩'];
    let marks;
    try { marks = Marks.fromGeoJSON(store.get('marks')); } catch (e) { marks = Marks.create(); }
    let activeRoute = null;                          // id of the route that "+ Point" adds to
    const marksLayer = L.layerGroup().addTo(map);

    const marksStyle = document.createElement('style');
    marksStyle.textContent = `
        #marksBox { background: #222; padding: 8px; border-radius: 6px; margin-top: 6px; max-height: 40vh; overflow: auto; }
        #marksBox .row { display: flex; gap: 6px; margin: 4px 0; }
        #marksBox .row button, #marksBox .row label {
            flex: 1; background: #2d6cdf; color: #fff; border: 0; border-radius: 5px; padding: 8px 4px; font-size: 14px; text-align: center; }
        .m-row { display: flex; gap: 4px; align-items: center; margin: 3px 0; }
        .m-row.point { padding-left: 18px; }
        .m-row.active { outline: 2px solid #2ecc71; border-radius: 4px; }
        .m-row input { flex: 1; min-width: 0; font-size: 15px; padding: 5px; border-radius: 4px; border: 0; }
        .m-row button { flex: 0 0 auto; background: #444; color: #fff; border: 0; border-radius: 4px; padding: 5px 7px; font-size: 15px; }
        .m-row .m-num { width: 18px; color: #bbb; text-align: right; }
        .m-row .m-dist { color: #2ecc71; font-weight: bold; white-space: nowrap; }
        .mark-icon { font-size: 26px; line-height: 1; text-shadow: 0 0 3px #fff; }
        .route-point { font: bold 13px/22px system-ui, Arial, sans-serif; background: #0a6; color: #fff; border-radius: 50%;
            width: 22px !important; height: 22px !important; text-align: center; text-shadow: none; }`;
    document.head.append(marksStyle);

    const marksBox = document.createElement('div');
    marksBox.id = 'marksBox';
    marksBox.hidden = true;
    marksBox.innerHTML =
        '<div class="row"><button id="marksAddMark">＋ Mark</button><button id="marksAddRoute">＋ Route</button>' +
        '<button id="marksAddPoint">＋ Point</button></div>' +
        '<div id="marksList"></div>' +
        '<div class="row"><button id="marksSave">💾 Save</button><button id="marksSaveGpx">GPX</button>' +
        '<label>📂 Load<input id="marksLoad" type="file" accept=".json,.geojson,application/json" hidden></label>' +
        '<button id="marksClear">🗑️ All</button></div>' +
        '<small>Marks and points are placed at the GPS position, or at the ✛ map centre after you move the map.</small>';
    $('gotoBox').after(marksBox);

    function marksChanged() {
        store.set('marks', Marks.toGeoJSON(marks));
        renderMarks();
    }

    // One list row: [number] icon, tag/name, then buttons; data-label is what the row shows (used by tests too)
    function markRow(item, label, extra) {
        const row = document.createElement('div');
        row.className = 'm-row' + (item.kind === 'point' ? ' point' : '') + (item.id === activeRoute ? ' active' : '');
        row.dataset.id = item.id;
        row.dataset.label = label;
        const field = item.kind === 'route' ? 'name' : 'tag';
        row.innerHTML = (extra.number ? `<span class="m-num">${extra.number}</span>` : '') +
            `<button class="m-icon">${item.icon || '·'}</button><input class="m-${field}">` +
            (extra.distance ? `<span class="m-dist">${extra.distance}</span>` : '') +
            (item.kind !== 'route' ? '<button class="m-go" title="Go to">🎯</button>' : '') +
            (item.kind === 'point' ? '<button class="m-up">⬆</button><button class="m-down">⬇</button>' : '') +
            '<button class="m-del" title="Remove">✕</button>';
        const input = row.querySelector('input');
        input.value = item[field];
        input.onchange = () => { Marks.update(marks, item.id, { [field]: input.value }); marksChanged(); };
        row.querySelector('.m-icon').onclick = () => {
            Marks.update(marks, item.id, { icon: ICONS[(ICONS.indexOf(item.icon) + 1) % ICONS.length] });
            marksChanged();
        };
        row.querySelector('.m-del').onclick = () => {
            if (item.id === activeRoute) activeRoute = null;
            Marks.remove(marks, item.id);
            marksChanged();
        };
        if (row.querySelector('.m-go')) row.querySelector('.m-go').onclick = () =>
            setTarget({ lat: item.lat, lon: item.lon, text: item.tag }, true);
        if (row.querySelector('.m-up')) {
            row.querySelector('.m-up').onclick = () => { Marks.move(marks, item.id, -1); marksChanged(); };
            row.querySelector('.m-down').onclick = () => { Marks.move(marks, item.id, 1); marksChanged(); };
        }
        if (item.kind === 'route') row.onclick = e => { if (e.target === row) { activeRoute = item.id; renderMarks(); } };
        return row;
    }

    function renderMarks() {
        marksLayer.clearLayers();
        const list = $('marksList');
        list.innerHTML = '';
        const icon = (html, cls) => L.divIcon({ className: 'mark-icon' + (cls ? ' ' + cls : ''), html, iconAnchor: [13, 13] });
        marks.items.forEach(item => {
            if (item.kind === 'mark') {
                L.marker([item.lat, item.lon], { icon: icon(item.icon), interactive: false }).addTo(marksLayer);
                list.append(markRow(item, `${item.icon} ${item.tag}`, {}));
                return;
            }
            L.polyline(item.points.map(p => [p.lat, p.lon]),
                { className: 'route-line', color: '#0a6', weight: 4, opacity: 0.85, interactive: false }).addTo(marksLayer);
            const total = fmtDistance(Marks.legs(item).total);
            list.append(markRow(item, `${item.icon} ${item.name} · ${total}`, { distance: total }));
            item.points.forEach((p, i) => {
                L.marker([p.lat, p.lon], { icon: p.icon ? icon(p.icon) : icon(String(i + 1), 'route-point'), interactive: false })
                    .addTo(marksLayer);
                list.append(markRow(p, `${i + 1} ${p.icon ? p.icon + ' ' : ''}${p.tag}`, { number: i + 1 }));
            });
        });
    }

    function download(name, text, type) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type }));
        a.download = name;
        a.click();
    }
    const fileDate = () => new Date().toISOString().slice(0, 10);
    const countOf = kind => marks.items.filter(i => i.kind === kind).length;

    // Only one of the two panels at a time: both open would squeeze the map to nothing on a phone
    $('marksBtn').addEventListener('click', () => {
        marksBox.hidden = !marksBox.hidden;
        $('gotoBox').hidden = true;
    });
    $('gotoBtn').addEventListener('click', () => { marksBox.hidden = true; });
    $('marksAddMark').onclick = () => {
        const ref = referencePoint();
        Marks.addMark(marks, { lat: ref.lat, lon: ref.lon, icon: ICONS[0], tag: `Mark ${countOf('mark') + 1}` });
        marksChanged();
    };
    $('marksAddRoute').onclick = () => {
        activeRoute = Marks.addRoute(marks, { name: `Route ${countOf('route') + 1}`, icon: '🚩' });
        marksChanged();
    };
    $('marksAddPoint').onclick = () => {
        if (!activeRoute || !Marks.find(marks, activeRoute)) $('marksAddRoute').click();
        const ref = referencePoint();
        const route = Marks.find(marks, activeRoute);
        Marks.addPoint(marks, activeRoute, { lat: ref.lat, lon: ref.lon, tag: `Point ${route.points.length + 1}` });
        marksChanged();
    };
    $('marksSave').onclick = () => download(`marks-${fileDate()}.json`, JSON.stringify(Marks.toGeoJSON(marks)), 'application/json');
    $('marksSaveGpx').onclick = () => download(`marks-${fileDate()}.gpx`, Marks.toGPX(marks), 'application/gpx+xml');
    $('marksClear').onclick = () => {
        if (!marks.items.length || !confirm('Remove all marks and routes?')) return;
        Marks.clear(marks);
        activeRoute = null;
        marksChanged();
    };
    $('marksLoad').onchange = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const loaded = Marks.fromGeoJSON(JSON.parse(await file.text()));
            if (marks.items.length && !confirm('Replace the current marks and routes with this file?')) return;
            marks = loaded;
            activeRoute = null;
            marksChanged();
        } catch (err) {
            notify(`Could not load ${file.name}: ${err.message}`);
        }
    };
    renderMarks();

    // ------------------------------------------------------------ Search and points of interest (data: search.js)
    // Built on the PC by tools/build_search.py from OpenStreetMap; the phone fetches small files from /search/.
    const KINDS = {
        street: ['🛣️', 'Street'], path: ['🥾', 'Path'], place: ['🏘️', 'Town'], metro_entrance: ['🚇', 'Metro entrance'],
        metro_station: ['🚇', 'Metro station'], station: ['🚉', 'Station'], bunker: ['🛡️', 'Bunker'],
        police: ['👮', 'Police'], military: ['🎖️', 'Military'], peak: ['⛰️', 'Peak'], water: ['💧', 'Water'],
        shelter: ['🛖', 'Shelter'], hospital: ['🏥', 'Hospital'], emergency: ['🚒', 'Emergency services'],
    };
    const kindOf = kind => KINDS[kind] || ['•', kind];
    const search = Search.create(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    });
    let found = [], picked = null;                   // last results, and the one being previewed
    const previewLayer = L.layerGroup().addTo(map);

    const searchStyle = document.createElement('style');
    searchStyle.textContent = `
        #searchBox { background: #222; padding: 8px; border-radius: 6px; margin-top: 6px; }
        #searchBox input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 8px; border-radius: 4px; border: 0; }
        #searchResults { max-height: 30vh; overflow: auto; margin-top: 6px; }
        #searchResults div { padding: 7px 4px; border-bottom: 1px solid #333; }
        #searchResults div.picked { background: #2d6cdf; }
        #searchResults small { color: #bbb; }
        #searchBox .row { display: flex; gap: 6px; margin-top: 6px; }
        #searchBox .row button { flex: 1; background: #2d6cdf; color: #fff; border: 0; border-radius: 5px; padding: 8px 4px; font-size: 14px; }
        .poi-icon { font-size: 20px; line-height: 1; text-shadow: 0 0 3px #fff; }`;
    document.head.append(searchStyle);

    const searchBox = document.createElement('div');
    searchBox.id = 'searchBox';
    searchBox.hidden = true;
    searchBox.innerHTML =
        '<input id="searchInput" type="search" autocomplete="off" placeholder="Street number, town · metro · peak…">' +
        '<div id="searchStatus"></div><div id="searchResults"></div>' +
        '<div class="row" id="searchActions" hidden><button id="searchGo">🎯 Go</button><button id="searchMark">＋ Mark</button></div>';
    $('gotoBox').after(searchBox);

    const resultName = r => r.number ? `${r.name} ${r.number.text}` : r.name;
    const resultSpot = r => r.number || r;

    async function runSearch() {
        const text = $('searchInput').value.trim();
        previewLayer.clearLayers();
        $('searchResults').innerHTML = '';
        $('searchActions').hidden = true;
        picked = null;
        if (!text) return;
        $('searchStatus').textContent = 'Searching…';
        try {
            await search.manifest();
        } catch (e) {
            $('searchStatus').textContent = 'No search data on the card (the search/ folder, made by tools/build_search.py).';
            return;
        }
        found = await search.query(text, referencePoint());
        $('searchStatus').textContent = found.length ? `${found.length} result${found.length > 1 ? 's' : ''} · tap one to see it`
            : 'No results. Try fewer or shorter words.';
        found.forEach((r, i) => {
            const row = document.createElement('div');
            row.dataset.index = i;
            const [icon, label] = kindOf(r.kind);
            row.textContent = `${icon} ${resultName(r)} `;
            const info = document.createElement('small');
            info.textContent = [label, r.place, r.distance ? fmtDistance(r.distance) : ''].filter(Boolean).join(' · ');
            row.append(info);
            row.onclick = () => preview(i);
            $('searchResults').append(row);
        });
    }

    // Shows a result on the map without choosing it: the whole street, or the spot
    async function preview(i) {
        picked = found[i];
        $('searchResults').querySelectorAll('div').forEach(row => row.classList.toggle('picked', row.dataset.index === String(i)));
        $('searchActions').hidden = false;
        previewLayer.clearLayers();
        followGps = false;
        const street = picked.ref >= 0 ? await search.street(picked.ref) : null;
        if (picked !== found[i]) return;               // another result was tapped meanwhile
        const spot = resultSpot(picked);
        if (street) {
            street.lines.forEach(line => L.polyline(line,
                { className: 'search-highlight', color: '#ff00c8', weight: 7, opacity: 0.8, interactive: false }).addTo(previewLayer));
        }
        if (picked.number) {
            L.marker([spot.lat, spot.lon], { icon: L.divIcon({ className: 'mark-icon search-number', html: '🚪', iconAnchor: [13, 13] }),
                interactive: false }).addTo(previewLayer);
        } else if (!street) {
            L.marker([spot.lat, spot.lon], { icon: targetIcon, interactive: false }).addTo(previewLayer);
        }
        if (street && !picked.number) map.fitBounds(street.lines.flat(), { maxZoom: 17, animate: false });
        else map.setView([spot.lat, spot.lon], Math.max(map.getZoom(), 16), { animate: false });
        updateReadout();
    }

    $('searchBtn').addEventListener('click', () => {
        searchBox.hidden = !searchBox.hidden;
        $('gotoBox').hidden = true;
        marksBox.hidden = true;
        if (!searchBox.hidden) $('searchInput').focus();
    });
    $('gotoBtn').addEventListener('click', () => { searchBox.hidden = true; });
    $('marksBtn').addEventListener('click', () => { searchBox.hidden = true; });
    $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
    $('searchGo').onclick = () => {
        const spot = resultSpot(picked);
        searchBox.hidden = true;
        setTarget({ lat: spot.lat, lon: spot.lon, text: resultName(picked) }, true);
    };
    $('searchMark').onclick = () => {
        const spot = resultSpot(picked);
        Marks.addMark(marks, { lat: spot.lat, lon: spot.lon, icon: ICONS[0], tag: resultName(picked) });
        marksChanged();
        notify(`Added to 🚩 Marks: ${resultName(picked)}`);
    };

    // Points of interest overlay: drawn from zoom 12, from the zoom-10 tiles that cover the screen
    const POI_MIN_ZOOM = 12;
    const poiLayer = L.layerGroup();
    async function drawPois() {
        if (!map.hasLayer(poiLayer)) return;
        if (map.getZoom() < POI_MIN_ZOOM) { poiLayer.clearLayers(); return; }
        let m;
        try { m = await search.manifest(); } catch (e) { notify('No points of interest: no search data on the card.'); return; }
        const b = map.getBounds(), n = 2 ** m.poiZoom;
        const tx = lon => Math.floor((lon + 180) / 360 * n);
        const ty = lat => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        const jobs = [];
        for (let x = tx(b.getWest()); x <= tx(b.getEast()); x++)
            for (let y = ty(b.getNorth()); y <= ty(b.getSouth()); y++) jobs.push(search.poiTile(x, y));
        const pois = (await Promise.all(jobs)).flat();
        poiLayer.clearLayers();
        for (const [kind, name, lat5, lon5] of pois) {
            const [icon, label] = kindOf(kind);
            L.marker([lat5 / 1e5, lon5 / 1e5], { icon: L.divIcon({ className: 'poi-icon', html: icon, iconAnchor: [10, 10] }) })
                .bindPopup(name === label ? label : `${name}<br><small>${label}</small>`).addTo(poiLayer);
        }
    }
    layersControl.addOverlay(poiLayer, 'Points of interest');
    map.on('moveend', drawPois);
    map.on('overlayadd overlayremove', e => {
        if (e.layer !== poiLayer) return;
        store.set('poi', e.type === 'overlayadd');
        if (e.type === 'overlayadd') drawPois(); else poiLayer.clearLayers();
    });
    if (store.get('poi')) poiLayer.addTo(map);

    if (target) setTarget(target, false);
    poll();
    setInterval(poll, CONFIG.pollMs);
})();
