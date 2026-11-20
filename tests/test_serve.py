import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
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


def _start_viewer(tmp_path, *flags):
    env = {**os.environ, "SPELLDIRECTOR_INSTANCE_DIR": str(tmp_path), "PYTHONUNBUFFERED": "1"}
    return subprocess.Popen([sys.executable, str(ROOT / "tools" / "serve.py"), "--port", "0", *flags],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def test_replace_stops_the_running_viewer_and_starts_fresh(tmp_path):
    lock = serve.InstanceLock(tmp_path)
    first = _start_viewer(tmp_path)
    second = None
    try:
        old_url = serve.find_running(lock, wait=15)
        assert old_url and serve.is_viewer(old_url)
        second = _start_viewer(tmp_path, "--replace")
        assert first.wait(timeout=15) == serve.REPLACED  # asked to stop, and it did
        assert "Asked to stop" in first.stdout.read()
        new_url = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            info = lock.running_info()
            if info.get("pid") == second.pid and serve.is_viewer(info["url"]):
                new_url = info["url"]
                break
            time.sleep(0.2)
        assert new_url, "the fresh viewer did not start"
        assert not serve.InstanceLock(tmp_path).acquire()  # and it holds the lock: only one runs
    finally:
        for proc in (first, second):
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait()


def test_shutdown_needs_the_launcher_header(tmp_path, monkeypatch):
    server, base = _serve(tmp_path, monkeypatch)
    try:
        status, body = _post(base, "/api/shutdown", b"")
        assert status == 403
        assert serve.is_viewer(base)  # still running
        assert serve.request_shutdown(base)
        deadline = time.monotonic() + 5
        while serve.is_viewer(base, timeout=0.3) and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not serve.is_viewer(base, timeout=0.3)
    finally:
        server.server_close()


def test_stop_viewer_ends_a_process_that_does_not_answer():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        assert serve.stop_viewer(None, proc.pid, wait=10, gone=lambda: proc.poll() is not None)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def test_bind_waits_for_a_port_that_is_being_freed():
    blocker = socket.socket()
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    port = blocker.getsockname()[1]
    threading.Timer(0.5, blocker.close).start()
    server = serve.bind("127.0.0.1", port, wait=5)
    try:
        assert server.server_address[1] == port
    finally:
        server.server_close()


# ---------------------------------------------------------------- analyze


def _post(base, path, data):
    req = urllib.request.Request(base + path, data=data, method="POST",
                                 headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())


def _serve(tmp_path, monkeypatch):
    monkeypatch.setenv("SPELLDIRECTOR_INSTANCE_DIR", str(tmp_path))
    server = serve.bind("127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def test_analyze_endpoint_breaks_down_an_upload_and_serves_its_files(tmp_path, monkeypatch):
    import urllib.parse
    server, base = _serve(tmp_path, monkeypatch)
    try:
        gif = (ROOT / "samples" / "synthetic-sky-strike.gif").read_bytes()
        status, run = _post(base, "/api/analyze?" + urllib.parse.urlencode({"name": "My Spell.gif", "start": "0.1", "end": "1"}), gif)
        assert status == 200, run
        b = run["breakdown"]
        assert b["gif"]["source"] == "My Spell.gif" and b["gif"]["trim"]["start_s"] >= 0.1
        assert run["base"] == f"analysis/{run['id']}/" and "anticipation" in run["summary"]
        frames = b["images"]["player_frames"]
        assert len(frames) == b["gif"]["frame_count"]
        assert urllib.request.urlopen(f"{base}/{run['base']}{frames[0]}").read()[:2] == b"\xff\xd8"  # JPEG
        saved = json.loads(urllib.request.urlopen(f"{base}/{run['base']}breakdown.json").read())
        assert saved["timing"] == b["timing"]
        assert urllib.request.urlopen(f"{base}/{run['base']}summary.txt").read().decode().strip() == run["summary"]
        # The uploaded clip itself is not kept.
        assert not list((tmp_path / "analysis" / run["id"]).glob("*.gif"))
    finally:
        server.shutdown()
        server.server_close()


def test_analyze_endpoint_refuses_bad_input(tmp_path, monkeypatch):
    server, base = _serve(tmp_path, monkeypatch)
    try:
        assert _post(base, "/api/analyze?name=notes.txt", b"hello")[0] == 400
        assert _post(base, "/api/analyze?name=a.gif&start=2&end=1", b"GIF89a")[0] == 400
        assert _post(base, "/api/analyze?name=a.gif&start=abc", b"GIF89a")[0] == 400
        status, err = _post(base, "/api/analyze?name=broken.gif", b"not really a gif")
        assert status == 422 and "broken.gif" in err["error"] and str(tmp_path) not in err["error"]
        assert _post(base, "/api/other", b"x")[0] == 404
        assert not [p for p in (tmp_path / "analysis").iterdir()]  # failed runs are cleaned up
    finally:
        server.shutdown()
        server.server_close()


def test_analysis_files_cannot_escape_their_folder(tmp_path, monkeypatch):
    server, base = _serve(tmp_path, monkeypatch)
    secret = tmp_path / "secret.txt"
    secret.write_text("no")
    run = tmp_path / "analysis" / ("a" * 32) / "out"
    run.mkdir(parents=True)
    (run / "breakdown.json").write_text("{}")
    try:
        assert urllib.request.urlopen(f"{base}/analysis/{'a' * 32}/breakdown.json").read() == b"{}"
        for bad in (f"/analysis/{'a' * 32}/..%2F..%2Fsecret.txt", "/analysis/../secret.txt", "/analysis/xyz/breakdown.json"):
            try:
                urllib.request.urlopen(base + bad)
                raise AssertionError(f"served {bad}")
            except urllib.error.HTTPError as err:
                assert err.code == 404
    finally:
        server.shutdown()
        server.server_close()


def test_only_the_newest_analyses_are_kept(tmp_path):
    import os
    for i in range(serve.ANALYSES_KEPT + 3):
        d = tmp_path / f"{i:032x}"
        d.mkdir()
        os.utime(d, (1000 + i, 1000 + i))
    serve._prune(tmp_path, serve.ANALYSES_KEPT)
    kept = sorted(p.name for p in tmp_path.iterdir())
    assert kept == [f"{i:032x}" for i in range(3, serve.ANALYSES_KEPT + 3)]
