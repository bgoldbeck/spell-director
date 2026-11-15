// Sprite sheet export: renders a template + seed into one sheet per layer
// (plus one for the whole spell; columns are frames, rows are views),
// plus a JSON manifest and a Markdown assembly guide. Browser only (WebGL).
// The layout, manifest and guide come from engine/spritesheet.js.
//
// Frames are rendered twice, on black and on white, and the two are compared
// to recover a straight-alpha image on a transparent background. That works
// for additive glows and for normal-blended smoke alike. Bloom (on by default,
// like the viewer) is additive light, so it is measured on black and added to
// both passes before the comparison. Camera shake and screen flashes are left
// out of the pixels and exported as curves instead.

import * as THREE from "three";
import { Effect } from "./engine/effect.js";
import { viewCamera } from "./engine/stage.js";
import { Post } from "./engine/post.js";
import { tintDecal } from "./engine/decaltex.js";
import {
  ALL_ID, DEFAULTS, SHEET_VIEWS, buildManifest, buildTracks, cellRect, framePlan, guideMarkdown, layoutSheet,
  sheetFileName, spriteLayers, visibleRange,
} from "./engine/spritesheet.js";

const VISIBLE = 3; // a pixel channel above this (0-255) on black counts as drawn

function makeRenderer(size) {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function makeScene(effect) {
  const scene = new THREE.Scene();
  // Same lights as the viewer, for any lit material. No ground, grid or stand-ins.
  scene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
  const key = new THREE.DirectionalLight("#cfd6ff", 0.5);
  key.position.set(-3, 6, 4);
  scene.add(key);
  scene.add(effect.group);
  return scene;
}

function project(p, cam, size) {
  const v = p.clone().project(cam);
  return [Math.round(((v.x + 1) / 2) * size * 10) / 10, Math.round(((1 - v.y) / 2) * size * 10) / 10];
}

function viewInfo(stage, cam, size) {
  const target = stage.targets[0] || stage.point.clone().setY(0);
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const a = project(target, cam, size);
  const b = project(target.clone().add(right), cam, size);
  return {
    camera: cam.isOrthographicCamera ? "orthographic" : "perspective",
    pivots: { caster: project(stage.caster, cam, size), target: a, sky: project(stage.sky, cam, size) },
    px_per_unit: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 10) / 10,
  };
}

// Show only the layers in `ids` (null = all) after an update; returns an undo.
function solo(effect, ids) {
  if (!ids) return () => {};
  const saved = effect.layers.map((l) => l.group.visible);
  for (const l of effect.layers) if (!ids.has(l.def.id)) l.group.visible = false;
  return () => effect.layers.forEach((l, i) => (l.group.visible = saved[i]));
}

function grab(post, scene, cam, bg, ctx, size, bloom = false) {
  scene.background = bg;
  post.render([{ scene, camera: cam }], { bloom });
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(post.renderer.domElement, 0, 0);
  return ctx.getImageData(0, 0, size, size).data;
}

// The bloom's own light (bloomed minus plain, both on black), added to the
// white pass. Its faintest tail (a few levels out of 255) is dropped from both:
// at small cell sizes the widest bloom level is only a few pixels across and
// would show up as a faint square.
const BLOOM_FLOOR = 4;
export function addBloom(white, plainBlack, bloomedBlack) {
  for (let i = 0; i < white.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let glow = bloomedBlack[i + c] - plainBlack[i + c];
      glow = glow > BLOOM_FLOOR ? glow - BLOOM_FLOOR : 0;
      bloomedBlack[i + c] = plainBlack[i + c] + glow;
      white[i + c] = Math.min(255, white[i + c] + glow);
    }
  }
  return white;
}

