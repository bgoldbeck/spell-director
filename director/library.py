"""The director's library: plain Python functions over the template library,
the docs and the breakdown tool.

The MCP server (director/mcp_server.py) is a thin adapter over these, and
they can be used directly from Python or tests. See docs/director-playbook.md.
"""

from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# The app's own files (in the packaged exe, PyInstaller's unpack folder).
BUNDLE = Path(__file__).resolve().parent.parent

if str(BUNDLE / "tools") not in sys.path:
    sys.path.insert(0, str(BUNDLE / "tools"))

import app_paths  # noqa: E402

# The user's files: the repo root from source, a folder next to the exe when
# packaged (see tools/app_paths.py). Saved templates and outputs go here.
ROOT = app_paths.library_root()
TEMPLATES = ROOT / "templates"
BREAKDOWNS = ROOT / "breakdowns"
# Read-only templates shipped with the exe; None when they are TEMPLATES itself.
BUILTIN_TEMPLATES = None if app_paths.builtin_templates().resolve() == TEMPLATES.resolve() else app_paths.builtin_templates()
DOCS = BUNDLE / "docs"
SCHEMAS = BUNDLE / "schemas"

import breakdown as _breakdown  # noqa: E402
import build_index as _build_index  # noqa: E402
import export_sprites as _export_sprites  # noqa: E402
import sheet_cells as _sheet_cells  # noqa: E402
import validate as _validate  # noqa: E402

DOC_FILES = {
    "vocabulary": DOCS / "vocabulary.md",
    "template-format": DOCS / "template-format.md",
    "director-playbook": DOCS / "director-playbook.md",
    "gif-breakdown-playbook": DOCS / "gif-breakdown-playbook.md",
}

VIEWS = ("front", "side", "top", "three_quarter")
_SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class LibraryError(ValueError):
    """A request the library refuses (bad id, would overwrite, invalid template)."""


# ---------------------------------------------------------------- reading


def _template_dirs() -> list[Path]:
    return [TEMPLATES] + ([BUILTIN_TEMPLATES] if BUILTIN_TEMPLATES else [])


def _template_files() -> list[Path]:
    """Every template file, the user's first; a user file hides a built-in one at the same path."""
    seen: set[str] = set()
    out = []
    for folder in _template_dirs():
        if not folder.is_dir():
            continue
        for p in sorted(p for p in folder.rglob("*.json") if p.name != "index.json"):
            rel = p.relative_to(folder).as_posix()
            if rel not in seen:
                seen.add(rel)
                out.append(p)
    return out


def _relative(path: Path, folder: Path) -> Path | None:
    """path relative to folder (resolved or not), or None if it is not inside it."""
    for base in (folder, folder.resolve()):
        if base in path.parents:
            return path.relative_to(base)
    return None


def _display_path(path: Path) -> str:
    """templates/<element>/<name>.json, wherever the file lives."""
    for folder in _template_dirs():
        rel = _relative(path, folder)
        if rel is not None:
            return "templates/" + rel.as_posix()
    return path.as_posix()


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _find(template_id: str) -> Path | None:
    for path in _template_files():
        try:
            if _load(path).get("id") == template_id:
                return path
        except (OSError, json.JSONDecodeError):
            continue
    return None


def list_templates(element: str | None = None, archetype: str | None = None) -> list[dict]:
    """Summaries of every template in the library, optionally filtered."""
    out = []
    for path in _template_files():
        try:
            doc = _load(path)
        except (OSError, json.JSONDecodeError):
            continue
        if element and doc.get("element") != element:
            continue
        if archetype and doc.get("archetype") != archetype:
            continue
        out.append({
            "id": doc.get("id"),
            "name": doc.get("name"),
            "element": doc.get("element"),
            "archetype": doc.get("archetype"),
            "hero_view": doc.get("views", {}).get("hero"),
            "duration_ms": doc.get("timing", {}).get("duration_ms"),
            "tags": doc.get("tags", []),
            "description": doc.get("description", ""),
            "path": _display_path(path),
        })
    return out


def get_template(template_id: str) -> dict:
    """The full template with this id."""
    path = _find(template_id)
    if path is None:
        raise LibraryError(f"no template with id {template_id!r}")
    return _load(path)


def get_doc(name: str) -> str:
    """One of the director's reference docs, by short name (see DOC_FILES)."""
    if name not in DOC_FILES:
        raise LibraryError(f"unknown doc {name!r}; one of {sorted(DOC_FILES)}")
    return DOC_FILES[name].read_text(encoding="utf-8")


