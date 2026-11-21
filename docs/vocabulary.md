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
| `wave` | A wall of water that rolls along the ground to the target and crashes over it. |
| `ring` | Expanding shockwave circle (overhead) or ripple. |
| `decal` | Mark on the ground: scorch, burn, cracks, crater, puddle, splash, frost, rune circle, warning ring (telegraph), fissures. Fades in, stays, fades out; can outlive the spell. |
| `smoke` | Soft alpha volume, slow drift. |
| `motif` | A small modeled thing that acts out part of the story: a leaf, petal, feather, water drop, a blossom that opens, or a faceted gem. One or many, placed by hand (keyframed paths) or circling the anchor. |
| `coat` | A skin over an afflicted character (status effects): flames, frost, stone, ooze, shadow, static, a sheen, or a block of ice round them. |
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
| cut marks, gouges | thin cuts left by blades or claws | `decal` `slash` |
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

### Targeted area (splash) terms

Big area spells that still need a target: the caster picks one enemy and the spell slams everyone standing round it. Set `space.targets.layout: "splash"`; the viewer stands the other enemies round the primary target and marks the primary with a red ring.

| Word | Means | Template |
|---|---|---|
| primary target | the enemy the caster picked | anchor `target` (once, on the primary) |
| splash, area hit | everyone round the primary | anchor `splash`: the layer repeats on each of them |
| splash radius | how far the area reaches | `space.targets.radius` (world units) |
| ripple | the hit spreads outward, far enemies a beat later | `space.targets.ripple_ms` per unit of distance (0 = all at once) |
| fork | lightning splitting off the primary to everyone round it | `bolt` anchored at `splash` (from the primary by default) |
| chain round the group, ricochet | one enemy after another | `targets.order: "sequence"` + `hop_delay_ms`; `bolt` or `orb` with `from: "previous"` |
| cage, fence | arcs joining each enemy to the next, closing the loop | `bolt` at `splash`, `from: "previous"`, `wrap: true` |
| rain down on each | strikes falling on every enemy | `bolt` or `orb` at `splash` with `from: "sky"` |
| split, scatter | the projectile bursts and pieces fly to each enemy | `orb` at `splash` with a `travel` beat, `arc_height_px` for lobs |
| thrown weapon | a spinning hammer, axe, anvil, disc, spear, trident or rune-stone | `orb` `look: weapon`, `shape`, `spin_hz`; `stick: true` to pin the target |
| point-blank, PBAE, nova | no target: blast every enemy in a radius round the caster | splash layout with `destination: "caster"`; the blast anchored at `caster`, the hits at `splash` |
| ground-targeted, placed area | a spot on the ground the caster picks | splash layout with `destination: "point"`; the effect anchored at `target`/`sky` lands on the spot |

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
| air slash, wind blade, crescent, sickle | `orb` `look: crescent` in a `travel: projectile` spell | A thin bow of air thrown edge-first with after-images; `tilt_deg` and `side_offset_px` make a volley fan out and converge. |
| hurricane, maelstrom, cyclone, storm | two `vortex` layers (a wide eyewall and a low outer band), a cloud deck (`smoke` at `sky`), rain sparks orbiting, lightning | An area storm wider than it is tall, with a calm eye. |
| eye, eyewall | `vortex` with a wide `base_radius_px` | The calm centre and the wall of wind around it. |
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

### Water- and ice-specific terms

Water has weight: it arcs, falls back and leaves the ground wet. Ice is water that stopped: it snaps into place, spikes, sparkles and stays. Neither glows much; they catch light (fresnel, glints) instead of making it, so keep `emissive.hdr` low (1–2) except for the bright core of an ice ray.

