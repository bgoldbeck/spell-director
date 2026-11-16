// What a GIF export records: views, file names, size and the frame plan.
// Pure (no three.js), so node tests can check it. web/js/gifexport.js renders.

import { loopRange } from "./engine/timeline.js";
import { gifDelays } from "./gif.js";

export const GIF_VIEWS = ["front", "side", "top", "three_quarter", "quad"];
export const GIF_VIEW_LABELS = { front: "Front", side: "Side", top: "Top", three_quarter: "3/4", quad: "All four" };
export const GIF_DEFAULTS = { width: 480, fps: 20, speed: 1 };
export const GIF_ASPECT = 4 / 3;
const FILE_SLUG = { front: "front", side: "side", top: "top", three_quarter: "three-quarter", quad: "four-views" };

export function gifFileName(templateId, seed, styleId, view) {
  const style = styleId && styleId !== "stylized" ? `-${styleId}` : "";
  return `${templateId}-seed${seed}${style}-${FILE_SLUG[view] || view}.gif`;
}

/** Width and height of a GIF of the given width (4:3, both even). */
export function gifSize(width) {
  const w = Math.max(64, Math.min(1280, Math.round((width || GIF_DEFAULTS.width) / 2) * 2));
  return { width: w, height: Math.round(w / GIF_ASPECT / 2) * 2 };
}

/**
 * Which moments to record and how long to show each.
 * opts.length: "spell" (0 to the end) or "loop" (an aura's seamless sustain
 * loop, which repeats with no seam as a looping GIF; default for auras).
 * opts.speed slows the spell down (0.5 = half speed) without changing the
 * GIF's frame rate.
 * Returns {times (spell ms), delays (1/100 s), fps, speed, length, start_ms, end_ms}.
 */
export function gifPlan(template, { fps, speed, length } = {}) {
  const f = Math.max(5, Math.min(50, Math.round(fps || GIF_DEFAULTS.fps)));
  const sp = Math.max(0.05, Math.min(4, Number(speed) || GIF_DEFAULTS.speed));
  const lr = loopRange(template);
  const mode = length === "spell" || length === "loop" ? length : lr ? "loop" : "spell";
  const step = (sp * 1000) / f; // spell ms per GIF frame
  let start = 0;
  let end = template.timing?.duration_ms ?? 1000;
  let count;
  let dt;
  if (mode === "loop" && lr) {
    // A whole number of frames in the loop, so the GIF wraps with no seam.
    start = lr.start;
    end = lr.end;
    count = Math.max(1, Math.round(lr.len / step));
    dt = lr.len / count;
  } else {
    count = Math.max(1, Math.ceil(end / step - 1e-9));
    dt = step;
  }
  const times = Array.from({ length: count }, (_, i) => start + i * dt);
  return { times, delays: gifDelays(count, dt / sp), fps: f, speed: sp, length: lr && mode === "loop" ? "loop" : "spell", start_ms: start, end_ms: end };
}