def get_sound_cues(category: str | None = None) -> dict:
    """The sound cue vocabulary (web/sounds/cues.json): what each cue sounds like,
    whether it's a one-shot or sustained, the words that map to it and the phases
    it suits. Optionally only one category (electric, fire, impact, ...)."""
    cues = _validate.known_cues()
    if category:
        cues = {k: v for k, v in cues.items() if v.get("category") == category}
    return {
        "cues": {
            k: {f: v.get(f) for f in ("label", "category", "kind", "duration_ms", "describes", "words", "phases")}
            for k, v in cues.items()
        },
        "categories": sorted({v.get("category") for v in _validate.known_cues().values()}),
        "params": {
            "cue": "cue id from this list (required)",
            "gain": "0-1 loudness, default 0.8",
            "pitch": "playback-rate multiplier, 0.5-2, default 1; a {min, max} range varies it per cast",
            "offset_ms": "delay after the beat starts, default 0",
            "duration_ms": "override length; sustained cues otherwise last the layer's beats",
            "repeat_ms": "one-shots only: retrigger every N ms inside each beat (hops, restrikes)",
        },
    }


def get_schema(version: str = "0.1.0") -> dict:
    path = SCHEMAS / f"template-{version}.schema.json"
    if not path.is_file():
        raise LibraryError(f"unknown schema version {version!r}")
    return _load(path)


# ---------------------------------------------------------------- checking and saving


def validate_template(template: dict) -> dict:
    """Schema + extra rules. Returns {valid, errors, warnings}."""
    if not isinstance(template, dict):
        return {"valid": False, "errors": ["template must be a JSON object"], "warnings": []}
    errors, warnings = _validate.check(template)
    return {"valid": not errors, "errors": errors, "warnings": warnings}


def viewer_url() -> str:
    """Base URL of the local viewer: the running one if there is one (it may
    have moved to another port), else tools/serve.py's port setting."""
    import serve  # tools/serve.py

    running = serve.InstanceLock().running_url()
    if running and serve.is_viewer(running, timeout=0.5):
        return running if running.endswith("/") else running + "/"
    port = os.environ.get("SPELLDIRECTOR_PORT") or serve.DEFAULT_PORT
    return f"http://localhost:{port}/"


def preview_url(template_id: str, view: str | None = None, t_ms: int | None = None) -> str:
    url = f"{viewer_url()}?template={template_id}"
    if view:
        url += f"&view={view}"
    if t_ms is not None:
        url += f"&t={t_ms}"
    return url


def _target_path(doc: dict) -> Path:
    element, tid = doc["element"], doc["id"]
    # Match the existing naming: templates/lightning/sky-strike.json holds id lightning-sky-strike.
    stem = tid[len(element) + 1:] if tid.startswith(element + "-") and len(tid) > len(element) + 1 else tid
    path = (TEMPLATES / element / f"{stem}.json").resolve()
    if TEMPLATES.resolve() not in path.parents:
        raise LibraryError("template path escapes the library")
    return path


