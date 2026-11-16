"""The packaged exe as the director's MCP server: the user's library folder
next to the built-in templates, the --mcp entry point and the export jobs that
let the exe export sprites without Playwright."""

import copy
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import app_paths  # noqa: E402
import exe_main  # noqa: E402
import serve  # noqa: E402

from director import library  # noqa: E402


# ---------------------------------------------------------------- app_paths


def test_source_folder_uses_the_repo_for_everything(monkeypatch):
    monkeypatch.delenv(app_paths.LIBRARY_ENV, raising=False)
    assert app_paths.library_root() == app_paths.BUNDLE == ROOT
    assert app_paths.template_dirs() == [ROOT / "templates"]


def test_library_env_adds_a_user_folder_that_wins(tmp_path, monkeypatch):
    monkeypatch.setenv(app_paths.LIBRARY_ENV, str(tmp_path))
    user = tmp_path / "templates" / "lightning"
    user.mkdir(parents=True)
    (user / "sky-strike.json").write_text('{"id": "mine"}', encoding="utf-8")
    (user / "new-one.json").write_text('{"id": "new"}', encoding="utf-8")
    assert app_paths.template_dirs() == [tmp_path / "templates", ROOT / "templates"]
    index = app_paths.template_index()["templates"]
    assert "lightning/new-one.json" in index and "lightning/chain-arc.json" in index
    assert index.count("lightning/sky-strike.json") == 1
    assert app_paths.find_template_file("lightning/sky-strike.json") == (user / "sky-strike.json").resolve()
    assert app_paths.find_template_file("lightning/chain-arc.json") == (ROOT / "templates/lightning/chain-arc.json").resolve()
    assert app_paths.find_template_file("../VERSION") is None
    assert app_paths.find_template_file("lightning/nope.json") is None


def test_frozen_library_defaults_next_to_the_exe(tmp_path, monkeypatch):
    monkeypatch.delenv(app_paths.LIBRARY_ENV, raising=False)
    monkeypatch.setattr(app_paths, "FROZEN", True)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "SpellDirector.exe"))
    assert app_paths.library_root() == tmp_path.resolve() / "SpellDirector Library"


# ---------------------------------------------------------------- library over built-in templates


@pytest.fixture
def exe_lib(tmp_path, monkeypatch):
    """The library as the exe sees it: built-in templates read-only, the user's folder empty."""
    monkeypatch.setattr(library, "ROOT", tmp_path)
    monkeypatch.setattr(library, "TEMPLATES", tmp_path / "templates")
    monkeypatch.setattr(library, "BREAKDOWNS", tmp_path / "breakdowns")
    monkeypatch.setattr(library, "BUILTIN_TEMPLATES", ROOT / "templates")
    return tmp_path


def _variant(new_id):
    doc = copy.deepcopy(library.get_template("lightning-sky-strike"))
    doc["id"], doc["name"] = new_id, "Probe"
    return doc


def test_exe_library_lists_built_ins_and_saves_to_the_user_folder(exe_lib):
    before = {t["id"] for t in library.list_templates()}
    assert "lightning-sky-strike" in before
    res = library.save_template(_variant("lightning-probe-strike"))
    assert res["path"] == "templates/lightning/probe-strike.json"
    assert Path(res["file"]) == exe_lib / "templates" / "lightning" / "probe-strike.json"
    assert not (ROOT / "templates" / "lightning" / "probe-strike.json").exists()
    assert {t["id"] for t in library.list_templates()} == before | {"lightning-probe-strike"}


