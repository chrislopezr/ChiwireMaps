"""Test helper. Fake dongle: mirrors the firmware's routes (routes.h) so the SD-card web app can be tested on a PC."""
import http.server, json, os, re, sys, tempfile
from email.parser import BytesParser
from email.policy import HTTP
from urllib.parse import parse_qs, quote, unquote, urlparse
REPO, PORT = sys.argv[1], int(sys.argv[2])
SD = os.path.join(REPO, "sdCard")
TILES = sys.argv[3] if len(sys.argv) > 3 else os.path.join(SD, "tiles")
def rawliteral(name):
    return re.search(r'R"rawliteral\((.*)\)rawliteral"', open(os.path.join(REPO, "firmware/include", name), encoding="utf8").read(), re.S).group(1)
INDEX, FILES = rawliteral("index.h"), rawliteral("files.h")
# A fresh, empty /serve for each fake dongle, with a small card: 10 MB free of 59.5 GB
SERVE = tempfile.mkdtemp(prefix="bb-serve-")
STORAGE = {"total": int(59.5 * 1024 ** 3), "free": 10 * 1024 ** 2}
MARGIN = 1024 ** 2  # kept free, like the firmware
UPLOADS = []
SEARCH = os.environ.get("BB_SEARCH_DIR", "")  # built search data for tests; none by default
FAT_FORBIDDEN = set('\\/:*?"<>|')

def human(n):  # mirrors humanSize() in pathutil.h
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n} B" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024

def clean(path):  # mirrors cleanServePath(): None if it leaves /serve
    path = path.replace("\\", "/").strip("/")
    return None if "/../" in f"/{path}/" else path

def html_escape(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def entry(href, label):
    return f'<div class="file"><a href="{href}">{label}</a></div>'
STATIC = ["/leaflet.js", "/leaflet.css", "/error.png", "/favicon.ico", "/icon-192.png", "/wmm.js", "/geo.js", "/marks.js", "/search.js", "/nav.js"]
TYPES = {".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
         ".jpg": "image/jpeg", ".pbf": "application/x-protobuf", ".ico": "image/x-icon"}
class H(http.server.BaseHTTPRequestHandler):
    def send(self, code, ctype, body, extra=()):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        for k, v in extra: self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)
    def file(self, path, gz_ok=True):
        if gz_ok and os.path.isfile(path + ".gz"):
            self.send(200, TYPES.get(os.path.splitext(path)[1], "application/octet-stream"), open(path + ".gz", "rb").read(), [("Content-Encoding", "gzip")])
            return True
        if os.path.isfile(path):
            self.send(200, TYPES.get(os.path.splitext(path)[1], "application/octet-stream"), open(path, "rb").read())
            return True
        return None
    def do_GET(self):
        url = urlparse(self.path)
        p, q = unquote(url.path), {k: v[0] for k, v in parse_qs(url.query).items()}
        if p == "/": return self.send(200, "text/html", INDEX.encode())
        if p == "/ping": return self.send(200, "text/plain", b"pong")
        if p == "/storage":
            body = dict(STORAGE, used=STORAGE["total"] - STORAGE["free"], maxUpload=max(0, STORAGE["free"] - MARGIN))
            return self.send(200, "application/json", json.dumps(body).encode())
        if p == "/__test/uploads": return self.send(200, "application/json", json.dumps(UPLOADS).encode())
        if p == "/files":
            d = clean(q.get("dir", ""))
            if d is None: return self.send(400, "text/plain", b"Invalid folder")
            html = f'<div class="path">/serve/{html_escape(d)}</div>'
            if d: html += entry("/files?dir=" + quote(d.rpartition("/")[0]), "&#11014;&#65039; Up")
            folder = os.path.join(SERVE, d)
            if not os.path.isdir(folder):
                html += '<div class="file">Failed to open directory</div>'
            else:
                names = sorted(n for n in os.listdir(folder) if not n.startswith("."))
                for n in names:
                    if os.path.isdir(os.path.join(folder, n)):
                        html += entry("/files?dir=" + quote(f"{d}/{n}".strip("/")), "&#128193; " + html_escape(n))
                for n in names:
                    if os.path.isfile(os.path.join(folder, n)):
                        size = os.path.getsize(os.path.join(folder, n))
                        html += entry("/download?file=" + quote(f"{d}/{n}".strip("/")), f"{html_escape(n)} ({human(size)})")
            return self.send(200, "text/html", FILES.replace("<!-- FILES_PLACEHOLDER -->", html).encode())
        if p == "/location":
            return self.send(200, "application/json", json.dumps({"fix": True, "latitude": 40.4168, "longitude": -3.7038, "altitude": 657, "satellites": 9, "hdop": 1.1, "speed_kmh": 3.2, "course": 245, "last_update": 1, "time": 0}).encode())
        if p.startswith("/tiles/"):
            if self.file(os.path.join(TILES, p[len("/tiles/"):]), False) is None: self.send(404, "text/plain", b"File Not Found")
            return
        if p.startswith("/search/"):
            if not SEARCH or self.file(os.path.join(SEARCH, p[len("/search/"):])) is None: self.send(404, "text/plain", b"not found")
            return
        if p in STATIC or p.startswith("/lib/") or p.startswith("/vector/"):
            if self.file(SD + p) is None: self.send(404, "text/plain", b"not found")
            return
        self.send(302, "text/plain", b"", [("Location", "/")])  # firmware notFound() redirects
    def do_POST(self):  # mirrors /upload in routes.h
        url = urlparse(self.path)
        p, q = unquote(url.path), {k: v[0] for k, v in parse_qs(url.query).items()}
        if p != "/upload": return self.send(404, "text/plain", b"not found")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        if length > STORAGE["free"] - MARGIN:
            return self.send(507, "text/plain", "Not enough space on the card.".encode())
        d = clean(q.get("dir", ""))
        if d is None: return self.send(400, "text/plain", b"Invalid folder")
        msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + self.headers["Content-Type"].encode() + b"\r\n\r\n" + body)
        part = next(pt for pt in msg.iter_parts() if pt.get_filename())
        name = part.get_filename()
        if not name or name in (".", "..") or set(name) & FAT_FORBIDDEN:
            return self.send(400, "text/plain", b"Invalid file name")
        data = part.get_payload(decode=True)
        folder = os.path.join(SERVE, d)
        os.makedirs(folder, exist_ok=True)
        target = os.path.join(folder, name)
        if os.path.exists(target):
            return self.send(409, "text/plain", f"{name} already exists in this folder. Rename it, or delete the old one first.".encode())
        with open(target, "wb") as f:
            f.write(data)
        STORAGE["free"] -= len(data)
        UPLOADS.append(f"{d}/{name}".strip("/"))
        self.send(200, "text/plain", b"OK")
    def log_message(self, fmt, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
