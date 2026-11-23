"""Range guides (tools/range_guide.py): the maths and the sheet layout, from a
synthetic measurement. The browser half (web/js/rangeguide.js) is covered by an
end-to-end run that needs Playwright and a browser, skipped without them."""

import math

import pytest
from PIL import Image

from director import library  # noqa: F401  (puts tools/ on the import path)

import export_sprites  # noqa: E402
import range_guide  # noqa: E402


def test_screen_px_matches_a_1080p_60_degree_camera():
    assert math.isclose(range_guide.screen_px(1, 1), 1080 / (2 * math.tan(math.radians(30))))
    assert math.isclose(range_guide.screen_px(0.2, 10), range_guide.screen_px(0.1, 5))
    assert math.isclose(range_guide.screen_px(0.05, range_guide.reads_until(0.05)), 3)
    assert range_guide.reads_until(None) == 0
    assert [range_guide.band(p)[1] for p in (0.5, 2, 5, 30)] == ["lost", "flicker", "line", "shape"]


def test_distances_drop_ones_next_to_the_reference():
    assert range_guide.distances({"reference_distance": 3.4, "view_distances": [3, 6, 12]}) == [3.4, 6, 12]


def test_cue_active_inside_its_beat_or_near_its_moment():
    cue = {"t_ms": 600, "window_ms": [220, 1000], "at_ms": None}
    assert range_guide.cue_active(cue, 360)
    assert not range_guide.cue_active(cue, 1080)
    hit = {"t_ms": 420, "window_ms": [330, 1030], "at_ms": 420}
    assert range_guide.cue_active(hit, 360)
    assert not range_guide.cue_active(hit, 900)


def _station(u, env, core=None):
    return {"u": u, "envelope": env, "core": core, "envelope_px": [100, 100 + int(env * 100)],
            "core_px": [120, 121] if core else None}


def _fake():
    stations = [_station(0.05, 0.2, 0.02), _station(0.25, 0.25), _station(0.5, 0.3), _station(0.75, 0.35), _station(0.9, 0.6)]
    frame = {"t_ms": 600, "area": 1, "core_area": 0.01, "stations": stations, "envelope": 0.3, "core": 0.02,
             "box": {"x0": 50, "y0": 90, "x1": 600, "y1": 200, "w": 5.5, "h": 1.1},
             "plume": {"x0": 500, "y0": 90, "x1": 600, "y1": 200, "w": 1.0, "h": 1.1}}
    geo = {"ppu": 100, "width": 700, "height": 300, "box": {}, "hand": [100, 230], "caster": [80, 290], "target": [560, 290],
           "target_distance": 4.8, "stations": [{"u": s["u"], "px": 100 + i * 100} for i, s in enumerate(stations)],
           "plume_columns": [480, 650]}
    m = {
        "template": {"id": "test-jet", "name": "Test Jet", "duration_ms": 1000}, "seed": 1, "style": "stylized",
        "readability": {"reference_distance": 4.8, "reference_source": "space.footprint.length", "view_distances": [6, 12],
                        "must_read": [], "key_frames": []},
        "geometry": geo, "frames": [frame], "peak": frame,
        "key_frames": [{"label": "first contact", "t_ms": 400, "note": "It lands.", "source": "template", "measured": frame}],
        "cues": [{"cue": "thin core", "layers": ["jet"], "measure": "core", "size": 0.02, "t_ms": 600, "window_ms": [200, 900],
                  "at_ms": None, "why": "It vanishes first."}],
        "layers": [{"id": "jet", "type": "beam", "anchor": "caster_hand", "tracking": "follow", "tracking_source": "template"},
                   {"id": "scorch", "type": "decal", "anchor": "target", "tracking": "stay", "tracking_source": "default"}],
        "images": {"distance-6": {"ppu": 50}, "distance-12": {"ppu": 25}, "distance-4.8": {"ppu": 62.5}},
    }
    img = lambda w, h: Image.new("RGB", (w, h), (200, 90, 20))  # noqa: E731
    images = {"peak": img(700, 300), "key-0": img(700, 300), "distance-4.8": img(437, 187),
              "distance-6": img(350, 150), "distance-12": img(175, 75)}
    return m, images


def test_compose_and_markdown_from_a_measurement():
    m, images = _fake()
    feats = range_guide.features(m)
    assert feats[0]["size"] == 0.2 and any(f["label"] == "Must read: thin core" for f in feats)
    sheet = range_guide.compose(m, images)
    assert sheet.width == 1500 and sheet.height > 800
    md = range_guide.markdown(m)
    assert "| Hot core (median) | 0.02 u (4 cm) |" in md
    assert "**thin core** (jet): core" in md
    assert "`scorch` (decal at target): stays where it landed (default)" in md


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
def test_range_guide_end_to_end(tmp_path):
    res = range_guide.guide("lightning-volt-lash", out=tmp_path, ppu=60)
    m = res["manifest"]
    assert [k["label"] for k in m["key_frames"]] == ["charge", "lash", "restrike", "discharge"]
    assert m["peak"]["envelope"] and m["geometry"]["target_distance"] == 3.4
    assert {c["cue"] for c in m["cues"]} >= {"hand-to-chest bolt"}
    assert all((tmp_path / f"lightning-volt-lash-range-guide{s}").exists() for s in (".png", ".md", ".json"))
