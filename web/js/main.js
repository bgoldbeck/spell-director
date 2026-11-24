import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { Effect } from "./engine/effect.js";
import { Post } from "./engine/post.js";
import { cuesAt, eventsBetween, soundEvents } from "./engine/sound.js";
import { SoundPlayer } from "./audio.js";
import { VIEWS, VIEW_LABELS, viewCamera } from "./engine/stage.js";
import { advancePlayhead, beatsAt, loopRange, phaseColor } from "./engine/timeline.js";
import { exportSpriteSheets } from "./exporter.js";
import { rangeGuide } from "./rangeguide.js";
import { STYLE_IDS, resolveStyle } from "./engine/style.js";
import { makeZip } from "./zip.js";
import { makeStudio, quadViewports, screenOverlays, shakeCamera } from "./engine/studio.js";
import { GIF_VIEW_LABELS, exportGifs, gifFileName } from "./gifexport.js";
import { ALL, groupCatalog, isExtra, resolveStart, spellsFor, step, typeLabel } from "./catalog.js";
import { clipNames, clipsWanted, getClip, registerClip } from "./engine/clips.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("canvas"), stage: $("stage"), typeSelect: $("type-select"), spellSelect: $("spell-select"),
  prevSpell: $("prev-spell"), nextSpell: $("next-spell"), spellCount: $("spell-count"), title: $("title"), subtitle: $("subtitle"),
  beatNames: $("beat-names"), beatIntent: $("beat-intent"), cues: $("cues"), time: $("time"),
  replay: $("replay"), play: $("play"), speed: $("speed"), loop: $("loop"), seed: $("seed"), reroll: $("reroll"),
  scrubber: $("scrubber"), bands: $("bands"), beats: $("beats"), description: $("description"),
  palette: $("palette"), notes: $("notes"), layers: $("layers"), focus: $("focus"), file: $("file"),
  exportBtn: $("export"), exportDialog: $("export-dialog"), exportGo: $("export-go"), exportStatus: $("export-status"),
  exportForm: $("export-form"),
  gifBtn: $("export-gif"), gifDialog: $("gif-dialog"), gifForm: $("gif-form"), gifGo: $("gif-go"), gifStatus: $("gif-status"),
  gifLength: $("gif-length"),
  bloom: $("bloom"), styleSelect: $("style-select"),
  clipSelect: $("clip-select"), clipFile: $("clip-file"), clipMirror: $("clip-mirror"), modelSelect: $("model-select"),
  mute: $("mute"), flash: $("flash"), dim: $("dim"), quadLabels: $("quad-labels"), viewRead: $("view-read"), error: $("error"),
};

const state = {
  templates: [],
  groups: [],
  type: ALL,
  template: null,
  effect: null,
  // A Mixamo-style clip picked in the viewer to play on the caster instead
  // of the template's own animation ("" = the template's), and whether to mirror it.
  clip: "",
  clipMirror: false,
  // The rigged character playing the caster (a file in models/index.json), or "" for the stand-in.
  model: "",
  seed: 1,
  t: 0,
  playing: true,
  speed: 1,
  view: null,
  last: performance.now(),
  hidden: new Set(),
  chosenView: null, // the view the user picked; null means "open each spell in its hero view"
  style: null, // the art style the user picked; null means "the template's own"
};

// ------------------------------------------------------------ sound

const sound = {
  player: new SoundPlayer(),
  library: { cues: {} },
  events: [],
  at: 0, // the time playback last reached; anything else is a jump
  playing: false,
};

// Sound starts off; the Sound button or M turns it on, and the choice is remembered.
function soundPref() {
  const q = new URLSearchParams(location.search).get("sound");
  if (q === "off" || q === "0") return true;
  if (q === "on" || q === "1") return false;
  try {
    return localStorage.getItem("spelldirector.muted") !== "0";
  } catch {
    return true;
  }
}

// The camera view the user picked sticks across spells and visits; until they pick one,
// each spell opens in its hero view.
const VIEW_KEY = "spelldirector.view";
const VIEW_NAMES = ["front", "side", "top", "three_quarter", "quad"];

function savedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEW_NAMES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function chooseView(view, save = true) {
  if (!VIEW_NAMES.includes(view)) return;
  state.chosenView = view;
  state.view = view;
  if (save) {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode: just don't remember */
    }
  }
  setupCameras();
  updateViewButtons();
}

function setMuted(muted, save = true) {
  sound.player.setMuted(muted);
  ui.mute.textContent = muted ? "Sound off" : "Sound on";
  ui.mute.classList.toggle("active", !muted);
  ui.mute.setAttribute("aria-pressed", String(!muted));
  if (save) {
    try {
      localStorage.setItem("spelldirector.muted", muted ? "1" : "0");
    } catch {
      /* private mode: just don't remember */
    }
  }
}