| Term | Field | Meaning |
|---|---|---|
| jet, hose, water cannon | `beam` `style: water` | A churning liquid column. A heavy cannon is wider (`width_px` 40+), surges harder (`churn`) and throws a big crown splash. |
| tidal wave, surge, breaker | `wave` layer | A wall of water rolling to the target, crest curling forward (`curl`), crashing and spreading. Follow it with a `puddle` decal and droplet sparks. |
| spray, crown splash, fountain | `sparks` `look: droplet` with high `gravity` | Drops thrown up that fall back. |
| ice ray, freezing beam | `beam` `style: ice` | A glassy, slow-flowing ray with a hard white core and frost glints drifting off it. |
| frosted, encased, crystals | `sparks` `look: shard` (high `drag`, `gravity` 0, long life) | Ice spikes that shoot out of the target and freeze in place. |
| snow, sleet, blizzard | `sparks` `look: flake` from a `sky` anchor with `emit_radius_px`, `wind_px` | Flakes falling over an area, slanted by the wind. Stack two layers (big slow flakes, small fast ones) for depth. |
| whiteout, freezing fog | `smoke` alpha in pale colors | Cold mist that hides the ground. |
| frozen ground, rime | `decal` `frost`, `grow_ms` | Ice crystals spreading out from the hit. |

### Blood, shadow, death and song

| Request words | Build with | Notes |
|---|---|---|
| drain, siphon, life steal, leech | `sparks` anchored at the target with `home_to: caster_hand` (`look: droplet` for blood, plain sparks for life-light), a thin `beam` tether, a growing `orb` in the hand | The flow must read as coming back to the caster. End with a flash and ring at the caster (the stolen life arriving). |
| bats, bat swarm | `sparks` `look: bat` with `home_to: target`; around the target, bats attached to a faint `vortex` (low `opacity`) | Dark flapping silhouettes. On a dark background give them a lighter color. |
| bones, skeletons, bone storm | `sparks` `look: bone`, attached to a `vortex` to orbit it | Pale bones tumbling end over end. |
| blood thorns, blood spikes | `eruption` `shape: spikes` in the blood color, glassy shader | One row with equal start and end radius and negative `tilt_deg` makes a crown leaning in on a target. |
| shadow claws, tendrils, grasp | `eruption` spikes in a dark color with negative `tilt_deg`, over a dark `puddle` decal; violet additive glyphs, beam and crackle carry the magic | Dark can't glow: use alpha smoke and lit meshes for the dark and an additive accent for the light. |
| void, black hole, implosion | black alpha `smoke` packed tight and keyframed up, a `bubble` orb rim, `sparks` `gather_px` + `swirl`, an inward billboard `ring`, then flash and outward rings | Pull in, collapse, blow out. |
| song, anthem, dirge, chord | `ring`s timed as downbeats (ground rings for a buff, `arc_deg` fronts toward a target for a debuff), small billboard ripples at the hand, `rune_circle` decals for staves and glyphs | Keep the ring rhythm regular so an engine can retime it to the music. |
| meteor storm, rain of fire | several `orb` `look: meteor` on staggered `travel` beats with `scatter_px`; impact sparks, rubble and decals `attach_to` each meteor | Each rock lands somewhere different on the field. |
| plague, pestilence, rot field | `rune_circle` + `puddle` + glowing `cracks` decals, low alpha `smoke` mist, rising `ember` spores, `droplet` sludge spits | A ground-first area; loop the middle beat for its duration. |

### Auras

| Word | Means | Template |
|---|---|---|
| aura | a persistent effect around a character that lasts as long as the game says | `archetype: aura` + `timing.loop_range` |
| start-up / sustain / end | switching on, holding, switching off | beats before, across and after the loop range |
| tick | a pulse that repeats while it holds (a heal, a burn, a beat) | ring `repeat_ms`, sound `repeat_ms` |
| halo, consecration | holy light pooled round a paladin | rune circle + dome (orb `bubble`, low `opacity`) + rising shafts |
| grove, bloom | living, healing nature round a druid | mushrooms (eruption `shape: mushrooms`), swirling leaves (`orbit_hz`), inward pulse |
| cadence | a song you can see | `look: note` orbiting, rings on the beat |
| miasma | a dark, draining cloud | alpha smoke, souls rising, inward drain rings |
| mantle | a cold field that hangs round the caster | frost decal, ice spikes, swirling flakes |

