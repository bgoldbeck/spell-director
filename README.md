# SpellDirector

An AI "director" for game spell effects. You describe a spell loosely ("heavy boss lightning") or show it a reference GIF, and the director turns that into a precise **template**: phases, timing, layers, palette and variation ranges. A renderer then turns template + seed into frames for any game, from four standard cameras: front, side, top and 3/4.

You don't need to know VFX terminology. The director does, and it offers you concrete choices in plain words.

## Plan

1. **Vocabulary and template format** (this release): the director's language, the template schema, and hand-written lightning templates.
2. **GIF breakdown**: a tool that extracts frames, timing, colors and a brightness curve from a GIF, plus a playbook the AI follows to turn that into a template.
3. **Director**: text or GIF in, a few guided choices, template out. Also generates templates on its own to grow the library.
4. **Builder and preview**: renders templates in front, side, top and 3/4 views, side by side with the source GIF, and exports for game engines.

## Repository layout

| Path | What |
|---|---|
| [`docs/vocabulary.md`](docs/vocabulary.md) | Terms the director uses: phases, timing, shape, color, layers, space, lightning terms. |
| [`docs/template-format.md`](docs/template-format.md) | The template format, field by field. |
| [`schemas/`](schemas/) | JSON Schema for templates. |
| [`templates/lightning/`](templates/lightning/) | Example templates: sky strike, chain arc, charge and discharge. |
| [`tools/validate.py`](tools/validate.py) | Validates templates (schema + timing/reference rules). |

## Validate templates

```bash
python -m pip install -r requirements-dev.txt
python tools/validate.py templates/lightning/*.json
python -m pytest
```
