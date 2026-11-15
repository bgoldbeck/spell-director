"""Publish a GitHub Release for the version in VERSION. No GitHub Actions.

    python tools/release.py            # create release vX.Y.Z on main
    python tools/release.py --dry-run  # show what would be published

It reads VERSION and that version's CHANGELOG.md section, then calls the
GitHub REST API. GitHub creates the tag on its side, on the latest commit
of main, so nothing needs to be pushed.

Token, first found wins:
  1. GH_TOKEN or GITHUB_TOKEN environment variable
  2. `gh auth token`, if the GitHub CLI is installed and signed in
The token needs "Contents: read and write" on this repository.

Stops without changing anything if the release already exists.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_notes import current_version, notes_for  # noqa: E402

REPO = "bgoldbeck/spell-director"
API = "https://api.github.com"


def build_release(version: str, changelog: str, target: str = "main") -> dict:
    notes = notes_for(version, changelog)
    if not notes:
        raise SystemExit(f"CHANGELOG.md has no section for {version}; add one first")
    tag = f"v{version}"
    return {"tag_name": tag, "target_commitish": target, "name": f"SpellDirector {tag}",
            "body": notes, "draft": False, "prerelease": False}


def find_token() -> str | None:
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(name):
            return os.environ[name].strip()
    gh = shutil.which("gh")
    if gh:
        out = subprocess.run([gh, "auth", "token"], capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    return None


def api(method: str, path: str, token: str, payload: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "spelldirector-release",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        body = err.read()
        try:
            return err.code, json.loads(body or b"{}")
        except ValueError:
            return err.code, {"message": body.decode(errors="replace")}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print the release, change nothing")
    ap.add_argument("--target", default="main", help="branch or commit to tag (default: main)")
    ap.add_argument("--repo", default=REPO, help=f"owner/name (default: {REPO})")
    args = ap.parse_args(argv)

    release = build_release(current_version(), (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"),
                            args.target)
    tag = release["tag_name"]
    if args.dry_run:
        print(f"Would publish {release['name']} ({tag} on {args.target}) to {args.repo}:\n")
        print(release["body"])
        return 0

    token = find_token()
    if not token:
        print("No GitHub token. Set GH_TOKEN, or install the GitHub CLI and run `gh auth login`.",
              file=sys.stderr)
        return 2

    status, existing = api("GET", f"/repos/{args.repo}/releases/tags/{tag}", token)
    if status == 200:
        print(f"{tag} is already released: {existing.get('html_url')}", file=sys.stderr)
        print("Bump VERSION and add a CHANGELOG section for the next release.", file=sys.stderr)
        return 1
    if status != 404:
        print(f"GitHub said {status}: {existing.get('message')}", file=sys.stderr)
        return 1

    status, created = api("POST", f"/repos/{args.repo}/releases", token, release)
    if status != 201:
        print(f"Could not create {tag}: {status} {created.get('message')} {created.get('errors', '')}",
              file=sys.stderr)
        return 1
    print(f"Published {release['name']}: {created['html_url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
