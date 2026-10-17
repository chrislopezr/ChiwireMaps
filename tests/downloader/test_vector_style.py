"""Seam 4: turning IGN's online vector style into one that works offline from the dongle.

The fixture mirrors the structure of https://vt-mapabase.idee.es/files/styles/mapaBase_scn_color1_CNIG.json:
a vector source with camelCase zoom keys, a raster-dem terrain source, online glyphs/sprite.
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader"))
import spain_tiles  # noqa: E402

IGN_STYLE = {
    "version": 8,
    "sources": {
        "mapaBaseXYZ": {"type": "vector", "tiles": ["https://vt-mapabase.idee.es/1.0.0/mapabase/{z}/{x}/{y}.pbf"],
                        "minZoom": 0, "maxZoom": 17},
        "cmdsl003w": {"type": "raster-dem", "tiles": ["https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png"],
                      "minzoom": 5, "maxzoom": 15},
    },
    "terrain": {"source": "cmdsl003w"},
    "glyphs": "https://vt-mapabase.idee.es/files/styles/fonts/pbf/{fontstack}/{range}.pbf",
    "sprite": "https://vt-mapabase.idee.es/files/styles/sprites/sprite",
    "layers": [
        {"id": "fondo", "type": "background"},
        {"id": "relieve", "type": "hillshade", "source": "cmdsl003w"},
        {"id": "curvas", "type": "line", "source": "mapaBaseXYZ", "source-layer": "altimetria_lin"},
        {"id": "toponimos", "type": "symbol", "source": "mapaBaseXYZ", "source-layer": "nombre_orografia_pto",
         "layout": {"text-font": ["Noto Sans Italic"]}},
        {"id": "pueblos", "type": "symbol", "source": "mapaBaseXYZ", "source-layer": "contexto_nombre_poblacion_pto",
         "layout": {"text-font": ["Deja Vu Serif"]}},
    ],
}


class OfflineStyle(unittest.TestCase):
    def setUp(self):
        self.style = spain_tiles.offline_style(copy.deepcopy(IGN_STYLE), max_zoom=14)

    def test_vector_tiles_come_from_the_dongle(self):
        self.assertEqual(self.style["sources"]["mapaBaseXYZ"]["tiles"], ["{origin}/tiles/vector/{z}/{x}/{y}.pbf"])

    def test_vector_source_stops_at_the_downloaded_zoom_so_the_phone_overzooms(self):
        src = self.style["sources"]["mapaBaseXYZ"]
        self.assertEqual(src["maxzoom"], 14)
        self.assertNotIn("maxZoom", src)

    def test_terrain_source_and_the_layers_using_it_are_removed(self):
        self.assertNotIn("cmdsl003w", self.style["sources"])
        self.assertNotIn("terrain", self.style)
        self.assertEqual([l["id"] for l in self.style["layers"]], ["fondo", "curvas", "toponimos", "pueblos"])

    def test_fonts_and_icons_come_from_the_dongle(self):
        self.assertEqual(self.style["glyphs"], "{origin}/vector/fonts/{fontstack}/{range}.pbf")
        self.assertEqual(self.style["sprite"], "{origin}/vector/sprites/sprite")


class FontStacks(unittest.TestCase):
    def test_each_font_used_by_a_label_layer_is_listed_once(self):
        self.assertEqual(spain_tiles.font_stacks(IGN_STYLE), ["Deja Vu Serif", "Noto Sans Italic"])


class PrepareVectorFiles(unittest.TestCase):
    """Downloads the style, icons and fonts from a fake IGN server into an SD card folder."""

    def setUp(self):
        import json
        import shutil
        import tempfile
        from test_download import FakeTileServer
        self.server = FakeTileServer()
        base = self.server.url.replace("/{z}/{x}/{y}", "")
        style = copy.deepcopy(IGN_STYLE)
        style["sprite"] = base + "/sprites/sprite"
        style["glyphs"] = base + "/fonts/{fontstack}/{range}.pbf"
        ok = lambda body, ctype="application/octet-stream": [(200, ctype, body, None)]
        self.server.responses["/style.json"] = ok(json.dumps(style).encode(), "application/json")
        for name in ("sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"):
            self.server.responses["/sprites/" + name] = ok(b"icon:" + name.encode())
        for stack in ("Deja%20Vu%20Serif", "Noto%20Sans%20Italic"):
            self.server.responses[f"/fonts/{stack}/0-255.pbf"] = ok(b"glyphs")
        self.out = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.out)
        self.addCleanup(self.server.close)
        spain_tiles.prepare_vector(base + "/style.json", self.out, max_zoom=14, glyph_ranges=["0-255"])

    def read(self, *parts):
        with open(os.path.join(self.out, *parts), "rb") as f:
            return f.read()

    def test_style_is_saved_in_its_offline_form(self):
        import json
        style = json.loads(self.read("style.json"))
        self.assertEqual(style["sources"]["mapaBaseXYZ"]["tiles"], ["{origin}/tiles/vector/{z}/{x}/{y}.pbf"])

    def test_style_also_saved_gzipped_for_the_dongle_to_send_compressed(self):
        import gzip
        self.assertEqual(gzip.decompress(self.read("style.json.gz")), self.read("style.json"))

    def test_icons_are_saved_for_normal_and_high_density_screens(self):
        self.assertEqual(self.read("sprites", "sprite@2x.png"), b"icon:sprite@2x.png")
        self.assertEqual(self.read("sprites", "sprite.json"), b"icon:sprite.json")

    def test_fonts_are_saved_per_font_and_glyph_range(self):
        self.assertEqual(self.read("fonts", "Deja Vu Serif", "0-255.pbf"), b"glyphs")
        self.assertEqual(self.read("fonts", "Noto Sans Italic", "0-255.pbf"), b"glyphs")


if __name__ == "__main__":
    unittest.main()
