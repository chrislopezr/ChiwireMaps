"""Seam 3: downloading tiles to disk, tested against a fake tile server on localhost."""
import csv
import http.server
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader"))
import spain_tiles  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0fake-jpeg-bytes"


class FakeTileServer:
    """Serves /<z>/<x>/<y> with a scripted response per path; records every request."""

    def __init__(self):
        self.responses = {}  # path -> list of (status, content_type, body, declared_length or None)
        self.default = (404, "text/plain", b"not found", None)  # for paths without a scripted response
        self.limit_per_second = None  # like a throttling server: 503 above this many requests per second
        self.requests = []
        self.recent = []
        lock = threading.Lock()
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                with lock:
                    outer.requests.append(self.path)
                    now = time.monotonic()
                    outer.recent = [t for t in outer.recent if now - t < 1.0] + [now]
                    over_limit = outer.limit_per_second and len(outer.recent) > outer.limit_per_second
                queue = outer.responses.get(self.path, [outer.default])
                status, ctype, body, declared = queue.pop(0) if len(queue) > 1 else queue[0]
                if over_limit:
                    status, ctype, body, declared = 503, "text/plain", b"slow down", None
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(declared or len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.httpd.server_port}" + "/{z}/{x}/{y}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class DownloadTestCase(unittest.TestCase):
    def setUp(self):
        self.server = FakeTileServer()
        self.out = tempfile.mkdtemp()
        self.sources = {"mtn": {"url": self.server.url, "ext": "jpg", "content_types": ["image/jpeg"]}}

    def tearDown(self):
        self.server.close()
        shutil.rmtree(self.out)

    def run_download(self, tiles):
        return spain_tiles.download({"mtn": set(tiles)}, self.out, self.sources,
                                    workers=2, tiles_per_second=1000, retry_delay=0.01)

    def saved(self, z, x, y):
        path = os.path.join(self.out, "mtn", str(z), str(x), f"{y}.jpg")
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            return f.read()


class SavingTiles(DownloadTestCase):
    def test_tile_is_saved_under_layer_z_x_y(self):
        self.server.responses["/14/8023/6177"] = [(200, "image/jpeg", JPEG, None)]
        result = self.run_download([(14, 8023, 6177)])
        self.assertEqual(self.saved(14, 8023, 6177), JPEG)
        self.assertEqual(result["saved"], 1)


class Resume(DownloadTestCase):
    def test_tile_already_on_disk_is_not_downloaded_again(self):
        path = os.path.join(self.out, "mtn", "14", "8023")
        os.makedirs(path)
        with open(os.path.join(path, "6177.jpg"), "wb") as f:
            f.write(JPEG)
        result = self.run_download([(14, 8023, 6177)])
        self.assertEqual(self.server.requests, [])
        self.assertEqual(result["skipped"], 1)


class Problems(DownloadTestCase):
    def test_404_means_no_map_there_and_nothing_is_saved(self):
        result = self.run_download([(14, 1, 1)])
        self.assertIsNone(self.saved(14, 1, 1))
        self.assertEqual(result["missing"], [("mtn", 14, 1, 1)])

    def test_server_errors_are_retried_until_the_tile_arrives(self):
        self.server.responses["/14/2/2"] = [(503, "text/plain", b"busy", None),
                                            (500, "text/plain", b"oops", None),
                                            (200, "image/jpeg", JPEG, None)]
        result = self.run_download([(14, 2, 2)])
        self.assertEqual(self.saved(14, 2, 2), JPEG)
        self.assertEqual(len(self.server.requests), 3)
        self.assertEqual(result["failed"], [])

    def test_error_page_with_status_200_is_not_saved_as_a_tile(self):
        # WMTS servers can answer an exception report as XML
        self.server.responses["/14/3/3"] = [(200, "application/xml", b"<ExceptionReport/>", None)]
        result = self.run_download([(14, 3, 3)])
        self.assertIsNone(self.saved(14, 3, 3))
        self.assertEqual(result["failed"], [("mtn", 14, 3, 3)])

    def test_connection_cut_mid_tile_leaves_no_half_file(self):
        # Server promises 5000 bytes and sends 20, every time
        self.server.responses["/14/4/4"] = [(200, "image/jpeg", JPEG, 5000)]
        result = self.run_download([(14, 4, 4)])
        self.assertIsNone(self.saved(14, 4, 4))
        self.assertEqual(os.listdir(self.out) and sorted(
            os.path.join(r, f) for r, _, fs in os.walk(self.out) for f in fs), [])
        self.assertEqual(result["failed"], [("mtn", 14, 4, 4)])