### Buffs

A buff is cast on one character to help them: a shield, haste, strength, regeneration, a resistance. The lovely ones tell a tiny story that resolves into something that lingers on the character. Tag them `buff`, make them auras, and frame them close (`views.frame: "close"`); the viewer lists them under **Type → Kinds → Buffs**.

| Word | Means | Template |
|---|---|---|
| story beat | a short readable step before the aura settles: a leaf unfurls, a drop rolls, falls, splashes | `anticipation` / `travel` / `impact` beats before the loop, each 0.3–0.8 s |
| leaf, petal, feather | a light thin thing that floats, rocks and drifts | `motif` `shape: leaf` / `petal` / `feather`; `sway_px` for a falling flutter |
| dew drop, bead, drip | a drop that runs along something and falls | `motif` `shape: droplet`; keyframe `side_px`/`height_px` along the path, `ease_in` for the fall; `sparks` `look: droplet` `attach_to` it for the splash |
| blossom, bud, opening | a flower opening | `motif` `shape: blossom`, keyframe `bloom` 0 → 1 |
| bubble shield, soap bubble | a clear shell with rainbow film and window glints | `orb` `bubble: true`, `finish: soap`, keyframe `radius_px` up and `ripple` down to settle it |
| glass dome, mirror veil | a clear tinted shell with a dark refracted edge | `orb` `bubble: true`, `finish: glass` |
| gem orbit | gems that pop in one by one and circle the character, spinning and glinting | `motif` `shape: gem` (`cut`), `count`, `orbit_radius_px`, `orbit_hz`, `spin_hz`, `stagger_ms`, `sparkle`; `glow` `attach_to` it for halos; `light` layers with the same `orbit_hz` and `tint` for colored light on the body |
| diamond, emerald, jade, sapphire, ruby | the gem's cut and color | `cut: brilliant`, `emerald`, `cabochon` (milky polished stones like jade), `marquise`, `heart`, `prism` (crystal points); the layer color or `tints` (one color per gem) |
| encased, sealed in jade, crystal shell, geode | the character stands inside a gem that grows up round them, clear face-on with bright facet edges, and shatters when it ends | `motif` `shape: gem` `encase: true`, `cut: cocoon` / `prism` / `brilliant` (`tilt_deg: 180`), `stretch` to fit the body, keyframe `fill` 0 → 1; `sparks` `look: shard` for the shatter |
| cocoon, mantle of leaves | many items stacked up the body | `motif` `count` 12–20, `stack_px`, `face: out`, `stagger_ms` so it spirals up |
| halo, crown | items circling above the head | `motif` at `height_px` 130–150, small `orbit_radius_px`; prisms with `tilt_deg: 90` and `face: out` make a snowflake |

Examples: `templates/water/dewdrop-ward.json` (leaf, drop, soap bubble), `earth/diamond-aegis.json` and the other Gemwarden orbits, `nature/petalfall-mending.json`, `arcane/moonmirror-veil.json` (glass), `ice/snowflake-ward.json`; encasing shells: `nature/jadeheart-cocoon.json`, `earth/adamant-vigil.json`, `nature/emerald-bastion.json`, `arcane/amethyst-geode.json`, `earth/amber-reliquary.json`.

### Warcries

A warcry is a shout that rolls out over the allies or enemies round the caster. Tag it `warcry`; the viewer lists them under **Type → Kinds → Warcries**.

