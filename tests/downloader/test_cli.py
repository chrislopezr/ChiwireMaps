"""Command line: `estimate` and `download` read a plan file and report what they will do / did."""
import contextlib
import csv
import functools
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader"))
import spain_tiles  # noqa: E402
from test_download import JPEG, FakeTileServer  # noqa: E402

# Two zoom-14 tiles (x 8023 and 8024, row 6177) — see test_planning.py for the hand-worked bounds
PLAN = {
    "areas": {"tiny": {"rect": [-3.71, 40.415, -3.68, 40.425]}},
    "steps": [{"layers": ["mtn"], "areas": ["tiny"], "zooms": [14, 14]}],
    "avg_kb": {"mtn": 15},
}


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    def write_plan(self, plan):
        path = os.path.join(self.tmp, "plan.json")
        with open(path, "w") as f:
            json.dump(plan, f)
        return path

    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = spain_tiles.main(list(args))
        return code, out.getvalue()

    def test_estimate_prints_tiles_and_space_per_layer(self):
        code, out = self.run_cli("estimate", "--plan", self.write_plan(PLAN))
        self.assertEqual(code, 0)
        self.assertRegex(out, r"mtn\s+2 tiles\s+32 KB")

    def test_download_saves_tiles_and_reports_failures(self):
        server = FakeTileServer()
        self.addCleanup(server.close)
        server.responses["/14/8023/6177"] = [(200, "image/jpeg", JPEG, None)]
        plan = dict(PLAN, sources={"mtn": {"url": server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        out_dir = os.path.join(self.tmp, "tiles")
        code, out = self.run_cli("download", "--plan", self.write_plan(plan), "--out", out_dir,
                                 "--rate", "1000", "--yes")
        self.assertTrue(os.path.exists(os.path.join(out_dir, "mtn", "14", "8023", "6177.jpg")))
        self.assertIn("saved 1", out)
        self.assertIn("missing 1", out)  # 8024 answers 404 on the fake server
        self.assertEqual(code, 0)


    def test_each_failed_tile_is_logged_when_it_fails_not_only_at_the_end(self):
        server = FakeTileServer()
        self.addCleanup(server.close)
        server.responses["/14/8023/6177"] = [(502, "text/plain", b"bad gateway", None)]
        plan = dict(PLAN, sources={"mtn": {"url": server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        log = io.StringIO()
        with contextlib.redirect_stderr(log), mock.patch.object(spain_tiles, "download", functools.partial(
                spain_tiles.download, retry_delay=0.01)):
            self.run_cli("download", "--plan", self.write_plan(plan), "--out", os.path.join(self.tmp, "tiles"),
                         "--rate", "1000", "--yes")
        self.assertIn("failed: mtn 14 8023 6177", log.getvalue())


class FailedTiles(unittest.TestCase):
    """failed.txt keeps every broken tile across runs, so they can be retried later with `retry`."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.server = FakeTileServer()
        self.addCleanup(self.server.close)
        plan = dict(PLAN, sources={"mtn": {"url": self.server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        self.plan_path = os.path.join(self.tmp, "plan.json")
        with open(self.plan_path, "w") as f:
            json.dump(plan, f)
        self.out_dir = os.path.join(self.tmp, "tiles")
        os.makedirs(self.out_dir)
        self.failed_txt = os.path.join(self.out_dir, "failed.txt")

    def run_cli(self, command):
        fast_retries = functools.partial(spain_tiles.download, retry_delay=0.01)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                mock.patch.object(spain_tiles, "download", fast_retries):
            return spain_tiles.main([command, "--plan", self.plan_path, "--out", self.out_dir, "--rate", "1000", "--yes"])

    def failed_lines(self):
        with open(self.failed_txt) as f:
            return f.read().splitlines()

    def test_failed_tiles_are_added_to_failed_txt_and_earlier_entries_are_kept(self):
        with open(self.failed_txt, "w") as f:
            f.write("mtn 16 1 1\n")  # from an earlier, interrupted run
        self.server.responses["/14/8023/6177"] = [(502, "text/plain", b"bad gateway", None)]
        self.run_cli("download")
        self.assertEqual(self.failed_lines(), ["mtn 16 1 1", "mtn 14 8023 6177"])

    def test_retry_fetches_only_listed_tiles_and_keeps_the_ones_still_broken(self):
        with open(self.failed_txt, "w") as f:
            f.write("mtn 14 8023 6177\nmtn 14 8024 6177\nmtn 14 8023 6177\nmtn 14 9 9\n")
        self.server.responses["/14/8023/6177"] = [(200, "image/jpeg", JPEG, None)]  # fixed now
        self.server.responses["/14/8024/6177"] = [(502, "text/plain", b"bad gateway", None)]  # still broken
        # /14/9/9 answers 404: no map there, nothing left to retry
        code = self.run_cli("retry")
        self.assertTrue(os.path.exists(os.path.join(self.out_dir, "mtn", "14", "8023", "6177.jpg")))
        self.assertEqual(self.failed_lines(), ["mtn 14 8024 6177"])
        self.assertEqual(set(self.server.requests), {"/14/8023/6177", "/14/8024/6177", "/14/9/9"})
        self.assertEqual(self.server.requests.count("/14/8023/6177"), 1)  # duplicates in the list fetched once
        self.assertEqual(code, 1)


class AdaptiveFromCli(unittest.TestCase):
    def test_adaptive_download_writes_a_metrics_file_next_to_the_tiles(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        server = FakeTileServer()
        self.addCleanup(server.close)
        server.default = (200, "image/jpeg", JPEG, None)
        plan = dict(PLAN, areas={"bigger": {"rect": [-3.75, 40.38, -3.65, 40.45]}},
                    steps=[{"layers": ["mtn"], "areas": ["bigger"], "zooms": [15, 15]}],
                    sources={"mtn": {"url": server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        plan_path = os.path.join(tmp, "plan.json")
        with open(plan_path, "w") as f:
            json.dump(plan, f)
        out_dir = os.path.join(tmp, "tiles")
        with contextlib.redirect_stdout(io.StringIO()):
            code = spain_tiles.main(["download", "--plan", plan_path, "--out", out_dir, "--yes",
                                     "--adaptive", "--rate", "20", "--max-rate", "60", "--window", "0.3"])
        self.assertEqual(code, 0)
        with open(os.path.join(out_dir, "download_metrics.csv")) as f:
            rows = list(csv.DictReader(f))
        self.assertGreater(len(rows), 0)
        self.assertGreater(float(rows[-1]["target_rate"]), 20)  # healthy server: it climbed


class BlockedFromCli(unittest.TestCase):
    def test_possible_block_stops_with_an_explanation_and_exit_code_3(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        server = FakeTileServer()
        self.addCleanup(server.close)
        server.default = (503, "text/plain", b"blocked", None)
        plan = dict(PLAN, sources={"mtn": {"url": server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        plan_path = os.path.join(tmp, "plan.json")
        with open(plan_path, "w") as f:
            json.dump(plan, f)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = spain_tiles.main(["download", "--plan", plan_path, "--out", os.path.join(tmp, "tiles"), "--yes",
                                     "--adaptive", "--rate", "1", "--min-rate", "1", "--window", "0.3"])
        self.assertEqual(code, 3)
        self.assertIn("IGN may be blocking this connection", out.getvalue())


class ProgressLine(unittest.TestCase):
    def test_time_left_ignores_tiles_skipped_because_they_were_already_on_disk(self):
        # Resumed run: 197,000 tiles skipped in a moment, then 50 fetched in 10 s -> 5 tiles/s.
        # Left: 3,664,537 - 197,050 = 3,467,487 tiles / 5 per s = 693,497 s = 192.6 h
        result = {"saved": 48, "skipped": 197000, "missing": [("mtn", 1, 1, 1)], "failed": [("mtn", 2, 2, 2)]}
        line = spain_tiles.progress_line(result, total=3664537, fetch_seconds=10)
        self.assertEqual(line, "197050/3664537 tiles, 5.0/s, ~192.6 h left")


class NoDuplicateDownloads(unittest.TestCase):
    """Two downloads into the same folder would fetch everything twice and race on the same files."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.server = FakeTileServer()
        self.addCleanup(self.server.close)
        self.server.responses["/14/8023/6177"] = [(200, "image/jpeg", JPEG, None)]
        plan = dict(PLAN, sources={"mtn": {"url": self.server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        self.plan_path = os.path.join(self.tmp, "plan.json")
        with open(self.plan_path, "w") as f:
            json.dump(plan, f)
        self.out_dir = os.path.join(self.tmp, "tiles")

    def run_download(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = spain_tiles.main(["download", "--plan", self.plan_path, "--out", self.out_dir, "--rate", "1000", "--yes"])
        return code, out.getvalue()

    def test_second_download_into_the_same_folder_refuses_to_start(self):
        holder = spain_tiles.lock_output(self.out_dir)  # stands in for a download already running
        self.addCleanup(holder.close)
        code, out = self.run_download()
        self.assertEqual(code, 2)
        self.assertIn(f"already running (PID {os.getpid()})", out)
        self.assertEqual(self.server.requests, [])

    def test_folder_is_free_again_after_a_download_finishes(self):
        self.assertEqual(self.run_download()[0], 0)
        code, out = self.run_download()
        self.assertEqual(code, 0)
        self.assertIn("skipped 1", out)


class CtrlC(unittest.TestCase):
    def test_ctrl_c_stops_the_whole_download_within_seconds(self):
        import signal
        import subprocess
        import time
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        server = FakeTileServer()
        self.addCleanup(server.close)
        # ~400 tiles at 5 tiles/s would take over a minute if Ctrl+C did not stop the worker threads
        plan = dict(PLAN, areas={"bigger": {"rect": [-3.75, 40.38, -3.65, 40.45]}},
                    steps=[{"layers": ["mtn"], "areas": ["bigger"], "zooms": [16, 16]}],
                    sources={"mtn": {"url": server.url, "ext": "jpg", "content_types": ["image/jpeg"]}})
        plan_path = os.path.join(tmp, "plan.json")
        with open(plan_path, "w") as f:
            json.dump(plan, f)
        script = os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader", "spain_tiles.py")
        proc = subprocess.Popen([sys.executable, "-I", script, "download", "--plan", plan_path,
                                 "--out", os.path.join(tmp, "tiles"), "--rate", "5", "--yes"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            self.fail("download kept running after Ctrl+C")
        requests_at_stop = len(server.requests)
        time.sleep(1)
        self.assertEqual(len(server.requests), requests_at_stop)


if __name__ == "__main__":
    unittest.main()
