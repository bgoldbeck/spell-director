"""Break a spell VFX GIF or video (MP4, WebM, MOV) down into hard facts the
director can build a template from.

Usage:
    python tools/breakdown.py path/to/spell.gif --out breakdowns/spell
    python tools/breakdown.py path/to/spell.mp4 --start 1.2 --end 3.5

--start/--end trim GIFs too (frames that start inside the window are kept).

Videos are decoded with PyAV, resampled to at most --max-fps frames per second
(default 30) and limited to --max-seconds (default 20) after --start.

Writes to the output folder:
    breakdown.json     frames, timing, curves, palette, phase hints, spatial hints
    contact_sheet.png  labelled frames (index, time, phase hint) for the AI to look at
    curves.png         brightness / coverage / motion over time with phase bands and peaks
    palette.png        effect colors, brightest first, with suggested palette slots
    heatmap.png        where on screen the effect happens across the whole GIF

The numbers are measurements, the phases and view are *hints*. The AI follows
docs/gif-breakdown-playbook.md to turn them into a template.
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageSequence

ANALYSIS_MAX_SIDE = 256
BROWSER_MIN_DELAY_MS = 20  # browsers treat delays at or below 10 ms as 100 ms
DEFAULT_DELAY_MS = 100
GLOW_THRESHOLD = 0.03  # luma increase over background that counts as "effect"
MAX_SHEET_FRAMES = 48
VIDEO_SUFFIXES = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}
VIDEO_MAX_FPS = 30.0
VIDEO_MAX_SECONDS = 20.0
PLAYER_MAX_SIDE = 480  # frames written for the viewer's clip player
FULL_MAX_SIDE = 640  # cap stored full-size video frames (contact sheet only needs small ones)
# Camera cuts. A cut changes the picture both ways at once: many pixels get
# brighter AND many get darker. Spell light is mostly additive, so a flash,
# bolt or fade moves the picture one way, or only a few pixels both ways.
CUT_MIN_MOTION = 0.04  # mean absolute luma change between the two frames
CUT_STEP = 0.05  # per-pixel luma change that counts as "changed"
CUT_MIN_TWO_SIDED = 0.12  # fraction of pixels that must change in each direction
BRIGHT_BACKGROUND = 0.35  # mean background luma above which intensities read low

PHASE_COLORS = {
    "none": (90, 90, 90),
    "anticipation": (90, 140, 255),
    "release": (255, 255, 255),
    "impact": (255, 200, 60),
    "dissipation": (150, 110, 200),
}


@dataclass
class Frame:
    index: int
    start_ms: int
    duration_ms: int
    raw_duration_ms: int
    rgb: np.ndarray  # H x W x 3 float32 in 0..1 (analysis size)
    full: Image.Image  # original-size RGB frame
    stats: dict = field(default_factory=dict)


# ---------------------------------------------------------------- loading


def _effective_delay(raw: int | None) -> int:
    if raw is None:
        return DEFAULT_DELAY_MS
    if raw <= 10:
        return DEFAULT_DELAY_MS
    return max(int(raw), BROWSER_MIN_DELAY_MS)


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_SUFFIXES


def load_frames(path: Path, **video_opts) -> tuple[list[Frame], dict]:
    if is_video(path):
        return load_video_frames(path, **video_opts)
    return load_gif_frames(path, start_s=video_opts.get("start_s") or 0.0, end_s=video_opts.get("end_s"))


def load_video_frames(path: Path, start_s: float = 0.0, end_s: float | None = None,
                      max_fps: float = VIDEO_MAX_FPS, max_seconds: float = VIDEO_MAX_SECONDS) -> tuple[list[Frame], dict]:
    """Decode a video into frames with real timestamps.

    Frames are kept no closer together than 1/max_fps; each kept frame lasts
    until the next kept one, like merged GIF frames. Only [start_s, end_s)
    is read, and at most max_seconds of it.
    """
    try:
        import av
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise ValueError("reading video needs PyAV: python -m pip install av") from exc
    if max_fps <= 0:
        raise ValueError("max_fps must be positive")
    limit_s = start_s + max_seconds
    stop_s = min(end_s, limit_s) if end_s is not None else limit_s
    min_gap = 1.0 / max_fps
    raw: list[tuple[float, Image.Image]] = []
    truncated = False
    try:
        container = av.open(str(path))
    except av.error.FFmpegError as exc:
        raise ValueError(f"cannot read video {path.name}: {exc}") from exc
    with container:
        if not container.streams.video:
            raise ValueError(f"{path.name} has no video stream")
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        rate = float(stream.average_rate) if stream.average_rate else None
        source_frames = 0
        last_kept = None
        for vf in container.decode(stream):
            if vf.time is None:
                continue
            t = float(vf.time)
            if t < start_s - 1e-6:
                continue
            if t >= stop_s - 1e-6:
                # Stopped by max_seconds (not by the caller's end) while video remains.
                truncated = end_s is None or end_s > limit_s
                break
            source_frames += 1
            if last_kept is not None and t - last_kept < min_gap - 1e-4:
                continue
            img = vf.to_image()
            if max(img.size) > FULL_MAX_SIDE:
                k = FULL_MAX_SIDE / max(img.size)
                img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.BILINEAR)
            raw.append((t, img.convert("RGB")))
            last_kept = t
        width, height = stream.codec_context.width, stream.codec_context.height
    if not raw:
        raise ValueError(f"no video frames in {path.name} between {start_s} s and {stop_s} s")

    t0 = raw[0][0]
    starts = [round((t - t0) * 1000) for t, _ in raw]
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    # The last kept frame lasts one typical step.
    last_ms = int(np.median(gaps)) if gaps else round(1000 * max(1.0 / rate if rate else 0.0, min_gap))
    ends = starts[1:] + [starts[-1] + max(1, last_ms)]
    scale = min(1.0, ANALYSIS_MAX_SIDE / max(raw[0][1].size))
    small = (max(1, round(raw[0][1].width * scale)), max(1, round(raw[0][1].height * scale)))
    frames: list[Frame] = []
    for i, ((_, full), start_ms, end_ms) in enumerate(zip(raw, starts, ends)):
        arr = np.asarray(full.resize(small, Image.BILINEAR), dtype=np.float32) / 255.0
        dur = max(1, end_ms - start_ms)
        frames.append(Frame(i, start_ms, dur, dur, arr, full))
    total = frames[-1].start_ms + frames[-1].duration_ms
    meta = {
        "source": path.name,
        "format": "video",
        "width": width,
        "height": height,
        "analysis_size": list(small),
        "frame_count": len(frames),
        "duration_ms": total,
        "loop": False,
        "video": {
            "fps": round(rate, 3) if rate else None,
            "source_frames": source_frames,
            "max_fps": max_fps,
            "start_s": round(t0, 3),
            "truncated": truncated,
        },
    }
    return frames, meta


def load_gif_frames(path: Path, start_s: float = 0.0, end_s: float | None = None) -> tuple[list[Frame], dict]:
    """Decode a GIF. start_s/end_s keep only the frames that start in
    [start_s, end_s), with times counted from the first kept frame."""
    if end_s is not None and end_s <= start_s:
        raise ValueError("end must be after start")
    img = Image.open(path)
    width, height = img.size
    scale = min(1.0, ANALYSIS_MAX_SIDE / max(width, height))
    small = (max(1, round(width * scale)), max(1, round(height * scale)))
    frames: list[Frame] = []
    t = 0
    src_t = 0
    first_ms = None
    start_ms = round(start_s * 1000)
    end_ms = round(end_s * 1000) if end_s is not None else None
    for frame in ImageSequence.Iterator(img):
        raw = frame.info.get("duration")
        delay = _effective_delay(raw)
        frame_start, src_t = src_t, src_t + delay
        if frame_start < start_ms:
            continue
        if end_ms is not None and frame_start >= end_ms:
            continue  # keep counting src_t for the source's full length
        if first_ms is None:
            first_ms = frame_start
        i = len(frames)
        rgba = frame.convert("RGBA")
        # Composite transparency over black: spell GIFs are almost always shown over dark scenes.
        base = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
        full = Image.alpha_composite(base, rgba).convert("RGB")
        arr = np.asarray(full.resize(small, Image.BILINEAR), dtype=np.float32) / 255.0
        frames.append(Frame(i, t, delay, raw if raw is not None else -1, arr, full))
        t += delay
    if not frames:
        raise ValueError(f"no GIF frames in {path.name} between {start_s} s and {end_s} s")
    meta = {
        "source": path.name,
        "format": "gif",
        "width": width,
        "height": height,
        "analysis_size": list(small),
        "frame_count": len(frames),
        "duration_ms": t,
        "loop": img.info.get("loop") is not None,
    }
    if start_s or end_s is not None:
        meta["trim"] = {"start_s": round(first_ms / 1000, 3), "end_s": round((first_ms + t) / 1000, 3),
                        "source_duration_ms": src_t}
    return frames, meta


# ---------------------------------------------------------------- measuring


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def find_cuts(lumas: np.ndarray) -> list[int]:
    """Indices of frames that start a new camera shot."""
    cuts = []
    for i in range(1, len(lumas)):
        d = lumas[i] - lumas[i - 1]
        if float(np.abs(d).mean()) < CUT_MIN_MOTION:
            continue
        if min(float((d > CUT_STEP).mean()), float((d < -CUT_STEP).mean())) >= CUT_MIN_TWO_SIDED:
            cuts.append(i)
    return cuts


def shot_ranges(n: int, cuts: list[int]) -> list[tuple[int, int]]:
    bounds = [0, *cuts, n]
    return [(a, b - 1) for a, b in zip(bounds, bounds[1:])]


def measure(frames: list[Frame]) -> dict:
    stack = np.stack([f.rgb for f in frames])
    lumas = luma(stack)
    cuts = find_cuts(lumas)
    shots = shot_ranges(len(frames), cuts)
    # Spell effects are mostly additive light over a darker scene, so the
    # background is what each pixel looks like at its darkest. A low
    # percentile instead of the minimum ignores single noisy frames. Each
    # camera shot gets its own background, so cuts don't count as effect.
    backgrounds = [np.percentile(lumas[a: b + 1], 10, axis=0) for a, b in shots]
    shot_of = np.repeat(np.arange(len(shots)), [b - a + 1 for a, b in shots])
    h, w = backgrounds[0].shape
    ys, xs = np.mgrid[0:h, 0:w]
    unions = [np.zeros_like(bg) for bg in backgrounds]
    cut_set = set(cuts)
    prev = None
    for f, y in zip(frames, lumas):
        k = int(shot_of[f.index])
        background = backgrounds[k]
        if f.index in cut_set:
            prev = None  # change across a cut is the camera, not the effect
        gain = np.clip(y - background, 0, None)
        mask = gain > GLOW_THRESHOLD
        coverage = float(mask.mean())
        # Only light above the threshold counts, so dithering and compression
        # noise don't add up to a baseline glow over a busy background.
        energy = float((gain * mask).mean())
        stats = {
            "mean_luma": round(float(y.mean()), 4),
            "peak_luma": round(float(np.percentile(y, 99.5)), 4),
            "energy_raw": energy,
            "coverage": round(coverage, 4),
            "motion": round(float(np.abs(y - prev).mean()) if prev is not None else 0.0, 4),
            "shot": k,
        }
        if f.index in cut_set:
            stats["cut"] = True
        if mask.any():
            weight = gain * mask
            total = weight.sum()
            cx = float((xs * weight).sum() / total) / max(w - 1, 1)
            cy = float((ys * weight).sum() / total) / max(h - 1, 1)
            rows = np.where(mask.any(axis=1))[0]
            cols = np.where(mask.any(axis=0))[0]
            stats["centroid"] = [round(cx, 3), round(cy, 3)]
            stats["bbox"] = [
                round(cols[0] / w, 3), round(rows[0] / h, 3),
                round((cols[-1] + 1) / w, 3), round((rows[-1] + 1) / h, 3),
            ]
            unions[k] += gain
        else:
            stats["centroid"] = None
            stats["bbox"] = None
        f.stats = stats
        prev = y
    # Idle animation (characters breathing, grass swaying) leaves a floor of
    # "effect" in every frame of a shot. Subtract each shot's quiet level.
    energies = np.array([f.stats.pop("energy_raw") for f in frames])
    for a, b in shots:
        energies[a: b + 1] -= np.percentile(energies[a: b + 1], 10)
    energies = np.clip(energies, 0, None)
    peak_energy = float(energies.max()) or 1.0
    for f, e in zip(frames, energies):
        f.stats["intensity"] = round(float(e) / peak_energy, 4)
    shot_info = []
    for k, ((a, b), bg) in enumerate(zip(shots, backgrounds)):
        covs = [frames[i].stats["coverage"] for i in range(a, b + 1)]
        cov_floor = float(np.percentile(covs, 10))
        for i in range(a, b + 1):
            # Coverage beyond the shot's idle level: what the effect adds.
            frames[i].stats["coverage_above_floor"] = round(max(0.0, frames[i].stats["coverage"] - cov_floor), 4)
        peak = max(frames[i].stats["intensity"] for i in range(a, b + 1))
        # Where the effect starts showing in this shot: a beam fired in the
        # caster's shot before the camera cuts to the target, for example.
        onset = next((i for i in range(a, b + 1) if frames[i].stats["intensity"] >= max(0.05, peak * 0.25)), None)
        shot_info.append({
            "shot": k, "start_frame": a, "end_frame": b,
            "start_ms": frames[a].start_ms, "end_ms": frames[b].start_ms + frames[b].duration_ms,
            "peak_intensity": peak,
            "effect_onset_frame": onset,
            "effect_onset_ms": frames[onset].start_ms if onset is not None else None,
            "background_luma": round(float(bg.mean()), 4),
        })
    main = max(range(len(frames)), key=lambda i: frames[i].stats["intensity"])
    main_shot = int(shot_of[main])
    weights = [b - a + 1 for a, b in shots]
    bg_luma = float(np.average([bg.mean() for bg in backgrounds], weights=weights))
    return {
        "background_luma": round(bg_luma, 4),
        "bright_background": bg_luma > BRIGHT_BACKGROUND,
        "cuts": cuts,
        "shots": shot_info,
        "main_shot": main_shot,
        "union": unions[main_shot],
        "backgrounds": backgrounds,
        "shot_of": shot_of,
    }


# ---------------------------------------------------------------- phases


def find_peaks(values: list[float], min_height: float = 0.5, min_drop: float = 0.15) -> list[int]:
    """Local maxima at least min_height that stand at least min_drop above
    the lowest point between them and the previous accepted peak."""
    peaks: list[int] = []
    n = len(values)
    for i, v in enumerate(values):
        left = values[i - 1] if i > 0 else -1.0
        right = values[i + 1] if i < n - 1 else -1.0
        if v < min_height or v < left or v < right or (v == left and i > 0):
            continue
        if peaks:
            valley = min(values[peaks[-1]: i + 1])
            if v - valley < min_drop or values[peaks[-1]] - valley < min_drop:
                if v > values[peaks[-1]]:
                    peaks[-1] = i
                continue
        peaks.append(i)
    return peaks


def phase_hints(frames: list[Frame]) -> dict:
    inten = [f.stats["intensity"] for f in frames]
    n = len(frames)
    end_ms = frames[-1].start_ms + frames[-1].duration_ms if frames else 0
    peaks = find_peaks(inten)
    active = [i for i, f in enumerate(frames)
              if inten[i] >= 0.05 or f.stats.get("coverage_above_floor", f.stats["coverage"]) > 0.002]
    if not active:
        for f in frames:
            f.stats["phase_hint"] = "none"
        return {"peaks": [], "phases": [], "flicker": None}
    start, last = active[0], active[-1]
    strong = [i for i, v in enumerate(inten) if v >= 0.7]
    release_start = strong[0]
    main_peak = max(range(n), key=lambda i: inten[i])
    # Impact lasts while the effect stays strong or keeps flickering back up.
    impact_end = main_peak
    for i in range(main_peak, last + 1):
        if inten[i] >= 0.4 or any(p >= i for p in peaks if inten[p] >= 0.6):
            impact_end = i
    release_end = max(release_start, min(main_peak, release_start + 2))

    def label(i: int) -> str:
        if i < start or i > last:
            return "none"
        if i < release_start:
            return "anticipation"
        if i <= release_end:
            return "release"
        if i <= impact_end:
            return "impact"
        return "dissipation"

    for f in frames:
        f.stats["phase_hint"] = label(f.index)

    phases = []
    for f in frames:
        p = f.stats["phase_hint"]
        if p == "none":
            continue
        if phases and phases[-1]["phase"] == p:
            phases[-1]["end_frame"] = f.index
            phases[-1]["end_ms"] = f.start_ms + f.duration_ms
        else:
            phases.append({"phase": p, "start_frame": f.index, "end_frame": f.index,
                           "start_ms": f.start_ms, "end_ms": f.start_ms + f.duration_ms})

    flicker = None
    if len(peaks) >= 3:
        span_ms = frames[peaks[-1]].start_ms - frames[peaks[0]].start_ms
        if span_ms > 0:
            flicker = {"peaks": len(peaks), "hz": round((len(peaks) - 1) / (span_ms / 1000), 2)}
    hold = sum(1 for v in inten if v >= 0.95)
    return {
        "effect_start_ms": frames[start].start_ms,
        "effect_end_ms": frames[last].start_ms + frames[last].duration_ms,
        "gif_end_ms": end_ms,
        "main_peak_frame": main_peak,
        "main_peak_ms": frames[main_peak].start_ms,
        "peaks": [{"frame": p, "ms": frames[p].start_ms, "intensity": inten[p]} for p in peaks],
        "hold_frames_at_peak": hold,
        "flicker": flicker,
        "phases": phases,
    }


# ---------------------------------------------------------------- space


def spatial_hints(frames: list[Frame], union: np.ndarray, shot: int | None = None) -> dict:
    """Footprint and travel. With shot set, only that camera shot counts:
    positions in different shots aren't comparable."""
    # Only frames where the effect is clearly there: in near-empty frames the
    # centroid follows noise or idle animation.
    pts = [(f.start_ms, f.stats["centroid"]) for f in frames
           if f.stats["centroid"] and f.stats.get("intensity", 1) >= 0.1
           and (shot is None or f.stats.get("shot", 0) == shot)]
    out: dict = {} if shot is None else {"shot": shot}
    if union.max() > 0:
        mask = union > union.max() * 0.15
        rows = np.where(mask.any(axis=1))[0]
        cols = np.where(mask.any(axis=0))[0]
        h, w = union.shape
        bw = (cols[-1] - cols[0] + 1) / w
        bh = (rows[-1] - rows[0] + 1) / h
        out["footprint_bbox"] = [round(cols[0] / w, 3), round(rows[0] / h, 3),
                                 round((cols[-1] + 1) / w, 3), round((rows[-1] + 1) / h, 3)]
        out["footprint_aspect"] = round(bw / bh, 3) if bh else None
        # Radial symmetry: how evenly the effect spreads around its centre (1 = perfect disc).
        ys, xs = np.nonzero(mask)
        cy, cx = ys.mean(), xs.mean()
        angles = np.arctan2(ys - cy, xs - cx)
        hist, _ = np.histogram(angles, bins=8, range=(-math.pi, math.pi))
        out["radial_evenness"] = round(float(hist.min() / hist.max()), 3) if hist.max() else 0.0
        out["vertical_extent"] = round(float(bh), 3)
        out["horizontal_extent"] = round(float(bw), 3)
    if len(pts) >= 2:
        (t0, (x0, y0)), (t1, (x1, y1)) = pts[0], pts[-1]
        dx, dy = x1 - x0, y1 - y0
        out["centroid_travel"] = {"dx": round(dx, 3), "dy": round(dy, 3),
                                  "distance": round(math.hypot(dx, dy), 3)}
        if math.hypot(dx, dy) < 0.08:
            direction = "stationary"
        elif abs(dx) > abs(dy) * 1.5:
            direction = "horizontal"
        elif abs(dy) > abs(dx) * 1.5:
            direction = "vertical"
        else:
            direction = "diagonal"
        out["travel_direction"] = direction
    out["view_guess"] = guess_view(out)
    return out


