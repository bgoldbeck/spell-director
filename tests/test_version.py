import re
import subprocess
import sys
from pathlib import Path

import director

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import release_notes  # noqa: E402


def test_version_is_semver():
    assert re.fullmatch(r"\d+\.\d+\.\d+", director.__version__)


def test_changelog_has_section_for_current_version():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert "## [Unreleased]" in changelog
    assert release_notes.notes_for(director.__version__, changelog)


def test_notes_for_extracts_only_that_section():
    changelog = "# C\n\n## [Unreleased]\n\n## [0.2.0] - x\n\n- new\n\n## [0.1.0] - y\n\n- old\n"
    assert release_notes.notes_for("v0.2.0", changelog) == "- new"
    assert release_notes.notes_for("0.1.0", changelog) == "- old"
    assert release_notes.notes_for("0.3.0", changelog) is None


def test_cli_prints_current_notes():
    out = subprocess.run([sys.executable, str(ROOT / "tools" / "release_notes.py")],
                         capture_output=True, text=True, check=True).stdout
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert out.strip() == release_notes.notes_for(director.__version__, changelog)


def test_release_payload_uses_version_and_changelog():
    import release
    changelog = "## [Unreleased]\n\n## [1.2.3] - x\n\n- thing\n"
    payload = release.build_release("1.2.3", changelog)
    assert payload["tag_name"] == "v1.2.3"
    assert payload["target_commitish"] == "main"
    assert payload["body"] == "- thing"


def test_release_refuses_missing_changelog_section():
    import pytest
    import release
    with pytest.raises(SystemExit):
        release.build_release("9.9.9", "## [Unreleased]\n")


def test_release_dry_run_changes_nothing():
    out = subprocess.run([sys.executable, str(ROOT / "tools" / "release.py"), "--dry-run"],
                         capture_output=True, text=True, check=True).stdout
    assert f"v{director.__version__}" in out and "Would build and attach the exe" in out


def test_exe_build_bundles_viewer_and_templates():
    import build_exe
    args = build_exe.pyinstaller_args("1.2.3")
    joined = " ".join(args)
    assert "--onefile" in args and build_exe.exe_name("1.2.3") in args
    for item in ("web", "templates", "schemas", "docs", "VERSION"):
        assert str(ROOT / item) in joined
    # `exe --mcp` is the director: its package must be in, and Playwright (no driver in the exe) out.
    assert "director.mcp_server" in args and args[args.index("--exclude-module") + 1] == "playwright"
    assert args[-1].endswith("exe_main.py")
    # The Analyze page's breakdown (numpy, Pillow, PyAV) must be in the exe.
    assert args[args.index("--hidden-import") + 1] == "breakdown"
    assert "av" in args[args.index("--collect-submodules") + 1:]
    reqs = (ROOT / "requirements-build.txt").read_text()
    for pkg in ("pyinstaller", "numpy", "Pillow", "av", "mcp", "jsonschema"):
        assert f"\n{pkg}>=" in "\n" + reqs


def test_release_builds_then_creates_then_uploads(monkeypatch, tmp_path):
    import build_exe
    import release
    exe = tmp_path / "SpellDirector-x.exe"
    exe.write_bytes(b"MZ")
    calls = []

    def fake_api(method, path, token, payload=None, **kw):
        calls.append((method, path, kw.get("base", release.API)))
        if method == "GET":
            return 404, {}
        if path.endswith("/releases"):
            return 201, {"id": 7, "html_url": "https://example/r", "assets": []}
        return 201, {"browser_download_url": "https://example/a"}

    monkeypatch.setattr(release, "api", fake_api)
    monkeypatch.setattr(release, "find_token", lambda: "t")
    monkeypatch.setattr(build_exe, "build", lambda version=None: exe)
    assert release.main([]) == 0
    assert [c[0] for c in calls] == ["GET", "POST", "POST"]
    assert calls[2][1].startswith("/repos/bgoldbeck/spell-director/releases/7/assets?name=SpellDirector-x.exe")
    assert calls[2][2] == release.UPLOADS


def test_release_refuses_existing_release_before_building(monkeypatch):
    import build_exe
    import release
    monkeypatch.setattr(release, "api", lambda *a, **k: (200, {"html_url": "u", "assets": []}))
    monkeypatch.setattr(release, "find_token", lambda: "t")
    monkeypatch.setattr(build_exe, "build", lambda version=None: (_ for _ in ()).throw(AssertionError("built")))
    assert release.main([]) == 1


def test_exe_name_has_version():
    import build_exe
    assert build_exe.exe_name("0.2.0").startswith("SpellDirector-v0.2.0-")
