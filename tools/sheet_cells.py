"""Look at an exported sprite sheet cell by cell (for people and AI models).

The sheets from "Export sprites…" / tools/export_sprites.py have no numbers
drawn on them; <id>.spritesheet.json is the map. This tool uses that map to
crop what you want to look at, on a dark background, with labels:

    python tools/sheet_cells.py cell    EXPORT --sheet main-bolt --view top --frame 14
    python tools/sheet_cells.py frame   EXPORT --frame 14 [--layers]
    python tools/sheet_cells.py contact EXPORT --sheet main-bolt [--views top,front] [--per-row 8]
    python tools/sheet_cells.py labeled EXPORT
    python tools/sheet_cells.py map     EXPORT

EXPORT is the export folder (or its .spritesheet.json, or the .zip's unpacked
folder). --frame is the spell frame (0 = 0 ms), the same numbering the guide
uses; `--ms 400` picks the frame at a time instead. --sheet is a layer id or
"all" (default). Images are written to EXPORT/ai/ unless --out is given, and
the path is printed.

- cell: one cell, enlarged.
- frame: one moment from every view side by side (with --layers, one row per
  layer sheet too).
- contact: a whole sheet as a labeled grid, each cell tagged with its spell
  frame, time and view.
- labeled: <sheet>_labeled.png for every sheet: same pixel layout as the clean
  sheet, plus gridlines and labels. For checking only; give the clean sheets to
  the engine.
- map: prints every sheet's grid and each cell's pixel rectangle as text.

Only Pillow is needed.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ALL_ID = "all"
VIEW_NAMES = {"front": "Front", "side": "Side", "top": "Top", "three_quarter": "3/4"}
BG = (24, 27, 36, 255)
GRID = (90, 96, 120, 255)
TEXT = (235, 236, 240, 255)
DIM = (150, 155, 170, 255)


class SheetError(ValueError):
    """Bad export folder, sheet, view or frame."""


# ---------------------------------------------------------------- the map


def load(export: str | Path) -> tuple[dict, Path]:
    """The manifest and the folder holding the sheets."""
    p = Path(export).expanduser()
    if p.is_file() and p.name.endswith(".spritesheet.json"):
        folder, path = p.parent, p
    elif p.is_dir():
        found = sorted(p.glob("*.spritesheet.json")) or sorted(p.glob("*/*.spritesheet.json"))
        if not found:
            raise SheetError(f"no *.spritesheet.json in {p}")
        path = found[0]
        folder = path.parent
    else:
        raise SheetError(f"not an export folder or .spritesheet.json: {p}")
    return json.loads(path.read_text(encoding="utf-8")), folder


def sheet(m: dict, sheet_id: str = ALL_ID) -> dict:
    for s in m["sheets"]:
        if s["id"] == sheet_id or s["image"] == sheet_id:
            return s
    known = ", ".join(s["id"] for s in m["sheets"])
    raise SheetError(f"no sheet {sheet_id!r}; sheets: {known}")


def view_row(m: dict, view: str) -> int:
    if view not in m["view_rows"]:
        raise SheetError(f"view {view!r} not in this export; views: {', '.join(m['view_rows'])}")
    return m["view_rows"].index(view)


def frame_at_ms(m: dict, ms: float) -> int:
    return max(0, min(m["frame_count"] - 1, int(math.floor(ms / m["frame_ms"] + 1e-9))))


def cell_rect(m: dict, s: dict, view: str, frame: int) -> tuple[int, int, int, int] | None:
    """(x, y, w, h) of spell frame `frame` for `view` in sheet `s`, or None if
    the layer isn't drawn at that frame."""
    k = frame - s["first_frame"]
    if k < 0 or k >= s["frame_count"]:
        return None
    w, h = m["frame"]["width"], m["frame"]["height"]
    col = k % s["columns"]
    row = (k // s["columns"]) * len(m["view_rows"]) + view_row(m, view)
    return col * w, row * h, w, h


def cells(m: dict, s: dict):
    """Every cell of a sheet: (spell frame, view, (x, y, w, h))."""
    for k in range(s["frame_count"]):
        f = s["first_frame"] + k
        for v in m["view_rows"]:
            yield f, v, cell_rect(m, s, v, f)


# ---------------------------------------------------------------- drawing


def _font(size: int):
    for name in ("DejaVuSans.ttf", "Arial.ttf", "arial.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def _open(folder: Path, s: dict) -> Image.Image:
    path = folder / s["image"]
    if not path.exists():
        raise SheetError(f"missing sheet image {path}")
    return Image.open(path).convert("RGBA")


def _on_dark(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, BG)
    bg.alpha_composite(img)
    return bg


def _crop(m: dict, folder: Path, s: dict, view: str, frame: int, cache: dict) -> Image.Image | None:
    r = cell_rect(m, s, view, frame)
    if r is None:
        return None
    if s["id"] not in cache:
        cache[s["id"]] = _open(folder, s)
    x, y, w, h = r
    return cache[s["id"]].crop((x, y, x + w, y + h))


def _label(m: dict, s: dict, view: str, frame: int) -> str:
    ms = round(frame * m["frame_ms"])
    name = "whole spell" if s["id"] == ALL_ID else s["id"]
    return f"{name} | {VIEW_NAMES.get(view, view)} | frame {frame} ({ms} ms)"


def _grid(tiles: list[list[tuple[Image.Image | None, str]]], tile: int, title: str, row_titles=None) -> Image.Image:
    """Lay out labeled tiles. tiles[row][col] = (image or None, label)."""
    pad, lab = 6, max(12, tile // 12)
    font, tfont = _font(lab), _font(lab + 4)
    left = 0
    if row_titles:
        left = max(int(ImageDraw.Draw(Image.new("RGBA", (1, 1))).textlength(t, font=font)) for t in row_titles) + 2 * pad
    cols = max(len(r) for r in tiles)
    head = lab + 4 + 3 * pad
    cw, ch = tile + pad, tile + lab + 2 * pad
    out = Image.new("RGBA", (left + cols * cw + pad, head + len(tiles) * ch + pad), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, pad), title, fill=TEXT, font=tfont)
    for r, row in enumerate(tiles):
        y = head + r * ch
        if row_titles:
            d.text((pad, y + tile // 2), row_titles[r], fill=TEXT, font=font)
        for c, (img, text) in enumerate(row):
            x = left + pad + c * cw
            d.rectangle((x - 1, y - 1, x + tile, y + tile), outline=GRID)
            if img is not None:
                if img.size != (tile, tile):
                    img = img.resize((tile, tile), Image.LANCZOS)
                out.alpha_composite(img, (x, y))
            else:
                d.text((x + pad, y + tile // 2), "not drawn", fill=DIM, font=font)
            d.text((x, y + tile + 2), text, fill=DIM, font=font)
    return out


def render_cell(m: dict, folder: Path, sheet_id: str, view: str, frame: int, scale: int = 2) -> Image.Image:
    s = sheet(m, sheet_id)
    img = _crop(m, folder, s, view, frame, {})
    if img is None:
        raise SheetError(f"{sheet_id} is not drawn at frame {frame}; it shows frames "
                         f"{s['first_frame']}-{s['first_frame'] + s['frame_count'] - 1}")
    size = m["frame"]["width"] * scale
    return _grid([[(img, _label(m, s, view, frame))]], size, f"{m['template']['name']} (seed {m['seed']})")


def render_frame(m: dict, folder: Path, frame: int, layers: bool = False, sheet_id: str = ALL_ID) -> Image.Image:
    sheets = m["sheets"] if layers else [sheet(m, sheet_id)]
    cache: dict = {}
    tiles, titles = [], []
    for s in sheets:
        tiles.append([(_crop(m, folder, s, v, frame, cache), VIEW_NAMES.get(v, v)) for v in m["view_rows"]])
        titles.append("whole spell" if s["id"] == ALL_ID else s["id"])
    ms = round(frame * m["frame_ms"])
    tile = min(m["frame"]["width"] * 2, 384)
    return _grid(tiles, tile, f"{m['template']['name']}: frame {frame} ({ms} ms), every view", titles)


def render_contact(m: dict, folder: Path, sheet_id: str = ALL_ID, views: list[str] | None = None,
                   per_row: int = 8, every: int = 1) -> Image.Image:
    s = sheet(m, sheet_id)
    views = views or m["view_rows"]
    for v in views:
        view_row(m, v)
    frames = list(range(s["first_frame"], s["first_frame"] + s["frame_count"], max(1, every)))
    cache: dict = {}
    tiles, titles = [], []
    for i in range(0, len(frames), per_row):
        chunk = frames[i:i + per_row]
        for v in views:
            tiles.append([(_crop(m, folder, s, v, f, cache), f"f{f} {round(f * m['frame_ms'])}ms") for f in chunk])
            titles.append(VIEW_NAMES.get(v, v))
    tile = min(m["frame"]["width"], 192)
    name = "whole spell" if s["id"] == ALL_ID else f"layer {s['id']}"
    return _grid(tiles, tile, f"{m['template']['name']}: {name}, {s['frame_count']} frames "
                             f"({s['start_ms']}-{s['end_ms']} ms)", titles)


def render_labeled(m: dict, folder: Path, s: dict) -> Image.Image:
    """Same pixel layout as the clean sheet, on a dark background, with
    gridlines and a 'f<frame> <view>' tag in each cell's top-left corner."""
    img = _on_dark(_open(folder, s))
    d = ImageDraw.Draw(img)
    w = m["frame"]["width"]
    font = _font(max(10, w // 14))
    for f, v, (x, y, cw, ch) in cells(m, s):
        d.rectangle((x, y, x + cw - 1, y + ch - 1), outline=GRID)
        d.text((x + 3, y + 2), f"f{f} {VIEW_NAMES.get(v, v)}", fill=TEXT, font=font)
    return img


# ---------------------------------------------------------------- commands


def _out(folder: Path, out: str | None, name: str) -> Path:
    path = Path(out) if out else folder / "ai" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def look(export: str | Path, mode: str, sheet_id: str = ALL_ID, view: str | None = None,
         frame: int | None = None, ms: float | None = None, layers: bool = False,
         views: list[str] | None = None, per_row: int = 8, out: str | None = None) -> dict:
    """Make one picture (cell, frame or contact) and return {"path", "about"}."""
    m, folder = load(export)
    if ms is not None:
        frame = frame_at_ms(m, ms)
    if mode in ("cell", "frame"):
        if frame is None:
            raise SheetError("give a frame (or ms)")
        if not 0 <= frame < m["frame_count"]:
            raise SheetError(f"frame {frame} out of range 0-{m['frame_count'] - 1}")
    if mode == "cell":
        view = view or m.get("hero_view") or m["view_rows"][0]
        img = render_cell(m, folder, sheet_id, view, frame)
        path = _out(folder, out, f"cell-{sheet_id}-{view}-f{frame}.png")
        about = f"{sheet_id}, {view} view, frame {frame}"
    elif mode == "frame":
        img = render_frame(m, folder, frame, layers=layers, sheet_id=sheet_id)
        path = _out(folder, out, f"frame-{frame}{'-layers' if layers else ''}.png")
        about = f"frame {frame} in every view" + (", one row per sheet" if layers else "")
    elif mode == "contact":
        img = render_contact(m, folder, sheet_id, views=views, per_row=per_row)
        path = _out(folder, out, f"contact-{sheet_id}.png")
        about = f"contact sheet of {sheet_id}"
    else:
        raise SheetError(f"unknown mode {mode!r}; use cell, frame or contact")
    img.convert("RGB").save(path)
    return {"path": str(path), "about": about}


def labeled(export: str | Path, out_dir: str | None = None) -> list[str]:
    m, folder = load(export)
    dest = Path(out_dir) if out_dir else folder / "ai"
    dest.mkdir(parents=True, exist_ok=True)
    written = []
    for s in m["sheets"]:
        path = dest / s["image"].replace(".png", "_labeled.png")
        render_labeled(m, folder, s).convert("RGB").save(path)
        written.append(str(path))
    return written


def map_text(export: str | Path) -> str:
    m, _ = load(export)
    w, h = m["frame"]["width"], m["frame"]["height"]
    lines = [f"{m['template']['name']} seed {m['seed']}: {m['frame_count']} frames at {m['fps']} fps "
             f"({m['frame_ms']} ms each), cells {w}x{h}, view rows {', '.join(f'{i}={v}' for i, v in enumerate(m['view_rows']))}"]
    for s in m["sheets"]:
        lines.append(f"\n{s['image']}: spell frames {s['first_frame']}-{s['first_frame'] + s['frame_count'] - 1}, "
                     f"{s['columns']} columns x {s['rows']} rows, {s['width']}x{s['height']} px")
        for f, v, (x, y, cw, ch) in cells(m, s):
            lines.append(f"  frame {f:3d} {v:14s} x={x} y={y} w={cw} h={ch}")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["cell", "frame", "contact", "labeled", "map"])
    ap.add_argument("export", help="export folder or its .spritesheet.json")
    ap.add_argument("--sheet", default=ALL_ID, help='layer id or "all" (default)')
    ap.add_argument("--view", help="front, side, top or three_quarter (cell; default the hero view)")
    ap.add_argument("--views", help="comma-separated views (contact; default all)")
    ap.add_argument("--frame", type=int, help="spell frame number (0 = 0 ms)")
    ap.add_argument("--ms", type=float, help="time in ms instead of --frame")
    ap.add_argument("--layers", action="store_true", help="frame: one row per sheet (every layer)")
    ap.add_argument("--per-row", type=int, default=8, help="contact: frames per row (default 8)")
    ap.add_argument("--out", help="output file (or folder for labeled)")
    a = ap.parse_args(argv)
    try:
        if a.mode == "map":
            print(map_text(a.export))
        elif a.mode == "labeled":
            for p in labeled(a.export, a.out):
                print(p)
        else:
            views = [v.strip() for v in a.views.split(",")] if a.views else None
            res = look(a.export, a.mode, a.sheet, a.view, a.frame, a.ms, a.layers, views, a.per_row, a.out)
            print(res["path"])
    except SheetError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
