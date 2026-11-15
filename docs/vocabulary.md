# SpellDirector Vocabulary

This is the language the director uses to describe spell effects. It exists so a person can say "heavy boss lightning" and the director can turn that into precise, buildable directions. Every term here maps to a field in the template format ([`template-format.md`](template-format.md)).

The director should **offer** these terms to the user as concrete choices, never expect the user to know them.

---

## 1. Phases (the shape of an effect over time)

Almost every spell reads as some subset of five phases. Naming them is the single most useful thing the director does.

| Phase | What it is | What sells it | Typical share of duration |
|---|---|---|---|
| `anticipation` | Wind-up before the payoff. Tells the player something is coming. | Gathering particles, rising glow, small crackles, sound swell, slight pull-in. | 20–50% (0 for "instant" spells) |
| `release` | The moment the energy leaves the source. | Brightest frame, sharp shape, fast motion, flash. | 2–10% (often 1–3 frames) |
| `travel` | Energy moving through space (projectiles, beams, chains). | Leading head, trailing tail, consistent speed or acceleration. | 0–40% |
| `impact` | Energy arrives. The "hit". | Flash, shockwave ring, sparks bursting outward, screen shake, decal. | 5–15% |
| `dissipation` | Afterglow and cleanup. Lets the eye rest. | Fading embers, lingering crackle, smoke, scorch mark fading. | 20–50% |

**Rule of thumb:** big spells have long anticipation and long dissipation around a very short release/impact. Contrast in timing is what makes a hit feel heavy.

### Timing words → numbers

| Word | Meaning |
|---|---|
| snappy | release + impact ≤ 80 ms, little anticipation |
| heavy / weighty | anticipation ≥ 300 ms, impact has hold frames + shake |
| floaty | slow ease-out, long dissipation, low shake |
| staccato | several short bursts (restrikes) with gaps |
| hold frame | the brightest frame is held 2–4 frames before falling off |
| smear | motion drawn as a stretched streak instead of a moving object |

## 2. Intensity curves

Each beat has an intensity curve (0–1) that drives brightness, scale, and emission together.

| Curve | Feel |
|---|---|
| `linear` | mechanical, rarely right on its own |
| `ease_in` | builds up, good for anticipation |
| `ease_out` | explodes then settles, good for impact and dissipation |
| `ease_in_out` | smooth swell |
| `spike` | instant jump to max then fast decay (release, flash) |
| `flicker` | noisy on/off around a mean, electricity's signature |
| `hold` | constant |

## 3. Shape language

| Axis | Low end | High end | Reads as |
|---|---|---|---|
| `jaggedness` | smooth curve | sharp zig-zag | calm/magical vs. violent/natural |
| `width` | hairline | thick ribbon | finesse vs. power |
| `taper` | uniform width | thin at the tip | uniform reads as beam; tapered reads as strike |
| `branching` | single line | tree of forks | controlled vs. wild |
| `coherence` | path redrawn every frame | path stays stable | chaotic crackle vs. solid bolt |

**Silhouette first:** a spell should be readable as a flat black shape. If it isn't, simplify before adding layers.

## 4. Color and value

Spells are built from a small palette with a clear value structure.

| Slot | Role | Lightning example |
|---|---|---|
| `core` | Hottest, brightest. Almost white. | `#FFFFFF` |
| `primary` | The color people name the spell by. | `#8FD8FF` (electric blue) |
| `secondary` | Darker, more saturated edge/glow. | `#3A5BFF` |
| `accent` | Optional contrast color for sparks or embers. | `#FFF2A0` |
| `shadow` | Optional dark tone for smoke, scorch, darkened sky. | `#1A1E3A` |

