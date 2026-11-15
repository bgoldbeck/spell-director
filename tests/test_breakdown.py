import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import breakdown as bd  # noqa: E402
import sample_gif  # noqa: E402


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("bd")
    gif = sample_gif.write(tmp / "strike.gif")
    out = tmp / "out"
    r = bd.breakdown(gif, out)
    return r, out


def phase(r, name):
    return next(p for p in r["timing"]["phases"] if p["phase"] == name)


def test_total_duration_matches_gif(result):
    r, _ = result
    assert r["gif"]["duration_ms"] == 28 * 40
    assert sum(f["duration_ms"] for f in r["frames"]) == 28 * 40


def test_main_peak_is_the_strike(result):
    r, _ = result
    # The bolt first appears in source frame 10 (400 ms).
    assert r["timing"]["main_peak_ms"] == 400


def test_restrikes_are_found(result):
    r, _ = result
    peak_ms = [p["ms"] for p in r["timing"]["peaks"]]
    assert peak_ms == [400, 520, 600]
    assert r["timing"]["flicker"]["peaks"] == 3


def test_phase_order_and_bounds(result):
    r, _ = result
    names = [p["phase"] for p in r["timing"]["phases"]]
    assert names == ["anticipation", "release", "impact", "dissipation"]
    assert phase(r, "anticipation")["start_ms"] <= 160
    assert phase(r, "release")["start_ms"] == 400
    assert phase(r, "impact")["end_ms"] == 640
    assert phase(r, "dissipation")["end_ms"] >= 1000


def test_palette_is_blue_with_bright_core(result):
    r, _ = result
    slots = {e.get("suggested_slot"): e for e in r["palette"]}
    assert slots["core"]["luma"] > 0.7
    assert 190 <= slots["primary"]["hue_deg"] <= 240


def test_effect_is_tall_and_stationary(result):
    r, _ = result
    assert r["space"]["footprint_aspect"] < 0.7
    assert r["space"]["travel_direction"] == "stationary"


def test_outputs_written(result):
    r, out = result
    for name in ("breakdown.json", "contact_sheet.png", "curves.png", "palette.png", "heatmap.png"):
        assert (out / name).stat().st_size > 0
    assert json.loads((out / "breakdown.json").read_text())["schema"] == "spelldirector.breakdown/0.1.0"


def test_find_peaks_merges_close_bumps():
    assert bd.find_peaks([0, 0.6, 0.55, 0.62, 0, 0.9, 0]) == [3, 5]


def test_rejects_non_gif(tmp_path):
    bad = tmp_path / "x.gif"
    bad.write_text("not a gif")
    with pytest.raises(OSError):
        bd.breakdown(bad, tmp_path / "out")
