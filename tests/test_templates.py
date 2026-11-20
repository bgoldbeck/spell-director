import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from validate import check  # noqa: E402

TEMPLATES = sorted(p for p in (ROOT / "templates").rglob("*.json") if p.name != "index.json")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", TEMPLATES, ids=lambda p: p.stem)
def test_bundled_templates_are_valid(path):
    errors, warnings = check(load(path))
    assert errors == []
    assert warnings == []


def test_ids_are_unique():
    ids = [load(p)["id"] for p in TEMPLATES]
    assert len(ids) == len(set(ids))


@pytest.fixture
def base():
    return load(ROOT / "templates" / "lightning" / "sky-strike.json")


def test_rejects_beat_past_duration(base):
    doc = copy.deepcopy(base)
    doc["beats"][-1]["end_ms"] = doc["timing"]["duration_ms"] + 1
    errors, _ = check(doc)
    assert any("after duration" in e for e in errors)


def test_rejects_unknown_beat_reference(base):
    doc = copy.deepcopy(base)
    doc["layers"][0]["beats"] = ["nope"]
    errors, _ = check(doc)
    assert any("unknown beat" in e for e in errors)


def test_rejects_inverted_range(base):
    doc = copy.deepcopy(base)
    doc["layers"][0]["params"]["count"] = {"min": 9, "max": 2}
    errors, _ = check(doc)
    assert any("greater than max" in e for e in errors)


def test_rejects_keyframe_outside_active_beats(base):
    doc = copy.deepcopy(base)
    bolt = next(layer for layer in doc["layers"] if layer["id"] == "main-bolt")
    bolt["keyframes"][0]["t_ms"] = 10
    errors, _ = check(doc)
    assert any("outside its active beats" in e for e in errors)


def test_warns_on_unknown_param(base):
    doc = copy.deepcopy(base)
    doc["layers"][0]["params"]["sparkliness"] = 3
    errors, warnings = check(doc)
    assert errors == []
    assert any("sparkliness" in w for w in warnings)


def test_rejects_unknown_schema_version(base):
    doc = copy.deepcopy(base)
    doc["schema"] = "spelldirector.template/9.9.9"
    errors, _ = check(doc)
    assert errors


def test_requires_all_four_views(base):
    doc = copy.deepcopy(base)
    del doc["views"]["reads"]["top"]
    errors, _ = check(doc)
    assert any("top" in e for e in errors)


def test_template_index_is_current():
    sys.path.insert(0, str(ROOT / "tools"))
    from build_index import build

    index = json.loads((ROOT / "templates" / "index.json").read_text(encoding="utf-8"))
    assert index == build(), "run: python tools/build_index.py"


def test_decal_params_are_checked(base):
    doc = copy.deepcopy(base)
    scorch = next(layer for layer in doc["layers"] if layer["type"] == "decal")
    scorch["params"]["shape"] = "lava_lake"
    errors, _ = check(doc)
    assert any("lava_lake" in e for e in errors)
    scorch["params"]["shape"] = "rune_circle"
    scorch["params"]["opacity"] = 1.5
    errors, _ = check(doc)
    assert any("opacity" in e or "1.5" in e for e in errors)
    scorch["params"]["opacity"] = {"min": 0.6, "max": 0.9}
    scorch["params"]["spin_deg_per_s"] = 40
    errors, warnings = check(doc)
    assert not errors and not warnings


def test_every_template_has_a_ground_mark():
    for path in TEMPLATES:
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert any(layer["type"] == "decal" for layer in doc["layers"]), path.name


def test_status_effects_validate_coats_and_steady_sparks():
    doc = load(ROOT / "templates" / "ice" / "status-frozen.json")
    assert doc["archetype"] == "status"
    errors, warnings = check(doc)
    assert not errors and not warnings
    coat = next(layer for layer in doc["layers"] if layer["type"] == "coat")
    coat["params"]["glitter"] = 1
    errors, warnings = check(doc)
    assert not errors
    assert any("glitter" in w for w in warnings)
    # Steady sparks never come and go, so they need no lead-in before the loop.
    doc = load(ROOT / "templates" / "physical" / "status-dazed.json")
    halo = next(layer for layer in doc["layers"] if layer["id"] == "star-halo")
    halo["params"]["lifetime_ms"] = 5000
    errors, warnings = check(doc)
    assert not errors and not warnings
