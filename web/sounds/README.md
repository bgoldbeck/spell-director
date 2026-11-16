# Sound cue library

Templates don't hold audio. A `sound_cue` layer names a **cue** (`crack`, `buzz`, `fire`, ...) and the beats it plays in; the viewer plays that cue in sync. [`cues.json`](cues.json) is the cue library and the single source of truth: the validator, the director (`get_sound_cues`) and the viewer all read it.

## What plays today

Every cue has a **procedural placeholder**: a small Web Audio recipe (oscillators and filtered noise) in [`web/js/audio.js`](../js/audio.js), named after the cue. They get the timing and the rough character right; they are not meant to sound finished.

## Replacing a placeholder with a real sound

No code changes are needed.

1. Put the file in `web/sounds/samples/` (`.ogg`, `.mp3` or `.wav`; short, trimmed, peak-normalized, mono is fine). Name it `<cue>-<n>.<ext>`, e.g. `crack-1.ogg`.
2. List it on the cue in `cues.json`: `"samples": ["samples/crack-1.ogg", "samples/crack-2.ogg"]`. With several samples, each cast picks one from its seed, so repeats vary.
3. Add a row to [`CREDITS.md`](CREDITS.md): file, source URL, author, license.

One-shot cues play the whole sample. Sustained cues loop the sample if it's shorter than the beat and fade out at the end, so loopable recordings work best for `hum`, `buzz`, `fire`, `wind` and the like. If a sample fails to load, the viewer falls back to the placeholder and logs a warning.

### Licensing

Only add sounds that can ship in this repo:

- **CC0 / public domain** (preferred): no attribution needed, but still list it in `CREDITS.md`. Good sources: Freesound filtered to CC0, Kenney's audio packs, OpenGameArt filtered to CC0, Sonniss GDC bundles (royalty-free; check the bundle license).
- **CC-BY**: allowed only with the attribution in `CREDITS.md`.
- Not allowed: CC-BY-NC, CC-BY-SA, "free for personal use", ripped game audio, or anything without a clear license.

### What each cue should sound like

Each cue carries a sound brief in the words of [docs/sound-design.md](../../docs/sound-design.md): `character` (texture, pitch, envelope, the layers it's built from, tail, space), a `synth` recipe (how to make it procedurally) and `search` terms for sound libraries. `flavors` adds element words (water, blood, dark, ...) to the prompts. Exports turn all of this into a per-spell cue sheet (`<id>.sounds.json`) and render the placeholders to WAV files.

### Text-to-SFX

Each cue has an `sfx_prompt`, a ready prompt for a text-to-SFX service. Generate a few takes, keep the best, and add them as samples like any other file (record the service and its license terms in `CREDITS.md`).

## Adding a new cue

Add an entry to `cues.json` (`label`, `category`, `kind` = `one_shot` or `sustained`, `duration_ms`, `describes`, `words`, `phases`, `character`, `sfx_prompt`, `synth`, `search`, `samples`), add a placeholder recipe with the same name to `RECIPES` in `web/js/audio.js` (a test checks every cue has one), and add it to the cue table in `docs/vocabulary.md` §10 and `docs/template-format.md`.