class OurNetworkDown(DownloadTestCase):
    def test_tile_waits_for_our_network_to_come_back_instead_of_failing(self):
        self.server.responses["/14/5/5"] = [(200, "image/jpeg", JPEG, None)]
        real_urlopen = urllib.request.urlopen
        outage = [urllib.error.URLError(socket.gaierror(-3, "Temporary failure in name resolution"))] * 6

        def flaky_urlopen(*args, **kwargs):  # Wi-Fi gone for 6 tries: more than the 4 attempts a tile gets
            if outage:
                raise outage.pop()
            return real_urlopen(*args, **kwargs)

        with mock.patch.object(spain_tiles.urllib.request, "urlopen", flaky_urlopen):
            result = self.run_download([(14, 5, 5)])
        self.assertEqual(self.saved(14, 5, 5), JPEG)
        self.assertEqual(result["failed"], [])


class RealSourceSettings(DownloadTestCase):
    def test_vector_tiles_labelled_binary_octet_stream_are_accepted(self):
        # IGN's vector server (Amazon S3) answers "content-type: binary/octet-stream"
        self.sources = {"mtn": dict(spain_tiles.SOURCES["vector"], url=self.server.url, ext="jpg")}
        self.server.responses["/14/8023/6177"] = [(200, "binary/octet-stream", b"\x1a\x02pbf", None)]
        result = self.run_download([(14, 8023, 6177)])
        self.assertEqual(result["failed"], [])
        self.assertEqual(self.saved(14, 8023, 6177), b"\x1a\x02pbf")


class AdaptiveSpeed(DownloadTestCase):
    def test_climbs_until_throttled_then_settles_below_the_limit_and_logs_every_window(self):
        self.server.default = (200, "image/jpeg", JPEG, None)
        self.server.limit_per_second = 40
        metrics = os.path.join(self.out, "metrics.csv")
        controller = spain_tiles.AdaptiveRate(start=10, step=10, minimum=2, maximum=200)
        result = spain_tiles.download({"mtn": {(14, x, 0) for x in range(250)}}, self.out, self.sources,
                                      workers=16, tiles_per_second=10, retry_delay=0.3,
                                      adaptive=controller, window_seconds=0.5, metrics_path=metrics)
        self.assertEqual((result["saved"], result["failed"]), (250, []))
        with open(metrics) as f:
            rows = list(csv.DictReader(f))
        self.assertGreaterEqual(len(rows), 3)
        self.assertTrue(any(int(r["throttled"]) > 0 for r in rows), "the probe should reach the limit")
        self.assertLess(float(rows[-1]["target_rate"]), 40)

    def test_stops_when_the_server_seems_to_block_us(self):
        self.server.default = (503, "text/plain", b"blocked", None)
        controller = spain_tiles.AdaptiveRate(start=2, step=1, minimum=2, maximum=10)
        start = time.monotonic()
        result = spain_tiles.download({"mtn": {(14, x, 0) for x in range(500)}}, self.out, self.sources,
                                      workers=4, tiles_per_second=2, retry_delay=0.05,
                                      adaptive=controller, window_seconds=0.5)
        self.assertEqual(result["stopped"], "possible block")
        self.assertLess(time.monotonic() - start, 10)


class VectorSeaTiles(DownloadTestCase):
    def test_vector_403_access_denied_means_no_map_there_not_a_failure(self):
        # IGN's vector S3 bucket answers 403 AccessDenied for tiles that do not exist (sea)
        self.sources = {"mtn": dict(spain_tiles.SOURCES["vector"], url=self.server.url, ext="jpg")}
        self.server.responses["/13/3883/3013"] = [(403, "application/xml", b"<Error><Code>AccessDenied</Code></Error>", None)]
        result = self.run_download([(13, 3883, 3013)])
        self.assertEqual((result["missing"], result["failed"]), ([("mtn", 13, 3883, 3013)], []))

    def test_raster_403_still_counts_as_a_failure(self):
        self.server.responses["/13/1/1"] = [(403, "text/plain", b"forbidden", None)]
        result = self.run_download([(13, 1, 1)])
        self.assertEqual(result["failed"], [("mtn", 13, 1, 1)])


class IgnUrls(unittest.TestCase):
    def test_mtn_url_puts_x_in_tilecol_and_y_in_tilerow(self):
        url = urlparse(spain_tiles.tile_url(spain_tiles.SOURCES["mtn"], 14, 8023, 6177))
        q = {k.lower(): v[0] for k, v in parse_qs(url.query).items()}
        self.assertEqual(url.netloc, "www.ign.es")
        self.assertEqual((q["layer"], q["tilematrix"], q["tilecol"], q["tilerow"]), ("MTN", "14", "8023", "6177"))
        self.assertEqual(q["tilematrixset"], "GoogleMapsCompatible")

    def test_vector_url_is_z_x_y_pbf(self):
        self.assertEqual(spain_tiles.tile_url(spain_tiles.SOURCES["vector"], 14, 8023, 6177),
                         "https://vt-mapabase.idee.es/1.0.0/mapabase/14/8023/6177.pbf")


if __name__ == "__main__":
    unittest.main()
