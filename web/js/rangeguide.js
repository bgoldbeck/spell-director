// Range guide: measures how wide a spell's parts read (its whole visible
// envelope and its white-hot core, across the cast direction, at stations from
// the hand to the target, plus the plume where it lands) and renders the
// frames tools/range_guide.py lays out into an annotated guide sheet.
// Browser only (WebGL). The maths and the template fields are in
// engine/readability.js.
//
// Everything is drawn with an orthographic side camera, so pixels map to world
// units exactly (ppu pixels per unit; 1 unit = one character height). The
// effect is drawn alone, without the set or stand-ins, like the sprite export.

import * as THREE from "three";
import { Effect } from "./engine/effect.js";
import { Post } from "./engine/post.js";
import { resolveStyle } from "./engine/style.js";
import { framePlan } from "./engine/spritesheet.js";
import {
  boxIn, columnExtent, coreMask, countSet, median, resolveReadability, screenPx, trackingFor, visibleMask,
} from "./engine/readability.js";

const STATIONS = [0.05, 0.25, 0.5, 0.75, 0.9]; // the first sits just off the hand

function makeScene(effect) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
  const key = new THREE.DirectionalLight("#cfd6ff", 0.5);
  key.position.set(-3, 6, 4);
  scene.add(key);
  scene.add(effect.group);
  return scene;
}

