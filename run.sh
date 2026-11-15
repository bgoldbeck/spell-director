#!/usr/bin/env sh
# Launch the SpellDirector viewer and open it in your browser.
# Usage: ./run.sh [port]
cd "$(dirname "$0")" || exit 1
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3 was not found. Install it and try again."
  exit 1
fi
if [ -n "$1" ]; then
  exec "$PY" tools/serve.py --open --port "$1"
fi
exec "$PY" tools/serve.py --open
