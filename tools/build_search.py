"""Build the offline search data for the map (streets, house numbers, places and points of interest).

Reads an OpenStreetMap extract of Spain (https://download.geofabrik.de/europe/spain.html, ODbL) and writes
small gzip JSON files that the phone loads from the SD card (/search/...). The dongle only serves files;
all searching happens in the phone's browser (sdCard/search.js).

    tools/.venv/bin/python tools/build_search.py tools/data/spain-latest.osm.pbf sdCard/search

Output:
  manifest.json.gz         list of name shards, attribution
  n/<prefix>.json.gz       [name, kind, place, lat*1e5, lon*1e5, street id or -1] per search word prefix
  g/<block>.json.gz        street lines and house numbers, BLOCK streets per file
  poi/<z>_<x>_<y>.json.gz  [kind, name, lat*1e5, lon*1e5] per zoom-10 map tile, for drawing points of interest
"""
import gzip
import json
import math
import os
import re
import sys
import time
import unicodedata

import osmium

BLOCK = 256           # streets per geometry file
SHARD_LIMIT = 1500    # names per search file before it is split into longer prefixes (~20 KB gzip)
POI_ZOOM = 10
SIMPLIFY_M = 2.0      # street lines are simplified to within 2 m
ATTRIBUTION = "Search data © OpenStreetMap contributors (ODbL 1.0, openstreetmap.org/copyright)"

# Words that say what kind of street or place it is, articles and saint prefixes: not searched on their own
STOP = set("""calle c cl avenida avda av plaza placa pl paseo pg passeig camino cami carretera ctra travesia
ronda glorieta rua carrer via ruta senda sendero cuesta calleja callejon pasaje urbanizacion urb barrio
kalea bidea etorbidea enparantza de del la las el los l d y i e a en o san santa santo sant nuestra senora""".split())

PATH_TYPES = {"path", "footway", "track", "bridleway", "cycleway", "steps"}
TOWN_TYPES = {"city", "town", "village", "hamlet"}
PLACE_TYPES = TOWN_TYPES | {"suburb", "quarter", "neighbourhood", "locality"}
MILITARY = {"barracks", "base", "airfield", "naval_base", "range", "training_area", "office", "checkpoint", "danger_area"}


def normalize(text):
    """Lowercase, accents and punctuation removed: 'Plaça de Catalunya' -> 'placa de catalunya'."""
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def search_words(name):
    """The words a name is found by: not street types or articles, 3+ letters (falls back if none are left)."""
    words = normalize(name).split()
    useful = [w for w in words if w not in STOP]
    return [w for w in useful if len(w) >= 3] or useful or words


def in_peninsula(lat, lon):
    """Peninsular Spain only: Balearics, Canaries, Ceuta and Melilla are left out (no maps there)."""
    return 35.95 <= lat <= 44.0 and -9.6 <= lon <= 3.5 and not (lon > 1.1 and lat < 40.2)


def classify(tags):
    """(kind, default name) for a point of interest or place, or None."""
    get = tags.get
    if get("place") in PLACE_TYPES:
        return "place", None
    if get("railway") == "subway_entrance":
        return "metro_entrance", "Metro entrance"
    if get("railway") == "station":
        return ("metro_station", "Metro station") if get("station") == "subway" or get("subway") == "yes" else ("station", "Station")
    if get("military") == "bunker":
        return "bunker", "Bunker"
    if get("amenity") == "police":
        return "police", "Police"
    if get("landuse") == "military" or get("military") in MILITARY:
        return "military", "Military area"
    if get("natural") == "peak":
        return "peak", None
    if get("amenity") == "drinking_water":
        return "water", "Drinking water"
    if get("natural") == "spring":
        return "water", "Spring"
    if get("tourism") in ("alpine_hut", "wilderness_hut") or (get("amenity") == "shelter" and get("shelter_type") != "public_transport"):
        return "shelter", "Shelter"
    if get("amenity") == "hospital":
        return "hospital", "Hospital"
    if get("amenity") == "fire_station" or get("emergency") == "ambulance_station":
        return "emergency", "Emergency services"
    return None


def metres(lat0):
    """Metres per degree of latitude and longitude near lat0 (good enough for a few km)."""
    return 111320.0, 111320.0 * math.cos(math.radians(lat0))


