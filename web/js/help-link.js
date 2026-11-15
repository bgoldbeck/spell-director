// Help entry points for the viewer: the "?" key and a one-time hint for new users.
// Kept apart from main.js so the viewer stays a pure function of (template, seed, time).
const SEEN_KEY = "spelldirector.helpSeen";

export function markHelpSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked */ }
}

function helpSeen() {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

export function installHelp() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) location.href = "help.html";
  });

  const hint = document.getElementById("help-hint");
  // Skip the hint when the page is opened with URL parameters (links from the director, headless checks).
  if (!hint || helpSeen() || location.search) return;
  hint.hidden = false;
  hint.querySelector("[data-dismiss]").addEventListener("click", () => {
    markHelpSeen();
    hint.hidden = true;
  });
  hint.querySelector("a").addEventListener("click", markHelpSeen);
}

if (typeof document !== "undefined" && document.getElementById("help-hint")) installHelp();