def guess_view(s: dict) -> dict:
    """Very rough. The playbook tells the AI to confirm by looking at the frames."""
    scores = {"front": 0.0, "side": 0.0, "top": 0.0, "three_quarter": 0.0}
    aspect = s.get("footprint_aspect") or 1.0
    even = s.get("radial_evenness", 0.0)
    direction = s.get("travel_direction", "stationary")
    if even > 0.5 and 0.7 < aspect < 1.4:
        scores["top"] += 2
    if 1.4 <= aspect < 2.6 and even > 0.25:
        scores["three_quarter"] += 1.5
    if aspect < 0.7 or direction == "vertical":
        scores["front"] += 1.5
        scores["side"] += 1
    if direction == "horizontal" or aspect >= 2.6:
        scores["side"] += 2
    if direction == "diagonal":
        scores["three_quarter"] += 1.5
    scores["three_quarter"] += 0.5  # most game VFX GIFs are shot in 3/4
    best = max(scores, key=scores.get)
    total = sum(scores.values()) or 1
    return {"best": best, "confidence": round(scores[best] / total, 2),
            "scores": {k: round(v, 2) for k, v in scores.items()}}


# ---------------------------------------------------------------- palette


def palette(frames: list[Frame], colors: int = 6, backgrounds: list[np.ndarray] | None = None,
            shot_of: np.ndarray | None = None) -> list[dict]:
    stack = np.stack([f.rgb for f in frames])
    lumas = luma(stack)
    if backgrounds is None or shot_of is None:
        background = np.percentile(lumas, 10, axis=0)
    else:
        background = np.stack(backgrounds)[shot_of]
    gain = lumas - background
    pixels = stack[gain > GLOW_THRESHOLD]
    if len(pixels) == 0:
        return []
    rng = np.random.default_rng(0)
    if len(pixels) > 60000:
        pixels = pixels[rng.choice(len(pixels), 60000, replace=False)]
    strip = Image.fromarray((pixels.reshape(1, -1, 3) * 255).astype(np.uint8), "RGB")
    q = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: colors * 3]
    counts = q.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    entries = []
    for count, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        h, light, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        entries.append({
            "hex": f"#{r:02X}{g:02X}{b:02X}",
            "share": round(count / total, 3),
            "luma": round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, 3),
            "saturation": round(s, 3),
            "hue_deg": round(h * 360),
        })
    entries.sort(key=lambda e: -e["luma"])
    return suggest_slots(entries)


