# Needs for the Final Navigation Guide

This is the work plan behind the guides in [`docs/guides/`](guides/). It lists what had to be built, checked and measured before the guides could be written, and the facts the guides are based on. The open items are collected in [`TODO.md`](../TODO.md).

- **Project:** Chiwire Maps, Spain edition (LilyGo T-Dongle S3 + GPS + 64 GB microSD)
- **Status:** all features are built and tested on the PC. The guides are written. Some device tests, the hardware measurements and the screenshots are still open (see `TODO.md`); the guides say "not measured yet" wherever a value is missing.

---

## 1. Prerequisites

Each item must be **implemented, flashed and tested on the real device** before its documentation is final.

### 1.1 Hardware
- [x] GPS module works without turning the screen off. The cause was the wiring, not the power: the cable was rebuilt on a protoboard with the data lines crossed (dongle RX to GPS TX, dongle TX to GPS RX), and the screen stays on.
- [x] GPS gets a position fix outdoors and the green LED lights up.
- [ ] `/location` returns real coordinates on the device (see `TODO.md`).
- [ ] Measure power draw (dongle alone, with GPS, with 1–4 phones connected) and test battery life with a typical power bank.
- [ ] Find the maximum range of the dongle's Wi-Fi outdoors, for the usage chapter.

### 1.2 Firmware and map features
- [x] SD card mounting, Wi-Fi access point, web server
- [x] Low-memory guard tuned to 40 KB
- [x] `/serve` subfolder browsing (250-item limit, safe paths, UTF-8 names)
- [x] Status LED (yellow startup, red error, blue device connected, green GPS fix)
- [x] Map with four layers: MTN topographic, PNOA aerial, IGN Base, and vector
- [x] UTM grid with labels, zone lines and a zone lock (29/30/31)
- [x] "Go to coordinate" (UTM, decimal or degrees-minutes-seconds; target marker, distance and bearing)
- [x] North overlay: true north, grid north (exact UTM convergence) and magnetic north (WMM2025 declination)
- [x] Extra navigation info: scale bar, position in UTM, decimal and DMS, altitude, speed/course, sunrise, sunset and daylight left
- [x] The map opens over Madrid when there's no GPS fix, and can't be dragged outside the peninsula
- [x] Browser caching for static files and tiles (Cache-Control: 30 days for tiles, 7 days for libraries, `no-cache` for the app)
- [x] Correct content types for `.jpg`, `.png`, `.pbf`
- [x] **New:** marks and routes (🚩 Marks panel), saved as GeoJSON or GPX and loaded back from the phone
- [x] **New:** offline search (🔍 Search) for streets with house numbers, towns, metro, stations and points of interest, plus a "Points of interest" layer from zoom 12
- [x] **New:** upload into `/serve` over Wi-Fi from the Files page, with the free space shown
- [x] **New:** Chiwire Maps name and capybara icon (browser tab, phone home screen, map panel, boot screen)
- [ ] Upload, search, marks and the boot screen tested on the device (see `TODO.md`)

### 1.3 Tile downloader
- [x] New downloader script that supports the IGN sources (MTN, PNOA, IGN Base, vector), named areas, resume, a polite request rate and size estimates
- [x] Final area definitions: peninsular Spain at zoom ≤14, plus mountain areas and the Community of Madrid at zoom 15–16
- [x] Full download completed, with real sizes and durations recorded (§1.6)
- [x] Copy-to-SD procedure tested, including how long it takes for millions of small files (§1.6)

### 1.4 Tests
- [x] Automated test suites exist and pass: web app (50), browser end-to-end (19), downloader (62), search builder (14), firmware helpers on the PC (8), firmware build. Development follows TDD (see `CLAUDE.md`).
- [x] Maths checked against official reference data: NOAA/USNO sun times (within 0.52 min), GeographicLib grid convergence (1e-9°), the WMM2025 test values.
- [ ] Code written before TDD was adopted (parts of `nav.js`, the routes, the LED) is covered by the end-to-end tests where it matters; full coverage is not a goal.

