# Changelog

All notable changes to SpellDirector are listed here. The version lives in [`VERSION`](VERSION) and follows [Semantic Versioning](https://semver.org/). While the version starts with `0.`, a minor bump (0.1 → 0.2) may include breaking changes.

To release, see [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Changed

- Spells look much better in the viewer: bloom makes bright light glow, bolts, beams and crackle are drawn as soft ribbons instead of stacked tubes, sparks fly as streaks, and shockwave rings are soft with a bright leading edge. A **Bloom** checkbox (B) turns the glow off.
- Arcs that ride on a beam (Charge and Discharge) now hug the beam instead of flailing across the screen.
- The viewer's ground is a little lighter so dark marks like scorch show up.
- Sprite exports bake in the same bloom glow (untick **Bake bloom** or use `--no-bloom` if your engine adds its own).

### Added

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
