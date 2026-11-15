"""The viewer draws every template in every view without page errors (shader
compile errors, exceptions in a layer's update). Needs Playwright and a
browser; skipped without them."""

import json
import threading
from pathlib import Path

import pytest

from director import library  # noqa: F401  (puts tools/ on the import path)

import export_sprites  # noqa: E402
import serve  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_IDS = [
    json.loads((ROOT / "templates" / p).read_text(encoding="utf-8"))["id"]
    for p in json.loads((ROOT / "templates" / "index.json").read_text(encoding="utf-8"))["templates"]
]


def _browser_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            export_sprites._launch(p).close()
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.mark.skipif(not _browser_available(), reason="needs Playwright and a browser")
def test_every_template_renders_in_every_view_without_errors():
    from playwright.sync_api import sync_playwright

    serve.Handler.log_message = lambda *a, **k: None
    server = serve.bind("127.0.0.1", 0)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = export_sprites._launch(p)
            try:
                page = browser.new_page(viewport={"width": 640, "height": 400})
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text else None)
                for tid in TEMPLATE_IDS:
                    for t in (200, 600, 1000):
                        page.goto(f"http://127.0.0.1:{port}/?template={tid}&view=quad&t={t}&sound=off")
                        page.wait_for_function("window.spellDirector && window.spellDirector.effect", timeout=20000)
                        page.wait_for_timeout(150)
                    assert not errors, f"{tid}: {errors}"
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
