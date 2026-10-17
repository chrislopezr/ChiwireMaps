# SD card contents

This folder is the template for the dongle's microSD card. Copy all of it to a card formatted **FAT32 with 4 KB clusters** (exFAT is not supported). The steps are in [the setup guide](../docs/guides/01-device-setup.md).

```
/                      the map app and its assets
├── nav.js             map, layers, grid, panel, go-to, marks and search panels
├── geo.js             UTM, grid convergence, magnetic declination, sun times, coordinate parsing
├── marks.js           marks and routes (GeoJSON and GPX)
├── search.js          offline search
├── wmm.js             World Magnetic Model 2025 coefficients
├── leaflet.js, leaflet.css, error.png
├── favicon.ico, icon-192.png
├── lib/               MapLibre GL JS, for the vector layer
├── vector/            vector map style, fonts and icons (spain_tiles.py vector)
├── tiles/             map tiles, not in the repository (spain_tiles.py download)
│   ├── mtn/z/x/y.jpg      topographic
│   ├── pnoa/z/x/y.jpg     aerial photos
│   ├── base/z/x/y.jpg     streets
│   └── vector/z/x/y.pbf   vector, zoom ≤ 14
├── search/            search data, not in the repository (tools/build_search.py)
└── serve/             your own files, shown on the Files page
    └── guides/        the guide PDFs (copy them from docs/guides/)
```

- **Map tiles:** `tileDownloader/spain_tiles.py` downloads them (see `tileDownloader/README.md`). About 54 GB.
- **Search data:** `tools/build_search.py` builds it from OpenStreetMap. About 166 MB.
- **`/serve`:** anything you want on the trail: PDFs, routes, documents. Phones can also upload files into it over Wi-Fi from the Files page. Only the first 250 items of a folder are listed, so use subfolders.

After changing the app, copy all its files to the card, not only the changed ones:

```
cp sdCard/{*.js,favicon.ico,icon-192.png} /mnt/beacon/ && sync
```
