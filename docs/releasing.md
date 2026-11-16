# Releasing

SpellDirector uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **Patch** (0.1.0 → 0.1.1): fixes only.
- **Minor** (0.1.0 → 0.2.0): new features, such as a new spell family or tool. While we're on 0.x, a minor bump may also break things (for example a new template schema).
- **Major** (→ 1.0.0): when the template format and director are stable enough to promise compatibility.

The version lives in one place: the [`VERSION`](../VERSION) file. `director.__version__` reads it. The template **schema** version (`schemas/template-0.1.0.schema.json`) is separate and only changes when the template format changes.

## While working

Each PR that changes behavior adds a line under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md), in the Added / Changed / Fixed / Removed groups.

## Cutting a release

1. On a branch: set the new version in `VERSION`, and rename `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD`, with a fresh empty `## [Unreleased]` above it.
2. Run the checks in [CLAUDE.md](../CLAUDE.md) (a test checks that `VERSION` and the changelog agree), then PR and merge into `main`.
3. Publish it from the latest `main`, **on Windows** so the attached exe is a Windows build:

   ```bash
   python -m pip install -r requirements-build.txt   # PyInstaller plus numpy, Pillow, PyAV (rerun when it changes)
   python tools/release.py --dry-run   # check the tag and notes
   python tools/release.py             # build the exe, publish, attach the exe
   ```

   The script reads `VERSION` and that version's changelog section, builds `dist/SpellDirector-v<version>-windows.exe` with [`tools/build_exe.py`](../tools/build_exe.py), creates the GitHub Release through the REST API, and uploads the exe to it. GitHub creates the `vX.Y.Z` tag on `main` itself, so nothing gets pushed and no GitHub Actions are used. It stops if that release already exists. If the upload fails after the release was created, `python tools/release.py --attach` builds and uploads the exe again; `--no-exe` skips the exe.

   It needs a GitHub token with *Contents: read and write* on this repo: `GH_TOKEN` (or `GITHUB_TOKEN`) in the environment, or the GitHub CLI signed in (`gh auth login`). Claude runs this on the owner's PC, where the sign-in lives.

## The exe

`SpellDirector-v<version>-windows.exe` is the viewer packaged with PyInstaller (one file, with a console window). It bundles `web/`, `templates/`, `schemas/`, `docs/`, `VERSION` and the director, serves them on localhost (port 47811, or the next free one) and opens the browser. Run with `--mcp`, it is the director's MCP server instead (see the README); the user's templates, exports and breakdowns then live in `SpellDirector Library` next to the exe. If one is already running, it just opens the browser on that one and exits. The viewer header shows the version from the bundled `VERSION`. Closing the window stops it. Command-line options are the same as `tools/serve.py` (for example `--port`). To build one without releasing: `python tools/build_exe.py`.
