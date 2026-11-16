# Sound design vocabulary

How SpellDirector describes a spell's sound, and how a person or an AI (Claude, GPT, a text-to-SFX generator) turns that description into real audio. It does for sound what [vocabulary.md](vocabulary.md) does for visuals. The cue list itself lives in [`web/sounds/cues.json`](../web/sounds/cues.json).

## Who makes the final sounds?

**You do, with help.** SpellDirector doesn't ship finished audio. It gives you:

- **Timing**: every sound cue's start, frame, length, volume and pitch, locked to the beats.
- **A brief per cue**: what it should sound like, in the words below.
- **Ways to make it**: a text-to-SFX prompt, a procedural synthesis recipe, and library search terms.
- **Placeholders**: the viewer's procedural sounds, also exported as WAV files (`sound-<cue>.wav` and `<id>.preview.wav`) so the engine wiring and timing can be done before the real sounds exist.

The real sounds come from a text-to-SFX generator, from an AI writing a synthesizer, from a sound library, or from your own recordings. Swap them in under the same file names.

## 1. Anatomy of a spell sound

A good spell sound is several layers, each with a job, lined up with the visual phases:

| Phase | Sound role | Typical cues | What it does |
|---|---|---|---|
| anticipation | **build-up** | `charge`, `crackle`, `hum`, `whisper`, `heartbeat`, `drone` | Tells the player something is coming. Rises in pitch, loudness or density. Ends exactly when the release starts. |
| release | **launch** | `zap`, `crack`, `whoosh`, `ignite`, `squelch` | The moment the caster lets go. Short, with a sharp start. |
| travel | **travel** | `whoosh`, `hum`, `buzz`, `fire`, `stream`, `wind`, `drain` | Carries the spell to the target. Usually a loop; a whoosh peaks as it passes. |
| impact | **hit** | `boom`, `crack`, `impact`, `crash`, `splash`, `shatter`, `squelch` | The loudest moment. Stack a transient, a body and a sub (see below). |
| dissipation | **tail** | `rumble`, `crackle`, `sizzle`, `freeze`, `shimmer`, `whisper` | What lingers: debris settling, embers, static, a rolling echo. Quieter than the hit and fades out. |

### The hit is a stack

Big impacts are almost never one sound. Build them from:

1. **Transient**: a click, snap or crack in the first 5-20 ms. It is what makes the hit feel instant and lines it up with the impact frame.
2. **Body**: the character of the hit (stone, water, fire, flesh, energy) over 100-500 ms.
3. **Sub**: a low sine or boom drop under 100 Hz for weight. Felt more than heard; keep it short in small games.
4. **Sweetener and tail**: debris, sparkles, sizzle, a rumble or reverb that carries the hit into the dissipation phase.

In a template this means several `sound_cue` layers on the impact beat (for example `crack` + `boom` + `rumble`), each with its own gain.

## 2. Words for a sound

Each cue in `cues.json` has a `character` written with these words, so prompts and recipes stay consistent.

### Texture (what it's made of)

| Word | Means | Examples |
|---|---|---|
| smooth | pure, few harmonics, no noise | hum, tones, chimes |
| airy / breathy | mostly filtered noise, soft | wind, whoosh, whispers |
| gritty / harsh | noisy and distorted, buzzing | electric buzz, sand |
| crackling | many tiny random clicks | static, embers, ice forming |
| wet | bubbly, splashy, gurgling, with resonant sweeps | water, blood, slime |
| thick / visceral | low-mid, gloopy, organic | flesh, mud, blood magic |
| glassy / crystalline | bright pings with inharmonic partials | ice, glass, crystal |
| rocky / crunchy | broadband bursts with scattered chunks | stone, rubble |
| hollow | resonant, with a hole in the mids | dark magic, caves, drains |
| metallic | ringing, inharmonic, long decay | blades, bells (use sparingly) |

### Pitch

- **Register**: sub (under 60 Hz), low (60-250 Hz), mid (250 Hz-2 kHz), high (2-8 kHz), air (over 8 kHz).
- **Movement**: steady, rising (build-ups, drains), falling (zaps, booms, things leaving), wandering (wind, voices).
- **Harmony**: consonant (fifths, octaves, pentatonic chimes) reads as holy, healing, light; dissonant (tritone, minor second, detuned beating) reads as dark, cursed, wrong.

