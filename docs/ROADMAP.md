# SpellDirector Roadmap

Prioritized. Each numbered item is roughly one branch and PR. Read [DESIGN.md](DESIGN.md) first.

## Done

- **PR #1** Vocabulary, template format and schema 0.1.0, validator, three lightning templates, four camera views in the format.
- **PR #2** GIF breakdown tool and playbook, synthetic sample GIF.
- **PR #3** Three.js motion-study viewer.

## Next

### 1. The director (plan step 3) — highest priority

The core of the product. The director turns a loose request or a GIF breakdown into a template, asking the user a few plain-word choices along the way.

- `docs/director-playbook.md`: how the director talks. Pick an archetype and hero view, propose phases with durations, ask at most 2–3 choices in plain words (examples are in `vocabulary.md` §9), pick palette and layers, fill `views.reads`, write ranges and variation notes, validate.
- A way for an AI agent to drive it. Recommended: an MCP server (Python, official SDK) exposing tools like `list_templates`, `get_template`, `get_vocabulary`, `validate_template`, `save_template`, `breakdown_gif`, plus resources for the vocabulary, format and playbooks. Keep it a thin adapter over the same Python functions the CLI tools use. Decide with the owner whether MCP is the bridge before building.
- `save_template` writes to `templates/<element>/<id>.json`, validates first, and rebuilds `templates/index.json`.
- Template generation without a request ("build the library"): the director writes N varied templates for an element/archetype.
- Acceptance: from "heavy boss lightning, top-down game" the director produces a template that validates and looks right in the viewer.

### 2. Run the breakdown on real GIFs

- Get 3–5 real spell GIFs from the owner (front, side, top, 3/4 if possible).
- Fix what breaks: camera movement, non-black backgrounds, UI overlays, dithering, very long GIFs.
- Improve the view guess (e.g. detect ground-plane ellipses, horizon line).
- Write one template from a real GIF end to end with the playbook, and note playbook gaps.

### 3. Viewer: side-by-side reference

- Load a GIF next to the render (same view, synced time) for comparison, as the playbook's step 7 describes.
- Optional onion-skin overlay.

### 4. Viewer: visual quality

- Bloom post-processing (UnrealBloomPass from three/examples) instead of stacked additive cylinders.
- Bolts as camera-facing ribbons with a soft texture.
- Fix beam-attached arcs to hug the beam.
- Screen flash per quadrant in "All four" mode.
- Projectile travel (orb or bolt head moving from caster to target with a trail).

### 5. Export

- Render a template to a PNG sequence, sprite sheet (with JSON metadata: frame size, fps, loop) and GIF, per view, from a seed. Headless via Playwright, or in-browser with a download through the viewer.
- Fixed-seed batches for variation sets.

### 6. In-viewer editing

- Edit beat times by dragging their bands on the scrubber.
- Param sliders per layer (ranges shown as min/max handles), saved as a new template version.
- "Copy for AI" button: produces a prompt with the template and the selected beat/layer so the director can revise just that part.

### 7. More elements

- Fire, ice, nature/roots (the Dryad motion study is a good test), arcane, shadow.
- New layer types as needed (e.g. `trail`, `ribbon`, `mesh_growth` for roots/vines, `distortion`). Add them to the vocabulary, schema, validator and viewer together.
- Schema 0.2.0 when breaking changes are needed; keep 0.1.0 loading.

### 8. Hosting and packaging

- Docker image serving the viewer (and the MCP server, if built) for the owner's TrueNAS.
- App icon: generate with **Codex** (owner's rule), not Claude.

### 9. Game engine integration

- Engine-agnostic first: sprite sheets + metadata from Export.
- Then runtime players that read template JSON directly (Unity first, the owner's game Sparkfall is Unity; Godot possible).

## Open questions for the owner

- Is MCP the bridge for the director, or something else (CLI, chat-only with files)?
- Which games/cameras matter most (decides default hero view)?
- Where will real reference GIFs come from, and how will they be stored (repo vs. local only)?
- Target export resolutions and frame rates.
