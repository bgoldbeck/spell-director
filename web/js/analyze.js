// The Analyze page: send a GIF or video to the local server's breakdown
// (POST /api/analyze) and show the result next to the clip, frame-synced.

import {
  clipDuration, cutTimes, directorPrompt, formatMs, frameAt, percent, phaseAt, phaseBands, savedFiles,
  shotBands, slug, spaceFacts, swatches, timingFacts, viewScores, warnings,
} from "./analysis.js";
import { makeZip } from "./zip.js";

const $ = (id) => document.getElementById(id);
const ui = {
  drop: $("drop"), file: $("clip-file"), prep: $("prep"), prepVideo: $("prep-video"), prepImg: $("prep-img"),
  prepName: $("prep-name"), prepMeta: $("prep-meta"), start: $("trim-start"), end: $("trim-end"),
  markStart: $("mark-start"), markEnd: $("mark-end"), go: $("analyze-go"), other: $("pick-other"), status: $("status"),
  error: $("error"), results: $("results"), summaryLine: $("summary-line"), warnings: $("warnings"),
  clip: $("clip"), overlay: $("overlay"), clipTime: $("clip-time"), clipPhase: $("clip-phase"),
  play: $("clip-play"), prev: $("clip-prev"), next: $("clip-next"), speed: $("clip-speed"), loop: $("clip-loop"),
  showFootprint: $("show-footprint"), showHeatmap: $("show-heatmap"), showFrameBox: $("show-frame-box"),
  timeline: $("timeline"), legend: $("legend"), phaseList: $("phase-list"), frameFacts: $("frame-facts"),
  swatches: $("swatches"), space: $("space"), viewScores: $("view-scores"), timing: $("timing"), shots: $("shots"),
  saveZip: $("save-zip"), copyPrompt: $("copy-prompt"), again: $("analyze-again"), useStatus: $("use-status"),
  contactSheet: $("contact-sheet"),
};

const COLORS = { intensity: "#b9a6ff", coverage: "#5fd0c0", motion: "#9a9daa", cut: "#ff8a8a", head: "#ffffff" };

const state = {
  file: null,
  previewUrl: null,
  run: null, // { id, base, summary, breakdown }
  images: [],
  heatmap: null,
  bands: [],
  duration: 0,
  t: 0,
  playing: true,
  last: performance.now(),
  dragging: false,
};

function showError(msg) {
  ui.error.textContent = msg || "";
  ui.error.hidden = !msg;
}

// ------------------------------------------------------------ picking a file

