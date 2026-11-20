"""Serve the SpellDirector viewer locally.

    python tools/serve.py                  # http://127.0.0.1:47811
    python tools/serve.py --open           # also open the browser
    python tools/serve.py --port 50123 --host 0.0.0.0

The port can also be set with the SPELLDIRECTOR_PORT environment variable.
If the port is busy, the next free one is used.
Only the Python standard library is needed.

Only one viewer runs at a time. A second launch finds the running one (through
an OS file lock plus a note of its URL in the temp folder), opens the browser
on it and exits, so double-clicking run.bat or the exe twice never starts a
second server. --new-instance skips that check (used by tests and tools).
--replace (what run.bat and run.sh use) does the opposite: it stops the running
viewer and starts a fresh one in its place, so a launch after an update always
serves the new code. The running viewer is asked to stop through
POST /api/shutdown (header X-SpellDirector: shutdown, localhost only); if it
doesn't, its process is ended by the PID it noted.

GET /version.json returns {"app": "SpellDirector", "version": "<VERSION>"}.

GET /api/setup tells the Help page which AI apps are on this computer and
whether the director is set up in them; POST /api/setup {"clients": [...]}
sets them up (tools/client_setup.py). The POST needs the header
X-SpellDirector: setup and a localhost Host/Origin, so other web pages can't
trigger it. GET /docs/<name>.md serves the director's docs, for AI chats that
can't connect to the director and need the files uploaded instead.

POST /api/analyze?name=<file name>&start=<s>&end=<s> takes a GIF or video as
the raw request body, runs tools/breakdown.py on it (start/end optional) and
answers {"id", "base", "breakdown"}. The breakdown's images and per-frame
JPEGs are served under /analysis/<id>/ from a temp folder; only the newest
few analyses are kept. This needs numpy, Pillow and PyAV (bundled in the exe);
without them the endpoint answers 503 and the rest of the viewer still works.

Serves web/ at / and the templates at /templates/: the repo's templates/,
or in the exe the built-in ones plus the user's library folder (see
tools/app_paths.py). The template index is rebuilt on every request, so new
template files show up on reload.
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# In the packaged exe, bundled files live under sys._MEIPASS.
ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT / "tools"))

import app_paths  # noqa: E402

DEFAULT_PORT = 47811
REPLACED = 3  # exit code when a new launch took over: run.bat closes its window without a pause
APP = "SpellDirector"


def read_version() -> str:
    try:
        return (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "?"


VERSION = read_version()

ANALYZE_SUFFIXES = {".gif", ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}
ANALYZE_MAX_BYTES = 1024 * 1024 * 1024  # 1 GB
ANALYSES_KEPT = 6
_ANALYSIS_ID = re.compile(r"^[0-9a-f]{32}$")
_analyze_lock = threading.Lock()  # one breakdown at a time: they are CPU and memory heavy


# Sprite export jobs for a headless browser (tools/export_sprites.py without
# Playwright): the page GETs its options from /api/export-job/<token> and POSTs
# the files back there.
EXPORT_MAX_BYTES = 1024 * 1024 * 1024
_export_jobs: dict[str, dict] = {}
_export_jobs_lock = threading.Lock()


def add_export_job(opts: dict) -> tuple[str, threading.Event, dict]:
    """Register an export job; returns (token, done event, job). job["result"] or job["error"] is set when done."""
    token = uuid.uuid4().hex
    job = {"opts": opts, "done": threading.Event()}
    with _export_jobs_lock:
        _export_jobs[token] = job
    return token, job["done"], job


def drop_export_job(token: str) -> None:
    with _export_jobs_lock:
        _export_jobs.pop(token, None)


def _export_job(path: str) -> dict | None:
    token = path[len("/api/export-job/"):]
    with _export_jobs_lock:
        return _export_jobs.get(token) if _ANALYSIS_ID.match(token) else None


def analysis_root() -> Path:
    return instance_dir() / "analysis"


class RequestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _seconds(query: dict, key: str) -> float | None:
    raw = (query.get(key) or [""])[0].strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        raise RequestError(400, f"{key} must be a number of seconds") from None
    if value < 0 or value != value or value == float("inf"):
        raise RequestError(400, f"{key} must be zero or more seconds")
    return value


def _prune(root: Path, keep: int) -> None:
    runs = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in runs[keep:]:
        shutil.rmtree(old, ignore_errors=True)


def analyze_upload(name: str, body, length: int, start_s: float | None, end_s: float | None,
                   root: Path | None = None) -> dict:
    """Save an uploaded clip to a fresh temp folder and break it down there."""
    suffix = Path(name).suffix.lower()
    if suffix not in ANALYZE_SUFFIXES:
        raise RequestError(400, "pick a GIF or a video (MP4, WebM, MOV, MKV, AVI)")
    if length <= 0:
        raise RequestError(400, "the file is empty")
    if length > ANALYZE_MAX_BYTES:
        raise RequestError(413, "the file is over 1 GB; trim it first")
    if start_s is not None and end_s is not None and end_s <= start_s:
        raise RequestError(400, "end must be after start")
    try:
        import breakdown as bd  # numpy, Pillow (and PyAV for video): only needed here
    except ImportError as exc:
        raise RequestError(503, f"analysis needs numpy, Pillow and PyAV ({exc.name} is missing): "
                                "python -m pip install -r requirements-dev.txt") from None
    root = root or analysis_root()
    root.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    folder = root / run_id
    folder.mkdir()
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(name).stem).strip(" .") or "clip"
    src = folder / (stem[:80] + suffix)
    remaining = length
    with open(src, "wb") as fh:
        while remaining > 0:
            chunk = body.read(min(remaining, 1 << 20))
            if not chunk:
                break
            fh.write(chunk)
            remaining -= len(chunk)
    if remaining:
        shutil.rmtree(folder, ignore_errors=True)
        raise RequestError(400, "the upload was cut off")
    with _analyze_lock:
        try:
            result = bd.breakdown(src, folder / "out", with_player_frames=True, start_s=start_s or 0.0, end_s=end_s)
        except (OSError, ValueError) as exc:
            shutil.rmtree(folder, ignore_errors=True)
            detail = str(exc).replace(f": '{src}'", "").replace(str(src), src.name)
            raise RequestError(422, f"could not analyze {Path(name).name}: {detail}") from None
        finally:
            try:
                src.unlink()
            except OSError:
                pass
    text = bd.summary(result)
    (folder / "out" / "summary.txt").write_text(text + "\n", encoding="utf-8")
    _prune(root, ANALYSES_KEPT)
    return {"id": run_id, "base": f"analysis/{run_id}/", "summary": text, "breakdown": result}


LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
# Docs an AI chat needs when it can't connect to the director (help.html links them).
SHARED_DOCS = {name: ROOT / "docs" / name
               for name in ("director-playbook.md", "vocabulary.md", "template-format.md", "setup.md")}
SHARED_DOCS["template-schema.json"] = ROOT / "schemas" / "template-0.1.0.schema.json"


def setup_info() -> dict:
    """What the Help page needs to offer one-click setup and fill in its prompts."""
    import client_setup

    entry = client_setup.server_entry()
    return {"version": VERSION, "frozen": app_paths.FROZEN, "command": entry["command"],
            "args": entry["args"], "library": str(app_paths.library_root()),
            "clients": client_setup.status(entry)}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".json": "application/json"}

    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/analysis/"):
            parts = clean[len("/analysis/"):].split("/", 1)
            if len(parts) == 2 and _ANALYSIS_ID.match(parts[0]):
                base = (analysis_root() / parts[0] / "out").resolve()
                target = (base / urllib.parse.unquote(parts[1])).resolve()
                if base in target.parents:
                    return str(target)
            return str(ROOT / "web" / "404")
        if clean.startswith("/docs/"):
            name = urllib.parse.unquote(clean[len("/docs/"):])
            if name in SHARED_DOCS:
                return str(SHARED_DOCS[name])
            return str(ROOT / "web" / "404")
        if clean.startswith("/templates/"):
            # The user's library first (the exe's saved spells), then the built-in templates.
            target = app_paths.find_template_file(urllib.parse.unquote(clean[len("/templates/"):]))
            return str(target) if target else str(ROOT / "web" / "404")
        return super().translate_path(path)

    def send_json(self, data, status: int = 200) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        clean = self.path.split("?", 1)[0]
        if clean.startswith("/api/export-job/"):
            job = _export_job(clean)
            self.send_json({"opts": job["opts"]} if job else {"error": "no such export job"}, 200 if job else 404)
            return
        if clean == "/version.json":
            self.send_json({"app": APP, "version": VERSION})
            return
        if clean == "/api/setup":
            self.send_json(setup_info())
            return
        if clean == "/templates/index.json":
            body = json.dumps(app_paths.template_index()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):  # noqa: N802
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/api/export-job/"):
            self.receive_export(url.path)
            return
        if url.path == "/api/setup":
            self.receive_setup()
            return
        if url.path == "/api/shutdown":
            self.receive_shutdown()
            return
        if url.path != "/api/analyze":
            self.send_json({"error": "not found"}, 404)
            return
        query = urllib.parse.parse_qs(url.query)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            result = analyze_upload((query.get("name") or ["clip"])[0], self.rfile, length,
                                    _seconds(query, "start"), _seconds(query, "end"))
        except RequestError as exc:
            self.close_connection = True  # the body may be unread
            self.send_json({"error": str(exc)}, exc.status)
            return
        except ValueError:
            self.close_connection = True
            self.send_json({"error": "bad Content-Length"}, 400)
            return
        self.send_json(result)

    def local_request(self, purpose: str = "setup") -> bool:
        """Sent by our own page or launcher: the custom header forces a CORS preflight
        that we never answer, and Host/Origin rule out other sites and DNS rebinding."""
        if self.headers.get("X-SpellDirector") != purpose:
            return False
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        if host not in LOCAL_HOSTS:
            return False
        origin = self.headers.get("Origin")
        return origin is None or urllib.parse.urlsplit(origin).hostname in LOCAL_HOSTS

    def receive_setup(self) -> None:
        if not self.local_request():
            self.close_connection = True
            self.send_json({"error": "forbidden"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if 0 <= length <= 10_000 else None
            clients = body.get("clients") if isinstance(body, dict) else None
            if clients is not None and not (isinstance(clients, list) and all(isinstance(c, str) for c in clients)):
                raise ValueError
        except ValueError:
            self.close_connection = True
            self.send_json({"error": "bad setup body"}, 400)
            return
        import client_setup

        results = client_setup.setup(clients)
        self.send_json({"results": results, **setup_info()})

    def receive_shutdown(self) -> None:
        """Stop this viewer so a fresh launch can take its place (serve.py --replace)."""
        if not self.local_request("shutdown"):
            self.close_connection = True
            self.send_json({"error": "forbidden"}, 403)
            return
        self.close_connection = True
        self.send_json({"ok": True, "pid": os.getpid()})
        print("Asked to stop by a new launch. Stopping.", flush=True)
        self.server.replaced = True
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def receive_export(self, path: str) -> None:
        job = _export_job(path)
        if job is None or job["done"].is_set():
            self.close_connection = True
            self.send_json({"error": "no such export job"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= EXPORT_MAX_BYTES:
                raise ValueError
            body = json.loads(self.rfile.read(length))
        except ValueError:
            self.close_connection = True
            self.send_json({"error": "bad export body"}, 400)
            return
        if isinstance(body, dict) and "error" in body:
            job["error"] = str(body["error"])
        else:
            job["result"] = body
        job["done"].set()
        self.send_json({"ok": True})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(ThreadingHTTPServer):
    replaced = False  # set when a new launch asked this viewer to stop

    # On Windows, SO_REUSEADDR lets a second process bind a port that is already
    # in use, so two viewers could share 47811. Ask for exclusive use instead.
    allow_reuse_address = sys.platform != "win32"

    def server_bind(self):
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def bind(host: str, port: int, tries: int = 20, wait: float = 0.0) -> ThreadingHTTPServer:
    """Bind the first free port from port on. wait: keep retrying port itself this many
    seconds first, for a viewer that was just stopped and may not have let go of it yet."""
    handler = partial(Handler, directory=str(ROOT / "web"))
    deadline = time.monotonic() + wait
    for p in range(port, port + tries):
        while True:
            try:
                return Server((host, p), handler)
            except OSError as exc:
                if exc.errno not in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1), 10048):
                    raise
                if p != port or time.monotonic() >= deadline:
                    break
                time.sleep(0.25)
        print(f"port {p} is busy, trying {p + 1}", flush=True)
    raise SystemExit(f"no free port between {port} and {port + tries - 1}")


def instance_dir() -> Path:
    return Path(os.environ.get("SPELLDIRECTOR_INSTANCE_DIR") or Path(tempfile.gettempdir()) / APP)


class InstanceLock:
    """An exclusive OS lock held for the life of the running viewer.

    The OS drops the lock when the process exits, even after a crash, so a
    stale file never blocks the next launch. The URL lives in a separate file
    because Windows byte-range locks also block other processes' reads.
    """

    def __init__(self, folder: Path | None = None):
        self.folder = folder or instance_dir()
        self.lock_path = self.folder / "instance.lock"
        self.url_path = self.folder / "instance.json"
        self.handle = None

    def acquire(self) -> bool:
        self.folder.mkdir(parents=True, exist_ok=True)
        handle = open(self.lock_path, "a+b")
        try:
            if sys.platform == "win32":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def publish(self, url: str) -> None:
        self.url_path.write_text(json.dumps({"url": url, "pid": os.getpid(), "version": VERSION}), encoding="utf-8")

    def running_info(self) -> dict:
        try:
            info = json.loads(self.url_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return info if isinstance(info, dict) else {}

    def running_url(self) -> str | None:
        url = self.running_info().get("url")
        return url if isinstance(url, str) else None

    def release(self) -> None:
        if self.handle is None:
            return
        try:
            self.url_path.unlink()
        except OSError:
            pass
        if sys.platform == "win32":
            import msvcrt
            try:
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
        self.handle.close()
        self.handle = None


def is_viewer(url: str, timeout: float = 1.0) -> bool:
    """True if a SpellDirector viewer answers at url."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # localhost: never via a proxy
    try:
        with opener.open(url.rstrip("/") + "/version.json", timeout=timeout) as resp:
            return json.loads(resp.read()).get("app") == APP
    except (OSError, ValueError, AttributeError):
        return False


