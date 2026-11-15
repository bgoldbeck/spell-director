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

## Shader intent

Each drawn layer may have a `shader` object: what it's made of and how its surface behaves, for rebuilding it with shaders and particles in an engine. It never changes the viewer's frames. Terms and values: [vocabulary §11](vocabulary.md#11-shader-intent-the-magic).

```json
"shader": {
  "material": "ionized",
  "look": "Torn-open air: a white-hot core with crackling blue creases that crawl along the bolt.",
  "technique": "ribbon",
  "noise": { "type": "ridged", "scale": 6, "speed": 4, "contrast": 0.8 },
  "flow": { "direction": "along_path", "speed": 8 },
  "emissive": { "hdr": 6, "falloff": "exponential", "core_ratio": 0.3 },
  "lighting": "emits_light"
}
```

Fields: `material`, `look`, `technique`, `noise` (`type`, `scale`, `speed`, `contrast`), `flow` (`direction`, `speed`), `distortion`, `fresnel`, `dissolve` (`pattern`, `edge_width`, `edge_color`), `emissive` (`hdr`, `falloff`, `core_ratio`), `lighting`, `notes`. All optional. `sound_cue` and `camera_shake` layers take none.

## Known params by layer type

Unknown params are allowed (the validator warns) so the director can experiment, but renderers only promise to support these.

| Layer | Params |
|---|---|
| `bolt` | `segments`, `jaggedness` (0–1), `width_px`, `taper` (0–1), `branch_chance` (0–1), `branch_depth`, `branch_length_ratio`, `regen_ms` (0 = never redraw), `restrikes`, `restrike_gap_ms`, `leader_ms`, `afterimage_ms`, `glow_px` |
| `glow` | `radius_px`, `softness` (0–1), `pulse_hz` |
| `flash` | `scope` (`screen` / `local`), `radius_px`, `peak` (0–1) |
| `sparks` | `count`, `speed`, `speed_spread`, `gravity`, `lifetime_ms`, `size_px`, `spread_deg`, `drag`, `emit_ms` (how long new sparks keep spawning, default 120), `streak_ms` (each spark is drawn as a streak from where it was this long ago, default 60; lower for round droplets) |
| `crackle` | `count`, `length_px`, `jaggedness`, `regen_ms`, `radius_px` |
| `orb` | `radius_px`, `pulse_hz`, `wobble`, `crackle_count`; for `travel: projectile` an orb anchored at `caster_hand` flies to the target during its `travel` beat: `trail_ms` (streak behind it, default 140, 0 = none), `arc_height_px` (lob height at mid-flight, default 0), `travel_ease` (`linear` or `ease_in` to accelerate) |
| `beam` | `width_px`, `wobble`, `wobble_hz`, `jaggedness`, `regen_ms`, `grow_ms` (time to reach full length, default 60) |
| `ring` | `start_radius_px`, `end_radius_px`, `thickness_px`, `softness` |
| `decal` | `shape`, `radius_px`, `opacity`, `fade_in_ms`, `lifetime_ms`, `fade_ms`, `grow_ms`, `start_scale`, `rotation_deg`, `spin_deg_per_s`, `stretch`, `pulse_hz`, `detail`. See [Decals](#decals). |
| `smoke` | `count`, `rise_speed`, `size_px`, `lifetime_ms`, `opacity` |
| `light` | `radius`, `energy` |
| `camera_shake` | `amplitude_px`, `frequency_hz`, `decay` (0–1) |
| `sound_cue` | `cue` (one of the cues in [`web/sounds/cues.json`](../web/sounds/cues.json): `charge`, `hum`, `buzz`, `crackle`, `sizzle`, `zap`, `crack`, `boom`, `rumble`, `impact`, `crash`, `shatter`, `ignite`, `fire`, `whoosh`, `wind`, `shimmer`), `gain` (0–1, default 0.8), `pitch` (playback-rate multiplier 0.5–2, default 1), `offset_ms` (delay after the beat starts), `duration_ms` (override length), `repeat_ms` (one-shots: retrigger every N ms inside each beat) |

## Decals

A `decal` layer is a mark on the ground: drawn flat on the ground plane under everything else that stands there, and exported both as a sheet and as a top-down texture with a timing curve for engine decal projectors (see [exporting.md](exporting.md#decals)). The schema checks decal params (the shape names, number ranges).

| Shape | Default blend | Looks like | Use for |
|---|---|---|---|
| `scorch` | alpha | dark burnt blotch with soot rays (near black whatever the color) | fire, lightning, explosions |
| `burn` | add | glowing hot patch with embers | the hot moment of a hit, cooling fast |
| `cracks` | alpha (add for glowing cracks) | branching cracks from the centre | heavy hits; lightning arcs in the ground |
| `crater` | alpha | dark dent, dusty rim, debris | slams, meteors, boss strikes |
| `puddle` | alpha | lumpy wet patch with a bright rim | water, blood, slime |
| `splash` | alpha | wet patch with droplets thrown outward | water impacts |
| `frost` | alpha | ice crystals spiking outward | ice, freeze |
| `rune_circle` | add | rings, glyph marks and a star | casting, summoning, buffs |
| `warning_ring` | add | faint fill, bright rim and ticks | telegraphs: "get out of here" |

The layer's `blend` overrides the default (e.g. `cracks` with `blend: add` are glowing cracks). The color is the layer's palette slot.

| Param | Default | Meaning |
|---|---|---|
| `shape` | `scorch` | One of the shapes above. |
| `radius_px` | 40 | Radius at full size. |
| `opacity` | 0.85 | Peak opacity. |
| `fade_in_ms` | 60 | Fade in from the start of the layer's first beat. |
| `lifetime_ms` | until its last beat ends | How long it stays at full strength from its start. Can run past the spell's duration: the mark stays on the ground (engines keep it; the viewer shows the spell's length). |
| `fade_ms` | 400 | Fade out after the lifetime. |
| `grow_ms`, `start_scale` | 0, 0.6 | Grow from `start_scale` to full size (spreading puddle, closing telegraph). |
| `rotation_deg` | random per seed | Angle on the ground, counter-clockwise from the cast direction seen from above. |
| `spin_deg_per_s` | 0 | Turning speed (rune circles). |
| `stretch` | 1 | Length along its rotation axis relative to its width (a skid mark). |
| `pulse_hz` | 0 | Opacity throb (warning rings). |
| `detail` | 0.5 | How busy the texture is: number of cracks, rays, glyphs, droplets. |

Decal beats set when it appears (the start of its first beat) and, without `lifetime_ms`, how long it holds. A decal's brightness does not follow the beats' intensity curves: marks don't flicker. Stack two decals for a hot mark that cools: a glowing `burn`/`cracks` (add, short lifetime) over a dark `scorch` (alpha, long lifetime).

## Validation rules beyond the schema

`tools/validate.py` also checks:

- beat and layer ids are unique;
- every beat has `end_ms > start_ms` and fits in `duration_ms`;
- layers only reference beats and layers that exist;
- keyframes land inside the layer's active beats;
- every range has `min <= max`;
- unknown layer params are reported as warnings;
- a drawn layer without a `shader` intent is reported as a warning (an engine rebuild would have to guess its look), and so is a `shader` on a `sound_cue` or `camera_shake`;
- a `sound_cue` whose `cue` isn't in the cue library is reported as a warning (the viewer captions it but plays nothing).

## Versioning

Breaking changes bump the schema version and add a new schema file. Renderers reject versions they don't know.