### Envelope (loudness over time)

- **Attack**: instant (under 5 ms: hits, cracks), snappy (5-30 ms), soft (30-150 ms: ignites, swells), swelling (the whole length: charge, drain).
- **Body**: a short decay, a hold (sustained cues) or random swells (fire, wind, voices).
- **Release / tail**: none (a hard cut, as when a charge snaps into the release), short (under 200 ms), long (over 500 ms: booms, rumbles, reverb).
- **Reverse**: quiet to loud with a hard stop. Reads as sucking in, draining, time running backwards.

### Space and motion

- **Space**: dry (close, inside the body), room, hall, outdoor, distant. Keep exported sounds fairly dry; the game adds its own reverb.
- **Motion**: pass-by (a whoosh peaking in the middle), approaching (getting louder and brighter), receding (quieter and duller), circling (slow pan).

### Size and weight

Bigger means lower, longer and with more sub. Small spells: higher pitch, shorter, less low end. Use the cue's `pitch` param (playback rate) to scale the same sound: 0.7-0.85 for a big version, 1.15-1.4 for a small one. Vary it per cast with a range like `{"min": 0.92, "max": 1.08}` so repeats don't sound identical.

## 3. Element flavors

`cues.json` → `flavors` adds element words to every prompt, and says what to keep out.

| Element | Add | Keep out |
|---|---|---|
| lightning | electric, crackling, ozone-sharp | rain |
| fire | fiery, roaring, crackling embers | gunshots |
| earth | rocky, gritty, heavy stone | metal |
| water | wet, splashing, gurgling | rain, ocean ambience |
| ice | icy, crisp, glassy, cold | wind chimes |
| wind | airy, howling, gusting | rain |
| light | radiant, bright, choral shimmer | electric buzz |
| energy | sci-fi energy, pure tone, humming | guns |
| psychic | warped, pulsing, otherworldly, pressure in the ears | voices saying words |
| blood | wet, visceral, thick, pulsing | screams, voices |
| dark, shadow | hollow, ominous, whispering, reversed | screams, horror stingers, words |
| sound (bard songs) | musical, resonant, sung tones | lyrics, words, drums |
| nature | organic, woody, rustling leaves | birdsong |
| poison | bubbling, acidic hiss, gloopy | voices |
| arcane | magical, shimmering, resonant | music |

Blood and dark magic (vampiric spells) lean on `squelch`, `heartbeat`, `drain`, `whisper` and `drone`: wet and pulsing for blood, hollow, reversed and dissonant for shadow.

## 4. Timing rules

- **The transient is on the frame.** A one-shot starts at its event's `at_ms`, so its sound must start on its first sample: trim all silence before the transient.
- **Whooshes peak on arrival.** The cue's loudest point is about 45% through, so start it a little before the moment it passes (use `offset_ms`, or put it on the beat before).
- **Build-ups end on the release.** A `charge` or `drain` cuts off hard when the next beat starts; don't fade it.
- **Sustained cues loop.** They play from the layer's first beat to its last. Make the file loop seamlessly and fade it out over about 100 ms at `end_ms`.
- **One thing at a time at the top.** At any moment one sound should lead. Drop the others 6-10 dB under it (the template's `gain`).
- **Variation.** Cues that play more than once (chain hops, restrikes, volleys) want 2-3 takes, picked at random, plus a small pitch range.

### Auras

An aura's sound has the same three parts as its picture: a start-up sound (once), a loop bed and ticks (repeat while it lasts), and an end sound (once). Keep the bed quiet and steady (`hum`, `drone`, `wind`, `fire` at -10 to -12 dB) so it can play for minutes, and give each pulse or damage tick a short sound that lands with the ring or wave it belongs to (`repeat_ms` that divides the loop, `offset_ms` to line it up). The sound sheet marks every event `intro`, `loop` or `outro`; make the bed a seamless loop (crossfade its end into its start).

## 5. Levels

- Normalize every file to a **-1 dBFS peak**. The cue sheet's `volume_db` (from the layer's `gain`) sets the mix: 0 dB for the main hit, -3 to -6 dB for support layers, -8 to -14 dB for beds and tails.
- Keep the low end in check: a sub boom under a rumble under a crash adds up fast. High-pass non-bass layers at about 80-120 Hz.
- Short games and mobile speakers lose everything under about 100 Hz. Add a little saturation to booms so they still read.