def save_template(template: dict, overwrite: bool = False) -> dict:
    """Validate, write templates/<element>/<name>.json and rebuild templates/index.json.

    Refuses invalid templates. Refuses to replace an existing template (same id,
    or a different template at the same path) unless overwrite is true; even
    then it never replaces a template with a different id.
    """
    result = validate_template(template)
    if not result["valid"]:
        raise LibraryError("template is invalid:\n" + "\n".join(f"- {e}" for e in result["errors"]))

    existing = _find(template["id"])
    path = existing or _target_path(template)
    if BUILTIN_TEMPLATES and _relative(path, BUILTIN_TEMPLATES):
        # Built-in templates are read-only: a revision goes to the user's library and hides the built-in one.
        path = TEMPLATES / _relative(path, BUILTIN_TEMPLATES)
    builtin = BUILTIN_TEMPLATES / _relative(path, TEMPLATES) if BUILTIN_TEMPLATES else None
    occupant = path if path.exists() else builtin if builtin and builtin.exists() else None
    if occupant is not None:
        current = _load(occupant)
        if current.get("id") != template["id"]:
            raise LibraryError(f"{_display_path(occupant)} already holds template {current.get('id')!r}")
        if not overwrite:
            raise LibraryError(f"template {template['id']!r} already exists; pass overwrite=true to revise it")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(template, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Not build_index.main(): it prints, and stdout is the MCP stdio channel.
    (TEMPLATES / "index.json").write_text(json.dumps(_build_index.build(TEMPLATES), indent=2) + "\n", encoding="utf-8")
    return {
        "saved": True,
        "id": template["id"],
        "path": _display_path(path),
        "file": str(path),
        "replaced": existing is not None,
        "warnings": result["warnings"],
        "preview_url": preview_url(template["id"], template.get("views", {}).get("hero")),
        "preview_all_views_url": preview_url(template["id"], "quad"),
    }


# ---------------------------------------------------------------- references


def breakdown_reference(path: str, name: str | None = None, start_s: float | None = None,
                        end_s: float | None = None) -> dict:
    """Run the breakdown tool on a reference GIF or video (MP4, WebM, MOV...);
    output goes to breakdowns/<name>/. start_s/end_s (seconds) trim it."""
    src = Path(path).expanduser()
    if not src.is_file():
        raise LibraryError(f"no such file: {path}")
    name = name or re.sub(r"[^a-z0-9-]+", "-", src.stem.lower()).strip("-") or "reference"
    if not _SAFE_NAME.match(name):
        raise LibraryError(f"name must be kebab-case: {name!r}")
    out = BREAKDOWNS / name
    try:
        result = _breakdown.breakdown(src, out, start_s=start_s or 0.0, end_s=end_s)
    except ValueError as exc:
        raise LibraryError(str(exc)) from exc
    images = {k: str(out / v) for k, v in result["images"].items() if isinstance(v, str)}
    return {
        "summary": _breakdown.summary(result),
        "out_dir": str(out),
        "breakdown_json": str(out / "breakdown.json"),
        "images": images,
        "gif": result["gif"],
        "timing": result["timing"],
        "space": result["space"],
        "palette": result["palette"],
        "frame_count": len(result["frames"]),
    }


# ---------------------------------------------------------------- export


def export_sprites(template_id: str, seed: int = 1, frame: int = 192, fps: int | None = None,
                   views: list[str] | None = None, layers: bool = True) -> dict:
    """Export a template as sprite sheets for a game engine: all.png (the whole
    spell) and layer-<id>.png per drawn layer (columns are frames, rows are the
    views), plus <id>.spritesheet.json and an assembly guide <id>.guide.md.
    Goes to exports/<id>-seed<seed>/. Needs Playwright and a browser
    (requirements-export.txt)."""
    if _find(template_id) is None:
        raise LibraryError(f"no template with id {template_id!r}")
    if not 32 <= frame <= 1024:
        raise LibraryError("frame must be between 32 and 1024 px")
    try:
        # Playwright's sync API refuses to run inside an asyncio loop (the MCP server), so use a thread.
        with ThreadPoolExecutor(max_workers=1) as pool:
            res = pool.submit(_export_sprites.export, template_id, seed=seed, frame=frame, fps=fps,
                              views=views, layers=layers).result()
    except _export_sprites.ExportError as exc:
        raise LibraryError(str(exc)) from exc
    m = res["manifest"]
    return {
        "out_dir": res["out"],
        "files": res["files"],
        "guide": next((f for f in res["files"] if f.endswith(".guide.md")), None),
        "frame_count": m["frame_count"],
        "fps": m["fps"],
        "view_rows": m["view_rows"],
        "sheets": [{k: sh[k] for k in ("image", "first_frame", "frame_count", "start_ms", "end_ms")} for sh in m["sheets"]],
    }


def look_at_sprite_sheet(export_dir: str, mode: str = "frame", sheet: str = "all", view: str | None = None,
                         frame: int | None = None, ms: float | None = None, layers: bool = False) -> dict:
    """Crop an exported sprite sheet into something a model can look at, using
    its .spritesheet.json map: mode "cell" (one cell, enlarged), "frame" (one
    moment in every view; layers=True adds a row per layer sheet) or "contact"
    (a whole sheet as a grid, each cell labeled with frame, ms and view).
    Writes the PNG to <export_dir>/ai/ and returns its path."""
    try:
        res = _sheet_cells.look(export_dir, mode, sheet, view, frame, ms, layers)
        m, _ = _sheet_cells.load(export_dir)
    except _sheet_cells.SheetError as exc:
        raise LibraryError(str(exc)) from exc
    return {
        **res,
        "frame_count": m["frame_count"],
        "frame_ms": m["frame_ms"],
        "view_rows": m["view_rows"],
        "sheets": [{k: s[k] for k in ("id", "first_frame", "frame_count", "start_ms", "end_ms")} for s in m["sheets"]],
    }
