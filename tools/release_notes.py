"""Print the CHANGELOG.md section for one version, for GitHub release notes.

    python tools/release_notes.py 0.1.0     # or v0.1.0
    python tools/release_notes.py           # the version in VERSION

Exits non-zero if the changelog has no section for that version.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def current_version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def notes_for(version: str, changelog: str) -> str | None:
    version = version.removeprefix("v")
    heading = re.compile(rf"^## \[{re.escape(version)}\]", re.M)
    match = heading.search(changelog)
    if not match:
        return None
    rest = changelog[match.end():]
    body_start = rest.find("\n") + 1 if "\n" in rest else len(rest)
    nxt = re.search(r"^## \[", rest[body_start:], re.M)
    body = rest[body_start: body_start + nxt.start()] if nxt else rest[body_start:]
    return body.strip()


def main(argv: list[str]) -> int:
    version = argv[1] if len(argv) > 1 else current_version()
    notes = notes_for(version, (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
    if not notes:
        print(f"CHANGELOG.md has no section for {version}", file=sys.stderr)
        return 1
    print(notes)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
