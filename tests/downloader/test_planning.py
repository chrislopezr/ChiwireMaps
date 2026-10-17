"""Seam 2: which tiles an area needs, and how much space and time they take.

Expected values are worked by hand from the slippy-map tile formula, not computed with the code under test.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader"))
import spain_tiles  # noqa: E402


class LonLatToTile(unittest.TestCase):
    def test_madrid_puerta_del_sol_at_zoom_14(self):
        self.assertEqual(spain_tiles.lonlat_to_tile(40.4168, -3.7038, 14), (8023, 6177))

    def test_whole_world_is_one_tile_at_zoom_0(self):
        self.assertEqual(spain_tiles.lonlat_to_tile(40.4168, -3.7038, 0), (0, 0))


# Zoom 14 tile bounds worked by hand:
#   x 8023: lon -3.71338 .. -3.69141   x 8024: -3.69141 .. -3.66943   x 8025: -3.66943 .. -3.64746
#   y 6176: lat 40.4302 .. 40.4469     y 6177: 40.4134 .. 40.4302     y 6178: 40.3967 .. 40.4134
def rect(west, south, east, north):
    return [(west, south), (east, south), (east, north), (west, north)]


class TilesInPolygon(unittest.TestCase):
    def test_small_area_inside_one_tile(self):
        self.assertEqual(spain_tiles.tiles_in_polygon(rect(-3.705, 40.415, -3.700, 40.425), 14), {(8023, 6177)})

    def test_l_shape_skips_the_empty_corner_of_its_bounding_box(self):
        # Horizontal arm across x 8023..8025 in row 6177, vertical arm up into row 6176 only at x 8023
        l_shape = [(-3.71, 40.415), (-3.65, 40.415), (-3.65, 40.425), (-3.70, 40.425),
                   (-3.70, 40.44), (-3.71, 40.44)]
        self.assertEqual(spain_tiles.tiles_in_polygon(l_shape, 14),
                         {(8023, 6177), (8024, 6177), (8025, 6177), (8023, 6176)})

    def test_margin_of_1_5_km_adds_the_neighbouring_ring_of_tiles(self):
        # The small square is 0.2-0.6 km from its tile edges; 1.5 km reaches each neighbour but not beyond
        tiles = spain_tiles.tiles_in_polygon(rect(-3.705, 40.415, -3.700, 40.425), 14, margin_km=1.5)
        self.assertEqual(tiles, {(x, y) for x in (8022, 8023, 8024) for y in (6176, 6177, 6178)})


class Areas(unittest.TestCase):
    def tile(self, lat, lon, z):
        return spain_tiles.lonlat_to_tile(lat, lon, z)

    def test_peninsula_includes_madrid_but_not_mallorca_lisbon_or_andorra(self):
        tiles = spain_tiles.area_tiles("peninsula", 14)
        self.assertIn(self.tile(40.4168, -3.7038, 14), tiles)
        self.assertNotIn(self.tile(39.5696, 2.6502, 14), tiles)   # Palma de Mallorca
        self.assertNotIn(self.tile(38.7223, -9.1393, 14), tiles)  # Lisbon
        self.assertNotIn(self.tile(42.5078, 1.5211, 14), tiles)   # Andorra la Vella

    def test_mountain_area_stays_on_the_spanish_side_of_the_border(self):
        tiles = spain_tiles.area_tiles("pirineos", 16)
        self.assertIn(self.tile(42.6440, -0.0560, 16), tiles)     # Ordesa valley
        self.assertNotIn(self.tile(42.7353, -0.0094, 16), tiles)  # Gavarnie, France

    def test_madrid_region_covers_the_city_centre(self):
        self.assertIn(self.tile(40.4168, -3.7038, 16), spain_tiles.area_tiles("madrid", 16))

    def test_unknown_area_is_an_error(self):
        with self.assertRaises(KeyError):
            spain_tiles.area_tiles("atlantis", 10)


class PlanAndEstimate(unittest.TestCase):
    # Two overlapping rectangles: tile columns 8023-8024 and 8024-8025 in row 6177 at zoom 14
    AREAS = {
        "west": {"rect": [-3.71, 40.415, -3.68, 40.425]},
        "east": {"rect": [-3.68, 40.415, -3.65, 40.425]},
    }

    def test_overlapping_areas_download_shared_tiles_once(self):
        plan = [{"layers": ["mtn"], "areas": ["west", "east"], "zooms": [14, 14]}]
        jobs = spain_tiles.plan_jobs(plan, self.AREAS)
        self.assertEqual(jobs, {"mtn": {(14, 8023, 6177), (14, 8024, 6177), (14, 8025, 6177)}})

    def test_each_layer_gets_its_own_tiles_and_zoom_range(self):
        plan = [{"layers": ["mtn", "pnoa"], "areas": ["west"], "zooms": [14, 14]},
                {"layers": ["mtn"], "areas": ["west"], "zooms": [13, 13]}]
        jobs = spain_tiles.plan_jobs(plan, self.AREAS)
        self.assertEqual(jobs["pnoa"], {(14, 8023, 6177), (14, 8024, 6177)})
        self.assertEqual(jobs["mtn"], {(14, 8023, 6177), (14, 8024, 6177), (13, 4011, 3088), (13, 4012, 3088)})

    def test_estimate_rounds_each_file_up_to_the_card_block_size(self):
        jobs = {"mtn": {(14, x, 6177) for x in range(10)}}
        est = spain_tiles.estimate(jobs, avg_kb={"mtn": 15}, block_kb=4, tiles_per_second=5)
        self.assertEqual(est["mtn"]["tiles"], 10)
        self.assertEqual(est["mtn"]["disk_kb"], 160)   # 15 KB -> 16 KB on 4 KB blocks, x10
        self.assertEqual(est["total"]["seconds"], 2)    # 10 tiles at 5 per second

    def test_estimate_on_32_kb_blocks_shows_the_waste(self):
        est = spain_tiles.estimate({"mtn": {(14, 0, 0)}}, avg_kb={"mtn": 15}, block_kb=32, tiles_per_second=5)
        self.assertEqual(est["mtn"]["disk_kb"], 32)


if __name__ == "__main__":
    unittest.main()
