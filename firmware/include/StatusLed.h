#ifndef STATUS_LED_H
#define STATUS_LED_H

#include <Arduino.h>
#include "pin_config.h"

// Minimal driver for the T-Dongle S3's single APA102 RGB LED (data + clock pins).
// Bit-banged on purpose: one LED doesn't need a full LED library.
namespace StatusLed {
    const uint8_t brightness = 3; // APA102 global brightness, 0-31 (3 is about 10%)

    struct Color { uint8_t r, g, b; };
    const Color off    = {0, 0, 0};
    const Color yellow = {255, 160, 0};
    const Color green  = {0, 255, 0};
    const Color blue   = {0, 0, 128};   // Half intensity (~5%): shown most of the time
    const Color red    = {255, 0, 0};

    static uint32_t current = 0xFFFFFFFF; // Last color sent; skips redundant writes

    inline void writeByte(uint8_t value) {
        for (int bit = 7; bit >= 0; bit--) {
            digitalWrite(LED_DI_PIN, (value >> bit) & 1);
            digitalWrite(LED_CI_PIN, HIGH);
            digitalWrite(LED_CI_PIN, LOW);
        }
    }

    inline void set(Color color) {
        uint32_t packed = ((uint32_t)color.r << 16) | ((uint32_t)color.g << 8) | color.b;
        if (packed == current) {
            return;
        }
        current = packed;

        for (int i = 0; i < 4; i++) writeByte(0x00);   // Start frame
        writeByte(0xE0 | brightness);                  // LED frame: brightness, then B, G, R
        writeByte(color.b);
        writeByte(color.g);
        writeByte(color.r);
        for (int i = 0; i < 4; i++) writeByte(0x00);   // End frame (extra clock pulses)
    }

    inline void begin() {
        pinMode(LED_DI_PIN, OUTPUT);
        pinMode(LED_CI_PIN, OUTPUT);
        digitalWrite(LED_CI_PIN, LOW);
        set(off);
    }
}

#endif // STATUS_LED_H
