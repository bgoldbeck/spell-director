"""Serve the SpellDirector viewer locally.

    python tools/serve.py                  # http://127.0.0.1:47811
    python tools/serve.py --open           # also open the browser
    python tools/serve.py --port 50123 --host 0.0.0.0

The port can also be set with the SPELLDIRECTOR_PORT environment variable.
If the port is busy, the next free one is used.
Only the Python standard library is needed.

Serves web/ at / and the repo's templates/ at /templates/. The template
index is rebuilt on every request, so new template files show up on reload.
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import sys
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from build_index import build  # noqa: E402

DEFAULT_PORT = 47811


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".json": "application/json"}

    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/templates/"):
            rel = clean[len("/templates/"):]
            target = (ROOT / "templates" / rel).resolve()
            if (ROOT / "templates").resolve() in target.parents:
                return str(target)
            return str(ROOT / "web" / "404")
        return super().translate_path(path)

    def do_GET(self):  # noqa: N802
        if self.path.split("?", 1)[0] == "/templates/index.json":
            body = json.dumps(build()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def bind(host: str, port: int, tries: int = 20) -> ThreadingHTTPServer:
    handler = partial(Handler, directory=str(ROOT / "web"))
    for p in range(port, port + tries):
        try:
            return ThreadingHTTPServer((host, p), handler)
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1), 10048):
                raise
            print(f"port {p} is busy, trying {p + 1}", flush=True)
    raise SystemExit(f"no free port between {port} and {port + tries - 1}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("SPELLDIRECTOR_PORT", DEFAULT_PORT)))
    ap.add_argument("--open", action="store_true", help="open the viewer in the default browser")
    args = ap.parse_args(argv)
    server = bind(args.host, args.port)
    port = server.server_address[1]
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = f"http://{shown}:{port}/"
    print(f"SpellDirector viewer: {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
