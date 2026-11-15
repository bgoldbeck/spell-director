// Pure helpers for the Analyze page: reading a breakdown (from
// tools/breakdown.py) for display. No DOM, so they run in Node tests too.

import { phaseColor } from "./engine/timeline.js";

export const VIEW_LABELS = { front: "Front", side: "Side", top: "Top", three_quarter: "3/4" };
export const SLOT_ORDER = ["core", "primary", "secondary", "accent", "shadow"];

// Total length of the analysed clip in ms.
export function clipDuration(b) {
  const frames = b.frames || [];
  if (!frames.length) return b.gif?.duration_ms || 0;
  const last = frames[frames.length - 1];
  return last.start_ms + last.duration_ms;
}

// Index of the frame showing at time ms (clamped to the clip).
export function frameAt(frames, ms) {
  if (!frames.length) return -1;
  let lo = 0;
  let hi = frames.length - 1;
  if (ms <= frames[0].start_ms) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].start_ms <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Playback time at wall-clock elapsed ms: loops or holds on the last frame.
export function playTime(elapsed, duration, loop) {
  if (duration <= 0) return 0;
  if (loop) return ((elapsed % duration) + duration) % duration;
  return Math.min(Math.max(elapsed, 0), duration - 1);
}

// Phase bands for the timeline, in ms. A phase covers its frames fully.
export function phaseBands(b) {
  const frames = b.frames || [];
  return (b.timing?.phases || []).map((p) => {
    const last = frames[p.end_frame];
    const end = last ? last.start_ms + last.duration_ms : p.end_ms;
    return { phase: p.phase, start_ms: p.start_ms, end_ms: Math.max(end, p.end_ms), color: phaseColor(p.phase),
      start_frame: p.start_frame, end_frame: p.end_frame };
  });
}

// The phase showing at ms, or null between phases.
export function phaseAt(bands, ms) {
  return bands.find((p) => ms >= p.start_ms && ms < p.end_ms) || null;
}

export function shotBands(b) {
  return (b.shots || []).map((s) => ({ ...s, main: s.shot === b.main_shot }));
}

// Times (ms) where the camera cuts to a new shot.
export function cutTimes(b) {
  return (b.shots || []).slice(1).map((s) => s.start_ms);
}

export function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "–";
  return ms >= 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function percent(v) {
  return v == null ? "–" : `${Math.round(v * 100)}%`;
}

// Plain-language warnings worth showing above the results.
export function warnings(b) {
  const out = [];
  const video = b.gif?.video;
  if (video?.truncated) out.push("Only the first 20 seconds were read. Set Start and End around the spell to analyze the part you want.");
  if (b.bright_background) {
    out.push(`Bright background (luma ${b.background_luma}): the effect measures dimmer than it looks, so trust the clip over the curve.`);
  }
  if ((b.shots || []).length > 1) {
    const main = b.shots[b.main_shot];
    out.push(`${b.shots.length} camera shots. Footprint and view come from the main shot (shot ${b.main_shot + 1}, ${formatMs(main.start_ms)}–${formatMs(main.end_ms)}).`);
  }
  if (!(b.timing?.phases || []).length) out.push("No clear effect was found. Check that the clip shows the spell, or trim it closer.");
  return out;
}

// Palette entries in display order, each with a readable label.
export function swatches(b) {
  return (b.palette || []).map((e) => ({
    hex: e.hex,
    slot: e.suggested_slot || null,
    share: e.share,
    label: e.suggested_slot ? `${e.suggested_slot}` : "unused",
  }));
}

// View guess scores as fractions of the best one, best first.
export function viewScores(b) {
  const g = b.space?.view_guess;
  if (!g) return [];
  const max = Math.max(...Object.values(g.scores), 0.0001);
  return Object.entries(g.scores)
    .map(([view, score]) => ({ view, label: VIEW_LABELS[view] || view, score, fraction: score / max, best: view === g.best }))
    .sort((a, c) => c.score - a.score);
}

