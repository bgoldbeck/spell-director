"""One-click setup of the director in AI apps (tools/client_setup.py), its
endpoints on the local server, and the exe's --setup flag."""

import json
import sys
import threading
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import app_paths  # noqa: E402
import client_setup as cs  # noqa: E402
import exe_main  # noqa: E402
import serve  # noqa: E402

EXE_ENTRY = {"command": r"C:\Apps\SpellDirector\SpellDirector-v9.9.9-windows.exe", "args": ["--mcp"]}


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Settings files of every AI app live under tmp_path; no `claude` command."""
    desktop = tmp_path / "AppData" / "Claude" / "claude_desktop_config.json"
    monkeypatch.setattr(cs, "claude_desktop_files", lambda: [desktop])
    monkeypatch.setattr(cs, "codex_file", lambda: tmp_path / ".codex" / "config.toml")
    monkeypatch.setattr(cs, "claude_code_file", lambda: tmp_path / ".claude.json")
    monkeypatch.setattr(cs, "claude_cli", lambda: None)
    monkeypatch.setattr(cs.shutil, "which", lambda name: None)
    return tmp_path


def _desktop(home):
    return home / "AppData" / "Claude" / "claude_desktop_config.json"


# ---------------------------------------------------------------- the entry


def test_source_entry_runs_this_python_on_the_repo():
    entry = cs.server_entry()
    assert entry["args"] == ["-m", "director.mcp_server"]
    assert entry["env"]["PYTHONPATH"] == str(ROOT)
    assert cs.server_entry("D:/Spells")["env"][app_paths.LIBRARY_ENV] == "D:/Spells"


def test_frozen_entry_is_this_exe_with_mcp(monkeypatch, tmp_path):
    monkeypatch.setattr(app_paths, "FROZEN", True)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "SpellDirector-v1.0.0-windows.exe"))
    assert cs.server_entry() == {"command": str(tmp_path / "SpellDirector-v1.0.0-windows.exe"), "args": ["--mcp"]}
    assert cs.server_entry("D:/Spells")["args"] == ["--mcp", "--library", "D:/Spells"]


# ---------------------------------------------------------------- Claude Desktop


def test_claude_desktop_is_merged_with_a_backup(home):
    path = _desktop(home)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}), encoding="utf-8")
    res = cs.setup_claude_desktop(EXE_ENTRY)
    assert res["ok"] and res["changed"] and "Quit" in res["message"]
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["mcpServers"] == {"other": {"command": "x"}, "spelldirector": EXE_ENTRY}
    assert data["theme"] == "dark"
    assert json.loads(path.with_name(path.name + ".bak").read_text(encoding="utf-8"))["mcpServers"] == {"other": {"command": "x"}}
    again = cs.setup_claude_desktop(EXE_ENTRY)
    assert again["ok"] and not again["changed"]


def test_claude_desktop_file_is_created_when_missing(home):
    res = cs.setup_claude_desktop(EXE_ENTRY)
    assert res["ok"] and res["changed"]
    assert json.loads(_desktop(home).read_text(encoding="utf-8")) == {"mcpServers": {"spelldirector": EXE_ENTRY}}


def test_broken_claude_desktop_file_is_left_alone(home):
    path = _desktop(home)
    path.parent.mkdir(parents=True)
    path.write_text("{ not json", encoding="utf-8")
    res = cs.setup_claude_desktop(EXE_ENTRY)
    assert not res["ok"] and "isn't valid JSON" in res["message"]
    assert path.read_text(encoding="utf-8") == "{ not json"


# ---------------------------------------------------------------- Codex


def test_codex_gets_a_table_with_a_long_startup_timeout(home):
    cfg = home / ".codex" / "config.toml"
    cfg.parent.mkdir()
    cfg.write_text('model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "npx"\n', encoding="utf-8")
    res = cs.setup_codex(EXE_ENTRY)
    assert res["ok"] and res["changed"]
    data = tomllib.loads(cfg.read_text(encoding="utf-8"))
    assert data["model"] == "gpt-5" and data["mcp_servers"]["other"] == {"command": "npx"}
    mine = data["mcp_servers"]["spelldirector"]
    assert mine["command"] == EXE_ENTRY["command"] and mine["args"] == ["--mcp"]
    assert mine["startup_timeout_sec"] == cs.CODEX_STARTUP_TIMEOUT
    assert not cs.setup_codex(EXE_ENTRY)["changed"]


def test_codex_table_is_replaced_in_place(home):
    cfg = home / ".codex" / "config.toml"
    cfg.parent.mkdir()
    cfg.write_text('[mcp_servers.spelldirector]\ncommand = "C:\\\\old\\\\SpellDirector-v0.1.0-windows.exe"\n'
                   'args = ["--mcp"]\n\n[mcp_servers.spelldirector.env]\nX = "1"\n\n[profiles.fast]\nmodel = "o4"\n',
                   encoding="utf-8")
    source = {"command": "C:/py/python.exe", "args": ["-m", "director.mcp_server"], "env": {"PYTHONPATH": "C:/src"}}
    assert cs.setup_codex(source)["changed"]
    data = tomllib.loads(cfg.read_text(encoding="utf-8"))
    assert data["mcp_servers"]["spelldirector"]["env"] == {"PYTHONPATH": "C:/src"}
    assert data["profiles"]["fast"] == {"model": "o4"}
    assert cfg.read_text(encoding="utf-8").count("[mcp_servers.spelldirector") == 1


# ---------------------------------------------------------------- Claude Code


def test_claude_code_uses_its_own_command(home, monkeypatch):
    calls = []

    class Done:
        returncode, stdout, stderr = 0, "", ""

    monkeypatch.setattr(cs, "claude_cli", lambda: "claude")
    monkeypatch.setattr(cs.subprocess, "run", lambda args, **kw: calls.append(args) or Done())
    res = cs.setup_claude_code(EXE_ENTRY)
    assert res["ok"] and res["changed"]
    assert calls[0] == ["claude", "mcp", "remove", "--scope", "user", "spelldirector"]
    assert calls[1] == ["claude", "mcp", "add", "--scope", "user", "spelldirector", "--", EXE_ENTRY["command"], "--mcp"]


def test_claude_code_missing_is_reported(home):
    res = cs.setup_claude_code(EXE_ENTRY)
    assert not res["ok"] and "isn't installed" in res["message"]


# ---------------------------------------------------------------- status, setup(), refresh()


def test_status_and_default_setup(home):
    st = cs.status(EXE_ENTRY)
    assert set(st) == set(cs.CLIENTS)
    assert not st["claude-desktop"]["found"] and not st["codex"]["found"]
    results = cs.setup(None, EXE_ENTRY)  # nothing installed: still prepares Claude Desktop
    assert [r["client"] for r in results] == ["claude-desktop"]
    st = cs.status(EXE_ENTRY)
    assert st["claude-desktop"]["found"] and st["claude-desktop"]["current"]


def test_refresh_follows_a_new_exe_and_keeps_the_old_library(home, monkeypatch, tmp_path):
    old_dir = tmp_path / "old"
    (old_dir / app_paths.LIBRARY_FOLDER_NAME).mkdir(parents=True)
    old = {"command": str(old_dir / "SpellDirector-v0.7.0-windows.exe"), "args": ["--mcp"]}
    cs.setup_claude_desktop(old)
    (home / ".codex").mkdir()
    cs.setup_codex(old)
    new = {"command": str(tmp_path / "new" / "SpellDirector-v0.8.0-windows.exe"), "args": ["--mcp"]}
    assert set(cs.refresh(new)) == {"Claude Desktop", "Codex / ChatGPT desktop app"}
    entry = json.loads(_desktop(home).read_text(encoding="utf-8"))["mcpServers"]["spelldirector"]
    assert entry["command"] == new["command"]
    assert entry["args"] == ["--mcp", "--library", str(old_dir / app_paths.LIBRARY_FOLDER_NAME)]
    assert cs.refresh(new) == []  # already following


def test_refresh_leaves_hand_made_entries_alone(home):
    cs.setup_claude_desktop({"command": "python", "args": ["-m", "director.mcp_server"]})
    assert cs.refresh(EXE_ENTRY) == []
    entry = json.loads(_desktop(home).read_text(encoding="utf-8"))["mcpServers"]["spelldirector"]
    assert entry["command"] == "python"


def test_refresh_does_nothing_from_the_source_folder():
    assert cs.refresh() == []


def test_exe_setup_flag_runs_the_setup(monkeypatch):
    seen = []
    monkeypatch.setattr(cs, "main", lambda argv: seen.append(argv) or 0)
    assert exe_main.main(["--setup", "--status"]) == 0
    assert seen == [["--status"]]


# ---------------------------------------------------------------- the server


@pytest.fixture
def base(monkeypatch):
    server = serve.bind("127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _open(req):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=10) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def test_setup_info_endpoint(home, base):
    status, body = _open(base + "/api/setup")
    info = json.loads(body)
    assert status == 200 and info["version"] == serve.VERSION and set(info["clients"]) == set(cs.CLIENTS)
    assert info["command"] == cs.server_entry()["command"]


def test_setup_post_needs_our_header_and_a_local_origin(home, base, monkeypatch):
    calls = []
    monkeypatch.setattr(cs, "setup", lambda clients=None, entry=None: calls.append(clients) or [])
    body = json.dumps({"clients": ["claude-desktop"]}).encode()

    def post(headers):
        return _open(urllib.request.Request(base + "/api/setup", data=body, method="POST", headers=headers))[0]

    assert post({}) == 403
    assert post({"X-SpellDirector": "setup", "Origin": "https://evil.example"}) == 403
    assert post({"X-SpellDirector": "setup", "Host": "evil.example"}) == 403
    assert calls == []
    assert post({"X-SpellDirector": "setup", "Origin": base}) == 200
    assert calls == [["claude-desktop"]]


def test_director_docs_are_served_for_ai_chats(base):
    status, body = _open(base + "/docs/vocabulary.md")
    assert status == 200 and body == (ROOT / "docs" / "vocabulary.md").read_bytes()
    assert _open(base + "/docs/template-schema.json")[0] == 200
    assert _open(base + "/docs/releasing.md")[0] == 404
    assert _open(base + "/docs/..%2FVERSION")[0] == 404
