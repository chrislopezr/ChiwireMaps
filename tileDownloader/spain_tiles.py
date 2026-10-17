#!/usr/bin/env python3
"""Download IGN (Spain) map tiles for the Chiwire Maps SD card.

    python3 spain_tiles.py estimate                       # size and time for plan_spain.json
    python3 spain_tiles.py download --out /path/to/tiles  # resumable; run again to continue
    python3 spain_tiles.py vector --out ../sdCard/vector  # offline vector style, icons, fonts
"""
import argparse
import csv
import errno
import fcntl
import gzip
import http.client
import json
import math
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

AREAS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "areas")

_WMTS = ("https://www.ign.es/wmts/{service}?layer={layer}&style=default&tilematrixset=GoogleMapsCompatible"
         "&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={{z}}&TileCol={{x}}&TileRow={{y}}")

# IGN / CNIG services (CC BY 4.0, credit "© Instituto Geográfico Nacional de España")
SOURCES = {
    "mtn": {"url": _WMTS.format(service="mapa-raster", layer="MTN"), "ext": "jpg", "content_types": ["image/jpeg"]},
    "pnoa": {"url": _WMTS.format(service="pnoa-ma", layer="OI.OrthoimageCoverage"), "ext": "jpg",
             "content_types": ["image/jpeg"]},
    "base": {"url": _WMTS.format(service="ign-base", layer="IGNBaseTodo"), "ext": "jpg",
             "content_types": ["image/jpeg"]},
    "vector": {"url": "https://vt-mapabase.idee.es/1.0.0/mapabase/{z}/{x}/{y}.pbf", "ext": "pbf",
               "content_types": ["binary/octet-stream"],  # what IGN's S3 bucket sends
               "missing_codes": [403, 404]},  # S3 answers 403 AccessDenied for tiles that do not exist (sea)
}


def tile_url(source, z, x, y):
    return source["url"].format(z=z, x=x, y=y)


def offline_style(style, max_zoom):
    """IGN vector style rewritten to load everything from the dongle.

    "{origin}" is replaced by the page's address at runtime (MapLibre needs absolute URLs).
    The raster-dem terrain source is dropped: it is ~270 KB per tile and the map has contour lines.
    """
    dropped = {name for name, src in style["sources"].items() if src["type"] == "raster-dem"}
    for name in dropped:
        del style["sources"][name]
    style.pop("terrain", None)
    style["layers"] = [layer for layer in style["layers"] if layer.get("source") not in dropped]
    for src in style["sources"].values():
        if src["type"] == "vector":
            src["tiles"] = ["{origin}/tiles/vector/{z}/{x}/{y}.pbf"]
            src.pop("maxZoom", None)
            src.pop("minZoom", None)
            src["maxzoom"] = max_zoom
    style["glyphs"] = "{origin}/vector/fonts/{fontstack}/{range}.pbf"
    style["sprite"] = "{origin}/vector/sprites/sprite"
    return style


def font_stacks(style):
    """Font stacks (as MapLibre requests them: names joined by commas) used by the style's labels."""
    return sorted({",".join(layer["layout"]["text-font"])
                   for layer in style["layers"] if "text-font" in layer.get("layout", {})})


IGN_VECTOR_STYLE = "https://vt-mapabase.idee.es/files/styles/mapaBase_scn_color1_CNIG.json"
# Basic Latin + Latin-1 (Spanish), Latin Extended-A (Catalan ŀ), general punctuation (– “ ”)
GLYPH_RANGES = ["0-255", "256-511", "8192-8447"]


def _get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ChiwireMaps-tile-downloader/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def prepare_vector(style_url, out_dir, max_zoom=14, glyph_ranges=GLYPH_RANGES):
    """Save an offline copy of the vector style, its icons (sprites) and fonts into out_dir."""
    style = json.loads(_get(style_url))
    sprite_url, glyphs_url = style["sprite"], style["glyphs"]
    for suffix in ("", "@2x"):
        for ext in (".json", ".png"):
            _save(os.path.join(out_dir, "sprites", f"sprite{suffix}{ext}"), _get(sprite_url + suffix + ext))
    for stack in font_stacks(style):
        for glyph_range in glyph_ranges:
            url = glyphs_url.replace("{fontstack}", urllib.parse.quote(stack)).replace("{range}", glyph_range)
            _save(os.path.join(out_dir, "fonts", stack, f"{glyph_range}.pbf"), _get(url))
    text = json.dumps(offline_style(style, max_zoom), ensure_ascii=False, separators=(",", ":")).encode("utf8")
    _save(os.path.join(out_dir, "style.json"), text)
    _save(os.path.join(out_dir, "style.json.gz"), gzip.compress(text, 9))


