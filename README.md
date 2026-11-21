# SpellDirector

An AI "director" for game spell effects. You describe a spell loosely ("heavy boss lightning") or show it a reference GIF, and the director turns that into a precise **template**: phases, timing, layers, palette and variation ranges. A renderer then turns template + seed into frames for any game, from four standard cameras: front, side, top and 3/4.

You don't need to know VFX terminology. The director does, and it offers you concrete choices in plain words.

## Quick start (Windows, no Python)

1. Download `SpellDirector-v<version>-windows.exe` from the [latest release](https://github.com/bgoldbeck/spell-director/releases/latest), put it in its own folder and double-click it. The viewer opens in your browser.
2. Click **? Help**, then **Connect** next to Claude Desktop, Claude Code or Codex (the ChatGPT desktop app). Restart that app.
3. Ask it: *"List the SpellDirector spells."* Then: *"Direct a spell: a quick chain shock that jumps between three enemies."*

Step by step, with prompts to paste into ChatGPT or Claude if you'd like an AI to walk you through it, what works with ChatGPT, updating, and troubleshooting: **[docs/setup.md](docs/setup.md)**.

## Plan

Full design: [docs/DESIGN.md](docs/DESIGN.md). What's next: [docs/ROADMAP.md](docs/ROADMAP.md).

1. **Vocabulary and template format** (done): the director's language, the template schema, and hand-written lightning templates.
2. **GIF breakdown** (done): a tool that extracts frames, timing, colors and a brightness curve from a GIF, plus a playbook the AI follows to turn that into a template.
3. **Director** (MCP server + playbook done): text or GIF in, a few guided choices, template out. Also generates templates on its own to grow the library.
4. **Builder and preview** (viewer done): renders templates in front, side, top and 3/4 views, side by side with the source GIF, and exports for game engines.

## Versions

The current version is in [`VERSION`](VERSION); what changed is in [`CHANGELOG.md`](CHANGELOG.md). Each version gets a [GitHub Release](https://github.com/bgoldbeck/spell-director/releases) with a Windows app: download `SpellDirector-v<version>-windows.exe` and double-click it to open the viewer, no Python needed. How to cut one: [docs/releasing.md](docs/releasing.md).

## Repository layout

| Path | What |
|---|---|
| [`docs/setup.md`](docs/setup.md), [`tools/client_setup.py`](tools/client_setup.py) | Setting up the Windows app and connecting it to Claude Desktop, Claude Code or Codex (`exe --setup`, the Help page's Connect buttons). |
| [`docs/sound-design.md`](docs/sound-design.md) | Sound vocabulary: sound roles per phase, words for texture, pitch and envelope, timing and levels, and how to make real sounds (text-to-SFX prompts, AI-written synths, libraries). |
| [`docs/vocabulary.md`](docs/vocabulary.md) | Terms the director uses: phases, timing, shape, color, layers, space, lightning terms. |
| [`docs/template-format.md`](docs/template-format.md) | The template format, field by field. |
| [`schemas/`](schemas/) | JSON Schema for templates. |
| [`templates/`](templates/) | Templates by element: lightning (sky strike, chain arc, charge and discharge, boss storm call, ball lightning), water (pressure jet), fire (dragon breath, meteor strike), wind (tornado, gale shove, scythe volley, maelstrom), light (sunlance), energy (annihilator beam), psychic (mind crush), earth (ground pound, rending quake, rockfall, stone spires), sound (rallying anthem, sorrow dirge, lingering refrain), poison (pestilence field), blood (sanguine siphon, crimson nova, nightwing swarm, hemorrhage curse) and shadow (bone tempest, umbral grasp, void collapse). Templates can also name a spell line (Bard, Sorcerer, Cabalist, Necromancer, Vampire, Warlock). |
| [`web/`](web/) | The viewer (Three.js r169 vendored in `web/vendor`, no build step). |
| [`web/sounds/`](web/sounds/) | Sound cue library (`cues.json`) and where real samples go. |
| [`tools/serve.py`](tools/serve.py) | Local server for the viewer. |
| [`tools/export_sprites.py`](tools/export_sprites.py), [`docs/exporting.md`](docs/exporting.md) | Sprite sheet export for game engines, with a JSON file and an assembly guide; [`tools/sheet_cells.py`](tools/sheet_cells.py) crops labeled cells for review. |
| [`tools/export_gif.py`](tools/export_gif.py) | Animated GIFs of the viewer's camera views (the viewer's **Export GIF…**). |
| [`tools/validate.py`](tools/validate.py) | Validates templates (schema + timing/reference rules). |
| [`tools/breakdown.py`](tools/breakdown.py) | Breaks a GIF or video down into timing, phases, palette, footprint and view hints, plus images for the AI. |
| [`docs/director-playbook.md`](docs/director-playbook.md) | How the director turns a request into a template: questions to ask, timing, layers, views, saving. |
| [`director/`](director/) | The director's library functions and its MCP server. |
| [`docs/gif-breakdown-playbook.md`](docs/gif-breakdown-playbook.md) | Step-by-step directions for turning a breakdown into a template. |
| [`tools/sample_gif.py`](tools/sample_gif.py), [`samples/`](samples/) | A synthetic sky-strike GIF and MP4 with a known timeline, for trying the tools. |

## Director (MCP server)

The director is an AI agent (Claude, or any MCP client) using the SpellDirector MCP server. Ask it for a spell in plain words, or hand it a GIF; it asks a few plain-word choices, writes the template, validates and saves it, and gives you a viewer link.

```bash
python -m pip install -r requirements-dev.txt
python -m director.mcp_server        # stdio MCP server; run from the repo root
```

Claude Code picks it up from [`.mcp.json`](.mcp.json) when opened in this repo. For Claude Desktop or another client, add a stdio server with command `python`, args `["-m", "director.mcp_server"]` and the repo as the working directory.

**Without Python:** the Windows app is the MCP server too: `SpellDirector.exe --mcp`. The easy way to connect it is **? Help → Connect** in the viewer, or `SpellDirector.exe --setup` (from the source folder: `python tools/client_setup.py`), which adds it to Claude Desktop, Claude Code (`claude mcp add --scope user`) and Codex (`~/.codex/config.toml`, shared by the ChatGPT desktop app, Codex CLI and IDE extension) wherever they're installed, keeping other settings and a `.bak`. When a newer exe starts, it switches the apps already connected to an older one over to itself. See [docs/setup.md](docs/setup.md). By hand, the client entry is:

```json
{
  "mcpServers": {
    "spelldirector": {
      "command": "C:\\path\\to\\SpellDirector-vX.Y.Z-windows.exe",
      "args": ["--mcp"]
    }
  }
}
```

(Claude Code: `claude mcp add --scope user spelldirector -- "C:\path\to\SpellDirector-vX.Y.Z-windows.exe" --mcp`.) In this mode the saved templates, exports and breakdowns go to a `SpellDirector Library` folder next to the exe (or in your Documents if the exe sits somewhere read-only, or `--library <folder>`), the viewer shows them next to the built-in templates, and the exe also serves the viewer in the background so the preview links work. Sprite export uses an installed Edge or Chrome instead of Playwright.

| Tools | Resources | Prompts |
|---|---|---|
| `list_templates`, `get_template`, `get_vocabulary`, `get_template_format`, `get_sound_cues`, `validate_template`, `save_template`, `breakdown_gif`, `export_sprites`, `export_gif`, `look_at_sprite_sheet` | `spelldirector://docs/{vocabulary, template-format, sound-design, director-playbook, gif-breakdown-playbook}`, `spelldirector://schema/0.1.0` | `direct_spell`, `direct_from_gif`, `grow_library` |

`save_template` validates, writes `templates/<element>/<name>.json`, rebuilds the index, and won't replace an existing template unless asked to. Run `python tools/serve.py` (or the app) to open the links it returns. The director follows [docs/director-playbook.md](docs/director-playbook.md).

## Viewer

A Three.js motion-study viewer: pick a template, replay it, jump to a beat, scrub, slow it down, and check it from front, side, top and 3/4 (or all four at once). Each beat's intent shows as a caption. Change the seed to see a different cast of the same template, or open your own template JSON.

**Windows:** double-click `run.bat`. **macOS / Linux:** `./run.sh`. Either one starts the viewer and opens it in your browser at http://localhost:47811 (only Python 3 is needed). Close the window or press Ctrl+C to stop.

Each launch first pulls the latest changes from GitHub (fast-forward only, on the branch you're on). If Git isn't installed, there's no network, you have uncommitted changes or local commits, or your branch isn't on GitHub, it skips the update with a note and starts the copy you have. Then, if a SpellDirector is already running older code, it closes it (and any stray copies on nearby ports) and starts a fresh one; if the running one is already on the latest code, it just opens it. Either way exactly one runs, on the code you just pulled. Set `SPELLDIRECTOR_NO_UPDATE=1` to skip the update.

To get the latest version, double-click `update.bat` (Windows) or run `./update.sh`. It switches to `main`, fetches, and fast-forwards to what's on GitHub. It never throws away work: if you have uncommitted changes, or local commits on `main`, it stops and says so. It also lists local branches that were deleted on GitHub (it doesn't delete them) and reinstalls the Python packages when `requirements-dev.txt` changed.

Use another port with `run.bat 50123` / `./run.sh 50123`, or set `SPELLDIRECTOR_PORT`. If the port is busy, the next free one is used. Without the scripts: `python tools/serve.py --open`.

Sound cues play in time with the beats. The sounds are procedural placeholders; exports include them as WAV files plus a sound brief per cue (text-to-SFX prompts, synthesis recipes, search terms) for making the real ones, see [docs/sound-design.md](docs/sound-design.md). Sound starts **off**: click **Sound off** or press M to turn it on, and the viewer remembers your choice.

**Analyze GIF/MP4…** opens a page where you drop a reference clip and see its breakdown (camera shots, phase timeline, palette, footprint and view hints) next to the clip, then save it or copy a prompt for the director. It runs on your computer through the local server; from a source checkout it needs `pip install -r requirements-dev.txt`.

**Export sprites…** saves the current spell and seed as sprite sheets for a game engine: one per layer plus one for the whole spell, with the frames across and the four views down, a JSON file, and a guide for rebuilding it in Unity or Godot. See [docs/exporting.md](docs/exporting.md).

**Export GIF…** saves the spell as looping animated GIFs, as the viewer shows it, from the views you pick (Front, Side, Top, 3/4, All four in one GIF, or all of them). Auras record their seamless loop. From the command line: `python tools/export_gif.py <template id> --views front,quad`. See [docs/exporting.md](docs/exporting.md#animated-gifs).

**? Help** (or the `?` key) opens a getting-started page for new users: connecting the AI director, what to ask it, and a tour of the viewer.

Keys: Space play/pause, 1-4 views, 5 all four, [ ] previous/next spell, M sound, G export GIF, F focus view (Esc to leave), ? help. Drag to orbit, scroll to zoom.

After adding a template file, run `python tools/build_index.py` so static hosting picks it up (the local server finds new files on its own).

## Break down a GIF or MP4

```bash
python -m pip install -r requirements-dev.txt
python tools/breakdown.py samples/synthetic-sky-strike.gif --out breakdowns/sky-strike
python tools/breakdown.py samples/synthetic-sky-strike.mp4 --out breakdowns/sky-strike-mp4
python tools/breakdown.py my-capture.mp4 --start 1.2 --end 3.5   # trim to the spell (GIFs too)
```

Videos (MP4, WebM, MOV, MKV, AVI) are decoded with PyAV and sampled at up to 30 fps.

Then follow the [playbook](docs/gif-breakdown-playbook.md).

## Validate templates

```bash
python -m pip install -r requirements-dev.txt
python tools/validate.py templates/lightning/*.json
python -m pytest
node --test web-tests/*.test.mjs
```
