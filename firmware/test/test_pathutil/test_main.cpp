// Seam 6: firmware helpers tested on the PC (pio test -e native). They decide where uploads may go,
// which file names are safe on FAT32, how sizes are shown and whether a file fits on the card.
#include <unity.h>
#include "pathutil.h"

using namespace pathutil;

static std::string cleaned(std::string path, bool expectOk) {
    TEST_ASSERT_EQUAL_MESSAGE(expectOk, cleanServePath(path), path.c_str());
    return path;
}

void test_clean_path_trims_slashes_and_keeps_subfolders() {
    TEST_ASSERT_EQUAL_STRING("Rutas/Pirineos", cleaned("/Rutas/Pirineos/", true).c_str());
    TEST_ASSERT_EQUAL_STRING("Rutas/Pirineos", cleaned("Rutas\\Pirineos", true).c_str());
    TEST_ASSERT_EQUAL_STRING("", cleaned("///", true).c_str());
}

void test_clean_path_refuses_to_leave_serve() {
    cleaned("..", false);
    cleaned("../tiles", false);
    cleaned("Rutas/../../tiles", false);
    cleaned("Rutas\\..\\..\\nav.js", false);
}

void test_clean_path_allows_names_that_only_contain_dots() {
    TEST_ASSERT_EQUAL_STRING("v1..2/notes", cleaned("v1..2/notes", true).c_str());
}

void test_safe_file_names_on_fat32() {
    TEST_ASSERT_TRUE(isSafeFileName("track ñ.gpx"));
    TEST_ASSERT_TRUE(isSafeFileName("Guía 2026 (v2).pdf"));
    const char* bad[] = {"", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "bell\x07"};
    for (const char* name : bad) TEST_ASSERT_FALSE_MESSAGE(isSafeFileName(name), name);
    TEST_ASSERT_FALSE(isSafeFileName(std::string(256, 'a')));  // FAT32 long names: 255 characters at most
}

void test_human_size_uses_one_decimal_from_kb() {
    TEST_ASSERT_EQUAL_STRING("0 B", humanSize(0).c_str());
    TEST_ASSERT_EQUAL_STRING("1023 B", humanSize(1023).c_str());
    TEST_ASSERT_EQUAL_STRING("1.0 KB", humanSize(1024).c_str());
    TEST_ASSERT_EQUAL_STRING("200.0 KB", humanSize(200 * 1024).c_str());
    TEST_ASSERT_EQUAL_STRING("10.0 MB", humanSize(10ULL * 1024 * 1024).c_str());
    TEST_ASSERT_EQUAL_STRING("59.5 GB", humanSize(63887638528ULL).c_str());  // 59.5 x 1024^3
    TEST_ASSERT_EQUAL_STRING("119.0 GB", humanSize(119ULL * 1024 * 1024 * 1024).c_str());  // a 128 GB card
}

void test_fits_free_space_keeps_a_reserve() {
    const uint64_t MB = 1024 * 1024;
    TEST_ASSERT_TRUE(fitsFreeSpace(9 * MB, 10 * MB, 1 * MB));
    TEST_ASSERT_FALSE(fitsFreeSpace(9 * MB + 1, 10 * MB, 1 * MB));
    TEST_ASSERT_FALSE(fitsFreeSpace(1, MB / 2, 1 * MB));  // free below the reserve: nothing fits (no underflow)
}

void test_url_encode_keeps_slashes_and_encodes_utf8() {
    TEST_ASSERT_EQUAL_STRING("Rutas/track%20%C3%B1.gpx", urlEncode("Rutas/track ñ.gpx").c_str());
    TEST_ASSERT_EQUAL_STRING("a-b_c.d~e", urlEncode("a-b_c.d~e").c_str());
}

void test_html_escape_neutralises_markup() {
    TEST_ASSERT_EQUAL_STRING("&lt;b&gt;&quot;x&quot; &amp; y", htmlEscape("<b>\"x\" & y").c_str());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_clean_path_trims_slashes_and_keeps_subfolders);
    RUN_TEST(test_clean_path_refuses_to_leave_serve);
    RUN_TEST(test_clean_path_allows_names_that_only_contain_dots);
    RUN_TEST(test_safe_file_names_on_fat32);
    RUN_TEST(test_human_size_uses_one_decimal_from_kb);
    RUN_TEST(test_fits_free_space_keeps_a_reserve);
    RUN_TEST(test_url_encode_keeps_slashes_and_encodes_utf8);
    RUN_TEST(test_html_escape_neutralises_markup);
    return UNITY_END();
}