Words: **hot core** (white center, colored edges), **saturated** vs **washed out**, **additive** (glows brighten what's behind) vs **alpha** (solid shapes like smoke). Electricity is nearly always additive with a white core.

## 5. Layers

An effect is a stack of layers. Each layer has one job.

| Layer type | Job |
|---|---|
| `bolt` | A procedurally generated lightning path (main strike, arc, or chain hop). |
| `glow` | Soft bloom around another layer or a point. |
| `flash` | Full-screen or local brightness pop, 1–3 frames. |
| `sparks` | Small fast particles that fly out and fall/fade. |
| `crackle` | Short tiny bolts crawling over a surface or around a source. |
| `orb` | A ball of energy (charge-up, projectile head). |
| `beam` | A continuous ribbon between two points. |
| `eruption` | Solid rock bursting out of the ground in rows that sweep outward (spikes or slabs), each row bigger than the last, then crumbling. |
| `ring` | Expanding shockwave circle (overhead) or ripple. |
| `decal` | Mark on the ground: scorch, burn, cracks, crater, puddle, splash, frost, rune circle, warning ring (telegraph), fissures. Fades in, stays, fades out; can outlive the spell. |
| `smoke` | Soft alpha volume, slow drift. |
| `light` | Dynamic light cast on the environment. |
| `camera_shake` | Screen shake. |
| `sound_cue` | A named sound that plays in sync with its beats (see §10). |

Order matters: draw back to front, usually `shadow/smoke → glow → bolt/beam → sparks → flash`.

### Decal words

| Word | Means | Field |
|---|---|---|
| telegraph, AoE marker, danger zone | a glowing circle showing where a hit will land, before it lands | `decal` `warning_ring` in the anticipation beat, `pulse_hz` |
| magic circle, sigil, summoning circle | a glowing pattern under the caster | `decal` `rune_circle`, `spin_deg_per_s` |
| scorch, burn mark, soot | dark mark left by fire or lightning | `decal` `scorch` (dark, long `lifetime_ms`) |
| cooling, embers, molten | the mark glows and then cools | a `burn` or glowing `cracks` decal (add) with a short lifetime over a `scorch` |
| crater, impact crack | the ground broke | `decal` `crater` or `cracks` |
| wet ground, puddle, splash | water left behind | `decal` `puddle` / `splash`, `grow_ms` to spread |
| frost, frozen ground | ice spreading on the ground | `decal` `frost`, `grow_ms` |
| scoured ground, wind swirl | spiral grooves where a vortex ground | `decal` `swirl`, `grow_ms` |
| swept dust | dust blown into streaks along the wind | `decal` `swept`, `rotation_deg` 0 |
| lingering mark | stays after the spell | `lifetime_ms` longer than the spell |

## 6. Space and staging

Space is described the same way in a front view and an overhead view, so a renderer can show the arc of a spell from above.

| Term | Meaning |
|---|---|
| `origin` | Where the energy starts: `caster`, `sky`, `ground`, `target`, `point`. |
| `destination` | Where it ends. Same options, or `targets` for chains. |
| `travel` | `instant` (appears all at once), `projectile` (a head moves), `beam` (continuous), `chain` (hops between targets). |
| `footprint` | Area on the ground, seen from above: `point`, `line`, `cone`, `circle`, `arc`, `ring`. |
| `spread` | For cones/arcs: angle in degrees. For circles: radius. |
| `distribution` | How sub-elements spread inside the footprint: `even`, `random`, `center_weighted`, `edge_weighted`, `spiral`. |
| `scale` | Size in world units (1 unit ≈ a character's height). |

## 7. Camera views

Every effect must read from four standard cameras. Templates are authored in 3D so all four render from the same data. The director writes down what each view should show (`views.reads`) and which one the effect is designed around (`views.hero`).

| View | Camera | Best for judging | Typical game |
|---|---|---|---|
| `front` | Level, looking along the cast direction (from behind or in front of the caster). | Height, silhouette, flashes, anything vertical (sky strikes, pillars). | Fighting games, over-the-shoulder, cutscenes |
| `side` | Level, 90° to the cast direction. | Travel: projectile arcs, beam length, timing of hops left to right. | Side-scrollers, platformers |
| `top` | Straight down. | Footprint and distribution: cones, rings, chain paths, area coverage, the "arc of how the spell moves". | Top-down, RTS, tactics, MOBA-style |
| `three_quarter` | 45° around, about 35° down. | Both height and footprint at once. Usually the hero view. | Isometric RPGs, ARPGs, most 3D action |

**How layers read per view** (`plane` on a layer):

| Plane | Front / side | Top | 3/4 |
|---|---|---|---|
| `ground` (rings, decals, ground crackle) | thin line, often nearly invisible | full shape | ellipse |
| `vertical` (walls, pillars) | full shape | thin line | foreshortened |
| `billboard` (glows, orbs, flashes) | always faces camera | always faces camera | always faces camera |
| `volume` (bolts, beams, sparks, smoke) | true 3D projection | true 3D projection | true 3D projection |

**Rules of thumb**

- A vertical strike is a dot from the top view. Give it a ground story (ring, scorch, radial sparks) or it disappears in top-down games.
- A beam aimed at the camera collapses to a circle in front view. Make the source and the impact readable on their own.
- Bolts must be generated in 3D, not drawn flat, or they look like paper cutouts from the side.
- When reading a GIF, first identify which view it was captured from, then infer the other three.

## 8. Lightning-specific terms

| Term | Field | Meaning |
|---|---|---|
| leader | `bolt.leader_ms` | Faint stepped path that appears before the main strike. Sells "sky lightning". |
| return stroke | `bolt.width_px` + `flash` | The bright main strike. |
| restrike | `bolt.restrikes` | Same path flashes again 1–4 times. Classic "flicker". |
| regen rate | `bolt.regen_ms` | How often the path is redrawn. Low = chaotic crackle; high/none = solid bolt. |
| fork | `bolt.branch_chance`, `bolt.branch_depth` | Side branches off the main path. |
| arc | `bolt` with `travel: chain` or between two nearby points | Electricity jumping a gap. |
| static | `crackle` | Tiny crawling arcs, often during anticipation. |
| afterimage | `bolt.afterimage_ms` | Path lingers as a fading ghost. |

### Fire-specific terms

Fire is soft and slow next to lightning: it billows, licks and drifts instead of snapping. It flickers at 5–9 Hz (lightning 10–16), its shapes are rounded tongues instead of zigzags, and it always leaves something behind (embers, smoke, scorch).

| Term | Field | Meaning |
|---|---|---|
| temperature ramp | palette `core` → `primary` → `secondary` → `shadow` | Hottest is white-yellow, then orange, then red, then dark smoke. Hot parts glow (add), cool fringes and smoke are alpha. Never fully saturated red at the core. |
| breath, flamethrower, gout, stream | `beam` `style: fire` | A sustained cone of flame from the mouth or hand. `spread` sets how wide the cone opens; `turbulence` how ragged its edges are. |
| tongues, licking | `beam.turbulence`, shader `noise` fBm with `flow` | Flame edges torn by noise that flows along and sideways. |
| billow, roll, plume of fire | `beam.puff_count`, or `smoke` with `blend: add` | Rounded clouds of flame that swell and roll upward as they cool. |
| embers, cinders | `sparks` `look: ember` with negative `gravity`; beam `shed_*` | Glowing flecks that float up, flutter and wink out. |
| sweep, rake | `beam.sweep_px`, `sweep_ms` | The far end of the stream swings across the target. Lay the scorch across the sweep (`rotation_deg` 90, `stretch` > 1). |
| flare, catch, ignite | `flash` (local) + `sparks` at the mouth, `ignite` cue | The moment the fire lights: a short bright pop, not a white-out. |
| inhale, gather, wind-up | `orb` + `glow` at the mouth, a contracting `ring` (`start_radius_px` > `end_radius_px`), `wind` cue | Drawing breath before a breath attack; the fire builds inside. |
| heat haze, shimmer | shader `distortion` 0.3–0.6 | The air bends above and behind the flames. Shader intent only; the viewer doesn't draw it. |
| burning ground, smolder | `decal` `burn` / glowing `cracks` (add, short) over `scorch` (alpha, long), `fire` cue at low gain | The ground catches, glows, then goes black. |
| fireball | `orb` in a `travel: projectile` spell, `sparks` `look: ember` trailing | A thrown ball of fire (orb material `plasma` or `fiery`). |
| meteor, falling star, called-down rock | `orb` `look: meteor` anchored at `sky` in a `travel: projectile` spell (`approach_deg`, `approach_yaw_deg`, `travel_ease: ease_in`) | A burning rock that falls onto the target at an angle, with a flame trail and a smoke trail that hangs in the air (`smoke_trail_ms`). Pair it with a long telegraph. |
| debris, rubble, rocks flying | `sparks` `look: debris` (`glow` for hot rock), positive `gravity` | Rock chunks thrown out of an impact that tumble, land and stay. |
| dust wave, blast wave of dust | `smoke` (alpha) with `spread_speed` | A low ring of dust rolling outward along the ground. |
| fireball (explosion) | `smoke` `blend: add` with a small `spread_speed` | The ball of flame that boils up out of a big impact. |

### Wind-specific terms

Air is invisible: wind reads through what it carries (dust, leaves, debris, streaks) and what it does to the ground. Keep it alpha-blended and desaturated (pale grey-green to dusty brown); nothing glows except a magical tint. Its rhythm is a build: it gathers, spins up, holds with a steady roar, then ropes out.

| Term | Field | Meaning |
|---|---|---|
| gust, gale, blast of wind, push | `beam` `style: wind` (`spread`, `line_count`) | A cone of rushing air from the hand; sold at the target by a dust wave (`smoke` `spread_speed`), blown leaves and grit. |
| gust lines, wind lines | `beam.line_count`, `line_length` | Pale streaks rushing through the gust. |
| tornado, twister, whirlwind, cyclone, dust devil | `vortex` | A spinning funnel standing on the ground, narrow at the foot, wide at the top. |
| funnel, wall | `vortex` wall (`turbulence`, `strands`, `twist`) | The spinning sheet of dust-laden air; streaks spiral up it. |
| spin up, wind up, wind down | `vortex.spin_hz` keyframes | How fast it turns; spin up during the release, slow down as it dies. |
| touchdown, form | `vortex.grow_ms` or `height_px` keyframes | The funnel rising (or dropping) to full height. |
| walk, track, wander | `vortex.start_offset_px`, `meander_px`, `wander_px` | A tornado that is sent travels to the target with a weave, then drifts as it grinds. |
| rope out, collapse | dissipation beat; `top_radius_px` and `base_radius_px` keyframed down, `sway_px` up | The funnel thins, snakes and breaks into streaks from the top. |
| debris, grit, clods | `sparks` `look: debris` | Solid chunks; attached to a vortex they orbit and are flung when it dies. |
| leaves, petals, paper | `sparks` `look: leaf` | Flat flakes that flutter edge-on and back. |
| dust skirt, debris cloud | `smoke` (alpha, dusty color) attached to the vortex | The churning dust at the funnel's foot. |
| cloud cap | drawn by `vortex` | Dark puffs turning at the top of the funnel. |
| scoured ground | `decal` `swirl` | Spiral grooves left where it ground. |
| gust, howl, roar | `wind` cue (pitch for size: low for a gathering wind, 1.0–1.1 for a roaring funnel), `whoosh` for a snap | The sound of the air. Add `rumble` for a heavy grind. |
### Earth-specific terms

Earth is heavy and physical. It has no glow to hide behind: it sells weight through timing (a long gather, a held beat, a hard slam), through solid, lit rock that moves fast and stops dead, and through what it throws around (debris, dust, cracks) and the camera shake. Rhythm matters more than color: staggered hits that grow (crack, crack, CRACK) read as power building.

| Term | Field | Meaning |
|---|---|---|
| ground pound, slam, stomp | short `release` beat at the caster: `flash` (low `peak`), `ring`, `sparks` `look: debris`, `smoke` dust, `crater` decal, big `camera_shake`, `impact` + `boom` | The hit that starts the quake. Precede it with a gather and a 60–100 ms hang (`hold`). |
| earth wave, quake line, fault | `eruption` with `arc_deg` 60–120 at `caster`, a `ring` with the same `arc_deg` and `ease: linear`, a `fissures` decal with `arc_deg` and `reveal_ms` | Rock bursting up along a front that runs away from the caster. |
| escalation, growing eruptions | `eruption.growth` 1.3–1.5, `delay_growth` 1.05–1.2 | Each row bigger and a little later than the last, so the beat builds instead of staying even. |
| spikes, spires, stone lances, pillars | `eruption` `shape: spikes`; one cluster: `arc_deg` 360, `start_radius_px` 0, `growth` 0.5–0.7 (tallest in the middle) | Sharp rock stabbing up out of the ground. |
| heave, rolling ground, quake | `eruption` `shape: slabs`, `arc_deg` 360, slow `rise_ms` 120–200, long `hold_ms`; long flickering `camera_shake` (5–7 Hz) | Plates of ground shoved up on edge all around. |
| rockfall, rock slide, boulders | `sparks` `look: debris` anchored at `sky` with `emit_radius_px`, big `size_px` (15–25), long `lifetime_ms` | Boulders tumbling down onto an area, landing and lying as rubble. |
| debris, rubble, chips, pebbles | `sparks` `look: debris`; `eruption.debris_*` | Rock chunks thrown up that tumble, land and stay. |
| dust, dust cloud | `smoke` (alpha, `primary` or `secondary`), `eruption.dust`; `spread_speed` for a dust wave | Kicked-up earth, brown-grey, never glowing. |
| fissures, splitting ground | `decal` `fissures` (`arc_deg`, `reveal_ms`), `crater`, `cracks` | The ground tears open and stays open after the rock sinks. |
| gather, brace | pebbles lifting (`sparks` `look: debris`, negative `gravity`), dust drawn in (`ring` closing), low `rumble`, a dull `glow` in the fist | Strength building before the slam. |

### Light and energy beam terms

Big beams are about the build-up and the weight: the gather is the dodge window, the beam is a solid column (not a crackling line), and the heaviest ones leave the caster spent.

| Term | Field | Meaning |
|---|---|---|
| gather, draw in, soak up (light, power) | `sparks` with `gather_px` (and `swirl`), a contracting `ring`, a growing `orb` | Motes or streaks born all round the caster and pulled into the hand, arriving as they fade. Swirl makes them spiral in. |
| solar, sunlight, radiant | palette white → gold, `flash` `scope: screen` (soft, `accent`) during the gather | The scene warms and brightens while the light gathers; the beam is steady (low wobble, 3-5 Hz flicker). |
| lance, column, pillar of light | `beam` with a wide `width_px` (35-80) and low `wobble` | A thick, steady beam that reads as a solid shape from every view. |
| spiral, corkscrew, twisting strands | `beam.spiral_count`, `spiral_pitch_px`, `spiral_speed` | Thin strands wound round a beam that rush toward the target. 2 for something graceful, 3 for raw power. |
| recoil, kickback | `ring` `plane: vertical` at the hand, a dust `ring` and a stretched `scorch` (`rotation_deg` 0) at the caster | The shot shoves the caster back. In a game, add a short knock-back on the caster. |
| recharge, spent, exhausted | a dissipation beat with `smoke` at the hand and a weak `crackle` round the caster | The caster can't act for a moment after an all-out shot: the punish window. |
| overload, shudder | a short `flicker` beat (18-22 Hz) between the charge and the release | The last unstable instant before a big shot; the final dodge cue. |

### Psychic terms

Psychic force is mostly invisible, so tell it through what it does to space and to the target: warping, holding, lifting, crushing.

| Term | Field | Meaning |
|---|---|---|
| warp, ripple, distortion | `ring` `plane: billboard` with high `softness`, shader `distortion` 0.8-1 | Rings of bent air facing the camera, pulsing out from the caster or closing in round the target. In an engine they are refraction; the color is only a hint. |
| grip, hold, telekinetic field | `orb` with `bubble: true` and `height_px`, a turning `rune_circle` under the target | A clear bubble with a glowing rim around the target's body. |
| lift, levitate | `sparks` from the target with negative `gravity` and low `drag` | Debris and motes floating up inside the field. The viewer can't move the target stand-in; say in the beat intent how high a game should lift it. |
| crush, squeeze, clench | `orb` `radius_px` keyframed down hard, an inward billboard `ring`, then `flash` + `sparks` + ground `ring` + `cracks` | The field collapses onto the target, then bursts. |
| mind link, focus | a thin `beam` with high `wobble` and fine `spiral_*`, a small pulsing `orb` + `glow` at the hand | The visible thread of the caster's will. |

## 9. How the director uses this

1. Hear the request (text) or read a GIF breakdown.
2. Pick an archetype: `strike`, `projectile`, `chain`, `beam`, `aura`, `nova`, and the hero view (ask what camera the game uses if unknown).
3. Propose the phases with durations, and ask at most 2–3 choices in plain words, for example:
   *"Should it have a long charge-up (heavier, 0.4 s) or hit instantly (snappier)?"*
   *"One clean bolt, or a wild tree of forks?"*
4. Choose palette and layers.
5. Describe what the effect should look like in each of the four views.
6. Write the template, with ranges and variation knobs so every cast looks a little different.

## 10. Sound cues

Sound is described as **timed cues**, not audio: "crackle during the charge, crack on release, boom on impact". A `sound_cue` layer names one cue from a small generic library ([`web/sounds/cues.json`](../web/sounds/cues.json)) and plays during that layer's beats. The cues are element-agnostic, so fire, ice or arcane spells use the same list.

- **one-shot** cues fire at the start of each of the layer's beats (and every `repeat_ms` inside a beat if set: chain hops, restrikes).
- **sustained** cues last from the layer's first beat to its last (or `duration_ms`).

| Cue | Kind | Sounds like | Words that map to it |
|---|---|---|---|
| `charge` | sustained | rising swell of energy, cuts off | charge up, power up, wind up |
| `hum` | sustained | steady low smooth hum | drone, beam hum, aura |
| `buzz` | sustained | harsh gritty electrical buzz | electric buzz, live wire, transformer |
| `crackle` | sustained | random small electric pops | static, snaps, arcing |
| `sizzle` | sustained | bright fluttering hiss | hiss, fizz, fizzle |
| `zap` | one-shot | short electric zap, pitch drops | zip, shock, jolt, hop |
| `crack` | one-shot | sharp bright snap | thunderclap, whip crack, strike |
| `boom` | one-shot | deep heavy boom | explosion, blast, bang |
| `rumble` | sustained | low rolling rumble | rolling thunder, quake, aftershock |
| `impact` | one-shot | short punchy thud | hit, punch, slam |
| `crash` | one-shot | crash with scattering debris | smash, rubble, rocks breaking |
| `shatter` | one-shot | glassy pings and tinkles | glass, ice break, crystal |
| `ignite` | one-shot | soft fwoomp into flame | fwoosh, flare, fireball launch |
| `fire` | sustained | roaring, crackling fire | flames, burning, blaze |
| `whoosh` | one-shot | air rushing past | swoosh, swing, fly by |
| `wind` | sustained | breathy gust rising and falling | gust, breeze, vortex |
| `shimmer` | sustained | twinkling high chimes | sparkle, magic, heal |

The viewer plays a procedural placeholder for every cue today; real recordings can replace any cue later without changing templates (see [`web/sounds/README.md`](../web/sounds/README.md)).

## 11. Shader intent (the magic)

Rendered frames show *when* and *where* things happen. They don't carry the magic: in a game, that comes from shaders and particles. So each drawn layer can carry a `shader` object that says what the layer is made of and how its surface behaves, in words an engine artist (or an AI writing a Shader Graph or Godot shader) can act on. The export guide turns these into Unity and Godot steps. Layers without one get a default per layer type, flagged as a guess.

### Material (what it's made of)

| Material | Feels like | Typical noise, flow and finish |
|---|---|---|
| `ionized` | raw electricity, air torn open | ridged noise, fast flow along the path, hard white core, high HDR |
| `plasma` | contained energy, a ball or beam of it | fBm swirl, soft core, fresnel rim |
| `wet` | water on a surface, glossy and dark | low-contrast noise, lit, specular, little emission |
| `liquid` | moving water, a jet or wave | streak noise flowing along the path, distortion behind it, fresnel |
| `foamy` | spray, froth, splash | Voronoi or cellular noise, alpha dissolve, lit |
| `glassy` | clear, refractive, sharp | strong distortion, fresnel, almost no emission |
| `crystalline` | facets, ice, gems | Voronoi, hard edges, fresnel, sparkle |
| `icy` | cold mist and frost | soft fBm, slow flow, pale emission, dissolve edges |
| `molten` | glowing liquid rock or metal | slow fBm, dark crust with bright cracks, emissive edges |
| `fiery` | flames | fBm or ridged flowing upward, dissolve, orange-to-white emission |
| `smoky` | smoke | curl noise, slow upward flow, lit, soft dissolve |
| `ashen` | burnt, charred, embers | fBm, dark, a thin glowing dissolve edge |
| `dusty` | dirt, debris, sand | Voronoi or fBm, lit, alpha |
| `airy` | moving air, wind, a funnel wall | streak noise flowing around (swirl) or along the gust, mostly see-through with dense edges (fresnel into alpha), distortion, lit |
| `ethereal` | light, aura, glow with no body | soft gaussian falloff, little noise, unlit |
| `arcane` | runes, magic circles, mana | clean shapes, scrolling patterns, fresnel, pulsing emission |
| `shadowy` | darkness, void | multiply or alpha, curl noise, inward flow |
| `organic` | roots, vines, living matter | lit, Voronoi, growth along a path |
| `stone` | rock, earth | lit, Voronoi cracks, no emission |
| `metallic` | blades, metal | lit, fresnel, sharp highlights |

### Surface behaviour

| Field | Values | What it means |
|---|---|---|
| `technique` | `procedural`, `flipbook`, `particles`, `ribbon`, `mesh`, `decal`, `light`, `post_process` | How to build it. Ribbons for bolts and beams, particles for sparks and smoke, decals for ground marks. `flipbook` means using the exported frames as a texture, which only suits simple or stylized looks. |
| `noise.type` | `none`, `perlin`, `simplex`, `fbm`, `ridged`, `voronoi`, `curl`, `streaks` | The pattern that breaks the surface up. Ridged gives bright creases (electricity), fBm gives soft clouds (plasma, fire), Voronoi gives cells (foam, ice, cracks), curl swirls (smoke), streaks stretch along the flow (water jets). |
| `noise.scale` | cells per character height | 1–2 broad blobs, 4–8 detailed, 10+ fine grain. |
| `noise.speed` | world units per second | How fast the pattern moves or evolves. |
| `noise.contrast` | 0–1 | How hard the pattern cuts into the shape. |
| `flow.direction` | `none`, `along_path`, `outward`, `inward`, `upward`, `downward`, `swirl`, `toward_target` | Which way the UVs scroll. |
| `flow.speed` | world units per second | How fast it scrolls. |
| `distortion` | 0–1 | Refraction or heat haze behind the layer. Water and heat get some; pure light gets none. |
| `fresnel` | 0–1 | Rim glow at grazing angles. Makes orbs, water and shields read as 3D. |
| `dissolve` | `pattern`, `edge_width` 0–1, `edge_color` (palette slot) | The layer erodes away through a noise pattern as it fades, with a glowing edge, instead of a flat fade. |
| `emissive.hdr` | 1 = no bloom, 2–4 glowing, 5–10 blinding | How hard it drives bloom. |
| `emissive.falloff` | `hard`, `soft`, `exponential`, `gaussian` | How brightness drops from the center line or center point. |
| `emissive.core_ratio` | 0–1 | How much of the width is white-hot core. |
| `lighting` | `unlit`, `lit`, `emits_light` | Whether scene lights affect it, and whether it lights the scene. |
| `look` | one sentence | What it should feel like, in plain words ("a wet, glassy jet that refracts what's behind it"). |
| `notes` | text | Anything else an engine artist should know. |

### Engine terms (what the guide maps them to)

| Intent | Unity (URP/HDRP) | Godot 4 |
|---|---|---|
| ribbon | Line Renderer or VFX Graph strip | MeshInstance3D strip, Line2D, or GPUParticles3D trail |
| particles | VFX Graph or Particle System | GPUParticles3D/2D |
| procedural | Quad with a Shader Graph material | Billboard QuadMesh with a ShaderMaterial |
| decal | Decal Projector with a Shader Graph decal | Decal node |
| noise | Gradient Noise, Simple Noise, Voronoi nodes | NoiseTexture2D (FastNoiseLite) |
| flow | Tiling And Offset with Time | `UV += dir * TIME * speed` |
| distortion | Scene Color with offset UVs (Opaque Texture) | `hint_screen_texture` at offset SCREEN_UV |
| fresnel | Fresnel Effect node | `pow(1.0 - dot(NORMAL, VIEW), p)` |
| dissolve | Alpha Clip with Step/Smoothstep | `smoothstep` into ALPHA |
| emissive HDR | HDR color × intensity, with Bloom | EMISSION × intensity, with Glow |