def simplify(points, tolerance=SIMPLIFY_M):
    """Douglas-Peucker on (lat, lon) points, tolerance in metres."""
    if len(points) < 3:
        return points
    my, mx = metres(points[0][0])
    xy = [((lon - points[0][1]) * mx, (lat - points[0][0]) * my) for lat, lon in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy) or 1e-9
        worst, at = 0.0, None
        for i in range(a + 1, b):
            d = abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / length
            if d > worst:
                worst, at = d, i
        if at is not None and worst > tolerance:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]


def segment_distance(p, a, b):
    """Metres from point p to segment a-b (all (lat, lon))."""
    my, mx = metres(p[0])
    ax, ay = (a[1] - p[1]) * mx, (a[0] - p[0]) * my
    bx, by = (b[1] - p[1]) * mx, (b[0] - p[0]) * my
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx, ay + t * dy)


class Grid:
    """Buckets things by cells of `size` degrees, to find what is near a point."""

    def __init__(self, size):
        self.size, self.cells = size, {}

    def key(self, lat, lon):
        return int(math.floor(lat / self.size)), int(math.floor(lon / self.size))

    def add(self, lat, lon, item, extra=()):
        self.cells.setdefault(self.key(lat, lon) + tuple(extra), []).append(item)

    def near(self, lat, lon, extra=()):
        cy, cx = self.key(lat, lon)
        for y in (cy - 1, cy, cy + 1):
            for x in (cx - 1, cx, cx + 1):
                yield from self.cells.get((y, x) + tuple(extra), ())


def rounded(lat, lon):
    return round(lat, 5), round(lon, 5)


def build_index(osm_path, log=None):
    """Reads the OSM file once. Returns {'entries': [...], 'streets': {id: {'lines', 'numbers'}}}."""
    entries, towns, addresses = [], Grid(0.1), []
    streets, street_ids, street_cells = {}, {}, Grid(0.01)
    started, count = time.time(), 0

    def nearest_town(lat, lon):
        best, name = None, ""
        for t_lat, t_lon, t_name in towns.near(lat, lon):
            my, mx = metres(lat)
            d = math.hypot((t_lat - lat) * my, (t_lon - lon) * mx)
            if best is None or d < best:
                best, name = d, t_name
        return name

    def add_poi(tags, lat, lon):
        found = classify(tags)
        if not found or not in_peninsula(lat, lon):
            return
        kind, default = found
        name = tags.get("name")
        if kind == "peak" and name and tags.get("ele"):
            ele = re.match(r"\d+", tags.get("ele"))
            name = f"{name} ({ele.group(0)} m)" if ele else name
        if kind in ("place", "peak") and not name:
            return
        lat, lon = rounded(lat, lon)
        if kind == "place" and tags.get("place") in TOWN_TYPES:
            towns.add(lat, lon, (lat, lon, name))
        entries.append({"name": name or default, "kind": kind, "named": bool(name),
                        "place": "" if kind == "place" else None, "lat": lat, "lon": lon, "ref": -1})

    def add_address(tags, lat, lon):
        if tags.get("addr:housenumber") and tags.get("addr:street") and in_peninsula(lat, lon):
            addresses.append((normalize(tags["addr:street"]), tags["addr:housenumber"]) + rounded(lat, lon))

    keys = ("highway", "place", "addr:housenumber", "railway", "military", "amenity", "natural", "tourism",
            "landuse", "emergency")
    processor = osmium.FileProcessor(osm_path).with_locations().with_areas().with_filter(osmium.filter.KeyFilter(*keys))
    for obj in processor:
        count += 1
        if log and count % 1_000_000 == 0:
            log(f"{count:,} objects, {len(entries):,} entries, {len(streets):,} streets, {time.time() - started:.0f} s")
        tags = obj.tags
        if obj.is_node():
            add_poi(tags, obj.location.lat, obj.location.lon)
            add_address(tags, obj.location.lat, obj.location.lon)
        elif obj.is_way():
            name = tags.get("name")
            if not tags.get("highway") or not name:
                continue
            try:
                points = [rounded(n.lat, n.lon) for n in obj.nodes]
            except osmium.InvalidLocationError:
                continue  # crosses the edge of the extract
            mid = points[len(points) // 2]
            if len(points) < 2 or not in_peninsula(*mid):
                continue
            kind = "path" if tags.get("highway") in PATH_TYPES else "street"
            town = nearest_town(*mid)
            key = (normalize(name), town, kind)
            if key not in street_ids:
                street_ids[key] = len(streets)
                streets[len(streets)] = {"lines": [], "numbers": []}
                entries.append({"name": name, "kind": kind, "named": True, "place": town,
                                "lat": mid[0], "lon": mid[1], "ref": street_ids[key]})
            sid = street_ids[key]
            line = simplify(points)
            streets[sid]["lines"].append(line)
            for a, b in zip(line, line[1:]):  # every 0.01° cell the line passes through
                steps = max(1, int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / 0.005))
                for s in range(steps + 1):
                    lat, lon = a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps
                    street_cells.add(lat, lon, sid, extra=(key[0],))
        elif obj.is_area():
            try:
                ring = [(n.lat, n.lon) for n in next(iter(obj.outer_rings()))][:-1]
            except (osmium.InvalidLocationError, StopIteration):
                continue
            if not ring:
                continue
            lat, lon = sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
            add_poi(tags, lat, lon)
            add_address(tags, lat, lon)

    # House numbers: to the nearest street with that name (within ~1 km)
    for name, number, lat, lon in addresses:
        best, best_sid = None, None
        for sid in set(street_cells.near(lat, lon, extra=(name,))):
            for line in streets[sid]["lines"]:
                for a, b in zip(line, line[1:]) if len(line) > 1 else [(line[0], line[0])]:
                    d = segment_distance((lat, lon), a, b)
                    if best is None or d < best:
                        best, best_sid = d, sid
        if best_sid is not None and best < 1000:
            streets[best_sid]["numbers"].append((number, lat, lon))
    for e in entries:
        if e["place"] is None:
            e["place"] = nearest_town(e["lat"], e["lon"])
    if log:
        log(f"done: {len(entries):,} entries, {len(streets):,} streets, {len(addresses):,} house numbers, "
            f"{time.time() - started:.0f} s")
    return {"entries": entries, "streets": streets}


