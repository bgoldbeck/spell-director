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
3. Start the release, either way:
   - **From GitHub:** Actions tab → *Release* → *Run workflow* on `main`. It creates the `vX.Y.Z` tag from `VERSION` on the latest `main` commit.
   - **From a terminal:** tag the merge commit and push the tag:

     ```bash
     git checkout main && git pull
     git tag vX.Y.Z
     git push origin vX.Y.Z
     ```

4. The [release workflow](../.github/workflows/release.yml) checks that the tag matches `VERSION` and creates the GitHub Release, with that version's changelog section as the notes. To preview the notes: `python tools/release_notes.py`.
