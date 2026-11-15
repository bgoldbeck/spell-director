// Sound cue schedule: a pure function of (template, seed, cue library).
// No Web Audio here, so it runs in Node tests. web/js/audio.js plays the
// events; the renderer never depends on what was played.

import { resolveValue, seedFor } from "./timeline.js";

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
//   beat end), or duration_ms if set.
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

    if (def.kind === "sustained") {
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