| Word | Means | Template |
|---|---|---|
| warcry, shout, roar, bellow, howl, battle cry | the caster rears back and shouts, and a wave rolls out | point-blank splash + `space.caster_react` `kind: shout`, release at its chest-forward moment |
| knockback, blown back | enemies shoved off their feet | `targets.react` `kind: knockback`, a hard linear ground ring, a dust wave, `ripple_ms` matched to the ring |
| thunder shout, thunderclap | a crack of thunder and bolts on every foe | `targets.react` `flinch`, splash `bolt` `from: sky` |
| fear howl, terror | enemies cower | `targets.react` `cower`, a `skull` glyph and a shadow `coat` on each |
| rally, rallying cry, banner | allies lifted by a cry and a planted banner | `targets.side: allies`, `cheer`, `motif` `shape: banner` keyframed down, an aura with `ripple_ms: 0` |
| battle fury, frenzy, berserk | allies burning with rage | allies, a red flame `coat` and embers on each, an aura |
| stoneskin, ironhide | allies hardened | allies, a `stone` coat creeping up, then a bronze `glow` coat |

### Status effects

| Word | Means | Template |
|---|---|---|
| status effect, affliction, debuff, condition | a lingering effect on one target that the game puts on and takes off | `archetype: status` + `timing.loop_range` |
| apply / lasts / expires | landing, holding, wearing off | beats before, across and after the loop range |
| burning | on fire | `coat` `pattern: flame`, add-blend flame smoke, embers, black smoke, scorch |
| frozen (solid) | trapped in ice | `coat` `shape: crystal` `pattern: ice` that climbs up (`cover_px` keyframed), frost skin, shatters at the end |
| chilled | cold, slowed by frost | frost `coat` clipped to the legs, falling `flake` snow, breath puffs |
| poisoned | toxic, venom | `coat` `pattern: ooze`, bubble glyphs, a skull glyph per tick, drips, puddle |
| diseased, plague | sick | murky `shadow` coat, miasma smoke, spores, `fly` glyphs circling the head |
| bleeding | a wound that keeps bleeding | droplet drips and spurts, a growing blood pool, a rim throbbing like a heartbeat |
| haunted | followed by spirits | `ghost` glyphs orbiting, a cold rim, dark mist |
| dazed, dizzy | seeing stars | steady `star` glyphs on an `emit_ring` orbit over the head |
| stunned | locked up | spinning `swirl` glyphs, sparks round the head, a rim |
| sleepy, asleep | out cold | `z` glyphs floating up and growing, slow breathing glow |
| rooted, snared | stuck to the ground | an inward-leaning `eruption` ring of roots, bark `coat` on the legs |
| silenced | can't cast | a glowing gag (`coat` band at the mouth), a `mute` glyph |
| cursed, hexed | doomed | `shadow` coat, a `skull` glyph, a hex rune circle |
| shocked | electrified | `coat` `pattern: static`, crackle lifted round the body, spitting sparks |
| petrified | turned to stone | `stone` coat creeping up (`cover_px` keyframed, `edge_glow`), crumbles at the end |
| slowed | time drags | `hourglass` glyph, inward rings, a 12-fold clock circle |
| confused | baffled | `question` glyphs circling the head |
| feared | terrified | shadow climbing the body, `exclaim` glyphs, sweat `drop` glyphs |
| blinded | can't see | a bright `coat` band over the eyes, glare |
| charmed | love-struck | `heart` glyphs circling and rising, a rosy heartbeat glow |
| bubbled | trapped in a bubble | orb `bubble` round the body, rising bubbles, pops at the end |
| comic glyph | a cartoon symbol over a character | `sparks` `look: glyph` |

Examples of targeted area spells: `templates/lightning/stormhammer-barrage.json` (hammers then a fork), `cleaving-squall.json` (a chain round the group), `ricochet-stormdiscs.json` (a ricochet), `stormcage-javelin.json` (a cage), `runefall-cairn.json` and `thunderhead-verdict.json` (from the sky), plus `ice/glacial-shatterpoint.json`, `fire/emberfall-cascade.json`, `earth/faultline-crush.json` and `poison/venom-bloom.json`. Point-blank: `lightning/stormcrown-nova.json`, `shadow/abyssal-implosion.json` (pull in, then detonate), `ice/permafrost-crown.json`, `earth/tectonic-crown.json` and more. Ground-targeted: `poison/mire-splat.json`.

## 9. How the director uses this

