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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"
DOCS = ROOT / "docs"
SCHEMAS = ROOT / "schemas"
BREAKDOWNS = ROOT / "breakdowns"

if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

import breakdown as _breakdown  # noqa: E402
import build_index as _build_index  # noqa: E402
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


def _template_files() -> list[Path]:
    return sorted(p for p in TEMPLATES.rglob("*.json") if p.name != "index.json")


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
            "path": path.relative_to(ROOT).as_posix(),
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
    """Base URL of the local viewer (tools/serve.py, same port setting)."""
    import serve  # tools/serve.py

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
    if path.exists():
        current = _load(path)
        if current.get("id") != template["id"]:
            raise LibraryError(f"{path.relative_to(ROOT).as_posix()} already holds template {current.get('id')!r}")
        if not overwrite:
            raise LibraryError(f"template {template['id']!r} already exists; pass overwrite=true to revise it")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(template, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Not build_index.main(): it prints, and stdout is the MCP stdio channel.
    (TEMPLATES / "index.json").write_text(json.dumps(_build_index.build(TEMPLATES), indent=2) + "\n", encoding="utf-8")
    return {
        "saved": True,
        "id": template["id"],
        "path": path.relative_to(ROOT).as_posix(),
        "replaced": existing is not None,
        "warnings": result["warnings"],
        "preview_url": preview_url(template["id"], template.get("views", {}).get("hero")),
        "preview_all_views_url": preview_url(template["id"], "quad"),
    }


# ---------------------------------------------------------------- references


def breakdown_reference(path: str, name: str | None = None, start_s: float | None = None,
                        end_s: float | None = None) -> dict:
    """Run the breakdown tool on a reference GIF or video (MP4, WebM, MOV...);
    output goes to breakdowns/<name>/. start_s/end_s trim a video."""
    src = Path(path).expanduser()
    if not src.is_file():
        raise LibraryError(f"no such file: {path}")
    name = name or re.sub(r"[^a-z0-9-]+", "-", src.stem.lower()).strip("-") or "reference"
    if not _SAFE_NAME.match(name):
        raise LibraryError(f"name must be kebab-case: {name!r}")
    out = BREAKDOWNS / name
    opts = {}
    if _breakdown.is_video(src):
        opts = {"start_s": start_s or 0.0, "end_s": end_s}
    elif start_s or end_s is not None:
        raise LibraryError("start_s/end_s only apply to videos")
    result = _breakdown.breakdown(src, out, **opts)
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