const SUFFIXES = [".gif", ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"];

function isVideoName(name) {
  return !name.toLowerCase().endsWith(".gif");
}

function pick(file) {
  if (!file) return;
  const lower = file.name.toLowerCase();
  if (!SUFFIXES.some((s) => lower.endsWith(s))) {
    showError(`${file.name} is not a GIF or video. Pick a .gif, .mp4, .webm, .mov, .mkv or .avi file.`);
    return;
  }
  showError("");
  state.file = file;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  const video = isVideoName(file.name);
  ui.prepVideo.hidden = !video;
  ui.prepImg.hidden = video;
  ui.markStart.hidden = !video;
  ui.markEnd.hidden = !video;
  ui.prepName.textContent = file.name;
  ui.prepMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  if (video) {
    ui.prepImg.removeAttribute("src");
    ui.prepVideo.src = state.previewUrl;
    ui.prepVideo.onloadedmetadata = () => {
      if (Number.isFinite(ui.prepVideo.duration)) {
        ui.prepMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB, ${ui.prepVideo.duration.toFixed(2)} s, ${ui.prepVideo.videoWidth}×${ui.prepVideo.videoHeight}`;
      }
    };
    ui.prepVideo.onerror = () => {
      ui.prepMeta.textContent += " (this browser can't preview it, but it can still be analyzed)";
    };
  } else {
    ui.prepVideo.removeAttribute("src");
    ui.prepVideo.load();
    ui.prepImg.src = state.previewUrl;
    ui.prepImg.onload = () => {
      ui.prepMeta.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB, ${ui.prepImg.naturalWidth}×${ui.prepImg.naturalHeight}`;
    };
  }
  ui.start.value = "";
  ui.end.value = "";
  ui.status.textContent = "";
  ui.drop.hidden = true;
  ui.prep.hidden = false;
  ui.results.hidden = true;
}

function resetToDrop() {
  state.file = null;
  ui.prepVideo.pause();
  ui.prep.hidden = true;
  ui.results.hidden = true;
  ui.drop.hidden = false;
  ui.file.value = "";
  showError("");
}

ui.file.onchange = () => pick(ui.file.files[0]);
ui.other.onclick = resetToDrop;
ui.again.onclick = resetToDrop;
ui.markStart.onclick = () => { ui.start.value = ui.prepVideo.currentTime.toFixed(2); };
ui.markEnd.onclick = () => { ui.end.value = ui.prepVideo.currentTime.toFixed(2); };

// Drop anywhere on the page.
for (const ev of ["dragenter", "dragover"]) {
  window.addEventListener(ev, (e) => {
    e.preventDefault();
    ui.drop.classList.add("over");
  });
}
window.addEventListener("dragleave", (e) => {
  if (e.target === document.documentElement || e.relatedTarget === null) ui.drop.classList.remove("over");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.drop.classList.remove("over");
  pick(e.dataTransfer?.files?.[0]);
});
ui.drop.onclick = (e) => {
  if (e.target === ui.drop || e.target.classList.contains("drop-main")) ui.file.click();
};
ui.drop.onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    ui.file.click();
  }
};

// ------------------------------------------------------------ analyzing