def suggest_slots(entries: list[dict]) -> list[dict]:
    """Map measured colors to template palette slots. Suggestions only."""
    free = set(range(len(entries)))

    def take(slot: str, i: int | None) -> int | None:
        if i is not None:
            free.discard(i)
            entries[i]["suggested_slot"] = slot
        return i

    def best(cands, key):
        cands = [i for i in cands if i in free]
        return max(cands, key=key) if cands else None

    e = entries
    take("core", best([i for i in free if e[i]["luma"] >= 0.7], lambda i: e[i]["luma"]))
    primary = take("primary", best([i for i in free if e[i]["luma"] >= 0.3],
                                   lambda i: math.sqrt(e[i]["share"]) * (0.2 + e[i]["saturation"]) * e[i]["luma"]))
    if primary is None:
        primary = take("primary", best(free, lambda i: e[i]["share"] * (0.2 + e[i]["saturation"])))
    p_luma = e[primary]["luma"] if primary is not None else 1.0
    p_hue = e[primary]["hue_deg"] if primary is not None else 0
    take("secondary", best([i for i in free if e[i]["luma"] < p_luma and e[i]["luma"] >= 0.12],
                           lambda i: e[i]["saturation"] * (0.5 + e[i]["share"])))

    def hue_gap(i):
        d = abs(e[i]["hue_deg"] - p_hue) % 360
        return min(d, 360 - d)

    take("accent", best([i for i in free if e[i]["saturation"] >= 0.3 and hue_gap(i) >= 40], hue_gap))
    take("shadow", best([i for i in free if e[i]["luma"] < 0.2], lambda i: -e[i]["luma"]))
    return entries


