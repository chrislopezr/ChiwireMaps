# Chiwire Maps 6: Sources and Licenses

Where every map, data set and library in Chiwire Maps comes from, and the license it is used under. All links were checked when this guide was written.

## Contents

1. [Map tiles](#map-tiles)
2. [Search data](#search-data)
3. [Magnetic model and sun times](#magnetic-model-and-sun-times)
4. [Libraries on the SD card](#libraries-on-the-sd-card)
5. [Firmware libraries](#firmware-libraries)
6. [The original project](#the-original-project)
7. [Chiwire Maps' own code](#chiwire-maps-own-code)
8. [Sources for the safety guide](#sources-for-the-safety-guide)

## Map tiles

All four map layers come from the **Instituto Geográfico Nacional (IGN)** and the **Centro Nacional de Información Geográfica (CNIG)** of Spain.

| Layer | Service | Layer name | Format |
|---|---|---|---|
| Topographic (MTN) | `https://www.ign.es/wmts/mapa-raster` | `MTN` | JPEG |
| Aerial (PNOA) | `https://www.ign.es/wmts/pnoa-ma` | `OI.OrthoimageCoverage` | JPEG |
| Streets (IGN Base) | `https://www.ign.es/wmts/ign-base` | `IGNBaseTodo` | JPEG |
| Vector | `https://vt-mapabase.idee.es/1.0.0/mapabase/{z}/{x}/{y}.pbf` | Mapa Base vector tiles, with contours (`altimetria_lin`) and paths | Mapbox Vector Tiles |

All raster layers use the `GoogleMapsCompatible` tile matrix set (Web Mercator, the same z/x/y scheme as the card).

- **License:** [Creative Commons Attribution 4.0 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
- **Required credit:** "© Instituto Geográfico Nacional de España". The map shows it in its bottom corner on every layer.
- The tiles are not stored in this repository. `tileDownloader/spain_tiles.py` downloads them at a moderate speed; see [guide 1](01-device-setup.md#downloading-the-map-tiles).
- The vector style, its icons and fonts are adapted from the IGN/CNIG Mapa Base style (`https://vt-mapabase.idee.es/files/styles/mapaBase_scn_color1_CNIG.json`). The fonts are Noto Sans (SIL Open Font License 1.1) and DejaVu Serif (Bitstream Vera license, free).

More about the services: [IGN](https://www.ign.es/) and [CNIG](https://www.cnig.es/).

## Search data

- **Source:** [OpenStreetMap](https://www.openstreetmap.org/), the Spain extract from [Geofabrik](https://download.geofabrik.de/europe/spain.html).
- **License:** [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
- **Required credit:** "© OpenStreetMap contributors". It is stored in the search data itself (`manifest.json.gz`).
- The data on the card is a derived database built by `tools/build_search.py`. If you share a card or its `search/` folder, the ODbL applies to that data: keep the credit, and offer the data under the ODbL.

## Magnetic model and sun times

- **World Magnetic Model 2025 (WMM2025)** by NOAA's National Centers for Environmental Information and the British Geological Survey: [ncei.noaa.gov/products/world-magnetic-model](https://www.ncei.noaa.gov/products/world-magnetic-model). Public domain (a US Government work). Valid 2025.0–2030.0. Converted to `sdCard/wmm.js` by `tools/make_wmm_js.py`; the official test values are in `tests/web/fixtures/`.
- **Sun times:** the NOAA solar calculation algorithm, checked against the US Naval Observatory (USNO) tables (within 0.52 minutes).
- **Grid convergence:** Karney's method for the transverse Mercator projection, checked against GeographicLib (within 1e-9°).

## Libraries on the SD card

| Library | Version | License | Used for |
|---|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD 2-Clause | The map |
| [MapLibre GL JS](https://maplibre.org/) | 4.7.1 | BSD 3-Clause | Drawing the vector layer |
| [maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) | — | ISC | Joins MapLibre to Leaflet |

Their license notices are kept at the top of each file.

## Firmware libraries

| Library | Version | License |
|---|---|---|
| Arduino core for the ESP32 (Espressif) | 2.0.17 | LGPL 2.1 |
| TFT_eSPI (Bodmer) | 2.5.43 | FreeBSD, with MIT parts from Adafruit |
| ESPAsyncWebServer (esp32async) | 3.12.1 | LGPL 3.0 |
| AsyncTCP (esp32async) | 3.5.0 | LGPL 3.0 |
| TinyGPSPlus (Mikal Hart) | 1.1.0 | LGPL 2.1 or later |
| ArduinoJson (Benoît Blanchon) | 7.4.3 | MIT |
| QRCode (Richard Moore) | 0.0.1 | MIT |
| Unity (ThrowTheSwitch), PC tests only | 2.6.1 | MIT |

PlatformIO downloads them at build time; they are not stored in this repository. The firmware links them statically; if you distribute a firmware binary, the LGPL lets the recipient relink it with changed versions of those libraries, so offer the source (this repository) with the binary.

## The original project

Chiwire Maps is based on **Backcountry Beacon** by diyaquanauts: the hardware idea, the original firmware structure (the web server, the middleware system, the screen and QR code), the 3D-printed GPS holder in `parts3D/`, and the first tile downloader for maps of the United States.

- Repository: [github.com/diyaquanauts/BackcountryBeacon](https://github.com/diyaquanauts/BackcountryBeacon)
- Build guide: [USB Powered Offline Map Server on Instructables](https://www.instructables.com/USB-Powered-Offline-Map-Server/)

The original repository has no license file, so its code remains under its authors' rights. This project is published as a fork of it on GitHub, with this credit.

## Chiwire Maps' own code

The code and documents written for Chiwire Maps (the Spain tile downloader, the search, the marks and routes, the north and sun calculations, the upload, the tests and these guides) are released under the [MIT License](../../LICENSE).

The development skills in `firmware/.claude/skills/` keep their own licenses next to them.

## Sources for the safety guide

| Topic | Source |
|---|---|
| Mountain forecasts and avalanche bulletins | [AEMET](https://www.aemet.es/es/eltiempo/prediccion/montana) |
| Avalanche bulletin for the Catalan Pyrenees | [ICGC](https://bpa.icgc.cat/) |
| Mountain rescue (GREIM) | [Guardia Civil](https://www.guardiacivil.es/) |
| Route ratings (MIDE) and planning | [Montaña Segura](https://www.montanasegura.com/) |
| Mountain federation and licence insurance | [FEDME](https://www.fedme.es/) |
| First aid courses | [Spanish Red Cross](https://www.cruzroja.es/) |
| Official geodetic system (ETRS89) | Royal Decree 1071/2007 |