1. Hear the request (text) or read a GIF breakdown.
2. Pick an archetype: `strike`, `projectile`, `chain`, `beam`, `aura`, `nova`, `status`, and the hero view (ask what camera the game uses if unknown).
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
| `splash` | one-shot | wet slap, spray, droplets | splash, splat, water impact |
| `stream` | sustained | rushing, gurgling torrent | torrent, gush, jet, flood |
| `freeze` | sustained | crisp ice crackles and creaks | freeze, frost, crystallize |
| `squelch` | one-shot | thick wet visceral squelch | gore, splatter, blood, slime |
| `heartbeat` | sustained | low muffled lub-dub pulse | pulse, throb, dread |
| `whisper` | sustained | breathy wordless whispers | voices, murmur, curse, hex |
| `drain` | sustained | reversed sucking inhale that cuts off | siphon, life steal, leech |
| `drone` | sustained | ominous dissonant low drone | doom, curse, void, shadow |

The viewer plays a procedural placeholder for every cue today; real recordings can replace any cue later without changing templates (see [`web/sounds/README.md`](../web/sounds/README.md)).

The words for describing a sound (texture, pitch, envelope, space, size), how a spell's sound is layered across its phases, element flavors, timing and level rules, and how to make the real sounds with a text-to-SFX generator, an AI-written synthesizer or a library are in [sound-design.md](sound-design.md). Each cue in `cues.json` carries its `character` in those words, a `sfx_prompt`, a `synth` recipe and `search` terms.

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
| `iridescent` | soap bubbles, nacre, oil sheen, beetle wings | thin-film rainbow bands by view angle, clear middle, window reflections |
| `gemstone` | diamonds, emeralds, jade, sapphires | faceted (or polished dome) refraction, inner brilliance, rainbow fire, sharp glints |
| `foliage` | leaves, petals, feathers | thin lit sheet, veins or barbs, light glowing through the edges, soft alpha edge |

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
| `lighting` | `unlit`, `lit`, `emits_light`, `six_way` | Whether scene lights affect it, and whether it lights the scene. `six_way` (smoke): relit from six baked directions, see [Six-way lit smoke](#six-way-lit-smoke). |
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

## 12. Styles

The same spell can be built in different art styles. A style doesn't change *what happens* (beats, layers, timing, palette); it changes *how it's made*. The viewer previews each style, and the export guide adds per-style Unity and Godot steps to every layer. Pick the style that matches the game; a template's `style.preset` says which one it was designed for.

| Style | Looks like | Key techniques |
|---|---|---|
| `stylized` (default) | clean readable shapes, saturated palette, soft gradients, strong bloom (most action games, MOBAs, ARPGs) | additive glows with a white-hot core, smooth noise, HDR emission ×2–6, bloom |
| `realistic` | matter that looks like matter: lit smoke, ground that really cracks open, heat haze, real lights, filmic color | depth decals (height map + parallax occlusion mapping + normal from height), flow maps for lava, emissive masks, soft particles, six-way lit smoke, distortion, ACES tone mapping, real lights with shadows |
| `toon` | cel-shaded, anime or cartoon: flat color bands, hard edges, ink outlines, snappy timing | stepped color ramps (posterize), alpha clip, inverted-hull or screen-space outlines, smear frames, animating on twos |
| `pixel` | low-res pixel art with a limited palette | low-res render or small flipbooks, point filtering, pixel snapping, palette shades, 8–12 fps |

### Realistic terms

| Term | What it is | Unity | Godot 4 |
|---|---|---|---|
| height map | greyscale image of how high each point is (the export's `decal-<id>-height.png`: white = ground, black = deepest) | texture input of the POM node | `heightmap_texture` / sampled in the shader |
| parallax occlusion mapping (POM) | marches a ray through the height map so a flat decal looks carved in, with walls you can see into | Shader Graph **Parallax Occlusion Mapping** node | StandardMaterial3D **Heightmap** with **Deep Parallax**, or a POM loop in a spatial shader |
| normal from height | slopes of the height map turned into a normal map so walls catch the light | **Normal From Height** node | a baked normal map, or three height samples in the shader |
| emissive mask | where a decal glows or holds its fill (`decal-<id>-emissive.png`) | multiply into Emission | multiply into EMISSION |
| flow map | an image whose red/green give a direction to scroll a texture along (`decal-<id>-flow.png`, outward from the centre) | two noise samples offset by flow × time, cross-faded every half cycle | same, in the fragment shader |
| crust / cooling | lava darkens to rock from the edges and as it ages | lerp emission to 0 and albedo to near-black by the `heat` curve | same |
| soft particles | particles fade where they meet geometry instead of cutting a line | Soft Particles / depth fade | `proximity_fade_enabled` |
| six-way lighting | smoke flipbooks with lighting baked from six directions, so smoke is lit by the scene (see [Six-way lit smoke](#six-way-lit-smoke)) | VFX Graph **Output Particle Six-way Smoke Lit** | a spatial shader that blends the two six-way maps in `light()` |
| heat haze | the air bends behind hot or energetic things | Scene Color with offset UVs (HDRP Distortion) | `hint_screen_texture` at offset SCREEN_UV |
| tone mapping | maps HDR light to the screen so bright things roll off to white | Volume Tonemapping ACES / Neutral | WorldEnvironment tonemap ACES / AgX |

### Six-way lit smoke

Smoke that the scene lights instead of smoke with its light painted in. A smoke flipbook is pre-lit from six directions (right, left, top, bottom, back, front) and packed into two textures; at runtime the shader blends the six by each light's direction, so the same puffs go pink on the side facing a magenta light, dark underneath when lit from above, and glow at their thin edges when a light is behind them. It's the cheap way to get volumetric-looking smoke from sprites.

| Word | Means |
|---|---|
| six-way lightmaps | the two packed textures: **positive** = R right, G top, B back, A alpha; **negative** = R left, G bottom, B front, A emissive. Linear, not sRGB |
| back light / rim | a light behind the smoke: the thin edges glow, the thick middle stays dark |
| under light | a light below (a fire, lava): only the undersides light up |
| key, fill, rim | the main light, a softer light from the other side, a light from behind |
| emissive (six-way) | the thick core of a puff, where a fire inside it would glow through |

In a template: `"shader": { "lighting": "six_way" }` on a `smoke` layer (alpha blend) asks for it in every style; the **Realistic** style lights every alpha smoke layer this way unless it says `unlit`. Glowing `add` smoke (flame billows) is never six-way lit: it is the light. The viewer bakes the maps procedurally and draws the smoke with them, lit by the stage lights and the spell's own `light` layers; the export writes the maps (`smoke-<id>-sixway-pos.png`, `-neg.png`) with Unity and Godot steps. Give the smoke something to react to: a `light` layer below it (firelight), beside it (`forward_px`, `side_px`), behind it, or circling it (`orbit_hz`), with `tint` for colored stage lights. [`templates/fire/neon-campfire.json`](../templates/fire/neon-campfire.json) is a test piece that cycles neon lights round a campfire's smoke from all six directions.

### Decal depth and fill

A decal's `depth` (carved, flat or raised) and `fill` (`lava`, `glow`, `liquid`, `void`) say what the ground mark is in 3D. In the realistic style the viewer draws it with parallax and lit walls; in every style it draws the fill. The export adds the height map, emissive mask and flow map, and the curves `fill` (how far it has risen) and `heat` (1 = fresh, 0 = cooled).

| Fill | Use for | Feels like |
|---|---|---|
| `lava` | meteors, eruptions, fire slams, earth + fire | molten rock flowing along the cracks, white-hot deep down, a dark crust floating on it, cooling to black rock |
| `glow` | lightning, holy, arcane, energy hits | light shining up out of the cracks |
| `liquid` | water, blood, poison, slime | liquid pooling in the cracks, glossy, a moving highlight |
| `void` | shadow, dark magic, curses | darkness welling up from below with a faint colored swirl |

