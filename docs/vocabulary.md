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
| `decal` | Mark left on the ground (scorch, burn, frost). |
| `smoke` | Soft alpha volume, slow drift. |
| `light` | Dynamic light cast on the environment. |
| `camera_shake` | Screen shake. |
| `sound_cue` | Marker for where audio hits (not audio itself). |

Order matters: draw back to front, usually `shadow/smoke → glow → bolt/beam → sparks → flash`.

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

## 7. Lightning-specific terms

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

## 8. How the director uses this

1. Hear the request (text) or read a GIF breakdown.
2. Pick an archetype: `strike`, `projectile`, `chain`, `beam`, `aura`, `nova`.
3. Propose the phases with durations, and ask at most 2–3 choices in plain words, for example:
   *"Should it have a long charge-up (heavier, 0.4 s) or hit instantly (snappier)?"*
   *"One clean bolt, or a wild tree of forks?"*
4. Choose palette and layers.
5. Write the template, with ranges and variation knobs so every cast looks a little different.