class AlreadyRunning(Exception):
    def __init__(self, pid):
        super().__init__(pid)
        self.pid = pid


def lock_output(out_dir):
    """Claim out_dir for one download. The OS frees the lock when the process ends, even after a crash.

    Returns the open lock file (keep it open while downloading). Raises AlreadyRunning(pid) if taken.
    shortcut: fcntl is Linux/macOS only; Windows would need msvcrt.locking.
    """
    os.makedirs(out_dir, exist_ok=True)
    f = open(os.path.join(out_dir, ".download.lock"), "a+")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        f.seek(0)
        pid = f.read().strip() or "unknown"
        f.close()
        raise AlreadyRunning(pid)
    f.seek(0)
    f.truncate()
    f.write(str(os.getpid()))
    f.flush()
    return f


class AdaptiveRate:
    """Download speed controller (tiles/s): climbs one step per healthy window, halves on throttling,
    then stays below 90% of the speed that was throttled. Slower server responses pause the climb.
    Throttling means over 1% of a window's requests failed: one broken tile (4 failed attempts)
    among thousands of requests is not the server asking us to slow down.
    Slow answers never lower the speed: during the full download IGN was just as slow at 8.7 tiles/s as at 25."""

    THROTTLE_SHARE = 0.01

    def __init__(self, start, step=1.0, minimum=1.0, maximum=30.0, margin=0.9):
        self.rate, self.step, self.minimum, self.maximum, self.margin = start, step, minimum, maximum, margin
        self.ceiling = None
        self.baseline_latency = None
        self.blocked = False

    def update(self, window):
        ok, throttled, p50 = window["ok"], window["throttled"], window["latency_p50"]
        if window.get("errors", {}).get("network_down"):
            return self.rate  # our own connection dropped: this window says nothing about IGN
        if throttled > self.THROTTLE_SHARE * (ok + throttled):
            if self.rate <= self.minimum and throttled / (ok + throttled) >= 0.5:
                self.blocked = True
            self.ceiling = min(self.ceiling or self.rate, self.rate)
            self.rate = max(self.minimum, self.rate / 2)
        elif ok:
            if self.baseline_latency is None or p50 < self.baseline_latency:
                self.baseline_latency = p50
            if p50 <= 2 * self.baseline_latency:
                limit = self.ceiling * self.margin if self.ceiling else self.maximum
                self.rate = min(self.maximum, limit, self.rate + self.step)
        return self.rate


