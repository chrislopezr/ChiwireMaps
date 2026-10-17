<p align="center"><img src="docs/images/chiwire-maps.png" alt="Chiwire Maps capybara" width="160"></p>

# Chiwire Maps

Offline maps of mainland Spain in your pocket. A LilyGo T-Dongle S3 with a GPS and a microSD card makes its own Wi-Fi network; any phone that joins it opens the map in the browser. No app, no mobile data, no internet.

- **Four map layers** from the Spanish National Geographic Institute (IGN): topographic (MTN, with contour lines), aerial photos (PNOA), streets (IGN Base) and vector. The whole peninsula is stored to zoom 14, and the mountain ranges and the Community of Madrid to zoom 16.
- **Search** for streets with house numbers, towns, metro stations and entrances, police, military areas, bunkers, shelters, water and peaks. It all runs offline on the phone, from OpenStreetMap data stored on the card.
- **Navigation tools:** live GPS position, UTM grid, "go to" any coordinate, marks and routes (saved as GeoJSON or GPX), sunrise and sunset, and true, grid and magnetic north.
- **File server:** browse, download and upload files in the card's `/serve` folder over Wi-Fi.

## Quick start

1. Build and flash the firmware: `cd firmware && ~/.platformio/penv/bin/pio run -t upload --upload-port /dev/ttyACM0` (with the dongle in flash mode: hold BOOT while plugging it in).
2. Format a 64 GB microSD card as FAT32 with 4 KB clusters.
3. Download the map tiles (`tileDownloader/spain_tiles.py`, about 42 h) and build the search data (`tools/build_search.py`, about 5 min).
4. Copy `sdCard/` to the card, insert it, power the dongle, scan the QR code on its screen and open `http://192.168.4.1`.

Each step is explained in [the setup guide](docs/guides/01-device-setup.md).

## Guides

Each guide is in Markdown, with `.odt`, `.docx` and `.pdf` copies next to it in [`docs/guides/`](docs/guides/).

1. [Device setup](docs/guides/01-device-setup.md): flashing, the SD card, tiles, search data, copying to the card
2. [Using the device](docs/guides/02-using-the-device.md): lights, screen, the map, search, marks, files and upload
3. [Navigation guide](docs/guides/03-navigation-guide.md): coordinates in Spain, the grid, the three norths, contours, planning
4. [Safety and emergencies](docs/guides/04-safety-and-emergencies.md): 112, giving your position, rescue, weather, avalanches
5. [Maintenance](docs/guides/05-maintenance.md): project structure, updates, the magnetic model, debugging
6. [Sources and licenses](docs/guides/06-sources-and-licenses.md): maps, data, libraries and credits
7. [Building your own](docs/guides/07-replicate-from-scratch.md): parts, the GPS cable, tools, troubleshooting

Open work is listed in [TODO.md](TODO.md).

## Repository structure

| Folder | Contents |
|---|---|
| `firmware/` | Source code for the T-Dongle S3 (PlatformIO): Wi-Fi access point, web server, GPS, screen, upload |
| `sdCard/` | What goes on the microSD card: the map app (`nav.js`, `geo.js`, `marks.js`, `search.js`), libraries, the `/serve` folder |
| `tileDownloader/` | `spain_tiles.py`: downloads the IGN map tiles for the card |
| `tools/` | Builds the search data from OpenStreetMap, the magnetic model, the icon and the guides |
| `tests/` | Automated tests: web app, browser end-to-end, downloader, search builder |
| `parts3D/` | 3D-printable GPS holder |
| `docs/` | The guides and the work plan |

Map tiles and search data are not stored in this repository (tens of GB); the scripts download and build them.

## Tests

The project is developed test-first. From the repository root:

```
node --test "tests/web/*.test.js"                              # web app
(cd tests && node --test "e2e/*.test.js")                      # real page in headless Chrome
python3 -m unittest discover -s tests/downloader               # tile downloader
tools/.venv/bin/python -m unittest discover -s tests/search    # search builder
(cd firmware && ~/.platformio/penv/bin/pio test -e native)     # firmware helpers on the PC
(cd firmware && ~/.platformio/penv/bin/pio run)                # firmware build
```

The maths is checked against official reference data: NOAA/USNO sun times, GeographicLib grid convergence and the WMM2025 test values.

## Credits and licenses

- Based on **[Backcountry Beacon](https://github.com/diyaquanauts/BackcountryBeacon)** by diyaquanauts ([build guide on Instructables](https://www.instructables.com/USB-Powered-Offline-Map-Server/)): the original hardware design, firmware structure and GPS holder, made for maps of the United States. Chiwire Maps adapts it to Spain and adds the search, marks, north, upload and guides. The original project has no license file; its code remains under its authors' rights.
- Chiwire Maps' own code and documents: [MIT License](LICENSE).
- Maps: © Instituto Geográfico Nacional de España, CC BY 4.0.
- Search data: © OpenStreetMap contributors, ODbL 1.0 ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)).
- Magnetic north: World Magnetic Model (NOAA / BGS), public domain.
- Libraries: Leaflet (BSD-2-Clause), MapLibre GL JS (BSD-3-Clause), maplibre-gl-leaflet (ISC), and the firmware libraries listed in [guide 6](docs/guides/06-sources-and-licenses.md), each under its own license.
