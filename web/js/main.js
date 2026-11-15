import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { Effect } from "./engine/effect.js";
import { VIEWS, VIEW_LABELS, viewCamera } from "./engine/stage.js";
import { beatsAt, phaseColor } from "./engine/timeline.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("canvas"), stage: $("stage"), tabs: $("tabs"), title: $("title"), subtitle: $("subtitle"),
  beatNames: $("beat-names"), beatIntent: $("beat-intent"), cues: $("cues"), time: $("time"),
  replay: $("replay"), play: $("play"), speed: $("speed"), loop: $("loop"), seed: $("seed"), reroll: $("reroll"),
  scrubber: $("scrubber"), bands: $("bands"), beats: $("beats"), description: $("description"),
  palette: $("palette"), notes: $("notes"), layers: $("layers"), focus: $("focus"), file: $("file"),
  flash: $("flash"), dim: $("dim"), quadLabels: $("quad-labels"), viewRead: $("view-read"), error: $("error"),
};

const state = {
  templates: [],
  template: null,
  effect: null,
  seed: 1,
  t: 0,
  playing: true,
  speed: 1,
  view: null,
  last: performance.now(),
  hidden: new Set(),
};

// ------------------------------------------------------------ three setup

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b0d12");
scene.add(new THREE.HemisphereLight("#8a93b8", "#1a1c24", 0.9));
const key = new THREE.DirectionalLight("#cfd6ff", 0.5);
key.position.set(-3, 6, 4);
scene.add(key);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(14, 64),
  new THREE.MeshStandardMaterial({ color: "#1d212b", roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(28, 28, "#262a36", "#1f222c");
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

function renderView(cam, x, y, w, h) {
  const shake = state.effect.shake;
  const saved = cam.position.clone();
  if (shake.x || shake.y) {
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, shake.x).addScaledVector(up, shake.y);
  }
  renderer.setViewport(x, y, w, h);
  renderer.setScissor(x, y, w, h);
  renderer.render(scene, cam);
  cam.position.copy(saved);
}

function render() {
  resize();
  const w = ui.canvas.clientWidth;
  const h = ui.canvas.clientHeight;
  if (state.view === "quad") {
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    // Three's viewport origin is bottom-left.
    renderView(cameras.front, 0, hh, hw, h - hh);
    renderView(cameras.side, hw, hh, w - hw, h - hh);
    renderView(cameras.top, 0, 0, hw, hh);
    renderView(cameras.three_quarter, hw, 0, w - hw, hh);
  } else {
    renderView(cameras[state.view], 0, 0, w, h);
  }
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
}

function selectTemplate(tpl) {
  state.template = tpl;
  state.hidden = new Set();
  state.t = 0;
  state.view = tpl.views?.hero || "three_quarter";
  loadEffect();
  buildTemplateUI();
  updateViewButtons();
  state.playing = true;
  ui.play.textContent = "Pause";
}

function buildTabs() {
  ui.tabs.innerHTML = "";
  state.templates.forEach((tpl) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = tpl.name;
    b.title = tpl.description || "";
    b.onclick = () => {
      selectTemplate(tpl);
      [...ui.tabs.children].forEach((c) => c.classList.toggle("active", c === b));
    };
    ui.tabs.appendChild(b);
  });
}

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
  ui.cues.textContent = state.effect.cues.length ? state.effect.cues.map((c) => `♪ ${c}`).join("  ") : "";
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
    if (state.playing) {
      state.t += dt * state.speed;
      const d = duration();
      if (state.t > d) {
        if (ui.loop.checked) state.t = state.t % d;
        else {
          state.t = d;
          state.playing = false;
          ui.play.textContent = "Play";
        }
      }
    }
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
    state.view = b.dataset.view;
    setupCameras();
    updateViewButtons();
  };
});
ui.focus.onclick = () => document.body.classList.toggle("focus");
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (e.key === "f" || e.key === "F") document.body.classList.toggle("focus");
  else if (e.key === "Escape") document.body.classList.remove("focus");
  else if (e.key === " ") {
    e.preventDefault();
    ui.play.click();
  } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
    document.querySelectorAll(".view")[Number(e.key) - 1].click();
  }
});
ui.file.onchange = async () => {
  const f = ui.file.files[0];
  if (!f) return;
  try {
    const tpl = JSON.parse(await f.text());
    if (!tpl.beats || !tpl.layers) throw new Error("not a SpellDirector template (no beats/layers)");
    state.templates = state.templates.filter((x) => x.id !== tpl.id).concat(tpl);
    buildTabs();
    ui.tabs.lastChild.click();
    ui.error.hidden = true;
  } catch (err) {
    showError(`Could not open ${f.name}: ${err.message}`);
  }
  ui.file.value = "";
};

function showError(msg) {
  ui.error.textContent = msg;
  ui.error.hidden = false;
}

// ------------------------------------------------------------ boot

async function boot() {
  try {
    const index = await (await fetch("templates/index.json")).json();
    state.templates = await Promise.all(index.templates.map(async (p) => (await fetch(`templates/${p}`)).json()));
  } catch (err) {
    showError(`Could not load templates: ${err.message}`);
    return;
  }
  buildTabs();
  const want = new URLSearchParams(location.search).get("template");
  const i = Math.max(0, state.templates.findIndex((t) => t.id === want));
  ui.tabs.children[i]?.click();
  const v = new URLSearchParams(location.search).get("view");
  if (v) document.querySelector(`.view[data-view="${v}"]`)?.click();
  const t = new URLSearchParams(location.search).get("t");
  if (t !== null) {
    state.t = Number(t);
    state.playing = false;
    ui.play.textContent = "Play";
  }
  requestAnimationFrame(frame);
}

window.spellDirector = state; // handy for debugging and screenshots
boot();
