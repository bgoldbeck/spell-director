"""Publish a GitHub Release for the version in VERSION. No GitHub Actions.

    python tools/release.py            # build the exe, create release vX.Y.Z on main, attach the exe
    python tools/release.py --dry-run  # show what would be published
    python tools/release.py --no-exe   # release without building/attaching the exe
    python tools/release.py --attach   # build the exe and add it to the existing vX.Y.Z release

It reads VERSION and that version's CHANGELOG.md section, then calls the
GitHub REST API. GitHub creates the tag on its side, on the latest commit
of main, so nothing needs to be pushed.

Token, first found wins:
  1. GH_TOKEN or GITHUB_TOKEN environment variable
  2. `gh auth token`, if the GitHub CLI is installed and signed in
The token needs "Contents: read and write" on this repository.

Building the exe needs PyInstaller (requirements-build.txt); see tools/build_exe.py.
Stops without changing anything if the release already exists (unless --attach).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_notes import current_version, release_body  # noqa: E402

REPO = "bgoldbeck/spell-director"
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"


def build_release(version: str, changelog: str, target: str = "main") -> dict:
    notes = release_body(version, changelog)
    if not notes:
        raise SystemExit(f"CHANGELOG.md has no section for {version}; add one first")
    tag = f"v{version}"
    return {"tag_name": tag, "target_commitish": target, "name": f"SpellDirector {tag}",
            "body": notes, "draft": False, "prerelease": False}


def find_gh() -> str | None:
    """The GitHub CLI: on PATH, or in its default Windows install folder (the
    installer adds it to PATH only for new windows and apps)."""
    found = shutil.which("gh")
    if found:
        return found
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            for sub in ("GitHub CLI", "Programs/GitHub CLI"):
                exe = Path(base) / sub / "gh.exe"
                if exe.is_file():
                    return str(exe)
    return None


def find_token() -> str | None:
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(name):
            return os.environ[name].strip()
    gh = find_gh()
    if gh:
        out = subprocess.run([gh, "auth", "token"], capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    return None


def api(method: str, path: str, token: str, payload: dict | None = None, *,
        base: str = API, data: bytes | None = None,
        content_type: str = "application/json") -> tuple[int, dict]:
    if payload is not None:
        data = json.dumps(payload).encode()
    req = urllib.request.Request(
        base + path, method=method, data=data,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "spelldirector-release",
                 "Content-Type": content_type})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        body = err.read()
        try:
            return err.code, json.loads(body or b"{}")
        except ValueError:
            return err.code, {"message": body.decode(errors="replace")}


def upload_asset(repo: str, release_id: int, path: Path, token: str) -> str:
    """Upload one file to a release and return its download URL."""
    query = urllib.parse.urlencode({"name": path.name})
    status, asset = api("POST", f"/repos/{repo}/releases/{release_id}/assets?{query}", token,
                        base=UPLOADS, data=path.read_bytes(), content_type="application/octet-stream")
    if status != 201:
        raise SystemExit(f"Could not upload {path.name}: {status} {asset.get('message')} {asset.get('errors', '')}")
    return asset["browser_download_url"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print the release, change nothing")
    ap.add_argument("--target", default="main", help="branch or commit to tag (default: main)")
    ap.add_argument("--repo", default=REPO, help=f"owner/name (default: {REPO})")
    ap.add_argument("--no-exe", action="store_true", help="don't build or attach the exe")
    ap.add_argument("--attach", action="store_true",
                    help="add the exe to the already-published release for VERSION")
    args = ap.parse_args(argv)

    release = build_release(current_version(), (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"),
                            args.target)
    tag = release["tag_name"]
    if args.dry_run:
        print(f"Would publish {release['name']} ({tag} on {args.target}) to {args.repo}:\n")
        print(release["body"])
        print("\n" + ("No exe (--no-exe)." if args.no_exe else
                      "Would build and attach the exe (tools/build_exe.py)."))
        return 0

    token = find_token()
    if not token:
        print("No GitHub token. Set GH_TOKEN, or install the GitHub CLI and run `gh auth login`.",
              file=sys.stderr)
        return 2

    status, existing = api("GET", f"/repos/{args.repo}/releases/tags/{tag}", token)
    if status not in (200, 404):
        print(f"GitHub said {status}: {existing.get('message')}", file=sys.stderr)
        return 1
    if args.attach and status != 200:
        print(f"{tag} isn't released yet; run without --attach", file=sys.stderr)
        return 1
    if not args.attach and status == 200:
        print(f"{tag} is already released: {existing.get('html_url')}", file=sys.stderr)
        print("Bump VERSION and add a CHANGELOG section for the next release,", file=sys.stderr)
        print("or use --attach to add the exe to it.", file=sys.stderr)
        return 1

    # Build first, so a failed build never leaves a half-made release.
    exe = None
    if not args.no_exe:
        import build_exe
        exe = build_exe.build(current_version())

    if args.attach:
        target = existing
    else:
        status, target = api("POST", f"/repos/{args.repo}/releases", token, release)
        if status != 201:
            print(f"Could not create {tag}: {status} {target.get('message')} {target.get('errors', '')}",
                  file=sys.stderr)
            return 1
        print(f"Published {release['name']}: {target['html_url']}")

    if exe:
        taken = {a.get("name") for a in target.get("assets", [])}
        if exe.name in taken:
            print(f"{exe.name} is already attached to {tag}", file=sys.stderr)
            return 1
        print(f"Uploading {exe.name} ...", flush=True)
        print(f"Attached: {upload_asset(args.repo, target['id'], exe, token)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
