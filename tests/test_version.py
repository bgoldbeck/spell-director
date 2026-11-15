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
    assert "First versioned release" in out


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
    assert f"v{director.__version__}" in out and "First versioned release" in out
