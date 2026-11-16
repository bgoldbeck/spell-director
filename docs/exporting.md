# Exporting sprite sheets for a game engine

SpellDirector exports a spell as sprite sheets plus an assembly guide, so it can be rebuilt in Unity, Godot or any engine that plays sprite animations. Nothing in the export is tied to one engine.

## How to export

- **Viewer:** pick the spell and seed, click **Export sprites…**, choose views, cell size and frame rate, then **Export .zip**. Works in the Windows app too.
- **Command line:** `python tools/export_sprites.py lightning-sky-strike --seed 7 --frame 256` writes to `exports/<id>-seed<seed>/` (git-ignored). Needs `pip install -r requirements-export.txt` and a browser: `python -m playwright install chromium`, or an installed Chrome or Edge (found automatically), or a Chromium path in `SPELLDIRECTOR_CHROMIUM`.
- **Director (MCP):** the `export_sprites` tool does the same as the command line.

Options: views (default all four), cell size in px (default 192), frame rate (default the template's `fps_hint`, else 30), seed, whether to make a sheet per layer, and whether to bake the bloom glow in (default on; `--no-bloom`).

## Reference, not literal instructions

The sheets show timing, layering, composition and palette. They are not the effect to ship, and an AI model should not copy them pixel for pixel. Each layer's **shader intent** (from the template, see [vocabulary §11](vocabulary.md#11-shader-intent-the-magic)) says how to build the look with shaders and particles; the guide turns it into short Unity and Godot recipes, and the JSON carries it as `layers[].shader` and `layers[].engine_hints`, with the same notice in `how_to_use`. Use the frames to check the rebuild, or directly only for prototypes, flipbook-style games and texture sources.

### Build one layer at a time

Every guide has a build order (also `build_order` in the JSON): core hero layer first (highest z), then secondary layers (glow, crackle, ring, local flash), particles (sparks, smoke), decals, and a finish step for lights, screen flashes, camera shake, sound and a timing pass. After each step, compare that layer with its cells (`tools/sheet_cells.py contact <export> --sheet <layer>`) before adding the next.

## What you get

| File | What it is |
|---|---|
| `all.png` | The whole spell, every layer together. |
| `layer-<layer id>.png` | One sheet per drawn layer. |
| `<id>.guide.md` | The assembly guide: layout, beats, every layer's timing, blend, colors and draw order, the non-sprite tracks, where the caster and target are, and steps for Unity and Godot. |
| `<id>.spritesheet.json` | The same data, machine-readable (format `spelldirector.spritesheet/1`). |
| `<id>.template.json` | The template the sheets came from. |
| `decal-<layer id>.png` | For each decal layer: its top-down texture for a decal projector (see [Decals](#decals)). |

### Sheet layout

- **Columns are frames, rows are views** (front, side, top, 3/4, in that order, or the subset you exported). One column shows one moment from every view.
- A layer's sheet holds only the frames where that layer is visible; column 0 is its first frame. The JSON and guide give each sheet's `first_frame`, `frame_count`, `start_ms` and `end_ms`. `all.png` always covers every frame.
- Every cell is the same size and each view uses the same camera in every sheet, so layer sprites placed at the same position stack into the full spell pixel for pixel.
- Sheets are capped at 4096 px wide. Longer sheets wrap: the next frames go in a new block of view rows below. Frame `k` for view row `v` is at column `k % columns`, row `floor(k / columns) × views + v`.
- Each view's camera is zoomed onto the square around everything the spell draws in that view, so the effect fills its cells. Pixel positions of the caster, target and sky point, and pixels per world unit, are in the JSON and the guide for placing and scaling it.

### Transparency

Each frame is rendered on black and on white and the two are compared to get straight (not premultiplied) alpha on a transparent background. That keeps additive glows and normal-blended smoke both correct. Layers marked `add` look closest with an additive material in the engine.

The viewer's bloom glow is baked into the sprites by default (`bloom_baked` in the JSON). If your engine adds its own bloom, untick **Bake bloom** (or pass `--no-bloom`) so the glow isn't doubled.

### Decals

Each `decal` layer gets its sheet like any layer, plus `decal-<layer id>.png`: a 512 × 512 top-down texture (straight alpha, palette color baked in, right edge along the cast direction) for an engine's decal projector. The JSON's `decals` list gives its size in world units, blend (`alpha` paints the ground, `add` glows and belongs in emission), anchor, timing (`start_ms`, `fade_in_ms`, `hold_until_ms`, `fade_out_ms`, `end_ms`, which may be after the spell ends) and per-frame `curves` for opacity, scale and rotation. The guide has step-by-step setups for Unity's URP/HDRP Decal Projector and Godot 4's Decal node, and a note for 2D engines.

Decals with depth or a fill (the realistic style, or a template `fill` such as `lava`) also get `decal-<id>-height.png` (white = ground, black = deepest; for parallax occlusion mapping), `decal-<id>-emissive.png` (where the fill sits) and, for lava and void, `decal-<id>-flow.png` (a flow map, outward from the centre). The JSON adds `depth`, `fill`, `fill_colors` and `fill`/`heat` curves, and the guide has a "Depth and fills" section.

### Styles

Pick a **Style** in the export dialog (it defaults to the viewer's), or pass `--style realistic` (`stylized`, `realistic`, `toon`, `pixel`) to `tools/export_sprites.py` or `style` to the director's `export_sprites` tool. The guide gets a "Style" section with whole-effect Unity and Godot steps for that style, and every layer's recipe gets the style's extra steps (vocabulary §12). The sheets show the style too: realistic decals with depth, toon cells posterized with hard edges and ink outlines, pixel art cells in chunky pixels with few shades. Tone mapping is left to your engine. Non-default styles export to `<id>-seed<seed>-<style>`.

### Not drawn into the sheets

These are exported as tracks with one value per frame, because an engine does them better than baked pixels:

- **Screen flashes** (`flash` with `scope: screen`): color, add or multiply, and an opacity curve.
- **Camera shake**: frequency and an amplitude curve in template pixels (100 px = one character height).
- **Lights**: anchor, color, range and an energy curve.
- **Sound cues**: start time and frame, cue, length, volume, pitch, one-shot or sustained, and the cue's text-to-SFX prompt.

## Letting an AI model check the sheets

The sheets carry no numbers or gridlines (the engine wants clean pixels), so the JSON is the map. Every guide has a section for AI readers with the grid math, a worked example for that export and a crop snippet. A model shouldn't read a whole sheet at once: it gets scaled down and the cells blur. Crop instead:

```bash
python tools/sheet_cells.py contact exports/lightning-sky-strike-seed1 --sheet main-bolt   # labeled grid of one sheet
python tools/sheet_cells.py frame   exports/lightning-sky-strike-seed1 --frame 15 --layers # one moment, every view and layer
python tools/sheet_cells.py cell    exports/lightning-sky-strike-seed1 --sheet main-bolt --view top --frame 14
python tools/sheet_cells.py labeled exports/lightning-sky-strike-seed1                     # *_labeled.png debug copies
python tools/sheet_cells.py map     exports/lightning-sky-strike-seed1                     # every cell's rectangle as text
```

Output goes to an `ai/` folder inside the export. The director's MCP server has the same thing as `look_at_sprite_sheet`, which returns the image to the model. Only Pillow is needed, and it works on a .zip from the viewer once unpacked.

## Code

- `web/js/engine/spritesheet.js`: pure and Node-tested. Frame plan, sheet layout, tracks, the manifest and the guide.
- `web/js/exporter.js`: renders the frames with Three.js (the same `Effect` as the viewer, so frames are a pure function of template, seed and time) and builds the PNGs.
- `web/js/zip.js`: a small stored-ZIP writer for the viewer's download.
- `tools/sheet_cells.py`: crops and labels cells from an export using its JSON, for review.
- `tools/export_sprites.py`: starts the viewer server, opens it in headless Chromium and calls `window.spellDirectorExport`.