## 6. Making the sounds

Every export has `<id>.sounds.json` (format `spelldirector-sounds-1`) and a Sound section in the guide with all of this per cue. Three routes, which mix fine:

### A. Text-to-SFX generators

ElevenLabs Sound Effects and similar text-to-audio tools work well for real-world textures (splashes, rock, fire, wind, flesh) and decent for magic.

- **Prompt formula**: *source and action, texture, pitch, envelope, space, what to leave out.* For example: "big water splash, wet slap with spray, then droplets pattering down, wet, splashing, gurgling, no rain, no music". Each cue's `prompt` in the sounds JSON already follows it, with the element flavor added.
- **Duration**: use the cue's `generate.duration_s`. One-shots get their length plus a little tail; sustained cues get a 2-4 s loop.
- **Loop**: turn the tool's loop option on for sustained cues (`generate.loop`).
- **Prompt influence** (where offered): high (about 0.6-0.8) for precise one-shots, lower for textures where variety helps.
- **Takes**: make 2-4 and keep the best; keep several for cues that repeat.
- Always say "no music" (and no voices or words unless it's `whisper`). Never name a game, franchise or character: describe the sound.
- Check the tool's license terms for commercial use and note the tool in your credits.

### B. Procedural synthesis (an AI writes the synth)

Claude or GPT can write a small Python script (numpy plus the standard `wave` module) that renders each cue from its `synth` recipe. This works best for energy, electric, magic, risers, hums and drones, and is fully license-free. Ask it to:

1. Follow each cue's `synth` recipe and `character` (texture, pitch, envelope, layers).
2. Use white, pink and brown noise, filtered (band-pass, low-pass, high-pass), plus sine, saw and square oscillators with pitch sweeps.
3. Put random, seeded variation in pops, wanders and pitch, so takes differ.
4. Add a little saturation (`tanh`) for weight and a short noise-burst reverb for space.
5. Write 44.1 kHz 16-bit WAVs, peak-normalized to -1 dBFS, with the file names from the sounds JSON.

The viewer's own placeholders (`web/js/audio.js`) are written the same way in Web Audio and can serve as a reference.

### C. Sound libraries and recordings

Search each cue's `search` terms. Only use clear licenses: CC0 (Freesound filtered to CC0, Kenney, OpenGameArt CC0) or royalty-free bundles (Sonniss GDC). Layer two or three recordings to cover the whole description (a rock crash plus a sub boom plus pebbles). Pitch real-world recordings down for size.

### Copy-paste prompt for Claude or GPT

> I'm making the sound effects for a game spell. Attached are its SpellDirector export guide (`<id>.guide.md`) and its sound cue sheet (`<id>.sounds.json`). For each cue in the sounds JSON: read its description, character, roles and timing, then (1) give me a refined text-to-SFX prompt with duration and loop setting, (2) write one Python script (numpy and the standard wave module only) that synthesizes every cue as a 44.1 kHz 16-bit WAV with the exact file names in the JSON, following each cue's procedural recipe and character, peak-normalized to -1 dBFS, with seamless loops for sustained cues, and (3) tell me which cues would sound better generated or recorded than synthesized. Keep the timing: each one-shot's transient must be on its first sample.

## 7. In the engine

- **Unity**: one-shots with `AudioSource.PlayOneShot(clip, volume)` at `at_ms`, `pitch` on the source; sustained cues on a looping AudioSource from `at_ms` to `end_ms` with a short fade. Volume = `10^(volume_db / 20)`. Short clips: Load Type *Decompress On Load*.
- **Godot 4**: an **AudioStreamPlayer** (2D/3D for positional) per cue; set `volume_db` and `pitch_scale`, `play()` at `at_ms`; loop sustained WAVs (Import dock → Loop Mode: Forward) and `stop()` or fade at `end_ms`.
- **Position**: build-ups at the caster, travel on the projectile, hits and tails at the target.

## 8. In the viewer

The viewer plays the procedural placeholders (sound is off by default; press **M** or the Sound button). They share a small reverb and a compressor, use white, pink and brown noise, and pan each sound slightly. To hear a real sound instead, add it as a sample in `web/sounds/` (see [`web/sounds/README.md`](../web/sounds/README.md)); the viewer and exports pick it up without code changes.
