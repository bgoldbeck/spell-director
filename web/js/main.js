import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { Effect } from "./engine/effect.js";
import { Post } from "./engine/post.js";
import { cuesAt, eventsBetween, soundEvents } from "./engine/sound.js";
import { SoundPlayer } from "./audio.js";
import { VIEWS, VIEW_LABELS, viewCamera } from "./engine/stage.js";
import { beatsAt, phaseColor } from "./engine/timeline.js";
import { exportSpriteSheets } from "./exporter.js";
import { makeZip } from "./zip.js";
import { ALL, groupByType, resolveStart, spellsFor, step, typeLabel } from "./catalog.js";

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
  bloom: $("bloom"),
  mute: $("mute"), flash: $("flash"), dim: $("dim"), quadLabels: $("quad-labels"), viewRead: $("view-read"), error: $("error"),
};

const state = {
  templates: [],
  groups: [],
  type: ALL,
  template: null,
  effect: null,
  seed: 1,
  t: 0,
  playing: true,
  speed: 1,
  view: null,
  last: performance.now(),
  hidden: new Set(),
  chosenView: null, // the view the user picked; null means "open each spell in its hero view"
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
function playSound(from, to, wrapped) {
  const d = duration();
  const due = wrapped
    ? eventsBetween(sound.events, from, d + 1).concat(eventsBetween(sound.events, 0, to))
    : eventsBetween(sound.events, from, to);
  sound.player.play(due, { seed: state.seed, speed: state.speed });
}

// ------------------------------------------------------------ three setup

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b0d12");
scene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
const key = new THREE.DirectionalLight("#cfd6ff", 0.5);
key.position.set(-3, 6, 4);
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({ color: "#5d6478", roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(28, 28, "#3a3f4e", "#333846");
grid.position.y = 0.002;
scene.add(grid);

const props = new THREE.Group();
scene.add(props);

function standIn(color, facing = 1) {
  // A simple figure, 1 unit tall, like the stand-ins in a motion study.
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 4, 12), mat);
  body.position.y = 0.37;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
  head.position.y = 0.86;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.2), new THREE.MeshStandardMaterial({ color: "#2a2d36" }));
  visor.position.set(0.12 * facing, 0.88, 0);
  g.add(body, head, visor);
  return g;
}

function rebuildProps(stage) {
  props.clear();
  const caster = standIn("#8c90a0", 1);
  props.add(caster);
  for (const p of stage.targets) {
    const d = standIn("#6c6f7b", -1);
    d.position.set(p.x, 0, p.z);
    d.lookAt(0, 0, 0);
    d.rotateY(-Math.PI / 2);
    props.add(d);
  }
  if (stage.showPointMarker) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32), new THREE.MeshBasicMaterial({ color: "#555b6e" }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(stage.point.x, 0.01, 0);
    props.add(m);
  }
}

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

const post = new Post(renderer, { bloom: bloomPref() });

// Shake offsets the camera for this frame only.
function shaken(cam) {
  const shake = state.effect.shake;
  const saved = cam.position.clone();
  if (shake.x || shake.y) {
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, shake.x).addScaledVector(up, shake.y);
  }
  return () => cam.position.copy(saved);
}

function render() {
  resize();
  // Drawing-buffer pixels; viewports have a bottom-left origin.
  const W = ui.canvas.width;
  const H = ui.canvas.height;
  post.setSize(W, H);
  let views;
  if (state.view === "quad") {
    const hw = Math.floor(W / 2);
    const hh = Math.floor(H / 2);
    views = [
      { camera: cameras.front, x: 0, y: hh, w: hw, h: H - hh },
      { camera: cameras.side, x: hw, y: hh, w: W - hw, h: H - hh },
      { camera: cameras.top, x: 0, y: 0, w: hw, h: hh },
      { camera: cameras.three_quarter, x: hw, y: 0, w: W - hw, h: hh },
    ];
  } else {
    views = [{ camera: cameras[state.view] }];
  }
  const undo = views.map((v) => shaken(v.camera));
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
  state.effect = new Effect(state.template, state.seed);
  for (const id of state.hidden) state.effect.setHidden(id, true);
  scene.add(state.effect.group);
  rebuildProps(state.effect.stage);
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
  state.groups = groupByType(templates);
}

