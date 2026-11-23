"""Where SpellDirector's files live, from the source folder or the packaged exe.

Two places matter:

- The bundle: the read-only app files (web/, schemas/, docs/, the built-in
  templates/, VERSION). In the source folder this is the repo root; in the exe
  it is PyInstaller's unpack folder (sys._MEIPASS), which is temporary.
- The library: where the user's own files go (templates the director saves,
  sprite exports, GIF breakdowns). In the source folder this is the repo root
  too, so nothing changes there. In the exe it is a "SpellDirector Library"
  folder next to the exe, so saved spells outlive the temporary unpack folder.
  If that folder can't be written (the exe sits in Program Files or another
  read-only place), it is "SpellDirector Library" in the user's Documents
  instead. The SPELLDIRECTOR_LIBRARY environment variable (or the exe's
  --library flag) picks another folder.

Nothing here names a particular user: every path comes from where the exe is,
the environment or the operating system's Documents folder for whoever runs it.

When the two differ, the viewer and the director see the built-in templates
plus the user's, and a user template with the same path wins.
"""

from __future__ import annotations

import json
import os
import re
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
        beside = Path(sys.executable).resolve().parent / LIBRARY_FOLDER_NAME
        if _writable(beside):
            return beside
        return documents_dir() / LIBRARY_FOLDER_NAME
    return BUNDLE


_WRITABLE: dict[Path, bool] = {}


def _writable(folder: Path) -> bool:
    """True if files can be made in folder (created if missing). Remembered per folder."""
    if folder not in _WRITABLE:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe = folder / f".write-test-{os.getpid()}"
            probe.write_bytes(b"")
            probe.unlink()
            _WRITABLE[folder] = True
        except OSError:
            _WRITABLE[folder] = False
    return _WRITABLE[folder]


def documents_dir() -> Path:
    """The current user's Documents folder (follows OneDrive or a moved Documents
    folder on Windows), or their home folder if there is none."""
    if sys.platform == "win32":
        found = _windows_documents()
        if found:
            return found
    home = Path.home()
    docs = home / "Documents"
    return docs if docs.is_dir() else home


def _windows_documents() -> Path | None:
    try:
        import ctypes
        from ctypes import wintypes

        buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
        # CSIDL_PERSONAL (5) = Documents, wherever the user or OneDrive moved it.
        if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
            return Path(buf.value)
    except (AttributeError, OSError):
        pass
    return None


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


# Animation clips ("spelldirector.clip/1", web/js/engine/rig.js): Mixamo
# animations converted in the viewer, saved in the library's clips/ folder.
# They are the user's own files (Mixamo's terms don't allow sharing the
# animations themselves), so the repo ships none and ignores the folder.
CLIP_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def user_clips() -> Path:
    return library_root() / "clips"


def clip_index() -> dict:
    """The viewer's clip list: every clip name (file name without .json)."""
    folder = user_clips()
    names = sorted(p.stem for p in folder.glob("*.json") if CLIP_NAME.match(p.stem)) if folder.is_dir() else []
    return {"clips": names}


def find_clip_file(name: str) -> Path | None:
    """The clip file for a name, or None (bad name or no such file)."""
    if not CLIP_NAME.match(name or ""):
        return None
    target = user_clips() / f"{name}.json"
    return target if target.is_file() else None


def save_clip(name: str, clip: dict) -> Path:
    """Write a clip into the library's clips/ folder. Raises ValueError for a bad name or clip."""
    if not CLIP_NAME.match(name or ""):
        raise ValueError("clip names are lowercase letters, digits, - and _ (up to 64)")
    if not isinstance(clip, dict) or clip.get("format") != "spelldirector.clip/1" or not isinstance(clip.get("rotations"), dict):
        raise ValueError("not a spelldirector.clip/1 clip")
    folder = user_clips()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{name}.json"
    target.write_text(json.dumps(clip, separators=(",", ":")) + "\n", encoding="utf-8")
    return target

