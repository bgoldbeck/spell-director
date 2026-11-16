"""SpellDirector MCP server: lets an AI agent act as the director.

Run (stdio):  python -m director.mcp_server
It's a thin adapter over director/library.py. Never print to stdout here:
stdout is the MCP channel.
"""

from __future__ import annotations

import json
from typing import Any

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from director import library

INSTRUCTIONS = """\
You are the SpellDirector: you turn loose spell requests ("heavy boss lightning,
top-down game") or reference GIFs and videos into precise effect templates. The user does
not know VFX terms; you do. Follow the director playbook
(resource spelldirector://docs/director-playbook, or the `direct_spell` prompt):
read the vocabulary, template format and sound cues, look at similar templates, ask at most
2-3 plain-word choices, write the template, validate_template, then
save_template and give the user the preview URL. Keep templates game- and
engine-agnostic, and make them read from all four views (front, side, top, 3/4).
"""

mcp = MCPServer("spelldirector", instructions=INSTRUCTIONS)

READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


def _call(fn, *args):
    """Run a library function, turning expected failures into messages the model sees."""
    try:
        return fn(*args)
    except (library.LibraryError, OSError, ValueError) as exc:
        raise ToolError(str(exc)) from exc


# ---------------------------------------------------------------- tools


@mcp.tool(annotations=READ_ONLY)
def list_templates(element: str | None = None, archetype: str | None = None) -> dict[str, Any]:
    """List the templates in the library (id, name, element, archetype, hero view,
    duration, tags, description). Optionally filter by element or archetype."""
    return {"templates": library.list_templates(element, archetype)}


@mcp.tool(annotations=READ_ONLY)
def get_template(template_id: str) -> dict[str, Any]:
    """Get the full JSON of one template by its id (e.g. "lightning-sky-strike")."""
    return _call(library.get_template, template_id)


@mcp.tool(annotations=READ_ONLY)
def get_vocabulary() -> str:
    """The director's vocabulary: phases, timing words, curves, shape, color,
    layers, space, camera views and lightning terms (markdown)."""
    return library.get_doc("vocabulary")


@mcp.tool(annotations=READ_ONLY)
def get_template_format() -> str:
    """The template format reference, field by field, with known params per layer type (markdown)."""
    return library.get_doc("template-format")


@mcp.tool(annotations=READ_ONLY)
def get_sound_cues(category: str | None = None) -> dict[str, Any]:
    """The sound cue vocabulary for `sound_cue` layers: generic cues such as
    charge, buzz, crackle, zap, crack, boom, rumble, ignite, fire, whoosh, impact,
    crash, shatter, wind and shimmer, each with what it sounds like, one_shot or
    sustained, plain words that map to it, and the phases it suits. Also lists the
    sound_cue params. Optionally filter by category (electric, fire, impact, ...)."""
    return _call(library.get_sound_cues, category)


@mcp.tool(annotations=READ_ONLY)
def validate_template(template: dict[str, Any]) -> dict[str, Any]:
    """Check a template against the schema and the extra rules (beat timing,
    references, keyframes, ranges, unknown params). Returns valid, errors, warnings."""
    return library.validate_template(template)


@mcp.tool(annotations=ToolAnnotations(destructiveHint=False, idempotentHint=True, openWorldHint=False))
def save_template(template: dict[str, Any], overwrite: bool = False) -> dict[str, Any]:
    """Validate and save a template to templates/<element>/, and rebuild the
    viewer's index. Refuses invalid templates. Refuses to replace an existing
    template unless overwrite is true (use it only to revise that same template).
    Returns the saved path and preview URLs for the viewer."""
    return _call(library.save_template, template, overwrite)


@mcp.tool(annotations=ToolAnnotations(destructiveHint=False, openWorldHint=False), structured_output=False)
def breakdown_gif(path: str, name: str | None = None, start_s: float | None = None, end_s: float | None = None,
                  include_images: bool = True) -> list[Any]:
    """Break a reference spell GIF or video (MP4, WebM, MOV) down into timing,
    phase hints, palette, footprint and a camera-view guess, following the GIF
    breakdown playbook. `path` is a file on this machine. start_s and end_s
    (seconds) trim a GIF or video to the spell; videos are sampled at up to 30 fps
    and 20 s. Output goes to breakdowns/<name>/. With include_images, also
    returns the contact sheet and curves chart to look at."""
    result = _call(library.breakdown_reference, path, name, start_s, end_s)
    out: list[Any] = [json.dumps(result, indent=2)]
    if include_images:
        for key in ("contact_sheet", "curves"):
            img = result["images"].get(key)
            if img:
                out.append(Image(path=img))
    return out