def find_running(lock: InstanceLock, wait: float = 5.0) -> str | None:
    """URL of the viewer that holds the lock. Waits a little, since it may still be starting."""
    deadline = time.monotonic() + wait
    while True:
        url = lock.running_url()
        if url and is_viewer(url):
            return url
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.2)


def request_shutdown(url: str, timeout: float = 2.0) -> bool:
    """Ask the viewer at url to stop. True if it agreed."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(url.rstrip("/") + "/api/shutdown", data=b"", method="POST",
                                 headers={"X-SpellDirector": "shutdown"})
    try:
        with opener.open(req, timeout=timeout) as resp:
            return bool(json.loads(resp.read()).get("ok"))
    except (OSError, ValueError, AttributeError):
        return False


def kill_pid(pid: int) -> bool:
    """End a process (TerminateProcess on Windows). True if it was there to end."""
    if not isinstance(pid, int) or pid <= 0 or pid == os.getpid():
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        return True
    except OSError:
        return False


def listening_pid(port: int) -> int | None:
    """PID of the process listening on a local TCP port, or None if it can't be told."""
    try:
        if sys.platform == "win32":
            out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True,
                                 timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 5 and parts[3].upper() == "LISTENING" and parts[1].rsplit(":", 1)[-1] == str(port):
                    return int(parts[4])
            return None
        if shutil.which("lsof") is None:
            return None
        out = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
                             capture_output=True, text=True, timeout=10).stdout.split()
        return int(out[0]) if out else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def stop_viewer(url: str | None, pid: int | None, wait: float = 10.0, gone=None) -> bool:
    """Stop a running viewer: ask it nicely, then end its process. gone() says when it has
    stopped (default: url no longer answers). True once it is gone."""
    gone = gone or (lambda: not (url and is_viewer(url, timeout=0.5)))

    def wait_until(seconds: float) -> bool:
        deadline = time.monotonic() + seconds
        while not gone():
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)
        return True

    if url and request_shutdown(url) and wait_until(wait):
        return True
    if pid and kill_pid(pid) and wait_until(wait):
        return True
    return gone()