function trimValue(input) {
  const v = input.value.trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${input.id === "trim-start" ? "Start" : "End"} must be zero or more seconds.`);
  return n;
}

ui.go.onclick = async () => {
  if (!state.file) return;
  let start;
  let end;
  try {
    start = trimValue(ui.start);
    end = trimValue(ui.end);
    if (start != null && end != null && end <= start) throw new Error("End must be after Start.");
  } catch (err) {
    showError(err.message);
    return;
  }
  showError("");
  ui.go.disabled = true;
  ui.prepVideo.pause();
  const began = performance.now();
  const tick = setInterval(() => {
    ui.status.textContent = `Analyzing… ${Math.round((performance.now() - began) / 1000)} s`;
  }, 500);
  ui.status.textContent = "Uploading…";
  try {
    const q = new URLSearchParams({ name: state.file.name });
    if (start != null) q.set("start", String(start));
    if (end != null) q.set("end", String(end));
    const res = await fetch(`api/analyze?${q}`, { method: "POST", body: state.file, headers: { "Content-Type": "application/octet-stream" } });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // not JSON: an old server or a static host
    }
    if (!res.ok || !data?.breakdown) {
      if (res.status === 404 || res.status === 501 || !data) {
        throw new Error("This viewer's server can't analyze clips. Start it with run.bat, ./run.sh or the SpellDirector exe (version 0.4 or later).");
      }
      throw new Error(data.error || `The server answered ${res.status}.`);
    }
    clearInterval(tick);
    ui.status.textContent = `Done in ${((performance.now() - began) / 1000).toFixed(1)} s.`;
    await showRun(data);
  } catch (err) {
    showError(err.message || String(err));
    ui.status.textContent = "";
  } finally {
    clearInterval(tick);
    ui.go.disabled = false;
  }
};

// ------------------------------------------------------------ results

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style") Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  if (text != null) node.textContent = text;
  return node;
}

function fillFacts(dl, facts) {
  dl.replaceChildren();
  for (const [k, v] of facts) dl.append(el("dt", {}, k), el("dd", {}, v));
}

async function showRun(run) {
  const b = run.breakdown;
  state.run = run;
  state.bands = phaseBands(b);
  state.duration = clipDuration(b);
  state.t = 0;
  state.playing = true;
  ui.play.textContent = "Pause";

  const names = b.images.player_frames || [];
  ui.status.textContent += ` Loading ${names.length} frames…`;
  const [images, heat] = await Promise.all([
    Promise.all(names.map((n) => loadImage(run.base + n))),
    loadImage(run.base + b.images.heatmap),
  ]);
  state.images = images;
  state.heatmap = heat;
  ui.status.textContent = ui.status.textContent.replace(/ Loading \d+ frames…$/, "");
  const first = images.find(Boolean);
  const w = first?.naturalWidth || b.gif.width;
  const h = first?.naturalHeight || b.gif.height;
  for (const c of [ui.clip, ui.overlay]) {
    c.width = w;
    c.height = h;
  }
  ui.clip.parentElement.style.aspectRatio = `${w} / ${h}`;

  const g = b.gif;
  ui.summaryLine.textContent = `${g.source}: ${g.frame_count} frames, ${formatMs(state.duration)}, ${g.width}×${g.height}`
    + (g.format === "video" ? " video" : " GIF");
  ui.warnings.replaceChildren(...warnings(b).map((w) => el("li", {}, w)));

  // Legend and phase list
  const keys = [["Intensity", COLORS.intensity], ["Coverage", COLORS.coverage], ["Motion", COLORS.motion]];
  if (cutTimes(b).length) keys.push(["Camera cut", COLORS.cut]);
  ui.legend.replaceChildren(...keys.map(([name, color]) => {
    const s = el("span", {}, name);
    s.prepend(el("i", { style: { background: color } }));
    return s;
  }));
  ui.phaseList.replaceChildren(...state.bands.map((p) => {
    const li = el("li", { tabindex: "0", title: "Jump to this phase" });
    li.append(el("i", { style: { background: p.color } }), el("strong", {}, p.phase),
      el("span", {}, ` ${formatMs(p.start_ms)}–${formatMs(p.end_ms)} · frames ${p.start_frame}–${p.end_frame}`));
    li.onclick = () => seek(p.start_ms, true);
    li.onkeydown = (e) => { if (e.key === "Enter") seek(p.start_ms, true); };
    return li;
  }));
  if (!state.bands.length) ui.phaseList.replaceChildren(el("li", { class: "muted" }, "No phases found."));

  // Cards
  ui.swatches.replaceChildren(...swatches(b).map((s) => {
    const d = el("div", { class: "swatch big", title: `${s.hex}, ${percent(s.share)} of effect pixels` });
    d.append(el("i", { style: { background: s.hex } }), el("span", {}, s.hex), el("small", {}, s.label));
    return d;
  }));
  fillFacts(ui.space, spaceFacts(b));
  ui.viewScores.replaceChildren(...viewScores(b).map((v) => {
    const row = el("div", { class: v.best ? "score best" : "score" });
    const bar = el("span", { class: "bar" });
    bar.append(el("b", { style: { width: `${Math.round(v.fraction * 100)}%` } }));
    row.append(el("span", { class: "score-label" }, v.label), bar, el("span", { class: "score-num" }, String(v.score)));
    return row;
  }));
  fillFacts(ui.timing, timingFacts(b));
  const shots = shotBands(b);
  ui.shots.replaceChildren(...(shots.length > 1 ? shots : []).map((s) => {
    const li = el("li", { tabindex: "0", title: "Jump to this shot" },
      `Shot ${s.shot + 1}${s.main ? " (main)" : ""}: ${formatMs(s.start_ms)}–${formatMs(s.end_ms)}, frames ${s.start_frame}–${s.end_frame}`
      + (s.effect_onset_ms != null ? `, effect from ${formatMs(s.effect_onset_ms)}` : ""));
    li.onclick = () => seek(s.start_ms, true);
    return li;
  }));
  if (shots.length <= 1) ui.shots.append(el("li", { class: "muted" }, "One continuous shot, no camera cuts."));
  ui.contactSheet.src = run.base + b.images.contact_sheet;
  ui.useStatus.textContent = "To start a template, copy the director prompt and paste it into Claude Code opened in the SpellDirector folder.";

  ui.prep.hidden = true;
  ui.results.hidden = false;
  history.replaceState(null, "", `?run=${run.id}`);
  sizeTimeline();
}

// ------------------------------------------------------------ playback

function seek(ms, pause = false) {
  state.t = Math.min(Math.max(ms, 0), Math.max(state.duration - 1, 0));
  if (pause) setPlaying(false);
}

function setPlaying(on) {
  state.playing = on;
  ui.play.textContent = on ? "Pause" : "Play";
  state.last = performance.now();
}

function stepFrame(dir) {
  const frames = state.run?.breakdown.frames || [];
  if (!frames.length) return;
  const i = Math.min(Math.max(frameAt(frames, state.t) + dir, 0), frames.length - 1);
  seek(frames[i].start_ms, true);
}

ui.play.onclick = () => {
  if (!state.playing && state.t >= state.duration - 1) state.t = 0;
  setPlaying(!state.playing);
};
ui.prev.onclick = () => stepFrame(-1);
ui.next.onclick = () => stepFrame(1);
window.addEventListener("keydown", (e) => {
  if (ui.results.hidden || e.target.closest?.("input, select, textarea")) return;
  if (e.key === " ") {
    e.preventDefault();
    ui.play.click();
  } else if (e.key === "," || e.key === "ArrowLeft") stepFrame(-1);
  else if (e.key === "." || e.key === "ArrowRight") stepFrame(1);
});

function drawClip(i) {
  const ctx = ui.clip.getContext("2d");
  const img = state.images[i];
  if (img) ctx.drawImage(img, 0, 0, ui.clip.width, ui.clip.height);
  const o = ui.overlay.getContext("2d");
  const W = ui.overlay.width;
  const H = ui.overlay.height;
  o.clearRect(0, 0, W, H);
  const b = state.run.breakdown;
  if (ui.showHeatmap.checked && state.heatmap) {
    o.globalAlpha = 0.65;
    o.drawImage(state.heatmap, 0, 0, W, H);
    o.globalAlpha = 1;
  }
  const lw = Math.max(1, Math.round(Math.max(W, H) / 240));
  const shotOk = b.space?.shot == null || (b.frames[i]?.shot ?? 0) === b.space.shot;
  if (ui.showFootprint.checked && b.space?.footprint_bbox && shotOk) {
    const [x0, y0, x1, y1] = b.space.footprint_bbox;
    o.setLineDash([6 * lw, 4 * lw]);
    o.strokeStyle = "#ffc83c";
    o.lineWidth = lw;
    o.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    o.setLineDash([]);
  }
  const f = b.frames[i];
  if (ui.showFrameBox.checked && f?.bbox) {
    const [x0, y0, x1, y1] = f.bbox;
    o.strokeStyle = "#5fd0c0";
    o.lineWidth = lw;
    o.strokeRect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H);
    if (f.centroid) {
      o.fillStyle = "#5fd0c0";
      o.beginPath();
      o.arc(f.centroid[0] * W, f.centroid[1] * H, 3 * lw, 0, Math.PI * 2);
      o.fill();
    }
  }
}

// ------------------------------------------------------------ timeline

const TL = { shotsY: 0, shotsH: 12, phaseY: 16, phaseH: 20, curveY: 42, curveH: 96, axisY: 142, height: 160 };

function sizeTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const w = ui.timeline.clientWidth || 600;
  ui.timeline.width = Math.round(w * dpr);
  ui.timeline.height = Math.round(TL.height * dpr);
  ui.timeline.style.height = `${TL.height}px`;
}
window.addEventListener("resize", () => { if (state.run) sizeTimeline(); });

function drawTimeline() {
  const b = state.run.breakdown;
  const c = ui.timeline;
  const ctx = c.getContext("2d");
  const dpr = c.width / (c.clientWidth || 1);
  const W = c.clientWidth;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, TL.height);
  const dur = Math.max(state.duration, 1);
  const x = (ms) => (ms / dur) * W;

  // Shots
  const shots = shotBands(b);
  shots.forEach((s, k) => {
    ctx.fillStyle = s.main ? "#4a4f63" : k % 2 ? "#2f3341" : "#383c4c";
    ctx.fillRect(x(s.start_ms), TL.shotsY, Math.max(1, x(s.end_ms) - x(s.start_ms)), TL.shotsH);
    if (shots.length > 1) {
      ctx.fillStyle = "#c9cbd3";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`shot ${s.shot + 1}${s.main ? " · main" : ""}`, x(s.start_ms) + 4, TL.shotsY + 10);
    }
  });
  if (!shots.length) {
    ctx.fillStyle = "#383c4c";
    ctx.fillRect(0, TL.shotsY, W, TL.shotsH);
  }

  // Phases
  ctx.fillStyle = "#22252e";
  ctx.fillRect(0, TL.phaseY, W, TL.phaseH);
  for (const p of state.bands) {
    const px = x(p.start_ms);
    const pw = Math.max(2, x(p.end_ms) - px);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = p.color;
    ctx.fillRect(px, TL.phaseY, pw, TL.phaseH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#111";
    ctx.font = "11px system-ui, sans-serif";
    if (pw > ctx.measureText(p.phase).width + 8) ctx.fillText(p.phase, px + 4, TL.phaseY + 14);
  }

  // Curves
  ctx.fillStyle = "#1d2029";
  ctx.fillRect(0, TL.curveY, W, TL.curveH);
  const frames = b.frames;
  const series = (key) => frames.map((f) => [x(f.start_ms + f.duration_ms / 2), f[key] ?? 0]);
  const y = (v) => TL.curveY + TL.curveH - Math.min(Math.max(v, 0), 1) * (TL.curveH - 4);
  const maxCov = Math.max(...frames.map((f) => f.coverage || 0), 0.001);
  const maxMot = Math.max(...frames.map((f) => f.motion || 0), 0.001);
  // intensity: filled
  const inten = series("intensity");
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  for (const [px, v] of inten) ctx.lineTo(px, y(v));
  ctx.lineTo(W, y(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(185, 166, 255, 0.25)";
  ctx.fill();
  const line = (pts, color, scale) => {
    ctx.beginPath();
    pts.forEach(([px, v], k) => (k ? ctx.lineTo(px, y(v / scale)) : ctx.moveTo(px, y(v / scale))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  line(series("motion"), COLORS.motion, maxMot);
  line(series("coverage"), COLORS.coverage, maxCov);
  line(inten, COLORS.intensity, 1);
  for (const pk of b.timing?.peaks || []) {
    const f = frames[pk.frame];
    if (!f) continue;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x(f.start_ms + f.duration_ms / 2), y(pk.intensity), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cuts
  ctx.strokeStyle = COLORS.cut;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  for (const ms of cutTimes(b)) {
    ctx.beginPath();
    ctx.moveTo(x(ms) + 0.5, 0);
    ctx.lineTo(x(ms) + 0.5, TL.axisY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Axis
  ctx.fillStyle = "#9a9daa";
  ctx.font = "10px system-ui, sans-serif";
  const step = niceStep(dur, W);
  for (let ms = 0; ms <= dur; ms += step) {
    const px = x(ms);
    ctx.fillRect(px, TL.axisY, 1, 4);
    const label = formatMs(ms);
    const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(Math.max(px - tw / 2, 0), W - tw), TL.axisY + 15);
  }

  // Playhead
  const hx = x(state.t);
  ctx.fillStyle = COLORS.head;
  ctx.fillRect(hx - 1, 0, 2, TL.axisY);
}

function niceStep(dur, width) {
  const target = dur / Math.max(2, Math.floor(width / 70));
  for (const s of [20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]) if (s >= target) return s;
  return 20000;
}

function timeFromPointer(e) {
  const r = ui.timeline.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * state.duration;
}
ui.timeline.addEventListener("pointerdown", (e) => {
  if (!state.run) return;
  state.dragging = true;
  ui.timeline.setPointerCapture(e.pointerId);
  seek(timeFromPointer(e), true);
});
ui.timeline.addEventListener("pointermove", (e) => { if (state.dragging) seek(timeFromPointer(e)); });
ui.timeline.addEventListener("pointerup", () => { state.dragging = false; });

function drawFacts(i) {
  const f = state.run.breakdown.frames[i];
  if (!f) return;
  const phase = phaseAt(state.bands, state.t);
  ui.clipTime.textContent = `${formatMs(f.start_ms)} · frame ${f.index}`;
  ui.clipPhase.textContent = phase ? phase.phase : "";
  ui.clipPhase.style.color = phase ? phase.color : "";
  ui.frameFacts.textContent = `Frame ${f.index} at ${formatMs(f.start_ms)} for ${formatMs(f.duration_ms)}: `
    + `intensity ${f.intensity}, coverage ${percent(f.coverage)}, motion ${f.motion}, hint ${f.phase_hint}`
    + ((state.run.breakdown.shots || []).length > 1 ? `, shot ${(f.shot ?? 0) + 1}` : "");
}

let lastFrame = -1;
let lastKey = "";
function loop(now) {
  const dt = now - state.last;
  state.last = now;
  if (state.run && !ui.results.hidden) {
    if (state.playing && !state.dragging) {
      state.t += dt * Number(ui.speed.value);
      if (state.t >= state.duration) {
        if (ui.loop.checked) state.t %= Math.max(state.duration, 1);
        else {
          state.t = Math.max(state.duration - 1, 0);
          setPlaying(false);
        }
      }
    }
    const i = frameAt(state.run.breakdown.frames, state.t);
    const key = `${i}|${ui.showFootprint.checked}|${ui.showHeatmap.checked}|${ui.showFrameBox.checked}`;
    if (key !== lastKey) {
      drawClip(i);
      if (i !== lastFrame) drawFacts(i);
      lastFrame = i;
      lastKey = key;
    }
    drawTimeline();
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------ saving

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

ui.saveZip.onclick = async () => {
  const run = state.run;
  if (!run) return;
  const folder = `${slug(run.breakdown.gif.source)}-breakdown`;
  try {
    const files = await Promise.all(savedFiles(run.breakdown).map(async (name) => {
      const res = await fetch(run.base + name);
      if (!res.ok) throw new Error(`could not read ${name} (${res.status})`);
      return { name: `${folder}/${name}`, data: new Uint8Array(await res.arrayBuffer()) };
    }));
    download(`${folder}.zip`, makeZip(files), "application/zip");
    ui.useStatus.textContent = `Saved ${folder}.zip. Unzip it into the repo's breakdowns/ folder to hand it to the director.`;
  } catch (err) {
    ui.useStatus.textContent = `Could not save: ${err.message}. Analyze the clip again (only the newest few are kept).`;
  }
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