function rebuildSound() {
  sound.player.stopAll();
  sound.events = state.template ? soundEvents(state.template, state.seed, sound.library) : [];
}

// Play the cues whose start time playback crossed this frame.
function playSound(from, to, wrap) {
  const due = wrap
    ? eventsBetween(sound.events, from, wrap.end + (wrap.start === 0 ? 1 : 0)).concat(eventsBetween(sound.events, wrap.start, to))
    : eventsBetween(sound.events, from, to);
  sound.player.play(due, { seed: state.seed, speed: state.speed });
}

// ------------------------------------------------------------ three setup

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const studio = makeStudio();
const scene = studio.scene;

let cameras = {};
let controls = null;

function setupCameras() {
  const aspect = ui.canvas.clientWidth / Math.max(1, ui.canvas.clientHeight);
  cameras = {};
  for (const v of VIEWS) cameras[v] = viewCamera(v, state.effect.stage, aspect);
  if (controls) controls.dispose();
  if (state.view !== "quad") {
    const cam = cameras[state.view];
    controls = new OrbitControls(cam, ui.canvas);
    controls.target.copy(cam.userData.look);
    controls.update();
  } else {
    controls = null;
  }
}

function resize() {
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  if (ui.canvas.width !== Math.floor(w * renderer.getPixelRatio()) || ui.canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  // Quadrants keep the canvas aspect ratio, so one aspect fits every view.
  const aspect = w / Math.max(1, h);
  for (const cam of Object.values(cameras)) {
    if (cam.isOrthographicCamera) {
      const hh = cam.userData.halfH;
      cam.left = -hh * aspect;
      cam.right = hh * aspect;
    } else {
      cam.aspect = aspect;
    }
    cam.updateProjectionMatrix();
  }
}

// Bloom is on by default; the Bloom checkbox or ?bloom=off turns it off (remembered per browser).
function bloomPref() {
  const q = new URLSearchParams(location.search).get("bloom");
  if (q === "off" || q === "0") return false;
  if (q === "on" || q === "1") return true;
  try {
    return localStorage.getItem("spelldirector.bloom") !== "0";
  } catch {
    return true;
  }
}

const post = new Post(renderer, { bloom: bloomPref(), toneMap: true });

// The art style: ?style= wins for this visit; otherwise the user's last pick
// (remembered per browser), otherwise each template's own style.
const STYLE_KEY = "spelldirector.style";
function stylePref() {
  const q = new URLSearchParams(location.search).get("style");
  if (STYLE_IDS.includes(q)) return q;
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return STYLE_IDS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function currentStyle() {
  return resolveStyle(state.template, state.style);
}

function render() {
  resize();
  // Drawing-buffer pixels; viewports have a bottom-left origin.
  const W = ui.canvas.width;
  const H = ui.canvas.height;
  post.setSize(W, H);
  const views = state.view === "quad"
    ? Object.entries(quadViewports(W, H)).map(([v, port]) => ({ camera: cameras[v], ...port }))
    : [{ camera: cameras[state.view] }];
  const undo = views.map((v) => shakeCamera(v.camera, state.effect.shake));
  post.render(views.map((v) => ({ scene, ...v })));
  undo.forEach((u) => u());
}

// ------------------------------------------------------------ effect + UI

function duration() {
  return state.template?.timing?.duration_ms ?? 1000;
}

function loadEffect() {
  if (state.effect) {
    scene.remove(state.effect.group);
    state.effect.dispose();
  }
  const style = currentStyle();
  state.effect = new Effect(playTemplate(state.template), state.seed, { style });
  post.setStyle(style.view);
  for (const id of state.hidden) state.effect.setHidden(id, true);
  scene.add(state.effect.group);
  studio.setStage(state.effect.stage);
  setupCameras();
  rebuildSound();
}

function selectTemplate(tpl) {
  state.template = tpl;
  state.hidden = new Set();
  state.t = 0;
  state.view = state.chosenView || tpl.views?.hero || "three_quarter";
  loadEffect();
  buildTemplateUI();
  updateViewButtons();
  state.playing = true;
  ui.play.textContent = "Pause";
}

// ------------------------------------------------------------ type + spell pickers

function setCatalog(templates) {
  state.templates = templates;
  state.groups = groupCatalog(templates);
}

function buildTypeSelect() {
  ui.typeSelect.innerHTML = "";
  const all = new Option(`${typeLabel(ALL)} (${state.templates.length})`, ALL);
  ui.typeSelect.add(all);
  for (const g of state.groups.filter((x) => !isExtra(x))) ui.typeSelect.add(new Option(`${g.label} (${g.templates.length})`, g.type));
  for (const [label, list] of [["Spell lines", state.groups.filter((x) => x.line)], ["Kinds", state.groups.filter((x) => x.kind)]]) {
    if (!list.length) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const g of list) og.appendChild(new Option(`${g.label} (${g.templates.length})`, g.type));
    ui.typeSelect.appendChild(og);
  }
  ui.typeSelect.value = state.type;
}

function spellOption(tpl) {
  const o = new Option(tpl.name || tpl.id, tpl.id);
  o.title = tpl.description || "";
  return o;
}

function buildSpellSelect() {
  ui.spellSelect.innerHTML = "";
  if (state.type === ALL) {
    for (const g of state.groups.filter((x) => !isExtra(x))) {
      const og = document.createElement("optgroup");
      og.label = g.label;
      g.templates.forEach((t) => og.appendChild(spellOption(t)));
      ui.spellSelect.appendChild(og);
    }
  } else {
    spellsFor(state.groups, state.type).forEach((t) => ui.spellSelect.add(spellOption(t)));
  }
  if (state.template) ui.spellSelect.value = state.template.id;
  updatePickerState();
}

function updatePickerState() {
  const list = spellsFor(state.groups, state.type);
  const i = list.findIndex((t) => t.id === state.template?.id);
  ui.spellCount.textContent = list.length ? `${i + 1} of ${list.length}` : "";
  ui.prevSpell.disabled = ui.nextSpell.disabled = list.length < 2;
  ui.spellSelect.title = state.template?.description || "Spell within the type";
}

function syncUrl() {
  const q = new URLSearchParams(location.search);
  if (state.template) q.set("template", state.template.id);
  if (state.type === ALL) q.delete("type");
  else q.set("type", state.type);
  if (state.chosenView) q.set("view", state.chosenView);
  q.delete("t");
  history.replaceState(null, "", `${location.pathname}?${q}`);
}

function pickSpell(tpl, { updateUrl = true } = {}) {
  if (!tpl) return;
  selectTemplate(tpl);
  ui.spellSelect.value = tpl.id;
  updatePickerState();
  if (updateUrl) {
    ui.error.hidden = true;
    syncUrl();
  }
}

function pickType(type) {
  state.type = type;
  ui.typeSelect.value = type;
  buildSpellSelect();
  const list = spellsFor(state.groups, type);
  // Keep the current spell when it belongs to the new type.
  if (!list.some((t) => t.id === state.template?.id)) pickSpell(list[0]);
  else syncUrl();
}

ui.typeSelect.onchange = () => pickType(ui.typeSelect.value);
ui.spellSelect.onchange = () => pickSpell(state.templates.find((t) => t.id === ui.spellSelect.value));
ui.prevSpell.onclick = () => pickSpell(step(state.groups, state.type, state.template?.id, -1));
ui.nextSpell.onclick = () => pickSpell(step(state.groups, state.type, state.template?.id, 1));

function buildTemplateUI() {
  const tpl = state.template;
  const d = duration();
  ui.title.textContent = `${tpl.element} / ${tpl.name}`;
  const lr = loopRange(tpl);
  ui.subtitle.textContent = `${tpl.archetype} · ${d} ms${lr ? ` · loops ${lr.start}–${lr.end} ms` : ""} · hero view ${VIEW_LABELS[tpl.views?.hero] || "3/4"}`;
  ui.loop.parentElement.title = lr
    ? "On: the aura holds, looping its sustain section. Off: it plays its end and stops."
    : "Replay the spell when it ends";
  ui.description.textContent = tpl.description || "";
  ui.notes.textContent = tpl.director_notes ? `Director's notes: ${tpl.director_notes}` : "";
  ui.scrubber.max = String(d);

  ui.bands.innerHTML = "";
  ui.beats.innerHTML = "";
  tpl.beats.forEach((b) => {
    const band = document.createElement("span");
    band.style.left = `${(b.start_ms / d) * 100}%`;
    band.style.width = `${((b.end_ms - b.start_ms) / d) * 100}%`;
    band.style.background = phaseColor(b.phase);
    band.title = `${b.id} (${b.phase})`;
    ui.bands.appendChild(band);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = b.id.replace(/[-_]/g, " ");
    btn.style.borderLeftColor = phaseColor(b.phase);
    btn.title = `${b.phase}, ${b.start_ms}–${b.end_ms} ms. ${b.intent || ""}`;
    btn.onclick = () => {
      state.t = b.start_ms;
      state.playing = true;
      ui.play.textContent = "Pause";
    };
    ui.beats.appendChild(btn);
  });
  if (lr) {
    // The aura's seamless loop, bracketed over the beat bands.
    const mark = document.createElement("span");
    mark.className = "loop-range";
    mark.style.left = `${(lr.start / d) * 100}%`;
    mark.style.width = `${(lr.len / d) * 100}%`;
    mark.title = `Seamless loop ${lr.start}–${lr.end} ms: an engine repeats this while the aura lasts`;
    ui.bands.appendChild(mark);
  }
  const clear = document.createElement("button");
  clear.className = "btn";
  clear.textContent = "Clear";
  clear.title = "Jump past the end: empty stage";
  clear.onclick = () => {
    state.t = d;
    state.playing = false;
    ui.play.textContent = "Play";
  };
  ui.beats.appendChild(clear);

  ui.palette.innerHTML = "";
  for (const [slot, hex] of Object.entries(tpl.palette || {})) {
    const s = document.createElement("span");
    s.className = "swatch";
    s.innerHTML = `<i style="background:${hex}"></i>${slot}`;
    ui.palette.appendChild(s);
  }

  ui.layers.innerHTML = "";
  tpl.layers.forEach((l) => {
    const li = document.createElement("li");
    const id = `layer-${l.id}`;
    const mat = l.shader?.material ? ` · ${l.shader.material}` : "";
    const lit = l.shader?.lighting === "six_way" ? " · six-way lit" : "";
    li.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" checked> ${l.id} <small>${l.type}${mat}${lit}</small></label>`;
    if (l.shader?.look) li.title = `Shader intent: ${l.shader.look}`;
    li.querySelector("input").onchange = (e) => {
      const hide = !e.target.checked;
      if (hide) state.hidden.add(l.id);
      else state.hidden.delete(l.id);
      state.effect.setHidden(l.id, hide);
    };
    ui.layers.appendChild(li);
  });
}

function updateViewButtons() {
  document.querySelectorAll(".view").forEach((b) => {
    const v = b.dataset.view;
    b.classList.toggle("active", v === state.view);
    const hero = state.template?.views?.hero === v;
    b.textContent = (v === "quad" ? "All four" : VIEW_LABELS[v]) + (hero ? " ★" : "");
    b.title = hero ? "Hero view: the effect is designed around this camera" : "";
  });
  ui.quadLabels.hidden = state.view !== "quad";
  const reads = state.template?.views?.reads || {};
  ui.viewRead.textContent = state.view === "quad" ? "" : reads[state.view] || "";
}

function updateOverlay() {
  const t = state.t;
  const active = beatsAt(state.template, t);
  ui.beatNames.innerHTML = active
    .map((b) => `<span style="color:${phaseColor(b.phase)}">${b.id.replace(/[-_]/g, " ")}</span>`)
    .join(" &nbsp;/&nbsp; ");
  const latest = active[active.length - 1];
  ui.beatIntent.textContent = latest?.intent || "";
  ui.cues.textContent = cuesAt(sound.events, t).map((c) => `♪ ${c}`).join("  ");
  ui.time.textContent = `${Math.round(t)} / ${duration()} ms`;
  ui.scrubber.value = String(Math.round(t));
  [...ui.beats.children].forEach((btn, i) => {
    const b = state.template.beats[i];
    btn.classList.toggle("active", !!b && active.includes(b));
  });

  const { flash, dim } = screenOverlays(state.effect);
  ui.flash.style.background = flash ? flash.color : "transparent";
  ui.flash.style.opacity = flash ? String(flash.opacity) : "0";
  ui.dim.style.background = dim ? dim.color : "transparent";
  ui.dim.style.opacity = dim ? String(dim.opacity) : "0";
}

function frame(now) {
  const dt = Math.min(100, now - state.last);
  state.last = now;
  if (state.template) {
    // A jump (scrub, beat button, replay, new spell) or a pause cuts the sound.
    if (state.t !== sound.at || (sound.playing && !state.playing)) sound.player.stopAll();
    if (state.playing) {
      const from = state.t;
      // An aura with Loop on holds its sustain loop; Loop off lets it end.
      const step = advancePlayhead(from, from + dt * state.speed, duration(), ui.loop.checked, loopRange(state.template));
      state.t = step.t;
      if (step.ended) {
        state.playing = false;
        ui.play.textContent = "Play";
      }
      playSound(from, state.t, step.wrap);
    }
    sound.at = state.t;
    sound.playing = state.playing;
    state.effect.update(state.t);
    studio.update(state.t);
    controls?.update();
    render();
    updateOverlay();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ controls

ui.replay.onclick = () => {
  state.t = 0;
  state.playing = true;
  ui.play.textContent = "Pause";
};
ui.play.onclick = () => {
  if (!state.playing && state.t >= duration()) state.t = 0;
  state.playing = !state.playing;
  ui.play.textContent = state.playing ? "Pause" : "Play";
};
ui.mute.onclick = () => {
  sound.player.unlock();
  setMuted(!sound.player.muted);
};
// Browsers start audio only after a user gesture.
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => sound.player.unlock(), { capture: true });
ui.bloom.checked = post.enabled;
ui.bloom.onchange = () => {
  post.enabled = ui.bloom.checked;
  try {
    localStorage.setItem("spelldirector.bloom", post.enabled ? "1" : "0");
  } catch {
    /* private mode: just don't remember */
  }
};
state.style = stylePref();
ui.styleSelect.value = state.style || "";
function setStyle(id, save = true) {
  state.style = STYLE_IDS.includes(id) ? id : null;
  ui.styleSelect.value = state.style || "";
  if (save) {
    try {
      if (state.style) localStorage.setItem(STYLE_KEY, state.style);
      else localStorage.removeItem(STYLE_KEY);
    } catch {
      /* private mode: just don't remember */
    }
  }
  if (state.template) loadEffect();
}
ui.styleSelect.onchange = () => setStyle(ui.styleSelect.value);
ui.speed.onchange = () => (state.speed = Number(ui.speed.value));
ui.scrubber.oninput = () => {
  state.t = Number(ui.scrubber.value);
  state.playing = false;
  ui.play.textContent = "Play";
};
ui.seed.onchange = () => {
  state.seed = Math.max(0, Math.floor(Number(ui.seed.value) || 0));
  loadEffect();
};
ui.reroll.onclick = () => {
  state.seed = Math.floor(Math.random() * 1e6);
  ui.seed.value = String(state.seed);
  loadEffect();
  state.t = 0;
  state.playing = true;
  ui.play.textContent = "Pause";
};
document.querySelectorAll(".view").forEach((b) => {
  b.onclick = () => {
    chooseView(b.dataset.view);
    syncUrl();
  };
});
ui.focus.onclick = () => document.body.classList.toggle("focus");
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || ui.exportDialog.open || ui.gifDialog.open) return;
  if (e.key === "f" || e.key === "F") document.body.classList.toggle("focus");
  else if (e.key === "Escape") document.body.classList.remove("focus");
  else if (e.key === " ") {
    e.preventDefault();
    ui.play.click();
  } else if (e.key === "m" || e.key === "M") ui.mute.click();
  else if (e.key === "b" || e.key === "B") ui.bloom.click();
  else if (e.key === "s" || e.key === "S") setStyle(STYLE_IDS[(STYLE_IDS.indexOf(currentStyle().id) + 1) % STYLE_IDS.length]);
  else if (e.key === "g" || e.key === "G") ui.gifBtn.click();
  else if (e.key === "[") ui.prevSpell.click();
  else if (e.key === "]") ui.nextSpell.click();
  else if (["1", "2", "3", "4", "5"].includes(e.key)) {
    document.querySelectorAll(".view")[Number(e.key) - 1].click();
  }
});
ui.file.onchange = async () => {
  const f = ui.file.files[0];
  if (!f) return;
  try {
    const tpl = JSON.parse(await f.text());
    if (!tpl.beats || !tpl.layers) throw new Error("not a SpellDirector template (no beats/layers)");
    setCatalog(state.templates.filter((x) => x.id !== tpl.id).concat(tpl));
    state.type = tpl.element || "other";
    buildTypeSelect();
    state.template = tpl;
    buildSpellSelect();
    pickSpell(tpl);
    ui.error.hidden = true;
  } catch (err) {
    showError(`Could not open ${f.name}: ${err.message}`);
  }
  ui.file.value = "";
};

