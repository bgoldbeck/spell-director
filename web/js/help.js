// Getting-started page: version badge and copy buttons. No viewer state involved.
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