ui.copyPrompt.onclick = async () => {
  if (!state.run) return;
  const ok = await copyText(directorPrompt(state.run.breakdown, state.run.summary));
  ui.useStatus.textContent = ok
    ? "Copied. Paste it into Claude Code opened in the SpellDirector folder, and the director builds a template from it."
    : "Your browser blocked copying. Save the breakdown instead and point the director at breakdown.json.";
};

// ------------------------------------------------------------ boot

// Reopen a recent analysis from ?run=<id> (kept in the temp folder until newer ones replace it).
async function reopen() {
  const id = new URLSearchParams(location.search).get("run");
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return;
  try {
    const res = await fetch(`analysis/${id}/breakdown.json`);
    if (!res.ok) return;
    const breakdown = await res.json();
    const sum = await fetch(`analysis/${id}/summary.txt`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    await showRun({ id, base: `analysis/${id}/`, summary: sum.trim(), breakdown });
    ui.drop.hidden = true;
  } catch {
    // gone: start fresh
  }
}

async function showVersion() {
  try {
    const res = await fetch("version.json");
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version) return;
    const badge = $("app-version");
    badge.textContent = `v${version}`;
    badge.hidden = false;
    document.title = `SpellDirector v${version} · Analyze a clip`;
  } catch {
    // no server
  }
}

showVersion();
reopen();
requestAnimationFrame(loop);
