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

ROOT = Path(__file__).resolve().parent.parent
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
        "count", "speed", "speed_spread", "gravity", "lifetime_ms", "size_px", "spread_deg", "drag",
    },
    "crackle": {"count", "length_px", "jaggedness", "regen_ms", "radius_px"},
    "orb": {"radius_px", "pulse_hz", "wobble", "crackle_count"},
    "beam": {"width_px", "wobble", "wobble_hz", "jaggedness", "regen_ms"},
    "ring": {"start_radius_px", "end_radius_px", "thickness_px", "softness"},
    "decal": {"radius_px", "shape", "fade_ms"},
    "smoke": {"count", "rise_speed", "size_px", "lifetime_ms", "opacity"},
    "light": {"radius", "energy"},
    "camera_shake": {"amplitude_px", "frequency_hz", "decay"},
    "sound_cue": {"cue"},
}


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
