import copy
import json
from pathlib import Path

import anyio
import pytest

from director import library

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_GIF = ROOT / "samples" / "synthetic-sky-strike.gif"


@pytest.fixture
def lib(tmp_path, monkeypatch):
    """A copy of the template library in a temp dir, so saving doesn't touch the repo."""
    templates = tmp_path / "templates"
    for src in (ROOT / "templates").rglob("*.json"):
        dst = templates / src.relative_to(ROOT / "templates")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(library, "ROOT", tmp_path)
    monkeypatch.setattr(library, "TEMPLATES", templates)
    monkeypatch.setattr(library, "BREAKDOWNS", tmp_path / "breakdowns")
    return tmp_path


@pytest.fixture
def new_template():
    doc = library.get_template("lightning-sky-strike")
    doc = copy.deepcopy(doc)
    doc["id"] = "lightning-test-strike"
    doc["name"] = "Test Strike"
    return doc


def test_list_shows_lines_and_aura_loops():
    auras = {t["id"]: t for t in library.list_templates(archetype="aura") if t["loop_range"]}
    assert auras["light-consecrated-aegis"]["line"] == "Paladin"
    assert auras["nature-verdant-bloom"]["loop_range"] == {"start_ms": 1200, "end_ms": 4200}


def test_list_and_filter():
    all_ids = {t["id"] for t in library.list_templates()}
    assert {"lightning-sky-strike", "lightning-chain-arc", "lightning-boss-storm-call"} <= all_ids
    chains = library.list_templates(archetype="chain")
    assert "lightning-chain-arc" in [t["id"] for t in chains]
    assert all(t["archetype"] == "chain" for t in chains)
    fire = library.list_templates(element="fire")
    assert {"fire-dragon-breath", "fire-meteor-strike"} <= {t["id"] for t in fire}
    assert all(t["element"] == "fire" for t in fire)
    assert {"wind-gale-shove", "wind-maelstrom", "wind-scythe-volley", "wind-tornado"} <= {t["id"] for t in library.list_templates(element="wind")}
    assert "psychic-mind-crush" in [t["id"] for t in library.list_templates(element="psychic")]
    assert {"ice-rime-ray", "ice-whiteout-gale"} <= {t["id"] for t in library.list_templates(element="ice")}
    assert library.list_templates(element="no-such-element") == []
    assert {"earth-ground-pound", "earth-rending-quake", "earth-rockfall", "earth-stone-spires"} <= {
        t["id"] for t in library.list_templates(element="earth")
    }


def test_get_template_and_missing():
    assert library.get_template("lightning-chain-arc")["archetype"] == "chain"
    with pytest.raises(library.LibraryError):
        library.get_template("nope")


def test_docs_and_schema():
    for name in library.DOC_FILES:
        assert library.get_doc(name).startswith("#")
    assert library.get_schema()["properties"]["schema"]["const"] == "spelldirector.template/0.1.0"
    with pytest.raises(library.LibraryError):
        library.get_doc("../README")


def test_validate_reports_errors(new_template):
    assert library.validate_template(new_template)["valid"]
    del new_template["views"]["reads"]["side"]
    result = library.validate_template(new_template)
    assert not result["valid"] and result["errors"]
    assert not library.validate_template([])["valid"]


def test_save_writes_file_and_index(lib, new_template):
    result = library.save_template(new_template)
    assert result["path"] == "templates/lightning/test-strike.json"
    assert result["preview_url"].endswith("?template=lightning-test-strike&view=three_quarter")
    saved = json.loads((lib / result["path"]).read_text(encoding="utf-8"))
    assert saved == new_template
    index = json.loads((lib / "templates" / "index.json").read_text(encoding="utf-8"))
    assert "lightning/test-strike.json" in index["templates"]


def test_save_refuses_invalid(lib, new_template):
    new_template["beats"][0]["end_ms"] = 99999
    with pytest.raises(library.LibraryError, match="invalid"):
        library.save_template(new_template)
    assert not (lib / "templates" / "lightning" / "test-strike.json").exists()