@mcp.tool(annotations=ToolAnnotations(destructiveHint=False, idempotentHint=True, openWorldHint=False))
def export_sprites(template_id: str, seed: int = 1, frame: int = 192, fps: int | None = None,
                   views: list[str] | None = None, layers: bool = True) -> dict[str, Any]:
    """Export a template as sprite sheets for rebuilding it in a game engine
    (Unity, Godot, ...): all.png for the whole spell and one layer-<id>.png per
    drawn layer, where columns are frames and rows are the views (front, side,
    top, three_quarter), plus a JSON file and a Markdown assembly guide with
    every layer's timing, blend mode and colors, the beats, sound cues, screen
    flashes and camera shake. `frame` is the cell size in px; `fps` defaults to
    the template's. Writes to exports/<id>-seed<seed>/ and returns the paths."""
    return _call(library.export_sprites, template_id, seed, frame, fps, views, layers)


@mcp.tool(annotations=ToolAnnotations(destructiveHint=False, idempotentHint=True, openWorldHint=False),
          structured_output=False)
def look_at_sprite_sheet(export_dir: str, mode: str = "frame", sheet: str = "all", view: str | None = None,
                         frame: int | None = None, ms: float | None = None, layers: bool = False) -> list[Any]:
    """Look at an exported sprite sheet cell by cell. The sheets have no numbers
    on them, so don't read a whole sheet: this crops cells using the export's
    .spritesheet.json map and labels them. `export_dir` is the export folder
    (from export_sprites). mode "cell": one cell (sheet = layer id or "all",
    view, frame); "frame": one moment in every view (layers=True: also a row per
    layer); "contact": a whole sheet as a labeled grid. `frame` is the spell
    frame (0 = 0 ms), or give `ms`. Returns the image and where it was saved."""
    result = _call(library.look_at_sprite_sheet, export_dir, mode, sheet, view, frame, ms, layers)
    return [json.dumps(result, indent=2), Image(path=result["path"])]


# ---------------------------------------------------------------- resources


def _doc_resource(name: str, title: str) -> None:
    @mcp.resource(f"spelldirector://docs/{name}", name=name, title=title, mime_type="text/markdown")
    def _read() -> str:
        return library.get_doc(name)


_doc_resource("vocabulary", "Director vocabulary")
_doc_resource("template-format", "Template format")
_doc_resource("director-playbook", "Director playbook")
_doc_resource("gif-breakdown-playbook", "GIF breakdown playbook")


@mcp.resource("spelldirector://schema/0.1.0", name="schema-0.1.0", title="Template JSON Schema 0.1.0",
              mime_type="application/json")
def schema_resource() -> str:
    return json.dumps(library.get_schema("0.1.0"), indent=2)


# ---------------------------------------------------------------- prompts


@mcp.prompt(title="Direct a spell")
def direct_spell(request: str) -> str:
    """Start the director on a loose spell request, e.g. "heavy boss lightning, top-down game"."""
    return (
        f"Spell request: {request}\n\n"
        "Act as the SpellDirector. Follow this playbook exactly:\n\n"
        + library.get_doc("director-playbook")
    )


@mcp.prompt(title="Direct a spell from a GIF or video")
def direct_from_gif(path: str, notes: str = "") -> str:
    """Start the director on a reference GIF or MP4 on this machine."""
    return (
        f"Reference GIF or video: {path}\n"
        + (f"User notes: {notes}\n" if notes else "")
        + "\nAct as the SpellDirector. Call breakdown_gif on the file, then follow the GIF breakdown "
        "playbook and the director playbook below. Learn the character of the reference; don't copy it.\n\n"
        + library.get_doc("gif-breakdown-playbook")
        + "\n\n---\n\n"
        + library.get_doc("director-playbook")
    )


@mcp.prompt(title="Grow the library")
def grow_library(element: str = "lightning", count: int = 3) -> str:
    """Have the director write several varied templates on its own."""
    return (
        f"Write {count} new, varied {element} templates for the library, following the "
        "'Library mode' section of the director playbook below.\n\n"
        + library.get_doc("director-playbook")
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
