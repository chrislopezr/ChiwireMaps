#ifndef ROUTES_H
#define ROUTES_H

#include <ESPAsyncWebServer.h>
#include <SD_MMC.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include "index.h"
#include "files.h"
#include "pathutil.h"

extern long lastGpsUpdate;

void notFound(AsyncWebServerRequest *request) {
    request->redirect("/");
    Serial.println("Request not found: " + request->url() + " - redirected to /");
}

const int maxListedEntries = 250; // Caps the page size (and RAM) for huge folders
const char* tileCacheControl = "max-age=2592000";   // 30 days: tiles only change when the SD card is reloaded
const char* staticCacheControl = "max-age=604800";  // 7 days for libraries and images

// Arduino String versions of the helpers in pathutil.h (tested on the PC: pio test -e native)
String humanSize(uint64_t bytes) { return pathutil::humanSize(bytes).c_str(); }
String urlEncode(const String& text) { return pathutil::urlEncode(text.c_str()).c_str(); }
String htmlEscape(const String& text) { return pathutil::htmlEscape(text.c_str()).c_str(); }
bool cleanServePath(String& path) {
    std::string p = path.c_str();
    bool ok = pathutil::cleanServePath(p);
    path = p.c_str();
    return ok;
}

// ------------------------------------------------------------ Free space and uploads (only into /serve)
const uint64_t uploadReserve = 1024 * 1024;  // Always left free on the card
uint64_t cardTotal = 0, cardFree = 0;

// FatFs counts the free clusters; measured once at start-up (the time is printed), then kept up to date
void refreshStorage() {
    unsigned long started = millis();
    cardTotal = SD_MMC.totalBytes();
    cardFree = cardTotal - SD_MMC.usedBytes();
    Serial.printf("SD card: %llu bytes free of %llu (measured in %lu ms)\n", cardFree, cardTotal, millis() - started);
}

// One upload at a time; its state lives here between the chunks
struct Upload {
    AsyncWebServerRequest* owner = nullptr;
    File file;
    String part, target;
    uint64_t written = 0;
    int status = 0;            // 0 = still receiving, otherwise the HTTP answer
    String message;
};
Upload upload;

void failUpload(int status, const String& message) {
    if (upload.file) upload.file.close();
    if (upload.part.length()) SD_MMC.remove(upload.part);
    upload.status = status;
    upload.message = message;
}

// Creates /serve/<dir> and its parents when missing
bool makeFolders(const String& dir) {
    String path = "/serve";
    int from = 0;
    while (from <= (int)dir.length() && dir.length()) {
        int slash = dir.indexOf('/', from);
        if (slash < 0) slash = dir.length();
        path += "/" + dir.substring(from, slash);
        if (!SD_MMC.exists(path) && !SD_MMC.mkdir(path)) return false;
        from = slash + 1;
    }
    return true;
}

void onUploadChunk(AsyncWebServerRequest* request, const String& filename, size_t index, uint8_t* data, size_t len, bool final) {
    if (index == 0) {
        if (upload.owner && upload.owner != request) return;  // Another upload is running: answered in onUploadDone
        upload = Upload();
        upload.owner = request;
        request->onDisconnect([request]() {                   // Connection lost mid-upload: drop the partial file
            if (upload.owner != request) return;
            if (upload.status == 0) failUpload(499, "Connection lost");
            upload.owner = nullptr;
        });
        String dir = request->hasParam("dir") ? request->getParam("dir")->value() : "";
        if (!cleanServePath(dir)) return failUpload(400, "Invalid folder");
        if (!pathutil::isSafeFileName(filename.c_str())) return failUpload(400, "Invalid file name");
        if (!pathutil::fitsFreeSpace(request->contentLength(), cardFree, uploadReserve)) {
            return failUpload(507, "Not enough space on the card: " + humanSize(cardFree) + " free.");
        }
        upload.target = "/serve/" + (dir.isEmpty() ? "" : dir + "/") + filename;
        if (SD_MMC.exists(upload.target)) {
            return failUpload(409, filename + " already exists in this folder. Rename it, or delete the old one first.");
        }
        if (!makeFolders(dir)) return failUpload(500, "Could not create the folder");
        upload.part = upload.target + ".part";
        upload.file = SD_MMC.open(upload.part, FILE_WRITE);
        if (!upload.file) return failUpload(500, "Could not create the file");
        Serial.println("Upload started: " + upload.target);
    }
    if (upload.owner != request || upload.status != 0) return;
    if (len && upload.file.write(data, len) != len) return failUpload(507, "The card is full. Nothing was saved.");
    upload.written += len;
    if (final) {
        upload.file.close();
        if (!SD_MMC.rename(upload.part, upload.target)) return failUpload(500, "Could not save the file");
        cardFree = cardFree > upload.written ? cardFree - upload.written : 0;
        upload.status = 200;
        Serial.printf("Upload done: %s (%llu bytes)\n", upload.target.c_str(), upload.written);
    }
}

