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
            path = sample["file"] if isinstance(sample, dict) else sample
            assert (ROOT / "web" / "sounds" / path).is_file(), path
            if isinstance(sample, dict):
                assert sample["size"] in {"small", "medium", "large"}
                assert sample["duration_ms"] > 0


def test_generic_categories_are_covered():
    for cue in ("buzz", "crackle", "fire", "crash", "whoosh", "boom", "impact", "splash", "stream", "squelch", "drain", "whisper", "drone"):
        assert cue in CUES


def test_every_cue_has_a_placeholder_recipe():
    src = (ROOT / "web" / "js" / "audio.js").read_text(encoding="utf-8")
    body = src[src.index("export const RECIPES"):src.index("// ---", src.index("export const RECIPES"))]
    recipes = set(re.findall(r"^  (\w+)\(v, t0, d\) \{", body, re.M))
    assert recipes == set(CUES)


def test_samples_are_credited():
    # Generated bank files are covered by one row; every recording needs its own.
    credits = (ROOT / "web" / "sounds" / "CREDITS.md").read_text(encoding="utf-8")
    assert "`bank/`" in credits
    for cue in CUES.values():
        for sample in cue["samples"]:
            path = sample["file"] if isinstance(sample, dict) else sample
            if not path.startswith("bank/"):
                assert Path(path).name in credits, path


def test_every_cue_has_a_full_sound_bank():
    import soundbank

    assert set(soundbank.RECIPES) == set(CUES)
    for cue_id, cue in CUES.items():
        bank = [s for s in cue["samples"] if isinstance(s, dict) and s["file"].startswith("bank/")]
        assert {s["size"] for s in bank} == {"small", "medium", "large"}, cue_id
        assert len(bank) >= 6, cue_id
        files = {p.name for p in (ROOT / "web" / "sounds" / "bank" / cue_id).iterdir()}
        assert files == {Path(s["file"]).name for s in bank}, cue_id


def test_sound_bank_renders_clean_takes():
    import numpy as np
    import soundbank

    for cue_id in ("crack", "fire", "charge", "swing"):
        cue = CUES[cue_id]
        a = soundbank.render(cue_id, cue["kind"], cue["duration_ms"], "m", 1)
        b = soundbank.render(cue_id, cue["kind"], cue["duration_ms"], "m", 1)
        c = soundbank.render(cue_id, cue["kind"], cue["duration_ms"], "m", 2)
        assert np.array_equal(a, b)  # deterministic
        assert not np.array_equal(a[:1000], c[:1000])  # takes differ
        assert abs(np.max(np.abs(a)) - 10 ** (-1 / 20)) < 1e-6  # -1 dBFS peak
        assert not np.isnan(a).any()
    one_shot = soundbank.render("crack", "one_shot", 450, "m", 1)
    assert np.max(np.abs(one_shot[:64])) > 0.05  # transient on the first samples
    small = soundbank.render("boom", "one_shot", 1200, "s", 1)
    large = soundbank.render("boom", "one_shot", 1200, "l", 1)
    assert len(large) > len(small)


def test_validator_checks_sound_size():
    doc = _with_cue("crack")
    layer = next(x for x in doc["layers"] if x["type"] == "sound_cue")
    layer["params"]["size"] = "large"
    errors, warnings = validate.check(doc)
    assert not errors and not any("size" in w for w in warnings)
    layer["params"]["size"] = "huge"
    _, warnings = validate.check(doc)
    assert any("size 'huge'" in w for w in warnings)


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
    assert {"cue", "gain", "pitch", "offset_ms", "duration_ms", "repeat_ms", "size"} == set(out["params"])
    assert set(out["params"]) == validate.KNOWN_PARAMS["sound_cue"]
    assert out["cues"]["splash"]["character"]["envelope"]
    assert "blood" in out["flavors"] and "dark" in out["flavors"]
    assert "Sound design vocabulary" in library.get_doc("sound-design")
    fire = library.get_sound_cues("fire")["cues"]
    assert set(fire) == {"ignite", "fire"}
