"""update.sh brings a checkout up to date with main without discarding work."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("git") is None or shutil.which("sh") is None,
    reason="needs git and a POSIX shell",
)


def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def run_update(cwd):
    return subprocess.run(
        ["sh", "update.sh"], cwd=cwd, capture_output=True, text=True
    )


@pytest.fixture
def repos(tmp_path):
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    upstream = tmp_path / "upstream"
    git(tmp_path, "clone", "-q", str(remote), str(upstream))
    for repo_cfg in (("user.email", "t@example.com"), ("user.name", "t")):
        git(upstream, "config", *repo_cfg)
    for name in ("update.sh", "VERSION", "requirements-dev.txt"):
        shutil.copy(ROOT / name, upstream / name)
    git(upstream, "add", ".")
    git(upstream, "commit", "-qm", "init")
    git(upstream, "push", "-q", "origin", "main")
    git(upstream, "push", "-q", "origin", "main:feature")

    local = tmp_path / "local"
    git(tmp_path, "clone", "-q", str(remote), str(local))
    for repo_cfg in (("user.email", "t@example.com"), ("user.name", "t")):
        git(local, "config", *repo_cfg)
    git(local, "switch", "-q", "feature")

    (upstream / "notes.txt").write_text("new\n")
    git(upstream, "add", "notes.txt")
    git(upstream, "commit", "-qm", "add notes")
    git(upstream, "push", "-q", "origin", "main")
    git(upstream, "push", "-q", "origin", "--delete", "feature")
    return upstream, local


def test_switches_to_main_and_fast_forwards(repos):
    upstream, local = repos
    result = run_update(local)
    assert result.returncode == 0, result.stdout + result.stderr
    assert git(local, "branch", "--show-current") == "main"
    assert git(local, "rev-parse", "HEAD") == git(upstream, "rev-parse", "HEAD")
    assert "feature" in result.stdout  # reported as deleted on GitHub, but kept
    assert git(local, "branch", "--list", "feature")
    assert "Up to date" in result.stdout


def test_stops_on_uncommitted_changes(repos):
    _, local = repos
    before = git(local, "rev-parse", "HEAD")
    (local / "VERSION").write_text("changed\n")
    result = run_update(local)
    assert result.returncode == 1
    assert "uncommitted changes" in result.stdout
    assert git(local, "branch", "--show-current") == "feature"
    assert git(local, "rev-parse", "HEAD") == before
    assert (local / "VERSION").read_text() == "changed\n"


def test_stops_when_main_has_diverged(repos):
    upstream, local = repos
    git(local, "switch", "-q", "main")
    git(local, "commit", "-q", "--allow-empty", "-m", "local only")
    mine = git(local, "rev-parse", "HEAD")
    result = run_update(local)
    assert result.returncode == 1
    assert "can't be fast-forwarded" in result.stdout
    assert git(local, "rev-parse", "HEAD") == mine
