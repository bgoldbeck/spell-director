# Template Format (v0.1.0)

A **template** is what the director writes. It describes a spell effect well enough that a renderer can draw it, and loosely enough that every cast can look a little different.

- Schema: [`schemas/template-0.1.0.schema.json`](../schemas/template-0.1.0.schema.json)
- Terms: [`vocabulary.md`](vocabulary.md)
- Examples: [`templates/nature/`](../templates/nature/) (an aura), [`templates/blood/`](../templates/blood/), [`templates/sound/`](../templates/sound/), [`templates/shadow/`](../templates/shadow/), [`templates/poison/`](../templates/poison/), [`templates/lightning/`](../templates/lightning/), [`templates/water/`](../templates/water/), [`templates/fire/`](../templates/fire/), [`templates/wind/`](../templates/wind/), [`templates/light/`](../templates/light/), [`templates/energy/`](../templates/energy/), [`templates/psychic/`](../templates/psychic/), [`templates/earth/`](../templates/earth/)
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
| `element` | yes | `lightning`, `fire`, `ice`, `blood`, `sound`, `shadow`, `poison`, `spirit`, `physical` (blunt knocks: dazed, stunned), ... |
| `line` | no | The spell line (class, school or skill line) it belongs to, such as `Bard`, `Paladin`, `Druid`, `Necromancer` or `Vampire`. The viewer's Type list groups spells by line as well as by element. |
| `archetype` | yes | `strike`, `projectile`, `chain`, `beam`, `aura`, `nova`, `status` (a lingering affliction on one target, see [Status effects](#status-effects)). |
| `description`, `tags` | no | For browsing the library. |
| `source` | no | `handwritten`, `director_text` (with `prompt`), or `director_gif` (with `reference`). |
| `timing` | yes | `duration_ms`, optional `fps_hint`, `loop` (replay the whole spell), `loop_range` (an aura's seamless sustain loop, see [Auras](#auras)). |
| `space` | yes | Origin, destination, travel mode, footprint, chain targets. |
| `views` | yes | `hero` view plus `reads` for `front`, `side`, `top`, `three_quarter`. |
| `readability` | no | The quality target: the distance the look is judged at, camera distances to check, must-read cues and key frames. See [Readability](#readability). |
| `palette` | yes | `core` and `primary` required; `secondary`, `accent`, `shadow` optional. |
| `style` | no | The art style the spell is meant for: `preset` (`stylized` default, `realistic`, `toon`, `pixel`) and a few knobs. Every spell works in every style; see [Style](#style). |
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

`frame` (optional): `close` frames a small effect on one character (a buff) head to toe, plus what floats just over the head, instead of the whole stage. Default `auto`.

`reads` is written for people and for the GIF breakdown: it's the checklist the preview is judged against in each view.

Layers say how they sit in 3D with `plane`. If omitted, the default is:

| Plane | Default for |
|---|---|
| `ground` | `ring`, `decal` |
| `billboard` | `glow`, `orb`, `flash`, `light` |
| `volume` | `bolt`, `beam`, `vortex`, `wave`, `crackle`, `sparks`, `smoke`, `eruption`, `motif` |
| `vertical` | none by default; use for walls and pillars. A `ring` with `plane: vertical` stands upright across the cast direction (a muzzle or recoil shockwave around a beam) |

A `ring` with `plane: billboard` faces the camera in every view: a ripple of warped space around a target or a hand. Rings off the ground sit at their anchor's height, or chest height for `target` and `ground` anchors.

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
- `tracking`: how the layer moves when the actor it sits on moves: `follow`, `trail` or `stay`. See [Readability](#readability).
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

Fields: `material`, `look`, `technique`, `noise` (`type`, `scale`, `speed`, `contrast`), `flow` (`direction`, `speed`), `distortion`, `fresnel`, `dissolve` (`pattern`, `edge_width`, `edge_color`), `emissive` (`hdr`, `falloff`, `core_ratio`), `lighting` (`unlit`, `lit`, `emits_light`, or `six_way` for six-way lit smoke), `notes`. All optional. `sound_cue` and `camera_shake` layers take none.

## Style

One template, several looks. The viewer's **Style** menu (or `?style=`, or the `S` key) and the export can draw any spell **Stylized**, **Realistic**, **Toon** or **Pixel art**; the template's `style` only says which one it's meant for and refines it. A style changes how the viewer draws the spell and, more importantly, the engine recipe the export writes (per-style Unity and Godot steps, [vocabulary §12](vocabulary.md#12-styles)). Beats, layers, timing and palette stay the same.

```json
"style": { "preset": "realistic", "depth": 0.8, "notes": "Gritty and heavy: the ground should look torn open." }
```

| Field | Meaning |
|---|---|
| `preset` | `stylized` (default): saturated, soft, strong bloom. `realistic`: lit, decals with depth, heat haze, filmic tone mapping. `toon`: cel bands, hard edges, ink outlines. `pixel`: low-res pixel art. |
| `depth` | 0–1, how deep carved decals look in the realistic style (default 0.6). |
| `saturation`, `outline`, `bloom` | Viewer knobs for this preset: color saturation (1 = as authored), ink outline strength (toon), multiplier on the preset's bloom. |
| `notes` | What the style should feel like for this spell, copied into the export guide. |

A layer's shader intent can be refined per style with `shader.styles`: each key (`realistic`, `toon`, ...) holds shader fields that replace the base ones in that style (a realistic `look` sentence, a different `material`).

```json
"shader": {
  "material": "molten", "look": "Glowing cracks around the crater.", "technique": "decal",
  "styles": { "realistic": { "look": "The ground splits open: deep cracks with lit walls and lava welling up in them, crusting over as it cools." } }
}
```

## Readability

Two things a template can say so a rebuild in an engine keeps the look, and so `tools/range_guide.py` can check it. Neither changes the viewer's frames.

**`readability`** (optional, top level): the quality target.

| Field | Meaning |
|---|---|
| `reference_distance` | World units (1 = a character's height, not a metre) the look is judged at. Default: `space.footprint.length` (or `radius`). The flame jet's 3.4 is its reach, about 6 m for a 1.8 m character. |
| `view_distances` | Camera distances in units to check it at (default `[3, 6, 12, 20]`). |
| `must_read` | Up to 6 cues the player must see whatever else is simplified: `cue` (a few words), `layers` (the layers that carry it), optional `beat` or `at_ms` (when it must read; default the middle of the beat, else the spell's peak), `measure` (`thickness` across the cast direction, `start`: thickness where it leaves the caster so a gap at the hand shows, `core`: the hot core's thickness, `size`: overall size; default thickness for long shapes, else size) and `why`. |
| `key_frames` | Up to 6 moments to judge the quality target by: `label`, `t_ms`, `note` (what the frame must show). Default: the start of the first `release` and `impact` beats and partway into the first `dissipation` beat. |

```json
"readability": {
  "reference_distance": 3.4,
  "view_distances": [6, 12, 20],
  "must_read": [
    { "cue": "hand-to-jet connection", "layers": ["hand-fire", "jet"], "beat": "jet", "measure": "start", "why": "The jet must visibly leave the palm." },
    { "cue": "thin hot core", "layers": ["jet"], "beat": "jet", "measure": "core" }
  ],
  "key_frames": [ { "label": "ignition", "t_ms": 230, "note": "Hot flare at the palm, jet already attached." } ]
}
```

**`tracking`** (optional, per layer): how a layer moves when the actor it sits on moves (pushed back, walking, dodging).

| Value | Means | In an engine |
|---|---|---|
| `follow` | Rides on its anchor: the whole layer moves with the actor. Default for most layers. | Parent it to the anchor's bone; particles in local space. |
| `trail` | The emitter rides on the anchor but each particle stays where it was emitted: embers and smoke stream off a moving actor. Default for `sparks` and `smoke` that aren't attached, steady, homing or orbiting. | Parent the emitter; particle Simulation Space World (Godot: `local_coords` off). |
| `stay` | Placed once where the anchor was when it started and left there: a scorch mark, a crater. Default for `decal` and `eruption`. | Spawn it unparented in the level at the anchor's position. |

The sprite export carries both: each layer's `tracking` (with Unity and Godot steps) in the JSON and the guide, and the guide's **Quality target** section lists the must-read cues and key frames.

**Range guides.** `python tools/range_guide.py <template id>` renders the spell side-on in a headless browser and writes a guide sheet (PNG, plus the numbers as Markdown and JSON) to `exports/range-guides/`: how wide the whole visible body and the hot core are at stations from the hand to the target, the plume round the target, each must-read cue, what each is in pixels on a 1080p, 60° screen at the reference and view distances (and how far it still reads at 3 px), how the peak frame looks from each distance at true pixel size, the key frames annotated with what they must show, and which layers follow, trail or stay.

## Known params by layer type

Unknown params are allowed (the validator warns) so the director can experiment, but renderers only promise to support these.

| Layer | Params |
|---|---|
| `bolt` | Anchored at `splash` (in a splash spell) a bolt runs from the primary target's chest to each splash target's chest (a fork); `from: "previous"` runs it from the splash target before it instead (a chain round the group; `wrap: true` closes the loop: a cage), `from: "sky"` drops it from the sky onto each. `segments`, `jaggedness` (0–1), `width_px`, `taper` (0–1), `branch_chance` (0–1), `branch_depth`, `branch_length_ratio`, `regen_ms` (0 = never redraw), `restrikes`, `restrike_gap_ms`, `leader_ms`, `afterimage_ms`, `glow_px`. A bolt anchored at `caster_hand` (or `caster_fingertip` and the other hand anchors, see [Gestures](#gestures)) runs from the hand, wherever it is, to the target's chest (to each target in turn in a chain, to the point when `destination` is `point`); anchored at `sky` it drops onto the target. |
| `glow` | `radius_px`, `softness` (0–1), `pulse_hz`, `height_px` (lifts a glow off its anchor: a light in a character's chest; ignored with `attach_to`) |
| `flash` | `scope` (`screen` / `local`), `radius_px`, `peak` (0–1) |
| `sparks` | `count`, `speed`, `speed_spread`, `gravity`, `lifetime_ms`, `size_px`, `spread_deg`, `drag`, `emit_ms` (how long new sparks keep spawning, default 120), `streak_ms` (each spark is drawn as a streak from where it was this long ago, default 60; lower for round droplets), `look` (`spark` default; `droplet`: round water drops with a short wet trail instead of glowing streaks; `ember`: glowing flecks that flutter and flicker, pair with negative `gravity` so they float up; `debris`: lumpy rock chunks in the layer's color that tumble, land and stay on the ground, shrinking away at the end of their life), `glow` (debris only, 0–1: chunks start glowing in the palette's fire colors with a short hot streak and cool to rock over the first part of their flight). `look: leaf`: flat flakes (leaves, paper, petals) that flutter edge-on and back. `look: flake`: soft snow or frost flakes that drift and tumble and fall at a steady speed of `gravity`/4 px/s instead of accelerating. `look: shard`: ice crystals that shoot out and freeze in place as spikes; pair with high `drag`, zero `gravity` and a long `lifetime_ms`. `wind_px`: a steady push in px/s along the cast direction, so falling flakes slant. Sparks with `attach_to` a `vortex` orbit it instead of bursting: see [Vortex](#vortex), `emit_radius_px` (each spark starts somewhere on a disc this wide around the anchor instead of at one point: rocks raining over an area from `sky`, pebbles jolted all over the ground; default 0), `home_to` (an anchor: `caster_hand` or another hand anchor (see [Gestures](#gestures)), `caster`, `target` (its chest), `sky` or `point`; each spark bursts out as usual and is then pulled to that anchor, arriving as it dies: life drained back into a caster's hand, a swarm flying at a target). `look: bat`: small winged silhouettes in the layer's color that flap as they fly, with a faint rim (a bat swarm). `look: bone`: pale bones that tumble end over end (a bone storm, a shattered skeleton). Sparks `attach_to` a falling `orb` burst where that orb lands. `orbit_hz`: each spark also circles the anchor (turns per second around the vertical axis, negative = clockwise from above): leaves, notes or souls swirling round a caster; pair with `emit_radius_px` and a small negative `gravity`. `look: note`: glowing music notes (head, stem and flag) that sway and fade in `height_px`: emit from this far above the anchor (a victim's chest or head). `emit_ring: true`: start evenly spaced round the rim of the `emit_radius_px` circle (a halo). `steady: true`: the sparks don't come and go; each stays for the whole layer (orbiting with `orbit_hz`, bobbing with `bob_px` and `bob_hz`) and the layer's intensity fades them in and out, with rates snapped to the loop: a ring of dizzy stars. `look: glyph`: comic symbols drawn as camera-facing sprites that read upright in every view, filled with the layer's first color and outlined with its second; `glyph` picks one: `z` (sleep), `star`, `question`, `exclaim`, `heart`, `skull`, `bubble`, `ghost`, `swirl`, `hourglass`, `mute` (a crossed-out speech bubble), `drop` (blood, sweat), `fly`, `anger`. Glyphs fade in and out over their life and with the layer's intensity, and take `sway` (0–1, flutter side to side as they drift), `spin_hz`, `tilt_deg` (seeded lean, default 20) and `grow` (how much bigger they get over their life: 1 = twice the size). Sparks `attach_to` a `motif` burst where its first item is when the sparks start (a drop splashing on a head). |
| `crackle` | `count`, `length_px`, `jaggedness`, `regen_ms`, `radius_px`, `height_px` (crackle in the air this far above the anchor, all round it: arcs snapping over a body) |
| `orb` | `look: weapon`: a thrown weapon of dark metal sheathed in the spell's energy, spinning as it flies, with `crackle_count` arcs on it: `shape` (`hammer` default, `axe`, `anvil`, `disc`, `spear`, `trident`, `stone`), `spin_hz` (turns per second), `spin_axis` (`tumble` end over end, the default for hammers, axes, anvils and stones; `flat` like a saw blade, the default for discs; `roll` about the shaft, the default for spears and tridents), `stick: true` (stops spinning where it lands and stays there while the layer lasts: a trident pinning its target). `radius_px` sets its size (a hammer is about two radii long). An orb anchored at `splash` with a `travel` beat flies to its splash target from the primary target, or with `from: "previous"` from the splash target before it (a ricochet; `wrap: true` makes the first come from the last), or with `from: "sky"` falls onto it; `start_out_px` starts it that far out from the centre toward its target, so a set of them waits in a ring before flying. `radius_px`, `pulse_hz`, `wobble`, `crackle_count`; for `travel: projectile` an orb anchored at `caster_hand` flies to the target during its `travel` beat: `trail_ms` (streak behind it, default 140, 0 = none), `arc_height_px` (lob height at mid-flight, default 0), `travel_ease` (`linear` or `ease_in` to accelerate). An orb anchored at `sky` in a `travel: projectile` spell falls onto the target during its `travel` beat instead: `approach_deg` (tilt from vertical, 0–75, default 0 = straight down) and `approach_yaw_deg` (the heading it comes from, seen from above: 0 = from beyond the target, 90 = from the cast direction's left, 180 = from over the caster). `look`: `energy` (default) or `meteor`: a lumpy burning rock with molten seams and a white-hot leading face, a flame trail that cools hot to red over `trail_ms` (default 260) and a grey smoke trail that hangs in the air for `smoke_trail_ms` (default 0 = none) at `smoke_opacity` (default 0.45). A resting orb can sit `height_px` above its anchor (a field around a target's body), and `bubble: true` draws it as a hollow shell that glows at its rim and is clear in the middle (a force field or shield around whatever is inside). `look: crescent`: a thin curved blade flying edge-first (a wind slash, a thrown sickle of energy) with a bright leading edge and fading after-images over `trail_ms` (default 120); `radius_px` is the blade's radius, `crescent_deg` its arc (default 140), `tilt_deg` rolls it about its heading (0 = flat). Any flying orb takes `side_offset_px`: it starts this far to the side (positive = left of the cast direction) and curves in to the target, so a volley fans out and converges. A falling orb takes `scatter_px`: it lands at a seeded spot up to this far from the target (one rock of a meteor storm); sparks and decals `attach_to` it appear where it lands. `opacity` (0-1, default 1): a fainter orb or bubble (a barely-there dome of light). A bubble's `finish`: `glow` (default, a fresnel shell of light), `soap` (a clear film with swirling rainbow bands and window reflections: a bubble shield) or `glass` (clear and tinted, a dark refracted band near the edge, a bright rim: a mirror or glass dome); `ripple` (0–0.3, keyframe it down to 0) sends waves down the shell from the top, as if a drop just landed on it. `squash` (0-1, default 1): flattens the orb along the cast direction, so a `bubble` at `caster_hand` becomes a lens-shaped shield of energy held up toward the target. |
| `beam` | A beam runs from the caster's hand; anchored at `sky` it comes straight down from the sky onto the target's feet instead (a pillar of light called down from above). `width_px`, `wobble`, `wobble_hz`, `jaggedness`, `regen_ms`, `grow_ms` (time to reach full length, default 60), `style` (`energy` default; `water`: a turbulent liquid column with a noisy edge, foam streaks and a bright rim; `fire`: a flame cone, see below; `wind`: a gust, see below; `ice`: a glassy frozen ray with a hard white core, a frosted rim and frost glints drifting off it; it takes the water params with slower defaults). Water and fire beams also take `flow_speed` (how fast the noise rushes toward the target), `turbulence` (0-1, edge break-up), `churn` (0-1, surges that travel down the column), and particles that peel off it: `shed_count`, `shed_speed`, `shed_size_px`, `shed_life_ms` (water drops fall, fire embers float up, ice glints drift down). Water and ice beams take `foam` (0-1). Fire beams take `spread` (width at the far end relative to `width_px`, default 3: a cone), `puff_count` (billowing flame puffs riding the stream, default 24, max 64) and `puff_size_px`. Wind beams are a faint, streaky cone of moving air (alpha) that take `spread` (default 2.5), `flow_speed`, `turbulence`, `line_count` (pale gust lines rushing through the cone, default 18, max 40), `line_length` (each line's length as a fraction of the beam, default 0.25) and `shed_*` (dust or leaves that drift off it). Any beam can `sweep_px` (how far its far end swings across the target, sideways) with `sweep_ms` (one pass), and wind helical strands of energy around itself that corkscrew toward the target: `spiral_count` (0-6), `spiral_pitch_px` (length of one twist, default 80), `spiral_speed` (twists per second, default 3), `spiral_radius` (times the beam's width, default 0.7), `spiral_width_px` (default 3). A beam in a spell whose `travel` isn't `beam` (a link that holds a target) ends on the target's chest |
| `vortex` | `height_px`, `base_radius_px`, `top_radius_px`, `flare`, `spin_hz`, `strands`, `twist`, `turbulence`, `sway_px`, `sway_hz`, `grow_ms`, `opacity`, `start_offset_px`, `meander_px`, `wander_px`. See [Vortex](#vortex). |
| `wave` | A wall of water that rises out of the ground in front of the caster, rolls to the destination with its crest curling forward, then crashes over it and spreads. `width_px` (span across the run, default 300), `height_px` (crest height, default 140), `travel_ms` (time to reach the target from the layer's start, default 60% of its window), `crash_ms` (time to collapse after arriving, default 300), `curl` (0-1, how far the lip throws forward), `flow_speed`, `turbulence` (0-1, ragged ends and crest), `foam` (0-1), and spray off the crest: `shed_count`, `shed_speed`, `shed_size_px`, `shed_life_ms`. Colored deep (`secondary`) at the base, `primary` up the face, foam in `core`. |
| `ring` | `steady: true` keeps the ring from rolling out: it sits at `end_radius_px` (keyframe it to grow) at the layer's intensity, a held rim or, with a `thickness_px` over twice the radius, a filled disc (the face of a shield of light). `start_radius_px`, `end_radius_px`, `thickness_px`, `softness`, `arc_deg` (only the arc facing the cast direction, fading at its ends: a frontal shockwave; default 360), `ease` (`ease_out` default: a burst that slows; `linear`: a steady wave front that keeps pace with an `eruption`; `ease_in`), `repeat_ms` (the ring rolls out again every this many ms through its window, fading in and out each time: an aura's pulses or damage ticks; a `start_radius_px` bigger than `end_radius_px` pulls inward, like a drain or a heal), `count` (with `repeat_ms`, this many rings in flight at once, evenly staggered, default 1, max 8), `height_px` (a `billboard` or `vertical` ring this far above its anchor: a splash on a head) |
| `eruption` | Rock bursting out of the ground in rows along an arc (or full circle) that sweeps outward from its anchor, each row bigger than the last: `shape` (`spikes` default: jagged pointed rocks; `slabs`: broken plates of ground shoved up on edge; `mushrooms`: smooth mushrooms with softly glowing caps in the layer's color on pale stems, popping up with a springy overshoot: a druid's ring of fungi; use `debris_count` 0 and a little dust), `arc_deg` (default 100, centred on the cast direction; 360 = a ring), `rows` (default 5), `start_radius_px`, `end_radius_px` (first and last row, default 50 and 360; 0 puts one rock at the centre), `row_delay_ms` (default 120), `delay_growth` (each gap this many times the last, default 1; above 1 the rhythm slows so the big rows land with weight), `growth` (size per row, default 1.3; below 1 the centre is biggest: a crown of spikes), `height_px`, `width_px` (row 0), `spacing_px` (gap along the arc, default 40), `tilt_deg` (lean away from the anchor), `jitter` (0–1), `rise_ms` (thrust up with a small overshoot, default 90), `hold_ms` (default 300), `sink_ms` (crumble back down, default 350), `debris_count` (chunks thrown per rock, default 3), `debris_speed`, `debris_size_px`, `gravity`, `dust` (0–1 opacity of the dust kicked up at each rock), `dust_size_px`, `dust_life_ms`. Rocks take the layer's color and are lit by the scene; dust is the palette's `secondary` dulled toward the rock. |
| `decal` | `shape`, `radius_px`, `opacity`, `fade_in_ms`, `lifetime_ms`, `fade_ms`, `grow_ms`, `start_scale`, `rotation_deg`, `spin_deg_per_s`, `stretch`, `pulse_hz`, `detail`, `symmetry`. See [Decals](#decals). |
| `smoke` | `count` (max 64), `rise_speed` (negative sinks), `size_px`, `lifetime_ms`, `opacity`, `spread_px` (how far around the anchor the puffs are scattered, default 15; widen it for a cloud or a smoke bank), `spread_speed` (px/s the puffs also roll outward along the ground, evenly around the centre and slowing as they go: a dust wave or a spreading fireball; default 0). With the layer's `blend: add` the puffs glow instead of shading: billows of flame. With `attach_to` a `vortex` they swirl around its foot (a dust skirt). `height_px`: puffs start this far above the anchor (a ball of black smoke at a target's chest; default 0). Shader intent `lighting: "six_way"` draws alpha smoke as six-way lit smoke (relit by the scene's and the spell's lights; the Realistic style does this for all alpha smoke not marked `unlit`), see [vocabulary.md](vocabulary.md#six-way-lit-smoke). |
| `motif` | Small modeled things that act out a buff's story: `shape` (`leaf`, `petal`, `feather`, `droplet`, `blossom`, `gem`, `banner`), `cut` for gems (`brilliant`, `emerald`, `cabochon`, `marquise`, `heart`, `prism`, `cocoon`), `count`, `tints` (a list of `#RRGGBB`, one per item, cycled), `size_px`, `scale`, `opacity`, placement (`height_px`, `forward_px`, `side_px`, orbit `orbit_radius_px`, `orbit_hz`, `orbit_tilt_deg`, `orbit_phase_deg`, `weave_px`, `bob_px`, `bob_hz`, `sway_px`, `sway_hz`, `stack_px`), timing (`stagger_ms`, `appear_ms`), pose (`spin_hz`, `yaw_deg`, `tilt_deg`, `roll_deg`, `face`), `bloom`, `petals`, `sparkle`, `glint_hz`, `trail_ms`, `clarity`, `fire`, `glow`; banners take `emblem`, `wave` and `wave_hz`; gem shells take `encase`, `fill` and `stretch`. See [Motifs](#motifs). |
| `coat` | A skin over the afflicted character in a status effect. See [Coat](#coat). |
| `slash` | A sword trail traced by the caster's blade. See [Sword skills](#sword-skills). `trace_ms`, `trail_ms`, `inner`, `reach_px`, `width_px`, `softness`, `opacity`, `edge`. |
| `light` | `radius` (world units, default 6), `energy` (default 2), `height_px` (above the ground, default 80; negative = under the ground), `forward_px` (along the cast direction from the anchor), `side_px` (positive = left of the cast direction), `orbit_hz` (circles the anchor at its forward/side distance, counter-clockwise from above), `tint` (`#RRGGBB`, a light color outside the palette: neon stage or rim lights). Place lights round a `six_way` smoke layer to light it from a side. |
| `camera_shake` | `amplitude_px`, `frequency_hz`, `decay` (0–1) |
| `sound_cue` | `cue` (one of the cues in [`web/sounds/cues.json`](../web/sounds/cues.json): `charge`, `hum`, `buzz`, `crackle`, `sizzle`, `zap`, `crack`, `boom`, `rumble`, `impact`, `crash`, `shatter`, `ignite`, `fire`, `whoosh`, `wind`, `shimmer`, `splash`, `stream`, `freeze`, `squelch`, `heartbeat`, `whisper`, `drain`, `drone`, `swing`, `clang`), `gain` (0–1, default 0.8), `pitch` (playback-rate multiplier 0.5–2, default 1), `offset_ms` (delay after the beat starts), `duration_ms` (override length), `repeat_ms` (retrigger every N ms inside each beat; a sustained cue then plays for its own length each time), `size` (`small`, `medium` or `large`: which sound bank recording plays; small is shorter, higher and lighter, large longer, deeper and heavier; default medium, or the closest length when `duration_ms` is set) |

## Motifs

A `motif` layer is one or more small modeled things that play a part in a spell's story, usually a buff's: a leaf unfurls over a head, a dew drop rolls down it and falls, a blossom opens, gems pop into being and circle a character. Motifs are lit by their own material, so they read the same in every view and style. Make the story out of short beats before an aura's loop, and let it resolve into something that lingers.

| Shape | Looks like | Size (`size_px`) |
|---|---|---|
| `leaf` | a cupped leaf with a midrib and veins, light glowing through its edges; color `base → tip` from the layer color | length, base to tip |
| `petal` | a soft rounded petal, pale at the base | length |
| `feather` | a long feather with a shaft and fine barbs | length |
| `droplet` | a clear teardrop of water, point up: bright rim, window highlight, a caustic on its underside | half its height |
| `blossom` | `petals` (default 5) petals round a glowing heart; `bloom` 0 is a closed bud, 1 open flat, a little over 1 droops into a halo | petal length |
| `gem` | a faceted gem that reflects a studio sky, glows inside facet by facet and throws rainbow fire; `cut`: `brilliant` (diamond), `emerald` (step cut), `cabochon` (polished dome, milky like jade), `marquise`, `heart`, `prism` (a crystal point), `cocoon` (a tall rough-faceted egg, big enough to hold a character) | radius |
| `banner` | a war banner: a dark pole with a gilded finial and crossbar, and a swallowtailed cloth in the layer color (or `tints`) that ripples in the wind, with a trim and an `emblem` (`chevron` default, `sun`, `star`, `fang`, `crown`, `none`) in the core color. `wave` (0–1.5, default 0.5) is how hard the cloth ripples, `wave_hz` (default 1.2, snapped to the loop) how fast. The cloth faces along the cast direction: turn it with `yaw_deg`. Plant it by keyframing `height_px` down to 0 with `ease_in` | pole height |

Gems take `clarity` (0 milky, 1 water clear; set by the cut) and `fire` (0–1, rainbow flashes). `sparkle` (0–1) adds a four-pointed star glint that twinkles on each item at `glint_hz`. `trail_ms` draws a light trail behind each moving item. `glow` (leaf, petal, feather) is how much light shines through the edges.

**Encasing shells.** `encase: true` turns a gem into a hollow crystal shell round the character, like a body sealed in jade: see-through face-on, solid and bright at its edges, with no depth write so the body shows inside. `fill` (0–1, default 1) grows the shell from the bottom up, with a glowing growth line at its edge; keyframe it 0 → 1 over the encase beat and hold 1 across the loop. `stretch` (default 1) scales the item's height so a shell fits a standing body. Use `cocoon` (`size_px` about 38, `stretch` 1.3, `height_px` 56), `prism` (a crystal column) or `brilliant` with `tilt_deg: 180` (a diamond standing on its table, point over the head; `fill` then grows down from the point).

**Placement.** Each item sits `height_px` (default 100) above its anchor, moved `forward_px` along the cast direction and `side_px` to its left. With `count` above 1, items spread evenly round a circle of `orbit_radius_px` that turns at `orbit_hz` (counter-clockwise from above), tilted `orbit_tilt_deg` about the cast direction and waved up and down by `weave_px`; `orbit_phase_deg` turns the whole ring. `stack_px` lifts each item that much above the one before (a column of leaves). `bob_px`/`bob_hz` float them up and down, `sway_px`/`sway_hz` rock them side to side like a falling leaf. `stagger_ms` makes item *i* appear `i × stagger_ms` after the first, each popping in over `appear_ms` with a small overshoot.

**Pose.** An item stands up its own vertical (a leaf's tip, a gem's table, a droplet's point). `roll_deg` turns it in its own plane, `tilt_deg` tips its top over toward its face (90 lays a leaf flat, pointing its tip the way its face looked), `yaw_deg` turns it about the vertical, `spin_hz` spins it about its own vertical. `face: out` turns each item's face away from the anchor (leaves of a shell, snowflake arms with `tilt_deg: 90`), `face: orbit` turns it the way it moves.

**Paths.** Every number can be keyframed, which is how a motif follows a path: keyframe `side_px` and `height_px` to roll a drop along a leaf, then `height_px` with `ease_in` for the fall. `sparks` and `glow` `attach_to` a motif find its items. In an aura, motif rates (`orbit_hz`, `spin_hz`, `bob_hz`, `sway_hz`, `glint_hz`) snap to whole cycles per loop, and keyframes should hold steady across the loop.

```json
{ "id": "gems", "type": "motif", "beats": ["summon", "sustain", "fade"], "anchor": "caster", "color": "primary",
  "params": { "shape": "gem", "cut": "brilliant", "count": 6, "size_px": 10, "orbit_radius_px": 48, "orbit_hz": 0.333,
              "height_px": 62, "spin_hz": 0.66, "stagger_ms": 140, "appear_ms": 320, "sparkle": 1, "face": "out", "tilt_deg": 18 } }
```

## Splash (targeted area spells)

Many big area spells need a target: the caster picks one enemy and the spell slams everyone round it. Ask for that layout in `space.targets`:

```json
"targets": { "layout": "splash", "count": { "min": 6, "max": 7 }, "radius": { "min": 1.9, "max": 2.2 }, "ripple_ms": 120 }
```

| Field | Meaning |
|---|---|
| `layout` | `splash`: one primary target on the cast axis at `footprint.length` (up to 6 units), and `count - 1` more enemies evenly round it with some jitter. (`chain`, the default, strings targets out in the footprint.) |
| `radius` | How far round the primary the other enemies stand, in world units (each at 55–100% of it). |
| `ripple_ms` | Each splash target's layers start this many ms later per unit of distance from the primary (default 120), so the hit spreads outward. 0 = every enemy at once. |
| `order` | `ripple` (default) or `sequence`: one enemy after another, `hop_delay_ms` apart, going round the primary (a ricochet or a chain round the group). |

**Point-blank** (`destination: "caster"`): no primary enemy. The caster is the centre and all `count` enemies stand round them; `ripple_ms` counts from the caster, layers anchored at `caster` are the blast, and splash bolts and orbs come `from` the caster. **Ground-targeted** (`destination: "point"` or `"ground"`): the centre is a spot on the ground the caster picked (at `footprint.length`, marked in the viewer), the `count` enemies stand in and round it, and layers anchored at `target` or `sky` sit on that spot.

Layers anchored at `target` play once, on the primary target. Layers anchored at **`splash`** repeat on every other enemy, each delayed as above: hit flashes, sparks and marks, a bolt forking to them (see `bolt`), an `orb` flying to them (see `orb`), an eruption under each. `sparks` with `home_to: target` fly to the primary. Sky layers sit above the primary; a spell from the `sky` frames its height in the viewer. The viewer marks the primary target with a red ring. Exports mark `splash` decals `per_target`.

## Gestures

The caster has crude arms with hands and fingers, and `space.caster_gestures` moves them: a raise, a throw, a palm pushed out, a finger pointed, a slam, a roar. A gesture list is the casting animation, timed against the beats. Every spell with a caster should have one.

```json
"caster_gestures": [
  { "kind": "hold_orb", "at_ms": 0, "duration_ms": 160, "hold_ms": 0 },
  { "kind": "throw", "at_ms": 70, "duration_ms": 250 }
]
```

| Field | Meaning |
|---|---|
| `kind` | The gesture (below). |
| `at_ms` | When it starts. A gesture starts from wherever the arms are, so a list flows from one to the next. |
| `duration_ms` | Until its last key (default per kind). **The last key lands at `at_ms + duration_ms`**: put a throw's release, a push's full reach or a slam's impact on the release or impact beat. |
| `hand` | One-handed gestures: `lead` (default, the casting hand, where `caster_hand` is), `off`, or `both` (mirrored). |
| `hold_ms` | How long the end pose holds (default 250); hold a channel through the beam's sustain. |
| `return_ms` | How long the arms take to ease back to rest afterwards (default 400), unless the next gesture takes over first. |
| `shape` | The hand shape at the end instead of the gesture's own: `relaxed`, `open`, `flat`, `spread`, `claw`, `cup`, `grip`, `fist`, `point`, `sign`. |

| Kind | Hands | Looks like |
|---|---|---|
| `raise` | one | the hand lifted overhead, fingers spread |
| `point` | one | arm out, index finger pointed at the target |
| `push` | one | palm drawn back, then shoved out flat toward the target |
| `throw` | one | wound back behind the head, then an overhand throw released out in front (the off hand aims, then tucks) |
| `spin_throw` | one | a sidearm whip: swung back to the side and slung across the body (a spinning disc, a hammer, a discus); the off arm counter-swings |
| `sky_point` | one | a finger pointed up at the sky (call lightning down) |
| `sign` | one | two fingers raised before the face (a quick incantation sign) |
| `channel` | one | arm out, fingers clawed toward the target (a stream of lightning or a drain) |
| `hold_orb` | one | palm up in front, cupped round something held |
| `raise_both` | two | both arms overhead |
| `push_both` | two | both palms shoved out |
| `channel_both` | two | both arms out, clawed fingers |
| `gather` | two | hands cupped together before the chest (charging) |
| `summon` | two | hands low, palms up, lifted overhead |
| `slam` | two | fists up over the head, then driven down |
| `clap` | two | arms opened, then palms clapped together |
| `roar` | two | fists by the shoulders, then flung wide, fingers clawed (a shout, an outburst) |
| `flex` | two | fists up by the shoulders |
| `ground_press` | two | palms pressed down at the ground |
| `guard` | two | forearms up before the face |
| `flail` | two | arms flung up |
| `cheer` | two | fists raised |
| `rest` | one | back to rest |
| `slash` | one | sword: wound back on the lead side, swept flat across the front (the blade crosses the front at 75%), followed through to the off side |
| `backslash` | one | sword: the return sweep, from the off side back across to the lead side |
| `chop` | one | sword: raised high behind the head (55%), level in front (80%), down at the end |
| `rising_slash` | one | sword: dropped low (45%), ripped upward through the front (75%) to overhead |
| `thrust` | one | sword: drawn back to the hip (60%), stabbed straight forward at the end |
| `blade_out` | one | sword: arm and blade held straight out to the side (hold it through a spin) |
| `cleave` | two | both hands on the grip: raised overhead (55%), then a heavy chop down at the end (a greatsword) |
| `sweep_both` | two | both hands on the grip, blade held out to the side (a greatsword spin) |

At rest the casting hand is up in front of the chest (where `caster_hand` always was) and the off hand hangs. Gestures are worked out fresh from the time, like everything else in the viewer.

**Hand anchors follow the arms.** `caster_hand` is the lead palm, `caster_off_hand` the off palm, `caster_fingertip` and `caster_off_fingertip` the index fingertips, `caster_hands` the point between both palms. A bolt from `caster_fingertip` leaves the finger as it moves; an orb `caster_hand` thrown in a `projectile` spell rides in the hand until its `travel` beat, then leaves from where the hand was at that moment. Layers that place themselves once (a decal) use the rest pose.

The stand-ins round the caster have arms too: they follow their reaction (`flail` when knocked back, `guard` when they flinch or cower, `cheer`). A caster with `caster_react` `shout` and no gestures swings into a `roar`.

In an engine, gestures are the caster's casting animation: the export lists them with their times, and bakes them onto a Mixamo-named skeleton (see [Exporting: caster rig](exporting.md#caster-rig-and-animation-unity-humanoid)).

## Mixamo clips

The caster's skeleton matches Mixamo's: the same bones (`Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftHandThumb1`–`4`, `LeftHandIndex1`–`4` ... and the right side and legs) with the same names. Its arm joints are those bones (shoulder = `Arm`, elbow = `ForeArm`, wrist = `Hand`, a finger's knuckle, two joints and tip = its bones 1–4). **The casting (lead) hand is the left hand.** So animation moves both ways:

- **In:** in the viewer, **Load Mixamo…** takes a Mixamo FBX (Download, Format FBX Binary, With Skin) or any GLB/glTF with Mixamo bone names, converts it to a clip (`spelldirector.clip/1`) and saves it in the library's `clips/` folder under the file's name (`Standing 2H Magic Attack 01.fbx` becomes `standing-2h-magic-attack-01`). **Animation** picks it for the spell on screen (and exports bake it); **Mirror** plays a right-handed animation with the left, casting hand. Mixamo's animations stay on your computer: `clips/` is not part of the repo.
- **In a template:** `space.caster_clip` plays a clip on the caster:

```json
"caster_clip": { "clip": "standing-2h-magic-attack-01", "at_ms": 0, "from_ms": 300, "speed": 1.2, "mirror": true }
```

| Field | Meaning |
|---|---|
| `clip` | The clip's name (its file in `clips/` without `.json`). |
| `at_ms` | When it starts, spell time (default 0). |
| `from_ms`, `to_ms` | The part of the clip to play (default all of it). |
| `speed` | Playback speed (default 1). |
| `mirror` | Swap sides: a right-handed animation with the casting hand (default false). |
| `blend_ms` | Blend in from the gestures before `at_ms`, and back out after the end (default 150). |
| `hold_ms` | Hold the last pose this long before blending out (default 0). |

While it plays the clip moves the arms, hands, fingers, hips and chest, and every hand anchor follows it. **Keep `caster_gestures` too**: they play whenever the clip isn't there (someone else's computer, a fresh install) and before and after it. Line the clip up with the beats like a gesture: find the frame where the throw lets go (scrub the viewer) and set `at_ms` (or `from_ms`) so it lands on the release beat.

- **Out:** every sprite export also writes the caster rig (`<id>.caster.glb`), its animation as a clip and a timeline of every event keyed to a bone socket: see [Exporting](exporting.md#caster-rig-and-animation-unity-humanoid).

## Sword skills

Melee weapon skills: slashes, combos, thrusts and spins. Give the caster a weapon, swing it with sword gestures, move the body with `caster_react` and draw the cut with a `slash` layer. Put them in `line: "Swordsmanship"` and tag them `sword` (the viewer lists the line under **Type**).

```json
"space": {
  "origin": "caster", "destination": "target", "travel": "instant", "footprint": { "shape": "line", "length": 1.25 },
  "caster_weapon": { "kind": "sword" },
  "targets": { "react": [ { "kind": "flinch", "at_ms": 340 }, { "kind": "knockback", "at_ms": 1230, "distance_px": 30 } ] },
  "caster_react": [ { "kind": "lunge", "at_ms": 80, "duration_ms": 600, "distance_px": 12 } ],
  "caster_gestures": [ { "kind": "slash", "at_ms": 40, "duration_ms": 400, "hold_ms": 0 } ]
}
```

| Field | Meaning |
|---|---|
| `caster_weapon` | `kind`: `sword` (a 50 px blade), `greatsword` (74 px, wider) or `dagger` (24 px); `length_px` overrides the blade. It rides in the lead hand, the casting hand rests holding it up in guard, and the anchors `caster_blade` (the middle of the blade) and `caster_blade_tip` (its point) ride on it. Without a weapon those anchors are where a sword would be. |
| `caster_react` | One reaction or a list played together, each from its own `at_ms`: `lunge` to step into a cut, `leap` for a jumping strike, `spin` (with `turns`) for a whirlwind. |
| `targets.react` | One reaction or a list: a `flinch` for each hit of a combo, then a `knockback` on the finisher. |
| `targets.order: "sweep"` | Splash targets hit one by one as a blade sweeping round the centre reaches them: `sweep_ms` per turn (negative: the other way), starting at `sweep_start_deg` (0 = the cast direction, positive toward +Z, the off-hand side; default -90, the lead side). Match `sweep_ms` to the spin: a `spin` of `turns` *n* over *d* ms takes about 0.88 *d* / *n* ms per turn at full speed. |

The `slash` layer is the trail: the sheet the blade sweeps through the air, from `inner` (0–1, default 0.35) of the way up the blade to its point plus `reach_px` beyond it, brightest at the leading edge (the layer's first color) and fading behind (its second), with a camera-facing streak `width_px` wide along the point's path (brightness `edge`, 0–1) so a flat cut still reads edge-on. It traces the blade from its first beat's start for `trace_ms` (default: the whole layer). With `trail_ms` only the last stretch shows and it wipes away behind the blade (a quick cut, a spin); without it the whole stroke stays and fades with the layer's intensity (an arc that lingers). `softness` (0–1) fades the sheet in from its inner edge; `opacity` scales it. A long `reach_px` with `inner` about 0.55 makes a thrust's lance; a spin's slash with `trail_ms` about half a turn draws a ring. Anchor it at `caster_blade`.

Time it to the stroke: put a slash layer's beat on its gesture's swing (the slash crosses the front at 75% of its duration, a chop is level at 80%, a thrust lands at the end), and the hit beat where the blade reaches the enemy. Chain combo strokes back to back with `hold_ms: 0`, one slash layer and one hit beat per stroke. A sword wave is an `orb` `look: crescent` anchored at `caster_blade` in a `projectile` spell.

Examples: `templates/physical/keen-sweep.json` (a single cut), `threefold-flurry.json` and `cascade-of-cuts.json` (combos), `needle-lunge.json` (a thrust), `colossus-cleave.json` (a greatsword), `whirling-steel.json` (a spin), `templates/wind/cyclone-reaver.json`, `templates/fire/emberwheel.json`, `templates/lightning/stormsplitter.json`, `templates/wind/galecleave.json`.

## Warcries

A **warcry** is a shout: the caster rears back and bellows, and a shockwave or an aura rolls out over the allies or the enemies standing round them (a roar that knocks foes back, a rallying banner, a fear howl, a thunder shout, a battle fury). Tag it `warcry`; the viewer lists every one under **Type → Kinds → Warcries** (`?type=kind:warcry`). It uses the point-blank splash layout (`destination: "caster"`, see [Splash](#splash-targeted-area-spells)), so layers anchored at `splash` play on every figure round the caster, plus three fields that set the stage:

```json
"space": {
  "origin": "caster", "destination": "caster", "travel": "instant",
  "targets": { "layout": "splash", "side": "enemies", "count": 7, "radius": 2.5, "ripple_ms": 200,
               "react": { "kind": "knockback", "at_ms": 450, "distance_px": 90 } },
  "caster_react": { "kind": "shout", "at_ms": 0, "duration_ms": 900 }
}
```

| Field | Meaning |
|---|---|
| `targets.side` | Who stands round the caster: `enemies` (default, grey) or `allies` (blue, with a green ring at their feet). |
| `targets.react` | How each figure reacts, starting `at_ms` plus its splash delay (so it reacts as the wave reaches it). |
| `caster_react` | How the caster's body moves. Its arms: `caster_gestures` (see [Gestures](#gestures)); a warcry `flex`es, then `roar`s at the chest-forward moment. |

A reaction has a `kind`, `at_ms` and `duration_ms` (default per kind), and:

| Kind | Looks like | Knobs |
|---|---|---|
| `knockback` | shoved back off their feet with a little hop, tipped back, righting as they land; stays pushed | `distance_px` (default 90), `lean_deg` (32) |
| `flinch` | rocked back and swaying upright again | `lean_deg` (18), `distance_px` (6) |
| `cower` | crouched, leaning away and trembling, then straightening up at the end; a negative `lean_deg` with `distance_px: 0` is a brace | `lean_deg` (14), `distance_px` (12) |
| `cheer` | hopping on the spot | `hops` (2), `lift_px` (14), `lean_deg` (6) |
| `shout` | the caster rears back drawing breath (the first 40%), then throws the chest forward with the shout and settles | `lean_deg` (16) |
| `lunge` | a step in toward the centre (the caster: forward) and a lean into it over the first 35%, held, then a step back over the last 30% | `distance_px` (45), `lean_deg` (14) |
| `leap` | up and in in an arc over the first 70%, landing crouched, staying where they land | `distance_px` (80), `lift_px` (45), `lean_deg` (12) |
| `spin` | whole turns on the spot, quickly up to speed and steady between short ramps | `turns` (1; negative = clockwise seen from above, the way a slash follows through) |

Push and lean are away from the caster (the caster's own lean is backward). The pose is worked out fresh from the time, like everything else in the viewer. `coat` layers ride on the figure they cover, so a skin stays on a body that crouches or hops; other layers stay where they were anchored. In an engine these are hit reactions and animations: the export lists them.

Time the shout first: with `caster_react` `shout`, its chest-forward moment is 40–52% into its `duration_ms` (about 400 ms of 900), so start the release there. Then match `ripple_ms` to the wave: a ring that rolls out at *v* units per second reaches a figure *d* units away after *d / v* seconds, so `ripple_ms` = 1000 / *v*. A warcry that holds an aura over its allies is an aura too (`timing.loop_range`): give it `ripple_ms: 0` so every per-ally loop layer stays in step with the loop, and keep `knockback` and `cheer` in the start-up, before the per-ally coats appear.

Examples: `templates/*/warcry-*.json` (Breaker Roar, Thunderclap Shout, Dread Howl, Rallying Standard, Battle Fury, Ironhide Bellow).

## Auras

An **aura** is a persistent effect around a character (a paladin's holy field, a druid's healing grove, a bard's song, a burning damage zone) that lasts as long as the game says. It is a kind of spell, not an element or a line: any element and any line can have one. The viewer lists every aura under **Type → Kinds → Auras** (`?type=kind:aura`).

An aura has three parts, marked by `timing.loop_range`:

```json
"timing": { "duration_ms": 5000, "fps_hint": 30, "loop_range": { "start_ms": 1200, "end_ms": 4200 } }
```

1. **Start-up** (0 to `start_ms`): it switches on. One-shots (a flare as it is cast) live here.
2. **Loop** (`start_ms` to `end_ms`): the sustain. The frame at `end_ms` is the frame at `start_ms`, so an engine repeats it seamlessly for as long as the aura lasts.
3. **End** (`end_ms` to the end): it switches off. Play it when the aura is removed.

A layer that is on across the whole loop range is a **looping layer**, and the viewer makes it repeat exactly every loop length (`end_ms - start_ms`):

- rates snap to whole cycles per loop: glow and orb `pulse_hz`, decal `pulse_hz` and `spin_deg_per_s` (a whole turn per loop, or one symmetry step for a rune circle with `symmetry`), ring `repeat_ms`;
- redraw ticks (crackle `regen_ms`, orb wobble, shake) wrap with the loop;
- sparks and smoke are emitted continuously: each particle is reborn every loop length while its layer's window lasts, so `count` is particles per loop.

Rules for a clean loop (the validator warns about each):

- one steady beat (`hold`) spans exactly the loop range; start-up beats end at its start and end beats begin at its end;
- start looping particle layers at least one particle lifetime before the loop (they start with the start-up beat), and keep smoke `lifetime_ms` under the loop length;
- start repeating rings early enough that all `count` of them are rolling when the loop starts, and pick a `repeat_ms` that divides the loop;
- one-shots must be gone before the loop starts;
- put the loop's ends on frames (at 30 fps, multiples of 100 ms are safe);
- give spinning rune circles `depth: 0`: in the realistic style a carved mark is lit from a fixed side, so turning it by a symmetry step changes its shading;
- avoid `flicker` beats across the loop. (A looping mark's `fill` flows forward for half the loop and back for the other half, so it loops too, but slow `fill_flow` reads best.)

Sound cues in the loop beat repeat with it: use `repeat_ms` that divides the loop (sustained cues take `repeat_ms` too) and an `offset_ms` that lines the first one up with a ring or pulse. Exports mark all of this: see [exporting.md](exporting.md#auras-looping).

With **Loop** ticked the viewer holds an aura in its loop; untick it to let it play its end.

## Status effects

A **status effect** is a lingering affliction on one target: burning, frozen, chilled, poisoned, diseased, bleeding, haunted, dazed, stunned, asleep, rooted, silenced, cursed, shocked, petrified, slowed, confused, feared, blinded, charmed, trapped in a bubble. It is not cast or thrown: the game puts it on a character and takes it off. The viewer lists every one under **Type → Kinds → Status effects** (`?type=kind:status`).

```json
"archetype": "status",
"timing": { "duration_ms": 5000, "fps_hint": 30, "loop_range": { "start_ms": 1200, "end_ms": 4200 } },
"space": { "origin": "target", "destination": "target", "travel": "none", "footprint": { "shape": "circle", "radius": 0.5 } }
```

It has the three parts of an aura (see [Auras](#auras) for the loop rules, which all apply):

1. **Apply** (0 to `start_ms`): the affliction lands. One-shots live here (a bonk flash, a splash of venom, ice climbing up the body).
2. **Loop** (`start_ms` to `end_ms`): it lasts. Seamless, so the engine repeats it for as long as the effect is on.
3. **Expire** (`end_ms` to the end): it wears off. Play it when the effect is removed (the ice shatters, the bubble pops, the statue crumbles).

The viewer stands the afflicted character alone at the centre (no caster), facing the front camera, and frames it with room above its head. Anchor layers at `target` (its feet); lift them with `height_px` (chest about 50, head about 86, over the head 110–130). Make it read on the body from all four views:

- a `coat` layer on the body carries most of the read (flames, frost, stone, ooze, shadow, static, a sheen or a rim);
- comic glyphs over the head read from far away and from the top (Zs, dizzy stars, question marks, a skull, a crossed-out speech bubble): `sparks` with `look: glyph`, often `steady` on an `emit_ring` orbit;
- a ground mark under the feet gives the top view a shape.

### Coat

A `coat` layer is a skin over the afflicted character: the viewer's stand-in figure (a capsule body and a round head, 1 unit tall), puffed out a little so it sits on the body. In an engine it is a second material pass on the character's own mesh (inflated along its normals), or a mesh round it.

| Param | Default | Meaning |
|---|---|---|
| `pattern` | `glow` | `glow` (a soft sheen, mostly a fresnel rim), `flame` (tongues licking up the body), `frost` (a white crystal crust), `stone` (grey rock with dark cracks, lit), `ooze` (glossy drips running down), `shadow` (dark wisps rising), `static` (jittering electric creases), `ice` (a clear block with white facet edges and glints). Alpha-blended for `frost`, `stone`, `shadow`, `ice`; added as light for the rest (the layer's `blend` overrides). |
| `shape` | `body` | `body` follows the figure. `crystal`: a jagged, faceted block round the whole figure (frozen solid). |
| `inflate_px` | 2.5 | How far the skin sits off the body. |
| `opacity` | 0.7 (0.85 alpha) | Peak opacity; follows the layer's intensity. |
| `fill`, `rim` | 0.5, 0.6 | 0–1: how much the pattern covers the faces looking at the camera, and how bright the fresnel rim is at the silhouette. |
| `scale` | 6 | Noise cells per unit: higher is finer. |
| `flow_hz` | per pattern | How fast the pattern moves (flame up, ooze down, shadow up), in repeats per second, snapped to whole repeats per loop. |
| `pulse_hz`, `pulse` | 0, 0.25 | A throb (a heartbeat, slow sleeping breaths): rate, and how strong (0–1). |
| `cover_px`, `cover_from_px` | 130, 0 | Only the body between these heights above the feet is covered, with a ragged edge. Keyframe `cover_px` up from 0 to make it creep up the body (stone, ice); use a thin band for a gag over the mouth (75–83) or a blindfold over the eyes (83–94); clip it to the legs (about 40) for frost or bark. |
| `edge_glow` | 0 | 0–1: a bright line along the `cover_px` edge (the creeping front of stone or ice). |
| `regen_ms` | 70 | `static` only: how often the creases redraw (wraps with the loop). |

The palette: the layer's first color is the rim and the hot or bright parts, its second the fill (`gradient_core_to_primary`: a pale rim over a primary skin).

Examples: `templates/*/status-*.json` (21 of them: `fire/status-burning.json`, `ice/status-frozen.json`, `physical/status-dazed.json`, `psychic/status-sleepy.json`, ...).

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
| `swept` | alpha | dust swept into streaks fanning out along the cast direction (keep `rotation_deg` 0) | gusts, wind pushes, dashes |
| `slash` | alpha | thin crescent cuts gouged across the ground, chips along them | slashes, blade and claw hits |
| `swirl` | alpha | spiral grooves scoured from a bare centre, grit flung past the rim | tornadoes, whirlwinds, vortex spells |
| `rune_circle` | add | rings, glyph marks and a star | casting, summoning, buffs |
| `warning_ring` | add | faint fill, bright rim and ticks | telegraphs: "get out of here" |
| `fissures` | alpha | long jagged ground splits fanning out from the centre, with shadow and rubble | quakes, ground pounds, earth waves (pair with `arc_deg` for a frontal fan) |

The layer's `blend` overrides the default (e.g. `cracks` with `blend: add` are glowing cracks). The color is the layer's palette slot. In the realistic style a carved glowing mark (`cracks` with `blend: add`) is drawn as a real crack in the ground with the light coming up out of it.

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
| `arc_deg` | 360 | Keep only the sector facing the cast direction (a frontal fan of fissures). Without `rotation_deg`, an arc mark faces the cast direction. |
| `symmetry` | 0 | `rune_circle` only, 3–12: the circle looks the same turned by 360/n degrees (an n-pointed star, glyphs repeating n times). A spinning circle in an aura then only turns 360/n degrees per loop, so it can spin slowly. |
| `reveal_ms` | 0 | The mark spreads outward from its centre over this long (cracks running across the ground), instead of appearing whole. Match it to the wave it follows. |
| `depth` | per shape | How carved the mark looks in the realistic style: 1 deep (cracks, fissures), 0 flat (puddles, warning rings), negative raised (frost). Drawn with parallax and lit walls; exported as a height map. |
| `fill` | `none` | What sits in the bottom of the mark, in every style: `lava` (molten rock flowing along the cracks, white-hot deep down, crusting over as it cools), `glow` (light shining up out of the cracks), `liquid` (water, blood or poison pooling, glossy), `void` (darkness welling up). Exported as an emissive mask (and a flow map for lava and void). |
| `fill_color` | per fill | Palette slot of the fill: lava `gradient_core_to_primary` (deep = core, shallow = primary), glow the layer's color, liquid `primary`, void `shadow`. |
| `fill_flow` | 1 | How fast the fill flows. |
| `fill_in_ms` | 200 | The fill rises into the mark over this long from its start; it cools (lava crusts, glow fades) while the decal fades out. |

Decal beats set when it appears (the start of its first beat) and, without `lifetime_ms`, how long it holds. A decal's brightness does not follow the beats' intensity curves: marks don't flicker. Stack two decals for a hot mark that cools: a glowing `burn`/`cracks` (add, short lifetime) over a dark `scorch` (alpha, long lifetime).

## Vortex

A `vortex` layer is a spinning funnel of air standing on the ground at its anchor: a tornado, whirlwind, dust devil or water spout. It is narrow where it touches the ground and flares out to a wide top under a turning cloud cap; streaky noise spirals up and around its translucent wall, which is densest at the silhouette. Its axis snakes (`sway_px`), pinned at the ground. Drawn alpha-blended unless the layer's `blend` is `add`. The color is the layer's palette slot (`gradient_core_to_primary`: pale streaks over the body); the palette's `secondary` tints its dusty foot.

| Param | Default | Meaning |
|---|---|---|
| `height_px` | 260 | Height of the funnel. |
| `base_radius_px`, `top_radius_px` | 16, 90 | Radius at the ground and at the top. |
| `flare` | 1.8 | How the radius opens with height: 1 a straight cone, higher a trumpet. |
| `spin_hz` | 1.5 | Turns per second of the wall. Keyframe it to spin up and wind down. |
| `strands`, `twist` | 8, 1.2 | Wind streaks around the funnel, and the turns each makes from the ground to the top. |
| `turbulence` | 0.5 | 0–1: how ragged and streaky the wall is. |
| `sway_px`, `sway_hz` | 22, 0.45 | How far, and how fast, the middle of the funnel snakes off its axis. |
| `grow_ms` | 450 | Time to rise to full height from the start of its first beat. |
| `opacity` | 0.75 | Peak opacity of the wall. |
| `start_offset_px`, `meander_px` | 0, 0 | Form this far short of the anchor (toward the caster), then walk to it during the layer's `travel` beat, weaving this far sideways. |
| `wander_px` | 8 | Drift of the foot while it holds in place. |

The layer's intensity fades the wall by eroding it into its streaks (a rope-out), not by a plain fade. Keyframe `top_radius_px` and `base_radius_px` down and `sway_px` up during dissipation to make it thin and snake as it dies.

Layers attached to a vortex (`attach_to`) follow it:

- `sparks` orbit it: each is caught near the ground, climbs the funnel at `speed` px/s while it turns with the wall, and is flung off along its orbit to fall (`gravity`, `drag`) when the vortex's dissipation beat starts. `emit_ms` defaults to the whole window; `lifetime_ms` is how long each piece rides. Use `look: debris` and `look: leaf`.
- `smoke` swirls around its foot as a dust skirt.
- `glow` wraps its axis.

Decals don't follow a travelling vortex: anchor the mark where it ends up.

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
