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
import { GIF_VIEWS, coverageBox, fitFrame, gifFileName, gifPlan, gifSize } from "./gifplan.js";

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
 *        and pixel art), fit (default true: widen each view to keep the whole spell in
 *        frame), onProgress}
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
  const used = new Set(views.flatMap((v) => (v === "quad" ? VIEWS : [v])));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d", { willReadFrequently: true });

  // One frame of one view, as the viewer would show it, in RGBA.
  const draw = (view, t) => {
    effect.update(t);
    studio.update(t);
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

  // Widen each camera so everything the spell draws over the GIF stays in
  // frame. The spell alone is drawn on grey through a camera zoomed out
  // SCAN_ZOOM times, frame by frame, and every pixel that differs from the
  // empty grey counts toward its row and column. The camera then frames the
  // box holding nearly all of it (coverageBox), so a stray wisp of smoke
  // drifting past the lens doesn't shrink the spell to a speck.
  const SCAN_ZOOM = 3;
  const SCAN_MIN = 16; // how far (0-255) from the empty grey a pixel must be to count: faint smoke tails and haze do not
  const frameCameras = async () => {
    const scanScene = new THREE.Scene();
    scanScene.background = new THREE.Color("#808080");
    scanScene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
    const ox = (-W * (SCAN_ZOOM - 1)) / 2;
    const oy = (-H * (SCAN_ZOOM - 1)) / 2;
    const grab = (cam) => {
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, W, H);
      renderer.setScissorTest(false);
      renderer.render(scanScene, cam);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const boxes = {};
    const refs = {};
    for (const v of used) {
      cams[v].setViewOffset(W, H, ox, oy, W * SCAN_ZOOM, H * SCAN_ZOOM);
      refs[v] = grab(cams[v]).slice();
      boxes[v] = { cols: new Float64Array(W), rows: new Float64Array(H) };
    }
    studio.scene.remove(effect.group);
    scanScene.add(effect.group);
    try {
      for (let i = 0; i < plan.times.length; i++) {
        effect.update(plan.times[i]);
        for (const v of used) {
          const px = grab(cams[v]);
          const ref = refs[v];
          const b = boxes[v];
          for (let y = 0, k = 0; y < H; y++) {
            for (let x = 0; x < W; x++, k += 4) {
              if (Math.abs(px[k] - ref[k]) > SCAN_MIN || Math.abs(px[k + 1] - ref[k + 1]) > SCAN_MIN || Math.abs(px[k + 2] - ref[k + 2]) > SCAN_MIN) {
                b.cols[x]++;
                b.rows[y]++;
              }
            }
          }
        }
        progress({ stage: "framing", view: views[0], done: 0, total: 1 });
        if (i % 4 === 3) await nextTick();
      }
    } finally {
      scanScene.remove(effect.group);
      studio.scene.add(effect.group);
    }
    const framing = {};
    for (const v of used) {
      const b = coverageBox(boxes[v].cols, boxes[v].rows);
      const box = b ? { x0: ox + b.x0 * SCAN_ZOOM, y0: oy + b.y0 * SCAN_ZOOM, x1: ox + (b.x1 + 1) * SCAN_ZOOM - 1, y1: oy + (b.y1 + 1) * SCAN_ZOOM - 1 } : null;
      const f = fitFrame(box, W, H);
      if (f) cams[v].setViewOffset(W, H, f.x, f.y, f.w, f.h);
      else cams[v].clearViewOffset();
      cams[v].updateProjectionMatrix();
      framing[v] = f ? Math.round((f.w / W) * 100) / 100 : 1;
    }
    return framing;
  };

  const n = plan.times.length;
  const total = views.length * n * 2;
  let done = 0;
  const files = [];
  try {
    const zoom = opts.fit === false ? null : await frameCameras();
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
    return { plan: { ...plan, seed, style: style.id, width: W, height: H, views, zoom_out: zoom }, files };
  } finally {
    studio.scene.remove(effect.group);
    effect.dispose();
    studio.dispose();
    post.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}
