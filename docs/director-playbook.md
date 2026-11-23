# Director Playbook

How the director turns a loose request ("heavy boss lightning, top-down game") or a reference GIF into a template. Follow the steps in order. You (the AI) are the director: you know the [vocabulary](vocabulary.md) and the [template format](template-format.md), and the user doesn't need to.

The director is driven through the SpellDirector MCP server (`python -m director.mcp_server`, see the [README](../README.md#director-mcp-server)). Every tool named below is an MCP tool on that server. The same functions are plain Python in `director/library.py`, so you can follow this playbook without MCP too.

---

## Ground rules

- **You give the directions, the user picks.** Never ask "what jaggedness do you want?". Offer two or three concrete options in plain words, with your recommendation first.
- **Ask at most 2–3 questions, once.** Everything else, decide yourself and explain it in `director_notes`. If the request already answers a question, don't ask it.
- **Game- and engine-agnostic.** Don't name or imitate a specific game's effect. A reference GIF gives you *character* (timing, shape, palette, layering), never art to copy.
- **All four views.** Every template must read from front, side, top and 3/4. Decide the hero view early, then write `views.reads` for all four.
- **Validate before you save.** `save_template` validates again and refuses a template with errors.

## Step 0. Load the context

Read these once per session (MCP resources, or the files):

| Resource | File |
|---|---|
| `spelldirector://docs/vocabulary` | `docs/vocabulary.md` |
| `spelldirector://docs/template-format` | `docs/template-format.md` |
| `spelldirector://docs/director-playbook` | this file |
| `spelldirector://docs/gif-breakdown-playbook` | `docs/gif-breakdown-playbook.md` |
| `spelldirector://schema/0.1.0` | `schemas/template-0.1.0.schema.json` |

Call `get_sound_cues` once for the sound cue vocabulary. Then call `list_templates` and open the one or two closest to the request with `get_template`. Existing templates are your best guide to what the viewer renders well. Reuse their structure, don't duplicate them: a new template must differ in feel, not just in numbers.

## Step 1. Read the request

Pull these out of what the user said, and note which are missing:

| Decide | Words that tell you | If missing |
|---|---|---|
| `element` | "lightning", "storm", "shock"; "fire", "flame", "burn", "breath", "inferno", "blaze"; "water", "jet", "splash", "wave", "tide"; "ice", "frost", "freeze", "snow", "blizzard"; "wind", "air", "tornado", "whirlwind", "gust", "gale"; "sun", "solar", "holy", "radiant" (light); "raw power", "hyper", "cannon", "annihilate" (energy); "psychic", "mind", "telekinetic" (psychic); "earth", "rock", "stone", "ground", "quake", "slam", "boulder"; "blood", "vampire", "bleed", "siphon" (blood); "song", "bard", "anthem", "dirge" (sound); "shadow", "dark", "void", "death", "necro" (shadow); "plague", "rot", "toxic", "disease" (poison); "bonk", "daze", "stun", "knockout" (physical) | ask (it's rarely missing) |
| `archetype` | strike (from above / one hit), projectile (thrown), chain (jumps), beam (continuous), aura (around the caster), nova (bursts outward), status (an affliction on a target: burning, frozen, asleep, poisoned) | infer, or ask as a choice |
| weight | heavy, boss, big, ultimate → long anticipation, hold frames, shake. quick, light, basic → snappy | default to medium |
| camera / hero view | top-down, isometric, side-scroller, fighting game, over-the-shoulder (see vocabulary §7) | **ask** |
| scale | boss, area, single target, ultimate | infer from weight |
| mood | natural, magical, corrupted, holy | infer from words, default natural |

For a GIF, call `breakdown_gif` first and follow steps 1–5 of the [GIF breakdown playbook](gif-breakdown-playbook.md) in place of Steps 3–5 here. You can still ask Step 2 questions the GIF doesn't answer, such as the camera of the user's own game. Set `source.kind` to `director_gif`.

## Step 2. Ask the questions (at most 2–3)

Pick the questions whose answers change the template the most. Good ones, in priority order:

1. **Camera**, if unknown: *"What camera does your game use? Top-down (like a tactics game), angled/isometric, side-on, or behind the character?"* → `views.hero`.
2. **Charge-up**: *"Long charge-up before it hits (heavier, about 0.5 s) or near-instant (snappier)?"* → anticipation length.
3. **Shape**: *"One clean bolt, or a wild tree of forks?"* → `branch_chance`, `branch_depth`, `jaggedness`.
4. **Area**: *"Hit one target, or blast the area around it?"* → footprint, sparks, ring size.
5. **Color**: *"Classic white-blue, or a colored variant (violet, gold, red)?"* → palette.

For earth, ask: *"A wave that runs out in front of you, or a quake all around you?"* → `eruption.arc_deg`, footprint `arc` or `circle`; *"Spikes, or heaving slabs of ground?"* → `eruption.shape`.

For fire, swap the shape question for one of these: *"A tight jet that hits one target, or a wide cone that sweeps an area?"* → `spread`, `sweep_px`, footprint; *"Natural orange flame, or a magical color (blue, green, purple)?"* → palette.

For wind, ask: *"Do you send it to the target, or does it appear on top of them?"* → `start_offset_px` and a `travel` beat; *"A tight dust devil or a towering storm funnel?"* → `height_px`, `top_radius_px`, weight.

Phrase each as a choice between two or three named options with what each feels like. Put your recommendation first. If the user says "you pick", pick and move on.

## Step 3. Lay out the timeline

Write the beats first; everything else hangs off them.

1. Pick the phases the archetype needs (vocabulary §1). Typical sets:

   | Archetype | Phases |
   |---|---|
   | strike | anticipation → release → impact → dissipation |
   | projectile | (anticipation) → release → travel → impact → dissipation |
   | chain | release → travel (hops) → impact (per target) → dissipation |
   | beam | anticipation → release → travel (sustained) → dissipation |
   | aura | anticipation → impact (sustained, `hold` or `flicker`) → dissipation |
   | nova | anticipation → release → impact (expanding ring) → dissipation |
   | status | impact (apply) → release (sustained `hold`, the loop) → dissipation (expire) |

2. Turn weight words into durations (vocabulary "Timing words → numbers"):

   | Weight | Total | Anticipation | Release | Impact | Dissipation |
   |---|---|---|---|---|---|
   | snappy | 400–700 ms | 0–100 ms | 30–60 ms | 80–150 ms | 200–350 ms |
   | medium | 700–1200 ms | 200–380 ms | 50–80 ms | 150–250 ms | 300–500 ms |
   | heavy / boss | 1300–2200 ms | 450–800 ms | 60–100 ms | 250–450 ms | 500–900 ms |

   Contrast is what sells weight: a long anticipation and a long tail around a very short release.
3. Choose each beat's intensity curve: anticipation `ease_in`, release `spike`, lightning impact `flicker` (10–16 Hz), fire stream or impact `flicker` (5–9 Hz: flames are slower than electricity), a wind hold `flicker` (4–6 Hz, a narrow `from`–`to` range: a steady roar), dissipation `ease_out`. Let impact and dissipation overlap by 30–60 ms so the hit doesn't cut off.
4. Write each beat's `intent` in plain words a non-artist understands. It's shown as the caption in the viewer. Mention hold frames in the release intent if you use them.

### Gestures (the caster's arms)

Give every spell with a caster a `space.caster_gestures` list (template-format.md, *Gestures*): it is the casting animation. Pick from the words (vocabulary.md, *Gestures*): `throw` or `spin_throw` for thrown projectiles, `push` or `channel` for beams, `point` for a quick zap, `sky_point` then `point` to call from the sky, `gather` then `slam` or `roar` for novas, `summon` for buffs. Land each gesture's last key (`at_ms + duration_ms`) on the beat it causes: the release, the strike, the impact. Hold a channel (`hold_ms`) through the sustain. Emit from the fingers with `caster_fingertip`, from between cupped hands with `caster_hands`.

### Auras (persistent effects)

If the request is for something that *lasts* ("an aura", "while it's active", "a field around me", "a damage zone", "a buff that stays"), make an aura (template-format.md, *Auras*): `archetype: aura`, three beats (start-up `anticipation`, a steady `hold` sustain, end `dissipation`) and `timing.loop_range` exactly over the sustain, e.g. 1200–4200 ms in a 5000 ms spell. Give the looping layers all three beats so they build up in the start-up, keep particle lifetimes under ~1 s, use rings with `repeat_ms` for ticks and line the tick sounds up with them. Put one-shots (the cast flare) early in the start-up. Choose the line from the request (Paladin, Druid, Bard, ...) and the element from what it's made of. Tell the user the loop range so they can set it up in the engine.

**Buffs** (a shield, haste, strength, regeneration or a resistance cast on one character) are auras that tell a tiny story first. Make the start-up two to four short story beats (a leaf unfurls, a drop rolls down it and hangs, falls, splashes) that resolve into the lingering part (a soap-bubble shield, gems circling, a cocoon of leaves). Build the story out of `motif` layers (template-format.md, *Motifs*): keyframe their `side_px`/`height_px` for paths, `ease_in` for a fall, `bloom` for a flower opening, `stagger_ms` so gems or leaves appear one by one. Keep it delicate: small sizes, faint ground marks (decal `opacity` 0.1–0.3), soft lights (`energy` under 1), gentle orbits (one turn per loop). Tag it `buff`, set `views.frame: "close"`, and pick the theme from the effect: protection is a shell, haste lives at the feet, strength in the chest, regeneration breathes inward, a resistance is a halo or crown. Gem buffs: `motif` `shape: gem` with a `cut` per stone (diamond `brilliant`, emerald `emerald`, jade `cabochon`), a `light` per color orbiting at the same `orbit_hz` with a `tint`, and `sparkle`. See [`templates/water/dewdrop-ward.json`](../templates/water/dewdrop-ward.json) and [`templates/earth/diamond-aegis.json`](../templates/earth/diamond-aegis.json).

**Sword skills** (a slash, a combo, a thrust, a whirlwind, a leap strike) give the caster a `space.caster_weapon` and swing it with the sword gestures (`slash`, `backslash`, `chop`, `rising_slash`, `thrust`, `blade_out`; two-handed `cleave`, `sweep_both`), move the body with `caster_react` (`lunge`, `leap`, `spin`, or a list of them) and draw each stroke with a `slash` layer anchored at `caster_blade` (template-format.md, *Sword skills*). Keep melee enemies close (`footprint.length` about 1.25). Put the hit beat where the blade reaches the enemy, give each hit of a combo its own flinch (`targets.react` as a list), and for a spin use a point-blank splash with `targets.order: "sweep"` so each enemy is hit as the blade comes round. Sound each stroke with `swing` (not `whoosh`) and blade-on-blade or armor hits with `clang`. See [`templates/physical/threefold-flurry.json`](../templates/physical/threefold-flurry.json) and [`templates/physical/whirling-steel.json`](../templates/physical/whirling-steel.json).

**Warcries** (a shout, a roar, a howl, a rallying cry, a battle cry) are point-blank splash spells with a voice (template-format.md, *Warcries*): tag them `warcry`, set `space.caster_react` to `shout` and `caster_gestures` to a `flex` that ends at the chest-forward moment and a quick `roar`, stand `targets.side` `enemies` or `allies` round the caster and give them a `targets.react` (`knockback` for a roar, `flinch` for a thunderclap, `cower` for fear, `cheer` for a rally). Start the release at the shout's chest-forward moment (about 40% into it), roll one hard ring out at a steady speed and set `ripple_ms` to match it, then put the read on each figure with `splash` layers: a burst on the chest, a glyph over the head, a coat on the body. A warcry that leaves an aura on the allies is an aura (`loop_range`, `ripple_ms: 0`). A war banner is a `motif` `shape: banner`. See [`templates/sound/warcry-breaker-roar.json`](../templates/sound/warcry-breaker-roar.json) and [`templates/light/warcry-rallying-standard.json`](../templates/light/warcry-rallying-standard.json).

### Status effects (afflictions on a target)

If the request is for something that *afflicts* a character ("burning", "frozen", "poisoned", "asleep", "stunned", "a debuff", "a status effect", "a condition"), make a status effect (template-format.md, *Status effects*): `archetype: status`, `space` origin and destination `target` with `travel: none`, an apply beat (`impact`, 0–1200 ms), a steady `hold` beat over `timing.loop_range` (1200–4200 ms) and an expire beat (`dissipation`), plus short `onset` and `finale` beats for the one-shots of landing and wearing off. Anchor every layer at `target`. Make it read on the body: a `coat` on the character, something over the head that reads from far away (comic glyphs are welcome when the game is light-hearted: Zs, stars, question marks, a skull), and a mark on the ground for the top view. Give the expire something to do when it fits (ice shatters, a bubble pops, stone crumbles). The aura loop rules all apply.

## Step 4. Choose layers

Start from the silhouette (vocabulary §3): what's the one shape that reads as a black cutout? Build that layer first, then add support layers. Keep it to the layers that do a job; 8–14 is typical.

- **Core shape**: `bolt` (strike, chain), `beam`, `orb` (projectile head, charge), `ring` (nova).
- **Glow** attached to the core (`attach_to`), one palette step darker.
- **Payoff**: `flash` on release, `sparks` + `ring` on impact, `camera_shake` for weight, `light` on the target.
- **Ground story**: anything vertical is a dot from the top view, so give it a `ring`, `decal`, radial `sparks` or ground `crackle`. Mandatory when the hero view is `top`.
- **Tail**: `crackle` lingering, `smoke`, `decal` fading.
- **Decals** (marks on the ground, see the decal table in the template format). Most spells want one; top-down and 3/4 games need them. Pick by moment:
  - *Telegraph* (anticipation): a `warning_ring` (add, `pulse_hz` 3–5, sized to the danger zone, `grow_ms` so it closes in) for anything the player should dodge, especially boss attacks; a `rune_circle` (add, `spin_deg_per_s` 30–60, `grow_ms`) under a caster who is charging.
  - *Impact* (impact): a glowing mark that cools fast (`cracks` with `blend: add`, or `burn`, `lifetime_ms` 100–400) stacked over a dark mark that stays (`scorch` for fire and lightning, `crater` for heavy hits, `puddle`/`splash` for water, `frost` for ice, alpha). The glowing one sells the heat; the dark one is the memory of the hit.
  - *Aftermath*: let the dark mark outlive the spell (`lifetime_ms` past the duration, long `fade_ms`); the engine keeps it on the ground.
  - Leave `rotation_deg` out so every cast lays the mark at a new angle; set it (with `stretch` > 1) only for marks with a direction, like a skid along a beam. Use `radius_px` ranges for size variation.
  - Size it to the hit: about the impact ring's end radius for scorch, wider for wet ground, exactly the danger zone for a telegraph. Decals anchored to `target` repeat on every chain target.
- **Sound cues**: one `sound_cue` layer per sound, listing the beats it plays in. Call `get_sound_cues` for the vocabulary (vocabulary §10). Turn the user's words into cues ("electric buzz" → `buzz`, "thunderclap" → `crack`, "explosion" → `boom`, "flames" → `fire`). A typical score:
  - anticipation: a sustained build (`charge`, `crackle`, `buzz`, `wind`, `shimmer`);
  - release: one sharp one-shot (`crack`, `zap`, `ignite`, `whoosh`, `swing` for a blade);
  - travel: sustained (`hum`, `sizzle`, `fire`) or a repeating one-shot (`zap` with `repeat_ms` = the hop delay);
  - impact: the weight (`boom`, `impact`, `crash`, `shatter`); heavy spells stack a one-shot and a sustained `rumble`;
  - dissipation: a quiet tail (`crackle`, `rumble`, `fire`, `sizzle`) at `gain` 0.3–0.5.

  Think in sound roles per phase (build-up, launch, travel, hit, tail; [sound-design.md](sound-design.md) §1), stack the hit (a sharp transient cue plus a heavy one), and pick cues whose `character` matches the element (water: `stream`, `splash`; ice: `freeze`, `shatter`; blood: `squelch`, `heartbeat`; dark: `drain`, `whisper`, `drone`). Keep it to 2–5 cues, mix loud and quiet (`gain`), and give one-shots a small `pitch` range (e.g. 0.9–1.1) so repeated casts don't sound identical. Set `size` to match the spell's scale: `large` for big AoE, meteors, quakes, greatswords and boss attacks, `small` for sparks, darts, daggers and quick jabs (medium is the default). If no cue fits, use the closest one and say what you wanted in `director_notes`; don't invent cue names.

- **Fire** (vocabulary "Fire-specific terms"). Build it from heat, not from lines:
  - *Breath or flamethrower*: a `beam` with `style: fire` (`spread` 2.5–4 for a cone, `turbulence` 0.6–0.8, `churn` 0.3, `flow_speed` 4–7, `puff_count` 30–50 for volume, `shed_*` for embers off the edges, `sweep_px` 40–80 to rake an area). Its palette ramp does the coloring: give it `gradient_core_to_primary` and a red `secondary`. Don't stack a second white beam inside it: the stream already has a hot jet that burns out along the cone.
  - *Fireball*: an `orb` (plasma/fiery) flying in a `travel: projectile` spell, with `sparks` `look: ember` behind it.
  - *Explosion or eruption*: `flash` + additive `smoke` (`blend: add`, flame billows) + `sparks` `look: ember` + a dark `smoke` plume + `ring`.
  - *Meteor or anything called down from the sky*: a long telegraph first (a `warning_ring` decal sized to the hit and a `ring` closing in on the centre, about 1 s; a heavier hit deserves a longer warning), then an `orb` `look: meteor` anchored at `sky` in a `travel: projectile` spell, falling at an angle (`approach_deg` 25–40, so the side and 3/4 views show a diagonal streak and the top view a streak sliding in) and accelerating (`travel_ease: ease_in`, 0.5–0.8 s), with `smoke_trail_ms` so its trail hangs in the air after it lands. The hit stacks a screen `flash`, a local flare, an additive `smoke` fireball, a fast shockwave `ring`, a dust wave (`smoke` with `spread_speed` 300–500), `sparks` `look: debris` with `glow`, embers and a smoke column, over a `crater` decal with glowing `cracks`. Sound: `rumble` under the telegraph, `wind` + `fire` + a late `whoosh` for the fall, `boom` + `crash` on impact.
  - *Anticipation*: fire builds before it's released: an `orb` growing at the mouth or hand with a pulsing `glow`, dark wisps (`smoke`, `shadow` color), a few embers escaping, a contracting `ring` for an inhale.
  - *Ground*: a `burn` decal (add, `lifetime_ms` 400–800) and glowing `cracks` (add) over a `scorch` (alpha, outlives the spell). For a sweep, lay them across the line of fire (`rotation_deg` 90, `stretch` 1.6–2.2).
  - *Tail*: embers (`sparks` `look: ember`, `gravity` −80 to −200, long `emit_ms`), a dark smoke plume, and a quiet `fire` cue.
  - *Sound*: `wind` (inhale) or `charge` → `ignite` (+ `whoosh`) → `fire` (stream) → `impact` or `boom` for a blast → `fire` at gain 0.3–0.4 for the smolder.
  - *Shader intent*: `fiery` for flames, `plasma` for a ball of fire, `molten` for glowing ground and cracks, `ashen` for scorch, `smoky` for smoke (add `lighting: "six_way"` to dark alpha smoke that should be lit by the fire and the scene, see [vocabulary.md](vocabulary.md#six-way-lit-smoke)); fBm noise flowing `along_path` or `upward`, `dissolve` with a red `edge_color`, `distortion` 0.3–0.6 for heat haze, `emissive.hdr` 3–6.

- **Wind** (vocabulary "Wind-specific terms"). Air is invisible; build it from what it carries:
  - *Tornado or whirlwind*: a `vortex` (`material: airy`, alpha). Keyframe `spin_hz` from ~0.4 up to 2–3 during the release, and `height_px`/`top_radius_px` from a low swirl in the anticipation to full size. To send it, set `start_offset_px` 150–250 and `meander_px` 20–40 with a `travel` beat; to drop it on the target, leave them at 0.
  - *Gust or push*: a `beam` `style: wind` from `caster_hand` (`spread` 3–3.5, `flow_speed` 8–10, `line_count` 20–30, `grow_ms` ~150), a short draw-in (closing `ring`, wisps at the palm), and at the target a dust wave (`smoke` with `spread_speed` 200–300), `sparks` `look: leaf` and `look: debris`, a light shake and a `swept` decal along the cast direction. See [`templates/wind/gale-shove.json`](../templates/wind/gale-shove.json).
  - *Air slash or blade volley*: one `orb` `look: crescent` per blade, anchored at `caster_hand`, each with its own `travel` beat staggered ~100 ms (`travel_ease: ease_in`, alpha blend). Alternate `tilt_deg` (±30) and `side_offset_px` (±90) so the volley fans out and converges; land each with a small local `flash`, chips (`debris`), leaves and a `slash` decal. Sound: one `whoosh` per blade at rising pitch, quick high `crack`s (`repeat_ms`) for the cuts. See [`templates/wind/scythe-volley.json`](../templates/wind/scythe-volley.json).
  - *Hurricane or storm (area, boss)*: land it on the target (`travel: instant`, archetype `nova`) after a long brew: a spinning `warning_ring` decal sized to the area and a dark cloud deck (`smoke` at `sky`, `rise_speed` 0, `spread_px` 250+, 30+ puffs). Use two `vortex` layers: a broad, flared eyewall (top radius 220–260, base 60–80: a calm eye) and a low, very wide, faint outer band (`flare` ~1.2, opacity ~0.4) turning slower. Attach rain (`look: droplet`), debris and leaves to the eyewall, strike lightning (`bolt` from `sky`, `restrikes`) through the eye, shake for the whole rage, and leave a `swirl` decal 2–3× the tornado's. See [`templates/wind/maelstrom.json`](../templates/wind/maelstrom.json).
  - *What it carries*: `sparks` `look: debris` (color `shadow`) and `look: leaf` (color `accent`) with `attach_to` the vortex: `speed` 90–150 is how fast they climb, `emit_ms` spans the whole hold, `gravity` 300 (leaves) to 900 (debris) for when they are flung. A dusty `smoke` (alpha, `secondary`) attached to it is the dust skirt.
  - *Rope-out*: in the dissipation beat keyframe `top_radius_px` and `base_radius_px` down and `sway_px` up; the attached debris is flung outward when it starts. Add a low settling-dust `smoke` at the target.
  - *Ground*: a `swirl` decal (alpha, dusty color, `grow_ms` 600–900, outlives the spell).
  - *Sound*: `wind` at low pitch (0.7) for the gather → `whoosh` as it forms → `wind` at 1.0–1.1 plus `rumble` while it travels and grinds → `wind` at 0.75, quiet, as it dies.
  - *Shader intent*: `airy` for the funnel and gusts (streak noise flowing `swirl`, `fresnel` into alpha, `distortion` 0.3–0.5), `dusty` for dust and the mark, `stone` for debris, `organic` for leaves. No emission unless the wind is magical.
- **Big beams** (light, energy; vocabulary "Light and energy beam terms"). The charge is half the spell:
  - *Gather*: `sparks` with `gather_px` 120-200, `spread_deg` 360 and long `emit_ms` pulled into an `orb` that grows by keyframe, plus a contracting `ring` and a `rune_circle` or glowing `cracks` underfoot. Solar spells brighten the whole frame with a soft `flash` `scope: screen`. Heavy shots add a short 18-22 Hz `overload` beat.
  - *Beam*: `width_px` 35-80, `wobble` under 0.15, `grow_ms` 100-150, `spiral_count` 2-3 with `spiral_pitch_px` 150-200 so it reads as a 3D column from every view. Keyframe the width up on release and down to 0 at the end.
  - *Recoil*: a `ring` with `plane: vertical` at the hand, a dust `ring` at the caster, a stretched `scorch` under them and a heavy `camera_shake`; then a recharge beat (hand `smoke`, weak `crackle`).
  - *Impact*: a soft bloom for light (flash, ring, motes floating up, `burn`); a full explosion for raw energy (flash, `smoke` `blend: add` billows, shockwave, debris, `crater` over a `burn`, smoke column).
  - *Sound*: `shimmer` or `charge` → `whoosh` or `crack` → `hum` (higher pitch for light, lower for raw energy) → `impact` or `boom` + `rumble` → a quiet `shimmer` or `sizzle`.
- **Psychic** (vocabulary "Psychic terms"): show force by its effects. Billboard `ring` ripples from the hand, a thin wavering link `beam` to the target, a `bubble` `orb` (`height_px` about 50) around the target with a turning `rune_circle` under it and debris floating up, then a crush: keyframe the bubble's `radius_px` down in under 0.2 s with an inward billboard ring, then `flash`, `sparks`, a ground `ring`, `cracks` and a shake. Shader intent: `ethereal` or `arcane` with high `distortion` and `fresnel`; sound `shimmer` → `whoosh` → high `hum` → `crash` + `impact`.
- **Earth** (vocabulary "Earth-specific terms"). Build it from weight and rhythm, not light:
  - *Ground pound / earth wave*: a gather (0.5–0.7 s: pebbles lifting, dust ring closing in, a dull fist `glow`, `rumble`), a 60–100 ms `hold` hang, a short slam (`impact` + `boom`, dust, `crater`, chunks, big shake), then an `eruption` at the `caster` (`arc_deg` 80–120, 4–6 `rows`, `growth` 1.3–1.45, `delay_growth` 1.1) with a matching `ring` (`arc_deg`, `ease: linear`, same radii) and a `fissures` decal (`arc_deg`, `reveal_ms` about the wave's length). Put the climax on the last row: a second, deeper `boom`, `sparks` `look: debris` and a dust plume at the target, the hardest shake. Footprint `arc` so the views frame the whole fan.
  - *Quake around the caster*: `destination: caster`, footprint `circle`; `eruption` `shape: slabs`, `arc_deg` 360, slow rise, long hold; fissures all round; pebbles bouncing everywhere (`sparks` `look: debris`, `emit_radius_px` the whole area); a long flickering shake.
  - *Spikes under a target*: a telegraph first (glowing `cracks` decal, add, pulsing; hopping pebbles; rumble, about 0.5 s), then `eruption` at the `target`, `arc_deg` 360, `start_radius_px` 0, `growth` 0.5–0.7 so the middle spike is tallest, a fast `rise_ms` (60–80), `crack` + `impact` + `boom`.
  - *Rockfall*: a warning (falling grit, a dark patch spreading on the ground), then `sparks` `look: debris` at `sky` with `emit_radius_px` and big `size_px`, born over 300–500 ms so the crashes come one after another, and one last big rock a beat later for the climax.
  - *Sound*: `rumble` (gather) → `whoosh` (swing) → `impact` + `boom` (slam) → `crash` with `repeat_ms` matching the row rhythm over a `rumble` → `boom` + `crash` (climax) → quiet `rumble`.
  - *Shader intent*: `stone` for rock (`technique: mesh`, voronoi noise, lit), `dusty` for dust and shock rings, `stone` decals for fissures and craters; a dull `molten` only for glowing cracks in a magical variant.

- **Water** (vocabulary "Water- and ice-specific terms"). Water is heavy and catches light rather than making it:
  - *Jet or cannon*: a `beam` with `style: water`. Light jets are 20–26 px; a heavy cannon is 40–60 px with strong `churn`, a long gather (a swelling `orb` plus an inward `ring`), a recoil `camera_shake` on release and a big crown splash (`sparks` `look: droplet`).
  - *Wave or surge*: a `wave` layer (`width_px` 300–500, `height_px` 120–200, `curl` 0.5–0.8), with droplet sparks and a `smoke` alpha spray cloud where it crashes, and a wide `puddle` decal that outlasts the spell.
  - *Ground*: `puddle` and `splash` decals (alpha), a darker wide wet patch under them.
  - *Sound*: `wind` (gather) → `whoosh` → `wind` or `rumble` (stream, surge) → `crash` or `impact` → `sizzle` at low gain, low pitch (fizz).
  - *Shader intent*: `liquid` for the body, `foamy` for spray and crests, `wet` for decals; streaks or fBm noise, `distortion` 0.4–0.6, `fresnel` 0.4–0.6, `lighting: lit`.
- **Ice**. Ice snaps into place and stays, so contrast fast motion with frozen holds:
  - *Freezing ray*: a `beam` with `style: ice` and a slow `flow_speed`, then `sparks` `look: shard` bursting out of the target and freezing there, a `frost` decal spreading with `grow_ms`, and a `shatter` cue as it breaks up in the tail.
  - *Blizzard or hail storm*: an area spell from `sky`. Two or three `sparks` `look: flake` layers with `emit_radius_px` sized to the danger zone, `wind_px` 80–200 so the snow slants, pale `smoke` for the whiteout, a `frost` decal growing over the area, and a `wind` cue. Telegraph it with a `warning_ring` like any area attack.
  - *Shader intent*: `crystalline` for shards and rays (Voronoi, hard edges, `fresnel` 0.6–0.9), `icy` for mist, flakes and frost (soft fBm, slow flow, pale emission).

- **Targeted area (splash)**: when the request is "hit one enemy and everyone round it", use `space.targets.layout: "splash"` (template format, Splash). Build it in two halves: the delivery and the big hit on the primary target (anchor `target`: charge, projectile or sky drop, flash, a ground `ring` sized to `targets.radius` × 100 px plus a little, a mark, shake), then the splash (anchor `splash`: a small flash, sparks and mark on each enemy, plus the thing that carries the hit to them: a fork `bolt`, a chain `from: "previous"`, a strike `from: "sky"`, an `orb` scatter, an `eruption` under each). Use `ripple_ms` 100–200 so it spreads outward with the shockwave, 0 for a synchronized slam, `order: "sequence"` for a ricochet. Thrown weapons are `orb` `look: weapon`. See [`templates/lightning/stormhammer-barrage.json`](../templates/lightning/stormhammer-barrage.json).
- **Point-blank area (PBAE)**: "blast everything round me" is the same splash layout with `destination: "caster"` (enemies ring the caster). Make it look better than a plain ring: a charge that pulls the area in (inward repeating `ring`, `sparks` with `gather_px`, a growing `glow` or `bubble` orb, a `light` at the caster), then a release that stacks layers: two ground rings a beat apart plus a billboard air ring, a big decal with `reveal_ms` (`fissures`/`cracks`, a `lava`/`glow`/`void` fill), an `eruption` at 360° with `growth` above 1 so outer rows are biggest, six-way lit `smoke` with `spread_speed`, and splash hits on every enemy timed by `ripple_ms`. For a pull-then-detonate, put a `vortex` at the caster spinning up by keyframe with `sparks` `home_to: "caster"` on the enemies. A ground-targeted spell is `destination: "point"` (see [`templates/poison/mire-splat.json`](../templates/poison/mire-splat.json)).

Know what the viewer draws today (see the known issues in [DESIGN.md](DESIGN.md#6-known-issues-and-limits)): several targets exist for chains (`travel: chain` or `destination: targets`) and splash layouts; otherwise a "storm of strikes across an area" renders as strikes on one spot. Projectile travel is drawn for an `orb` anchored at `caster_hand` in a `travel: projectile` spell. Prefer designs the viewer can show, and say in `director_notes` when you go beyond it.

Set `z` back to front: shadow/smoke/decal → glow → bolt/beam/vortex → sparks → flash. Decals always draw on the ground under everything else; their `z` only orders them among themselves (a glowing crack decal above its scorch). Use only params listed in the template format; unknown params produce warnings and the renderer may ignore them.

### Shader intent (every drawn layer)

The rendered frames are a timing and composition reference; the magic in a game comes from shaders. So give every drawn layer a `shader` object (vocabulary §11, template format "Shader intent"). Skip it only for `sound_cue` and `camera_shake`.

1. **Material first.** Pick the one word for what the layer is made of: lightning is `ionized`, a charged ball `plasma`, a water jet `liquid`, spray `foamy`, a scorch `ashen`, a glow `ethereal`, a rune `arcane`. Turn the user's feel words into it ("wet", "glassy", "molten", "smoky").
2. **Technique** from the layer type: `bolt`/`beam`/`crackle` → `ribbon`; `sparks`/`smoke` → `particles`; `decal` → `decal`; `glow`/`orb`/`ring`/`flash` → `procedural`; `motif` → `mesh`; `light` → `light`.
3. **Surface**: a noise type that matches the material (ridged for electricity, fBm for plasma and fire, Voronoi for foam, ice and cracks, curl for smoke, streaks for jets), a flow direction that matches the motion (`along_path` for bolts and beams, `outward` for rings and splashes, `upward` for smoke and fire), and only the extras that sell it: `distortion` for water, heat and shockwaves, `fresnel` for orbs, water and shields, `dissolve` for anything that should erode rather than fade.
4. **Emissive** from the weight words: `hdr` 2–3 for a glow, 4–6 for a strike, 7–10 for a boss flash. Lit materials (`wet`, `smoky`, `stone`, `dusty`) get `lighting: lit` and little or no emission.
5. **`look`**: one plain sentence a person could paint from. This is where the feel words go.

Keep the same material and noise family across a spell's layers so they read as one substance, and vary scale and HDR between core and support layers.

### Style (vocabulary §12)

Every spell works in every style (`stylized`, `realistic`, `toon`, `pixel`), so don't write separate "realistic" spells. If the user names a look ("realistic", "gritty", "anime", "cel-shaded", "retro", "pixel art"), set `style.preset` and put the feel in `style.notes`; otherwise leave `style` out (stylized). Where a layer should read differently in a style, add `shader.styles.<style>` with just the fields that change (usually a `look` sentence). For ground marks, think in 3D: is the ground carved (`depth`), and does anything sit in the cracks (`fill`: `lava` for fire and earth, `glow` for lightning, holy and arcane, `liquid` for water and blood, `void` for shadow and dark magic)?

### Sizes and weight

Sizes are in pixels at 100 px per world unit (1 unit = a character's height).

| Knob | light | medium | heavy / boss |
|---|---|---|---|
| `bolt.width_px` | 3–5 | 5–8 | 9–14 |
| `bolt.branch_depth` | 0–1 | 1–2 | 2–3 |
| `sparks.count` | 8–14 | 16–28 | 30–50 |
| `ring.end_radius_px` | 50–80 | 80–120 | 140–220 |
| `camera_shake.amplitude_px` | 0–3 | 4–8 | 10–16 |
| `space.scale` | 2–3 | 3–4.5 | 4.5–7 |

### Readability (thin, fast or sustained spells)

When a spell's look could be unclear at gameplay distance (a thin jet or beam, a fast hit, a faint cone), add a `readability` block: the `reference_distance` it is judged at (usually the reach), two or three `must_read` cues with the layers that carry them, and `key_frames` for the moments that set the quality target (ignition, first contact, shutdown). Give layers whose movement matters an explicit `tracking`: `follow` for what rides on an actor, `trail` for embers and smoke that should stream off a moving one, `stay` for marks left where they landed. Then run `python tools/range_guide.py <id>`: a must-read cue that falls under 3 px at 12 units is a sign to thicken it or give it a brighter, wider glow. See [template-format.md](template-format.md#readability).

## Step 5. Palette

Fill `core` and `primary`, and usually `secondary`. Add `accent` only for a contrasting spark color, and `shadow` only if something dark is drawn (smoke, scorch, sky-dim). Electricity is additive with a near-white core. Fire is a temperature ramp: `core` white-yellow, `primary` orange, `secondary` deep red, `accent` gold for embers, `shadow` a warm near-black for smoke and scorch. Earth is muted: `primary` the rock (a mid brown or grey), `secondary` a lighter dust tan, `core` a pale sunlit dust for pops, `accent` only for a dull glow in the fist or cracks, `shadow` near-black for fissures and craters; no bright, saturated colors unless it is magical earth. Water is mid-blue (`primary`) over a deep blue (`secondary`) with white only for foam (`core`), so it reads as water on any background. Ice is paler and cooler than water: a white `core`, pale cyan `primary`, a steel-blue `secondary`; keep saturated blue out of it or it reads as water. Colors should be original choices, not sampled from a game.

## Step 6. Views

Set `views.hero` from the camera answer. Then write `views.reads` for **all four** views, using the plane rules in vocabulary §7: what does the player see, and what tells the story when the core shape collapses (a vertical bolt from the top, a beam aimed at the camera from the front)?

## Step 7. Variation, notes and source

- Use `{min, max}` ranges for anything that should differ per cast: bolt path params, branch chance, spark count, shake strength. Keep timing fixed unless the user asked for variety; gameplay hit frames depend on it.
- `variation.notes`: what changes per cast and what must stay fixed.
- `director_notes`: the two or three choices that matter most for the feel, and why, plus the user's answers to your questions. This is what a later revision reads first.
- `source`: `{"kind": "director_text", "prompt": "<the user's words>"}` or `{"kind": "director_gif", "reference": "<file name>"}`.
- `id`: kebab-case, `<element>-<short-name>`, unique in the library.

## Step 8. Validate, save, preview

1. `validate_template` with the template. Fix every error; fix warnings unless you are deliberately trying a new param (say so in `director_notes`).
2. `save_template`. It validates again, writes `templates/<element>/<id>.json` and rebuilds `templates/index.json`. It refuses to replace an existing template unless you pass `overwrite: true`, which you should only do when revising that template on purpose.
3. Give the user the preview URL from the result (`http://localhost:47811/?template=<id>&view=<hero>`, with the viewer running via `run.sh`, `run.bat`, `python tools/serve.py` or the app; the result's URL already points at a running viewer's port when there is one, and the app's `--mcp` mode serves the viewer itself) and a two-line summary: what you made and the choices you took.
4. Offer one revision round in plain words ("heavier hit?", "fewer forks?"). Revise the same template id with `overwrite: true`.
5. When the user wants the spell in their game, call `export_sprites` (or point them at **Export sprites…** in the viewer) and give them the guide path; pass `style` when their game has a look (`realistic`, `toon`, `pixel`). It makes a sheet per layer with the four views as rows, a JSON file and a guide for Unity and Godot ([exporting.md](exporting.md)). To show or share a spell, `export_gif` makes looping GIFs of the views they pick (`front`, `side`, `top`, `three_quarter`, `quad` for all four in one).

More examples: [`templates/light/sunlance.json`](../templates/light/sunlance.json) (a long sunlight gather and a steady lance of light with two spirals), [`templates/energy/annihilator-beam.json`](../templates/energy/annihilator-beam.json) (an all-out beam with recoil, an explosion and a recharge) and [`templates/psychic/mind-crush.json`](../templates/psychic/mind-crush.json) (warping ripples, a held bubble, a crush).

## Library mode (no request)

When asked to grow the library ("make 5 lightning templates"), act as both user and director:

1. `list_templates` to see what exists. Aim for spread: different archetypes, weights, hero views and moods. Don't make two templates that differ only in numbers.
2. For each, write a one-line imaginary request first ("snappy chain shock for a side-scroller"), and put it in `source.prompt` with `kind: director_text`.
3. Answer your own Step 2 questions, varying the answers across the batch, and record them in `director_notes`.
4. Validate and save each. Report the list with one line per template.

## Worked example

Request: *"heavy boss lightning, top-down game"*.

- Read: element lightning; weight heavy/boss; camera top-down → hero `top`. Archetype unknown → one question.
- Questions asked: *"Should players get a clear warning before it lands (fairer, about 0.65 s), or should it hit almost instantly (punishing)?"* (user: clear warning). Camera and weight were already answered, so that's the only question.
- Timeline (1800 ms): `charge` anticipation 0–650 `ease_in`; `strike` release 650–740 `spike` with a held frame; `barrage` impact 740–1150 `flicker` 12 Hz with 3 restrikes; `aftermath` dissipation 1100–1800 `ease_out`.
- Layers: sky-dim flash, wide warning ring with static crackle, thick main bolt (deep forks, restrikes) plus a thin regenerating side strand, glow, screen flash, big shockwave ring, radial sparks, large scorch decal, lingering crackle, smoke, heavy shake, light, sound cues.
- Views: top is the hero, so the ground story (warning ring, static, shockwave, scorch, radial sparks) carries it; front and side show the tall bolt; 3/4 shows both.

The result is [`templates/lightning/boss-storm-call.json`](../templates/lightning/boss-storm-call.json).

A one-word request, *"meteor"*, became [`templates/fire/meteor-strike.json`](../templates/fire/meteor-strike.json): strike archetype with a 1.15 s warning circle and closing ring, a burning rock falling at an angle with a flame and smoke trail, then flash, fireball, shockwave, dust wave, glowing debris and a smoking crater, scored rumble → wind + fire + whoosh → boom + crash → quiet fire.

An earth example: *"an earth ground pound that grows outward in an arc, ejecting earth upward with increasing effect"* became [`templates/earth/ground-pound.json`](../templates/earth/ground-pound.json): nova archetype, a 0.6 s gather and 80 ms hang, a hard slam, five rows of spikes across a 100° arc each 1.4× bigger and 10% later, a linear dust arc and fissures spreading with the front, a climax at the far end, then the rocks crumble.

A fire example: *"a dragon-style fire breath"* became [`templates/fire/dragon-breath.json`](../templates/fire/dragon-breath.json): beam archetype, a 0.5 s inhale (growing fire in the mouth, contracting ring, smoke wisps, wind), an ignite flare, a widening fire cone that sweeps across the target, flame billows and embers on impact, a burning swath that cools to a long scorch, and wind → ignite + whoosh → fire → quiet fire for sound.

A wind example: *"tornado (wind)"* became [`templates/wind/tornado.json`](../templates/wind/tornado.json): a 0.7 s gather (a low swirl, dust and leaves circling), a funnel that snaps up and spins up with a whoosh, walks to the target with a weave, grinds over it with debris and leaves orbiting and a spiral scoured into the ground, then ropes out and flings its debris; wind → whoosh → roaring wind + rumble → dying wind.