### 1.5 Verification before publishing
- [x] Every number in the guides is measured, or marked "not measured yet"
- [x] Every external link was opened and checked when the guides were written
- [ ] Every screenshot is taken from the real device running the final firmware (see `TODO.md`)

### 1.6 Measured facts from the download and card copy

These are the measured values the guides use.

**What was downloaded** (plan `tileDownloader/plan_spain.json`)

| Layer | Tiles on disk | Avg tile | On 4 KB blocks | Contour lines? |
|---|---|---|---|---|
| MTN (topographic) | 1,155,601 | 14.5 KB | 18.2 GB | Yes, brown lines with index lines; most detailed at zoom 15–16 |
| PNOA (aerial photo) | 1,155,601 | 14.1 KB | 17.8 GB | No |
| IGN Base (street map) | 1,155,601 | 6.4 KB | ~9.2 GB | No, only faint relief shading |
| Vector (z ≤ 14) | 196,309 (+1,425 sea tiles that don't exist) | ~39 KB | ~7.7 GB | Yes, `altimetria_lin` at zoom 12–14 with height labels; spot heights only from zoom 17, so not visible with this download |
| **Total** | 3,663,112 | | **54 GB on disk** (49.9 GB of data) | |

The plan's estimate was 53.9 GB, so the estimate method (average tile size rounded up to whole 4 KB blocks) is accurate. About 5 GB of the 64 GB card stays free.

**Download speed and IGN behaviour**
- IGN publishes no rate limit. Measured with the adaptive mode (`--adaptive`, one CSV row per 2-minute window in `download_metrics.csv`): every speed from 5 to 25 tiles/s ran clean, and real throttling was never seen. The speed was then fixed at **24 tiles/s** (`--adaptive --rate 24 --max-rate 24`); the full plan takes about **42 h** at that speed, instead of about 204 h at the default 5 tiles/s.
- IGN's raster servers sometimes answer **502 Bad Gateway** for one tile, at any speed (seen at 10, 15, 24 and 25 tiles/s). It looks like tiles that are created on request and time out at IGN's gateway; minutes or hours later the same tile works. About 1–12 tiles per hour, 0.01% of all tiles.
- IGN's vector server (Amazon S3) answers **403 AccessDenied** for tiles that don't exist (open sea), where the others answer 404. The downloader treats 403 and 404 as "no map there" for the vector layer only.
- IGN's response time varies on its own (typically 0.10 s, with periods up to 0.25 s at 8.7 tiles/s as well as at 24). Slowness alone is not a reason to slow down; only errors are.
- How the downloader decides: over 1% failed requests in a window means throttling, so it halves the speed, then climbs back to 90% of it. Errors from our own connection (Wi-Fi drop, waking from sleep: DNS failure, no route) pause the download without using up the tile's attempts or changing the speed. Most requests failing at the lowest speed means a possible block, so it stops with exit code 3.
- No proxies or other tricks are used to get around IGN's limits.

**Broken tiles and retry**
- Every tile that fails 4 times is appended right away to `<out>/failed.txt` (kept across restarts). `python3 spain_tiles.py retry --out ../sdCard/tiles --yes --rate 10` fetches only those and keeps the ones still broken. In this download: 667 entries, all recovered or confirmed as sea; 0 tiles missing in the end.
- Running the normal `download` command again only fetches tiles not on disk, so it is also the final completeness check.

**Running a long download on a laptop**
- If the laptop sleeps, the download freezes. Run it under `systemd-inhibit --what=sleep:idle:handle-lid-switch --who="ChiwireMaps tiles" --why="Downloading Spain map tiles" python3 spain_tiles.py download ...`. Closing the lid then doesn't suspend the laptop, so keep it open, ventilated and plugged in.
- Only one download can run per folder (`.download.lock`); Ctrl+C stops it within seconds; it resumes where it left off.

**Copying to the SD card** (USB 3 card reader, card labelled `BEACON`)
- The desktop auto-mounts FAT32 cards with the **`flush`** option, which waits for the card after every file: measured **8 files/s** (about 5 days for this card). Mount it by hand without `flush` instead: `sudo mkdir -p /mnt/beacon && sudo mount -t vfat -o uid=1000,gid=1000,utf8,shortname=mixed,noatime /dev/sdX1 /mnt/beacon` (find `sdX1` with `lsblk`). Measured: the full copy (3,648,299 files, 49.7 GB) took **2 h 05 min**, 6.35 MB/s on average, about 350 files/s.
- Verifying the card: run the same rsync command with `-n` (dry run) and `--out-format='%n'`. It lists every file whose size or date differs, so an empty list means the card is complete. On this card it took **50 min**, almost all of it kernel time: FAT32 has no index, so each file lookup scans its whole folder.
- Copy command: `rsync -rt --modify-window=1 --info=progress2 --exclude='.download.lock' --exclude='download_metrics*.csv' --exclude='failed.txt' sdCard/ /mnt/beacon/`. `-rt` because FAT32 can't store Linux permissions; `--modify-window=1` because FAT32 stores times in 2-second steps (without it a rerun re-copies everything). Rerunning the same command resumes.
- rsync's own percentage is meaningless for millions of files. `python3 tools/card_copy_progress.py` shows the real progress.
- Without `flush`, Linux holds up to a few GB in memory ahead of the card. Always unmount before removing the card (`sudo umount /mnt/beacon`); the unmount waits until everything is written.
- If the card was pulled out while mounted, run `sudo umount -l /mnt/beacon` before mounting it again.

### 1.7 Measured facts for the search data

- Source: the Geofabrik extract of Spain (`spain-latest.osm.pbf`, about 1.5 GB, © OpenStreetMap contributors, ODbL 1.0).
- Build: `tools/.venv/bin/python tools/build_search.py tools/data/spain-latest.osm.pbf sdCard/search` takes **5 min 17 s** and peaks at **7.4 GB of RAM**.
- Output: **166 MB in 19,492 files**, with **2.02 million house numbers**. `manifest.json.gz` is 37 KB. Only peninsular Spain is kept, matching the maps.
- The data fits easily in the ~5.6 GB left free on the 64 GB card, so a 128 GB card is not needed. A 128 GB card would only be needed to add more zoom-16 areas or the islands.

### 1.8 North accuracy statement

For the guides, the accuracy of the three norths shown on the map:

- **True north** is the top of the map (Web Mercator).
- **Grid north** (UTM convergence) is computed exactly (Karney's method) and matches GeographicLib to 1e-9°. Across the peninsula it stays within about ±2.1° (largest at the edges of each UTM zone).
- **Magnetic north** comes from the World Magnetic Model 2025 (WMM2025). The map shows it with **±0.4°**, the model's own uncertainty at Spain's latitudes. Local iron, rock or power lines can deflect a compass more than that. In late 2026 the declination ranges from about −0.9° (Galicia) to +2.1° (Barcelona), and it grows by about 0.15° a year. WMM2025 is valid until the end of 2029; the map marks it "EXPIRED" after that.
- **Sun times** use the full NOAA algorithm and match the USNO tables within 0.52 minutes.

---

## 2. Documents

The seven guides are in [`docs/guides/`](guides/), each in four formats made from one Markdown source:

| Format | Extension | How |
|---|---|---|
| Markdown | `.md` | Source of truth |
| LibreOffice | `.odt` | `tools/make_guides.sh` (LibreOffice 26.2 opens Markdown directly) |
| Word | `.docx` | same script |
| PDF | `.pdf` | same script; copy the PDFs to `/serve/guides/` on the card |

Tools on the build machine: LibreOffice (`soffice`) 26.2 or newer. Pandoc is not needed.

| Guide | Contents |
|---|---|
| `01-device-setup` | Flashing, SD card format, tiles, search data, copying to the card, Wi-Fi name |
| `02-using-the-device` | LEDs, screen, connecting, the map, search, marks, files and upload, power |
| `03-navigation-guide` | Coordinates in Spain, the grid, the three norths, contours, terrain, planning |
| `04-safety-and-emergencies` | 112, giving your position, rescue, signals, weather, avalanches |
| `05-maintenance` | Project structure, libraries, WMM, refreshing tiles and search, debugging |
| `06-sources-and-licenses` | Data sources, libraries, the original project, licenses |
| `07-replicate-from-scratch` | Parts, the GPS cable, tools, configuration, tests, troubleshooting, vector maps in an external app |

---

## 3. Device limits the guides must state clearly

| Limit | Value / behavior | Effect on the user |
|---|---|---|
| Free RAM while running | ~160–170 KB | Pages must stay small; heavy features (search, maths) run on the phone, not the dongle |
| Low-memory guard | Answers 503 below 40 KB free | The phone retries; too many phones at once slow everything down |
| Wi-Fi throughput | Slow: hundreds of KB/s, shared between connected devices | Map tiles load progressively; the vector layer is noticeably slower |
| Max Wi-Fi clients | 4 (ESP32 default for an access point) | At most 4 phones at once |
| No HTTPS | The page is `http://` only | Phones block some sensors on non-HTTPS pages (compass/orientation may be unavailable). The north arrows come from the models, not from the phone's compass |
| FAT32 | 4 GB maximum per file, cluster-size overhead | Upload files under 4 GB; format with 4 KB clusters |
| SD card | 64 GB (about 59.6 GB usable) | Fixed budget for the layers and zoom levels |
| Uploads | One at a time; 1 MB always kept free | A second upload waits with "Another upload is running" |
| Magnetic model | WMM2025, valid 2025–2029 | Declination drifts and must be updated in 2030 |
| GPS accuracy | Typically 3–10 m with a good sky view; worse in gorges/forest | Grid squares at zoom 16 can be smaller than the GPS error |
| Phone routing | Android may send traffic over mobile data | Use airplane mode + Wi-Fi |

---

## 4. Upload to `/serve`: how it works

For the usage and maintenance guides:

- The Files page (`/files`) shows the free space, measured once when the dongle starts (`GET /storage` returns `{total, used, free, maxUpload}` in bytes) and kept up to date after each upload.
- "⬆️ Upload to this folder" sends the chosen file into the folder being shown. The phone refuses a file larger than the free space minus 1 MB before sending anything; the dongle checks again.
- The dongle writes to `<name>.part` and renames it when the upload is complete. If the connection drops, the `.part` file is removed.
- Answers: 400 (bad folder or file name), 409 (a file with that name already exists), 503 (another upload is running), 507 (not enough space).

---

## 5. Mesh networking evaluation

The question: can several Chiwire Maps users see each other or send messages when there is no phone coverage? Evaluated, nothing built.

**Hardware limits.** The T-Dongle S3 has no LoRa radio. Its only expansion port (Qwiic, GPIO 43/44) is used by the GPS. Adding a LoRa radio to the dongle itself would need soldering to the board and a new case.

**Recommended path: a separate Meshtastic node.** A ready-made Meshtastic device (for example a Heltec WiFi LoRa 32 V3, a LilyGo T-Beam or a RAK WisBlock) joins the dongle's Wi-Fi network as a client. The dongle talks to it over the Meshtastic TCP API (port 4403, protobuf messages, decoded with nanopb in a few tens of KB of RAM). The map could then show the positions of the other mesh users and send short text messages. No soldering, and Meshtastic's range (several km in the mountains, line of sight) is far beyond Wi-Fi's.

**Alternatives.**
- **ESP-NOW** between several Chiwire Maps dongles: no extra hardware, but a range of only hundreds of metres.
- **The phone's own Meshtastic app over Bluetooth:** works today with no changes, next to the map. The map page can't talk to it, because Web Bluetooth needs HTTPS and the dongle serves plain HTTP.

**Next steps** are listed in `TODO.md`.

---

## 6. Publishing decisions

- Published as a fork of the original project, [diyaquanauts/BackcountryBeacon](https://github.com/diyaquanauts/BackcountryBeacon), which has no license file. The README credits it.
- The new code (the Spain downloader, search, marks, north, upload, tests and guides) is under the MIT License. The original project's code stays under its authors' rights.
- Map tiles and search data are never committed (too large, and the scripts download and build them). IGN's CC BY 4.0 credit and OpenStreetMap's ODbL credit are shown on the map and in the guides.
- The Wi-Fi name and password in `firmware/src/main.cpp` stay as they are; change them before building your own (see the setup guide).
