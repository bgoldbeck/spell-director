# SpellDirector Roadmap

Prioritized. Each numbered item is roughly one branch and PR. Read [DESIGN.md](DESIGN.md) first.

## Done

- **PR #1** Vocabulary, template format and schema 0.1.0, validator, three lightning templates, four camera views in the format.
- **PR #2** GIF breakdown tool and playbook, synthetic sample GIF.
- **PR #3** Three.js motion-study viewer.
- **PR #4** Design doc, roadmap and agent notes.
- **Director v1**: director playbook, MCP server (`director/`), `save_template`, boss storm call template from "heavy boss lightning, top-down game".

## Next

### 1. Director follow-ups

- Try the director end to end from a real MCP client (Claude Code or Desktop) with a few requests, and tighten the playbook where it asks too much or guesses wrong.
- Library mode: generate a spread of lightning templates and keep the good ones.
- Optional: an `open_preview` tool that starts the viewer server and returns screenshots of all four views, so the director can check its own work.

### 2. Run the breakdown on real GIFs and MP4s

MP4 and other video input is done (`tools/breakdown.py`, `--start`/`--end`). First real reference done (a game capture of a water jet, GIF and MP4): camera cuts, bright backgrounds, idle animation and UI overlays are handled, and it produced the `water-pressure-jet` template.

- Get 3–5 real spell GIFs/MP4s from the owner (front, side, top, 3/4 if possible).
- Fix what breaks: camera movement within a shot (pans, shake), very long GIFs. Cuts, bright backgrounds, idle animation and dithering are done.
- Improve the view guess (e.g. detect ground-plane ellipses, horizon line).
- Write one template from a real GIF end to end with the playbook, and note playbook gaps. Done once (Pressure Jet); gaps found and added to the playbook: multi-shot clips, bright backgrounds, improving on a weak reference.

### 3. Viewer: side-by-side reference

The Analyze page (`web/analyze.html`) already plays a dropped clip frame by frame against its breakdown timeline.

- Load a GIF next to the render (same view, synced time) for comparison, as the playbook's step 7 describes.
- Optional onion-skin overlay.

### 4. Viewer: visual quality

Done: bloom, soft camera-facing ribbons for bolts, beams and crackle, arcs that hug their beam, spark streaks, soft shockwave rings, projectile travel with a trail (Ball Lightning).

- Screen flash per quadrant in "All four" mode.
- Softer smoke (animated noise instead of round sprites).

### 4b. Decals

Done: decals are first-class (nine shapes, fade-in/out, lifetime past the spell, grow, rotation, spin, pulse, seeded angle), drawn under everything on the ground, exported as top-down textures with curves and Unity/Godot projector steps, used by every template and by the director playbook.

- Try the decal export with Unity's URP Decal Projector and Godot's Decal node end to end.
- Decals on uneven ground in the viewer (a bumpy test floor) to check the projection reads.

### 5. Export

Sprite sheets are done (`docs/exporting.md`): one sheet per layer plus a whole-spell sheet, frames as columns and views as rows, a JSON file and an assembly guide, from the viewer, `tools/export_sprites.py` or the director's `export_sprites` tool.

- Try an export in Unity (Sparkfall) end to end and fix what the guide gets wrong.
- PNG sequence and GIF output.
- Fixed-seed batches for variation sets.
- A sheet preview in the viewer to check an export plays back right.

### 6. In-viewer editing

- Edit beat times by dragging their bands on the scrubber.
- Param sliders per layer (ranges shown as min/max handles), saved as a new template version.
- "Copy for AI" button: produces a prompt with the template and the selected beat/layer so the director can revise just that part.

### 7. More elements

- Wind (started: Tornado, the `vortex` layer).
- Earth (started: Ground Pound, Rending Quake, Rockfall, Stone Spires; the `eruption` layer).
- Fire (started: Dragon Breath, Flame Jet, Inferno Burst, Ember Volley, beam `style: fire`; Meteor Strike, orb `look: meteor`), ice, nature/roots (the Dryad motion study is a good test), arcane, shadow.
- New layer types as needed (e.g. `trail`, `ribbon`, `mesh_growth` for roots/vines, `distortion`). Add them to the vocabulary, schema, validator and viewer together.
- Schema 0.2.0 when breaking changes are needed; keep 0.1.0 loading.

### 8. Hosting and packaging

- Docker image serving the viewer (and the MCP server, if built) for the owner's TrueNAS.
- App icon: generate with **Codex** (owner's rule), not Claude.

### 9. Game engine integration

- Engine-agnostic first: sprite sheets + metadata from Export (done).
- An importer script per engine that builds the effect from the export JSON.
- Then runtime players that read template JSON directly (Unity first, the owner's game Sparkfall is Unity; Godot possible).

## Open questions for the owner

- Which games/cameras matter most (decides default hero view)?
- Where will real reference GIFs come from, and how will they be stored (repo vs. local only)?
- Target export resolutions and frame rates.
