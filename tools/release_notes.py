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


# Added under every GitHub release's notes, so someone who just found the
# download knows what to do with it. Keep it in step with docs/setup.md.
RELEASE_FOOTER = """\
---

**New here?** Download `SpellDirector-v{version}-windows.exe` below, put it in its own folder and double-click it (if Windows SmartScreen warns you: **More info**, then **Run anyway**). In the viewer that opens, click **? Help**, then **Connect** next to Claude Desktop, Claude Code or Codex, and restart that app. Then ask it: *"List the SpellDirector spells."* Step-by-step guide, with prompts to paste into ChatGPT or Claude if you want help: [docs/setup.md](https://github.com/bgoldbeck/spell-director/blob/v{version}/docs/setup.md).

**Updating?** Save the new exe in the same folder as the old one and double-click it once. Your connected AI apps switch to it; restart them."""


def release_body(version: str, changelog: str) -> str | None:
    """The GitHub release notes: the changelog section plus the getting-started footer."""
    notes = notes_for(version, changelog)
    if not notes:
        return None
    return notes + "\n\n" + RELEASE_FOOTER.format(version=version.removeprefix("v"))


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
