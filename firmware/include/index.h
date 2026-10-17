// Map page shell. The map application itself (nav.js, geo.js, wmm.js) lives on the SD card,
// so it can be updated by copying files instead of reflashing.
const char index_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
    <title>Chiwire Maps</title>
    <link rel="icon" href="/favicon.ico">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="apple-touch-icon" href="/icon-192.png">
    <link rel="stylesheet" href="/leaflet.css">
    <style>
        html, body { margin: 0; height: 100%; font-family: system-ui, Arial, sans-serif; }
        body { display: flex; flex-direction: column; }
        #map { flex: 1; min-height: 0; }
        .emoji-icon { font-size: 30px; line-height: 1; }
        .grid-label {
            color: #b0006e; font: bold 11px/1 system-ui, Arial, sans-serif; white-space: nowrap;
            text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff;
        }
        #crosshair {
            position: absolute; left: 50%; top: 50%; z-index: 500; pointer-events: none;
            transform: translate(-50%, -50%); font-size: 28px; color: #d00; text-shadow: 0 0 3px #fff;
        }
        #mapWrap { position: relative; flex: 1; display: flex; min-height: 0; }
        .north-box {
            background: rgba(255, 255, 255, 0.9); border-radius: 6px; padding: 4px 6px;
            font-size: 11px; line-height: 1.3; text-align: center; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        }
        #panel {
            background: #111; color: #fff; padding: 6px 10px; font-size: 13px; line-height: 1.35;
            border-top: 3px solid #111;
        }
        #panel.error { border-top-color: #f39c12; }
        #logo { float: right; width: 26px; height: 26px; }
        #panel .big { font-size: 17px; font-weight: bold; letter-spacing: 0.5px; }
        #panel small { color: #bbb; }
        .buttons { display: flex; gap: 6px; margin-top: 5px; }
        .buttons button, #gotoBox button {
            flex: 1; background: #2d6cdf; color: #fff; border: 0; border-radius: 5px; padding: 8px 4px; font-size: 14px;
        }
        #gotoBox { background: #222; padding: 8px; border-radius: 6px; margin-top: 6px; }
        #gotoBox input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 8px; border-radius: 4px; border: 0; }
        #gotoBox .row { display: flex; gap: 6px; margin-top: 6px; }
        #gotoError { color: #ff8a80; }
        #toast {
            position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 1000;
            background: #333; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; max-width: 85%;
        }
        [hidden] { display: none !important; }
    </style>
</head>
<body>
<div id="mapWrap">
    <div id="map"></div>
    <div id="crosshair" hidden>✛</div>
    <div id="toast" hidden></div>
</div>
<div id="panel">
    <img id="logo" src="/icon-192.png" alt="Chiwire Maps">
    <div id="rowSource">Starting…</div>
    <div id="rowUtm" class="big">UTM …</div>
    <div id="rowLatLon"></div>
    <div id="rowMotion" hidden></div>
    <div id="rowSun"></div>
    <div id="rowTarget" hidden></div>
    <div id="gotoBox" hidden>
        <input id="gotoInput" type="text" autocomplete="off" autocapitalize="characters"
               placeholder="30T 440300 4474260  or  40.4168, -3.7038">
        <div id="gotoError"></div>
        <div class="row">
            <button id="gotoGo">Go</button><button id="gotoHere">Use here</button><button id="gotoClear">Clear target</button>
        </div>
        <small>UTM: 30T 440300 4474260 · Decimal: 40.4168, -3.7038 · DMS: 40°25'00"N 3°42'13"W (O = W)</small>
    </div>
    <div class="buttons">
        <button id="gotoBtn">🎯 Go to</button>
        <button onclick="location.href='/files'">🗂️ Files</button>
    </div>
</div>
<script src="/leaflet.js"></script>
<script src="/wmm.js"></script>
<script src="/geo.js"></script>
<script src="/marks.js"></script>
<script src="/search.js"></script>
<script src="/nav.js"></script>
</body>
</html>
)rawliteral";
