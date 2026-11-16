"""Export a template as animated GIFs of the viewer's camera views.

    python tools/export_gif.py lightning-sky-strike                       # all views
    python tools/export_gif.py lightning-sky-strike --views front,quad --width 640
    python tools/export_gif.py fire-pyre-ward --length spell --style toon
    python tools/export_gif.py my-spell.json --speed 0.5 --fps 25 --out exports/test

One looping GIF per view: front, side, top, three_quarter, and quad (all four
in one GIF, like the viewer's "All four"). Each shows the spell as the viewer
does: the set and stand-ins, bloom, the art style, camera shake and screen
flashes. Auras record their seamless sustain loop by default (--length loop);
--length spell records start-up, loop and end.

Writes to exports/<template id>-seed<seed>[-<style>]-gifs/ by default. This is
the same export as the viewer's "Export GIF…" button, run in a headless
browser the same way as tools/export_sprites.py (Playwright if installed, else
an installed Edge or Chrome).
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", None) or Path(__file__).resolve().parent.parent)
sys.path.insert(0, str(ROOT / "tools"))

import export_sprites  # noqa: E402
from export_sprites import EXPORTS, STYLES, ExportError  # noqa: E402

VIEWS = ("front", "side", "top", "three_quarter", "quad")  # web/js/gifexport.js GIF_VIEWS
LENGTHS = ("loop", "spell")


def export(template: str | dict, *, views: list[str] | None = None, seed: int = 1, width: int = 480,
           fps: int = 20, speed: float = 1.0, length: str | None = None, style: str | None = None,
           bloom: bool = True, dither: bool = True, out: Path | str | None = None, timeout_s: float = 900) -> dict:
    """Export GIFs. `template` is a template id, a path to a JSON file, or a dict.

    Returns {"out": folder, "files": [paths], "manifest": {...}}.
    """
    views = list(views or VIEWS)
    bad = [v for v in views if v not in VIEWS]
    if bad:
        raise ExportError(f"unknown view(s) {', '.join(bad)}; use {', '.join(VIEWS)}")
    if style is not None and style not in STYLES:
        raise ExportError(f"unknown style {style!r}; use {', '.join(STYLES)}")
    if length is not None and length not in LENGTHS:
        raise ExportError(f"unknown length {length!r}; use loop (an aura's seamless loop) or spell")
    if not 64 <= width <= 1280:
        raise ExportError("width must be between 64 and 1280 px")
    if not 5 <= fps <= 50:
        raise ExportError("fps must be between 5 and 50")
    if not 0.05 <= speed <= 4:
        raise ExportError("speed must be between 0.05 and 4")
    opts = {"kind": "gif", "views": views, "seed": seed, "width": width, "fps": fps, "speed": speed,
            "bloom": bloom, "dither": 0.5 if dither else 0}
    if length:
        opts["length"] = length
    if style:
        opts["style"] = style
    result = export_sprites.run_in_page(template, opts, timeout_s)
    m = result["manifest"]
    suffix = "" if m.get("style", "stylized") == "stylized" else f"-{m['style']}"
    folder = Path(out) if out else EXPORTS / f"{m['template']['id']}-seed{m['seed']}{suffix}-gifs"
    folder.mkdir(parents=True, exist_ok=True)
    written = []
    for f in result["files"]:
        path = folder / f["name"]
        path.write_bytes(base64.b64decode(f["base64"]))
        written.append(str(path))
    return {"out": str(folder), "files": written, "manifest": m}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("template", help="template id (e.g. lightning-sky-strike) or path to a template .json")
    ap.add_argument("--views", default=",".join(VIEWS),
                    help="comma-separated: front, side, top, three_quarter, quad (default all five)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--width", type=int, default=480, help="GIF width in px; height is 3/4 of it (default 480)")
    ap.add_argument("--fps", type=int, default=20, help="frame rate (default 20)")
    ap.add_argument("--speed", type=float, default=1.0, help="playback speed, e.g. 0.5 for slow motion (default 1)")
    ap.add_argument("--length", choices=LENGTHS,
                    help="loop: an aura's seamless sustain loop (default for auras); spell: the whole spell")
    ap.add_argument("--style", choices=STYLES, help="art style (default: the template's)")
    ap.add_argument("--no-bloom", action="store_true", help="no bloom glow")
    ap.add_argument("--no-dither", action="store_true", help="no dither pattern on gradients")
    ap.add_argument("--out", help="output folder (default exports/<id>-seed<seed>[-<style>]-gifs)")
    args = ap.parse_args(argv)
    try:
        res = export(args.template, views=[v.strip() for v in args.views.split(",") if v.strip()], seed=args.seed,
                     width=args.width, fps=args.fps, speed=args.speed, length=args.length, style=args.style,
                     bloom=not args.no_bloom, dither=not args.no_dither, out=args.out)
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    m = res["manifest"]
    print(f"{m['template']['name']} (seed {m['seed']}, {m['style']}): {m['frame_count']} frames at {m['fps']} fps, "
          f"{m['width']} x {m['height']}, {m['start_ms']:.0f}-{m['end_ms']:.0f} ms")
    for f in res["files"]:
        print(f"  {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
