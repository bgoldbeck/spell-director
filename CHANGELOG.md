# Changelog

All notable changes to SpellDirector are listed here. The version lives in [`VERSION`](VERSION) and follows [Semantic Versioning](https://semver.org/). While the version starts with `0.`, a minor bump (0.1 → 0.2) may include breaking changes.

To release, see [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Changed

- Viewer: sound is off by default. Turn it on with the Sound button or M; the viewer remembers your choice.
- Viewer: the camera view you pick (Front, Side, Top, 3/4 or All four) stays put when you switch spells and is remembered next time. Until you pick one, each spell opens in its hero view.

### Added

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
