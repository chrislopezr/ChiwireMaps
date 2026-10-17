# To do

Open work on Chiwire Maps, in the order it should happen. The device tests come first, because the guides and the measurements depend on them. Tick an item only after it has been checked on the real dongle.

## 1. Tests on the device

Before testing, copy the current app to the card. With the card mounted at `/mnt/beacon` (see [the setup guide](docs/guides/01-device-setup.md#copying-to-the-sd-card)):

```
cp sdCard/{*.js,favicon.ico,icon-192.png} /mnt/beacon/ && sync
```

Always copy all of these files, not only the changed ones: a stale `nav.js` on the card hides newer features.

- [ ] **Boot screen:** the capybara and "Chiwire Maps" appear for a moment at power-on, with natural colours (brown body on black). If the colours look wrong, try `tft.setSwapBytes(false)` in `firmware/src/main.cpp`, or swap red and blue in `tools/make_icon.py`.
- [ ] **Map panel logo:** the capybara shows in the bottom panel of the map page, not a broken image.
- [ ] **GPS position:** outdoors, the green LED lights up, and `http://192.168.4.1/location` returns `"fix": true` with real coordinates, altitude and satellites.
- [ ] **Map layers on the full card:** all four layers draw. Zoom 15–16 works in the mountain areas and the Community of Madrid, and zoom 14 works everywhere else.
- [ ] **Upload, free space:** the Files page shows a line like "5.2 GB free of 59.6 GB (8.7%)".
- [ ] **Upload, small file:** a small file uploads into the current folder and appears in the list.
- [ ] **Upload, too big:** a file larger than the free space is refused before anything is sent.
- [ ] **Upload, unplugged:** unplugging the dongle during an upload leaves no `.part` file on the card.
- [ ] **Upload, timing:** with the dongle on USB, `~/.platformio/penv/bin/pio device monitor` shows "SD card: … measured in N ms" at start-up. Record N for the 64 GB card.
- [ ] **Search:** "Gran Vía 28 Madrid" and "Balmes 100 Barcelona" find the right doors. The "Points of interest" layer shows icons from zoom 12. "＋ Mark" from a result adds it to the Marks panel.
- [ ] **Marks and routes:** add a mark, a route with three points, save as GeoJSON and GPX, clear, then load the GeoJSON file again.
- [ ] **Screenshots for the guides:** the map with each layer, the grid, the north box, the Files page, the dongle screen and each LED colour. Take them from the real device running the final firmware.

## 2. Code

Each item is built test-first (see `CLAUDE.md`).

- [ ] **Marks on the card:** save marks and routes to `/serve/marks/` on the card through `/upload`, and load them back from the `/files` listing. Today they are saved to and loaded from the phone only.
- [ ] **Search, sidewalks:** in cities, OpenStreetMap often maps sidewalks as separate ways with the street's name. They show up as a separate "Path" result that carries the house numbers. Merge them into the street result.
- [ ] **Search, duplicate points of interest:** a few points of interest appear twice, a few metres apart (for example a node and a building with the same name). Merge them when they share a name and kind within a few metres.

## 3. Hardware measurements

Each value goes into the guides, replacing the "not measured yet" notes.

- [ ] **Power draw:** with a USB power meter, measure the dongle alone, with the GPS, and with 1, 2, 3 and 4 phones connected and loading the map.
- [ ] **Battery life:** run the dongle with the GPS from a typical power bank (note its capacity in mAh and Wh) until it stops, with one phone connected now and then.
- [ ] **Wi-Fi range:** walk away outdoors with a phone loading the map until the map stops loading. Record the distance, and whether there was a clear line of sight.

## 4. Mesh networking (Meshtastic)

Evaluated, not built. The details are in [docs/NEEDS_FINAL_GUIDE.md](docs/NEEDS_FINAL_GUIDE.md#5-mesh-networking-evaluation).

- [ ] Choose a Meshtastic node (Heltec V3, LilyGo T-Beam or RAK WisBlock) and test it on its own with the Meshtastic phone app.
- [ ] Let the node join the dongle's Wi-Fi as a client, and read its messages and positions over the Meshtastic TCP API (port 4403, protobuf).
- [ ] If that works, show the positions of other mesh users on the map, and send short text messages from the map page.

## 5. Publishing

- [ ] Tag a release with the firmware binary (`firmware/.pio/build/ESP32-S3-DevKitC-1/firmware.bin`) and the SD card template (without tiles or search data).
- [ ] Add GitHub Actions that run the web, downloader, search builder and native test suites on every push.
