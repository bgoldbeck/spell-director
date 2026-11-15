import json
import socket
import sys
import threading
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import serve  # noqa: E402


def test_default_port_is_not_8000():
    assert serve.DEFAULT_PORT == 47811


def test_skips_busy_port_and_serves_viewer():
    blocker = socket.socket()
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    busy = blocker.getsockname()[1]
    server = serve.bind("127.0.0.1", busy)
    try:
        port = server.server_address[1]
        assert port != busy
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{port}"
        html = urllib.request.urlopen(f"{base}/").read().decode()
        assert "SpellDirector" in html
        index = json.loads(urllib.request.urlopen(f"{base}/templates/index.json").read())
        assert "lightning/sky-strike.json" in index["templates"]
        tpl = json.loads(urllib.request.urlopen(f"{base}/templates/lightning/sky-strike.json").read())
        assert tpl["id"] == "lightning-sky-strike"
    finally:
        server.shutdown()
        server.server_close()
        blocker.close()