def test_exe_library_revises_a_built_in_in_the_user_folder(exe_lib):
    doc = copy.deepcopy(library.get_template("lightning-chain-arc"))
    with pytest.raises(library.LibraryError, match="overwrite"):
        library.save_template(doc)
    doc["name"] = "My Chain Arc"
    res = library.save_template(doc, overwrite=True)
    assert res["replaced"] and Path(res["file"]) == exe_lib / "templates" / "lightning" / "chain-arc.json"
    assert library.get_template("lightning-chain-arc")["name"] == "My Chain Arc"
    assert json.loads((ROOT / "templates/lightning/chain-arc.json").read_text(encoding="utf-8"))["name"] != "My Chain Arc"
    assert [t["id"] for t in library.list_templates()].count("lightning-chain-arc") == 1


def test_exe_library_refuses_a_new_id_at_a_built_in_path(exe_lib):
    doc = copy.deepcopy(library.get_template("lightning-sky-strike"))
    other = copy.deepcopy(doc)
    other["element"], other["id"] = "lightning", "sky-strike"  # would land on lightning/sky-strike.json
    with pytest.raises(library.LibraryError):
        library.save_template(other, overwrite=True)


def test_preview_links_follow_the_running_viewer(tmp_path, monkeypatch):
    monkeypatch.setenv("SPELLDIRECTOR_INSTANCE_DIR", str(tmp_path))
    url = exe_main.start_background_viewer()
    try:
        assert url and serve.is_viewer(url)
        assert library.viewer_url() == url
        import gc
        gc.collect()
        assert not serve.InstanceLock().acquire()  # still held by the background viewer
        assert exe_main.start_background_viewer() is None  # a second one stands aside
    finally:
        exe_main.stop_background_viewer()


# ---------------------------------------------------------------- --mcp entry point


def test_mcp_flag_runs_the_server_without_touching_stdout(tmp_path, monkeypatch, capsys):
    from director import mcp_server

    ran = []
    monkeypatch.setattr(mcp_server, "main", lambda: ran.append(True))
    monkeypatch.setattr(exe_main, "start_background_viewer", lambda: ran.append("viewer"))
    monkeypatch.delenv(app_paths.LIBRARY_ENV, raising=False)
    assert exe_main.main(["--mcp", "--library", str(tmp_path)]) == 0
    assert ran == ["viewer", True]
    assert app_paths.library_root() == tmp_path.resolve()
    monkeypatch.delenv(app_paths.LIBRARY_ENV)
    ran.clear()
    exe_main.main(["--mcp", "--no-viewer"])
    assert ran == [True]
    with pytest.raises(SystemExit):
        exe_main.main(["--mcp", "--help"])
    assert capsys.readouterr().out == ""


def test_viewer_mode_passes_its_flags_to_serve(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(serve, "main", lambda argv: seen.append(argv) or 0)
    monkeypatch.delenv(app_paths.LIBRARY_ENV, raising=False)
    exe_main.main(["--library", str(tmp_path), "--port", "50000"])
    assert seen == [["--open", "--port", "50000"]]
    assert app_paths.library_root() == tmp_path.resolve()
    monkeypatch.delenv(app_paths.LIBRARY_ENV)


# ---------------------------------------------------------------- export jobs


def test_export_job_round_trip():
    server = serve.bind("127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/api/export-job/"
    token, done, job = serve.add_export_job({"id": "lightning-sky-strike", "frame": 64})
    try:
        assert json.loads(urllib.request.urlopen(base + token).read()) == {"opts": {"id": "lightning-sky-strike", "frame": 64}}
        body = json.dumps({"manifest": {"x": 1}, "files": []}).encode()
        req = urllib.request.Request(base + token, data=body, headers={"Content-Type": "application/json"})
        assert json.loads(urllib.request.urlopen(req).read()) == {"ok": True}
        assert done.is_set() and job["result"] == {"manifest": {"x": 1}, "files": []}
        with pytest.raises(urllib.error.HTTPError) as err:  # only once
            urllib.request.urlopen(urllib.request.Request(base + token, data=body))
        assert err.value.code == 404
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.urlopen(base + "0" * 32)
        assert err.value.code == 404
    finally:
        serve.drop_export_job(token)
        server.shutdown()
        server.server_close()