function solo(effect, ids) {
  if (!ids) return () => {};
  const saved = effect.layers.map((l) => l.group.visible);
  for (const l of effect.layers) if (!ids.has(l.def.id)) l.group.visible = false;
  return () => effect.layers.forEach((l, i) => (l.group.visible = saved[i]));
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

// The side-on window the guide draws: from behind the caster to past the
// furthest target, ground to well over head height.
function frameBox(stage) {
  const xs = [stage.caster.x, stage.point.x, ...stage.targets.map((p) => p.x)];
  const zs = stage.targets.map((p) => Math.abs(p.z));
  const reach = Math.max(...xs, 0.5);
  const back = Math.min(...xs, 0);
  const tall = Math.min(Math.max(stage.sky?.y ?? 2, 2.2), 6);
  return { x0: back - 0.8 - Math.max(0, ...zs) * 0.2, x1: reach + 1.1, y0: -0.25, y1: tall > 2.6 ? tall + 0.2 : 3.0 };
}

function sideCamera(box) {
  const cam = new THREE.OrthographicCamera(box.x0, box.x1, box.y1, box.y0, 0.1, 200);
  cam.position.set(0, 0, 60);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

async function pngBytes(canvas) {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * opts: {seed (1), style, ppu (pixels per unit for the measuring frames, default 160)}
 * Returns {readability, geometry, frames: [...per-frame measures], peak, key_frames, cues, layers,
 * images: {name: {width, height, data: PNG bytes}}}.
 */
export async function rangeGuide(template, opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const ppu = Math.max(40, Math.min(400, opts.ppu || 160));
  const style = resolveStyle(template, opts.style);
  const effect = new Effect(template, seed, { style });
  const stage = effect.stage;
  const scene = makeScene(effect);
  const box = frameBox(stage);
  const W = Math.round((box.x1 - box.x0) * ppu);
  const H = Math.round((box.y1 - box.y0) * ppu);
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const post = new Post(renderer, { bloom: true });
  post.setStyle(style.view);
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  const setSize = (w, h) => {
    renderer.setSize(w, h, false);
    post.setSize(w, h);
    scratch.width = w;
    scratch.height = h;
  };
  setSize(W, H);
  const cam = sideCamera(box);
  const black = new THREE.Color("#000000");
  const grey = new THREE.Color("#808080");
  const grab = (bg, bloom, w = W, h = H, camera = cam) => {
    scene.background = bg;
    post.render([{ scene, camera }], { bloom });
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(renderer.domElement, 0, 0);
    return sctx.getImageData(0, 0, w, h).data;
  };

  // World <-> guide pixels.
  const toPx = (x, y) => [(x - box.x0) * ppu, (box.y1 - y) * ppu];
  const hand = stage.hand;
  const target = stage.targets[0] || stage.point;
  let from = hand.x;
  let to = target.x;
  if (to - from < 0.5) {
    // Nothing to cross (a self buff, a point-blank burst): stations across the frame instead.
    from = box.x0 + 0.3;
    to = box.x1 - 0.3;
  }
  const stations = STATIONS.map((u) => ({ u, x: from + (to - from) * u, px: Math.round((from + (to - from) * u - box.x0) * ppu) }));
  const plumeCols = [Math.round((target.x - 0.7 - box.x0) * ppu), Math.round((target.x + 0.9 - box.x0) * ppu)];

  const undoAll = solo(effect, new Set());
  const ref = grab(grey, false).slice();
  undoAll();

  const units = (px) => (px == null ? null : Math.round((px / ppu) * 1000) / 1000);
  const measure = (ids) => {
    const undo = solo(effect, ids);
    const onGrey = grab(grey, false);
    const vis = visibleMask(onGrey, ref, W, H);
    const onBlack = grab(black, false);
    const core = coreMask(onBlack, W, H);
    undo();
    const st = stations.map((s) => {
      const v = columnExtent(vis, W, H, s.px);
      const c = columnExtent(core, W, H, s.px);
      return { u: s.u, envelope: units(v?.px), core: units(c?.px), envelope_px: v ? [v.y0, v.y1] : null, core_px: c ? [c.y0, c.y1] : null };
    });
    const all = boxIn(vis, W, H);
    const plume = boxIn(vis, W, H, plumeCols[0], plumeCols[1]);
    return {
      area: countSet(vis) / (ppu * ppu),
      core_area: countSet(core) / (ppu * ppu),
      stations: st,
      envelope: median(st.map((s) => s.envelope)),
      core: median(st.map((s) => s.core)),
      box: all ? { x0: all.x0, y0: all.y0, x1: all.x1, y1: all.y1, w: units(all.w), h: units(all.h) } : null,
      plume: plume ? { x0: plume.x0, y0: plume.y0, x1: plume.x1, y1: plume.y1, w: units(plume.w), h: units(plume.h) } : null,
    };
  };

  // Pass 1: measure every frame.
  const plan = framePlan(template, { fps: opts.fps || 30 });
  const frames = [];
  for (let f = 0; f < plan.count; f++) {
    const t = plan.times[f];
    effect.update(t);
    frames.push({ t_ms: Math.round(t), ...measure(null) });
    if (f % 4 === 3) await nextTick();
  }
  // The peak: the frame where most of the spell is on screen.
  const peak = frames.reduce((a, b) => (b.area > a.area ? b : a), frames[0]);

  const r = resolveReadability(template);

  // Must-read cues, each measured on its own layers at its beat (or the peak).
  const beats = Object.fromEntries((template.beats || []).map((b) => [b.id, b]));
  const cues = [];
  for (const c of r.must_read) {
    const b = c.beat && beats[c.beat];
    const t = c.at_ms ?? (b ? Math.round((b.start_ms + b.end_ms) / 2) : peak.t_ms);
    effect.update(t);
    const ids = c.layers.length ? new Set(c.layers) : null;
    const m = measure(ids);
    const elongated = m.box && m.box.w > 2 * m.box.h;
    const kind = c.measure || (elongated ? "thickness" : "size");
    const size = kind === "core" ? m.core : kind === "thickness" ? m.envelope : kind === "start" ? m.stations[0].envelope
      : m.box ? Math.max(m.box.w, m.box.h) : null;
    // Marks flat on the ground have no thickness side-on: judge them in the top view.
    const flat = c.layers.length && c.layers.every((id) => {
      const l = (template.layers || []).find((x) => x.id === id);
      return l && (l.type === "decal" || l.plane === "ground");
    });
    cues.push({ ...c, t_ms: t, flat_on_ground: !!flat, window_ms: b ? [b.start_ms, b.end_ms] : [t, t], measure: kind, size, box: m.box, stations: m.stations });
  }

  // Display images: the peak and each key frame, with bloom, on black.
  const images = {};
  const shoot = async (name, t, ids = null) => {
    effect.update(t);
    const undo = solo(effect, ids);
    grab(black, true);
    undo();
    images[name] = { width: W, height: H, data: await pngBytes(scratch) };
  };
  await shoot("peak", peak.t_ms);
  const keys = [];
  for (const [i, k] of r.key_frames.entries()) {
    effect.update(k.t_ms);
    keys.push({ ...k, measured: { ...measure(null), t_ms: k.t_ms } });
    await shoot(`key-${i}`, k.t_ms);
  }

  // How the peak frame looks from each gameplay distance: drawn at the
  // pixels per unit a 1080p, 60 degree camera that far away would give.
  for (const d of [r.reference_distance, ...r.view_distances]) {
    const p = screenPx(1, d);
    const w = Math.max(8, Math.round((box.x1 - box.x0) * p));
    const h = Math.max(8, Math.round((box.y1 - box.y0) * p));
    setSize(w, h);
    effect.update(peak.t_ms);
    grab(black, true, w, h);
    images[`distance-${d}`] = { width: w, height: h, distance: d, ppu: p, data: await pngBytes(scratch) };
  }
  setSize(W, H);
  renderer.dispose();

  const layers = (template.layers || []).map((l) => ({
    id: l.id, type: l.type, anchor: l.anchor || "target", tracking: trackingFor(l), tracking_source: l.tracking ? "template" : "default",
  }));
  return {
    template: { id: template.id, name: template.name, element: template.element, archetype: template.archetype, duration_ms: template.timing?.duration_ms },
    seed,
    style: style.id,
    readability: r,
    geometry: {
      ppu, width: W, height: H, box,
      hand: toPx(hand.x, hand.y), caster: toPx(stage.caster.x, 0), target: toPx(target.x, 0),
      target_distance: Math.round(Math.hypot(target.x - stage.caster.x, target.z - stage.caster.z) * 100) / 100,
      stations, plume_columns: plumeCols,
    },
    frames,
    peak,
    key_frames: keys,
    cues,
    layers,
    images,
  };
}
