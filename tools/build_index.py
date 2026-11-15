"""Write templates/index.json, the list of templates the web viewer loads.

Run after adding or renaming a template:
    python tools/build_index.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# In the packaged exe, bundled files live under sys._MEIPASS.
ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
TEMPLATES = ROOT / "templates"


def build(templates: Path = TEMPLATES) -> dict:
    files = sorted(p.relative_to(templates).as_posix() for p in templates.rglob("*.json") if p.name != "index.json")
    return {"templates": files}


def main() -> None:
    (TEMPLATES / "index.json").write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TEMPLATES / 'index.json'}")


if __name__ == "__main__":
    main()
