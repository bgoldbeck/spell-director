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


/**
 * Where to point a view's camera so the whole spell stays in frame.
 * `box` {x0, y0, x1, y1} is everything the spell draws over the GIF, in the
 * view's own pixels (0..W, 0..H; it may reach outside them), or null. The
 * view's usual framing is kept and only widened: never zoomed in, so the
 * caster and targets stay in the picture. Returns the camera view offset
 * {x, y, w, h} (w/h = W/H), or null when the usual framing already fits.
 */
export function fitFrame(box, W, H, { margin = 0.06 } = {}) {
  if (!box || !(box.x1 >= box.x0)) return null;
  const padX = (box.x1 - box.x0 + 1) * margin;
  const padY = (box.y1 - box.y0 + 1) * margin;
  const x0 = Math.min(0, box.x0 - padX);
  const y0 = Math.min(0, box.y0 - padY);
  const x1 = Math.max(W, box.x1 + 1 + padX);
  const y1 = Math.max(H, box.y1 + 1 + padY);
  if (x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H) return null;
  // Grow to the view's aspect, around the middle of what must show.
  const aspect = W / H;
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * The box {x0, y0, x1, y1} (inclusive) holding all but `trim` of what was
 * drawn, from per-column and per-row counts of drawn pixels (summed over
 * frames). Trimming a sliver from each side drops stray wisps far from the
 * spell. null if nothing was drawn.
 */
export function coverageBox(cols, rows, trim = 0.005) {
  const span = (counts) => {
    let total = 0;
    for (const c of counts) total += c;
    if (!total) return null;
    const cut = total * trim;
    let lo = 0;
    for (let acc = 0; lo < counts.length - 1 && acc + counts[lo] <= cut; lo++) acc += counts[lo];
    let hi = counts.length - 1;
    for (let acc = 0; hi > lo && acc + counts[hi] <= cut; hi--) acc += counts[hi];
    return [lo, hi];
  };
  const x = span(cols);
  const y = span(rows);
  return x && y ? { x0: x[0], y0: y[0], x1: x[1], y1: y[1] } : null;
}
