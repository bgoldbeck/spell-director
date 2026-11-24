"""Sprite sheet export (tools/export_sprites.py, library.export_sprites).

The end-to-end test needs Playwright and a browser and is skipped without them;
the layout, manifest and guide logic is covered by web-tests/spritesheet.test.mjs.
"""

import json

import pytest
from PIL import Image

from director import library

import export_sprites


def _browser_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            export_sprites._launch(p).close()
        return True
    except Exception:  # noqa: BLE001
        return False


def test_unknown_template_is_refused():
    with pytest.raises(library.LibraryError):
        library.export_sprites("no-such-spell")


def test_bad_frame_size_is_refused():
    with pytest.raises(library.LibraryError):
        library.export_sprites("lightning-sky-strike", frame=8)


def test_bad_view_is_refused():
    with pytest.raises(export_sprites.ExportError):
        export_sprites.export("lightning-sky-strike", views=["back"])


@pytest.mark.skipif(not _browser_available(), reason="needs Playwright and a browser")
def test_export_writes_layer_sheets_json_and_guide(tmp_path):
    res = export_sprites.export("lightning-sky-strike", seed=3, frame=64, fps=12,
                                views=["front", "top"], out=tmp_path)
    m = res["manifest"]
    names = {p.name for p in tmp_path.iterdir()}
    assert {"all.png", "layer-main-bolt.png", "lightning-sky-strike.spritesheet.json",
            "lightning-sky-strike.guide.md", "lightning-sky-strike.template.json"} <= names
    assert m["view_rows"] == ["front", "top"]
    assert m["frame_count"] == 14  # 1100 ms at 12 fps
    saved = json.loads((tmp_path / "lightning-sky-strike.spritesheet.json").read_text(encoding="utf-8"))
    assert saved == m
    for sheet in m["sheets"]:
        img = Image.open(tmp_path / sheet["image"])
        assert img.mode == "RGBA"
        assert img.size == (sheet["width"], sheet["height"])
        assert sheet["rows"] == 2 * sheet["blocks"]
        alpha = img.getchannel("A")
        assert alpha.getextrema()[0] == 0, "background is transparent"
        assert alpha.getextrema()[1] > 0, f"{sheet['image']} has something drawn"
    assert m["sheets"][0]["frame_count"] == m["frame_count"]
    guide = (tmp_path / "lightning-sky-strike.guide.md").read_text(encoding="utf-8")
    assert "layer-main-bolt.png" in guide and "Rebuild it in Godot" in guide
    # Sound: the cue sheet plus placeholder WAVs (whole mix and one per cue).
    sheet = json.loads((tmp_path / "lightning-sky-strike.sounds.json").read_text(encoding="utf-8"))
    assert sheet["format"] == "spelldirector-sounds-1"
    assert m["sound_files"] and "lightning-sky-strike.preview.wav" in m["sound_files"]
    for c in sheet["cues"]:
        assert c["file"] in names and c["prompt"]
    import wave
    with wave.open(str(tmp_path / "lightning-sky-strike.preview.wav")) as w:
        assert w.getnchannels() == 2 and w.getframerate() == 44100
        assert w.getnframes() / 44100 >= 1.1
    assert "## Sound" in guide and "sound-crack.wav" in guide


def test_zip_folder_packs_the_export_under_its_folder_name(tmp_path):
    folder = tmp_path / "spell-seed1"
    (folder / "render").mkdir(parents=True)
    (folder / "all.png").write_bytes(b"png")
    (folder / "render" / "PORTING.md").write_text("# port", encoding="utf-8")
    import zipfile

    z = export_sprites.zip_folder(folder)
    assert z == tmp_path / "spell-seed1-sprites.zip"
    with zipfile.ZipFile(z) as f:
        assert sorted(f.namelist()) == ["spell-seed1/all.png", "spell-seed1/render/PORTING.md"]
        assert f.read("spell-seed1/render/PORTING.md") == b"# port"
    # A folder target gets <folder>-sprites.zip; a .zip target is used as is.
    assert export_sprites.zip_folder(folder, tmp_path / "unity" / "imports") == tmp_path / "unity" / "imports" / "spell-seed1-sprites.zip"
    assert export_sprites.zip_folder(folder, tmp_path / "x.zip").is_file()
    assert not list(tmp_path.rglob("*.part"))


def test_export_spell_zip_refuses_unknown_template():
    with pytest.raises(library.LibraryError):
        library.export_spell_zip("no-such-spell")


@pytest.mark.skipif(not _browser_available(), reason="needs Playwright and a browser")
def test_export_spell_zip_has_everything(tmp_path, monkeypatch):
    import zipfile

    monkeypatch.setattr(export_sprites, "EXPORTS", tmp_path / "exports")
    res = library.export_spell_zip("lightning-chain-arc", seed=2, frame=48, fps=10, views=["front"],
                                   out_path=str(tmp_path / "out"))
    z = tmp_path / "out" / "lightning-chain-arc-seed2-sprites.zip"
    assert res["zip"] == str(z) and z.stat().st_size == res["size_bytes"]
    assert res["read_first"] == ["README.md", "lightning-chain-arc.guide.md", "render/PORTING.md"]
    with zipfile.ZipFile(z) as f:
        names = set(f.namelist())
    pre = "lightning-chain-arc-seed2/"
    for n in ("all.png", "lightning-chain-arc.guide.md", "lightning-chain-arc.spritesheet.json",
              "lightning-chain-arc.template.json", "lightning-chain-arc.caster.glb",
              "lightning-chain-arc.timeline.json", "render/PORTING.md", "render/arc.md",
              "range-guide/lightning-chain-arc-range-guide.png", "range-guide/lightning-chain-arc-range-guide.md"):
        assert pre + n in names, n
    assert {pre + c for c in res["contents"]} == names
    assert "every reference" in res["instructions"] and "warnings" not in res
    with zipfile.ZipFile(z) as f:
        guide = f.read(pre + "lightning-chain-arc.guide.md").decode("utf-8")
        data = json.loads(f.read(pre + "lightning-chain-arc.spritesheet.json"))
        readme = f.read(pre + "README.md").decode("utf-8")
    assert "lightning-chain-arc.guide.md" in readme and "do not be lazy" in readme
    assert guide.index("## Use every reference (required)") < guide.index("## How to use this export")
    ids = {it["id"] for it in data["reference_checklist"]}
    assert {"view-front", "sheet-all", "range-guide", "render-notes", "caster-rig"} <= ids
    for it in data["reference_checklist"]:
        for fname in it["files"]:
            if "/" in fname or fname.endswith((".png", ".json", ".md", ".glb", ".wav", ".ogg")):
                if " " not in fname:
                    assert pre + fname in names, f"checklist names {fname}, which is not in the zip"
