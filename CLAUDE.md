# SpellDirector: notes for AI agents

Read [docs/DESIGN.md](docs/DESIGN.md) for the full design and [docs/ROADMAP.md](docs/ROADMAP.md) for what to build next.

## Standing rules from the owner

- **Every feature goes on a new branch.** When done: open a PR, merge it into `main`, then delete the branch. (The repo auto-deletes merged branches.)
- **Use Codex for any image generation**, such as the app icon. Don't generate images with Claude.
- Keep everything **game- and engine-agnostic** (not tied to Pokemon or any one game).
- MidiMCP is inspiration for the template idea only. Don't copy its architecture.
- Templates must work from all four views: front, side, top, 3/4.
- No hosted CI. Run the checks below before every PR.

## Checks

```bash
python -m pip install -r requirements-dev.txt
python tools/validate.py templates/*/*.json
python -m pytest
node --test web-tests/*.test.mjs
```

After adding or renaming a template, run `python tools/build_index.py` (a test fails if `templates/index.json` is stale).

## Conventions

- The director: follow [docs/director-playbook.md](docs/director-playbook.md). Its MCP server (`python -m director.mcp_server`) is a thin adapter over `director/library.py`; put logic in the library, and never print to stdout from server code.
- Template changes: update the schema, `docs/template-format.md`, `tools/validate.py` (`KNOWN_PARAMS`), and the viewer's layer classes together.
- The viewer must stay a pure function of (template, seed, time). No accumulated per-frame state.
- Viewer has no build step; Three.js r169 is vendored in `web/vendor`.
- Launch the viewer with `run.bat` / `./run.sh` or `python tools/serve.py` (default port 47811).
- Check the viewer in headless Chromium with the URL parameters `?template=<id>&view=<view>&t=<ms>`.
