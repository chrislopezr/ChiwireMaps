# Chiwire Maps Firmware Overview

The Chiwire Maps firmware transforms the LilyGo S3 USB dongle into a portable, offline mapping and file server. Developed using PlatformIO, this firmware integrates essential hardware components and software functionalities to support outdoor adventurers.

### Hardware Overview

The firmware is designed for the LilyGo S3 USB dongle, which includes:

-   **ESP32 Microcontroller** for handling Wi-Fi connectivity and processing tasks.
-   **TFT Display** for displaying basic status information.
-   **GPS Module** to track and provide real-time location data.
-   **SD Card Storage** for storing and serving offline maps and files.

### Webpage Loading

-   **Page shells in the firmware:** `include/index.h` (the map page) and `include/files.h` (the Files page) are compiled into the firmware. Changing them needs a new build and flash.
-   **The map app on the SD card:** the code that does the work (`nav.js`, `geo.js`, `marks.js`, `search.js`, `wmm.js`) is served from the SD card and runs in the phone's browser. Updating it only needs a file copy to the card. The dongle itself only serves files, so it stays within its small memory.

### Routes

-   `/` and `/files`: the map and Files pages. `/download?file=` sends a file from `/serve`.
-   `/upload?dir=` (POST): uploads one file at a time into `/serve/<dir>`. It streams to `<name>.part` and renames it when complete; answers 400 (bad folder or name), 409 (file exists), 503 (another upload running) and 507 (not enough space, 1 MB always kept free).
-   `/storage`: the card's `{total, used, free, maxUpload}` in bytes, measured once at start-up.
-   `/location`: the GPS state as JSON. `/diagnostics`: free memory and uptime.
-   `/tiles/...`, `/search/`, `/vector/`, `/lib/` and the app files: served from the SD card with cache headers.

### Tests

-   `include/pathutil.h` holds the pure helpers (safe paths and file names, sizes, URL and HTML escaping). They are tested on the PC with Unity: `~/.platformio/penv/bin/pio test -e native` (needs g++).
-   `~/.platformio/penv/bin/pio run` builds the dongle firmware.

### Middleware System

The firmware uses a middleware system built on the async web server, providing an "express-like" experience for handling HTTP requests:

-   **Async Web Server Foundation:** The middleware is layered on top of the `ESPAsyncWebServer`, allowing non-blocking, asynchronous handling of requests.
-   **"Express-like" Design:** The middleware system is designed to be modular and easy to extend, similar to Express.js in the Node.js ecosystem. This structure makes it straightforward to add, remove, or modify how requests are processed before reaching their final handlers.

### FunctionTimer Utility

The `FunctionTimer` is a simple task manager that schedules and executes periodic tasks without blocking the main loop
