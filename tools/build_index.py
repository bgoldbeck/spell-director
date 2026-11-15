"""Write templates/index.json, the list of templates the web viewer loads.

Run after adding or renaming a template:
    python tools/build_index.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"


def build() -> dict:
    files = sorted(p.relative_to(TEMPLATES).as_posix() for p in TEMPLATES.rglob("*.json") if p.name != "index.json")
    return {"templates": files}


def main() -> None:
    (TEMPLATES / "index.json").write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TEMPLATES / 'index.json'}")


if __name__ == "__main__":
    main()
