# Chiwire Maps 2: Using the Device

For anyone carrying it. This guide explains the dongle's lights and screen, how to connect a phone, and everything on the map page.

## Contents

1. [Turning it on](#turning-it-on)
2. [Connecting a phone](#connecting-a-phone)
3. [The map page at a glance](#the-map-page-at-a-glance)
4. [Map layers: which one to use when](#map-layers-which-one-to-use-when)
5. [Position, grid and north](#position-grid-and-north)
6. [Go to a coordinate](#go-to-a-coordinate)
7. [Search and points of interest](#search-and-points-of-interest)
8. [Marks and routes](#marks-and-routes)
9. [Files: download and upload](#files-download-and-upload)
10. [Power, cold and water](#power-cold-and-water)

## Turning it on

Plug the dongle into a USB charger or power bank, with the SD card already inserted. There is no power switch.

**The LED:**

| Colour | Meaning |
|---|---|
| Yellow | Starting up |
| Red | Error: the SD card was not found or couldn't be read |
| Blue | At least one phone is connected to its Wi-Fi |
| Green | No phone connected, and the GPS has a position |
| Off | No phone connected, and no GPS position yet |

Blue wins over green: while a phone is connected, the LED stays blue even with a GPS position. The map page shows the GPS state.

**The screen and the button:**

- At power-on the screen shows the Chiwire Maps capybara for a moment.
- Then it shows **"YOU ARE OFF GRID."** with a QR code for the Wi-Fi network. "OFF" turns green when the GPS has a position.
- Press the button once to switch to **"YOU ARE HERE."** with a QR code for the map address (`http://192.168.4.1/`). Press it again to switch back.
- The screen turns off after 30 seconds without a button press, to save power. The next press only turns it back on.

## Connecting a phone

1. **Turn on airplane mode, then turn Wi-Fi back on.** Android in particular sends traffic over mobile data when a Wi-Fi network has no internet, and then the map doesn't load.
2. **Join the network.** Scan the Wi-Fi QR code on the screen with the camera, or join the network by hand (the name and password are set in the firmware; see [guide 1](01-device-setup.md#changing-the-wi-fi-name-and-password)).
3. **Open the map.** Press the button to show the second QR code and scan it, or type `http://192.168.4.1` in the browser. Some phones open the page on their own after joining.
4. **Optional: add it to the home screen.** In the browser menu, choose "Add to Home screen". The capybara icon then opens the map directly.

At most 4 phones can be connected at once. Each extra phone shares the same slow Wi-Fi, so tiles load more slowly. How far the Wi-Fi reaches outdoors is not measured yet.

## The map page at a glance

The map fills the top of the screen. Below it, a dark panel shows the numbers:

| Row | Example | Meaning |
|---|---|---|
| Source | `📍 GPS · 9 🛰️ · ±8 m` | Where the numbers come from: the GPS (satellites, rough accuracy), or `✛ Map center` when you moved the map |
| UTM | `UTM 30T 440290 4474257` | Position in UTM (zone, band, easting, northing), large for reading out loud |
| Lat/lon | `40.41680, -3.70380 · 40°25'00.5"N 3°42'13.7"W` | Decimal degrees and degrees-minutes-seconds |
| Motion | `🏔️ 655 m · 🚶 4.2 km/h → 87° · ▦ 1 km squares, zone 30` | Altitude, speed and course (when moving), grid square size |
| Sun | `🌅 18 Oct: 08:28 – 19:30 · 3 h 12 min of light left` | Today's sunrise and sunset at that position, and daylight left |
| Target | `🎯 2.31 km · 57° true · 56° mag · 57° grid` | Distance and bearing to the target, when one is set |

Buttons under the panel: **🎯 Go to**, **🔍 Search**, **📍 Me**, **🎯 Target** (only when a target is set), **🚩 Marks** and **🗂️ Files**. On the map: **+ / −** zoom, **🗺️** layers, the scale bar at the bottom left, and the north box at the top right.

**When you move the map,** it stops following the GPS. A red **✛** appears in the centre, and all the numbers refer to that point instead of your position. Press **📍 Me** to follow the GPS again.

If the panel's top edge turns orange, the page lost contact with the dongle (out of Wi-Fi range, or the dongle is busy). It keeps trying.

## Map layers: which one to use when

Tap **🗺️** to choose a layer. The page remembers your choice.

| Layer | Use it for | Notes |
|---|---|---|
| **Topographic (MTN)** | Hiking: contour lines, paths, huts, springs | The most detail at zoom 15–16 in the mountain areas and Madrid |
| **Aerial (PNOA)** | Comparing with what you see: forest edges, clearings, rock, buildings | No contour lines |
| **Streets (IGN Base)** | Towns, roads and streets | Only faint relief shading, no contours |
| **Vector (IGN)** | Contour lines with height labels at zoom 12–14 | Slowest to load; needs WebGL. If the phone can't draw it, the page says so and returns to the topographic map |

Detail by area:

- **Mountain ranges and the Community of Madrid:** zoom 16 in the three photo-like layers.
- **The rest of the peninsula:** zoom 14.
- **Beyond the stored zoom** (up to 18), the page enlarges the deepest tile it has, so the map gets blurrier but doesn't disappear.
- **Grey hatched squares** mean there is no map for that place (for example the sea, or outside Spain).

The map can't be dragged far outside the peninsula, because there are no maps there.

## Position, grid and north

**The UTM grid** (on by default; switch it in **🗺️** under "UTM grid") draws magenta lines every 100 m to 100 km, depending on the zoom. Thicker lines mark every 10th line. The numbers on the edges are kilometres of easting (bottom) and northing (left). Dashed black lines are UTM zone boundaries. [Guide 3](03-navigation-guide.md) explains how to navigate square by square.

**The north box** (top right) shows three norths:

- **★ True north** is the top of the map.
- **GN (grid north)**, in magenta, is where the UTM grid lines point. Its angle is exact.
- **MN (magnetic north)**, red and dashed, is where a compass needle points, from the World Magnetic Model 2025. It is shown with **±0.4°**, the model's own uncertainty; iron, rock or power lines nearby can deflect a compass more.

The arrows are drawn at their real angles, and the exact values are written under them. The small text says which model is in use and whether the values are for the GPS position or the map centre. After 2029 the model text shows "EXPIRED" (see [guide 5](05-maintenance.md)).

**Zone lock.** Near a zone boundary (for example 0° longitude, east of Valencia and through Aragón), the zone changes as you cross it. To keep one zone, for example to match a paper map, choose "Zone 29", "Zone 30" or "Zone 31" in the north box. "Zone auto" follows the longitude.

**Accuracy.** The GPS shows a rough accuracy (`±8 m`). With a good view of the sky it is typically 3–10 m; in gorges and forest it gets worse. At zoom 16, a grid square can be smaller than the GPS error.

## Go to a coordinate

1. Tap **🎯 Go to**.
2. Type a coordinate in any of these forms:
   - UTM: `30T 440300 4474260` (zone, optional band letter, easting, northing)
   - decimal degrees: `40.4168, -3.7038`
   - degrees-minutes-seconds: `40°25'00"N 3°42'13"W` (O for "oeste" also means west)
3. Tap **Go**. A 🎯 target appears, the map moves to it, and a dashed red line joins it to your position.

The **Target** row shows the distance and the bearing in three forms: true, magnetic (for a compass) and grid (for a protractor on a UTM map). It also gives the target's UTM and the grid square it is in.

**Use here** fills in the current position (GPS, or the map centre) in UTM, for example to pass it to someone. **Clear target** removes the target. The **🎯 Target** button brings the map back to the target. The target is remembered when you reload the page.

## Search and points of interest

Tap **🔍 Search**, type, and press Enter. Everything is searched on the phone, from data on the card; nothing goes to the internet.

What you can find:

- **Streets with house numbers:** `Gran Vía 28 Madrid`, `Balmes 100 Barcelona`. Adding the town helps when a street name is common. The house number is the last number after a name word. Buildings listed as a range ("98-100") or a list ("5, 7") match too.
- **Towns and places:** `Cercedilla`.
- **Metro stations and entrances, stations, police, military areas, bunkers, hospitals, emergency services, peaks, water points and shelters.**

Tips: accents and capitals don't matter. Words like "calle", "avenida", "plaza", "de" and "la" are ignored. If nothing is found, try fewer or shorter words. Results nearer to you come first.

Tap a result to see it on the map: the whole street is highlighted, and a 🚪 marks the door when you searched for a number. Then:

- **🎯 Go** makes it the target.
- **＋ Mark** adds it to your marks.

**The "Points of interest" layer** (in **🗺️**) draws these places as icons from zoom 12. Tap an icon to see its name.

The search covers mainland Spain only. The data is from OpenStreetMap, so its quality depends on what volunteers have mapped: very good in cities, thinner in remote areas.

## Marks and routes

Tap **🚩 Marks** to open the panel.

- **＋ Mark** places a mark at your GPS position, or at the ✛ map centre after you moved the map.
- **＋ Route** starts a new route. **＋ Point** adds a point to the active route (outlined in green); tap a route's row to make it active.
- Each row has: the icon (tap it to cycle through ⛺ 💧 🏠 ⚠️ and others), the name (tap to edit), **🎯** to make it the target, **⬆ ⬇** to reorder route points, and **✕** to remove it.
- A route's row shows its total length.

**Saving.** Marks are kept in the phone's browser and survive a reload, but clearing the browser's data deletes them. Save a copy:

- **💾 Save** downloads a GeoJSON file (`marks-<date>.json`), which can be loaded back.
- **GPX** downloads a GPX file for other apps (OruxMaps, Wikiloc, Garmin…).
- **📂 Load** reads a GeoJSON file saved earlier. It replaces the current marks after asking.
- **🗑️ All** removes everything after asking.

To share marks with another phone, save the file, upload it to the dongle on the Files page, and download it on the other phone.

## Files: download and upload

Tap **🗂️ Files** to see the card's `/serve` folder: guides, PDFs, routes, anything the owner put there.

- Tap a folder to open it, and **⬆️ Up** to go back. The search box filters the list.
- Tap a file to download it. Only the first 250 items of a folder are shown.
- The top line shows the free space on the card, for example "5.2 GB free of 59.6 GB (8.7%)".

**Uploading a file into the folder you are in:**

1. Tap **Choose file** and pick the file on the phone.
2. Tap **⬆️ Upload to this folder**. A bar shows the progress, and the list reloads when it's done.

The answers you can get:

| Message | Meaning |
|---|---|
| "Too big: … only … free" | The file doesn't fit. Nothing was sent. 1 MB is always kept free |
| "… already exists in this folder" | Rename the file, or delete the old one on a computer first |
| "Another upload is running" | Only one upload at a time. Wait and try again |
| "Upload failed (connection lost)" | Nothing was saved; the partial file was removed |

FAT32 doesn't allow files larger than 4 GB. Uploads are slow (the Wi-Fi is shared), so keep them small.

## Power, cold and water

- **Power:** the dongle runs from any USB power bank. Its power draw and how long a typical power bank lasts are not measured yet; carry a spare power bank on long trips.
- **Phone battery:** the phone's screen and Wi-Fi use more power than the dongle. Turn the screen off when you don't need the map. Keep airplane mode on.
- **Cold:** power banks and phones lose capacity in the cold. Keep them in an inner pocket, close to your body.
- **Water:** the dongle and the GPS are not waterproof. Carry them in a sealed bag.
- **Restarting:** unplugging and plugging in again restarts the dongle. Your marks stay on the phone. Uploads in progress are lost.
