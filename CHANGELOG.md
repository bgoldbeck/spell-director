# Changelog

All notable changes to SpellDirector are listed here. The version lives in [`VERSION`](VERSION) and follows [Semantic Versioning](https://semver.org/). While the version starts with `0.`, a minor bump (0.1 → 0.2) may include breaking changes.

To release, see [docs/releasing.md](docs/releasing.md).

## [Unreleased]

## [0.2.0] - 2026-11-15

### Added

- Windows app: each release now has a `SpellDirector-<version>-windows.exe` to download. Double-click it to open the viewer in your browser, with no Python needed. Built with `tools/build_exe.py`; `tools/release.py` builds it and attaches it to the release.
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
