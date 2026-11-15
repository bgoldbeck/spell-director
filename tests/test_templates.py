import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from validate import check  # noqa: E402

TEMPLATES = sorted((ROOT / "templates").rglob("*.json"))


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
