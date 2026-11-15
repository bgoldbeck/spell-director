"""Export a template as sprite sheets (one per layer, every view in each) plus a JSON file and an
assembly guide (Markdown) for rebuilding the spell in a game engine.

    python tools/export_sprites.py lightning-sky-strike
    python tools/export_sprites.py lightning-sky-strike --seed 7 --frame 256 --fps 24
    python tools/export_sprites.py my-spell.json --views front,three_quarter --out exports/test

Writes to exports/<template id>-seed<seed>/ by default: all.png (the whole
spell), layer-<layer id>.png for each drawn layer (columns are frames, rows are
the views front, side, top, 3/4), <id>.spritesheet.json, <id>.guide.md and
<id>.template.json. This is the same export as the viewer's "Export sprites…"
button: it starts the viewer server, opens it in headless Chromium and saves
the files.

Uses Playwright (`pip install -r requirements-export.txt`) and a browser:
`python -m playwright install chromium`, or an installed Chrome or Edge
(used automatically), or a Chromium path in SPELLDIRECTOR_CHROMIUM.
Without Playwright (as in the packaged exe), it runs an installed Edge or
Chrome headless itself, and the page posts the sheets back to the server.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# In the packaged exe, bundled files live under sys._MEIPASS.
ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT / "tools"))

import app_paths  # noqa: E402
import serve  # noqa: E402

VIEWS = ("front", "side", "top", "three_quarter")
EXPORTS = app_paths.library_root() / "exports"


class ExportError(RuntimeError):
    """The export could not run (no Playwright, no browser, page error)."""


def _launch(p):
    errors = []
    path = os.environ.get("SPELLDIRECTOR_CHROMIUM")
    attempts = []
    if path:
        attempts.append({"executable_path": path})
    attempts += [{}, {"channel": "chrome"}, {"channel": "msedge"}]
    if Path("/opt/pw-browsers/chromium").exists():
        attempts.append({"executable_path": "/opt/pw-browsers/chromium"})
    for kw in attempts:
        try:
            return p.chromium.launch(args=["--enable-unsafe-swiftshader"], **kw)
        except Exception as exc:  # noqa: BLE001 - try the next browser
            errors.append(f"{kw or 'bundled chromium'}: {str(exc).splitlines()[0]}")
    raise ExportError("no browser found. Run `python -m playwright install chromium`, install Chrome or Edge, "
                      "or set SPELLDIRECTOR_CHROMIUM.\n" + "\n".join(errors))


def _version() -> str:
    try:
        return (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def export(template: str | dict, *, seed: int = 1, frame: int = 192, fps: int | None = None,
           views: list[str] | None = None, layers: bool = True, out: Path | str | None = None,
           timeout_s: float = 300, bloom: bool = True) -> dict:
    """Export sprite sheets. `template` is a template id, a path to a JSON file, or a dict.

    Returns {"out": folder, "files": [paths], "manifest": {...}}.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sync_playwright = None

    tpl_obj = None
    tpl_id = None
    if isinstance(template, dict):
        tpl_obj = template
    elif str(template).endswith(".json") and Path(template).exists():
        tpl_obj = json.loads(Path(template).read_text(encoding="utf-8"))
    else:
        tpl_id = str(template)
    views = list(views or VIEWS)
    bad = [v for v in views if v not in VIEWS]
    if bad:
        raise ExportError(f"unknown view(s) {', '.join(bad)}; use {', '.join(VIEWS)}")

    serve.Handler.log_message = lambda *a, **k: None  # keep the output clean
    server = serve.bind("127.0.0.1", 0)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opts = {"seed": seed, "frame": frame, "views": views, "layers": layers, "bloom": bloom, "version": _version()}
    if fps:
        opts["fps"] = fps
    if tpl_obj is not None:
        opts["template"] = tpl_obj
    else:
        opts["id"] = tpl_id
    try:
        if sync_playwright is None:
            result = _export_headless(port, opts, timeout_s)
        else:
            result = _export_playwright(sync_playwright, port, opts, timeout_s)
    finally:
        server.shutdown()
        server.server_close()

    manifest = result["manifest"]
    folder = Path(out) if out else EXPORTS / f"{manifest['template']['id']}-seed{manifest['seed']}"
    folder.mkdir(parents=True, exist_ok=True)
    written = []
    for f in result["files"]:
        path = folder / f["name"]
        path.write_bytes(base64.b64decode(f["base64"]))
        written.append(str(path))
    return {"out": str(folder), "files": written, "manifest": manifest}


