# SpellDirector Design

This is the full design of SpellDirector as of 2026-11-15, written so someone (or another Claude) with no prior context can pick the project up. The prioritized feature list is in [ROADMAP.md](ROADMAP.md). Working rules are in [`CLAUDE.md`](../CLAUDE.md).

## 1. Vision

SpellDirector is an AI **director** for game spell effects (VFX), usable for any game.

The owner doesn't know VFX terminology and shouldn't need to. They describe a spell loosely ("heavy boss lightning") or show the director a reference GIF. The director, which *does* know the vocabulary, offers a few concrete choices in plain words and then writes a **template**: a precise, structured recipe for the effect (phases, timing, layers, palette, variation ranges). A renderer turns template + seed into the effect.

**Templates are the core of the product.** Everything else exists to create templates (the director, GIF breakdown), check them (validator, viewer) or use them (exports, engine integration).

Key principles:

- **The AI gives the directions, not the user.** The director proposes; the user picks.
- **Template + seed = effect.** Ranges in a template are resolved from a seed, so a cast is exactly reproducible and a new seed gives a fresh variation of the same spell.
- **Four camera views matter.** Every effect must read from front, side, top and 3/4. Templates are authored in 3D and record how they should read from each view.
- **Learn from references, don't copy them.** A GIF breakdown captures the character (timing, shape, palette, layering) of a reference so the director can write an original template.
- **Lightning first**, then other elements.

### Origins

- The owner's [MidiMCP](https://github.com/bgoldbeck/MidiMCP) project (AI reads templates to compose songs, an app plays them back) inspired the idea of AI-readable templates. It is **inspiration only**: don't copy its architecture, stack or deployment.
- A "Motion study" web UI (a Dryad root-capture study with effect-family tabs, phase buttons, beat captions, scrubber, speed, loop and Focus view) is the model for the viewer.

## 2. Architecture

```
            text request ──┐                       ┌── viewer (Three.js, 4 views)
                           ├─► DIRECTOR ─► TEMPLATE ┤
 GIF ─► breakdown tool ────┘   (AI + playbooks)  (JSON) └── exports / game engines (planned)
                                                   │
                                              validator
```

