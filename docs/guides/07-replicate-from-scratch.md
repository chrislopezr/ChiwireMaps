# Chiwire Maps 7: Building Your Own

For someone building a Chiwire Maps device from nothing: the parts, the GPS cable, the tools, the settings you may want to change, and every problem met while building the first one.

## Contents

1. [Parts list](#parts-list)
2. [The GPS cable](#the-gps-cable)
3. [Tools](#tools)
4. [Settings you may want to change](#settings-you-may-want-to-change)
5. [Build order](#build-order)
6. [Running the tests](#running-the-tests)
7. [Troubleshooting](#troubleshooting)
8. [Vector maps in an external app](#vector-maps-in-an-external-app)

## Parts list

| Part | Used in this build | Notes |
|---|---|---|
| Dongle | [LilyGo T-Dongle S3](https://www.lilygo.cc/products/t-dongle-s3), with the screen | ESP32-S3, 0.96" ST7735 screen (80 × 160), microSD slot, one button, one RGB LED, a Qwiic-style 4-pin port |
| GPS | BZ-181 (u-blox M10 chip) | 115200 baud, up to 10 positions per second. Other u-blox modules that send NMEA at 115200 baud should work but were not tested |
| Cable | A 4-pin JST-SH (Qwiic) cable, plus a small protoboard or perfboard | The wires must be rearranged; see below |
| microSD card | 64 GB, A1 or better, U3 | Formatted FAT32 with 4 KB clusters |
| Case (optional) | `parts3D/GpsHolder-Top.stl` and `GpsHolder-Bottom.stl` | Holds the GPS on the dongle; from the original project |
| Power | A USB power bank, USB-A or USB-C | Battery life is not measured yet |
| Card reader | Any USB 3 microSD reader | For the 54 GB copy |

## The GPS cable

The dongle's port and the GPS module both use 4-pin connectors, but **the pin order is different**, so a straight Qwiic cable can't be used. A wire on the wrong pin can put power on a data line: in the first build, a straight cable made the screen go off as soon as the GPS was plugged in.

**Pin order, as used in the working build:**

| Dongle pin | Dongle signal | Wire | GPS pin | GPS signal |
|---|---|---|---|---|
| 1 | RX (GPIO 44) | yellow | 3 | TX |
| 2 | TX (GPIO 43) | blue | 2 | RX |
| 3 | 3.3 V | red | 4 | VCC (marked 5 V) |
| 4 | GND | black | 1 | GND |

The data lines **cross**: the dongle's RX goes to the GPS's TX, and the dongle's TX to the GPS's RX. The firmware reads the GPS on GPIO 44 (RX) and 43 (TX) at 115200 baud.

**Making it:**

1. Cut two Qwiic cables in half, or use one cable and loose wires.
2. Solder the dongle-side wires and the GPS-side wires to a small protoboard, following the table. A protoboard makes each joint easy to check, and was what made the first build work.
3. Cover the joints (heat-shrink tube or tape).

**Test it with a multimeter before plugging it in:**

1. In continuity mode, check each line end to end: dongle pin 1 to GPS pin 3, pin 2 to pin 2, pin 3 to pin 4, pin 4 to pin 1.
2. Check that no two lines touch: especially 3.3 V and GND, and 3.3 V and either data line.
3. Plug in the GPS, then the dongle. The screen must stay on. Outdoors, the LED turns green when the GPS has a position (with no phone connected).

## Tools

Tested on Linux (Ubuntu). The same tools exist for Windows and macOS, but the commands in these guides were not tested there.

| Tool | Used for |
|---|---|
| VS Code with the PlatformIO IDE extension | Building and flashing the firmware |
| Python 3 (3.10 or newer) | The tile downloader (standard library only), the helper scripts |
| pyosmium 4.3.1, in `tools/.venv` | Building the search data |
| Pillow | Only to redraw the icon (`tools/make_icon.py`) |
| Node.js (20 or newer) | The web and end-to-end tests |
| Chrome or Chromium | The end-to-end tests (headless) |
| g++ | The firmware helper tests on the PC (`pio test -e native`) |
| git | Getting the project |
| LibreOffice 26.2 or newer | Converting the guides to `.odt`, `.docx` and `.pdf` (`tools/make_guides.sh`) |

## Settings you may want to change

| Setting | Where | Default |
|---|---|---|
| Wi-Fi name and password | `firmware/src/main.cpp`, `ssid` and `password` | `chiwire` / `aguacate`: change them for your own device |
| LED brightness | `firmware/include/StatusLed.h`, `brightness` (0–31) | 3, about 10% |
| Low-memory guard | `firmware/include/Middlewares.h`, `criticalHeapThreshold` | 40000 bytes |
| Screen pins and driver | `firmware/platformio.ini`, `build_flags` | The T-Dongle S3's ST7735, on the HSPI port (`USE_HSPI_PORT`) |
| Start position | `sdCard/nav.js`, `CONFIG.start` | Madrid, zoom 11 |
| Map limits | `sdCard/nav.js`, `CONFIG.bounds` | The peninsula with a margin |
| Areas and zoom levels to download | `tileDownloader/plan_spain.json` and `areas/areas.json` | The peninsula to zoom 14, mountains and Madrid to 16 |

Files in `sdCard/` take effect when copied to the card. Files in `firmware/` need a new build and flash.

## Build order

The details of each step are in [guide 1](01-device-setup.md).

1. **Install the tools** and give your user access to the USB port (`dialout`).
2. **Set the Wi-Fi name and password,** build and flash the firmware.
3. **Make and test the GPS cable** (above).
4. **Format the SD card:** FAT32, 4 KB clusters.
5. **Start the tile download:** about 42 hours at 24 tiles per second, with the laptop kept awake by `systemd-inhibit`, plugged in and open. Start it first; the other steps fit in while it runs.
6. **Build the search data:** about 5 minutes, 7.4 GB of RAM.
7. **Copy everything to the card,** mounted by hand without `flush`: about 2 hours.
8. **First start:** card in, power on, scan the QR code, open `http://192.168.4.1`, check every layer.

## Running the tests

From the repository root:

```
node --test "tests/web/*.test.js"                              # web app: 50 tests
(cd tests && node --test "e2e/*.test.js")                      # real page in headless Chrome: 19 tests
python3 -m unittest discover -s tests/downloader               # downloader: 62 tests
tools/.venv/bin/python -m unittest discover -s tests/search    # search builder: 14 tests
(cd firmware && ~/.platformio/penv/bin/pio test -e native)     # firmware helpers on the PC: 8 tests
(cd firmware && ~/.platformio/penv/bin/pio run)                # firmware build
```

All of them must pass before you flash or copy a change. The project is developed test-first; `CLAUDE.md` describes the method.

## Troubleshooting

Every problem met while building the first device:

| Symptom | Cause | Fix |
|---|---|---|
| The dongle restarts over and over at start-up | TFT_eSPI used the wrong SPI port on the ESP32-S3 | Keep `-D USE_HSPI_PORT` in `platformio.ini` |
| The build fails: library `ESP Async WebServer` not found | The original `me-no-dev` library was removed from the registry | Use `esp32async/ESPAsyncWebServer` and `esp32async/AsyncTCP` (already in `platformio.ini`) |
| Upload fails: permission denied on `/dev/ttyACM0` | Your user isn't in the `dialout` group | `sudo usermod -aG dialout $USER`, install the PlatformIO udev rules, log out and back in |
| Upload fails: no port found | The dongle isn't in flash mode | Unplug, hold BOOT, plug in, release; upload; replug without the button |
| Red LED, "Card Mount Failed" in the log | The card is exFAT, not inserted, or inserted after power-on | Format FAT32 with 4 KB clusters; insert the card before plugging in |
| The screen goes off when the GPS is plugged in | Wrong wiring: a power or ground wire on a data pin | Rebuild the cable following the pin table, with the data lines crossed; test with a multimeter |
| No GPS position, and the log shows 0 chars/s | The data lines are not crossed, or the GPS gets no power | Check dongle RX to GPS TX, dongle TX to GPS RX, and 3.3 V |
| GPS sentences fail their checksum | The serial buffer overflowed during screen redraws | Already fixed: the firmware uses a 2 KB GPS buffer and reads the GPS on every loop |
| The phone joins the Wi-Fi but the map doesn't load | Android sends traffic over mobile data | Airplane mode on, then Wi-Fi on |
| "Service Unavailable: Low Memory" | Free memory fell below 40 KB (too many requests at once) | Wait; the page retries. Fewer phones at once |
| The map panel stays blank ("Starting…") and Go to does nothing | An early version of `nav.js` used its state before declaring it; or the app files on the card are mixed versions | Already fixed in `nav.js`; copy all `sdCard/*.js` files to the card again |
| Marks or Search buttons are missing | A stale `nav.js` on the card | Copy all the app files, not only the new ones |
| Copying to the card runs at 8 files per second | The desktop mounted the card with `flush` | Mount it by hand without `flush` (about 350 files per second) |
| The tile download froze overnight | The laptop went to sleep | Run it under `systemd-inhibit`; it resumes when run again |
| The download slowed down after a Wi-Fi drop | Older versions counted our own network errors as IGN throttling | Already fixed: own network errors only pause the download |
| Vector tiles of the sea "fail" with 403 | IGN's vector server answers 403 for tiles that don't exist | Already handled: counted as missing, not failed |

## Vector maps in an external app

Chiwire Maps shows the vector layer inside its own web map. As an alternative for advanced users, offline maps can also be loaded into a dedicated phone app. **This was evaluated, not tested.**

- **Apps:** OruxMaps and Locus Map (Android), among others, open offline maps in the MBTiles format (raster tiles in one SQLite file) and in Mapsforge (their own vector format).
- **Packaging the IGN raster tiles:** the card's `tiles/mtn/z/x/y.jpg` folders can be packed into an MBTiles file with a tool such as [mbutil](https://github.com/mapbox/mbutil). The tile folders use the XYZ scheme, so tell the tool (`--scheme=xyz`), because MBTiles stores rows in the TMS order.
- **The 4 GB limit:** one MBTiles file of the whole peninsula would be larger than 4 GB, which FAT32 can't store. Make one file per region.
- **Getting the file to the phone:** upload it to the dongle on the Files page and download it on the phone, or copy it by USB cable.
- **Pros:** the app's own tools (track recording, compass, offline routing in some apps), and no need for the dongle once the map is on the phone.
- **Cons:** each phone stores its own copy (GBs), the app's licence and features vary, and the IGN vector tiles (Mapbox Vector Tiles) are not in Mapsforge format, so they can't be loaded as they are.
