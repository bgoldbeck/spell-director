"""tools/sheet_cells.py: crop exported sprite sheets using the JSON map.

Builds a small fake export (two sheets, two views) with Pillow, so no browser
is needed.
"""

import json

import pytest
from PIL import Image

from director import library

import sheet_cells

W = 16
VIEWS = ["front", "top"]


def _make_export(tmp_path):
    # Sheet "all": 5 frames, 3 columns -> 2 blocks x 2 views = 4 rows.
    # Sheet "bolt": frames 2-3, 2 columns -> 1 block = 2 rows.
    sheets = [
        {"id": "all", "image": "all.png", "layer": None, "first_frame": 0, "frame_count": 5, "start_ms": 0,
         "end_ms": 500, "columns": 3, "rows": 4, "blocks": 2, "width": 3 * W, "height": 4 * W},
        {"id": "bolt", "image": "layer-bolt.png", "layer": "bolt", "first_frame": 2, "frame_count": 2,
         "start_ms": 200, "end_ms": 400, "columns": 2, "rows": 2, "blocks": 1, "width": 2 * W, "height": 2 * W},
    ]
    m = {"format": "spelldirector.spritesheet/1", "template": {"id": "t", "name": "Test"}, "seed": 1,
         "frame_count": 5, "frame_ms": 100, "fps": 10, "frame": {"width": W, "height": W},
         "view_rows": VIEWS, "hero_view": "top", "sheets": sheets}
    for s in sheets:
        img = Image.new("RGBA", (s["width"], s["height"]), (0, 0, 0, 0))
        # Paint each cell with a color encoding (frame, view) so crops can be checked.
        for k in range(s["frame_count"]):
            f = s["first_frame"] + k
            for vi, _ in enumerate(VIEWS):
                col, row = k % s["columns"], (k // s["columns"]) * len(VIEWS) + vi
                img.paste((f * 40, vi * 200, 99, 255), (col * W, row * W, col * W + W, row * W + W))
        img.save(tmp_path / s["image"])
    (tmp_path / "t.spritesheet.json").write_text(json.dumps(m), encoding="utf-8")
    return m


def test_cell_rect_follows_the_grid(tmp_path):
    m = _make_export(tmp_path)
    s = sheet_cells.sheet(m, "all")
    assert sheet_cells.cell_rect(m, s, "front", 0) == (0, 0, W, W)
    assert sheet_cells.cell_rect(m, s, "top", 1) == (W, W, W, W)
    # Frame 4 wraps into the second block: column 1, rows 2 (front) / 3 (top).
    assert sheet_cells.cell_rect(m, s, "top", 4) == (W, 3 * W, W, W)
    bolt = sheet_cells.sheet(m, "bolt")
    assert sheet_cells.cell_rect(m, bolt, "front", 1) is None
    assert sheet_cells.cell_rect(m, bolt, "top", 3) == (W, W, W, W)
    with pytest.raises(sheet_cells.SheetError):
        sheet_cells.cell_rect(m, s, "side", 0)


def test_every_cell_crops_the_right_pixels(tmp_path):
    m = _make_export(tmp_path)
    for s in m["sheets"]:
        img = Image.open(tmp_path / s["image"])
        for f, v, (x, y, w, h) in sheet_cells.cells(m, s):
            assert img.getpixel((x + w // 2, y + h // 2))[:2] == (f * 40, VIEWS.index(v) * 200)


def test_look_writes_labeled_images(tmp_path):
    _make_export(tmp_path)
    for mode, kw in [("cell", {"sheet_id": "bolt", "frame": 3}), ("frame", {"frame": 2, "layers": True}),
                     ("contact", {"sheet_id": "all"}), ("cell", {"ms": 250})]:
        res = sheet_cells.look(tmp_path, mode, **kw)
        assert Image.open(res["path"]).size[0] > W
    with pytest.raises(sheet_cells.SheetError):
        sheet_cells.look(tmp_path, "cell", sheet_id="bolt", frame=0)
    labeled = sheet_cells.labeled(tmp_path)
    assert len(labeled) == 2
    assert Image.open(labeled[1]).size == (2 * W, 2 * W), "labeled copies keep the sheet's layout"
    assert "frame   4 top" in sheet_cells.map_text(tmp_path)


def test_library_wraps_errors(tmp_path):
    _make_export(tmp_path)
    res = library.look_at_sprite_sheet(str(tmp_path), "frame", frame=1)
    assert res["view_rows"] == VIEWS
    with pytest.raises(library.LibraryError):
        library.look_at_sprite_sheet(str(tmp_path), "cell", sheet="nope", frame=1)
    with pytest.raises(library.LibraryError):
        library.look_at_sprite_sheet(str(tmp_path / "missing"))