# ---------------------------------------------------------------- pictures


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def contact_sheet(frames: list[Frame], peaks: set[int], path: Path, cuts: set[int] = frozenset()) -> list[int]:
    n = len(frames)
    if n <= MAX_SHEET_FRAMES:
        chosen = list(range(n))
    else:
        step = n / MAX_SHEET_FRAMES
        chosen = sorted({int(i * step) for i in range(MAX_SHEET_FRAMES)} | peaks | set(cuts))
    w, h = frames[0].full.size
    thumb_w = 200
    thumb_h = max(1, round(h * thumb_w / w))
    cols = min(6, len(chosen))
    rows = math.ceil(len(chosen) / cols)
    label_h = 30
    pad = 6
    sheet = Image.new("RGB", (cols * (thumb_w + pad) + pad, rows * (thumb_h + label_h + pad) + pad), (18, 18, 22))
    draw = ImageDraw.Draw(sheet)
    font = _font(12)
    for k, i in enumerate(chosen):
        f = frames[i]
        x = pad + (k % cols) * (thumb_w + pad)
        y = pad + (k // cols) * (thumb_h + label_h + pad)
        sheet.paste(f.full.resize((thumb_w, thumb_h), Image.BILINEAR), (x, y))
        phase = f.stats.get("phase_hint", "none")
        color = PHASE_COLORS[phase]
        draw.rectangle([x - 2, y - 2, x + thumb_w + 1, y + thumb_h + 1], outline=color, width=2)
        if i in cuts:
            draw.rectangle([x, y, x + 34, y + 16], fill=(200, 40, 40))
            draw.text((x + 4, y + 1), "CUT", fill=(255, 255, 255), font=font)
        star = " *" if i in peaks else ""
        draw.text((x + 2, y + thumb_h + 2), f"#{i}  {f.start_ms} ms{star}", fill=(230, 230, 230), font=font)
        draw.text((x + 2, y + thumb_h + 16), f"{phase}  i={f.stats['intensity']:.2f}", fill=color, font=font)
    sheet.save(path)
    return chosen


def curves_chart(frames: list[Frame], hints: dict, path: Path) -> None:
    W, H, m = 900, 320, 44
    img = Image.new("RGB", (W, H), (18, 18, 22))
    d = ImageDraw.Draw(img)
    font = _font(12)
    end = frames[-1].start_ms + frames[-1].duration_ms
    plot_w, plot_h = W - 2 * m, H - 2 * m

    def x_of(ms):
        return m + plot_w * ms / end

    def y_of(v):
        return m + plot_h * (1 - max(0.0, min(1.0, v)))

    for ph in hints.get("phases", []):
        c = PHASE_COLORS[ph["phase"]]
        d.rectangle([x_of(ph["start_ms"]), m, x_of(ph["end_ms"]), m + plot_h], fill=tuple(v // 6 for v in c))
        d.text((x_of(ph["start_ms"]) + 3, m - 16), ph["phase"], fill=c, font=font)
    d.rectangle([m, m, m + plot_w, m + plot_h], outline=(80, 80, 90))
    max_motion = max((f.stats["motion"] for f in frames), default=0) or 1
    max_cov = max((f.stats["coverage"] for f in frames), default=0) or 1
    series = [
        ("intensity", lambda f: f.stats["intensity"], (255, 230, 120)),
        ("coverage", lambda f: f.stats["coverage"] / max_cov, (110, 200, 255)),
        ("motion", lambda f: f.stats["motion"] / max_motion, (200, 120, 255)),
    ]
    for k, (name, fn, color) in enumerate(series):
        pts = []
        for f in frames:
            pts += [(x_of(f.start_ms), y_of(fn(f))), (x_of(f.start_ms + f.duration_ms), y_of(fn(f)))]
        d.line(pts, fill=color, width=2)
        d.text((m + 6 + k * 110, H - m + 22), name, fill=color, font=font)
    for f in frames:
        if f.stats.get("cut"):
            x = x_of(f.start_ms)
            for y0 in range(m, m + plot_h, 8):
                d.line([x, y0, x, min(y0 + 4, m + plot_h)], fill=(220, 60, 60), width=2)
    for p in hints.get("peaks", []):
        x = x_of(frames[p["frame"]].start_ms + frames[p["frame"]].duration_ms / 2)
        d.ellipse([x - 4, y_of(p["intensity"]) - 4, x + 4, y_of(p["intensity"]) + 4], outline=(255, 255, 255))
    for ms in range(0, end + 1, max(100, (end // 10) // 100 * 100)):
        d.line([x_of(ms), m + plot_h, x_of(ms), m + plot_h + 4], fill=(120, 120, 130))
        d.text((x_of(ms) - 10, m + plot_h + 6), f"{ms}", fill=(160, 160, 170), font=font)
    img.save(path)


def palette_chart(entries: list[dict], path: Path) -> None:
    sw, h = 140, 110
    img = Image.new("RGB", (max(1, len(entries)) * sw, h), (18, 18, 22))
    d = ImageDraw.Draw(img)
    font = _font(12)
    for i, e in enumerate(entries):
        x = i * sw
        d.rectangle([x + 4, 4, x + sw - 4, 64], fill=e["hex"])
        d.text((x + 6, 70), f"{e['hex']}  {e['share'] * 100:.0f}%", fill=(230, 230, 230), font=font)
        d.text((x + 6, 88), e.get("suggested_slot", ""), fill=(255, 230, 120), font=font)
    img.save(path)


def heatmap(union: np.ndarray, path: Path, size: tuple[int, int]) -> None:
    v = union / union.max() if union.max() > 0 else union
    rgb = np.stack([np.clip(v * 3, 0, 1), np.clip(v * 3 - 1, 0, 1), np.clip(v * 3 - 2, 0, 1)], axis=-1)
    Image.fromarray((rgb * 255).astype(np.uint8)).resize(size, Image.NEAREST).save(path)


# ---------------------------------------------------------------- main


def player_frames(frames: list[Frame], folder: Path, max_side: int = PLAYER_MAX_SIDE) -> list[str]:
    """Write every analysed frame as a JPEG (frames/0000.jpg, ...) so a player
    can show the clip frame-accurately against the breakdown's timeline."""
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    for f in frames:
        img = f.full
        if max(img.size) > max_side:
            k = max_side / max(img.size)
            img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.BILINEAR)
        name = f"{folder.name}/{f.index:04d}.jpg"
        img.save(folder / f"{f.index:04d}.jpg", quality=88)
        names.append(name)
    return names


def breakdown(gif: Path, out: Path, with_player_frames: bool = False, **video_opts) -> dict:
    """Break down a GIF or video. video_opts start_s/end_s trim either kind;
    max_fps and max_seconds apply to videos only. with_player_frames also
    writes every frame as a JPEG under out/frames/ (listed in
    images.player_frames). The result keeps the key "gif" for the source's
    metadata, whatever its format."""
    frames, meta = load_frames(gif, **video_opts)
    if not frames:
        raise ValueError(f"{gif.name} has no frames")
    measured = measure(frames)
    hints = phase_hints(frames)
    multi = len(measured["shots"]) > 1
    space = spatial_hints(frames, measured["union"], measured["main_shot"] if multi else None)
    colors = palette(frames, backgrounds=measured["backgrounds"], shot_of=measured["shot_of"])
    out.mkdir(parents=True, exist_ok=True)
    peaks = {p["frame"] for p in hints.get("peaks", [])}
    sheet_frames = contact_sheet(frames, peaks, out / "contact_sheet.png", set(measured["cuts"]))
    curves_chart(frames, hints, out / "curves.png")
    palette_chart(colors, out / "palette.png")
    heatmap(measured["union"], out / "heatmap.png", (frames[0].full.size[0] // 2 or 1, frames[0].full.size[1] // 2 or 1))
    result = {
        "schema": "spelldirector.breakdown/0.1.0",
        "gif": meta,
        "background_luma": measured["background_luma"],
        "bright_background": measured["bright_background"],
        "shots": measured["shots"],
        "main_shot": measured["main_shot"],
        "timing": hints,
        "space": space,
        "palette": colors,
        "frames": [
            {"index": f.index, "start_ms": f.start_ms, "duration_ms": f.duration_ms,
             "raw_duration_ms": f.raw_duration_ms, **f.stats}
            for f in frames
        ],
        "images": {
            "contact_sheet": "contact_sheet.png",
            "contact_sheet_frames": sheet_frames,
            "curves": "curves.png",
            "palette": "palette.png",
            "heatmap": "heatmap.png",
        },
    }
    if with_player_frames:
        result["images"]["player_frames"] = player_frames(frames, out / "frames")
    (out / "breakdown.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def summary(r: dict) -> str:
    t, s = r["timing"], r["space"]
    lines = [
        f"{r['gif']['source']}: {r['gif']['frame_count']} frames, {r['gif']['duration_ms']} ms, "
        f"{r['gif']['width']}x{r['gif']['height']}",
    ]
    video = r["gif"].get("video")
    if video:
        lines.append(f"  video: {video['fps']} fps source, sampled at <= {video['max_fps']} fps from {video['start_s']} s"
                     + (" (truncated: use --start/--end or --max-seconds)" if video["truncated"] else ""))
    trim = r["gif"].get("trim")
    if trim:
        lines.append(f"  trimmed to {trim['start_s']}-{trim['end_s']} s of {trim['source_duration_ms']} ms")
    shots = r.get("shots", [])
    if len(shots) > 1:
        main = shots[r["main_shot"]]
        lines.append(f"  {len(shots)} camera shots (cuts at frames {', '.join(str(x['start_frame']) for x in shots[1:])});"
                     f" main shot {r['main_shot']}: frames {main['start_frame']}-{main['end_frame']}")
    if r.get("bright_background"):
        lines.append(f"  bright background (luma {r['background_luma']}): effects over it measure dimmer than they look")
    for p in t.get("phases", []):
        lines.append(f"  {p['phase']:<13} {p['start_ms']:>5}-{p['end_ms']:<5} ms  (frames {p['start_frame']}-{p['end_frame']})")
    if t.get("flicker"):
        lines.append(f"  flicker: {t['flicker']['peaks']} peaks, ~{t['flicker']['hz']} Hz")
    if s.get("view_guess"):
        lines.append(f"  view guess: {s['view_guess']['best']} (confidence {s['view_guess']['confidence']})")
    lines.append("  palette: " + ", ".join(f"{e['hex']}={e.get('suggested_slot', '-')}" for e in r["palette"]))
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("gif", type=Path, help="GIF or video (MP4, WebM, MOV, MKV, AVI)")
    ap.add_argument("--out", type=Path, help="output folder (default: breakdowns/<file name>)")
    ap.add_argument("--start", type=float, default=0.0, help="start time in seconds (GIF or video)")
    ap.add_argument("--end", type=float, help="end time in seconds (GIF or video)")
    ap.add_argument("--max-fps", type=float, default=VIDEO_MAX_FPS, help="video only: sample at most this many fps")
    ap.add_argument("--max-seconds", type=float, default=VIDEO_MAX_SECONDS, help="video only: read at most this long")
    args = ap.parse_args(argv)
    out = args.out or Path("breakdowns") / args.gif.stem
    opts = {"start_s": args.start, "end_s": args.end}
    if is_video(args.gif):
        opts.update(max_fps=args.max_fps, max_seconds=args.max_seconds)
    try:
        result = breakdown(args.gif, out, **opts)
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(summary(result))
    print(f"wrote {out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