// Black/white difference matte -> straight-alpha RGBA.
export function matte(black, white, out) {
  for (let i = 0; i < black.length; i += 4) {
    const br = black[i], bg = black[i + 1], bb = black[i + 2];
    const diff = (white[i] - br + white[i + 1] - bg + white[i + 2] - bb) / 3;
    const a = Math.max(br, bg, bb, 255 - diff);
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    out[i] = Math.min(255, br * k);
    out[i + 1] = Math.min(255, bg * k);
    out[i + 2] = Math.min(255, bb * k);
    out[i + 3] = Math.min(255, a);
  }
  return out;
}

function anyDrawn(px) {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > VISIBLE || px[i + 1] > VISIBLE || px[i + 2] > VISIBLE) return true;
  }
  return false;
}

// Grow box {x0, y0, x1, y1} (pixels) to hold every drawn pixel. Returns whether any were drawn.
function growBox(px, size, box) {
  let any = false;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (px[i] > VISIBLE || px[i + 1] > VISIBLE || px[i + 2] > VISIBLE) {
        any = true;
        if (x < box.x0) box.x0 = x;
        if (y < box.y0) box.y0 = y;
        if (x > box.x1) box.x1 = x;
        if (y > box.y1) box.y1 = y;
      }
    }
  }
  return any;
}

