// Seam 5: which stored tile to enlarge when the requested one is missing or beyond the stored zoom.
// Expected values worked out by hand from the slippy-map tile scheme (each zoom level splits a tile in 4).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSdCardScripts } = require('./load');

const { Geo } = loadSdCardScripts('geo.js');

test('depth 0 uses the tile itself, whole', () => {
    assert.deepEqual({ ...Geo.parentTile(14, 8023, 6177, 0, 256) }, { z: 14, x: 8023, y: 6177, sx: 0, sy: 0, size: 256 });
});

test('depth 1 uses the parent tile and the right quarter of it', () => {
    // 8023 is odd -> right half; 6177 is odd -> bottom half
    assert.deepEqual({ ...Geo.parentTile(15, 16047, 12355, 1, 256) }, { z: 14, x: 8023, y: 6177, sx: 128, sy: 128, size: 128 });
});

test('depth 2 uses the grandparent and one sixteenth of it', () => {
    // x = 4*8023 + 2, y = 4*6177 + 1 -> column 2, row 1 of a 4x4 split of 64 px cells
    assert.deepEqual({ ...Geo.parentTile(16, 32094, 24709, 2, 256) }, { z: 14, x: 8023, y: 6177, sx: 128, sy: 64, size: 64 });
});
