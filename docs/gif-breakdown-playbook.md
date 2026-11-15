# GIF Breakdown Playbook

How the director turns a reference GIF or video (MP4, WebM, MOV) into a template. Everything below says "GIF", but videos work the same way. Follow the steps in order. The tool measures; **you** interpret, using the [vocabulary](vocabulary.md) and the [template format](template-format.md).

The goal is a template that recreates the *character* of the reference (timing, shape, palette, layering) as an original effect. Never trace or copy another game's art.

---

## Step 0. Run the tool

```bash
python tools/breakdown.py path/to/spell.gif --out breakdowns/<name>
```

For a video, trim it to the spell so the timeline starts near the cast:

```bash
python tools/breakdown.py path/to/spell.mp4 --start 1.2 --end 3.5 --out breakdowns/<name>
```

Videos are sampled at up to 30 fps (`--max-fps`) and 20 s (`--max-seconds`); `gif.video.truncated` tells you if the limit cut it off. Through MCP, `breakdown_gif` takes `start_s` and `end_s`. A video recorded from a game often has UI, a moving camera and a non-black background, so trust the contact sheet over the numbers.

You get `breakdown.json` plus four images. Look at the images, not just the numbers:

| File | Look at it for |
|---|---|
| `contact_sheet.png` | Every frame (or up to 48, always including peaks), labelled `#index  time  phase-hint  i=intensity`. Border color = phase hint. `*` = brightness peak. |
| `curves.png` | Intensity (yellow), coverage (blue), motion (purple) over time, with phase bands and peak circles. |
| `palette.png` | Effect colors brightest first, with suggested slots. |
| `heatmap.png` | Where on screen the effect lives across the whole GIF. This is the footprint. |

What the numbers mean:

- **intensity**: how much brighter than the background the frame is, normalised so the brightest frame = 1. This is the beat intensity curve.
- **coverage**: fraction of the screen the effect covers. Rising coverage with flat intensity = something spreading (ring, smoke, roots).
- **motion**: how much changed since the previous frame. High motion with low intensity = fast small things (sparks, crackle) or a moving camera.
- **centroid / bbox**: where the effect's mass is, in 0–1 screen coordinates (y grows downward).

## Step 1. Identify the camera view

Do this first, because it decides how to read everything else. `space.view_guess` is a rough guess from shape alone; confirm it by looking at the contact sheet.

| You see | View |
|---|---|
| A visible ground plane drawn as an ellipse, character seen from above and to the side | `three_quarter` |
| Ground is a flat line or not visible; things rise and fall vertically; character faces camera or away | `front` |
| Ground is a flat line; motion runs mainly left↔right; character in profile | `side` |
| Rings are circles, characters are heads/shoulders from above, no horizon | `top` |

Then infer the other three views. Use the plane rules in the vocabulary: ground layers become thin lines in front/side and full shapes in top; vertical things become points from top. Write all four into `views.reads`, and set `views.hero` to the view the GIF was shot from.

## Step 2. Set the timeline

1. Read `timing.phases`. They are hints from the brightness curve: rising = anticipation, first strong frames = release, strong/flickering = impact, decay = dissipation.
2. Check them against the contact sheet and fix them. Common corrections:
   - A projectile or beam has a **travel** phase between release and impact that the curve can't see. Look for the centroid moving (`centroid_travel`, motion curve).
   - Anticipation that is mostly *movement* (particles converging) rather than brightness may be labelled `none`. Look for early frames with content.
   - A long glowing hold after the hit is still **impact** if it stays bright, **dissipation** once it's clearly fading.
3. Use the GIF's real times as `start_ms` / `end_ms`. Round to 10 ms. If the GIF has leading or trailing empty frames, trim them and shift times so the effect starts near 0.
4. Pick the intensity curve shape per beat from `curves.png`:
   - steady climb → `ease_in`; jump then decay → `spike`; big fall then slow tail → `ease_out`; sawtooth → `flicker` (use `timing.flicker.hz`); flat → `hold`.