class WindowStats:
    """Outcomes of the requests in one measuring window. 'ok' and 'missing' (404) mean the server
    answered normally; every other kind (http_503, reset, timeout...) counts as throttling.
    slow_streak: the longest run of answers slower than SLOW_SECONDS (a run may start in the previous window)."""

    HEALTHY = ("ok", "missing")
    SLOW_SECONDS = 0.75

    def __init__(self):
        self.lock = threading.Lock()
        self.slow_run = 0
        self._reset()

    def _reset(self):
        self.counts, self.latencies, self.bytes, self.slow_streak = {}, [], 0, 0

    def record(self, kind, latency, nbytes):
        with self.lock:
            self.counts[kind] = self.counts.get(kind, 0) + 1
            if kind in self.HEALTHY:
                self.latencies.append(latency)
                self.slow_run = self.slow_run + 1 if latency > self.SLOW_SECONDS else 0
                self.slow_streak = max(self.slow_streak, self.slow_run)
            self.bytes += nbytes

    def summary(self, elapsed):
        with self.lock:
            counts, lat, nbytes, slow_streak = self.counts, sorted(self.latencies), self.bytes, self.slow_streak
            self._reset()
        errors = {k: v for k, v in counts.items() if k not in self.HEALTHY}
        return {
            "ok": sum(counts.get(k, 0) for k in self.HEALTHY),
            "throttled": sum(errors.values()),
            "errors": errors,
            "latency_p50": lat[(len(lat) - 1) // 2] if lat else 0.0,
            "latency_p95": lat[max(0, math.ceil(0.95 * len(lat)) - 1)] if lat else 0.0,
            "latency_max": lat[-1] if lat else 0.0,
            "achieved_rate": round(sum(counts.values()) / elapsed, 2),
            "kb_per_s": round(nbytes / elapsed / 1024, 1),
            "slow_streak": slow_streak,
        }


class _RateLimiter:
    """Spaces requests evenly so the IGN servers are not flooded (they reset bursty clients)."""

    def __init__(self, per_second):
        self.interval = 1.0 / per_second
        self.next_time = time.monotonic()
        self.lock = threading.Lock()

    def set_rate(self, per_second):
        with self.lock:
            self.interval = 1.0 / per_second

    def wait(self, stop):
        """Wait for this request's turn; returns early if `stop` (a threading.Event) is set."""
        with self.lock:
            now = time.monotonic()
            delay = self.next_time - now
            self.next_time = max(now, self.next_time) + self.interval
        if delay > 0:
            stop.wait(delay)


class _NotATile(Exception):
    pass


def _error_kind(err):
    """Name for a failed request, used in the metrics: http_503, timeout, reset, connection_error...
    network_down: no DNS answer or no route, i.e. our own connection is gone (Wi-Fi drop, waking from sleep)."""
    if isinstance(err, urllib.error.HTTPError):
        return f"http_{err.code}"
    if isinstance(err, _NotATile):
        return "not_a_tile"
    reason = getattr(err, "reason", err)
    if isinstance(reason, socket.gaierror) or getattr(reason, "errno", None) in (errno.ENETUNREACH, errno.EHOSTUNREACH):
        return "network_down"
    if isinstance(reason, TimeoutError):
        return "timeout"
    if isinstance(reason, ConnectionResetError):
        return "reset"
    return "connection_error"


METRIC_FIELDS = ["time", "target_rate", "achieved_rate", "ok", "throttled", "errors",
                 "latency_p50", "latency_p95", "latency_max", "kb_per_s", "slow_streak"]


def download(jobs, out_dir, sources=SOURCES, workers=4, tiles_per_second=5, retry_delay=2.0, attempts=4,
             progress=None, adaptive=None, window_seconds=60, metrics_path=None):
    """Download {layer: {(z, x, y)}} into out_dir/<layer>/<z>/<x>/<y>.<ext>.

    Resumable: tiles already on disk are skipped. A 404 means IGN has no map there ("missing").
    Server errors and cut connections are retried; tiles are written to a temp file and renamed,
    so an interrupted run never leaves half a tile behind.
    """
    result = {"saved": 0, "skipped": 0, "missing": [], "failed": [], "stopped": None}
    lock = threading.Lock()
    stop = threading.Event()
    finished = threading.Event()
    limiter = _RateLimiter(adaptive.rate if adaptive else tiles_per_second)
    stats = WindowStats()

    def monitor():
        """Every window: summarise requests, let the controller pick the next speed, log a CSV row."""
        last = time.monotonic()
        while not finished.wait(window_seconds):
            now = time.monotonic()
            window = stats.summary(now - last)
            last = now
            if window["ok"] + window["throttled"] == 0:
                continue  # only skipped tiles in this window: nothing measured
            target = adaptive.update(window) if adaptive else tiles_per_second
            limiter.set_rate(target)
            if metrics_path:
                new_file = not os.path.exists(metrics_path)
                with open(metrics_path, "a", newline="") as f:
                    writer = csv.DictWriter(f, METRIC_FIELDS)
                    if new_file:
                        writer.writeheader()
                    writer.writerow(dict(window, time=time.strftime("%Y-%m-%d %H:%M:%S"), target_rate=round(target, 2),
                                         errors=" ".join(f"{k}:{v}" for k, v in sorted(window["errors"].items()))))
            if adaptive and adaptive.blocked:
                result["stopped"] = "possible block"
                stop.set()

    def record(key, value=None):
        with lock:
            if value is None:
                result[key] += 1
            else:
                result[key].append(value)
            if progress:
                progress(result)

    def fetch(layer, z, x, y):
        source = sources[layer]
        path = os.path.join(out_dir, layer, str(z), str(x), f"{y}.{source['ext']}")
        if stop.is_set():
            return
        if os.path.exists(path) and os.path.getsize(path) > 0:
            record("skipped")
            return
        attempt = 0
        while attempt < attempts:
            limiter.wait(stop)
            if stop.is_set():
                return
            started = time.monotonic()
            try:
                request = urllib.request.Request(tile_url(source, z, x, y),
                                                 headers={"User-Agent": "ChiwireMaps-tile-downloader/1.0"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    ctype = response.headers.get("Content-Type", "").split(";")[0].strip()
                    if ctype not in source["content_types"]:
                        raise _NotATile(ctype)
                    body = response.read()
            except urllib.error.HTTPError as err:
                if err.code in source.get("missing_codes", [404]):
                    stats.record("missing", time.monotonic() - started, 0)
                    record("missing", (layer, z, x, y))
                    return
                stats.record(_error_kind(err), time.monotonic() - started, 0)
                if err.code < 500 and err.code != 429:
                    break
            except (_NotATile, OSError, http.client.HTTPException) as err:
                kind = _error_kind(err)
                stats.record(kind, time.monotonic() - started, 0)
                if kind == "network_down":  # wait for our connection; the tile keeps its attempts
                    stop.wait(retry_delay)
                    continue
            else:
                stats.record("ok", time.monotonic() - started, len(body))
                os.makedirs(os.path.dirname(path), exist_ok=True)
                tmp = path + ".part"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, path)
                record("saved")
                return
            attempt += 1
            stop.wait(retry_delay * attempt)
        record("failed", (layer, z, x, y))

    # Only a few tiles are queued at a time: memory stays small and Ctrl+C has little to cancel
    pending = set()
    threading.Thread(target=monitor, daemon=True).start()
    try:
        with ThreadPoolExecutor(workers) as pool:
            # stop must be set inside the `with`: leaving it waits for every queued tile
            try:
                for layer, tiles in jobs.items():
                    for z, x, y in sorted(tiles):
                        if stop.is_set():
                            break
                        if len(pending) >= workers * 4:
                            _, pending = wait(pending, return_when=FIRST_COMPLETED)
                        pending.add(pool.submit(fetch, layer, z, x, y))
                wait(pending)
            except KeyboardInterrupt:
                stop.set()  # queued tiles return at once; tiles in flight finish (a few at most)
                raise
    finally:
        finished.set()
    for key in ("missing", "failed"):
        result[key].sort()
    return result


def load_areas():
    with open(os.path.join(AREAS_DIR, "areas.json"), encoding="utf8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def lonlat_to_tile(lat, lon, z):
    """Slippy-map (Web Mercator) tile containing the point."""
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    rad = math.radians(lat)
    y = int((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n)
    return x, y


def tile_lat(y, z):
    """Latitude of the top edge of tile row y."""
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


def _lon_spans_in_band(ring, south, north):
    """Longitude intervals where the polygon overlaps the latitude band [south, north].

    Union of: the edges clipped to the band (boundary) and the inside intervals on scan lines at the
    band edges and at every vertex latitude in the band (interior). Together they give the exact span.
    """
    spans = []
    edges = list(zip(ring, ring[1:] + ring[:1]))
    scan_lats = {south, north} | {lat for _, lat in ring if south <= lat <= north}
    for (lon1, lat1), (lon2, lat2) in edges:
        lo, hi = max(min(lat1, lat2), south), min(max(lat1, lat2), north)
        if lo > hi:
            continue
        if lat1 == lat2:
            spans.append((min(lon1, lon2), max(lon1, lon2)))
            continue
        a = lon1 + (lon2 - lon1) * (lo - lat1) / (lat2 - lat1)
        b = lon1 + (lon2 - lon1) * (hi - lat1) / (lat2 - lat1)
        spans.append((min(a, b), max(a, b)))
    for lat in scan_lats:
        crossings = sorted(
            lon1 + (lon2 - lon1) * (lat - lat1) / (lat2 - lat1)
            for (lon1, lat1), (lon2, lat2) in edges
            if (lat1 <= lat < lat2) or (lat2 <= lat < lat1)
        )
        spans.extend(zip(crossings[0::2], crossings[1::2]))
    return spans


def tiles_in_polygon(ring, z, margin_km=0.0, rows=None):
    """Tiles at zoom z that the polygon (list of (lon, lat)) touches, widened by margin_km on every side.

    rows=(first, last) limits the work to those tile rows (used when clipping a small area).
    """
    n = 2 ** z
    lats = [lat for _, lat in ring]
    margin_lat = margin_km / 111.32
    margin_lon = margin_km / (111.32 * math.cos(math.radians(max(abs(min(lats)), abs(max(lats))))))
    _, y_top = lonlat_to_tile(max(lats) + margin_lat, 0, z)
    _, y_bottom = lonlat_to_tile(min(lats) - margin_lat, 0, z)
    if rows:
        y_top, y_bottom = max(y_top, rows[0]), min(y_bottom, rows[1])
    tiles = set()
    for y in range(y_top, y_bottom + 1):
        band = _lon_spans_in_band(ring, tile_lat(y + 1, z) - margin_lat, tile_lat(y, z) + margin_lat)
        for west, east in ((w - margin_lon, e + margin_lon) for w, e in band):
            x_first = math.floor((west + 180) / 360 * n)
            x_last = math.ceil((east + 180) / 360 * n) - 1
            tiles.update((x, y) for x in range(x_first, max(x_first, x_last) + 1))
    return tiles


def area_tiles(name, z, areas=None, rows=None):
    """Tiles of a named area from areas.json; rectangles are clipped to their 'clip' area."""
    areas = areas or load_areas()
    area = areas[name]
    if "polygon" in area:
        with open(os.path.join(AREAS_DIR, area["polygon"]), encoding="utf8") as f:
            ring = [tuple(p) for p in json.load(f)["ring"]]
        return tiles_in_polygon(ring, z, area.get("margin_km", 0), rows)
    west, south, east, north = area["rect"]
    tiles = tiles_in_polygon([(west, south), (east, south), (east, north), (west, north)], z, rows=rows)
    if "clip" in area and tiles:
        ys = [y for _, y in tiles]
        tiles &= area_tiles(area["clip"], z, areas, (min(ys), max(ys)))
    return tiles


def plan_jobs(plan, areas=None):
    """{layer: {(z, x, y), ...}} for a plan: a list of {"layers", "areas", "zooms": [min, max]}."""
    areas = areas or load_areas()
    jobs = {}
    for step in plan:
        zmin, zmax = step["zooms"]
        for z in range(zmin, zmax + 1):
            tiles = set()
            for name in step["areas"]:
                tiles |= area_tiles(name, z, areas)
            for layer in step["layers"]:
                jobs.setdefault(layer, set()).update((z, x, y) for x, y in tiles)
    return jobs


def estimate(jobs, avg_kb, block_kb=4, tiles_per_second=5):
    """Tile count, space on the card (each file rounded up to whole blocks) and download time."""
    result = {}
    for layer, tiles in jobs.items():
        per_tile = math.ceil(avg_kb[layer] / block_kb) * block_kb
        result[layer] = {"tiles": len(tiles), "disk_kb": len(tiles) * per_tile}
    total_tiles = sum(r["tiles"] for r in result.values())
    result["total"] = {
        "tiles": total_tiles,
        "disk_kb": sum(r["disk_kb"] for r in result.values()),
        "seconds": math.ceil(total_tiles / tiles_per_second),
    }
    return result


DEFAULT_PLAN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plan_spain.json")


def load_plan(path):
    """Plan file: {"steps": [...], "avg_kb": {...}, optional "areas" and "sources" overrides}."""
    with open(path, encoding="utf8") as f:
        plan = json.load(f)
    areas = load_areas()
    areas.update(plan.get("areas", {}))
    sources = dict(SOURCES, **plan.get("sources", {}))
    return plan, areas, sources


def read_failed(path):
    """failed.txt ("layer z x y" per line, duplicates allowed) as download jobs."""
    jobs = {}
    if os.path.exists(path):
        with open(path, encoding="utf8") as f:
            for line in f:
                if line.strip():
                    layer, z, x, y = line.split()
                    jobs.setdefault(layer, set()).add((int(z), int(x), int(y)))
    return jobs


def _size(kb):
    if kb < 1024:
        return f"{kb:.0f} KB"
    if kb < 1024 ** 2:
        return f"{kb / 1024:.1f} MB"
    return f"{kb / 1024 ** 2:.1f} GB"


def _print_estimate(est, rate):
    for layer, row in est.items():
        if layer != "total":
            print(f"{layer:8} {row['tiles']} tiles  {_size(row['disk_kb'])}")
    total = est["total"]
    print(f"{'total':8} {total['tiles']} tiles  {_size(total['disk_kb'])}  "
          f"~{total['seconds'] / 3600:.1f} h at {rate} tiles/s")


def progress_line(result, total, fetch_seconds):
    """Progress with a speed based only on tiles fetched from the server (skipped ones cost nothing)."""
    fetched = result["saved"] + len(result["missing"]) + len(result["failed"])
    done = fetched + result["skipped"]
    rate = fetched / fetch_seconds if fetch_seconds > 0 else 0
    left = f"~{(total - done) / rate / 3600:.1f} h left" if rate else "estimating"
    return f"{done}/{total} tiles, {rate:.1f}/s, {left}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("estimate", "download", "retry"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--plan", default=DEFAULT_PLAN)
        cmd.add_argument("--rate", type=float, default=5, help="tiles per second (be polite to IGN)")
        cmd.add_argument("--block-kb", type=int, default=4, help="SD card block (cluster) size")
    sub.choices["retry"].description = "Download again only the tiles listed in <out>/failed.txt."
    for download_cmd in (sub.choices["download"], sub.choices["retry"]):
        download_cmd.add_argument("--out", required=True, help="folder that becomes /tiles on the SD card")
        download_cmd.add_argument("--workers", type=int, default=16)
        download_cmd.add_argument("--adaptive", action="store_true",
                                  help="start at --rate, climb while IGN answers normally, back off when it throttles")
        download_cmd.add_argument("--max-rate", type=float, default=30, help="adaptive: never go above this")
        download_cmd.add_argument("--min-rate", type=float, default=1, help="adaptive: never go below this")
        download_cmd.add_argument("--window", type=float, default=120, help="adaptive: seconds per measuring window")
        download_cmd.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    vector_cmd = sub.add_parser("vector")
    vector_cmd.add_argument("--out", required=True, help="folder that becomes /vector on the SD card")
    args = parser.parse_args(argv)

    if args.command == "vector":
        prepare_vector(IGN_VECTOR_STYLE, args.out)
        print(f"Vector style, icons and fonts saved to {args.out}")
        return 0

    plan, areas, sources = load_plan(args.plan)
    failed_path = os.path.join(args.out, "failed.txt") if args.command != "estimate" else None
    jobs = read_failed(failed_path) if args.command == "retry" else plan_jobs(plan["steps"], areas)
    est = estimate(jobs, plan["avg_kb"], args.block_kb, args.rate)
    _print_estimate(est, args.rate)
    if args.command == "estimate":
        return 0

    try:
        lock = lock_output(args.out)
    except AlreadyRunning as running:
        print(f"A download into {args.out} is already running (PID {running.pid}). "
              f"Wait for it to finish, or stop it with: kill {running.pid}")
        return 2
    if not args.yes and input("Download now? (yes/no): ").strip().lower() != "yes":
        print("Cancelled.")
        return 1
    total = est["total"]["tiles"]

    fetch_start = None
    failed_logged = 0

    def progress(result):
        nonlocal fetch_start, failed_logged
        for layer, z, x, y in result["failed"][failed_logged:]:
            print(f"\nfailed: {layer} {z} {x} {y} ({time.strftime('%H:%M:%S')})", file=sys.stderr, flush=True)
            with open(failed_path, "a", encoding="utf8") as f:  # kept even if this run is stopped
                f.write(f"{layer} {z} {x} {y}\n")
        failed_logged = len(result["failed"])
        fetched = result["saved"] + len(result["missing"]) + len(result["failed"])
        if fetched and fetch_start is None:
            fetch_start = time.monotonic()
        done = fetched + result["skipped"]
        if done % 500 == 0 or done == total:
            seconds = time.monotonic() - fetch_start if fetch_start else 0
            print("\r" + progress_line(result, total, seconds), end="", file=sys.stderr, flush=True)

    try:
        adaptive = AdaptiveRate(args.rate, 1, args.min_rate, args.max_rate) if args.adaptive else None
        result = download(jobs, args.out, sources, args.workers, args.rate, progress=progress,
                          adaptive=adaptive, window_seconds=args.window,
                          metrics_path=os.path.join(args.out, "download_metrics.csv"))
    except KeyboardInterrupt:
        print("\nStopped. Run the same command again to continue where it left off.", file=sys.stderr)
        return 130
    finally:
        lock.close()
    print(file=sys.stderr)
    print(f"saved {result['saved']}, skipped {result['skipped']} (already there), "
          f"missing {len(result['missing'])} (no map there), failed {len(result['failed'])}")
    if result["stopped"] == "possible block":
        print("Stopped: IGN may be blocking this connection (most requests fail even at the lowest speed). "
              "Wait a few hours, then run the same command again with a lower --rate.")
        return 3
    if args.command == "retry":  # the list now holds only the tiles that failed again
        with open(failed_path, "w", encoding="utf8") as f:
            f.writelines(f"{layer} {z} {x} {y}\n" for layer, z, x, y in result["failed"])
    if result["failed"]:
        print(f"Failed tiles listed in {failed_path}. Retry them later with the `retry` command.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
