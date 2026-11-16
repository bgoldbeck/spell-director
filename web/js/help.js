// Getting-started page: version badge, copy buttons and one-click AI setup
// (GET/POST /api/setup, tools/client_setup.py). No viewer state involved.
import { markHelpSeen } from "./help-link.js";

markHelpSeen();

for (const btn of document.querySelectorAll("button.copy")) {
  btn.addEventListener("click", async () => {
    const text = document.getElementById(btn.dataset.copy).textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      // No clipboard access (e.g. not localhost): select the text so Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(btn.dataset.copy));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      btn.textContent = "Press Ctrl+C";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1600);
  });
}

try {
  const res = await fetch("version.json");
  if (res.ok) {
    const { version } = await res.json();
    if (version) {
      const el = document.getElementById("app-version");
      el.textContent = `v${version}`;
      el.hidden = false;
      document.title = `SpellDirector v${version} · Getting started`;
    }
  }
} catch {
  // Opened without the server: no version to show.
}

// ---------------------------------------------------------------- Connect your AI

const STATE_TEXT = (c) => c.current ? "Connected to this copy"
  : c.configured ? "Connected to another copy of SpellDirector"
  : c.found ? "Not connected yet" : "Not found on this computer";

function fill(info) {
  const cmd = info.command;
  const fills = {
    ".fill-exe": cmd,
    ".fill-exe-json": JSON.stringify(cmd).slice(1, -1),
    ".fill-setup": info.frozen ? `& "${cmd}" --setup` : "python tools/client_setup.py (in the spell-director folder)",
  };
  for (const [sel, text] of Object.entries(fills)) {
    for (const el of document.querySelectorAll(sel)) el.textContent = text;
  }
  for (const el of document.querySelectorAll(".fill-library")) el.textContent = info.library;
}

function renderClients(info) {
  const box = document.getElementById("setup-clients");
  box.replaceChildren();
  for (const [key, c] of Object.entries(info.clients)) {
    const row = document.createElement("div");
    row.className = "setup-row" + (c.current ? " ok" : "");
    const name = document.createElement("b");
    name.textContent = c.label;
    const state = document.createElement("span");
    state.className = "muted small";
    state.textContent = STATE_TEXT(c);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn" + (c.current ? "" : " active");
    btn.textContent = c.current ? "Connect again" : c.configured ? "Switch to this copy" : "Connect";
    // Claude Code is set up through its own command, so it has to be installed first.
    btn.disabled = key === "claude-code" && !c.found;
    btn.addEventListener("click", () => connect([key], btn));
    row.append(name, state, btn);
    box.append(row);
  }
  box.hidden = false;
}

async function connect(clients, btn) {
  const result = document.getElementById("setup-result");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    const res = await fetch("api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SpellDirector": "setup" },
      body: JSON.stringify({ clients }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    result.textContent = data.results.map((r) => `${data.clients[r.client]?.label ?? r.client}: ${r.message}`).join("\n");
    result.classList.toggle("bad", !data.results.every((r) => r.ok));
    renderClients(data);
  } catch (err) {
    result.textContent = `Couldn't connect: ${err.message}. The setup guide below shows how to do it by hand.`;
    result.classList.add("bad");
    btn.disabled = false;
    btn.textContent = "Try again";
  }
  result.hidden = false;
}

try {
  const res = await fetch("api/setup");
  if (res.ok) {
    const info = await res.json();
    fill(info);
    renderClients(info);
    document.getElementById("setup-offline").hidden = true;
  }
} catch {
  // Opened without the server: the page explains how to set up by hand.
}
