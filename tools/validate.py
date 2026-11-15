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
        "afterimage_ms", "glow_px",
    },
    "glow": {"radius_px", "softness", "pulse_hz"},
    "flash": {"scope", "radius_px", "peak"},
    "sparks": {
        "count", "speed", "speed_spread", "gravity", "lifetime_ms", "size_px", "spread_deg", "drag", "emit_ms", "streak_ms", "look", "glow",
        "gather_px", "swirl", "emit_radius_px", "wind_px",
    },
    "crackle": {"count", "length_px", "jaggedness", "regen_ms", "radius_px"},
    "orb": {
        "radius_px", "pulse_hz", "wobble", "crackle_count", "trail_ms", "arc_height_px", "travel_ease", "look", "height_px", "bubble",
        "approach_deg", "approach_yaw_deg", "smoke_trail_ms", "smoke_opacity", "crescent_deg", "tilt_deg",
        "side_offset_px",
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
    "ring": {"start_radius_px", "end_radius_px", "thickness_px", "softness", "arc_deg", "ease"},
    "eruption": {
        "shape", "arc_deg", "rows", "start_radius_px", "end_radius_px", "row_delay_ms", "delay_growth", "growth",
        "height_px", "width_px", "spacing_px", "tilt_deg", "jitter", "rise_ms", "hold_ms", "sink_ms", "debris_count",
        "debris_speed", "debris_size_px", "gravity", "dust", "dust_size_px", "dust_life_ms",
    },
    "decal": {
        "radius_px", "shape", "opacity", "fade_in_ms", "lifetime_ms", "fade_ms", "grow_ms", "start_scale",
        "rotation_deg", "spin_deg_per_s", "stretch", "pulse_hz", "detail", "arc_deg", "reveal_ms",
    },
    "smoke": {"count", "rise_speed", "size_px", "lifetime_ms", "opacity", "spread_speed", "spread_px"},
    "light": {"radius", "energy"},
    "camera_shake": {"amplitude_px", "frequency_hz", "decay"},
    "sound_cue": {"cue", "gain", "pitch", "offset_ms", "duration_ms", "repeat_ms"},
}

# Layer types that draw nothing, so they take no shader intent.
NO_SHADER = {"sound_cue", "camera_shake"}

CUE_LIBRARY = ROOT / "web" / "sounds" / "cues.json"


def known_cues() -> dict:
    """The sound cue library (web/sounds/cues.json): cue id -> definition."""
    return json.loads(CUE_LIBRARY.read_text(encoding="utf-8"))["cues"]


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

    for layer in doc["layers"]:
        lid = layer["id"]
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

    for path, rng in _ranges(doc):
        if rng["min"] > rng["max"]:
            errors.append(f"{path}: min {rng['min']} is greater than max {rng['max']}")

    return errors, warnings


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
