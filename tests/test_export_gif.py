"""GIF export (tools/export_gif.py, library.export_gif, the viewer's Export GIF).

The end-to-end test needs Playwright and a browser and is skipped without them;
the encoder and frame plan are covered by web-tests/gif.test.mjs.
"""

import json

import pytest
from PIL import Image, ImageSequence

from director import library

import export_gif
import export_sprites


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


def test_unknown_template_is_refused():
    with pytest.raises(library.LibraryError):
        library.export_gif("no-such-spell")


@pytest.mark.parametrize("kwargs", [{"views": ["back"]}, {"style": "oil"}, {"length": "forever"},
                                    {"width": 10}, {"fps": 100}, {"speed": 0}])
def test_bad_options_are_refused(kwargs):
    with pytest.raises(export_sprites.ExportError):
        export_gif.export("lightning-sky-strike", **kwargs)


def test_library_turns_bad_options_into_library_errors():
    with pytest.raises(library.LibraryError):
        library.export_gif("lightning-sky-strike", views=["back"])


@pytest.mark.skipif(not _browser_available(), reason="needs Playwright and a browser")
def test_export_writes_one_looping_gif_per_view(tmp_path):
    res = export_gif.export("lightning-sky-strike", views=["side", "quad"], width=160, fps=10, out=tmp_path)
    m = res["manifest"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "lightning-sky-strike-seed1-four-views.gif", "lightning-sky-strike-seed1-side.gif"]
    assert [g["view"] for g in m["gifs"]] == ["side", "quad"]
    assert m["frame_count"] == 11  # 1100 ms at 10 fps
    for name in ("lightning-sky-strike-seed1-side.gif", "lightning-sky-strike-seed1-four-views.gif"):
        im = Image.open(tmp_path / name)
        assert im.size == (160, 120)
        assert im.info.get("loop") == 0
        frames = [f.convert("RGB") for f in ImageSequence.Iterator(im)]
        assert 2 <= len(frames) <= 11  # identical frames are merged
        assert sum(f.info.get("duration", 0) for f in ImageSequence.Iterator(Image.open(tmp_path / name))) == 1100
        # The bolt shows up: some frame is much brighter than the first.
        peak = max(max(f.convert("L").getextrema()[1] for f in frames[1:]), 0)
        assert peak > frames[0].convert("L").getextrema()[1]


@pytest.mark.skipif(not _browser_available(), reason="needs Playwright and a browser")
def test_aura_gif_records_its_seamless_loop(tmp_path):
    aura = next(t for t in library.list_templates() if json.dumps(library.get_template(t["id"]).get("timing", {})).find("loop_range") >= 0)
    lr = library.get_template(aura["id"])["timing"]["loop_range"]
    res = export_gif.export(aura["id"], views=["top"], width=128, fps=10, out=tmp_path)
    m = res["manifest"]
    assert m["length"] == "loop"
    assert (m["start_ms"], m["end_ms"]) == (lr["start_ms"], lr["end_ms"])
    im = Image.open(res["files"][0])
    total = sum(f.info.get("duration", 0) for f in ImageSequence.Iterator(im))
    assert abs(total - (lr["end_ms"] - lr["start_ms"])) <= 10
