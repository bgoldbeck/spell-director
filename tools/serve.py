"""Serve the SpellDirector viewer locally.

    python tools/serve.py            # http://localhost:8000
    python tools/serve.py --port 9000 --host 0.0.0.0

Serves web/ at / and the repo's templates/ at /templates/. The template
index is rebuilt on every request, so new template files show up on reload.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from build_index import build  # noqa: E402


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


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args(argv)
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT / "web")))
    print(f"SpellDirector viewer: http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