| Part | Status | Where |
|---|---|---|
| Vocabulary (the director's language) | done | `docs/vocabulary.md` |
| Template format + JSON Schema 0.1.0 | done | `docs/template-format.md`, `schemas/template-0.1.0.schema.json` |
| Validator | done | `tools/validate.py` |
| Example templates (lightning) | done, 4 | `templates/lightning/*.json` |
| GIF breakdown tool + playbook | done | `tools/breakdown.py`, `docs/gif-breakdown-playbook.md` |
| Viewer (Three.js motion study) | done, v1 | `web/`, `tools/serve.py` |
| Director: playbook + MCP server | done, v1 | `docs/director-playbook.md`, `director/` |
| Exports (sprite sheets, PNG sequences, GIF) | not started | ROADMAP |
| Engine integration | not started | ROADMAP |

Languages: Python 3.11+ for tools and the director (jsonschema, numpy, Pillow, PyAV, pytest, mcp 2.x), plain ES modules for the web viewer (no build step, Three.js r169 vendored in `web/vendor`). No CI; tests run locally.

## 3. The template format

Full reference: [template-format.md](template-format.md). Summary:

- **Top level**: `schema` (`spelldirector.template/0.1.0`), `id`, `name`, `element`, `archetype` (`strike`, `projectile`, `chain`, `beam`, `aura`, `nova`), `timing.duration_ms`, `space`, `views`, `palette`, `beats`, `layers`, `variation`, `director_notes`, `source`.
- **Beats** are the timeline. Each has a `phase` (`anticipation`, `release`, `travel`, `impact`, `dissipation`), `start_ms`/`end_ms`, an `intensity` curve (`linear`, `ease_in`, `ease_out`, `ease_in_out`, `spike`, `flicker`, `hold`) and an `intent` sentence that is shown as the caption in the viewer.
- **Layers** each do one visual job: `bolt`, `glow`, `flash`, `sparks`, `crackle`, `orb`, `beam`, `ring`, `decal`, `smoke`, `light`, `camera_shake`, `sound_cue`. A layer lists the beats it's active in; its brightness follows those beats' curves. Layers have an `anchor` (`caster`, `caster_hand`, `sky`, `ground`, `target`, `point`, `screen`), optional `attach_to` another layer, `plane` (`ground`, `vertical`, `billboard`, `volume`), `blend`, palette `color` slot, `z`, `params` and `keyframes`.
- **Any param** may be a number or a `{min, max}` range picked from the seed.
- **Space**: `origin`, `destination`, `travel` (`instant`, `projectile`, `beam`, `chain`), `footprint` (shape, length, radius, angle, distribution) and chain `targets` (count, hop delay). 1 world unit = one character height; template pixel sizes are converted at 100 px per unit.
- **Views**: `hero` view plus `reads` for `front`, `side`, `top`, `three_quarter`: what the player should see in each.
- **Palette** slots: `core`, `primary`, `secondary`, `accent`, `shadow`.

`tools/validate.py` checks the schema plus extra rules: unique ids, beats inside the duration, references exist, keyframes inside active beats, ranges ordered, unknown params warned.

## 4. GIF breakdown

`python tools/breakdown.py spell.gif --out breakdowns/spell` measures a GIF or video and writes `breakdown.json` plus a labelled contact sheet, curves chart, palette swatches and heatmap. It reports frame timing (browser delay rules, merged frames), per-frame intensity / coverage / motion / centroid / bbox, peaks, flicker rate, hold frames, phase hints, footprint, travel direction, a camera-view guess and a palette with suggested slots.

The [playbook](gif-breakdown-playbook.md) tells the AI how to turn that into a template: identify the camera view first, then timeline, layers, params, palette, and write and validate the template.

Videos (MP4, WebM, MOV, MKV, AVI) are decoded with PyAV, trimmed with `--start`/`--end`, sampled at up to 30 fps and 20 s, with stored frames capped at 640 px. Each kept frame lasts until the next, like merged GIF frames, so the rest of the analysis is shared.

Background is estimated as the 10th-percentile brightness per pixel (spell effects are mostly additive light).

## 5. Director

The director is an AI agent following [director-playbook.md](director-playbook.md), connected through an MCP server (`python -m director.mcp_server`, stdio; `.mcp.json` registers it for Claude Code).

- `director/library.py`: plain functions over the library: `list_templates`, `get_template`, `get_doc`, `get_schema`, `validate_template` (wraps `tools/validate.py`), `save_template`, `breakdown_reference` (wraps `tools/breakdown.py`). Tests use these directly.
- `director/mcp_server.py`: thin MCP adapter (mcp Python SDK 2.x, `MCPServer`). Tools mirror the library; the docs and schema are resources; `direct_spell`, `direct_from_gif` and `grow_library` are prompts that load the playbooks. It must never print to stdout (the stdio channel).
- `save_template` validates first, writes `templates/<element>/<id without the element prefix>.json`, rebuilds `templates/index.json`, refuses to replace a template unless `overwrite` is set, and never replaces a file holding a different id. `breakdown_gif` writes to `breakdowns/<name>/` (git-ignored) and returns the contact sheet and curves images.
- The playbook caps questions at 2–3, maps weight words to durations and sizes, requires `views.reads` for all four views and a ground story for top-down heroes, and has a library mode for generating templates without a request.
- Acceptance example: "heavy boss lightning, top-down game" → `templates/lightning/boss-storm-call.json`.

## 6. Viewer

`run.bat` (Windows) or `./run.sh` → http://localhost:47811 (default port; `--port` or `SPELLDIRECTOR_PORT` to change, next free port if busy). Laid out like the motion study:

- Template tabs; beat buttons (jump to a beat) with a **Clear** button; beat-intent captions on the stage; sound cues shown as captions.
- Scrubber with colored phase bands; Replay, Pause/Play, speed 0.1×–2×, Loop, Seed + **New cast**, **Focus view** (F) for recording.
- **Front / Side / Top / 3/4 / All four** camera presets; hero view starred and opened by default; each view shows that template's `views.reads`. OrbitControls for free orbit. Top is orthographic.
- Layer toggles, palette swatches, description and director's notes. **Open JSON…** loads any template file.
- URL parameters for automation: `?template=<id>&view=<front|side|top|three_quarter|quad>&t=<ms>` (with `t`, playback starts paused).

Engine (`web/js/engine/`):

- `timeline.js`: pure functions, Node-testable: seeded RNG (mulberry32), param resolution, beat curves, layer intensity, keyframes.
- `stage.js`: world layout from `space` (caster at origin facing +X, hand, sky, targets laid out in the footprint cone, beam end point) and the four camera presets.
- `effect.js`: one class per layer type. **Every frame is a pure function of (template, seed, t)**, so scrubbing and all four views show the same cast. Randomness that changes over time (bolt regeneration, flicker) is seeded by a time tick.

Static hosting: `templates/index.json` (written by `tools/build_index.py`) lists the templates. A live preview was published as a private claude.ai artifact.

## 7. Known issues and limits

- **Beam-attached arcs** (`beam-arcs` in charge-discharge) spread too far from the beam. Arcs attached to a beam should hug it.
- **Glow, flash and smoke are basic** (sprites and a CSS screen overlay). No bloom post-processing; bolts are instanced cylinders.
- **Camera-view guess in the breakdown tool is weak** (called the 3/4 sample GIF "front"). The playbook has the AI confirm by eye.
- Breakdown has only been tested on a synthetic GIF and MP4, never a real game capture.
- Only lightning has templates. Some layer params in the format (e.g. `light.radius` units, `decal.shape: burn`) are only roughly honored by the renderer.
- Projectile travel (`travel: projectile`) is in the format but the viewer has no projectile layer behavior yet.
- Screen flash in "All four" mode covers all quadrants at once.
- No export of rendered frames yet.
- The viewer only lays out several targets for chains, so an area "storm" of strikes can't be previewed yet; the director playbook tells the AI to stay within what the viewer draws.
- An unknown `?template=` id silently falls back to the first template.

## 8. Decisions log

| Date | Decision |
|---|---|
| 2026-11-15 | General VFX system for any game, not Pokemon-specific. |
| 2026-11-15 | Templates are the core; an AI director generates them and supplies the vocabulary. |
| 2026-11-15 | AI must be able to read a spell GIF and break it down into a template. |
| 2026-11-15 | Emphasis on four views: front, side, top, 3/4. |
| 2026-11-15 | Name SpellDirector; repo `bgoldbeck/spell-director`. |
| 2026-11-15 | Use Codex for any image generation (e.g. the app icon). |
| 2026-11-15 | UI in Three.js as a web app (not Godot); built before the director. |
| 2026-11-15 | Every feature on its own branch → PR → merge → delete branch. |
| 2026-11-15 | The director's bridge is an MCP server (Python, official SDK), a thin adapter over the library functions. |
| 2026-11-15 | Breakdown should accept MP4 references as well as GIFs. |
