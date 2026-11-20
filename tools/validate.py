"""Validate SpellDirector templates against the schema and the extra rules
described in docs/template-format.md.

Usage: python tools/validate.py templates/lightning/*.json
Exit code is 1 if any template has errors. Warnings do not fail.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

# In the packaged exe, bundled files live under sys._MEIPASS.
ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
SCHEMAS = {
    "spelldirector.template/0.1.0": ROOT / "schemas" / "template-0.1.0.schema.json",
}

KNOWN_PARAMS = {
    "bolt": {
        "segments", "jaggedness", "width_px", "taper", "branch_chance", "branch_depth",
        "branch_length_ratio", "regen_ms", "restrikes", "restrike_gap_ms", "leader_ms",
        "afterimage_ms", "glow_px", "from", "wrap",
    },
    "glow": {"radius_px", "softness", "pulse_hz"},
    "flash": {"scope", "radius_px", "peak"},
    "sparks": {
        "count", "speed", "speed_spread", "gravity", "lifetime_ms", "size_px", "spread_deg", "drag", "emit_ms", "streak_ms", "look", "glow",
        "gather_px", "swirl", "emit_radius_px", "wind_px", "home_to", "orbit_hz",
    },
    "crackle": {"count", "length_px", "jaggedness", "regen_ms", "radius_px"},
    "orb": {
        "radius_px", "pulse_hz", "wobble", "crackle_count", "trail_ms", "arc_height_px", "travel_ease", "look", "height_px", "bubble",
        "approach_deg", "approach_yaw_deg", "smoke_trail_ms", "smoke_opacity", "crescent_deg", "tilt_deg",
        "side_offset_px", "scatter_px", "opacity", "squash", "shape", "spin_hz", "spin_axis", "stick", "from", "wrap",
        "start_out_px",
    },
    "beam": {
        "width_px", "wobble", "wobble_hz", "jaggedness", "regen_ms", "grow_ms", "style", "flow_speed", "turbulence",
        "foam", "churn", "shed_count", "shed_speed", "shed_size_px", "shed_life_ms", "spread", "sweep_px", "sweep_ms",
        "puff_count", "puff_size_px", "spiral_count", "spiral_pitch_px", "spiral_speed", "spiral_radius",
        "spiral_width_px", "line_count", "line_length",
    },
    "vortex": {
        "height_px", "base_radius_px", "top_radius_px", "flare", "spin_hz", "strands", "twist", "turbulence",
        "sway_px", "sway_hz", "grow_ms", "opacity", "start_offset_px", "meander_px", "wander_px",
    },
    "wave": {
        "width_px", "height_px", "travel_ms", "crash_ms", "curl", "flow_speed", "turbulence", "foam",
        "shed_count", "shed_speed", "shed_size_px", "shed_life_ms",
    },
    "ring": {"start_radius_px", "end_radius_px", "thickness_px", "softness", "arc_deg", "ease", "repeat_ms", "count", "steady"},
    "eruption": {
        "shape", "arc_deg", "rows", "start_radius_px", "end_radius_px", "row_delay_ms", "delay_growth", "growth",
        "height_px", "width_px", "spacing_px", "tilt_deg", "jitter", "rise_ms", "hold_ms", "sink_ms", "debris_count",
        "debris_speed", "debris_size_px", "gravity", "dust", "dust_size_px", "dust_life_ms",
    },
    "decal": {
        "radius_px", "shape", "opacity", "fade_in_ms", "lifetime_ms", "fade_ms", "grow_ms", "start_scale",
        "rotation_deg", "spin_deg_per_s", "stretch", "pulse_hz", "detail", "arc_deg", "reveal_ms",
        "depth", "fill", "fill_color", "fill_flow", "fill_in_ms", "symmetry",
    },
    "smoke": {"count", "rise_speed", "size_px", "lifetime_ms", "opacity", "spread_speed", "spread_px", "height_px"},
    "light": {"radius", "energy", "height_px", "forward_px", "side_px", "orbit_hz", "tint"},
    "camera_shake": {"amplitude_px", "frequency_hz", "decay"},
    "sound_cue": {"cue", "gain", "pitch", "offset_ms", "duration_ms", "repeat_ms"},
}

# Layer types that draw nothing, so they take no shader intent.
NO_SHADER = {"sound_cue", "camera_shake"}

CUE_LIBRARY = ROOT / "web" / "sounds" / "cues.json"


def known_cues() -> dict:
    """The sound cue library (web/sounds/cues.json): cue id -> definition."""
    return json.loads(CUE_LIBRARY.read_text(encoding="utf-8"))["cues"]


def cue_flavors() -> dict:
    """Per-element sound flavor words from the cue library: element -> {words, avoid}."""
    return json.loads(CUE_LIBRARY.read_text(encoding="utf-8")).get("flavors", {})


def _ranges(node, path="$"):
    """Yield (path, range) for every {min, max} object in the document."""
    if isinstance(node, dict):
        if set(node) == {"min", "max"}:
            yield path, node
        for key, value in node.items():
            yield from _ranges(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from _ranges(value, f"{path}[{i}]")


def check(doc: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    schema_path = SCHEMAS.get(doc.get("schema")) if isinstance(doc, dict) else None
    if schema_path is None:
        return [f"unknown or missing schema version: {doc.get('schema')!r}"], warnings
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    for err in sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path)):
        where = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in err.path)
        errors.append(f"{where}: {err.message}")
    if errors:
        return errors, warnings

    duration = doc["timing"]["duration_ms"]
    beats = {}
    for beat in doc["beats"]:
        if beat["id"] in beats:
            errors.append(f"duplicate beat id {beat['id']!r}")
        beats[beat["id"]] = beat
        if beat["end_ms"] <= beat["start_ms"]:
            errors.append(f"beat {beat['id']!r}: end_ms must be after start_ms")
        if beat["end_ms"] > duration:
            errors.append(f"beat {beat['id']!r}: ends at {beat['end_ms']} ms, after duration {duration} ms")

    layer_ids = set()
    for layer in doc["layers"]:
        if layer["id"] in layer_ids:
            errors.append(f"duplicate layer id {layer['id']!r}")
        layer_ids.add(layer["id"])

    splash = (doc["space"].get("targets") or {}).get("layout") == "splash"
    for layer in doc["layers"]:
        lid = layer["id"]
        if layer.get("anchor") == "splash" and not splash:
            warnings.append(f"layer {lid!r}: anchored at 'splash', but space.targets.layout isn't 'splash', "
                            "so there are no splash targets and it sits on the primary target once")
        for b in layer["beats"]:
            if b not in beats:
                errors.append(f"layer {lid!r}: unknown beat {b!r}")
        if "attach_to" in layer:
            if layer["attach_to"] not in layer_ids:
                errors.append(f"layer {lid!r}: attach_to unknown layer {layer['attach_to']!r}")
            elif layer["attach_to"] == lid:
                errors.append(f"layer {lid!r}: cannot attach to itself")
        active = [beats[b] for b in layer["beats"] if b in beats]
        for kf in layer.get("keyframes", []):
            if active and not any(b["start_ms"] <= kf["t_ms"] <= b["end_ms"] for b in active):
                errors.append(f"layer {lid!r}: keyframe at {kf['t_ms']} ms is outside its active beats")
        if layer["type"] == "sound_cue":
            cue = layer.get("params", {}).get("cue")
            cues = known_cues()
            if not isinstance(cue, str):
                warnings.append(f"layer {lid!r} (sound_cue): no cue name, so nothing plays")
            elif cue not in cues:
                warnings.append(
                    f"layer {lid!r} (sound_cue): unknown cue {cue!r}; the viewer captions it but plays nothing. "
                    f"Known cues: {', '.join(sorted(cues))}"
                )
        if layer["type"] in NO_SHADER:
            if "shader" in layer:
                warnings.append(f"layer {lid!r} ({layer['type']}): has a shader, but this layer type draws nothing")
        elif "shader" not in layer:
            warnings.append(f"layer {lid!r} ({layer['type']}): no shader intent, so an engine rebuild has to guess "
                            "its material and look (see docs/vocabulary.md section 11)")
        known = KNOWN_PARAMS.get(layer["type"], set())
        for key in layer.get("params", {}):
            if key not in known:
                warnings.append(f"layer {lid!r} ({layer['type']}): unknown param {key!r}")

    _check_loop(doc, beats, errors, warnings)

    for path, rng in _ranges(doc):
        if rng["min"] > rng["max"]:
            errors.append(f"{path}: min {rng['min']} is greater than max {rng['max']}")

    return errors, warnings


def _max(v, default=0):
    """The largest value a fixed number or {min, max} range can take."""
    if isinstance(v, dict) and "max" in v:
        return v["max"]
    return v if isinstance(v, (int, float)) else default


def _check_loop(doc: dict, beats: dict, errors: list[str], warnings: list[str]) -> None:
    """An aura's timing.loop_range: inside the spell, on frame boundaries, and
    every looping particle layer already full when the loop starts."""
    timing = doc["timing"]
    lr = timing.get("loop_range")
    if not lr:
        return
    start, end = lr["start_ms"], lr["end_ms"]
    if end <= start:
        errors.append(f"timing.loop_range: end_ms {end} must be after start_ms {start}")
        return
    if end > timing["duration_ms"]:
        errors.append(f"timing.loop_range: ends at {end} ms, after duration {timing['duration_ms']} ms")
        return
    if timing.get("loop"):
        warnings.append("timing.loop and timing.loop_range are both set: loop replays the whole spell, "
                        "loop_range holds an aura's sustain section; use one")
    fps = timing.get("fps_hint", 30)
    for name, ms in (("start_ms", start), ("end_ms", end)):
        frames = ms * fps / 1000
        if abs(frames - round(frames)) > 1e-6:
            warnings.append(f"timing.loop_range.{name} {ms} is not on a frame at {fps} fps, "
                            "so the exported loop is not frame-exact")
    if start == 0 or end == timing["duration_ms"]:
        warnings.append("timing.loop_range: leave room for a start-up before the loop and an end after it")
    for layer in doc["layers"]:
        active = [beats[b] for b in layer["beats"] if b in beats]
        if not active:
            continue
        w0 = min(b["start_ms"] for b in active)
        w1 = max(b["end_ms"] for b in active)
        params = layer.get("params", {})
        if not (w0 <= start and w1 >= end):
            # A one-shot whose particles are still flying when the loop starts
            # shows in the loop's first frame but not its last.
            tail = 0
            if layer["type"] in ("sparks", "smoke"):
                tail = _max(params.get("lifetime_ms"), 400 if layer["type"] == "sparks" else 500) * (1.2 if layer["type"] == "sparks" else 1)
            if w1 <= start < w1 + tail or (w0 < end < w1 and w0 > start):
                warnings.append(f"layer {layer['id']!r} ({layer['type']}): a one-shot that is still showing at the loop's "
                                "start (or starts inside the loop), so the loop is not seamless; end it a lifetime earlier")
            continue
        life = 0
        if layer["type"] == "sparks" and not layer.get("attach_to"):
            life = _max(params.get("lifetime_ms"), 400) * 1.2
        elif layer["type"] == "smoke":
            life = _max(params.get("lifetime_ms"), 500)
            if life > end - start:
                warnings.append(f"layer {layer['id']!r} (smoke): lifetime_ms {life} is longer than the loop "
                                f"({end - start} ms), so puffs pop when they are reborn")
        if layer["type"] == "ring" and isinstance(params.get("repeat_ms"), (int, float)) and params["repeat_ms"] > 0:
            n = max(1, min(8, round(params.get("count", 1))))
            lead = params["repeat_ms"] * (n - 1) / n
            if start - w0 < lead:
                warnings.append(f"layer {layer['id']!r} (ring): its {n} rings aren't all rolling yet when the loop starts "
                                f"(start the layer at least {round(lead)} ms before the loop)")
            cycles = (end - start) / params["repeat_ms"]
            if abs(cycles - round(cycles)) > 1e-6:
                warnings.append(f"layer {layer['id']!r} (ring): repeat_ms {params['repeat_ms']} doesn't divide the loop "
                                f"({end - start} ms); the viewer stretches it to fit")
        if life and start - w0 < life:
            warnings.append(f"layer {layer['id']!r} ({layer['type']}): starts {start - w0} ms before the loop but its "
                            f"particles live up to {round(life)} ms, so the loop's first frames are thinner than its last "
                            "(start the layer earlier)")
        # Steady beats may switch the layer on and off inside the loop (a light
        # that takes its turn in a cycle) as long as it is in the same state at
        # both ends of the loop; anything else must span the whole loop.
        def steady(beat):
            curve = beat.get("intensity") or {}
            shape = curve.get("shape", "hold")
            return shape == "hold" or (shape != "flicker" and curve.get("to", curve.get("from", 1)) == curve.get("from", 1))

        def level(t):
            return max([(b.get("intensity") or {}).get("from", 1) for b in active
                        if steady(b) and b["start_ms"] <= t <= b["end_ms"]] or [0])

        seam_ok = level(start) == level(end)
        for beat in active:
            if not (beat["start_ms"] < end and beat["end_ms"] > start):
                continue
            spans = beat["start_ms"] <= start and beat["end_ms"] >= end
            if not steady(beat) or not (spans or seam_ok):
                warnings.append(f"layer {layer['id']!r}: beat {beat['id']!r} changes across the loop, so the loop is not "
                                "seamless (let one steady beat span the whole loop_range; start-up and end beats "
                                "should end at its start and begin at its end; steady beats that switch a layer on "
                                "and off inside the loop must leave it the same at both ends)")
                break


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    failed = False
    for name in argv:
        path = Path(name)
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"FAIL {path}: {exc}")
            failed = True
            continue
        errors, warnings = check(doc)
        print(f"{'FAIL' if errors else 'ok  '} {path}")
        for e in errors:
            print(f"     error: {e}")
        for w in warnings:
            print(f"     warning: {w}")
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