def replace_running(lock: InstanceLock, port: int) -> bool:
    """--replace: stop whichever viewer is running and take the lock. False if it won't stop."""
    if not lock.acquire():
        info = lock.running_info()
        url = info.get("url") if isinstance(info.get("url"), str) else None
        pid = info.get("pid") if isinstance(info.get("pid"), int) else None
        print(f"Closing the {APP} that is already running" + (f" ({url})" if url else "") + "...", flush=True)
        if not stop_viewer(url, pid, gone=lock.acquire):
            return False
    # A viewer started without the lock (an old version, or --new-instance) may still hold the port.
    old = f"http://127.0.0.1:{port}/"
    if port and is_viewer(old, timeout=0.5):
        print(f"Closing the {APP} that is using port {port}...", flush=True)
        if not stop_viewer(old, listening_pid(port)):
            print("It did not stop, so the new one will use another port.", flush=True)
    return True


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("SPELLDIRECTOR_PORT", DEFAULT_PORT)))
    ap.add_argument("--open", action="store_true", help="open the viewer in the default browser")
    ap.add_argument("--new-instance", action="store_true",
                    help="start a server even if a viewer is already running")
    ap.add_argument("--replace", action="store_true",
                    help="stop the viewer that is already running and start a fresh one")
    args = ap.parse_args(argv)
    lock = None
    if args.replace and not args.new_instance:
        lock = InstanceLock()
        if not replace_running(lock, args.port):
            print(f"The {APP} that is already running did not stop. Close its window and try again.", flush=True)
            return 1
        args.bind_wait = 5.0
    elif not args.new_instance:
        lock = InstanceLock()
        if not lock.acquire():
            url = find_running(lock)
            if url is None:
                print(f"{APP} is already running, but it did not answer. Close it and try again.", flush=True)
                return 1
            print(f"{APP} is already running: {url}", flush=True)
            print("Opening it in your browser instead of starting a second copy.", flush=True)
            webbrowser.open(url)
            return 0
    try:
        return run(args, lock)
    finally:
        if lock is not None:
            lock.release()


def run(args: argparse.Namespace, lock: InstanceLock | None) -> int:
    server = bind(args.host, args.port, wait=getattr(args, "bind_wait", 0.0))
    port = server.server_address[1]
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = f"http://{shown}:{port}/"
    if lock is not None:
        lock.publish(f"http://127.0.0.1:{port}/" if args.host == "0.0.0.0" else url)
    print(f"SpellDirector {VERSION} viewer: {url}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return REPLACED if getattr(server, "replaced", False) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