function buildTypeSelect() {
  ui.typeSelect.innerHTML = "";
  const all = new Option(`${typeLabel(ALL)} (${state.templates.length})`, ALL);
  ui.typeSelect.add(all);
  for (const g of state.groups) ui.typeSelect.add(new Option(`${g.label} (${g.templates.length})`, g.type));
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
    for (const g of state.groups) {
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
  ui.subtitle.textContent = `${tpl.archetype} · ${d} ms · hero view ${VIEW_LABELS[tpl.views?.hero] || "3/4"}`;
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
    li.innerHTML = `<label for="${id}"><input id="${id}" type="checkbox" checked> ${l.id} <small>${l.type}</small></label>`;
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

  let add = null;
  let dark = null;
  for (const s of state.effect.screen) {
    if (s.dark) dark = !dark || s.opacity > dark.opacity ? s : dark;
    else add = !add || s.opacity > add.opacity ? s : add;
  }
  ui.flash.style.background = add ? `#${add.color.getHexString()}` : "transparent";
  ui.flash.style.opacity = add ? String(Math.min(0.9, add.opacity)) : "0";
  ui.dim.style.background = dark ? `#${dark.color.getHexString()}` : "transparent";
  ui.dim.style.opacity = dark ? String(Math.min(0.85, dark.opacity)) : "0";
}

function frame(now) {
  const dt = Math.min(100, now - state.last);
  state.last = now;
  if (state.template) {
    // A jump (scrub, beat button, replay, new spell) or a pause cuts the sound.
    if (state.t !== sound.at || (sound.playing && !state.playing)) sound.player.stopAll();
    if (state.playing) {
      const from = state.t;
      let wrapped = false;
      state.t += dt * state.speed;
      const d = duration();
      if (state.t > d) {
        if (ui.loop.checked) {
          state.t = state.t % d;
          wrapped = true;
        } else {
          state.t = d;
          state.playing = false;
          ui.play.textContent = "Play";
        }
      }
      playSound(from, state.t, wrapped);
    }
    sound.at = state.t;
    sound.playing = state.playing;
    state.effect.update(state.t);
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
  if (e.target.matches("input, select, textarea") || ui.exportDialog.open) return;
  if (e.key === "f" || e.key === "F") document.body.classList.toggle("focus");
  else if (e.key === "Escape") document.body.classList.remove("focus");
  else if (e.key === " ") {
    e.preventDefault();
    ui.play.click();
  } else if (e.key === "m" || e.key === "M") ui.mute.click();
  else if (e.key === "b" || e.key === "B") ui.bloom.click();
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

// ------------------------------------------------------------ export

function exportOptions(form) {
  const views = [...form.querySelectorAll('input[name="view"]:checked')].map((i) => i.value);
  return {
    views,
    frame: Number(form.elements.frame.value),
    fps: form.elements.fps.value ? Number(form.elements.fps.value) : undefined,
    layers: form.elements.layers.checked,
    bloom: form.elements.bloom.checked,
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
  ui.exportStatus.textContent = state.template ? `${state.template.name}, seed ${state.seed}.` : "";
  ui.exportDialog.showModal();
};
ui.exportGo.onclick = async () => {
  const tpl = state.template;
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
    const folder = `${tpl.id}-seed${state.seed}`;
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

// For tools/export_sprites.py: export a template (the current one, or one
// passed in) and return the files as base64.
window.spellDirectorExport = async (opts = {}) => {
  const tpl = opts.template || (opts.id ? state.templates.find((t) => t.id === opts.id) : state.template);
  if (!tpl) throw new Error(`unknown template ${opts.id ?? ""}`.trim());
  const { files, manifest } = await exportSpriteSheets(tpl, { ...opts, seed: opts.seed ?? state.seed, cueLibrary: sound.library });
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
  const params = new URLSearchParams(location.search);
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

window.spellDirector = state; // handy for debugging and screenshots
boot();
