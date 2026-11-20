#!/usr/bin/env sh
# Launch the SpellDirector viewer and open it in your browser.
# Usage: ./run.sh [port]
# It first pulls updates from GitHub (skipped, with a note, if there is no Git,
# no network or you have local changes), then closes any SpellDirector that is
# already running and starts a fresh one, so only one ever runs.
# Set SPELLDIRECTOR_NO_UPDATE=1 to skip the update.
cd "$(dirname "$0")" || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3 was not found. Install it and try again."
  exit 1
fi
exec "$PY" tools/launch.py "$@"