def test_save_needs_overwrite_to_revise(lib, new_template):
    library.save_template(new_template)
    new_template["name"] = "Revised"
    with pytest.raises(library.LibraryError, match="already exists"):
        library.save_template(new_template)
    result = library.save_template(new_template, overwrite=True)
    assert result["replaced"]
    assert library.get_template("lightning-test-strike")["name"] == "Revised"


def test_save_never_clobbers_a_different_template(lib, new_template):
    # A different template already sits where this one would be written.
    squatter = lib / "templates" / "lightning" / "test-strike.json"
    squatter.write_text(json.dumps({"id": "something-else"}), encoding="utf-8")
    with pytest.raises(library.LibraryError, match="already holds"):
        library.save_template(new_template, overwrite=True)
    assert json.loads(squatter.read_text(encoding="utf-8")) == {"id": "something-else"}


def test_breakdown_reference(lib):
    result = library.breakdown_reference(str(SAMPLE_GIF))
    assert result["out_dir"].endswith("synthetic-sky-strike")
    assert Path(result["images"]["contact_sheet"]).is_file()
    assert [p["phase"] for p in result["timing"]["phases"]][:2] == ["anticipation", "release"]
    with pytest.raises(library.LibraryError):
        library.breakdown_reference(str(SAMPLE_GIF), name="../escape")
    with pytest.raises(library.LibraryError):
        library.breakdown_reference(str(lib / "missing.gif"))


def test_mcp_server_end_to_end(lib, new_template):
    from mcp.client import Client

    from director.mcp_server import mcp

    async def run():
        async with Client(mcp) as c:
            tools = {t.name for t in (await c.list_tools()).tools}
            assert {"list_templates", "get_template", "get_vocabulary", "validate_template",
                    "save_template", "breakdown_gif", "get_sound_cues", "export_sprites", "export_spell_zip",
                    "export_gif"} <= tools
            uris = {str(r.uri) for r in (await c.list_resources()).resources}
            assert "spelldirector://docs/director-playbook" in uris
            prompt = await c.get_prompt("direct_spell", {"request": "heavy boss lightning"})
            assert "heavy boss lightning" in prompt.messages[0].content.text

            r = await c.call_tool("validate_template", {"template": new_template})
            assert not r.is_error and r.structured_content["valid"]
            r = await c.call_tool("save_template", {"template": new_template})
            assert not r.is_error and r.structured_content["saved"]
            r = await c.call_tool("save_template", {"template": new_template})
            assert r.is_error and "already exists" in r.content[0].text
            r = await c.call_tool("get_sound_cues", {"category": "electric"})
            assert not r.is_error and "buzz" in r.structured_content["cues"]
            r = await c.call_tool("get_template", {"template_id": "nope"})
            assert r.is_error and "no template" in r.content[0].text
            r = await c.call_tool("breakdown_gif", {"path": str(SAMPLE_GIF)})
            assert not r.is_error
            assert [x.type for x in r.content] == ["text", "image", "image"]

    anyio.run(run)


def test_breakdown_reference_video(lib, tmp_path):
    pytest.importorskip("av")
    import sample_gif

    mp4 = sample_gif.write_video(tmp_path / "ref.mp4", lead_in=25)
    result = library.breakdown_reference(str(mp4), start_s=1.0, end_s=2.2)
    assert result["gif"]["format"] == "video"
    assert result["timing"]["main_peak_ms"] == 400
    gif = library.breakdown_reference(str(SAMPLE_GIF), name="trimmed", start_s=0.2, end_s=0.8)
    assert gif["gif"]["trim"]["start_s"] == 0.2
    with pytest.raises(library.LibraryError, match="end must be after start"):
        library.breakdown_reference(str(SAMPLE_GIF), start_s=1.0, end_s=0.5)
