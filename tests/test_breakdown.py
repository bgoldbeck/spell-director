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


# ---------------------------------------------------------------- real-footage problems


def _write_cut_gif(path):
    """Two camera shots over a bright, textured background. Shot A is idle;
    shot B (a different scene) has a glow that swells and fades. Shot A also
    has a full-frame flash, which must not count as a cut."""
    from PIL import Image

    rng = np.random.default_rng(1)
    h, w = 90, 160
    scene_a = np.clip(0.45 + 0.15 * rng.standard_normal((h, w, 1)), 0, 1).repeat(3, axis=2)
    scene_b = np.zeros((h, w, 3))
    scene_b[: h // 2] = [0.55, 0.7, 0.9]  # sky
    scene_b[h // 2:] = [0.3, 0.45, 0.2]  # grass
    ys, xs = np.mgrid[0:h, 0:w]
    blob = np.exp(-(((xs - 120) / 20.0) ** 2 + ((ys - 50) / 20.0) ** 2))[..., None]
    frames = []
    for i in range(10):
        frames.append(scene_a + (0.05 if i == 5 else 0.0))  # one-frame flash
    glow = [0, 0, 0, 0.2, 0.5, 0.9, 1.0, 0.7, 0.4, 0.15, 0, 0, 0, 0]
    for g in glow:
        frames.append(scene_b + 0.8 * g * blob)
    for i, f in enumerate(frames):
        f[0, 0, 0] = 0.5 + (i % 3) / 255  # keep neighbours distinct so the GIF writer doesn't merge them
    pics = [Image.fromarray((np.clip(f, 0, 1) * 255).astype(np.uint8), "RGB") for f in frames]
    pics[0].save(path, save_all=True, append_images=pics[1:], duration=50, loop=0)
    return path


import numpy as np  # noqa: E402


@pytest.fixture(scope="module")
def cut_result(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("cut")
    return bd.breakdown(_write_cut_gif(tmp / "cut.gif"), tmp / "out")


def test_camera_cut_is_found_and_flash_is_not(cut_result):
    shots = cut_result["shots"]
    assert [(s["start_frame"], s["end_frame"]) for s in shots] == [(0, 9), (10, 23)]
    assert cut_result["frames"][10].get("cut") is True
    assert cut_result["frames"][10]["motion"] == 0
    assert cut_result["main_shot"] == 1


def test_bright_background_and_quiet_frames_read_near_zero(cut_result):
    assert cut_result["bright_background"] is True
    frames = cut_result["frames"]
    assert frames[16]["intensity"] == 1.0
    # Idle frames of the effect's shot carry no baseline.
    assert max(f["intensity"] for f in frames[10:13]) < 0.05
    assert max(f["intensity"] for f in frames[21:]) < 0.05


def test_effect_onset_and_space_come_from_the_main_shot(cut_result):
    main = cut_result["shots"][1]
    assert main["effect_onset_frame"] in (13, 14)
    space = cut_result["space"]
    assert space["shot"] == 1
    assert space["travel_direction"] == "stationary"
    # The glow sits right of centre in shot B.
    x0, _, x1, _ = space["footprint_bbox"]
    assert x0 > 0.5 and x1 > 0.6


def test_summary_mentions_shots(cut_result):
    text = bd.summary(cut_result)
    assert "2 camera shots" in text
    assert "bright background" in text
