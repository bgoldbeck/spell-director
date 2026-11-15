# SpellDirector

An AI "director" for game spell effects. You describe a spell loosely ("heavy boss lightning") or show it a reference GIF, and the director turns that into a precise **template**: phases, timing, layers, palette and variation ranges. A renderer then turns template + seed into frames for any game, from four standard cameras: front, side, top and 3/4.

You don't need to know VFX terminology. The director does, and it offers you concrete choices in plain words.

## Plan

Full design: [docs/DESIGN.md](docs/DESIGN.md). What's next: [docs/ROADMAP.md](docs/ROADMAP.md).

1. **Vocabulary and template format** (done): the director's language, the template schema, and hand-written lightning templates.
2. **GIF breakdown** (done): a tool that extracts frames, timing, colors and a brightness curve from a GIF, plus a playbook the AI follows to turn that into a template.
3. **Director** (MCP server + playbook done): text or GIF in, a few guided choices, template out. Also generates templates on its own to grow the library.
4. **Builder and preview** (viewer done): renders templates in front, side, top and 3/4 views, side by side with the source GIF, and exports for game engines.

## Repository layout

| Path | What |
|---|---|
| [`docs/vocabulary.md`](docs/vocabulary.md) | Terms the director uses: phases, timing, shape, color, layers, space, lightning terms. |
| [`docs/template-format.md`](docs/template-format.md) | The template format, field by field. |
| [`schemas/`](schemas/) | JSON Schema for templates. |
| [`templates/lightning/`](templates/lightning/) | Lightning templates: sky strike, chain arc, charge and discharge, boss storm call. |
| [`web/`](web/) | The viewer (Three.js r169 vendored in `web/vendor`, no build step). |
| [`tools/serve.py`](tools/serve.py) | Local server for the viewer. |
| [`tools/validate.py`](tools/validate.py) | Validates templates (schema + timing/reference rules). |
| [`tools/breakdown.py`](tools/breakdown.py) | Breaks a GIF down into timing, phases, palette, footprint and view hints, plus images for the AI. |
| [`docs/director-playbook.md`](docs/director-playbook.md) | How the director turns a request into a template: questions to ask, timing, layers, views, saving. |
| [`director/`](director/) | The director's library functions and its MCP server. |
| [`docs/gif-breakdown-playbook.md`](docs/gif-breakdown-playbook.md) | Step-by-step directions for turning a breakdown into a template. |
| [`tools/sample_gif.py`](tools/sample_gif.py), [`samples/`](samples/) | A synthetic sky-strike GIF with a known timeline, for trying the tools. |

## Director (MCP server)

The director is an AI agent (Claude, or any MCP client) using the SpellDirector MCP server. Ask it for a spell in plain words, or hand it a GIF; it asks a few plain-word choices, writes the template, validates and saves it, and gives you a viewer link.

```bash
python -m pip install -r requirements-dev.txt
python -m director.mcp_server        # stdio MCP server; run from the repo root
```

Claude Code picks it up from [`.mcp.json`](.mcp.json) when opened in this repo. For Claude Desktop or another client, add a stdio server with command `python`, args `["-m", "director.mcp_server"]` and the repo as the working directory.

| Tools | Resources | Prompts |
|---|---|---|
| `list_templates`, `get_template`, `get_vocabulary`, `get_template_format`, `validate_template`, `save_template`, `breakdown_gif` | `spelldirector://docs/{vocabulary, template-format, director-playbook, gif-breakdown-playbook}`, `spelldirector://schema/0.1.0` | `direct_spell`, `direct_from_gif`, `grow_library` |

`save_template` validates, writes `templates/<element>/<name>.json`, rebuilds the index, and won't replace an existing template unless asked to. Run `python tools/serve.py` to open the links it returns. The director follows [docs/director-playbook.md](docs/director-playbook.md).

## Viewer

A Three.js motion-study viewer: pick a template, replay it, jump to a beat, scrub, slow it down, and check it from front, side, top and 3/4 (or all four at once). Each beat's intent shows as a caption. Change the seed to see a different cast of the same template, or open your own template JSON.

```bash
python tools/serve.py            # then open http://localhost:8000
```

Keys: Space play/pause, 1-4 views, 5 all four, F focus view (Esc to leave). Drag to orbit, scroll to zoom.

After adding a template file, run `python tools/build_index.py` so static hosting picks it up (the local server finds new files on its own).

## Break down a GIF

```bash
python -m pip install -r requirements-dev.txt
python tools/breakdown.py samples/synthetic-sky-strike.gif --out breakdowns/sky-strike
```

Then follow the [playbook](docs/gif-breakdown-playbook.md).

## Validate templates

```bash
python -m pip install -r requirements-dev.txt
python tools/validate.py templates/lightning/*.json
python -m pytest
node --test web-tests/*.test.mjs
```