def _export_playwright(sync_playwright, port: int, opts: dict, timeout_s: float) -> dict:
    with sync_playwright() as p:
        browser = _launch(p)
        try:
            page = browser.new_page()
            page_errors = []
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{port}/?sound=off&t=0")
            page.wait_for_function("window.spellDirector && window.spellDirector.templates.length > 0 "
                                   "&& typeof window.spellDirectorExport === 'function'", timeout=30000)
            if "id" in opts:
                ids = page.evaluate("window.spellDirector.templates.map(t => t.id)")
                if opts["id"] not in ids:
                    raise ExportError(f"no template with id {opts['id']!r}; known: {', '.join(ids)}")
            page.set_default_timeout(timeout_s * 1000)
            try:
                result = page.evaluate("opts => window.spellDirectorExport(opts)", opts)
            except Exception as exc:  # noqa: BLE001
                raise ExportError(f"export failed in the page: {exc}; {' | '.join(page_errors)}") from exc
        finally:
            browser.close()
    return result


def find_browser() -> str | None:
    """An installed Chromium-family browser for headless export: SPELLDIRECTOR_CHROMIUM,
    else Edge or Chrome in their usual places, else one on PATH."""
    env = os.environ.get("SPELLDIRECTOR_CHROMIUM")
    if env:
        return env
    candidates: list[Path] = []
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
            if base:
                candidates += [Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                               Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"]
    elif sys.platform == "darwin":
        candidates += [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                       Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                       Path("/Applications/Chromium.app/Contents/MacOS/Chromium")]
    for c in candidates:
        if c.is_file():
            return str(c)
    for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    if Path("/opt/pw-browsers/chromium").exists():
        return "/opt/pw-browsers/chromium"
    return None


def _export_headless(port: int, opts: dict, timeout_s: float) -> dict:
    """Run the export in a headless Edge or Chrome started directly, with no Playwright."""
    exe = find_browser()
    if exe is None:
        raise ExportError("no browser found for the export. Install Microsoft Edge or Google Chrome, "
                          "or set SPELLDIRECTOR_CHROMIUM to a Chromium-family browser.")
    token, done, job = serve.add_export_job(opts)
    profile = tempfile.mkdtemp(prefix="spelldirector-export-")
    url = f"http://127.0.0.1:{port}/?sound=off&t=0&export_job={token}"
    args = [exe, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
            "--disable-extensions", "--mute-audio", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
            "--window-size=1280,800", url]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        args.insert(1, "--no-sandbox")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        # stdout must stay clean: it is the MCP channel when the director runs this.
        proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, creationflags=flags)
    except OSError as exc:
        serve.drop_export_job(token)
        shutil.rmtree(profile, ignore_errors=True)
        raise ExportError(f"could not start the browser {exe}: {exc}") from exc
    try:
        if not done.wait(timeout_s):
            raise ExportError(f"the export did not finish within {timeout_s:.0f} s ({exe})")
    finally:
        proc.kill()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            pass
        serve.drop_export_job(token)
        shutil.rmtree(profile, ignore_errors=True)
    if "error" in job:
        raise ExportError(f"export failed in the page: {job['error']}")
    return job["result"]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("template", help="template id (e.g. lightning-sky-strike) or path to a template .json")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--frame", type=int, default=192, help="cell size in px (default 192)")
    ap.add_argument("--fps", type=int, help="frame rate (default: the template's fps_hint, else 30)")
    ap.add_argument("--views", default=",".join(VIEWS), help="comma-separated views (default all four)")
    ap.add_argument("--no-layers", action="store_true", help="only the whole-spell row, no row per layer")
    ap.add_argument("--no-bloom", action="store_true", help="don't bake the bloom glow into the sprites")
    ap.add_argument("--out", help="output folder (default exports/<id>-seed<seed>)")
    args = ap.parse_args(argv)
    try:
        res = export(args.template, seed=args.seed, frame=args.frame, fps=args.fps,
                     views=[v.strip() for v in args.views.split(",") if v.strip()],
                     layers=not args.no_layers, out=args.out, bloom=not args.no_bloom)
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    m = res["manifest"]
    print(f"{m['template']['name']} (seed {m['seed']}): {m['frame_count']} frames at {m['fps']} fps, "
          f"{len(m['sheets'])} sheets (whole spell + one per layer), rows: {', '.join(m['view_rows'])}")
    for f in res["files"]:
        print(f"  {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
