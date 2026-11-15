"""Where SpellDirector's files live, from the source folder or the packaged exe.

Two places matter:

- The bundle: the read-only app files (web/, schemas/, docs/, the built-in
  templates/, VERSION). In the source folder this is the repo root; in the exe
  it is PyInstaller's unpack folder (sys._MEIPASS), which is temporary.
- The library: where the user's own files go (templates the director saves,
  sprite exports, GIF breakdowns). In the source folder this is the repo root
  too, so nothing changes there. In the exe it is a "SpellDirector Library"
  folder next to the exe, so saved spells outlive the temporary unpack folder.
  The SPELLDIRECTOR_LIBRARY environment variable (or the exe's --library flag)
  picks another folder.

When the two differ, the viewer and the director see the built-in templates
plus the user's, and a user template with the same path wins.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BUNDLE = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
FROZEN = hasattr(sys, "_MEIPASS")
LIBRARY_ENV = "SPELLDIRECTOR_LIBRARY"
LIBRARY_FOLDER_NAME = "SpellDirector Library"


def library_root() -> Path:
    """The folder for the user's templates, exports and breakdowns."""
    env = os.environ.get(LIBRARY_ENV)
    if env:
        return Path(env).expanduser().resolve()
    if FROZEN:
        return Path(sys.executable).resolve().parent / LIBRARY_FOLDER_NAME
    return BUNDLE


def user_templates() -> Path:
    return library_root() / "templates"


def builtin_templates() -> Path:
    return BUNDLE / "templates"


def template_dirs() -> list[Path]:
    """Template folders to read, user first. One folder when they are the same."""
    user, builtin = user_templates(), builtin_templates()
    if user.resolve() == builtin.resolve():
        return [builtin]
    return [user, builtin]


def template_index(dirs: list[Path] | None = None) -> dict:
    """The viewer's index: every template file (relative path) across the folders."""
    files: set[str] = set()
    for folder in dirs or template_dirs():
        if folder.is_dir():
            files.update(p.relative_to(folder).as_posix() for p in folder.rglob("*.json") if p.name != "index.json")
    return {"templates": sorted(files)}


def find_template_file(rel: str, dirs: list[Path] | None = None) -> Path | None:
    """The file for a template path relative to templates/, user folder first.
    None if it is in no folder or the path escapes them."""
    for folder in dirs or template_dirs():
        base = folder.resolve()
        target = (base / rel).resolve()
        if base in target.parents and target.is_file():
            return target
    return None
