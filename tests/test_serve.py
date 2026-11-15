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


def test_version_endpoint_reports_version_file():
    server = serve.bind("127.0.0.1", 0)
    try:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        info = json.loads(urllib.request.urlopen(f"{base}/version.json").read())
        assert info == {"app": "SpellDirector", "version": (ROOT / "VERSION").read_text().strip()}
        assert serve.is_viewer(base)
    finally:
        server.shutdown()
        server.server_close()


def test_instance_lock_is_exclusive_and_freed(tmp_path):
    first = serve.InstanceLock(tmp_path)
    second = serve.InstanceLock(tmp_path)
    assert first.acquire()
    try:
        assert not second.acquire()
        first.publish("http://127.0.0.1:1/")
        assert second.running_url() == "http://127.0.0.1:1/"
    finally:
        first.release()
    assert second.running_url() is None
    assert second.acquire()
    second.release()


def test_second_launch_opens_running_viewer_and_exits(tmp_path, monkeypatch):
    monkeypatch.setenv("SPELLDIRECTOR_INSTANCE_DIR", str(tmp_path))
    opened = []
    monkeypatch.setattr(serve.webbrowser, "open", opened.append)
    first = threading.Thread(target=serve.main, args=(["--port", "0"],), daemon=True)
    lock = serve.InstanceLock(tmp_path)
    first.start()
    url = serve.find_running(lock, wait=10)
    assert url and url.startswith("http://localhost:")
    # A second launch must not start a server: it opens the running one and returns.
    monkeypatch.setattr(serve, "run", lambda *a: (_ for _ in ()).throw(AssertionError("second server")))
    assert serve.main(["--open"]) == 0
    assert opened == [url]


def test_new_instance_flag_skips_the_lock(tmp_path, monkeypatch):
    monkeypatch.setenv("SPELLDIRECTOR_INSTANCE_DIR", str(tmp_path))
    held = serve.InstanceLock(tmp_path)
    assert held.acquire()
    ran = []
    monkeypatch.setattr(serve, "run", lambda args, lock: ran.append(lock) or 0)
    try:
        assert serve.main(["--new-instance"]) == 0
        assert ran == [None]
    finally:
        held.release()
