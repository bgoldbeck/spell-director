"""The getting-started page: reachable from the viewer, local links resolve, and it names real director prompts."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HELP = (WEB / "help.html").read_text(encoding="utf-8")


def test_viewer_and_analyze_pages_link_to_help():
    for page in ("index.html", "analyze.html"):
        assert 'href="help.html"' in (WEB / page).read_text(encoding="utf-8"), page


def test_help_page_local_links_exist():
    refs = re.findall(r'(?:href|src)="([^"#:]+)"', HELP)
    assert refs
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    import serve

    for ref in refs:
        if ref.startswith("docs/"):  # served from the bundle for AI chats (serve.SHARED_DOCS)
            assert serve.SHARED_DOCS[ref[len("docs/"):]].is_file(), ref
            continue
        target = WEB / ref
        if ref.endswith("/") or ref == "./":
            target = target / "index.html"
        assert target.exists(), ref


def test_help_page_names_real_director_prompts():
    server = (ROOT / "director" / "mcp_server.py").read_text(encoding="utf-8")
    for prompt in re.findall(r"/mcp__spelldirector__(\w+)", HELP):
        assert f"def {prompt}(" in server, prompt
    mcp_json = (ROOT / ".mcp.json").read_text(encoding="utf-8")
    assert '"spelldirector"' in mcp_json and "director.mcp_server" in HELP


def test_help_page_ships_in_the_exe():
    import sys

    sys.path.insert(0, str(ROOT / "tools"))
    import build_exe

    assert "web" in build_exe.BUNDLED


def test_help_page_offers_one_click_setup_and_ai_prompts():
    for needle in ('id="setup-clients"', 'class="fill-setup"', 'class="fill-exe-json"', 'id="p-agent"', 'id="p-chat"',
                   "--setup", "docs/setup.md", "ChatGPT"):
        assert needle in HELP, needle
    js = (WEB / "js" / "help.js").read_text(encoding="utf-8")
    assert '"X-SpellDirector": "setup"' in js and "api/setup" in js
    # The setup guide names the same flag and prompts as the page.
    guide = (ROOT / "docs" / "setup.md").read_text(encoding="utf-8")
    for needle in ("--setup", "List the SpellDirector spells.", "Run anyway", "Codex", "startup_timeout_sec"):
        assert needle in guide, needle
