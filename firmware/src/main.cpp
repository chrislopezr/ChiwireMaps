#include <WiFi.h>
#include <SD_MMC.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include "FunctionTimer.h"
#include "TFT_eSPI.h" // https://github.com/Bodmer/TFT_eSPI
#include "pin_config.h"
#include <Middlewares.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <qrcode.h>
#include <routes.h>
#include "StatusLed.h"
#include "capybara_icon.h"

// Access point credentials
const char* ssid = "chiwire";
const char* password = "aguacate"; // Set to "" for no password

TFT_eSPI tft = TFT_eSPI();
AsyncWebServer server(80);
MiddlewareHandler app(server);
TinyGPSPlus gps;

volatile bool buttonPressed = false;
bool displayNetwork = true;
bool screenOn = true;
long lastButtonPress = 0;
long lastGpsUpdate = 0;
bool startupError = false; // Set when setup() can't finish (e.g. SD card missing); shows red LED

void IRAM_ATTR handleButtonPress() {
    buttonPressed = true;  // Set a flag indicating the button was pressed
}

// Function to turn off the display
void turnOffDisplay() {
    digitalWrite(TFT_LEDA_PIN, 1);  // Turn off the display backlight
    screenOn = false;
}

void turnOnDisplay() {
    digitalWrite(TFT_LEDA_PIN, 0);  // Turn on the display backlight
    screenOn = true;
}

void setup() {
    Serial.begin(115200);
    StatusLed::begin();
    StatusLed::set(StatusLed::yellow); // Starting up
    // GPS sends up to 10 fixes/s at 115200 baud; 2 KB covers pauses like screen redraws (default is 256 bytes)
    Serial2.setRxBufferSize(2048);
    Serial2.begin(115200, SERIAL_8N1, 44, 43); // Initialize Serial2 for GPS on pins 44 (RX) and 43 (TX)
    
    pinMode(BTN_PIN, INPUT_PULLUP);
    attachInterrupt(BTN_PIN, handleButtonPress, FALLING);

    pinMode(TFT_LEDA_PIN, OUTPUT);
    tft.init();
    tft.setRotation(4);
    tft.fillScreen(TFT_BLACK);
    digitalWrite(TFT_LEDA_PIN, 0);
    // Start-up screen: the Chiwire Maps capybara; the network screen replaces it at the first refresh
    tft.setSwapBytes(true); // The icon is stored as plain RGB565 numbers
    tft.pushImage((tft.width() - capybara_icon_width) / 2, 30, capybara_icon_width, capybara_icon_height, capybara_icon);
    tft.setTextFont(1);
    tft.setTextSize(1);
    tft.setTextColor(TFT_WHITE);
    tft.drawCentreString("Chiwire", tft.width() / 2, 104, 1);
    tft.drawCentreString("Maps", tft.width() / 2, 116, 1);
    

    SD_MMC.setPins(SD_MMC_CLK_PIN, SD_MMC_CMD_PIN, SD_MMC_D0_PIN, SD_MMC_D1_PIN, SD_MMC_D2_PIN, SD_MMC_D3_PIN);
    if (!SD_MMC.begin("/sdcard", false, false, 40000000, 16)) {
        Serial.println("Card Mount Failed");
        startupError = true;
        StatusLed::set(StatusLed::red);
        return;
    }
    uint8_t cardType = SD_MMC.cardType();
    if (cardType == CARD_NONE) {
        Serial.println("No SD card attached");
        startupError = true;
        StatusLed::set(StatusLed::red);
        return;
    }

    Serial.println("SD card initialized.");

    // Set up access point
    WiFi.softAP(ssid, password);
    IPAddress IP = WiFi.softAPIP();
    Serial.print("AP IP address: ");
    Serial.println(IP);

    // Add default headers for CORS
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

    // Add middlewares
    app.use(logRequest);
    app.use(monitorResources);

    
    setupRoutes(app, server, gps);

    server.onNotFound(notFound);

    server.begin();
}

void readGPS() {
    while (Serial2.available() > 0) {
        gps.encode(Serial2.read());
    }
    if(gps.location.isUpdated()){
        lastGpsUpdate = millis();
    }
}

// GPS link health in the serial log: chars/s should match what the module sends, failed should stay ~0
void logGpsStats() {
    static uint32_t lastChars = 0;
    uint32_t chars = gps.charsProcessed();
    Serial.printf("GPS: %lu chars/s, %lu sentences ok, %lu failed checksum\n",
                  (unsigned long)((chars - lastChars) / 10), (unsigned long)gps.passedChecksum(),
                  (unsigned long)gps.failedChecksum());
    lastChars = chars;
}

void checkForStaleConnections(){
    app.checkForStaleConnections();
}