void onUploadDone(AsyncWebServerRequest* request) {
    if (upload.owner && upload.owner != request) {
        request->send(503, "text/plain", "Another upload is running. Try again when it has finished.");
        return;
    }
    if (!upload.owner || upload.status == 0) {
        if (upload.owner) failUpload(400, "");
        upload.owner = nullptr;
        request->send(400, "text/plain", "No file received");
        return;
    }
    request->send(upload.status, "text/plain", upload.status == 200 ? String("OK") : upload.message);
    upload.owner = nullptr;
}

String fileEntryHtml(const String& href, const String& label) {
    return "<div class=\"file\"><a href=\"" + href + "\">" + label + "</a></div>";
}

void setupRoutes(MiddlewareHandler& app, AsyncWebServer& server, TinyGPSPlus& gps) {
    // Add the root route
    app.addRoute("/", HTTP_GET, [](AsyncWebServerRequest *request){
        request->send_P(200, "text/html", index_html);
    });

    // Add the location route
    app.addRoute("/location", HTTP_GET, [&](AsyncWebServerRequest *request){
        DynamicJsonDocument doc(500);
        doc["last_update"] = (int) (millis() - lastGpsUpdate) / 1000;

        // "fix" = a position less than 5 s old; the page only trusts coordinates when it is true
        doc["fix"] = gps.location.isValid() && gps.location.age() < 5000;
        doc["latitude"] = gps.location.isValid() ? gps.location.lat() : 0.0;
        doc["longitude"] = gps.location.isValid() ? gps.location.lng() : 0.0;
        doc["altitude"] = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
        doc["satellites"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
        doc["hdop"] = gps.hdop.isValid() ? gps.hdop.hdop() : 0.0;
        doc["speed_kmh"] = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
        doc["course"] = gps.course.isValid() ? gps.course.deg() : 0.0;
        doc["time"] = gps.time.isValid() ? gps.time.value() : 0;

        String jsonResponse;
        serializeJson(doc, jsonResponse);
        request->send(200, "application/json", jsonResponse);
        Serial.println("Sending GPS data: " + jsonResponse);
    });

    // Add the diagnostics route
    app.addRoute("/diagnostics", HTTP_GET, [](AsyncWebServerRequest *request){
        DynamicJsonDocument doc(200);
        doc["free_heap"] = ESP.getFreeHeap();
        doc["uptime_seconds"] = millis() / 1000;

        String jsonResponse;
        serializeJson(doc, jsonResponse);
        request->send(200, "application/json", jsonResponse);
        Serial.println("Sending Diagnostics data: " + jsonResponse);
    });

   app.addRoute("/files", HTTP_GET, [](AsyncWebServerRequest *request){
        String fileListHtml = "";

        // Folder to list, relative to /serve (e.g. "Rutas/Pirineos")
        String dir = request->hasParam("dir") ? request->getParam("dir")->value() : "";
        if (!cleanServePath(dir)) {
            request->send(400, "text/plain", "Invalid folder");
            return;
        }
        String prefix = dir.isEmpty() ? "" : dir + "/";

        // Current path, plus a link to the parent folder when inside a subfolder
        fileListHtml += "<div class=\"path\">/serve/" + htmlEscape(dir) + "</div>";
        if (!dir.isEmpty()) {
            int slash = dir.lastIndexOf('/');
            String parent = slash < 0 ? "" : dir.substring(0, slash);
            fileListHtml += fileEntryHtml("/files?dir=" + urlEncode(parent), "&#11014;&#65039; Up");
        }

        File root = SD_MMC.open("/serve" + (dir.isEmpty() ? "" : "/" + dir));
        if (!root || !root.isDirectory()) {
            fileListHtml += "<div class=\"file\">Failed to open directory</div>";
        } else {
            // Two passes over the folder: subfolders first, then files
            int listed = 0;
            bool truncated = false;
            for (int pass = 0; pass < 2 && !truncated; pass++) {
                root.rewindDirectory();
                File file = root.openNextFile();
                while (file) {
                    String fileName = file.name();
                    bool wanted = fileName.charAt(0) != '.' && file.isDirectory() == (pass == 0);
                    if (wanted && listed >= maxListedEntries) {
                        truncated = true;
                        break;
                    }
                    if (wanted) {
                        String relPath = urlEncode(prefix + fileName);
                        if (pass == 0) {
                            fileListHtml += fileEntryHtml("/files?dir=" + relPath, "&#128193; " + htmlEscape(fileName));
                        } else {
                            fileListHtml += fileEntryHtml("/download?file=" + relPath,
                                htmlEscape(fileName) + " (" + humanSize(file.size()) + ")");
                        }
                        listed++;
                    }
                    file = root.openNextFile();
                }
            }
            if (truncated) {
                fileListHtml += "<div class=\"path\">Only the first " + String(maxListedEntries) +
                                " items are shown. Split this folder into subfolders to see the rest.</div>";
            }
        }

        // Replace the placeholder with the actual file list HTML
        String htmlResponse = files_html;
        htmlResponse.replace("<!-- FILES_PLACEHOLDER -->", fileListHtml);

        // Send the response
        request->send(200, "text/html", htmlResponse);
    });


    app.addRoute("/download", HTTP_GET, [](AsyncWebServerRequest *request){
        if (request->hasParam("file")) {
            String relPath = request->getParam("file")->value();
            if (!cleanServePath(relPath) || relPath.isEmpty()) {
                request->send(400, "text/plain", "Invalid file path");
                return;
            }
            String fileName = relPath.substring(relPath.lastIndexOf('/') + 1);
            File file = SD_MMC.open("/serve/" + relPath, FILE_READ);

            if (!file || file.isDirectory()) {
                request->send(404, "text/plain", "File Not Found");
                return;
            }

            // Set the Content-Disposition header to specify the file name
            AsyncWebServerResponse *response = request->beginChunkedResponse("application/octet-stream", [file](uint8_t *buffer, size_t maxLen, size_t index) mutable -> size_t {
                size_t bytesRead = file.read(buffer, maxLen);
                vTaskDelay(1 / portTICK_PERIOD_MS); // Yield to the scheduler
                if (bytesRead > 0) {
                    return bytesRead;
                } else {
                    file.close();
                    return 0; // End of file
                }
            });

            // filename* carries the real (UTF-8) name, e.g. with accents; filename is the plain fallback
            String asciiName = fileName;
            asciiName.replace("\"", "_");
            response->addHeader("Content-Disposition",
                "attachment; filename=\"" + asciiName + "\"; filename*=UTF-8''" + urlEncode(fileName));
            request->send(response);
        } else {
            request->send(400, "text/plain", "File parameter missing");
        }
    });
    // Add the tiles route
    app.addRoute("/tiles/*", HTTP_GET, [](AsyncWebServerRequest *request) {
        // Tiles live at /tiles/<layer>/<z>/<x>/<y>.<ext> on the SD card, same path as the URL
        String path = request->url();
        if (path.indexOf("..") >= 0) {
            request->send(400, "text/plain", "Invalid tile path");
            return;
        }

        File file = SD_MMC.open(path, FILE_READ);
        if (!file || file.isDirectory()) {
            request->send(404, "text/plain", "File Not Found"); // The page then falls back to a lower zoom
            return;
        }

        const char* contentType = "application/octet-stream";
        if (path.endsWith(".jpg")) contentType = "image/jpeg";
        else if (path.endsWith(".png")) contentType = "image/png";
        else if (path.endsWith(".pbf")) contentType = "application/x-protobuf";

        AsyncWebServerResponse* response = request->beginResponse(file, path, contentType);
        response->addHeader("Cache-Control", tileCacheControl); // Phones keep tiles instead of re-downloading
        request->send(response);
    });

    // Free space for the /files page: {total, used, free, maxUpload} in bytes
    app.addRoute("/storage", HTTP_GET, [](AsyncWebServerRequest *request) {
        char json[160];
        uint64_t maxUpload = cardFree > uploadReserve ? cardFree - uploadReserve : 0;
        snprintf(json, sizeof json, "{\"total\":%llu,\"used\":%llu,\"free\":%llu,\"maxUpload\":%llu}",
                 cardTotal, cardTotal - cardFree, cardFree, maxUpload);
        request->send(200, "application/json", json);
    });

    // Upload a file into /serve/<dir> (multipart form, field "file"). Streams to <name>.part, then renames it.
    refreshStorage();
    server.on("/upload", HTTP_POST, onUploadDone, onUploadChunk);

    // Add the ping route
    app.addRoute("/ping", HTTP_GET, [](AsyncWebServerRequest *request){
        request->send(200, "text/plain", "pong");
    });

    // Serve static files
    // Serve static files (a .gz copy next to a file is sent instead when present, which saves Wi-Fi time)
    app.serveStatic("/leaflet.js", SD_MMC, "/leaflet.js", staticCacheControl);
    app.serveStatic("/leaflet.css", SD_MMC, "/leaflet.css", staticCacheControl);
    app.serveStatic("/error.png", SD_MMC, "/error.png", staticCacheControl);
    app.serveStatic("/favicon.ico", SD_MMC, "/favicon.ico", staticCacheControl);
    app.serveStatic("/icon-192.png", SD_MMC, "/icon-192.png", staticCacheControl); // Home-screen icon
    app.serveStatic("/wmm.js", SD_MMC, "/wmm.js", staticCacheControl);
    // The map app changes more often than libraries, so browsers re-check it on every visit
    app.serveStatic("/geo.js", SD_MMC, "/geo.js", "no-cache");
    app.serveStatic("/marks.js", SD_MMC, "/marks.js", "no-cache");
    app.serveStatic("/search.js", SD_MMC, "/search.js", "no-cache");
    app.serveStatic("/nav.js", SD_MMC, "/nav.js", "no-cache");
    app.serveStatic("/lib/", SD_MMC, "/lib/", staticCacheControl);       // MapLibre (vector layer)
    app.serveStatic("/vector/", SD_MMC, "/vector/", staticCacheControl); // Vector style, fonts, icons
    app.serveStatic("/search/", SD_MMC, "/search/", staticCacheControl); // Search data (*.json.gz, served gzipped)

    // Handle connectivity routes
    app.addRoute("/connecttest.txt", HTTP_GET, [](AsyncWebServerRequest *request) { request->redirect("/"); });
    app.addRoute("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request) { request->redirect("/"); });
    app.addRoute("/hotspot-detect.html", HTTP_GET, [](AsyncWebServerRequest *request) { request->redirect("/"); });
    app.addRoute("/canonical.html", HTTP_GET, [](AsyncWebServerRequest *request) { request->redirect("/"); });
    app.addRoute("/success.txt", HTTP_GET, [](AsyncWebServerRequest *request) { request->send(200); });
    app.addRoute("/ncsi.txt", HTTP_GET, [](AsyncWebServerRequest *request) { request->redirect("/"); });

    server.onNotFound(notFound);  // Handle 404 errors with middleware
}

#endif // ROUTES_H