// Zoom a view's camera onto the square around everything the spell draws, so
// the effect fills the cells. Same crop for every frame, so frames stay aligned.
export function cropSquare(box, size, margin = 0.08) {
  if (!(box.x1 >= box.x0)) return null;
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const side = Math.max(8, Math.max(w, h) * (1 + 2 * margin) + 2);
  const cx = (box.x0 + box.x1 + 1) / 2;
  const cy = (box.y0 + box.y1 + 1) / 2;
  return { x: cx - side / 2, y: cy - side / 2, side };
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

function toPng(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
}

/**
 * Export sprite sheets.
 * opts: {seed, frame, fps, views, layers (true = layer rows), bloom (default true), maxWidth, cueLibrary, version, onProgress}
 * Returns {manifest, files: [{name, data: Uint8Array | string}]}.
 */
export async function exportSpriteSheets(template, opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const size = Math.max(32, Math.min(1024, Math.round(opts.frame || DEFAULTS.frame)));
  const views = (opts.views?.length ? opts.views : SHEET_VIEWS).filter((v) => SHEET_VIEWS.includes(v));
  const withLayers = opts.layers !== false;
  const bloom = opts.bloom !== false;
  const plan = framePlan(template, { fps: opts.fps });
  const progress = opts.onProgress || (() => {});

  const effect = new Effect(template, seed);
  const scene = makeScene(effect);
  const renderer = makeRenderer(size);
  const post = new Post(renderer, { bloom });
  post.setSize(size, size);
  const scratch = document.createElement("canvas");
  scratch.width = scratch.height = size;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const black = new THREE.Color("#000000");
  const white = new THREE.Color("#ffffff");
  const cams = Object.fromEntries(views.map((v) => {
    const cam = viewCamera(v, effect.stage, 1);
    cam.updateMatrixWorld();
    return [v, cam];
  }));

  try {
    // Pass 1: find which frames each layer shows in, over all views.
    const sprites = withLayers ? spriteLayers(template) : [];
    const ids = [...new Set(sprites.map((l) => l.id))];
    const flags = Object.fromEntries(ids.map((id) => [id, new Array(plan.count).fill(false)]));
    const allFlags = new Array(plan.count).fill(false);
    const boxes = Object.fromEntries(views.map((v) => [v, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }]));
    const work1 = plan.count * views.length * (ids.length + 1);
    let done = 0;
    for (let f = 0; f < plan.count; f++) {
      effect.update(plan.times[f]);
      for (const v of views) {
        for (const id of [null, ...ids]) {
          const undo = solo(effect, id ? new Set([id]) : null);
          const px = grab(post, scene, cams[v], black, sctx, size, bloom);
          const drawn = id ? anyDrawn(px) : growBox(px, size, boxes[v]);
          undo();
          if (id) flags[id][f] ||= drawn;
          else allFlags[f] ||= drawn;
          done++;
        }
      }
      progress({ stage: "scan", done, total: work1 });
      if (f % 4 === 3) await nextTick();
    }
    const visible = Object.fromEntries(ids.map((id) => [id, visibleRange(flags[id])]));
    for (const v of views) {
      const c = cropSquare(boxes[v], size);
      if (c) cams[v].setViewOffset(size, size, c.x, c.y, c.side, c.side);
      cams[v].updateProjectionMatrix();
    }

    // The whole-spell sheet always covers every frame, so it doubles as the master timeline.
    const maxWidth = opts.maxWidth || DEFAULTS.maxWidth;
    const sheets = [{ id: ALL_ID, first: 0, count: plan.count }];
    for (const id of ids) {
      const r = visible[id];
      if (r) sheets.push({ id, first: r.first, count: r.last - r.first + 1 });
    }
    for (const sh of sheets) {
      sh.layout = layoutSheet(sh.count, views.length, { frame: size, maxWidth });
      sh.canvas = document.createElement("canvas");
      sh.canvas.width = sh.layout.width;
      sh.canvas.height = sh.layout.height;
      sh.ctx = sh.canvas.getContext("2d");
    }

    // Pass 2: draw the sheets. Columns are frames, rows are views.
    const cellImg = new ImageData(size, size);
    const work2 = plan.count;
    for (let f = 0; f < plan.count; f++) {
      effect.update(plan.times[f]);
      views.forEach((v, row) => {
        for (const sh of sheets) {
          const k = f - sh.first;
          if (k < 0 || k >= sh.count) continue;
          const undo = solo(effect, sh.id === ALL_ID ? null : new Set([sh.id]));
          const b = grab(post, scene, cams[v], black, sctx, size).slice();
          const w = grab(post, scene, cams[v], white, sctx, size).slice();
          let lit = b;
          if (bloom) {
            lit = grab(post, scene, cams[v], black, sctx, size, true).slice();
            addBloom(w, b, lit);
          }
          undo();
          matte(lit, w, cellImg.data);
          const r = cellRect(sh.layout, row, k);
          sh.ctx.putImageData(cellImg, r.x, r.y);
        }
      });
      progress({ stage: "draw", done: f + 1, total: work2 });
      if (f % 2 === 1) await nextTick();
    }

    const viewMeta = Object.fromEntries(views.map((v) => [v, viewInfo(effect.stage, cams[v], size)]));
    const tracks = buildTracks(template, seed, plan, opts.cueLibrary);
    const manifest = buildManifest({ template, seed, plan, sheets, visible, views: viewMeta, tracks, version: opts.version, frame: size, bloom });
    const base = template.id;
    const extra = [
      { name: `${base}.spritesheet.json`, about: "The same data as this guide, machine-readable" },
      { name: `${base}.guide.md`, about: "This guide" },
      { name: `${base}.template.json`, about: "The SpellDirector template the sheets were made from" },
    ];
    const files = [];
    for (const sh of sheets) {
      files.push({ name: sheetFileName(sh.id), data: new Uint8Array(await (await toPng(sh.canvas)).arrayBuffer()) });
      progress({ stage: "encode", sheet: sh.id });
    }
    // Decal textures for engine decal projectors (top-down, color baked in).
    for (const d of manifest.decals) {
      const layer = effect.layers.find((l) => l.def.id === d.layer && l.instance === 0);
      if (!layer?.canvas) continue;
      files.push({ name: d.texture, data: new Uint8Array(await (await toPng(tintDecal(layer.canvas, d.color))).arrayBuffer()) });
    }
    files.push({ name: extra[0].name, data: `${JSON.stringify(manifest, null, 2)}\n` });
    files.push({ name: extra[1].name, data: guideMarkdown(manifest, { files: extra }) });
    files.push({ name: extra[2].name, data: `${JSON.stringify(template, null, 2)}\n` });
    return { manifest, files };
  } finally {
    scene.remove(effect.group);
    effect.dispose();
    post.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  }
}
