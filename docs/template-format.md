# Template Format (v0.1.0)

A **template** is what the director writes. It describes a spell effect well enough that a renderer can draw it, and loosely enough that every cast can look a little different.

- Schema: [`schemas/template-0.1.0.schema.json`](../schemas/template-0.1.0.schema.json)
- Terms: [`vocabulary.md`](vocabulary.md)
- Examples: [`templates/lightning/`](../templates/lightning/)
- Check a template: `python tools/validate.py templates/lightning/*.json`

## Core ideas

1. **Template + seed = effect.** Any parameter can be a fixed number or a `{"min": a, "max": b}` range. The renderer picks a value from the range using the cast's seed, so the same seed always gives the same frames, and a new seed gives a fresh variation.
2. **Beats are the timeline.** A template is a list of beats (phases with start/end times and an intensity curve). Layers say which beats they're active in.
3. **Layers do one job each.** A bolt, its glow, the flash, the sparks, the shake are separate layers so the director can reason about them and the user can tweak them.
4. **Renderer-agnostic.** Nothing here assumes Godot, a browser or a specific game engine. Space is described in both front and overhead terms (`space.footprint`).

## Top-level fields

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `"spelldirector.template/0.1.0"`. |
| `id` | yes | kebab-case, unique in the library. |
| `name` | yes | Human name. |
| `element` | yes | `lightning`, `fire`, `ice`, ... |
| `archetype` | yes | `strike`, `projectile`, `chain`, `beam`, `aura`, `nova`. |
| `description`, `tags` | no | For browsing the library. |
| `source` | no | `handwritten`, `director_text` (with `prompt`), or `director_gif` (with `reference`). |
| `timing` | yes | `duration_ms`, optional `fps_hint`, `loop`. |
| `space` | yes | Origin, destination, travel mode, footprint, chain targets. |
| `views` | yes | `hero` view plus `reads` for `front`, `side`, `top`, `three_quarter`. |
| `palette` | yes | `core` and `primary` required; `secondary`, `accent`, `shadow` optional. |
| `beats` | yes | The timeline. |
| `layers` | yes | What gets drawn. |
| `variation` | no | Notes on what should differ between casts. |
| `director_notes` | no | Why the director made the choices it did. Useful when revising. |

## Views

Every template is authored in 3D and must read from four cameras: front, side, top and 3/4 (see [vocabulary](vocabulary.md#7-camera-views)). The preview renders all four side by side.

```json
"views": {
  "hero": "three_quarter",
  "reads": {
    "front": "Tall vertical bolt, branches spreading left and right.",
    "side": "Same bolt edge-on; checks it has depth.",
    "top": "Bolt is a point; the ring, radial sparks and scorch tell the story.",
    "three_quarter": "Bolt reads tall and the ring reads as an ellipse."
  }
}
```

`reads` is written for people and for the GIF breakdown: it's the checklist the preview is judged against in each view.

Layers say how they sit in 3D with `plane`. If omitted, the default is:

| Plane | Default for |
|---|---|
| `ground` | `ring`, `decal` |
| `billboard` | `glow`, `orb`, `flash`, `light` |
| `volume` | `bolt`, `beam`, `crackle`, `sparks`, `smoke` |
| `vertical` | none by default; use for walls and pillars |

## Beats

```json
{ "id": "charge", "phase": "anticipation", "start_ms": 0, "end_ms": 350,
  "intensity": { "shape": "ease_in", "from": 0.1, "to": 0.6 },
  "intent": "Static crawls over the ground; the air feels loaded." }
```

Beats may overlap (an impact can start while the release is still fading). Every beat must fit inside `timing.duration_ms`.

## Layers

```json
{ "id": "main-bolt", "type": "bolt", "beats": ["strike", "restrike"],
  "anchor": "sky", "blend": "add", "color": "gradient_core_to_primary", "z": 10,
  "params": { "width_px": { "min": 6, "max": 9 }, "jaggedness": 0.65 },
  "keyframes": [ { "t_ms": 380, "param": "width_px", "value": 2, "ease": "ease_out" } ] }
```

- `beats`: ids of beats this layer is visible in. Its brightness follows those beats' intensity curves.
- `attach_to`: follow another layer (a glow wrapping a bolt).
- `keyframes`: override a numeric param at a moment in time. Values between keyframes are eased.

## Known params by layer type

Unknown params are allowed (the validator warns) so the director can experiment, but renderers only promise to support these.

| Layer | Params |
|---|---|
| `bolt` | `segments`, `jaggedness` (0–1), `width_px`, `taper` (0–1), `branch_chance` (0–1), `branch_depth`, `branch_length_ratio`, `regen_ms` (0 = never redraw), `restrikes`, `restrike_gap_ms`, `leader_ms`, `afterimage_ms`, `glow_px` |
| `glow` | `radius_px`, `softness` (0–1), `pulse_hz` |
| `flash` | `scope` (`screen` / `local`), `radius_px`, `peak` (0–1) |
| `sparks` | `count`, `speed`, `speed_spread`, `gravity`, `lifetime_ms`, `size_px`, `spread_deg`, `drag` |
| `crackle` | `count`, `length_px`, `jaggedness`, `regen_ms`, `radius_px` |
| `orb` | `radius_px`, `pulse_hz`, `wobble`, `crackle_count` |
| `beam` | `width_px`, `wobble`, `wobble_hz`, `jaggedness`, `regen_ms` |
| `ring` | `start_radius_px`, `end_radius_px`, `thickness_px`, `softness` |
| `decal` | `radius_px`, `shape` (`scorch` / `cracks` / `burn`), `fade_ms` |
| `smoke` | `count`, `rise_speed`, `size_px`, `lifetime_ms`, `opacity` |
| `light` | `radius`, `energy` |
| `camera_shake` | `amplitude_px`, `frequency_hz`, `decay` (0–1) |
| `sound_cue` | `cue` (`charge`, `crack`, `boom`, `sizzle`, `hum`) |

## Validation rules beyond the schema

`tools/validate.py` also checks:

- beat and layer ids are unique;
- every beat has `end_ms > start_ms` and fits in `duration_ms`;
- layers only reference beats and layers that exist;
- keyframes land inside the layer's active beats;
- every range has `min <= max`;
- unknown layer params are reported as warnings.

## Versioning

Breaking changes bump the schema version and add a new schema file. Renderers reject versions they don't know.
