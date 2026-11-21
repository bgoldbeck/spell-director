"""Start SpellDirector from a checkout: update it, then run a fresh viewer.

    python tools/launch.py [port]          # what run.bat and run.sh call
    python tools/launch.py --no-update     # skip the update step

1. Update: if this folder is a git checkout with no uncommitted changes to
   tracked files, fetch from GitHub and fast-forward the current branch to its
   GitHub copy. Anything in the way (no git, no network, local changes, local
   commits, a branch with no GitHub copy) skips the update with a note: the
   viewer still starts. It never discards work and never switches branches;
   update.bat / update.sh do the fuller job (switch to main, packages).
2. Run: start tools/serve.py --replace-stale --open in a new process, so the
   code just pulled is the code that runs. Any viewer still running older code
   (or a stray copy on a nearby port) is closed first and a fresh one starts;
   one already on the latest code is kept and opened. Exactly one runs.

Set SPELLDIRECTOR_NO_UPDATE=1 to always skip the update.
Only the Python standard library is needed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FETCH_TIMEOUT = 30  # seconds: a slow or missing network must not hold up the launch
GIT_ENV = {
    "GIT_TERMINAL_PROMPT": "0",  # never stop to ask for a password
    "GCM_INTERACTIVE": "never",  # Git Credential Manager on Windows: no sign-in window
    "GIT_ASKPASS": "",
    "LC_ALL": "C",
}


def git(*args: str, timeout: float = 15) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, **GIT_ENV}, stdin=subprocess.DEVNULL)


def say(message: str) -> None:
    print(message, flush=True)


def update() -> str:
    """Try to bring the checkout up to date. Returns what happened, in a word:
    updated, current, or skipped. Never raises for git or network trouble."""
    if shutil.which("git") is None:
        say("Update skipped: Git was not found. Starting the copy you have.")
        return "skipped"
    try:
        if git("rev-parse", "--is-inside-work-tree").stdout.strip() != "true":
            return "skipped"  # a download, not a checkout: nothing to pull
        branch = git("branch", "--show-current").stdout.strip()
        if not branch:
            say("Update skipped: no branch is checked out. Run update.bat or ./update.sh to get back on main.")
            return "skipped"
        upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        if upstream.returncode != 0:
            say(f'Update skipped: branch "{branch}" has no copy on GitHub. Run update.bat or ./update.sh to get back on main.')
            return "skipped"
        if git("diff", "--quiet").returncode != 0 or git("diff", "--cached", "--quiet").returncode != 0:
            say("Update skipped: you have uncommitted changes. Starting the copy you have.")
            return "skipped"
        remote = upstream.stdout.strip().split("/", 1)[0]
        say("Checking GitHub for updates...")
        try:
            fetched = git("fetch", "--quiet", "--prune", remote, timeout=FETCH_TIMEOUT)
        except subprocess.TimeoutExpired:
            say("Update skipped: GitHub did not answer in time. Starting the copy you have.")
            return "skipped"
        if fetched.returncode != 0:
            say("Update skipped: could not reach GitHub. Starting the copy you have.")
            return "skipped"
        if git("rev-parse", "--verify", "--quiet", "@{u}").returncode != 0:
            say(f'Update skipped: branch "{branch}" was deleted on GitHub. Run update.bat or ./update.sh to get back on main.')
            return "skipped"
        behind = git("rev-list", "--count", "HEAD..@{u}").stdout.strip()
        if behind in ("", "0"):
            say("Already up to date.")
            return "current"
        if git("rev-list", "--count", "@{u}..HEAD").stdout.strip() not in ("", "0"):
            say(f'Update skipped: "{branch}" has commits that are not on GitHub, so it can\'t be fast-forwarded. '
                "Nothing was changed.")
            return "skipped"
        old_req = git("rev-parse", "HEAD:requirements-dev.txt").stdout.strip()
        merged = git("merge", "--ff-only", "--quiet", "@{u}")
        if merged.returncode != 0:
            reason = (merged.stderr.strip().splitlines() or ["git could not fast-forward"])[0]
            say(f"Update skipped: {reason}. Starting the copy you have.")
            return "skipped"
        say(f"Updated: pulled {behind} new change{'s' if behind != '1' else ''}.")
        if git("rev-parse", "HEAD:requirements-dev.txt").stdout.strip() != old_req:
            say("Python packages changed: run update.bat or ./update.sh to install them. The viewer still works.")
        return "updated"
    except (OSError, subprocess.SubprocessError) as exc:
        say(f"Update skipped: {exc}. Starting the copy you have.")
        return "skipped"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", type=int, help="port to serve on (default 47811)")
    ap.add_argument("--no-update", action="store_true", help="don't check GitHub for updates first")
    args = ap.parse_args(argv)
    if not args.no_update and os.environ.get("SPELLDIRECTOR_NO_UPDATE", "") in ("", "0"):
        update()
    cmd = [sys.executable, str(ROOT / "tools" / "serve.py"), "--replace-stale", "--open"]
    if args.port is not None:
        cmd += ["--port", str(args.port)]
    try:
        return subprocess.call(cmd, cwd=ROOT)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
