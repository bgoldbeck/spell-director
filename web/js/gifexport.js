// GIF export: records the spell as the viewer shows it (set, stand-ins,
// bloom, art style, camera shake, screen flashes) from any of the camera
// views, one looping animated GIF per view. Browser only (WebGL).
//
// Each view is rendered twice: once to build its palette from every frame,
// then again to write the frames. The viewer is a pure function of
// (template, seed, time), so both passes draw the same pictures, and no view
// ever holds all its frames in memory.

import * as THREE from "three";
import { Effect } from "./engine/effect.js";
import { Post } from "./engine/post.js";
import { VIEWS, viewCamera } from "./engine/stage.js";
import { makeStudio, quadViewports, screenOverlays, shakeCamera } from "./engine/studio.js";
import { resolveStyle } from "./engine/style.js";
import { GifWriter, histogram, medianCut } from "./gif.js";
import { GIF_VIEWS, gifFileName, gifPlan, gifSize } from "./gifplan.js";

export { GIF_VIEWS, GIF_VIEW_LABELS, gifFileName, gifPlan, gifSize } from "./gifplan.js";

function drawLabels(ctx, W, H) {
  // The viewer's "All four" quadrant labels and dividers.
  const hw = Math.floor(W / 2);
  const hh = Math.floor(H / 2);
  ctx.save();
  ctx.fillStyle = "#2a2d38";
  ctx.fillRect(hw, 0, 1, H);
  ctx.fillRect(0, hh, W, 1);
  ctx.fillStyle = "#9a9daa";
  ctx.font = `${Math.max(9, Math.round(H / 40))}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  const pad = Math.max(6, Math.round(W / 60));
  [["FRONT", 0, hh], ["SIDE", hw, hh], ["TOP", 0, H], ["3/4", hw, H]].forEach(([t, x, y]) => ctx.fillText(t, x + pad, y - pad * 0.7));
  ctx.restore();
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Export animated GIFs of a template.
 * opts: {seed, views (front, side, top, three_quarter, quad; default all), width,
 *        fps, speed, length ("spell" | "loop"), style, bloom (default true),
 *        hidden (layer ids to leave out), dither (0..1, default 0.5; always 0 for toon
 *        and pixel art), onProgress}
 * Returns {plan, files: [{name, view, data: Uint8Array, width, height, frames}]}.
 */
export async function exportGifs(template, opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const views = (opts.views?.length ? opts.views : GIF_VIEWS).filter((v) => GIF_VIEWS.includes(v));
  if (!views.length) throw new Error("no views to export");
  const { width: W, height: H } = gifSize(opts.width);
  const plan = gifPlan(template, opts);
  const progress = opts.onProgress || (() => {});
  const style = resolveStyle(template, opts.style);
  // Toon and pixel art are flat color on purpose: no dither dots on them.
  const flat = style.view.posterize > 0 || style.view.pixel > 0;
  const dither = flat ? 0 : opts.dither ?? 0.5;

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const post = new Post(renderer, { bloom: opts.bloom !== false, toneMap: true });
  post.setStyle(style.view);
  post.setSize(W, H);
  const studio = makeStudio();
  const effect = new Effect(template, seed, { style });
  for (const id of opts.hidden || []) effect.setHidden(id, true);
  studio.scene.add(effect.group);
  studio.setStage(effect.stage);
  const cams = Object.fromEntries(VIEWS.map((v) => {
    const cam = viewCamera(v, effect.stage, W / H);
    cam.updateMatrixWorld();
    return [v, cam];
  }));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d", { willReadFrequently: true });

  // One frame of one view, as the viewer would show it, in RGBA.
  const draw = (view, t) => {
    effect.update(t);
    const list = view === "quad"
      ? Object.entries(quadViewports(W, H)).map(([v, port]) => ({ scene: studio.scene, camera: cams[v], ...port }))
      : [{ scene: studio.scene, camera: cams[view] }];
    const undo = list.map((v) => shakeCamera(v.camera, effect.shake));
    list.forEach((v) => v.camera.updateMatrixWorld());
    post.render(list);
    undo.forEach((u) => u());
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(canvas, 0, 0);
    const { flash, dim } = screenOverlays(effect);
    if (flash) {
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = flash.opacity;
      ctx.fillStyle = flash.color;
      ctx.fillRect(0, 0, W, H);
    }
    if (dim) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = dim.opacity;
      ctx.fillStyle = dim.color;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (view === "quad") drawLabels(ctx, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };

  const n = plan.times.length;
  const total = views.length * n * 2;
  let done = 0;
  const files = [];
  try {
    for (const view of views) {
      // Pass 1: the palette, from every frame.
      let hist;
      for (let i = 0; i < n; i++) {
        hist = histogram([draw(view, plan.times[i])], hist);
        progress({ stage: "palette", view, done: ++done, total });
        if (i % 4 === 3) await nextTick();
      }
      // Pass 2: write the frames.
      const gif = new GifWriter({ width: W, height: H, palette: medianCut(hist), dither });
      for (let i = 0; i < n; i++) {
        gif.addFrame(draw(view, plan.times[i]), plan.delays[i]);
        progress({ stage: "frames", view, done: ++done, total });
        if (i % 2 === 1) await nextTick();
      }
      files.push({ name: gifFileName(template.id, seed, style.id, view), view, data: gif.finish(), width: W, height: H, frames: n });
    }
    return { plan: { ...plan, seed, style: style.id, width: W, height: H, views }, files };
  } finally {
    studio.scene.remove(effect.group);
    effect.dispose();
    studio.dispose();
    post.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}
