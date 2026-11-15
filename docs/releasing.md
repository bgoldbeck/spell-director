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
3. Publish the release from the latest `main`. No GitHub Actions are involved, and GitHub creates the tag itself, so nothing needs to be pushed. Pick either way:
   - **On github.com:** Releases → *Draft a new release* → type `vX.Y.Z` in *Choose a tag* and pick *Create new tag on publish*, target `main`, title `SpellDirector vX.Y.Z`, and paste the output of `python tools/release_notes.py` as the description. Click *Publish release*.
   - **With the GitHub CLI** (`gh`, signed in):

     ```bash
     git checkout main && git pull
     python tools/release_notes.py > release-notes.md
     gh release create "v$(cat VERSION)" --target main --title "SpellDirector v$(cat VERSION)" --notes-file release-notes.md
     ```

`python tools/release_notes.py` prints the changelog section for the version in `VERSION` (or pass a version, such as `0.1.0`).