// The facts in the Footprint and view card, as [label, value] pairs.
export function spaceFacts(b) {
  const s = b.space || {};
  const facts = [];
  if (s.view_guess) facts.push(["View guess", `${VIEW_LABELS[s.view_guess.best] || s.view_guess.best} (confidence ${s.view_guess.confidence})`]);
  if (s.footprint_bbox) {
    const [x0, y0, x1, y1] = s.footprint_bbox;
    facts.push(["Footprint", `${percent(x1 - x0)} wide × ${percent(y1 - y0)} tall of the frame`]);
  }
  if (s.footprint_aspect != null) facts.push(["Aspect (w/h)", String(s.footprint_aspect)]);
  if (s.radial_evenness != null) facts.push(["Radial evenness", `${s.radial_evenness} (1 = even disc)`]);
  if (s.travel_direction) {
    const t = s.centroid_travel;
    facts.push(["Travel", t && s.travel_direction !== "stationary"
      ? `${s.travel_direction} (dx ${t.dx}, dy ${t.dy})` : s.travel_direction]);
  }
  if (s.shot != null) facts.push(["Measured in", `shot ${s.shot + 1}`]);
  return facts;
}

export function timingFacts(b) {
  const t = b.timing || {};
  const g = b.gif || {};
  const facts = [["Clip", `${formatMs(clipDuration(b))}, ${g.frame_count} frames, ${g.width}×${g.height}`]];
  if (g.video) facts.push(["Video", `${g.video.fps ?? "?"} fps source, sampled at ≤ ${g.video.max_fps} fps from ${g.video.start_s} s`]);
  if (g.trim) facts.push(["Trimmed", `${g.trim.start_s}–${g.trim.end_s} s of ${formatMs(g.trim.source_duration_ms)}`]);
  if (t.effect_start_ms != null) facts.push(["Effect", `${formatMs(t.effect_start_ms)} → ${formatMs(t.effect_end_ms)}`]);
  if (t.main_peak_ms != null) facts.push(["Main peak", `${formatMs(t.main_peak_ms)} (frame ${t.main_peak_frame})`]);
  if (t.peaks?.length > 1) facts.push(["Peaks", t.peaks.map((p) => formatMs(p.ms)).join(", ")]);
  if (t.hold_frames_at_peak != null) facts.push(["Hold at peak", `${t.hold_frames_at_peak} frame${t.hold_frames_at_peak === 1 ? "" : "s"}`]);
  if (t.flicker) facts.push(["Flicker", `${t.flicker.peaks} peaks, ~${t.flicker.hz} Hz`]);
  return facts;
}

// Files to put in the saved .zip, relative to the analysis folder.
export function savedFiles(b) {
  const imgs = b.images || {};
  return ["breakdown.json", ...["contact_sheet", "curves", "palette", "heatmap"].map((k) => imgs[k]).filter(Boolean)];
}

export function slug(name) {
  return String(name || "clip").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "clip";
}

// A compact copy of the breakdown for pasting into a chat: per-frame rows
// keep only what the playbook reads.
export function compactBreakdown(b) {
  const { frames = [], images, ...rest } = b;
  return {
    ...rest,
    frames_columns: ["index", "start_ms", "duration_ms", "intensity", "coverage", "motion", "phase_hint", "shot"],
    frames: frames.map((f) => [f.index, f.start_ms, f.duration_ms, f.intensity, f.coverage, f.motion, f.phase_hint, f.shot ?? 0]),
  };
}

// A request for the director to build a template from this breakdown.
export function directorPrompt(b, summary) {
  const name = b.gif?.source || "reference clip";
  return [
    `Direct a new spell template from this reference breakdown of ${name}, made with the SpellDirector Analyze page.`,
    "Follow docs/director-playbook.md and docs/gif-breakdown-playbook.md. If the original clip is on this machine,",
    `run breakdown_gif on it too (same trim) so you can look at the contact sheet; the numbers below are the same breakdown.`,
    "",
    "Summary:",
    summary || "",
    "",
    "Breakdown (per-frame rows follow frames_columns):",
    "```json",
    JSON.stringify(compactBreakdown(b)),
    "```",
  ].join("\n");
}
