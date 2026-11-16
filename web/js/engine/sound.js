// Sound cue schedule: a pure function of (template, seed, cue library).
// No Web Audio here, so it runs in Node tests. web/js/audio.js plays the
// events; the renderer never depends on what was played.

import { loopRange, resolveValue, seedFor } from "./timeline.js";

export const DEFAULT_GAIN = 0.8;
const FALLBACK = { kind: "one_shot", duration_ms: 300 };
const CAPTION_MS = 220;

function num(v, seed, fallback, ...parts) {
  const x = resolveValue(v, seed, ...parts);
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

// Every sound event in the template, sorted by start time:
// {layer, cue, kind, known, at, dur, gain, rate}. Times are in ms.
// - one_shot cues fire at the start of each of the layer's beats (plus
//   offset_ms), and again every repeat_ms inside that beat if set.
// - sustained cues span the layer's active window (first beat start to last
//   beat end), or duration_ms if set; with repeat_ms they play like
//   one-shots, again every repeat_ms, each for the cue's own length.
export function soundEvents(template, seed, library = {}) {
  const cues = library.cues || {};
  const events = [];
  for (const layer of template.layers || []) {
    if (layer.type !== "sound_cue") continue;
    const p = layer.params || {};
    const cue = typeof p.cue === "string" ? p.cue : "";
    const def = cues[cue] || FALLBACK;
    const beats = (template.beats || []).filter((b) => (layer.beats || []).includes(b.id));
    if (!beats.length) continue;
    const pick = (name, fallback, ...parts) => num(p[name], seed, fallback, layer.id, name, ...parts);
    const offset = pick("offset_ms", 0);
    const base = { layer: layer.id, cue, kind: def.kind, known: cue in cues };

    // A sustained cue with repeat_ms plays again every repeat_ms inside each
    // beat, each time for its own length (duration_ms or the cue's): a
    // shimmer on every beat of an aura, a sizzle on each damage tick.
    if (def.kind === "sustained" && !(pick("repeat_ms", 0) > 0)) {
      const start = Math.min(...beats.map((b) => b.start_ms)) + offset;
      const end = Math.max(...beats.map((b) => b.end_ms));
      const dur = pick("duration_ms", Math.max(1, end - start));
      events.push({ ...base, at: start, dur, gain: pick("gain", DEFAULT_GAIN), rate: pick("pitch", 1) });
      continue;
    }

    const repeat = pick("repeat_ms", 0);
    let n = 0;
    for (const b of beats) {
      const times = [b.start_ms + offset];
      if (repeat > 0) {
        for (let at = times[0] + repeat; at < b.end_ms && times.length < 64; at += repeat) times.push(at);
      }
      for (const at of times) {
        events.push({
          ...base,
          at,
          dur: pick("duration_ms", def.duration_ms ?? FALLBACK.duration_ms, n),
          gain: pick("gain", DEFAULT_GAIN, n),
          rate: pick("pitch", 1, n),
          n,
        });
        n++;
      }
    }
  }
  return events.sort((a, b) => a.at - b.at || a.layer.localeCompare(b.layer));
}

// Events whose start falls in [from, to). Playback calls this once per frame.
export function eventsBetween(events, from, to) {
  return events.filter((e) => e.at >= from && e.at < to);
}

// Cues to caption at time t: sustained while they last, one-shots briefly.
export function cuesAt(events, t) {
  const out = [];
  for (const e of events) {
    const len = e.kind === "sustained" ? e.dur : Math.max(CAPTION_MS, Math.min(e.dur, 400));
    if (t >= e.at && t <= e.at + len && !out.includes(e.cue)) out.push(e.cue);
  }
  return out;
}

// Stable per-event seed, e.g. for choosing between several samples.
export function eventSeed(seed, e) {
  return seedFor(seed, e.layer, "sound", e.n ?? 0);
}

// ------------------------------------------------------------ sound sheet
// The cue sheet that goes out with an export (<id>.sounds.json): which sounds
// the spell needs, when they play, what each should sound like and how to
// make it (a text-to-SFX prompt, a synthesis recipe, library search terms).
// See docs/sound-design.md.

export const SOUND_SHEET_FORMAT = "spelldirector-sounds-1";

const ROLE = {
  anticipation: "build-up",
  release: "launch",
  travel: "travel",
  impact: "hit",
  dissipation: "tail",
};

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const db = (g) => (g > 0 ? r1(20 * Math.log10(g)) : -96);

export function soundFileName(cue) {
  return `sound-${cue}.wav`;
}

// A text-to-SFX prompt for one cue in one spell: the cue's prompt plus the
// element's flavor words and what to keep out.
export function cuePrompt(def, flavor, element = "") {
  const base = def?.sfx_prompt || def?.describes || "";
  const parts = [base];
  if (flavor?.words) parts.push(`${element ? `${element[0].toUpperCase()}${element.slice(1)} spell` : "Flavor"}: ${flavor.words}`);
  if (flavor?.avoid) parts.push(`No ${flavor.avoid.replace(/,\s*/g, ", no ")}`);
  return parts.filter(Boolean).join(". ") + (parts.length > 1 ? "." : "");
}

// How long to ask a generator for, in seconds. One-shots get their length plus
// room for the tail. Sustained cues up to 2 s (and shaped ones like charge and
// drain, which swell and cut) get exactly the length they play for; longer
// ones get a 2-4 s seamless loop. sourceMs already allows for the pitch.
const SHAPED = new Set(["charge", "drain"]);
function generateFor(id, def, sourceMs) {
  const s = sourceMs / 1000;
  if (def.kind !== "sustained") return { duration_s: r1(Math.min(30, Math.max(0.5, s + 0.3))), loop: false };
  if (SHAPED.has(id) || s <= 2) return { duration_s: r1(Math.min(30, Math.max(0.5, s))), loop: false };
  return { duration_s: r1(Math.min(4, Math.max(2, s))), loop: true };
}

// soundSheet(template, seed, library, {frameOf}) -> the cue sheet object.
// frameOf(ms) maps a time to the export's frame number (optional).
export function soundSheet(template, seed, library = {}, { frameOf } = {}) {
  const cues = library.cues || {};
  const element = template.element || "";
  const flavor = (library.flavors || {})[element] || null;
  const beats = template.beats || [];
  const events = soundEvents(template, seed, library);
  const layerBeats = Object.fromEntries((template.layers || []).map((l) => [l.id, l.beats || []]));

  const beatFor = (e) => {
    const own = beats.filter((b) => (layerBeats[e.layer] || []).includes(b.id));
    return own.find((b) => e.at >= b.start_ms && e.at < b.end_ms) || own.find((b) => e.at >= b.start_ms) || own[0] || null;
  };

  // An aura's seamless loop: sounds inside it repeat every loop.
  const lr = loopRange(template);
  const out = events.map((e) => {
    const b = beatFor(e);
    const phase = b?.phase || null;
    const ev = {
      at_ms: r1(e.at),
      ...(frameOf ? { frame: frameOf(e.at) } : {}),
      cue: e.cue,
      file: e.known ? soundFileName(e.cue) : null,
      layer: e.layer,
      beat: b?.id || null,
      phase,
      role: ROLE[phase] || null,
      kind: e.kind,
      loop: e.kind === "sustained",
      duration_ms: r1(e.dur),
      end_ms: r1(e.at + e.dur),
      gain: r2(e.gain),
      volume_db: db(e.gain),
      pitch: r2(e.rate),
    };
    if (lr) {
      // intro: plays once when the aura starts; loop: repeats every loop
      // (a sustained cue spanning the loop is held while the aura lasts);
      // outro: plays once when it ends.
      ev.section = e.at < lr.start ? "intro" : e.at < lr.end ? "loop" : "outro";
      ev.in_loop = ev.section === "loop" || (e.kind === "sustained" && e.at <= lr.start && e.at + e.dur >= lr.end);
    }
    return ev;
  });

  const used = [...new Set(out.map((e) => e.cue))];
  const cueOut = used.map((id) => {
    const def = cues[id];
    const evs = out.filter((e) => e.cue === id);
    const longest = Math.max(...evs.map((e) => e.duration_ms));
    // A file played at pitch p lasts 1/p as long, so a sped-up sustained cue needs more source.
    const sourceMs = r1(Math.max(...evs.map((e) => e.duration_ms * (e.kind === "sustained" ? Math.max(1, e.pitch) : 1))));
    const pitches = evs.map((e) => e.pitch);
    if (!def) {
      return { cue: id, known: false, plays: evs.length, note: "Not in the cue library: describe it yourself from the layer and beat it plays in." };
    }
    return {
      cue: id,
      known: true,
      file: soundFileName(id),
      label: def.label,
      kind: def.kind,
      loop: def.kind === "sustained",
      describes: def.describes,
      character: def.character || null,
      plays: evs.length,
      layers: [...new Set(evs.map((e) => e.layer))],
      roles: [...new Set(evs.map((e) => e.role).filter(Boolean))],
      longest_ms: longest,
      source_ms: sourceMs,
      pitch_range: [Math.min(...pitches), Math.max(...pitches)],
      prompt: cuePrompt(def, flavor, element),
      generate: { ...generateFor(id, def, sourceMs), takes: evs.length > 1 ? 3 : 2 },
      synth: def.synth || "",
      search: def.search || [],
      samples: def.samples || [],
    };
  });

  const story = beats.map((b) => {
    const here = out.filter((e) => e.beat === b.id);
    if (!here.length) return null;
    return `${b.start_ms}-${b.end_ms} ms ${b.id} (${b.phase}): ${[...new Set(here.map((e) => e.cue))].join(" + ")}`;
  }).filter(Boolean);

  return {
    format: SOUND_SHEET_FORMAT,
    spell: {
      id: template.id,
      name: template.name,
      element: element || null,
      description: template.description || "",
      duration_ms: template.timing?.duration_ms ?? null,
      loop: !!template.timing?.loop,
      loop_range: lr ? { start_ms: lr.start, end_ms: lr.end } : null,
    },
    seed,
    flavor,
    story,
    cues: cueOut,
    events: out,
    mix: {
      peak_dbfs: -1,
      note: "volume_db is relative to full scale for that cue's own file: normalize every file to a -1 dBFS peak, then play it at volume_db. Impacts are the loudest moment; build-ups and tails sit under them.",
      pitch_note: "pitch is a playback-rate multiplier (1 = as recorded); a range across events means each cast or hit varies.",
    },
  };
}