5. `hold_frames_at_peak` ≥ 2 means the brightest frame is held: say so in the release beat's `intent`.
6. Watch for GIF frame merging: identical consecutive frames are merged into one longer frame. Trust `start_ms` and `duration_ms`, not frame counts.

## Step 3. Separate the layers

Go through the contact sheet beat by beat and list every distinct visual thing. For each, pick a layer type from the vocabulary:

- thin bright jagged lines → `bolt` (or `crackle` if small and many)
- soft halo around something → `glow` with `attach_to`
- whole frame brightens for 1–3 frames → `flash` (`scope: screen`)
- small dots flying out → `sparks`
- expanding circle/ellipse on the ground → `ring` (`plane: ground`)
- mark left behind → `decal`
- soft dark puffs → `smoke`
- ball of energy → `orb`
- continuous ribbon between two points → `beam`
- frame shakes (whole image offset between frames) → `camera_shake`

Give each layer the beats it's visible in. Order them by `z` from what's drawn behind to in front.

## Step 4. Fill in params

Estimate numbers from the frames, in pixels at the GIF's resolution (`gif.width` × `gif.height`):

- **Sizes**: measure against the frame. A bolt that is 4 px wide in a 240 px GIF is `width_px` ≈ 4 × (your target resolution / 240). Prefer ranges over exact numbers.
- **Bolt shape**: count the zig-zag segments (`segments`), judge `jaggedness` against the vocabulary scale, count branches (`branch_chance`, `branch_depth`).
- **Regeneration**: if the bolt shape changes every frame, `regen_ms` ≈ frame duration. If the same shape flashes repeatedly, `regen_ms: 0` with `restrikes` = number of peaks after the first.
- **Sparks**: count them in the peak frame, estimate how far they fly in how many ms for `speed`.
- **Rings**: read start and end radius from the first and last frame they appear in.
- **Shake**: compare the background between frames; offset in px = `amplitude_px`.

## Step 5. Palette

Start from the suggested slots in `palette`, then correct by eye:

- `core` should be the near-white center of the brightest elements.
- `primary` is the color a player would name the spell by.
- `secondary` is the darker, more saturated edge or glow.
- `accent` only if there's a clearly different hue (sparks, embers).
- `shadow` only if there are dark elements (smoke, scorch, sky darkening). Dark background pixels are **not** a shadow color.

## Step 6. Write the template

- `source`: `{"kind": "director_gif", "reference": "<gif file name>"}`
- `description`: one or two sentences in plain words.
- Each beat's `intent`: what the player should feel and see, in words a non-artist understands. These become the captions in the preview.
- `variation.notes`: what should change between casts and what must stay fixed.
- `director_notes`: the two or three choices that matter most for the feel, and why.

Then validate:

```bash
python tools/validate.py templates/<element>/<id>.json
```

## Step 7. Compare and revise

Once the preview exists (step 4 of the plan), render the template in the GIF's view next to the GIF, and compare beat by beat: timing first, then silhouette, then color, then detail. Fix the biggest difference first.

## Worked example

`python tools/sample_gif.py samples/synthetic-sky-strike.gif` draws a test GIF with a known timeline. Its breakdown reports:

```
anticipation    120-400 ms   ground glow grows
release         400-480 ms   bolt at full brightness, held 2 frames
impact          480-640 ms   2 restrikes, flicker ~10 Hz
dissipation     640-1080 ms  ring expands and fades
view guess: front
```

Reading the contact sheet: the ground glow and ring are ellipses, so the view is really `three_quarter`, not `front` (the guess was misled by the tall bolt). That maps directly to [`templates/lightning/sky-strike.json`](../templates/lightning/sky-strike.json): `gather` → anticipation, `strike` → release, `restrike` with `restrikes: 2` → impact, `fade` with the ring and afterglow → dissipation.
