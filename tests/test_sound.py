import copy
import json
import re
from pathlib import Path

from director import library

import validate

ROOT = Path(__file__).resolve().parent.parent
CUES = json.loads((ROOT / "web" / "sounds" / "cues.json").read_text(encoding="utf-8"))["cues"]
FIELDS = {"label", "category", "kind", "duration_ms", "describes", "words", "phases", "character", "sfx_prompt", "synth", "search", "samples"}
PHASES = {"anticipation", "release", "travel", "impact", "dissipation"}


def test_cue_library_entries_are_complete():
    assert len(CUES) >= 12
    for cue_id, cue in CUES.items():
        assert re.fullmatch(r"[a-z][a-z_]*", cue_id)
        assert FIELDS <= set(cue), cue_id
        assert cue["kind"] in {"one_shot", "sustained"}
        assert cue["duration_ms"] > 0
        assert cue["words"] and set(cue["phases"]) <= PHASES
        for sample in cue["samples"]:
            assert (ROOT / "web" / "sounds" / sample).is_file(), sample


def test_generic_categories_are_covered():
    for cue in ("buzz", "crackle", "fire", "crash", "whoosh", "boom", "impact", "splash", "stream", "squelch", "drain", "whisper", "drone"):
        assert cue in CUES


def test_every_cue_has_a_placeholder_recipe():
    src = (ROOT / "web" / "js" / "audio.js").read_text(encoding="utf-8")
    body = src[src.index("export const RECIPES"):src.index("// ---", src.index("export const RECIPES"))]
    recipes = set(re.findall(r"^  (\w+)\(v, t0, d\) \{", body, re.M))
    assert recipes == set(CUES)


def test_samples_are_credited():
    credits = (ROOT / "web" / "sounds" / "CREDITS.md").read_text(encoding="utf-8")
    for cue in CUES.values():
        for sample in cue["samples"]:
            assert Path(sample).name in credits, sample


def test_cue_vocabulary_is_documented():
    vocab = library.get_doc("vocabulary")
    fmt = library.get_doc("template-format")
    for cue_id in CUES:
        assert f"`{cue_id}`" in vocab, cue_id
        assert f"`{cue_id}`" in fmt, cue_id


def _with_cue(cue):
    doc = copy.deepcopy(library.get_template("lightning-sky-strike"))
    layer = next(x for x in doc["layers"] if x["type"] == "sound_cue")
    layer["params"]["cue"] = cue
    return doc


def test_validator_warns_on_unknown_cue():
    errors, warnings = validate.check(_with_cue("kazoo"))
    assert not errors
    assert any("unknown cue 'kazoo'" in w for w in warnings)
    errors, warnings = validate.check(_with_cue("buzz"))
    assert not errors and not any("cue" in w for w in warnings)


def test_get_sound_cues():
    out = library.get_sound_cues()
    assert set(out["cues"]) == set(CUES)
    assert "electric" in out["categories"] and "fire" in out["categories"]
    assert {"cue", "gain", "pitch", "offset_ms", "duration_ms", "repeat_ms"} == set(out["params"])
    assert set(out["params"]) == validate.KNOWN_PARAMS["sound_cue"]
    assert out["cues"]["splash"]["character"]["envelope"]
    assert "blood" in out["flavors"] and "dark" in out["flavors"]
    assert "Sound design vocabulary" in library.get_doc("sound-design")
    fire = library.get_sound_cues("fire")["cues"]
    assert set(fire) == {"ignite", "fire"}
