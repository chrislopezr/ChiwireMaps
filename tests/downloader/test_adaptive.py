"""Adaptive download speed: climb while the server is healthy, back off on throttling, settle just below it."""
import errno
import os
import socket
import sys
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tileDownloader"))
import spain_tiles  # noqa: E402

CLEAN = {"ok": 100, "throttled": 0, "latency_p50": 0.10}


class AdaptiveRateTests(unittest.TestCase):
    def controller(self, **kw):
        args = dict(start=5, step=1, minimum=1, maximum=100)
        args.update(kw)
        return spain_tiles.AdaptiveRate(**args)

    def test_clean_windows_raise_the_rate_one_step_at_a_time_up_to_the_maximum(self):
        c = self.controller(maximum=7)
        self.assertEqual([c.update(CLEAN) for _ in range(3)], [6, 7, 7])

    def test_throttling_halves_the_rate(self):
        c = self.controller(start=10)
        self.assertEqual(c.update({"ok": 50, "throttled": 3, "latency_p50": 0.1}), 5)

    def test_one_broken_tile_in_a_busy_window_does_not_slow_the_download(self):
        # Seen on IGN: exactly 4 x HTTP 502 per event (one tile, 4 attempts) at 10, 15, 24 and 25 tiles/s
        c = self.controller(start=10)
        self.assertEqual(c.update({"ok": 1250, "throttled": 4, "latency_p50": 0.1}), 11)

    def test_after_throttling_it_climbs_back_only_to_90_percent_of_the_rate_that_was_throttled(self):
        c = self.controller(start=10, step=5)
        c.update({"ok": 50, "throttled": 1, "latency_p50": 0.1})  # throttled at 10 -> 5, ceiling 10
        self.assertEqual([c.update(CLEAN), c.update(CLEAN)], [9, 9])

    def test_slower_server_responses_pause_the_climb(self):
        c = self.controller()
        c.update(CLEAN)                                           # baseline 0.10 s, rate 6
        self.assertEqual(c.update({"ok": 100, "throttled": 0, "latency_p50": 0.25}), 6)

    def test_slow_responses_without_errors_never_lower_the_rate(self):
        # Seen on IGN: it slowed down (p95 0.69 s) even at 8.7 tiles/s, so slowness is on their side
        c = self.controller(start=10)
        c.update(CLEAN)  # 10 -> 11
        self.assertEqual(c.update({"ok": 1000, "throttled": 0, "latency_p50": 0.5, "slow_streak": 50}), 11)  # climb paused, not lowered

    def test_a_window_where_our_own_network_dropped_does_not_steer_the_speed(self):
        # Seen during the download: our Wi-Fi lost the access point -> 39 connection errors + 14 timeouts
        c = self.controller(start=10, step=5)
        outage = {"ok": 1278, "throttled": 53, "latency_p50": 0.1, "errors": {"network_down": 39, "timeout": 14}}
        self.assertEqual(c.update(outage), 10)
        self.assertEqual(c.update(CLEAN), 15)  # no ceiling was set (it would cap at 9)

    def test_rate_never_drops_below_the_minimum(self):
        c = self.controller(start=1.5)
        self.assertEqual(c.update({"ok": 10, "throttled": 1, "latency_p50": 0.1}), 1)

    def test_mostly_errors_at_the_minimum_rate_flags_a_possible_block(self):
        c = self.controller(start=1)
        c.update({"ok": 2, "throttled": 8, "latency_p50": 0.1})
        self.assertTrue(c.blocked)

    def test_occasional_errors_at_the_minimum_rate_are_not_a_block(self):
        c = self.controller(start=1)
        c.update({"ok": 50, "throttled": 1, "latency_p50": 0.1})
        self.assertFalse(c.blocked)


class ErrorKinds(unittest.TestCase):
    def kind(self, reason):
        return spain_tiles._error_kind(urllib.error.URLError(reason))

    def test_no_dns_or_no_route_means_our_own_network_is_down(self):
        self.assertEqual(self.kind(socket.gaierror(-3, "Temporary failure in name resolution")), "network_down")
        self.assertEqual(self.kind(OSError(errno.ENETUNREACH, "Network is unreachable")), "network_down")

    def test_a_refused_connection_comes_from_the_server_side(self):
        self.assertEqual(self.kind(ConnectionRefusedError(errno.ECONNREFUSED, "refused")), "connection_error")


class WindowStatsTests(unittest.TestCase):
    def test_summary_counts_outcomes_latencies_and_speed(self):
        w = spain_tiles.WindowStats()
        for latency in (0.1, 0.2, 0.3):
            w.record("ok", latency, 20000)
        w.record("missing", 0.1, 0)        # 404: the server answered fine, there is just no map there
        w.record("http_503", 0.05, 0)
        w.record("reset", 0.0, 0)
        s = w.summary(elapsed=2.0)
        self.assertEqual((s["ok"], s["throttled"]), (4, 2))
        self.assertEqual(s["errors"], {"http_503": 1, "reset": 1})
        self.assertEqual(s["latency_p50"], 0.1)  # median of the 4 answered requests: 0.1, 0.1, 0.2, 0.3
        self.assertEqual(s["latency_max"], 0.3)
        self.assertEqual(s["achieved_rate"], 3.0)  # 6 requests in 2 s
        self.assertEqual(s["kb_per_s"], 29.3)      # 60000 bytes / 2 s / 1024

    def test_summary_reports_the_longest_run_of_responses_slower_than_0_75_s(self):
        w = spain_tiles.WindowStats()
        for latency in (0.8, 0.9, 1.0, 0.1, 0.8, 0.8, 0.8, 0.8, 0.76):
            w.record("ok", latency, 100)
        w.record("http_502", 2.0, 0)  # errors are not responses: they neither count nor break the run
        w.record("ok", 0.9, 100)
        self.assertEqual(w.summary(elapsed=1.0)["slow_streak"], 6)

    def test_summary_resets_the_window(self):
        w = spain_tiles.WindowStats()
        w.record("ok", 0.1, 100)
        w.summary(elapsed=1.0)
        self.assertEqual(w.summary(elapsed=1.0)["ok"], 0)


if __name__ == "__main__":
    unittest.main()
