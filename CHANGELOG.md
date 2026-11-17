# Changelog

All notable changes to SpellDirector are listed here. The version lives in [`VERSION`](VERSION) and follows [Semantic Versioning](https://semver.org/). While the version starts with `0.`, a minor bump (0.1 → 0.2) may include breaking changes.

To release, see [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Three new holy spells in the Light type and the Paladin line: **Sanctified Bolt** (a fast bolt of holy light with a long radiant tail that bursts in a halo on the target), **Radiant Verdict** (a pillar of light called straight down from the sky onto the target after a ring of holy script marks the spot) and **Aegis of Dawn** (a shield made only of holy light, held up in the caster's hand with a bright rim, strong bloom and sunrays; it loops for as long as it is held).
- Beams anchored in the sky come straight down onto the target, orbs take `squash` (flatten a bubble into a lens-shaped shield) and rings take `steady` (a held rim that doesn't roll out).

## [0.11.2] - 2026-11-17

### Fixed

- The Windows app keeps your spells and exports in a folder that works for whoever runs it: `SpellDirector Library` next to the exe as before, or `SpellDirector Library` in your own Documents folder when the exe sits somewhere it can't write (such as Program Files or a read-only share). No path from the computer the app was built on is ever used.

## [0.11.1] - 2026-11-16

### Fixed

- **Export GIF** keeps the whole spell in frame in every view: each camera widens (never zooms in) to fit everything the spell draws over the whole GIF, such as a tall tornado, smoke rising from a meteor or a long beam. Stray wisps of smoke far from the spell are ignored, so the spell doesn't shrink to a speck.

## [0.11.0] - 2026-11-16

### Added

- **Export GIF…**: the viewer saves the spell as looping animated GIFs, exactly as it looks on screen (set, stand-ins, bloom, art style, camera shake and screen flashes). Pick any of Front, Side, Top, 3/4 and All four (the four views in one GIF), or tick All; several views download as a .zip. Choose the size, frame rate, slow motion and style. Auras record their seamless sustain loop by default, so the GIF holds forever with no seam. Also `tools/export_gif.py` and the director's `export_gif` tool; works in the Windows app through Edge or Chrome. Press G to open it.

## [0.10.0] - 2026-11-16

### Added

- **Six-way lit smoke**: smoke can be lit by the scene from any direction. The viewer bakes six-way lightmaps (pre-lit from right, left, top, bottom, back and front) and relights every puff from the stage lights and the spell's own lights, so smoke goes dark underneath, takes the color of the light beside it and glows at the edges when backlit. Templates ask for it with shader intent `lighting: "six_way"`; the Realistic style now does it for all alpha smoke. Exports include the two packed maps per smoke layer and Unity (VFX Graph Six-way Smoke Lit) and Godot steps.
- **Light placement**: `light` layers take `height_px`, `forward_px`, `side_px`, `orbit_hz` (circle the anchor) and `tint` (any color, for neon or rim lights).
- **Neon Campfire**: a test piece for six-way smoke, a campfire whose smoke column is lit in turn by neon lights from all six directions, then by three lights circling it.
- Smoke layers can have up to 64 puffs (was 32).

## [0.9.0] - 2026-11-16

### Added

- **Auras**: persistent effects around a character that start up, hold a **seamless loop** for as long as they last, then end. A template marks its loop with `timing.loop_range`; the viewer holds the loop while **Loop** is ticked (untick it to see the end) and shows the loop on the timeline, and every aura is listed under **Type → Kinds → Auras** whatever its element or line. Pulses, spins, flicker and particles in looping layers repeat exactly every loop.
- Exports of an aura mark the loop: the frames and each layer's loop columns in the JSON, an **Aura loop** section in the guide with Unity and Godot steps, and intro / loop / outro sections in the sound sheet.
- Six auras and two new spell lines: **Paladin** (Consecrated Aegis, a holy field), **Druid** (Verdant Bloom, a healing grove with mushrooms and leaves, as a new **Nature** type), **Bard** (Cadence of Valor, music notes and beat rings), **Sorcerer** (Pyre Ward, an area-of-effect flame damage aura, and Rime Mantle, a frost aura) and **Necromancer** (Grave Miasma, a necrotic aura).
- Viewer: sparks `orbit_hz` (particles that circle the caster) and `look: note` (music notes), rings that repeat (`repeat_ms`, `count`), eruption `shape: mushrooms`, rune circles with `symmetry`, orb `opacity`, and sustained sound cues with `repeat_ms`.

## [0.8.0] - 2026-11-16

### Added

- **Art styles**: every spell can now be drawn **Stylized** (the old look), **Realistic**, **Toon** or **Pixel art** from the new **Style** menu (or `S`, or `?style=`). Realistic gives ground marks real depth (cracks and craters you can see into, lit walls), filmic color and softer bloom; Toon gives flat color bands and ink outlines; Pixel art gives chunky pixels. Exports take a style too: the guide gets whole-effect and per-layer Unity and Godot steps for it (parallax depth decals, flow-mapped lava, lit smoke, cel ramps and outlines, pixel-perfect flipbooks), and the sheets show it.
- Ground marks can hold a **fill**: `lava` that flows along the cracks and crusts over as it cools, `glow`, `liquid` (water, blood) or `void`. Meteor Strike's cracks now fill with lava. Decals with depth or a fill export a height map, an emissive mask and a flow map for engine shaders.
- The blood, shadow, poison and bard curse spells now use the new sounds: heartbeat and squelch for Crimson Nova and Hemorrhage Curse, a life-drain inhale and heartbeat for Sanguine Siphon, dark drones and whispers for Bone Tempest, Umbral Grasp and Sorrow Dirge, an inward drain before Void Collapse, and a wet squelch for Pestilence Field. Sound prompts for shadow and bard spells get their own flavor words.
- **Spell lines.** A template can name the class, school or skill line it belongs to (`line`), and the viewer's Type list now also groups spells by line.
- Spells from the spells01 set, in its palettes: **Bard** (Rallying Anthem, Sorrow Dirge, Lingering Refrain, as a new **Sound** type), **Sorcerer** (Meteor Storm: seven meteors scattered over a field), **Cabalist** (Pestilence Field) and **Necromancer** (Bone Tempest: an icy whirlwind of bones and spirits).
- A **Blood** type and **Vampire** line: Sanguine Siphon (blood drained back into the caster's hand), Crimson Nova, Nightwing Swarm (a bat swarm) and Hemorrhage Curse.
- A **Warlock** line of dark shadow magic: Umbral Grasp (shadow claws and a chain) and Void Collapse (an implosion).
- Viewer: sparks `look: bat` and `look: bone`, sparks `home_to` (particles that fly to an anchor, for drains and swarms), falling orbs. `scatter_px`, and sparks and decals that `attach_to` a falling orb appear where it lands.
- One-click setup for the AI director: on the Help page, **Connect** adds SpellDirector to Claude Desktop, Claude Code or Codex (the ChatGPT desktop app, Codex CLI and VS Code extension), keeping your other settings and a backup. The app does the same with `--setup` (`--setup --status` shows what's connected).
- When you start a newer version of the app, it switches the AI apps that were connected to the old one over to itself, so updating is: download into the same folder, double-click, restart the AI app.
- A step-by-step setup guide for people who just downloaded the app ([docs/setup.md](docs/setup.md)), with prompts to paste into Claude Code or Codex (they run the setup) or into ChatGPT or Claude on the web (they walk you through it), an honest note on what works with ChatGPT, a way to use any AI chat without a connection, and troubleshooting. The Help page has the same prompts with your app's real path filled in, and every release's notes now end with a short "New here?" section.
- **Sound in exports.** Every sprite export now has the spell's sounds too: `<id>.preview.wav` (the whole spell's mix, a timing reference), one `sound-<cue>.wav` per cue, and `<id>.sounds.json`, a cue sheet with every sound's time, frame, beat, role, volume and pitch. The guide has a new **Sound** section: a beat-by-beat summary, what each sound should be (texture, pitch, envelope, layers, tail), a ready text-to-SFX prompt with duration and loop settings, a synthesis recipe, library search terms, a copy-paste prompt for Claude or GPT, and Unity/Godot steps.
- **Sound design vocabulary** ([docs/sound-design.md](docs/sound-design.md)): sound roles per phase, how to stack a hit, words for texture, pitch, envelope and space, element flavors, timing and level rules, and how to make the real sounds with a text-to-SFX generator, an AI-written synthesizer or a sound library.
- Eight new sound cues: `splash`, `stream` and `freeze` for water and ice, and `squelch`, `heartbeat`, `whisper`, `drain` and `drone` for blood and dark magic. The water and ice spells now use them.

### Changed

- Better placeholder sounds in the viewer: a shared reverb and compressor, pink and brown noise for rumbles, fire, wind and water, a slight stereo spread, and richer cracks, booms, buzzes and charges.

## [0.7.0] - 2026-11-16

### Added

- The Windows app is now the director's MCP server too: point Claude Desktop, Claude Code or another MCP client at `SpellDirector-v<version>-windows.exe --mcp`, with no Python or source folder needed. The spells it saves, its sprite exports and GIF breakdowns go to a **SpellDirector Library** folder next to the app (or `--library <folder>`), the app's viewer shows those spells next to the built-in ones, and the director serves the viewer in the background so its preview links open straight away. Sprite export from the app uses an installed Edge or Chrome. The Help page shows the settings to copy.

## [0.6.0] - 2026-11-15

### Added

- Two more **Water** spells: **Torrent Cannon** (a heavy, slow water cannon: a swelling sphere, a thick pounding torrent with recoil and a towering splash) and **Tidal Surge** (water wells up at the caster's feet, heaves into a curling wall that rolls across the ground and crashes over the target). Pressure Jet stays the quick, light water jet.
- An **Ice** spell type: **Rime Ray** (a glassy freezing ray; ice crystals spike out of the target, frost spreads on the ground, then the crystals shatter) and **Whiteout Gale** (a telegraphed boss blizzard: driving, wind-slanted snow over the whole area, whiteout and frost cover).
- The viewer draws waves and ice: a new `wave` layer (a curling wall of water with a foamy crest and spray that rolls to the target and crashes), beam `style: ice`, and sparks that look like snowflakes (`look: flake`, falling at a steady speed) or ice crystals that freeze in place (`look: shard`). Sparks can drift in the wind (`wind_px`).
- The director's playbook and vocabulary cover water and ice: cannons, waves, freezing rays, blizzards, frost and their sounds and shaders.
- A **Wind** spell type, starting with **Tornado**: wind gathers into a dusty swirl in front of the caster, snaps up into a towering funnel that spins up with a roar, weaves across to the target, grinds over it with debris and leaves whirling around it, then ropes out and flings everything it carried, leaving a spiral of scoured ground. Wind, whoosh and rumble sounds.
- The viewer draws vortices: a new `vortex` layer is a spinning funnel (narrow foot, flared top, spiral wind streaks, a turning cloud cap) that can form short of its target and walk to it, and ropes out by breaking into streaks. Sparks and smoke attached to a vortex orbit it (debris, leaves, a dust skirt) and are flung off when it dies. Sparks have `debris` and `leaf` looks, and there is a `swirl` ground decal. Shader intent has an `airy` material.
- The director's playbook and vocabulary cover wind.
- Three new spell types with a template each: **Light: Sunlance** (motes of sunlight spiral into the caster's hand during a long wind-up, then a thick lance of light wound with two spiralling threads blooms on the target), **Energy: Annihilator Beam** (an all-out beam wider than a body with recoil on the caster, an explosion and crater at the target, and a recharge where the caster is spent) and **Psychic: Mind Crush** (ripples of warped space, a link that seizes the target in a bubble of force while debris floats up, then the bubble collapses and crushes it).
- The viewer can draw gathering particles (sparks `gather_px`, `swirl`), spiralling strands around any beam (`spiral_count` and friends), rings that stand upright across the cast direction or face the camera (`plane: vertical` / `billboard`), and hollow force-field bubbles that float around a target (orb `bubble`, `height_px`).
- The director's playbook and vocabulary cover big charged beams (gather, recoil, recharge) and psychic effects (warp, hold, lift, crush).
- **Gale Shove** (wind): a quick draw-in, then a wide cone of rushing wind with gust lines that kicks up a dust wave, leaves and grit at the target and sweeps the ground into streaks. The viewer draws beam `style: wind` (`line_count`, `line_length`) and a `swept` decal.
- **Scythe Volley** (wind): the caster gathers the air into a blade and flings three crescents of wind in quick succession, two curving in from the sides and one straight down the middle; they slice the target with glints, chips and leaves and leave crossing cuts in the ground. The viewer draws orb `look: crescent` (`crescent_deg`, `tilt_deg`), flying orbs take `side_offset_px`, and there is a `slash` decal.
- **Maelstrom** (wind): a boss-scale storm. Clouds gather over the target under a spinning warning ring, lightning cracks down as it touches down, and a broad eyewall around a calm eye turns inside an even wider outer band while rain, debris and leaves whip round it. Then it collapses, flings everything outward and leaves a vast scoured spiral.
- A **Fire** spell type, starting with **Dragon Breath**: a creature draws a deep breath while fire builds in its mouth, then pours out a roaring cone of flame that sweeps across the target, splashes into billows and embers, and leaves a burning swath that cools to a long black scorch, with wind, ignite, whoosh and fire sounds.
- The viewer draws fire: beam `style: fire` is a widening flame cone (`spread`) with licking, noise-torn edges that run white-yellow to orange to red, billowing flame puffs riding the stream (`puff_count`, `puff_size_px`) and embers floating off it. Any beam can sweep across its target (`sweep_px`, `sweep_ms`). Sparks have an `ember` look (glowing flecks that flutter and flicker as they float up) and smoke with `blend: add` glows like rolling flame.
- **Meteor Strike** (Fire): a warning circle opens on the ground, a burning rock tears down out of the sky at an angle trailing fire and smoke, and slams into the target with a blinding flash, a fireball, a shockwave, flying rock, a rolling dust wave and a smoking crater with glowing cracks, with rumble, rushing wind, boom and crash sounds.
- The viewer can drop things from the sky: an orb anchored at `sky` in a projectile spell falls onto the target at an angle (`approach_deg`, `approach_yaw_deg`), and orb `look: meteor` draws a burning rock with a flame trail and a smoke trail that hangs in the air. Sparks have a `debris` look (rock chunks that tumble, land and stay, optionally starting hot with `glow`), and smoke can roll outward along the ground (`spread_speed`) for dust waves.
- An **Earth** spell type with four spells. **Ground Pound**: the caster gathers strength as pebbles lift, hangs for a beat and slams the ground; a quake runs out in a frontal arc, splitting the earth and bursting rock spikes up row after row, each row bigger and a little later than the last, ending in a huge eruption before everything crumbles. **Rending Quake**: a stomp that tears fissures in every direction and heaves the ground around the caster up in rings of broken slabs under a long, heavy shake. **Rockfall**: grit trickles down and a dark patch spreads, then boulders tumble onto the target one after another, and a last huge one lands on top. **Stone Spires**: glowing cracks warn, then a crown of sharp stone pillars stabs up under the target and crumbles.
- The viewer draws earth: a new `eruption` layer bursts lit rock spikes or slabs out of the ground in rows along an arc or a full circle, growing (or shrinking) row by row, throwing chunks and dust, then crumbling. Rings can be a frontal arc (`arc_deg`) that keeps pace with an eruption (`ease: linear`). Decals can be cut to an arc (`arc_deg`) and spread out from their centre (`reveal_ms`), with a new `fissures` shape. Sparks can start anywhere on a disc around their anchor (`emit_radius_px`), for rocks raining over an area. The views frame wide arcs and spells centred on the caster.
- Five new spells. Fire: **Flame Jet** (a tight, fast jet of flame from the hand at one target), **Inferno Burst** (a gathered fireball lobbed at the target that bursts into a star of flame spokes, a shockwave and a rayed scorch) and **Ember Volley** (three small embers flicked in quick succession on three arcs, each popping on the target). Lightning: **Volt Lash** (static builds over the caster's whole body, then a thick yellow bolt lashes from the hand into the target and re-strikes twice) and **Thunderhead** (a storm cloud boils up over the target and flickers, then a massive bolt drops out of it with a delayed thunderclap and a burst of rain).
- Smoke takes `spread_px` (how widely its puffs are scattered, for clouds and smoke banks) and a negative `rise_speed` to sink.
- A bolt thrown from the caster's hand at a single target now lands on the target's chest instead of its feet.
- The director's playbook and vocabulary cover fire: temperature-ramp palettes, slower flicker, breath, fireball and explosion recipes, burning ground, embers, heat haze and the fire sound score.
- The playbook and vocabulary cover earth: weight through timing (gather, hang, slam), escalating staggered eruptions, quakes, spikes, rockfall, debris and dust, muted palettes and the earth sound score.

### Fixed

- Sprite export no longer drops dark layers (soot, fissures, dark smoke) or crops them out of the frame: it now looks for layers against a grey background instead of black.

## [0.5.0] - 2026-11-15

### Changed

- Spells look much better in the viewer: bloom makes bright light glow, bolts, beams and crackle are drawn as soft ribbons instead of stacked tubes, sparks fly as streaks, and shockwave rings are soft with a bright leading edge. A **Bloom** checkbox (B) turns the glow off.
- Arcs that ride on a beam (Charge and Discharge) now hug the beam instead of flailing across the screen.
- The viewer's ground is a little lighter so dark marks like scorch show up.
- Pressure Jet looks like water now, not a blue laser: a turbulent, foamy jet that churns and sheds drops, round water droplets instead of sparks, a crown splash with foam, and wet marks on the ground. Smoke and mist use soft, rolling clouds. New template params: beam `style: water` (with `flow_speed`, `turbulence`, `foam`, `churn`, `shed_*`) and sparks `look: droplet`.
- Sprite exports bake in the same bloom glow (untick **Bake bloom** or use `--no-bloom` if your engine adds its own).

### Added

- Sprite export guides now give a step-by-step build order, one layer at a time: the hero layer first, then glows and rings, particles, decals, and finally lights, flashes, shake, sound and a timing pass. After each step the reader (a person, Claude or GPT) checks that layer against its cells before adding the next. The JSON has it as `build_order`.
- Shader intent: every drawn layer can say what it's made of and how its surface behaves (material such as ionized, plasma, liquid, foamy or molten; noise, flow, distortion, fresnel, dissolve, emissive HDR, lighting, and a one-line look), so a game rebuilds the magic with shaders instead of copying pixels. The vocabulary explains the terms, the director fills them in, and all six templates have them. Sprite exports now open with a "How to use this export" note (the sheets are a timing and composition reference, not literal instructions for a person or an AI) and give each layer its shader intent with short Unity and Godot recipes, in the guide and the JSON.
- Decals are first-class: marks on the ground in nine shapes (scorch, burn, cracks, crater, puddle, splash, frost, rune circle, warning ring) with fade in, a lifetime that can outlast the spell, fade out, growing, rotation, spinning, pulsing and a fresh angle each cast. They are drawn flat on the ground under everything standing there.
- Sprite export: each decal also comes out as a top-down texture (`decal-<id>.png`) with its timing and per-frame opacity, scale and rotation curves, and the guide explains how to set it up with Unity's Decal Projector and Godot's Decal node.
- Every template now uses decals: a pulsing warning circle before the Boss Storm Call lands and a crater with glowing cracks after it, a spinning rune circle under Charge and Discharge, glowing cracks that cool into scorch marks for Sky Strike, Ball Lightning and each Chain Arc target, and a spreading puddle with splashes for Pressure Jet. The director's playbook says when to use which.
- A **Getting started** page for new users, opened from **? Help** in the viewer (or the `?` key), with a one-time hint on first launch. It explains that SpellDirector is mostly driven by an AI director: how to connect the director's MCP server to Claude Code or another client, example prompts and the questions the director asks, then a tour of the viewer, the keys, and the sprite sheet export layout. Works in the Windows app too.
- Projectiles fly: in a `travel: projectile` spell, an orb in the caster's hand flies to the target during its travel beat with a streak behind it, optionally lobbed (`trail_ms`, `arc_height_px`, `travel_ease`). New **Ball Lightning** template shows it off.

## [0.4.0] - 2026-11-15

### Changed

- Only one SpellDirector runs at a time. Launching it again (run.bat, run.sh, `tools/serve.py` or the exe) opens your browser on the copy that's already running instead of starting a second server. `--new-instance` overrides this.

### Added

- **Analyze GIF/MP4…** in the viewer opens a new page where you drop a reference GIF or video (optionally trimmed with Start/End) and see its breakdown: the clip playing frame by frame beside a timeline of camera shots, phases, intensity, coverage, motion and peaks, plus palette swatches with suggested slots, footprint and view hints. You can save the breakdown as a .zip or copy a prompt that asks the director to build a template from it. Works in the exe too, which now bundles numpy, Pillow and PyAV (so it is larger).
- `tools/breakdown.py --start/--end` (and the director's `breakdown_gif`) now trim GIFs as well as videos.
- AI models can check exported sprite sheets cell by cell: each export guide has a section explaining the grid (which column is which frame, which row is which view) with a worked example, and `tools/sheet_cells.py` (also the director's `look_at_sprite_sheet` tool) crops a single cell, one frame across every view and layer, or a labeled contact sheet, and can write `*_labeled.png` copies with gridlines and frame/view labels.
- The viewer shows the app version next to the SpellDirector title (also in the browser tab), read from `VERSION`. The server reports it at `/version.json`.

## [0.3.0] - 2026-11-15

### Changed

- Viewer: sound is off by default. Turn it on with the Sound button or M; the viewer remembers your choice.
- Viewer: the camera view you pick (Front, Side, Top, 3/4 or All four) stays put when you switch spells and is remembered next time. Until you pick one, each spell opens in its hero view.

### Added

- Sprite sheet export for game engines: **Export sprites…** in the viewer (or `tools/export_sprites.py`, or the director's `export_sprites` tool) makes one sheet per layer plus one for the whole spell, with frames as columns and the four views as rows, all lined up cell for cell. It comes with a JSON file and an assembly guide (.md) listing every layer's timing, blend mode and colors, the beats, sound cues, screen flashes and camera shake, and steps for Unity and Godot. See `docs/exporting.md`.
- Update scripts (`update.bat`, `update.sh`): one double-click brings your checkout up to date with `main`, stopping safely if you have uncommitted changes, and refreshes Python packages when they changed.
- Water: the first water template, **Pressure Jet**. A wobbling water ball fires a rippling blue jet that travels to the target, bursts into a splash fountain with mist and ripples, and leaves a puddle. Directed from a real reference GIF and improved on it, not copied.
- Templates: beams take `grow_ms` (how long the jet takes to reach the target), sparks take `emit_ms` (keep spraying instead of one burst), and decals have a `puddle` shape.

### Fixed

- Breakdown on real game footage: camera cuts are detected and each shot gets its own background, so a cut no longer reads as effect. Idle animation, dithering and bright skies no longer leave a baseline glow in every frame. Footprint, travel and view guess come from the shot with the strongest effect, and each shot reports where the effect starts. The contact sheet and curves mark cuts. GIF and MP4 versions of the same clip now give the same result.

## [0.2.0] - 2026-11-15

### Added

- Windows app: each release now has a `SpellDirector-v<version>-windows.exe` to download. Double-click it to open the viewer in your browser, with no Python needed. Built with `tools/build_exe.py`; `tools/release.py` builds it and attaches it to the release.
- Sound: the viewer plays each template's sound cues in sync with the beats, with a Sound on/off toggle (M). Seventeen generic cues (charge, hum, buzz, crackle, sizzle, zap, crack, boom, rumble, impact, crash, shatter, ignite, fire, whoosh, wind, shimmer) have procedural placeholder sounds that real samples can replace per cue. The director knows the cue vocabulary (`get_sound_cues`).
- Viewer: spells are organized by type, with Type and Spell dropdowns, Prev/Next buttons and `[` / `]` keys to step through a type, and a `?type=` URL parameter. The URL follows the spell you pick.

### Fixed

- Viewer: an unknown `?template=` id now shows an error instead of silently opening the first template.

## [0.1.0] - 2026-11-15

First versioned release.

### Added

- Director vocabulary, template format (schema 0.1.0), validator, and lightning templates: sky strike, chain arc, charge and discharge, boss storm call.
- GIF breakdown tool and playbook: timing, phases, palette, footprint and view hints from a reference GIF.
- MP4 and other video formats accepted by the breakdown tool.
- Three.js motion-study viewer with front, side, top and 3/4 views.
- One-step launch scripts (`run.bat`, `run.sh`); the viewer serves on port 47811.
- The director: playbook and MCP server (`python -m director.mcp_server`).
- Versioning: a `VERSION` file, this changelog, and `tools/release.py`, which publishes a GitHub Release from them.
