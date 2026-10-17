// Loads the SD card scripts the way the browser does (globals on window), for node:test.
// SDCARD_DIR overrides the folder, which lets a mutated copy be tested.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = process.env.SDCARD_DIR || path.join(__dirname, '..', '..', 'sdCard');

function loadSdCardScripts(...names) {
    const window = {};
    const context = vm.createContext({ window, Math, Date, JSON, Array, Object, Number, String, isFinite, parseFloat, parseInt });
    for (const name of names) vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), context, { filename: name });
    return window;
}

module.exports = { loadSdCardScripts };
