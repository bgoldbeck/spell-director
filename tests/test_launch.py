"""tools/launch.py: run.bat / run.sh pull updates safely before starting the viewer."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import launch  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repos(tmp_path, monkeypatch):
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    upstream = tmp_path / "upstream"
    git(tmp_path, "clone", "-q", str(remote), str(upstream))
    for cfg in (("user.email", "t@example.com"), ("user.name", "t")):
        git(upstream, "config", *cfg)
    (upstream / "VERSION").write_text("1\n")
    (upstream / "requirements-dev.txt").write_text("pytest\n")
    git(upstream, "add", ".")
    git(upstream, "commit", "-qm", "init")
    git(upstream, "push", "-q", "-u", "origin", "main")

    local = tmp_path / "local"
    git(tmp_path, "clone", "-q", str(remote), str(local))
    for cfg in (("user.email", "t@example.com"), ("user.name", "t")):
        git(local, "config", *cfg)
    monkeypatch.setattr(launch, "ROOT", local)
    return upstream, local


def push_change(upstream, name="notes.txt", text="new\n"):
    (upstream / name).write_text(text)
    git(upstream, "add", name)
    git(upstream, "commit", "-qm", f"change {name}")
    git(upstream, "push", "-q", "origin", "HEAD")


def test_pulls_new_commits(repos, capsys):
    upstream, local = repos
    push_change(upstream)
    assert launch.update() == "updated"
    assert git(local, "rev-parse", "HEAD") == git(upstream, "rev-parse", "HEAD")
    assert "pulled 1 new change." in capsys.readouterr().out


def test_up_to_date_does_nothing(repos):
    assert launch.update() == "current"


def test_mentions_changed_packages(repos, capsys):
    upstream, _ = repos
    push_change(upstream, "requirements-dev.txt", "pytest\nnumpy\n")
    assert launch.update() == "updated"
    assert "Python packages changed" in capsys.readouterr().out


def test_skips_with_uncommitted_changes(repos, capsys):
    upstream, local = repos
    push_change(upstream)
    before = git(local, "rev-parse", "HEAD")
    (local / "VERSION").write_text("mine\n")
    assert launch.update() == "skipped"
    assert git(local, "rev-parse", "HEAD") == before
    assert (local / "VERSION").read_text() == "mine\n"
    assert "uncommitted changes" in capsys.readouterr().out


def test_skips_when_local_commits_diverge(repos, capsys):
    upstream, local = repos
    push_change(upstream)
    git(local, "commit", "-q", "--allow-empty", "-m", "local only")
    mine = git(local, "rev-parse", "HEAD")
    assert launch.update() == "skipped"
    assert git(local, "rev-parse", "HEAD") == mine
    assert "can't be fast-forwarded" in capsys.readouterr().out


def test_skips_without_network(repos, capsys):
    _, local = repos
    git(local, "remote", "set-url", "origin", str(local.parent / "missing.git"))
    assert launch.update() == "skipped"
    assert "could not reach GitHub" in capsys.readouterr().out


def test_skips_branch_without_github_copy(repos, capsys):
    upstream, local = repos
    push_change(upstream)
    git(local, "switch", "-q", "-c", "scratch")
    assert launch.update() == "skipped"
    assert git(local, "branch", "--show-current") == "scratch"
    assert "no copy on GitHub" in capsys.readouterr().out


def test_skips_branch_deleted_on_github(repos, capsys):
    upstream, local = repos
    git(local, "push", "-q", "-u", "origin", "HEAD:feature")
    git(local, "switch", "-q", "-c", "feature", "--track", "origin/feature")
    git(upstream, "push", "-q", "origin", "--delete", "feature")
    assert launch.update() == "skipped"
    assert git(local, "branch", "--show-current") == "feature"


def test_not_a_checkout_is_quietly_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(launch, "ROOT", tmp_path)
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
    assert launch.update() == "skipped"


def test_starts_a_fresh_viewer_that_replaces_the_running_one(monkeypatch):
    calls = []
    monkeypatch.setattr(launch, "update", lambda: calls.append("update"))
    monkeypatch.setattr(launch.subprocess, "call", lambda cmd, cwd: calls.append(cmd[1:]) or 0)
    assert launch.main(["50123"]) == 0
    assert calls == ["update", [str(launch.ROOT / "tools" / "serve.py"), "--replace", "--open", "--port", "50123"]]
    calls.clear()
    assert launch.main(["--no-update"]) == 0
    assert calls == [[str(launch.ROOT / "tools" / "serve.py"), "--replace", "--open"]]
