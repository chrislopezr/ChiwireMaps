"""Seam: building the offline search data from OpenStreetMap (tools/build_search.py), on a tiny hand-made file.

Run with the tools environment (it has pyosmium):  tools/.venv/bin/python -m unittest discover -s tests/search
"""
import gzip
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
import build_search  # noqa: E402

TINY = os.path.join(HERE, "fixtures", "tiny.osm")
CASES = json.load(open(os.path.join(HERE, "fixtures", "normalize_cases.json"), encoding="utf8"))["cases"]


def read_gz(path):
    with gzip.open(path, "rt", encoding="utf8") as f:
        return json.load(f)


class Normalising(unittest.TestCase):
    def test_shared_cases_match_the_phone(self):
        for name, text, words in CASES:
            self.assertEqual(build_search.normalize(name), text, name)
            self.assertEqual(build_search.search_words(name), words, name)


class Simplifying(unittest.TestCase):
    def test_wobbles_under_2_m_are_dropped_and_real_bends_kept(self):
        # A 200 m street along a parallel; the middle point is 1 m (dropped) or 50 m (kept) off the line
        a, b = (40.0, -3.0), (40.0, -2.99765)
        wobble, bend = (40.000009, -2.998825), (40.00045, -2.998825)
        self.assertEqual(build_search.simplify([a, wobble, b]), [a, b])
        self.assertEqual(build_search.simplify([a, bend, b]), [a, bend, b])


class Building(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = build_search.build_index(TINY)
        cls.by_name = {}
        for e in cls.index["entries"]:
            cls.by_name.setdefault((e["name"], e["kind"]), []).append(e)

    def test_same_street_name_in_one_town_is_one_result_with_all_its_pieces(self):
        mayors = self.by_name[("Calle Mayor", "street")]
        self.assertEqual(sorted(e["place"] for e in mayors), ["Villa Alta", "Villa Baja"])
        alta = next(e for e in mayors if e["place"] == "Villa Alta")
        self.assertEqual(len(self.index["streets"][alta["ref"]]["lines"]), 2)

    def test_street_lines_are_simplified_but_keep_their_ends(self):
        alta = next(e for e in self.by_name[("Calle Mayor", "street")] if e["place"] == "Villa Alta")
        lines = self.index["streets"][alta["ref"]]["lines"]
        self.assertIn([(40.001, -3.001), (40.001, -2.999)], lines)  # node 12 lay on the straight line

    def test_house_numbers_go_to_the_street_in_the_same_town(self):
        mayors = {e["place"]: self.index["streets"][e["ref"]]["numbers"] for e in self.by_name[("Calle Mayor", "street")]}
        self.assertEqual(sorted(n for n, _, _ in mayors["Villa Alta"]), ["12", "14B"])
        self.assertEqual([n for n, _, _ in mayors["Villa Baja"]], ["3"])
        building = next(p for p in mayors["Villa Alta"] if p[0] == "14B")
        self.assertAlmostEqual(building[1], 40.0017, places=4)  # centre of the building
        self.assertAlmostEqual(building[2], -2.9990, places=4)

    def test_points_of_interest_by_kind(self):
        kinds = {(e["name"], e["kind"]) for e in self.index["entries"] if e["kind"] != "street"}
        for expected in [("Sol", "metro_entrance"), ("Sol", "metro_station"), ("Bunker", "bunker"),
                         ("Comisaría Centro", "police"), ("Base Militar El Goloso", "military"),
                         ("Peñalara (2428 m)", "peak"), ("Drinking water", "water"),
                         ("Refugio Zabala", "shelter"), ("Villa Alta", "place"), ("Senda de los Pastores", "path")]:
            self.assertIn(expected, kinds)

    def test_area_features_are_placed_at_their_centre(self):
        base = self.by_name[("Base Militar El Goloso", "military")][0]
        self.assertAlmostEqual(base["lat"], 40.035, places=3)
        self.assertAlmostEqual(base["lon"], -3.025, places=3)

    def test_islands_ceuta_and_melilla_are_left_out(self):
        names = {e["name"] for e in self.index["entries"]}
        self.assertNotIn("Policía Palma", names)
        self.assertNotIn("Policía Ceuta", names)

    def test_unnamed_roads_are_not_searchable(self):
        self.assertEqual(sum(1 for e in self.index["entries"] if e["kind"] == "street"), 3)

    def test_unnamed_peaks_are_left_out(self):
        self.assertEqual([e["name"] for e in self.index["entries"] if e["kind"] == "peak"], ["Peñalara (2428 m)"])


class Writing(unittest.TestCase):
    def setUp(self):
        self.out = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.out)
        self.index = build_search.build_index(TINY)

    def test_each_search_word_has_a_small_gzip_file_listed_in_the_manifest(self):
        build_search.write_output(self.index, self.out)
        manifest = read_gz(os.path.join(self.out, "manifest.json.gz"))
        self.assertIn("pen", manifest["shards"])
        self.assertIn("© OpenStreetMap contributors", manifest["attribution"])
        self.assertFalse(os.path.exists(os.path.join(self.out, "manifest.json")))  # gzip only, like the rest
        rows = read_gz(os.path.join(self.out, "n", "pen.json.gz"))
        self.assertEqual(sorted(r[0] for r in rows), ["Calle de Peñalara", "Peñalara (2428 m)"])

    def test_crowded_words_are_split_into_longer_prefixes(self):
        build_search.write_output(self.index, self.out, shard_limit=1)
        manifest = read_gz(os.path.join(self.out, "manifest.json.gz"))
        self.assertNotIn("may", manifest["shards"])
        self.assertTrue(any(k.startswith("mayo") for k in manifest["shards"]))

    def test_street_geometry_and_numbers_are_in_numbered_blocks(self):
        build_search.write_output(self.index, self.out)
        rows = read_gz(os.path.join(self.out, "n", "may.json.gz"))
        alta = next(r for r in rows if r[2] == "Villa Alta")
        name, kind, place, lat5, lon5, ref = alta
        block = read_gz(os.path.join(self.out, "g", f"{ref // build_search.BLOCK}.json.gz"))
        street = block[str(ref)]
        self.assertEqual(len(street["lines"]), 2)
        self.assertIn(["12", 4000120, -300000], street["numbers"])

    def test_points_of_interest_are_grouped_by_map_tile_for_drawing(self):
        build_search.write_output(self.index, self.out)
        tiles = os.listdir(os.path.join(self.out, "poi"))
        everything = [p for t in tiles for p in read_gz(os.path.join(self.out, "poi", t))]
        self.assertIn(["bunker", "Bunker", 4004000, -304000], everything)
        self.assertFalse(any(p[0] == "street" for p in everything))


if __name__ == "__main__":
    unittest.main()
