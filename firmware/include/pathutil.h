#ifndef PATHUTIL_H
#define PATHUTIL_H

// Pure helpers for the /files page and uploads. Plain C++ (no Arduino types) so they are tested on the PC:
// pio test -e native (firmware/test/test_pathutil).
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <string>

namespace pathutil {

// Trim slashes from a path relative to /serve; returns false if it tries to escape /serve
inline bool cleanServePath(std::string& path) {
    for (char& c : path) if (c == '\\') c = '/';
    size_t start = path.find_first_not_of('/');
    if (start == std::string::npos) { path.clear(); return true; }
    path = path.substr(start, path.find_last_not_of('/') - start + 1);
    return ("/" + path + "/").find("/../") == std::string::npos;
}

// A name FAT32 accepts and that stays inside its folder
inline bool isSafeFileName(const std::string& name) {
    if (name.empty() || name == "." || name == ".." || name.size() > 255) return false;
    for (unsigned char c : name) {
        if (c < 32 || std::string("\\/:*?\"<>|").find((char)c) != std::string::npos) return false;
    }
    return true;
}

// "1023 B", "200.0 KB", "59.5 GB" (1024-based, one decimal from KB)
inline std::string humanSize(uint64_t bytes) {
    if (bytes < 1024) return std::to_string(bytes) + " B";
    const char* units[] = {"KB", "MB", "GB", "TB"};
    double value = bytes / 1024.0;
    int unit = 0;
    while (value >= 1024 && unit < 3) { value /= 1024; unit++; }
    char text[32];
    snprintf(text, sizeof text, "%.1f %s", value, units[unit]);
    return text;
}

// True when `size` bytes fit in `freeBytes` while keeping `reserve` bytes free
inline bool fitsFreeSpace(uint64_t size, uint64_t freeBytes, uint64_t reserve) {
    return freeBytes >= reserve && size <= freeBytes - reserve;
}

// Percent-encode a path for use in a URL (keeps '/' so folder paths stay readable)
inline std::string urlEncode(const std::string& text) {
    const char* hex = "0123456789ABCDEF";
    std::string encoded;
    for (unsigned char c : text) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~' || c == '/') {
            encoded += (char)c;
        } else {
            encoded += '%';
            encoded += hex[c >> 4];
            encoded += hex[c & 0x0F];
        }
    }
    return encoded;
}

// Escape text so file names can't break (or inject into) the HTML
inline std::string htmlEscape(const std::string& text) {
    std::string escaped;
    for (char c : text) {
        if (c == '&') escaped += "&amp;";
        else if (c == '<') escaped += "&lt;";
        else if (c == '>') escaped += "&gt;";
        else if (c == '"') escaped += "&quot;";
        else escaped += c;
    }
    return escaped;
}

}  // namespace pathutil

#endif
