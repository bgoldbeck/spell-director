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

Then call `list_templates` and open the one or two closest to the request with `get_template`. Existing templates are your best guide to what the viewer renders well. Reuse their structure, don't duplicate them: a new template must differ in feel, not just in numbers.

## Step 1. Read the request

Pull these out of what the user said, and note which are missing:

| Decide | Words that tell you | If missing |
|---|---|---|
| `element` | "lightning", "storm", "shock" | ask (it's rarely missing) |
| `archetype` | strike (from above / one hit), projectile (thrown), chain (jumps), beam (continuous), aura (around the caster), nova (bursts outward) | infer, or ask as a choice |
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

2. Turn weight words into durations (vocabulary "Timing words → numbers"):

   | Weight | Total | Anticipation | Release | Impact | Dissipation |
   |---|---|---|---|---|---|
   | snappy | 400–700 ms | 0–100 ms | 30–60 ms | 80–150 ms | 200–350 ms |
   | medium | 700–1200 ms | 200–380 ms | 50–80 ms | 150–250 ms | 300–500 ms |
   | heavy / boss | 1300–2200 ms | 450–800 ms | 60–100 ms | 250–450 ms | 500–900 ms |

   Contrast is what sells weight: a long anticipation and a long tail around a very short release.
3. Choose each beat's intensity curve: anticipation `ease_in`, release `spike`, lightning impact `flicker` (10–16 Hz), dissipation `ease_out`. Let impact and dissipation overlap by 30–60 ms so the hit doesn't cut off.
4. Write each beat's `intent` in plain words a non-artist understands. It's shown as the caption in the viewer. Mention hold frames in the release intent if you use them.

## Step 4. Choose layers

Start from the silhouette (vocabulary §3): what's the one shape that reads as a black cutout? Build that layer first, then add support layers. Keep it to the layers that do a job; 8–14 is typical.

- **Core shape**: `bolt` (strike, chain), `beam`, `orb` (projectile head, charge), `ring` (nova).
- **Glow** attached to the core (`attach_to`), one palette step darker.
- **Payoff**: `flash` on release, `sparks` + `ring` on impact, `camera_shake` for weight, `light` on the target.
- **Ground story**: anything vertical is a dot from the top view, so give it a `ring`, `decal`, radial `sparks` or ground `crackle`. Mandatory when the hero view is `top`.
- **Tail**: `crackle` lingering, `smoke`, `decal` fading.
- **Sound cues**: `sound_cue` on release and impact (`charge`, `crack`, `boom`, `sizzle`, `hum`).

Know what the viewer draws today (see the known issues in [DESIGN.md](DESIGN.md#6-known-issues-and-limits)): several targets exist only for chains (`travel: chain` or `destination: targets`), so a "storm of strikes across an area" renders as strikes on one spot; projectile travel isn't drawn yet. Prefer designs the viewer can show, and say in `director_notes` when you go beyond it.

Set `z` back to front: shadow/smoke/decal → glow → bolt/beam → sparks → flash. Use only params listed in the template format; unknown params produce warnings and the renderer may ignore them.

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

## Step 5. Palette

Fill `core` and `primary`, and usually `secondary`. Add `accent` only for a contrasting spark color, and `shadow` only if something dark is drawn (smoke, scorch, sky-dim). Electricity is additive with a near-white core. Colors should be original choices, not sampled from a game.

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
3. Give the user the preview URL from the result (`http://localhost:47811/?template=<id>&view=<hero>`, with the viewer running via `run.sh`, `run.bat` or `python tools/serve.py`; if the server picked another port because 47811 was busy, use that one) and a two-line summary: what you made and the choices you took.
4. Offer one revision round in plain words ("heavier hit?", "fewer forks?"). Revise the same template id with `overwrite: true`.

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
