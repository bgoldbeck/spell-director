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
| Example templates | done: 5 lightning, 1 water | `templates/*/*.json` |
| GIF breakdown tool + playbook | done | `tools/breakdown.py`, `docs/gif-breakdown-playbook.md` |
| Viewer (Three.js motion study) | done, v1 | `web/`, `tools/serve.py` |
| Director: playbook + MCP server | done, v1 | `docs/director-playbook.md`, `director/` |
| Sprite sheet export + assembly guide | done, v1 | `docs/exporting.md`, `web/js/exporter.js`, `tools/export_sprites.py` |
| Animated GIF export (any of the views) | done | `web/js/gifexport.js`, `web/js/gif.js`, `tools/export_gif.py` |
| Engine integration | not started | ROADMAP |

Languages: Python 3.11+ for tools and the director (jsonschema, numpy, Pillow, PyAV, pytest, mcp 2.x), plain ES modules for the web viewer (no build step, Three.js r169 vendored in `web/vendor`). No CI; tests run locally.

## 3. The template format

Full reference: [template-format.md](template-format.md). Summary:

- **Top level**: `schema` (`spelldirector.template/0.1.0`), `id`, `name`, `element`, `archetype` (`strike`, `projectile`, `chain`, `beam`, `aura`, `nova`, `status`), `timing.duration_ms`, `space`, `views`, `palette`, `beats`, `layers`, `variation`, `director_notes`, `source`.
- **Beats** are the timeline. Each has a `phase` (`anticipation`, `release`, `travel`, `impact`, `dissipation`), `start_ms`/`end_ms`, an `intensity` curve (`linear`, `ease_in`, `ease_out`, `ease_in_out`, `spike`, `flicker`, `hold`) and an `intent` sentence that is shown as the caption in the viewer.
- **Layers** each do one visual job: `bolt`, `glow`, `flash`, `sparks`, `crackle`, `orb`, `beam`, `ring`, `decal`, `smoke`, `coat` (a skin over a status effect's victim), `light`, `camera_shake`, `sound_cue`. A layer lists the beats it's active in; its brightness follows those beats' curves. Layers have an `anchor` (`caster`, `caster_hand`, `sky`, `ground`, `target`, `point`, `screen`), optional `attach_to` another layer, `plane` (`ground`, `vertical`, `billboard`, `volume`), `blend`, palette `color` slot, `z`, `params` and `keyframes`.
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

- `director/library.py`: plain functions over the library: `list_templates`, `get_template`, `get_doc`, `get_schema`, `get_sound_cues`, `validate_template` (wraps `tools/validate.py`), `save_template`, `breakdown_reference` (wraps `tools/breakdown.py`). Tests use these directly.
- `director/mcp_server.py`: thin MCP adapter (mcp Python SDK 2.x, `MCPServer`). Tools mirror the library; the docs and schema are resources; `direct_spell`, `direct_from_gif` and `grow_library` are prompts that load the playbooks. It must never print to stdout (the stdio channel).
- `save_template` validates first, writes `templates/<element>/<id without the element prefix>.json`, rebuilds `templates/index.json`, refuses to replace a template unless `overwrite` is set, and never replaces a file holding a different id. `breakdown_gif` writes to `breakdowns/<name>/` (git-ignored) and returns the contact sheet and curves images.
- The playbook caps questions at 2–3, maps weight words to durations and sizes, requires `views.reads` for all four views and a ground story for top-down heroes, and has a library mode for generating templates without a request.
- Acceptance example: "heavy boss lightning, top-down game" → `templates/lightning/boss-storm-call.json`.

## 6. Viewer

`run.bat` (Windows) or `./run.sh` → http://localhost:47811 (default port; `--port` or `SPELLDIRECTOR_PORT` to change, next free port if busy). Only one viewer runs at a time: a second launch opens the browser on the running one and exits (OS lock in the temp folder; `--new-instance` skips it). The launch scripts go through `tools/launch.py`, which first fast-forwards the checkout from GitHub when that's safe, then runs `serve.py --replace`: the running viewer is asked to stop (`POST /api/shutdown`, localhost-only header) or its process is ended, and a fresh one starts in its place. The header shows the app version from `/version.json`. Laid out like the motion study:

- **Type** and **Spell** dropdowns: templates are grouped by their `element` (new types show up on their own), with "All types" listing every spell under its type; **‹ Prev / Next ›** (or `[` / `]`) step through the chosen type. Beat buttons (jump to a beat) with a **Clear** button; beat-intent captions on the stage; sound cues play in sync and show as captions, with a **Sound on/off** toggle (off by default; M; remembered per browser; `?sound=on` or `?sound=off` in the URL).
- Scrubber with colored phase bands; Replay, Pause/Play, speed 0.1×–2×, Loop, Seed + **New cast**, **Focus view** (F) for recording.
- **Front / Side / Top / 3/4 / All four** camera presets; hero view starred and opened until the user picks a view, which then sticks across spells and visits (saved in the browser; `?view=` overrides it for one visit without saving); each view shows that template's `views.reads`. OrbitControls for free orbit. Top is orthographic.
- Layer toggles, palette swatches, description and director's notes. **Open JSON…** loads any template file.
- URL parameters for automation: `?template=<id>&type=<element>&view=<front|side|top|three_quarter|quad>&t=<ms>` (with `t`, playback starts paused). An unknown `template` or `type` shows an error naming it, then falls back to the first spell. Picking a spell updates the URL, so it can be bookmarked or shared.

Engine (`web/js/engine/`):

- `timeline.js`: pure functions, Node-testable: seeded RNG (mulberry32), param resolution, beat curves, layer intensity, keyframes.
- `stage.js`: world layout from `space` (caster at origin facing +X, hand, sky, targets laid out in the footprint cone, beam end point) and the four camera presets.
- `effect.js`: one class per layer type. **Every frame is a pure function of (template, seed, t)**, so scrubbing and all four views show the same cast. Randomness that changes over time (bolt regeneration, flicker) is seeded by a time tick. Bolts, beams, crackle, arcs and spark streaks are camera-facing ribbons (water and fire beams scroll noise through them in the fragment shader: a churning liquid column, or a widening flame cone with a white-yellow to orange to red temperature ramp and billowing flame sprites riding it) with a soft profile (one draw call per mesh; the vertex shader turns each ribbon to face whichever camera draws it, so the four views stay right). Bolts attached to a beam ride along it as short arcs. Projectile orbs fly from the hand to the target during their `travel` beat with a trail; an orb anchored in the sky falls onto the target instead (a meteor is a lumpy rock mesh with per-vertex heat plus flame and smoke puffs emitted at fixed times along the flight). Vortices (`engine/vortex.js` holds their pure shape and motion) are a translucent funnel mesh rebuilt each frame with spiral streak noise in the fragment shader; sparks and smoke attached to one orbit it. Eruptions are lit, flat-shaded rock meshes (seeded spikes or slabs) laid out in rows along an arc when the layer is built; each frame only poses them (thrust up with an overshoot, hold, crumble) and places their thrown chunks and dust from the time since each rock erupted.
- `decal.js` (pure, Node-testable): decal shapes, default blends and each decal's opacity, scale and rotation over time (fade in, lifetime, fade out, grow, spin, pulse, seeded angle); shared by the viewer and the export. `decaltex.js` draws each shape's top-down texture on a canvas from the seed. Decals draw first, flat on the ground, in `z` order, so everything standing on the ground draws over them.
- `post.js`: the scene is drawn into an HDR render target, bloomed (UnrealBloomPass, vendored in `web/vendor/postprocessing`) and written to the canvas. The viewer's **Bloom** checkbox (B, `?bloom=off`) turns it off; the sprite export bakes the same bloom unless asked not to.

Sound: `web/js/engine/sound.js` (pure, Node-testable) turns a template's `sound_cue` layers into a schedule of events (cue, start, length, gain, pitch) from the template, the seed and the cue library `web/sounds/cues.json`. `web/js/audio.js` plays the events whose start the clock crossed this frame: a real sample if the cue lists `samples`, otherwise a procedural Web Audio placeholder named after the cue. Jumps, pauses and new spells cut the sound; rendering never reads audio state, so frames stay a pure function of (template, seed, t). Every cue has a `sfx_prompt` so a text-to-SFX service can fill the library later.

`web/js/catalog.js` (pure, Node-testable) groups templates by type for the dropdowns, steps through a type, and resolves the URL parameters.

Export: **Export sprites…** renders the current template and seed into one sheet per layer plus `all.png` (columns are frames, rows are the four views, every cell aligned), with a `spelldirector.spritesheet/1` JSON file and a Markdown assembly guide, downloaded as a .zip. Screen flashes, camera shake, lights and sound cues are exported as per-frame tracks instead of pixels. Decals also get a top-down texture (`decal-<id>.png`) plus timing and per-frame curves for engine decal projectors. Full description: [exporting.md](exporting.md).

Static hosting: `templates/index.json` (written by `tools/build_index.py`) lists the templates. A live preview was published as a private claude.ai artifact.

## 7. Known issues and limits

- **Flash and smoke are basic** (soft sprites and a CSS screen overlay).
- **Camera-view guess in the breakdown tool is weak** (called the 3/4 sample GIF "front"). The playbook has the AI confirm by eye.
- Breakdown has only been tested on a synthetic GIF and MP4, never a real game capture.
- Templates exist for lightning and water only. Some layer params in the format (e.g. `light.radius` units) are only roughly honored by the renderer.
- Decals lie on the viewer's flat ground plane. Engines project them onto real terrain with their decal projectors (the export has the texture and curves for that).
- Screen flash in "All four" mode covers all quadrants at once.
- Export makes sprite sheets only (no PNG sequence or GIF yet), and the viewer can't play an exported sheet back to check it.
- Sounds are procedural placeholders (synth + filtered noise). They get the timing right but sound like placeholders; swap in CC0 samples or text-to-SFX output per cue (`web/sounds/README.md`).
- The viewer lays out several targets for chains and for targeted area (splash) spells only; a free-standing area "storm" with no target in it still renders on one spot.

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
| 2026-11-15 | Sound is timed cues mapped to a small generic cue library, not generated audio. Procedural Web Audio placeholders now; real CC0 samples or text-to-SFX output replace them per cue later. |
| 2026-11-15 | Decals are a first-class layer: ground marks with fade-in/out, lifetime past the spell, grow, rotation, spin and seeded variation, exported as a top-down texture plus timing curves for Unity/Godot decal projectors. |
| 2026-11-15 | Engine handoff is sprite sheets + an instruction .md (and JSON): one sheet per layer, frames as columns and the four views as rows, layer timings documented. |
| 2026-11-15 | Exports are a timing and composition reference, not literal instructions; the magic is described per layer as shader intent (material, noise, flow, distortion, fresnel, dissolve, emissive) in the vocabulary and templates, for engines to build with shaders. |
| 2026-11-20 | Status effects (burning, frozen, asleep, ...) are an archetype, `status`: a looping attachment to one target with apply, loop and expire, reusing the aura's `loop_range`. They read on the body through a `coat` layer and over the head through camera-facing comic glyphs. |
| 2026-11-20 | Targeted area spells (pick one enemy, slam everyone round it) are a space layout (`targets.layout: splash`) plus a `splash` anchor, not a new archetype, so any element and archetype can splash. Thrown weapons are an orb look. |