// ------------------------------------------------------------ caster clips

// The template as the viewer plays it: with a clip picked in the viewer, that
// clip drives the caster (space.caster_clip), starting at the first gesture.
function playTemplate(tpl) {
  if (!tpl || !state.clip || tpl.archetype === "status") return tpl;
  const first = (tpl.space?.caster_gestures || []).map((g) => (typeof g.at_ms === "number" ? g.at_ms : Array.isArray(g.at_ms) ? g.at_ms[0] : 0));
  const at = first.length ? Math.min(...first) : 0;
  return { ...tpl, space: { ...(tpl.space || {}), caster_clip: { clip: state.clip, at_ms: at, mirror: state.clipMirror } } };
}

async function fetchClip(name) {
  if (getClip(name)) return true;
  try {
    const res = await fetch(`clips/${encodeURIComponent(name)}.json`);
    if (!res.ok) return false;
    return registerClip(name, await res.json());
  } catch {
    return false;
  }
}

// Load the clips in the library's clips/ folder (and any a template asks for).
async function loadClips() {
  try {
    const res = await fetch("clips/index.json");
    if (res.ok) await Promise.all(((await res.json()).clips || []).map(fetchClip));
  } catch {
    // Opened without the server: no clip library.
  }
  await ensureClips(state.templates);
  buildClipSelect();
}

