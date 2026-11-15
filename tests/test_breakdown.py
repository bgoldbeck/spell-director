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


# ---------------------------------------------------------------- video

av = pytest.importorskip("av")


@pytest.fixture(scope="module")
def video_result(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("bdv")
    mp4 = sample_gif.write_video(tmp / "strike.mp4")
    return bd.breakdown(mp4, tmp / "out"), tmp / "out"


def test_video_timing_matches_the_gif(video_result):
    r, out = video_result
    assert r["gif"]["format"] == "video"
    assert r["gif"]["frame_count"] == 28
    assert r["gif"]["duration_ms"] == 28 * 40
    assert sum(f["duration_ms"] for f in r["frames"]) == 28 * 40
    assert r["timing"]["main_peak_ms"] == 400
    assert r["timing"]["flicker"]["peaks"] >= 3
    assert [p["phase"] for p in r["timing"]["phases"]] == ["anticipation", "release", "impact", "dissipation"]
    assert (out / "contact_sheet.png").is_file()


def test_video_is_resampled_to_max_fps(tmp_path):
    mp4 = sample_gif.write_video(tmp_path / "fast.mp4", fps=100)
    r = bd.breakdown(mp4, tmp_path / "out", max_fps=25)
    assert r["gif"]["video"]["fps"] == 100
    assert r["gif"]["frame_count"] == 28
    assert r["gif"]["duration_ms"] == 28 * 40
    assert r["timing"]["main_peak_ms"] == 400


def test_video_start_end_and_truncation(tmp_path):
    mp4 = sample_gif.write_video(tmp_path / "lead.mp4", lead_in=25)  # 1 s of nothing first
    r = bd.breakdown(mp4, tmp_path / "out", start_s=1.0)
    assert r["gif"]["video"]["start_s"] == pytest.approx(1.0)
    assert r["timing"]["main_peak_ms"] == 400
    assert not r["gif"]["video"]["truncated"]
    short = bd.breakdown(mp4, tmp_path / "out2", start_s=1.0, max_seconds=0.6)
    assert short["gif"]["video"]["truncated"]
    assert short["gif"]["duration_ms"] <= 640
    ended = bd.breakdown(mp4, tmp_path / "out3", start_s=1.0, end_s=1.6)
    assert not ended["gif"]["video"]["truncated"]


def test_bad_video_is_a_clear_error(tmp_path):
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(ValueError, match="cannot read video"):
        bd.breakdown(bad, tmp_path / "out")


def test_cli_accepts_video_options(tmp_path, capsys):
    mp4 = sample_gif.write_video(tmp_path / "cli.mp4")
    assert bd.main([str(mp4), "--out", str(tmp_path / "out"), "--max-fps", "20", "--end", "0.8"]) == 0
    assert "video: 25.0 fps source" in capsys.readouterr().out