void logHeap(){
    if(displayNetwork){
        tft.fillScreen(TFT_BLACK);
        tft.setTextColor(TFT_RED);
        tft.setTextSize(2);
        tft.setCursor(0,0);
        tft.println();
        tft.println("  YOU");
        tft.println("  ARE");
        if(gps.location.isValid()){
            tft.setTextColor(TFT_GREEN);
            tft.println("  OFF");
            tft.setTextColor(TFT_RED);
        }else{
            tft.println("  OFF");
        }
        tft.println(" GRID.");
        tft.println();

        // Create the Wi-Fi QR code content
        char wifiConfig[128];
        snprintf(wifiConfig, sizeof(wifiConfig), "WIFI:T:WPA;S:%s;P:%s;;", ssid, password);

        // Generate QR code
        QRCode qrcode;
        uint8_t qrcodeData[qrcode_getBufferSize(3)];
        qrcode_initText(&qrcode, qrcodeData, 3, 0, wifiConfig);
        // Calculate position to center QR code at the bottom
        int qrSize = qrcode.size * 2; // Scale the QR code size by 2
        int qrX = (tft.width() - qrSize) / 2;
        int qrY = tft.height() - qrSize - 10; // 10 pixels padding from bottom

        // White quiet zone around the code so scanners can find its edges
        tft.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, TFT_WHITE);

        // Draw the QR code on the display
        for (int y = 0; y < qrcode.size; y++) {
            for (int x = 0; x < qrcode.size; x++) {
                int pixelColor = qrcode_getModule(&qrcode, x, y) ? TFT_BLACK : TFT_WHITE;
                tft.fillRect(qrX + x * 2, qrY + y * 2, 2, 2, pixelColor); // Scale the QR code
            }
        }
    }else{
        tft.fillScreen(TFT_BLACK);
        tft.setCursor(0,0);
         // Generate QR code for the SoftAP IP address
        String ipAddress = WiFi.softAPIP().toString();
        char qrUrl[64];
        snprintf(qrUrl, sizeof(qrUrl), "http://%s/", ipAddress.c_str());

        QRCode qrcode;
        uint8_t qrcodeData[qrcode_getBufferSize(3)];
        qrcode_initText(&qrcode, qrcodeData, 3, 0, qrUrl);

        // Calculate position to center QR code at the top
        int qrSize = qrcode.size * 2; // Scale the QR code size by 2
        int qrX = (tft.width() - qrSize) / 2;
        int qrY = 10; // 10 pixels padding from top

        // White quiet zone around the code so scanners can find its edges
        tft.fillRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, TFT_WHITE);

        // Draw the QR code on the display
        for (int y = 0; y < qrcode.size; y++) {
            for (int x = 0; x < qrcode.size; x++) {
                int pixelColor = qrcode_getModule(&qrcode, x, y) ? TFT_BLACK : TFT_WHITE;
                tft.fillRect(qrX + x * 2, qrY + y * 2, 2, 2, pixelColor); // Scale the QR code
            }
        }

        // Draw the "YOU ARE HERE" text below the QR code
        tft.setCursor(0, qrY + qrSize + 10);
        tft.setTextSize(2);
        tft.setTextColor(TFT_RED);
        tft.println();
        tft.println("  YOU");
        tft.println("  ARE");
        tft.println(" HERE.");
    }
}

void buttonHandler(){
    if(buttonPressed){
        lastButtonPress = millis();
        buttonPressed=false;
        if(!screenOn){
            turnOnDisplay();
            return;
        }
        displayNetwork = !displayNetwork;
        logHeap();
    }
}
void checkIfScreenInactive(){
    if(!screenOn){
        return;
    }
    if(millis() - lastButtonPress > 30000){
        turnOffDisplay();
    }
}

// LED priority: red (error) > blue (device on Wi-Fi) > green (GPS position fix) > off
void updateStatusLed() {
    if (startupError) {
        StatusLed::set(StatusLed::red);
    } else if (WiFi.softAPgetStationNum() > 0) {
        StatusLed::set(StatusLed::blue);
    } else if (gps.location.isValid() && gps.location.age() < 5000) {
        StatusLed::set(StatusLed::green);
    } else {
        StatusLed::set(StatusLed::off);
    }
}

FunctionTimer screnMonitor(checkIfScreenInactive, 10000);
FunctionTimer ledMonitor(updateStatusLed, 1000);
FunctionTimer buttonMonitor(buttonHandler,100);
FunctionTimer heapMonitor(logHeap, 10000);
FunctionTimer connectionMonitor(&checkForStaleConnections, 1000);
FunctionTimer gpsStats(logGpsStats, 10000);

void loop() {
    connectionMonitor.service();
    heapMonitor.service();
    readGPS(); // Every pass: emptying the UART often keeps NMEA sentences intact
    gpsStats.service();
    buttonMonitor.service();
    screnMonitor.service();
    ledMonitor.service();
    vTaskDelay(1); // Yield to the scheduler
}