async function ensureClips(templates) {
  await Promise.all([...new Set(templates.flatMap(clipsWanted))].map(fetchClip));
}

function buildClipSelect() {
  if (!ui.clipSelect) return;
  ui.clipSelect.replaceChildren(new Option("Template's", ""), ...clipNames().map((n) => new Option(n, n)));
  ui.clipSelect.value = clipNames().includes(state.clip) ? state.clip : "";
}

if (ui.clipSelect) {
  ui.clipSelect.onchange = () => {
    state.clip = ui.clipSelect.value;
    if (state.template) loadEffect();
  };
  ui.clipMirror.onchange = () => {
    state.clipMirror = ui.clipMirror.checked;
    if (state.template) loadEffect();
  };
  ui.clipFile.onchange = async () => {
    const f = ui.clipFile.files[0];
    ui.clipFile.value = "";
    if (!f) return;
    try {
      let name;
      let clip;
      if (/\.json$/i.test(f.name)) {
        clip = JSON.parse(await f.text());
        const { clipNameFor } = await import("./clipimport.js");
        name = clip.name ? clipNameFor(clip.name) : clipNameFor(f.name);
      } else {
        const { clipFromFile } = await import("./clipimport.js");
        const out = await clipFromFile(await f.arrayBuffer(), f.name, { fps: 30 });
        clip = out.clip;
        name = out.name;
        if (!out.info.tPose) showError(`${f.name}: its rest pose isn't a T-pose, so the arms may be off. Download it from Mixamo "With Skin".`);
      }
      if (!registerClip(name, clip)) throw new Error("not an animation clip");
      // Save it in the library's clips/ folder so templates can use it.
      try {
        await fetch(`api/clips?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-SpellDirector": "clip" }, body: JSON.stringify(clip) });
      } catch {
        // No server: the clip still plays until the page is reloaded.
      }
      state.clip = name;
      buildClipSelect();
      if (state.template) loadEffect();
    } catch (err) {
      console.error(err);
      showError(`Could not load ${f.name}: ${err.message}`);
    }
  };
}

// ------------------------------------------------------------ caster model

// A rigged character (engine/castermodel.js) in place of the stand-in. The
// models are the user's own files, served from the library's models/ folder
// or the checkout's assets/ folder; the choice is remembered in this browser.
const MODEL_PREF = "spelldirector.casterModel";
let modelLoad = 0;

async function loadModelList() {
  if (!ui.modelSelect) return [];
  let names = [];
  try {
    const res = await fetch("models/index.json");
    if (res.ok) names = (await res.json()).models || [];
  } catch {
    // Opened without the server: the stand-in only.
  }
  ui.modelSelect.replaceChildren(new Option("Stand-in", ""), ...names.map((n) => new Option(n.replace(/\.[^.]+$/, ""), n)));
  return names;
}

async function setCasterModel(name, { remember = true } = {}) {
  const token = ++modelLoad;
  state.model = name || "";
  if (ui.modelSelect) ui.modelSelect.value = state.model;
  if (remember) {
    try {
      localStorage.setItem(MODEL_PREF, state.model);
    } catch {
      // No storage (private window): not remembered.
    }
  }
  const old = studio.casterModel;
  if (!state.model) {
    studio.setCasterModel(null);
    old?.dispose();
    return;
  }
  try {
    const res = await fetch(`models/${encodeURIComponent(state.model)}`);
    if (!res.ok) throw new Error(`not found (${res.status})`);
    const { loadCasterModel } = await import("./engine/castermodel.js");
    const model = await loadCasterModel(await res.arrayBuffer(), state.model);
    if (token !== modelLoad) return model.dispose();
    studio.setCasterModel(model);
    old?.dispose();
    studio.update(state.t);
  } catch (err) {
    console.error(err);
    if (token === modelLoad) {
      showError(`Could not load the caster model ${state.model}: ${err.message}`);
      state.model = "";
      if (ui.modelSelect) ui.modelSelect.value = "";
    }
  }
}

if (ui.modelSelect) ui.modelSelect.onchange = () => setCasterModel(ui.modelSelect.value);

// ------------------------------------------------------------ export

function exportOptions(form) {
  const views = [...form.querySelectorAll('input[name="view"]:checked')].map((i) => i.value);
  return {
    views,
    frame: Number(form.elements.frame.value),
    fps: form.elements.fps.value ? Number(form.elements.fps.value) : undefined,
    layers: form.elements.layers.checked,
    bloom: form.elements.bloom.checked,
    style: form.elements.style.value || currentStyle().id,
  };
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

ui.exportBtn.onclick = () => {
  ui.exportStatus.textContent = state.template ? `${state.template.name}, seed ${state.seed}, ${currentStyle().label} style.` : "";
  ui.exportDialog.showModal();
};
ui.exportGo.onclick = async () => {
  const tpl = playTemplate(state.template);
  if (!tpl) return;
  const opts = exportOptions(ui.exportForm);
  if (!opts.views.length) {
    ui.exportStatus.textContent = "Pick at least one view.";
    return;
  }
  ui.exportGo.disabled = true;
  try {
    const { files, manifest } = await exportSpriteSheets(tpl, {
      ...opts,
      seed: state.seed,
      cueLibrary: sound.library,
      onProgress: (p) => {
        if (p.total) ui.exportStatus.textContent = `${p.stage === "scan" ? "Finding each layer's frames" : "Drawing sheets"}… ${Math.round((p.done / p.total) * 100)}%`;
      },
    });
    const folder = `${tpl.id}-seed${state.seed}${manifest.style.id === "stylized" ? "" : `-${manifest.style.id}`}`;
    const zip = makeZip(files.map((f) => ({ name: `${folder}/${f.name}`, data: f.data })));
    download(`${folder}-sprites.zip`, zip, "application/zip");
    ui.exportStatus.textContent = `Done: ${manifest.sheets.length} sheets (the whole spell plus one per layer), ${manifest.frame_count} frames, ${manifest.view_rows.length} views each.`;
  } catch (err) {
    console.error(err);
    ui.exportStatus.textContent = `Export failed: ${err.message}`;
  } finally {
    ui.exportGo.disabled = false;
  }
};

// ------------------------------------------------------------ GIF export

function gifOptions(form) {
  return {
    views: [...form.querySelectorAll('input[name="view"]:checked')].map((i) => i.value),
    width: Number(form.elements.width.value),
    fps: Number(form.elements.fps.value),
    speed: Number(form.elements.speed.value),
    style: form.elements.style.value || currentStyle().id,
    length: loopRange(state.template) ? form.elements.length.value : "spell",
    bloom: form.elements.bloom.checked,
    dither: form.elements.dither.checked ? 0.5 : 0,
  };
}

function syncGifAll() {
  const boxes = [...ui.gifForm.querySelectorAll('input[name="view"]')];
  const all = ui.gifForm.querySelector("[data-all]");
  const on = boxes.filter((b) => b.checked).length;
  all.checked = on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}

ui.gifForm.querySelector("[data-all]").onchange = (e) => {
  ui.gifForm.querySelectorAll('input[name="view"]').forEach((b) => (b.checked = e.target.checked));
};
ui.gifForm.querySelectorAll('input[name="view"]').forEach((b) => (b.onchange = syncGifAll));

ui.gifBtn.onclick = () => {
  if (!state.template) return;
  // Start from the view on screen, unless views were already picked this visit.
  const boxes = [...ui.gifForm.querySelectorAll('input[name="view"]')];
  if (!boxes.some((b) => b.checked)) boxes.forEach((b) => (b.checked = b.value === state.view));
  syncGifAll();
  ui.gifForm.elements.speed.value = String([0.25, 0.5].includes(state.speed) ? state.speed : 1);
  ui.gifForm.elements.bloom.checked = post.enabled;
  ui.gifLength.hidden = !loopRange(state.template);
  ui.gifStatus.textContent = `${state.template.name}, seed ${state.seed}, ${currentStyle().label} style.`;
  ui.gifDialog.showModal();
};

ui.gifGo.onclick = async () => {
  const tpl = state.template;
  if (!tpl) return;
  const opts = gifOptions(ui.gifForm);
  if (!opts.views.length) {
    ui.gifStatus.textContent = "Pick at least one view.";
    return;
  }
  ui.gifGo.disabled = true;
  try {
    const { files, plan } = await exportGifs(tpl, {
      ...opts,
      seed: state.seed,
      hidden: [...state.hidden],
      onProgress: (p) => {
        ui.gifStatus.textContent = p.stage === "framing"
          ? "Framing the views around the whole spell…"
          : `Recording ${GIF_VIEW_LABELS[p.view]}… ${Math.round((p.done / p.total) * 100)}%`;
      },
    });
    if (files.length === 1) {
      download(files[0].name, files[0].data, "image/gif");
    } else {
      const folder = gifFileName(tpl.id, state.seed, plan.style, "x").replace(/-x\.gif$/, "-gifs");
      download(`${folder}.zip`, makeZip(files.map((f) => ({ name: `${folder}/${f.name}`, data: f.data }))), "application/zip");
    }
    const kb = Math.round(files.reduce((s, f) => s + f.data.length, 0) / 1024);
    ui.gifStatus.textContent = `Done: ${files.length} GIF${files.length > 1 ? "s" : ""} (${files.map((f) => GIF_VIEW_LABELS[f.view]).join(", ")}), ${plan.times.length} frames at ${plan.fps} fps, ${plan.width} × ${plan.height}, ${kb} KB.`;
  } catch (err) {
    console.error(err);
    ui.gifStatus.textContent = `Export failed: ${err.message}`;
  } finally {
    ui.gifGo.disabled = false;
  }
};

// For tools/export_sprites.py: export a template (the current one, or one
// passed in) and return the files as base64.
// With opts.kind "gif" (tools/export_gif.py) it exports GIFs instead, and with
// "range_guide" (tools/range_guide.py) it measures the spell's readability and
// renders the frames for its range guide.
window.spellDirectorExport = async (opts = {}) => {
  const tpl = opts.template || (opts.id ? state.templates.find((t) => t.id === opts.id) : playTemplate(state.template));
  if (!tpl) throw new Error(`unknown template ${opts.id ?? ""}`.trim());
  await ensureClips([tpl]);
  const run = opts.kind === "range_guide"
    ? async () => {
      const { images, ...manifest } = await rangeGuide(tpl, { ...opts, seed: opts.seed ?? state.seed });
      manifest.images = Object.fromEntries(Object.entries(images).map(([k, v]) => [k, { ...v, data: undefined, file: `${k}.png` }]));
      return { manifest, files: Object.entries(images).map(([k, v]) => ({ name: `${k}.png`, data: v.data })) };
    }
    : opts.kind === "gif"
    ? async () => {
      const { files, plan } = await exportGifs(tpl, { ...opts, seed: opts.seed ?? state.seed });
      const manifest = { template: { id: tpl.id, name: tpl.name }, ...plan, times: undefined, delays: undefined, frame_count: plan.times.length,
        gifs: files.map((f) => ({ file: f.name, view: f.view, width: f.width, height: f.height, frames: f.frames, bytes: f.data.length })) };
      return { files, manifest };
    }
    : () => exportSpriteSheets(tpl, { ...opts, seed: opts.seed ?? state.seed, cueLibrary: sound.library });
  const { files, manifest } = await run();
  const b64 = (data) => {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  return { manifest, files: files.map((f) => ({ name: f.name, base64: b64(f.data) })) };
};

function showError(msg) {
  ui.error.textContent = msg;
  ui.error.hidden = false;
}

// ------------------------------------------------------------ boot

async function loadCueLibrary() {
  try {
    const res = await fetch("sounds/cues.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("SpellDirector: no sound cue library, cues show as captions only", err);
    return { cues: {} };
  }
}

// The server answers /version.json from the VERSION file (bundled in the exe too).
async function showVersion() {
  try {
    const res = await fetch("version.json");
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version) return;
    const el = document.getElementById("app-version");
    el.textContent = `v${version}`;
    el.hidden = false;
    document.title = `SpellDirector v${version}`;
  } catch {
    // Opened without the server (e.g. a static host): no version to show.
  }
}

async function boot() {
  showVersion();
  setMuted(soundPref(), false);
  sound.library = await loadCueLibrary();
  sound.player.setLibrary(sound.library);
  try {
    const index = await (await fetch("templates/index.json")).json();
    setCatalog(await Promise.all(index.templates.map(async (p) => (await fetch(`templates/${p}`)).json())));
  } catch (err) {
    showError(`Could not load templates: ${err.message}`);
    return;
  }
  await loadClips();
  const params = new URLSearchParams(location.search);
  const urlClip = params.get("clip");
  if (urlClip && (await fetchClip(urlClip))) {
    state.clip = urlClip;
    state.clipMirror = params.get("mirror") === "1";
    buildClipSelect();
    if (ui.clipMirror) ui.clipMirror.checked = state.clipMirror;
  }
  // ?model=<file> picks the caster model for this visit (not remembered);
  // otherwise the last one picked in this browser.
  const models = await loadModelList();
  const urlModel = params.get("model");
  let savedModel = "";
  try {
    savedModel = localStorage.getItem(MODEL_PREF) || "";
  } catch {
    // No storage.
  }
  const wantModel = urlModel !== null ? urlModel : savedModel;
  if (wantModel && models.includes(wantModel)) {
    await setCasterModel(wantModel, { remember: false });
  } else if (urlModel) {
    showError(`No caster model called ${urlModel} (put it in the library's models folder or the checkout's assets folder).`);
  }
  const start = resolveStart(state.groups, { template: params.get("template"), type: params.get("type") });
  if (start.error) showError(start.error);
  state.type = start.type;
  state.template = start.template;
  buildTypeSelect();
  buildSpellSelect();
  // ?view= wins for this visit and isn't saved, so automation can't change the remembered view.
  const urlView = params.get("view");
  state.chosenView = VIEW_NAMES.includes(urlView) ? urlView : savedView();
  // Leave a bad ?template= in the URL so the error stays explainable.
  pickSpell(start.template, { updateUrl: false });
  const t = params.get("t");
  if (t !== null) {
    state.t = Number(t);
    state.playing = false;
    ui.play.textContent = "Play";
  }
  requestAnimationFrame(frame);
}

// For tools/export_sprites.py when Playwright isn't there (the packaged exe):
// a headless browser opens ?export_job=<token>, and the page fetches the
// export options from the server and posts the files back.
async function runExportJob(token) {
  const url = `api/export-job/${encodeURIComponent(token)}`;
  let body;
  try {
    const { opts } = await (await fetch(url)).json();
    body = await window.spellDirectorExport(opts);
  } catch (err) {
    body = { error: err?.message || String(err) };
  }
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

window.spellDirector = state; // handy for debugging and screenshots
boot().then(() => {
  const job = new URLSearchParams(location.search).get("export_job");
  if (job) runExportJob(job);
});
