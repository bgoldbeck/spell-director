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
| `ring` | Expanding shockwave circle (overhead) or ripple. |
| `decal` | Mark on the ground: scorch, burn, cracks, crater, puddle, splash, frost, rune circle, warning ring (telegraph). Fades in, stays, fades out; can outlive the spell. |
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