def shard_keys(words_entries, limit, length=3):
    """Groups (word, entry index) pairs by word prefix; crowded groups get a longer prefix.
    A word shorter than the prefix gets its own key ending in '$'."""
    groups = {}
    for word, i in words_entries:
        key = word[:length] if len(word) >= length else word + "$"
        groups.setdefault(key, set()).add((word, i))
    out = {}
    for key, members in groups.items():
        if len({i for _, i in members}) > limit and not key.endswith("$"):
            out.update(shard_keys(members, limit, length + 1))
        else:
            out[key] = sorted({i for _, i in members})
    return out


def write_gz(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf8", compresslevel=9) as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def e5(v):
    return int(round(v * 1e5))


def write_output(index, out_dir, shard_limit=SHARD_LIMIT):
    entries = index["entries"]
    pairs = [(w, i) for i, e in enumerate(entries) if e["named"] for w in search_words(e["name"])]
    shards = shard_keys(pairs, shard_limit)
    for key, members in shards.items():
        write_gz(os.path.join(out_dir, "n", key + ".json.gz"),
                 [[entries[i]["name"], entries[i]["kind"], entries[i]["place"],
                   e5(entries[i]["lat"]), e5(entries[i]["lon"]), entries[i]["ref"]] for i in members])
    blocks = {}
    for sid, street in index["streets"].items():
        blocks.setdefault(sid // BLOCK, {})[str(sid)] = {
            "lines": [[v for lat, lon in line for v in (e5(lat), e5(lon))] for line in street["lines"]],
            "numbers": [[n, e5(lat), e5(lon)] for n, lat, lon in street["numbers"]],
        }
    for block, data in blocks.items():
        write_gz(os.path.join(out_dir, "g", f"{block}.json.gz"), data)
    tiles = {}
    n = 2 ** POI_ZOOM
    for e in entries:
        if e["kind"] in ("street", "path", "place"):
            continue
        x = int((e["lon"] + 180) / 360 * n)
        y = int((1 - math.asinh(math.tan(math.radians(e["lat"]))) / math.pi) / 2 * n)
        tiles.setdefault((x, y), []).append([e["kind"], e["name"], e5(e["lat"]), e5(e["lon"])])
    for (x, y), rows in tiles.items():
        write_gz(os.path.join(out_dir, "poi", f"{POI_ZOOM}_{x}_{y}.json.gz"), rows)
    write_gz(os.path.join(out_dir, "manifest.json.gz"), {"version": 1, "attribution": ATTRIBUTION, "block": BLOCK,
                                                         "poiZoom": POI_ZOOM, "shards": sorted(shards)})
    return {"shards": len(shards), "blocks": len(blocks), "poi_tiles": len(tiles)}


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        print(__doc__)
        return 2
    osm_path, out_dir = argv
    index = build_index(osm_path, log=lambda m: print(m, flush=True))
    stats = write_output(index, out_dir)
    print(f"written to {out_dir}: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
